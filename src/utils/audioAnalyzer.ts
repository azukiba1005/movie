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

/** Low sample-rate used for waveform analysis (8kHz = ~1/6 memory of 48kHz) */
const ANALYSIS_SAMPLE_RATE = 8000;
/** Above this size, skip arrayBuffer()-based decoding and scan via <video> element instead */
const MAX_DECODE_FILE_BYTES = 1.5 * 1024 * 1024 * 1024;

/**
 * Lightweight, memory-safe audio decoder (8kHz by default).
 * - Stage 1: AudioContext({ sampleRate }) decodeAudioData
 * - Stage 2: OfflineAudioContext(1ch, sampleRate) decodeAudioData
 * - Stage 3: native-rate AudioContext decodeAudioData
 * The file is re-read for each stage because decodeAudioData detaches the ArrayBuffer.
 * Throws if every stage fails (callers fall back to the media-element scan).
 */
async function decodeAudioBufferRobust(
  file: File | Blob,
  sampleRate = ANALYSIS_SAMPLE_RATE
): Promise<AudioBuffer> {
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

  if (file.size === 0) {
    throw new Error('ファイルデータが空です。');
  }
  if (file.size > MAX_DECODE_FILE_BYTES) {
    throw new Error('ファイルが大きすぎるため直接デコードをスキップします。');
  }

  let lastError: unknown = null;

  const attempts: Array<() => Promise<AudioBuffer>> = [];
  if (AudioCtx) {
    attempts.push(async () => {
      const ctx = new AudioCtx({ sampleRate });
      try {
        return await ctx.decodeAudioData(await file.arrayBuffer());
      } finally {
        await ctx.close().catch(() => {});
      }
    });
  }
  if (OfflineCtx) {
    attempts.push(async () => {
      const ctx = new OfflineCtx(1, 1, sampleRate);
      return await ctx.decodeAudioData(await file.arrayBuffer());
    });
  }
  if (AudioCtx) {
    attempts.push(async () => {
      const ctx = new AudioCtx();
      try {
        return await ctx.decodeAudioData(await file.arrayBuffer());
      } finally {
        await ctx.close().catch(() => {});
      }
    });
  }

  for (const attempt of attempts) {
    try {
      const buffer = await attempt();
      if (checkAudioBufferHasSignal(buffer).hasSignal) {
        return buffer;
      }
      lastError = new Error('デコード結果の信号がすべて 0 でした');
    } catch (err) {
      lastError = err;
    }
  }

  const errDetail =
    lastError instanceof Error ? ` (${lastError.message})` : '';
  throw new Error(`音声データをデコードできませんでした${errDetail}`);
}

/**
 * Fallback: scan real loudness via <video> element + MediaElementAudioSourceNode + AnalyserNode.
 * Plays the file silently (the source is NOT connected to the speakers) at 4x speed and
 * records per-window RMS. Needs no arrayBuffer(), so it works for any size/codec the browser can play.
 */
async function scanAudioLevelsViaMediaElement(
  file: File | Blob,
  peaksPerSecond: number,
  onProgress?: (ratio: number) => void
): Promise<{ rawRms: number[]; duration: number; maxSamplePeak: number }> {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('このブラウザは Web Audio API に対応していません。');
  }

  const url = URL.createObjectURL(file);
  const el = document.createElement('video');
  el.preload = 'auto';
  el.src = url;
  el.playsInline = true;

  const ctx = new AudioCtx();
  let timer: number | null = null;

  const cleanup = () => {
    if (timer !== null) window.clearInterval(timer);
    try {
      el.pause();
    } catch {
      /* ignore */
    }
    el.removeAttribute('src');
    el.load();
    ctx.close().catch(() => {});
    URL.revokeObjectURL(url);
  };

  try {
    await new Promise<void>((resolve, reject) => {
      el.onloadedmetadata = () => resolve();
      el.onerror = () => reject(new Error('メディアを読み込めませんでした'));
    });

    const duration = Number.isFinite(el.duration) ? el.duration : 0;
    if (duration <= 0) {
      throw new Error('動画の長さを取得できませんでした');
    }

    const totalWindows = Math.max(1, Math.ceil(duration * peaksPerSecond));
    const rawRms = new Array<number>(totalWindows).fill(0);
    let maxSamplePeak = 0;

    const source = ctx.createMediaElementSource(el);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser); // intentionally not connected to destination (silent)
    const data = new Float32Array(analyser.fftSize);

    await ctx.resume();
    el.playbackRate = 4;
    await el.play();

    await new Promise<void>((resolve, reject) => {
      let lastBin = 0;
      const sample = () => {
        analyser.getFloatTimeDomainData(data);
        let sumSq = 0;
        for (let i = 0; i < data.length; i++) {
          const a = Math.abs(data[i]);
          if (a > maxSamplePeak) maxSamplePeak = a;
          sumSq += a * a;
        }
        const rms = Math.sqrt(sumSq / data.length);
        const bin = Math.min(
          totalWindows - 1,
          Math.floor(el.currentTime * peaksPerSecond)
        );
        for (let b = Math.min(lastBin, bin); b <= bin; b++) {
          if (rms > rawRms[b]) rawRms[b] = rms;
        }
        lastBin = bin;
        onProgress?.(Math.min(1, el.currentTime / duration));
      };
      timer = window.setInterval(sample, 20);
      el.onended = () => resolve();
      el.onerror = () => reject(new Error('再生スキャン中にエラーが発生しました'));
    });

    return { rawRms, duration, maxSamplePeak };
  } finally {
    cleanup();
  }
}

/** Compute per-window RMS (max amplitude across ALL channels at each sample) from an AudioBuffer */
function rmsWindowsFromBuffer(
  audioBuffer: AudioBuffer,
  peaksPerSecond: number
): { rawRms: number[]; maxSamplePeak: number } {
  const duration = audioBuffer.duration;
  const numChannels = audioBuffer.numberOfChannels;
  const totalSamples = audioBuffer.length;
  const totalWindows = Math.max(1, Math.ceil(duration * peaksPerSecond));
  const samplesPerWindow = Math.max(1, Math.floor(totalSamples / totalWindows));

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(audioBuffer.getChannelData(ch));
  }

  const rawRms: number[] = new Array(totalWindows);
  let maxSamplePeak = 0;

  for (let w = 0; w < totalWindows; w++) {
    const startIdx = w * samplesPerWindow;
    const endIdx =
      w === totalWindows - 1
        ? totalSamples
        : Math.min(totalSamples, startIdx + samplesPerWindow);
    const count = Math.max(1, endIdx - startIdx);
    let sumSquares = 0;

    for (let j = startIdx; j < endIdx; j++) {
      let maxCh = 0;
      for (let c = 0; c < numChannels; c++) {
        const abs = Math.abs(channels[c][j]);
        if (abs > maxCh) maxCh = abs;
      }
      if (maxCh > maxSamplePeak) maxSamplePeak = maxCh;
      sumSquares += maxCh * maxCh;
    }
    rawRms[w] = Number(Math.sqrt(sumSquares / count).toFixed(6));
  }

  return { rawRms, maxSamplePeak };
}

/**
 * Build normalized peaks (relative dB, speech reference = 0 dB) and level statistics.
 * Throws if the signal is entirely zero.
 */
function buildWaveformAnalysis(
  rawRms: number[],
  maxSamplePeak: number
): { peaks: number[]; audioStats: AudioLevelStats } {
  const totalWindows = rawRms.length;
  let globalMaxWindowRms = 0;
  let sumAllRms = 0;
  for (const r of rawRms) {
    if (r > globalMaxWindowRms) globalMaxWindowRms = r;
    sumAllRms += r;
  }

  if (maxSamplePeak <= 1e-5 || globalMaxWindowRms <= 1e-6) {
    throw new Error(
      '音声トラックの信号レベルが完全にゼロ（無音）です。動画に音声が入っているか確認してください。'
    );
  }

  const sortedRms = [...rawRms].sort((a, b) => a - b);
  const pick = (q: number) =>
    sortedRms[Math.min(sortedRms.length - 1, Math.floor(sortedRms.length * q))];
  const p98Rms = pick(0.98) || globalMaxWindowRms;
  const p95Rms = pick(0.95) || globalMaxWindowRms;
  const p15Rms = pick(0.15) || 1e-6;
  const meanRms = sumAllRms / totalWindows;

  // 98th percentile window RMS = 0 dB (a single mic pop must not make all speech look tiny)
  const normReferenceRms = Math.max(p98Rms, globalMaxWindowRms * 0.5, 1e-5);
  const appliedGainLinear = 1.0 / normReferenceRms;
  const appliedGainDb = Number((20 * Math.log10(appliedGainLinear)).toFixed(1));

  const peaks: number[] = new Array(totalWindows);
  for (let w = 0; w < totalWindows; w++) {
    peaks[w] = Number(Math.min(1.0, rawRms[w] * appliedGainLinear).toFixed(5));
  }

  const toDb = (amp: number) =>
    Number((20 * Math.log10(Math.max(amp, 1e-5))).toFixed(1));

  const noiseFloorDb = toDb(Math.min(1.0, p15Rms * appliedGainLinear));
  const suggestedThresholdDb = Math.round(
    Math.max(-44, Math.min(-18, (noiseFloorDb - 6) * 0.65))
  );

  return {
    peaks,
    audioStats: {
      rawPeakDb: toDb(maxSamplePeak),
      rawSpeechRmsDb: toDb(p95Rms),
      rawMeanDb: toDb(meanRms),
      noiseFloorDb,
      appliedGainDb,
      suggestedThresholdDb,
    },
  };
}

/**
 * Extract waveform (RMS windows across all channels) + normalized peaks + level stats.
 * Strategy: low-rate (8kHz) decodeAudioData first; if that fails, scan the real loudness via
 * <video> + AnalyserNode. Never returns dummy zero arrays — throws a descriptive error instead.
 * This must be run in the background AFTER the video has been registered.
 */
export async function extractWaveformPeaks(
  file: File | Blob,
  peaksPerSecond = 50,
  onProgress?: (ratio: number, message: string) => void
): Promise<{
  peaks: number[];
  rawRms: number[];
  duration: number;
  sampleRate: number;
  audioStats: AudioLevelStats;
  method: 'decode' | 'media-element';
}> {
  let decodeError: unknown = null;

  try {
    onProgress?.(0.05, '音声をデコード中 (8kHz)...');
    const audioBuffer = await decodeAudioBufferRobust(file);
    const { rawRms, maxSamplePeak } = rmsWindowsFromBuffer(
      audioBuffer,
      peaksPerSecond
    );
    const { peaks, audioStats } = buildWaveformAnalysis(rawRms, maxSamplePeak);
    return {
      peaks,
      rawRms,
      duration: audioBuffer.duration,
      sampleRate: peaksPerSecond,
      audioStats,
      method: 'decode',
    };
  } catch (err) {
    decodeError = err;
  }

  try {
    onProgress?.(0.1, 'デコード失敗: 再生スキャン方式で音量を計測中...');
    const scan = await scanAudioLevelsViaMediaElement(
      file,
      peaksPerSecond,
      (r) =>
        onProgress?.(0.1 + r * 0.9, `再生スキャンで音量を計測中 ${Math.round(r * 100)}%`)
    );
    const { peaks, audioStats } = buildWaveformAnalysis(
      scan.rawRms,
      scan.maxSamplePeak
    );
    return {
      peaks,
      rawRms: scan.rawRms,
      duration: scan.duration,
      sampleRate: peaksPerSecond,
      audioStats,
      method: 'media-element',
    };
  } catch (scanErr) {
    const a = decodeError instanceof Error ? decodeError.message : '';
    const b = scanErr instanceof Error ? scanErr.message : String(scanErr);
    throw new Error(
      `音声の解析に失敗しました（デコード: ${a} / 再生スキャン: ${b}）。映像の再生・編集は可能です。`
    );
  }
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

    if (asset.audioAnalyzing) {
      throw new Error(
        `動画「${asset.name}」の音声を解析中です。完了するまでお待ちください。`
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
    const audioBuf = await decodeAudioBufferRobust(asset.file, 16000);
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
