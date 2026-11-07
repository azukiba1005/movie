import {
  AudioLevelStats,
  CutInterval,
  MediaAsset,
  SilenceConfig,
  VideoClip,
} from '../types/editor';

/**
 * Probe video/audio element duration & dimensions via DOM element
 */
export function probeMediaMetadata(
  objectUrl: string,
  type: 'video' | 'bgm'
): Promise<{ duration: number; width?: number; height?: number }> {
  return new Promise((resolve, reject) => {
    const el =
      type === 'video'
        ? document.createElement('video')
        : document.createElement('audio');
    el.preload = 'metadata';
    el.src = objectUrl;

    const cleanup = () => {
      el.onloadedmetadata = null;
      el.onerror = null;
    };

    el.onloadedmetadata = () => {
      const duration =
        Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 10;
      const width =
        type === 'video'
          ? (el as HTMLVideoElement).videoWidth || 1920
          : undefined;
      const height =
        type === 'video'
          ? (el as HTMLVideoElement).videoHeight || 1080
          : undefined;
      cleanup();
      resolve({ duration, width, height });
    };

    el.onerror = () => {
      cleanup();
      reject(new Error('メディアのメタデータ読み込みに失敗しました'));
    };
  });
}

/**
 * Check whether an AudioBuffer contains actual non-zero audio samples across any channel.
 */
function checkAudioBufferHasSignal(buffer: AudioBuffer): {
  hasSignal: boolean;
  maxSample: number;
} {
  let maxSample = 0;
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  // Sample every 16th frame first for quick check, then full check if needed
  const stride = Math.max(1, Math.floor(length / 50000));

  for (let ch = 0; ch < numChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i += stride) {
      const abs = Math.abs(data[i]);
      if (abs > maxSample) {
        maxSample = abs;
      }
    }
  }

  return {
    hasSignal: maxSample > 1e-5,
    maxSample,
  };
}

/**
 * Robust multi-stage audio decoder for both short and long-form (10+ min) videos.
 * - Stage 1: OfflineAudioContext (2ch, 16kHz) — decodes purely in software without hardware AudioContext limits.
 * - Stage 2: Standard native-sample-rate AudioContext (most compatible across Chrome/Safari/Edge for AAC/MP4/MOV).
 * - Stage 3: OfflineAudioContext (1ch, 8kHz) — ultra-low memory footprint fallback for very long videos.
 * - Never returns dummy zero arrays: throws an explicit Error if decoding fails or if the audio stream is empty.
 */
async function decodeAudioBufferRobust(file: File | Blob): Promise<AudioBuffer> {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const OfflineCtx =
    window.OfflineAudioContext ||
    (
      window as unknown as {
        webkitOfflineAudioContext: typeof OfflineAudioContext;
      }
    ).webkitOfflineAudioContext;

  const rawArrayBuffer = await file.arrayBuffer();
  if (!rawArrayBuffer || rawArrayBuffer.byteLength === 0) {
    throw new Error('ファイルデータが空です。');
  }

  let lastError: unknown = null;

  // Stage 1: OfflineAudioContext (2ch, 16kHz) - avoids hardware audio device limits & keeps memory low on 10+ min videos
  if (OfflineCtx) {
    try {
      const offline16k = new OfflineCtx(2, 1, 16000);
      const buffer = await offline16k.decodeAudioData(rawArrayBuffer.slice(0));
      const check = checkAudioBufferHasSignal(buffer);
      if (check.hasSignal) {
        return buffer;
      }
    } catch (err) {
      lastError = err;
    }
  }

  // Stage 2: Standard native-sample-rate AudioContext
  if (AudioCtx) {
    try {
      const nativeCtx = new AudioCtx();
      try {
        const buffer = await nativeCtx.decodeAudioData(rawArrayBuffer.slice(0));
        const check = checkAudioBufferHasSignal(buffer);
        await nativeCtx.close().catch(() => {});
        if (check.hasSignal) {
          return buffer;
        }
      } catch (err) {
        lastError = err;
        await nativeCtx.close().catch(() => {});
      }
    } catch (err) {
      lastError = err;
    }
  }

  // Stage 3: Ultra-lightweight OfflineAudioContext (1ch, 8kHz) for memory-constrained environments
  if (OfflineCtx) {
    try {
      const offline8k = new OfflineCtx(1, 1, 8000);
      const buffer = await offline8k.decodeAudioData(rawArrayBuffer.slice(0));
      const check = checkAudioBufferHasSignal(buffer);
      if (check.hasSignal) {
        return buffer;
      }
    } catch (err) {
      lastError = err;
    }
  }

  const errDetail =
    lastError instanceof Error ? ` (${lastError.message})` : '';
  throw new Error(
    `動画から有効な音声データをデコードできませんでした${errDetail}。音声トラックが含まれているか、対応コーデック（AAC/PCM/MP3/Opus）であるか確認してください。`
  );
}

/**
 * Extract high-precision multi-channel RMS waveform peaks + Peak Normalization (Auto-Gain)
 * + Audio Level Statistics (Max dB, Speech 95th-percentile dB, Mean dB, Noise Floor dB).
 * Never returns dummy zero arrays on error — throws a descriptive error instead.
 */
export async function extractWaveformPeaks(
  file: File | Blob,
  peaksPerSecond = 50
): Promise<{
  peaks: number[];
  rawRms: number[];
  duration: number;
  sampleRate: number;
  audioBuffer: AudioBuffer;
  audioStats: AudioLevelStats;
}> {
  const audioBuffer = await decodeAudioBufferRobust(file);
  const duration = audioBuffer.duration;
  const numChannels = audioBuffer.numberOfChannels;
  const totalSamples = audioBuffer.length;
  const totalWindows = Math.max(1, Math.ceil(duration * peaksPerSecond));
  const samplesPerWindow = Math.max(1, Math.floor(totalSamples / totalWindows));

  // Gather all channel Float32Arrays (handles Mono, Stereo, and Multi-channel 4ch/6ch OBS/Camera tracks)
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(audioBuffer.getChannelData(ch));
  }

  const rawRms: number[] = new Array(totalWindows);
  let globalMaxSamplePeak = 0;
  let globalMaxWindowRms = 0;
  let sumAllRms = 0;

  // Scan every sample across all channels (no coarse sample skipping)
  for (let w = 0; w < totalWindows; w++) {
    const startIdx = w * samplesPerWindow;
    const endIdx =
      w === totalWindows - 1
        ? totalSamples
        : Math.min(totalSamples, startIdx + samplesPerWindow);
    const count = Math.max(1, endIdx - startIdx);

    let sumSquares = 0;

    if (numChannels === 1) {
      const ch0 = channels[0];
      for (let j = startIdx; j < endIdx; j++) {
        const abs = Math.abs(ch0[j]);
        if (abs > globalMaxSamplePeak) globalMaxSamplePeak = abs;
        sumSquares += abs * abs;
      }
    } else if (numChannels === 2) {
      const ch0 = channels[0];
      const ch1 = channels[1];
      for (let j = startIdx; j < endIdx; j++) {
        const a0 = Math.abs(ch0[j]);
        const a1 = Math.abs(ch1[j]);
        // Use max amplitude across channels so single-ear/L-only/R-only mic recordings are never halved
        const maxCh = a0 > a1 ? a0 : a1;
        if (maxCh > globalMaxSamplePeak) globalMaxSamplePeak = maxCh;
        sumSquares += maxCh * maxCh;
      }
    } else {
      for (let j = startIdx; j < endIdx; j++) {
        let maxCh = 0;
        for (let c = 0; c < numChannels; c++) {
          const abs = Math.abs(channels[c][j]);
          if (abs > maxCh) maxCh = abs;
        }
        if (maxCh > globalMaxSamplePeak) globalMaxSamplePeak = maxCh;
        sumSquares += maxCh * maxCh;
      }
    }

    const rms = Math.sqrt(sumSquares / count);
    rawRms[w] = Number(rms.toFixed(6));
    if (rms > globalMaxWindowRms) {
      globalMaxWindowRms = rms;
    }
    sumAllRms += rms;
  }

  if (globalMaxSamplePeak <= 1e-5 || globalMaxWindowRms <= 1e-6) {
    throw new Error(
      '音声トラックの信号レベルが完全にゼロ（無音）です。動画に音声が入っているか確認してください。'
    );
  }

  // Compute percentiles of window RMS for robust Auto-Gain Normalization & Noise Floor estimation
  const sortedRms = [...rawRms].sort((a, b) => a - b);
  const p98Rms =
    sortedRms[Math.min(sortedRms.length - 1, Math.floor(sortedRms.length * 0.98))] ||
    globalMaxWindowRms;
  const p95Rms =
    sortedRms[Math.min(sortedRms.length - 1, Math.floor(sortedRms.length * 0.95))] ||
    globalMaxWindowRms;
  const p15Rms =
    sortedRms[Math.floor(sortedRms.length * 0.15)] || 1e-6;
  const meanRms = sumAllRms / totalWindows;

  // Reference level for normalization: 98th percentile RMS (prevents a single 1ms mic pop from making all speech tiny)
  const normReferenceRms = Math.max(p98Rms, globalMaxWindowRms * 0.5, 1e-5);
  const appliedGainLinear = 1.0 / normReferenceRms;
  const appliedGainDb = Number((20 * Math.log10(appliedGainLinear)).toFixed(1));

  // Normalize waveformPeaks to [0..1] relative to normReferenceRms
  const normalizedPeaks: number[] = new Array(totalWindows);
  for (let w = 0; w < totalWindows; w++) {
    const normVal = Math.min(1.0, rawRms[w] * appliedGainLinear);
    normalizedPeaks[w] = Number(normVal.toFixed(5));
  }

  const toDb = (amp: number) =>
    Number((20 * Math.log10(Math.max(amp, 1e-5))).toFixed(1));

  const rawPeakDb = toDb(globalMaxSamplePeak);
  const rawSpeechRmsDb = toDb(p95Rms);
  const rawMeanDb = toDb(meanRms);

  // Noise floor in normalized dB scale (where speech p98 = 0 dB)
  const normNoiseFloorLinear = Math.min(1.0, p15Rms * appliedGainLinear);
  const noiseFloorDb = toDb(normNoiseFloorLinear);

  // Suggest a threshold safely between the normalized speech (-3dB) and noise floor
  // e.g. if noise floor is -48dB, suggest around -30dB; if noise floor is -26dB, suggest -20dB
  const suggestedThresholdDb = Math.round(
    Math.max(-44, Math.min(-18, (noiseFloorDb - 6) * 0.65))
  );

  const audioStats: AudioLevelStats = {
    rawPeakDb,
    rawSpeechRmsDb,
    rawMeanDb,
    noiseFloorDb,
    appliedGainDb,
    suggestedThresholdDb,
  };

  return {
    peaks: normalizedPeaks,
    rawRms,
    duration,
    sampleRate: peaksPerSecond,
    audioBuffer,
    audioStats,
  };
}

/**
 * Detect silent intervals across the active timeline VideoClips using RMS dB calculation.
 * - Uses Peak-Normalized RMS dB by default (`config.autoNormalize !== false`) so quiet recordings
 *   are never falsely detected as 100% silence.
 * - Applies a 3-window moving average energy filter so brief consonant dips don't false-trigger.
 * - Throws a clear error if waveform data is missing or if threshold is set higher than all speech.
 */
export function detectSilenceOnTimeline(
  videoClips: VideoClip[],
  mediaAssets: MediaAsset[],
  config: SilenceConfig
): CutInterval[] {
  const minSilenceSec = Math.max(0.08, config.minSilenceDurationMs / 1000);
  const paddingSec = Math.max(0, config.paddingMs / 1000);
  const useNormalized = config.autoNormalize !== false;

  const detected: CutInterval[] = [];
  let counter = 0;
  let totalTimelineDuration = 0;

  for (const clip of videoClips) {
    totalTimelineDuration += clip.duration;
    const asset = mediaAssets.find((m) => m.id === clip.mediaId);

    if (!asset) continue;

    if (asset.audioDecodeError) {
      throw new Error(
        `音声デコードエラーのため無音検知できません: ${asset.audioDecodeError}`
      );
    }

    const sourceArray =
      !useNormalized &&
      asset.rawWaveformRms &&
      asset.rawWaveformRms.length > 0
        ? asset.rawWaveformRms
        : asset.waveformPeaks;

    if (!sourceArray || sourceArray.length === 0) {
      throw new Error(
        `動画「${asset.name}」の音声波形データが存在しません。「音声波形を再解析」ボタンを押してください。`
      );
    }

    // Verify that the waveform array actually has non-zero signal
    let maxValInClip = 0;
    const rate = asset.waveformSampleRate || 50;
    const startPeakIdx = Math.max(0, Math.floor(clip.sourceStart * rate));
    const endPeakIdx = Math.min(
      sourceArray.length - 1,
      Math.ceil(clip.sourceEnd * rate)
    );

    for (let i = startPeakIdx; i <= endPeakIdx; i++) {
      if ((sourceArray[i] ?? 0) > maxValInClip) {
        maxValInClip = sourceArray[i];
      }
    }

    if (maxValInClip <= 1e-5) {
      throw new Error(
        `動画「${asset.name}」の振幅データがすべて 0 です。左パネルの「音声波形を再解析」を実行してください。`
      );
    }

    // If user disabled autoNormalize OR if asset was loaded from an older state without normalization,
    // compute on-the-fly normalization factor when useNormalized is true and maxValInClip < 0.25
    const dynamicGain =
      useNormalized && maxValInClip < 0.5 ? 1.0 / maxValInClip : 1.0;

    let silentStartPeak: number | null = null;

    const recordSilentSegment = (startIdx: number, endIdx: number) => {
      const srcSilenceStart = Math.max(clip.sourceStart, startIdx / rate);
      const srcSilenceEnd = Math.min(clip.sourceEnd, endIdx / rate);

      const rawTimelineStart =
        clip.startTime + (srcSilenceStart - clip.sourceStart) / clip.speed;
      const rawTimelineEnd =
        clip.startTime + (srcSilenceEnd - clip.sourceStart) / clip.speed;

      const paddedStart = rawTimelineStart + paddingSec;
      const paddedEnd = rawTimelineEnd - paddingSec;

      if (paddedEnd - paddedStart >= minSilenceSec) {
        detected.push({
          id: `silence-${counter++}-${Math.round(paddedStart * 1000)}`,
          start: Number(paddedStart.toFixed(3)),
          end: Number(paddedEnd.toFixed(3)),
          type: 'silence',
          category: 'silence',
          reason: `無音区間 (${(paddedEnd - paddedStart).toFixed(2)}s / < ${
            config.thresholdDb
          }dB${useNormalized ? ' 正規化基準' : ' Raw dBFS'})`,
          selected: true,
        });
      }
    };

    for (let i = startPeakIdx; i <= endPeakIdx; i++) {
      // 3-point local RMS smoothing (prevents 20ms zero-crossings in speech from splitting)
      const prev = sourceArray[Math.max(startPeakIdx, i - 1)] ?? 0;
      const curr = sourceArray[i] ?? 0;
      const next = sourceArray[Math.min(endPeakIdx, i + 1)] ?? 0;
      const smoothedRms = Math.max(curr, (prev + curr + next) / 3) * dynamicGain;

      // Convert linear RMS to dB: 20 * log10(rms)
      const currentDb =
        smoothedRms <= 1e-6 ? -100 : 20 * Math.log10(smoothedRms);
      const isSilent = currentDb < config.thresholdDb;

      if (isSilent && silentStartPeak === null) {
        silentStartPeak = i;
      } else if (!isSilent && silentStartPeak !== null) {
        recordSilentSegment(silentStartPeak, i);
        silentStartPeak = null;
      }
    }

    if (silentStartPeak !== null) {
      recordSilentSegment(silentStartPeak, endPeakIdx);
    }
  }

  // Safety check: if > 96% of the entire timeline was flagged as silence, warn the user
  const totalSilentDuration = detected.reduce(
    (acc, d) => acc + (d.end - d.start),
    0
  );
  if (
    detected.length === 1 &&
    totalTimelineDuration > 5 &&
    totalSilentDuration >= totalTimelineDuration * 0.95
  ) {
    const firstAsset = mediaAssets.find((m) => m.type === 'video');
    const suggested = firstAsset?.audioStats?.suggestedThresholdDb ?? -32;
    throw new Error(
      `現在のしきい値 (${config.thresholdDb} dB) では動画全体（${totalSilentDuration.toFixed(
        1
      )}秒）が無音と判定されてしまいます。しきい値を下げる（推奨: ${suggested} dB 付近）か、「自動ノーマライズ判定」をONにしてください。`
    );
  }

  return detected;
}

/**
 * Encode a mono AudioBuffer into a 16-bit PCM WAV Blob
 */
export function encodeMonoAudioBufferToWav(buffer: AudioBuffer): Blob {
  const numSamples = buffer.length;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 2; // 16-bit PCM
  const dataByteLength = numSamples * bytesPerSample;
  const arrayBuffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // AudioFormat = 1 (PCM)
  view.setUint16(22, 1, true); // NumChannels = 1 (Mono)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // ByteRate
  view.setUint16(32, bytesPerSample, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  writeString(36, 'data');
  view.setUint32(40, dataByteLength, true);

  const channelData = buffer.getChannelData(0);
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Split timeline audio into lightweight 16kHz mono WAV chunks (e.g. 35s per chunk)
 * using OfflineAudioContext so long videos can be sent to Cloudflare Workers AI Whisper
 * without exceeding memory or request payload limits.
 */
export async function renderTimelineAudioChunksForWhisper(
  videoClips: VideoClip[],
  mediaAssets: MediaAsset[],
  chunkDurationSec = 35,
  onProgress?: (msg: string) => void
): Promise<
  Array<{
    blob: Blob;
    offsetSeconds: number;
    durationSeconds: number;
  }>
> {
  const targetSampleRate = 16000;
  const totalTimelineDuration = videoClips.reduce(
    (acc, c) => Math.max(acc, c.startTime + c.duration),
    0
  );

  if (totalTimelineDuration <= 0.1) {
    throw new Error('タイムライン上に動画クリップがありません。');
  }

  // Decode each referenced video asset once using our robust decoder
  const decodedMap = new Map<string, AudioBuffer>();
  for (const clip of videoClips) {
    if (decodedMap.has(clip.mediaId)) continue;
    const asset = mediaAssets.find((m) => m.id === clip.mediaId);
    if (!asset?.file) continue;
    onProgress?.(`音声トラックを解析中: ${asset.name}...`);
    const audioBuf = await decodeAudioBufferRobust(asset.file);
    decodedMap.set(clip.mediaId, audioBuf);
  }

  const chunks: Array<{
    blob: Blob;
    offsetSeconds: number;
    durationSeconds: number;
  }> = [];

  for (
    let chunkStart = 0;
    chunkStart < totalTimelineDuration;
    chunkStart += chunkDurationSec
  ) {
    const chunkEnd = Math.min(
      totalTimelineDuration,
      chunkStart + chunkDurationSec
    );
    const chunkLen = chunkEnd - chunkStart;
    if (chunkLen < 0.2) break;

    const frameCount = Math.ceil(chunkLen * targetSampleRate);
    const offlineCtx = new OfflineAudioContext(1, frameCount, targetSampleRate);

    // Schedule all clips overlapping [chunkStart, chunkEnd]
    for (const clip of videoClips) {
      const clipEnd = clip.startTime + clip.duration;
      if (clipEnd <= chunkStart || clip.startTime >= chunkEnd || clip.muted) {
        continue;
      }
      const audioBuf = decodedMap.get(clip.mediaId);
      if (!audioBuf) continue;

      const overlapStart = Math.max(chunkStart, clip.startTime);
      const overlapEnd = Math.min(chunkEnd, clipEnd);
      const overlapTimelineDur = overlapEnd - overlapStart;
      if (overlapTimelineDur <= 0.02) continue;

      const relClipOffset = overlapStart - clip.startTime;
      const srcOffset = clip.sourceStart + relClipOffset * clip.speed;
      const srcDuration = overlapTimelineDur * clip.speed;

      const sourceNode = offlineCtx.createBufferSource();
      sourceNode.buffer = audioBuf;
      sourceNode.playbackRate.value = clip.speed;

      const gainNode = offlineCtx.createGain();
      gainNode.gain.value = clip.volume;

      sourceNode.connect(gainNode);
      gainNode.connect(offlineCtx.destination);

      const whenInChunk = overlapStart - chunkStart;
      sourceNode.start(whenInChunk, srcOffset, srcDuration);
    }

    const renderedBuffer = await offlineCtx.startRendering();
    const wavBlob = encodeMonoAudioBufferToWav(renderedBuffer);

    chunks.push({
      blob: wavBlob,
      offsetSeconds: Number(chunkStart.toFixed(3)),
      durationSeconds: Number(chunkLen.toFixed(3)),
    });
  }

  return chunks;
}
