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

/** Above this size, skip arrayBuffer()-based decoding and go straight to the <video> scan */
const MAX_DECODE_FILE_BYTES = 1.5 * 1024 * 1024 * 1024;
/** Peak below this is treated as "all zero" (decode/scan silently failed) */
const ZERO_PEAK_EPSILON = 1e-5;

type RawLevels = {
  rawRms: number[];
  maxSamplePeak: number;
  duration: number;
};

function getAudioContextCtor(): typeof AudioContext | undefined {
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  );
}

/**
 * Decode with the DEFAULT AudioContext (native 44.1k/48k — a forced low sampleRate can return
 * an all-zero buffer on some browsers/codecs). Callers downsample to RMS windows immediately
 * so the huge AudioBuffer can be garbage collected.
 */
async function decodeAudioBufferNative(file: File | Blob): Promise<AudioBuffer> {
  const AudioCtx = getAudioContextCtor();
  if (!AudioCtx) {
    throw new Error('このブラウザは Web Audio API に対応していません。');
  }
  if (file.size === 0) {
    throw new Error('ファイルデータが空です。');
  }
  if (file.size > MAX_DECODE_FILE_BYTES) {
    throw new Error('ファイルが大きすぎるため直接デコードをスキップします。');
  }
  const ctx = new AudioCtx();
  try {
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }
    return await ctx.decodeAudioData(await file.arrayBuffer());
  } finally {
    await ctx.close().catch(() => {});
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

/** Stage 1: decodeAudioData with the default AudioContext, then downsample to RMS windows */
async function levelsViaDecode(
  file: File | Blob,
  peaksPerSecond: number
): Promise<RawLevels> {
  const buffer = await decodeAudioBufferNative(file);
  const duration = buffer.duration;
  const { rawRms, maxSamplePeak } = rmsWindowsFromBuffer(buffer, peaksPerSecond);
  if (maxSamplePeak < ZERO_PEAK_EPSILON) {
    throw new Error('デコード結果の信号がすべて 0 でした');
  }
  return { rawRms, maxSamplePeak, duration };
}

type MediaScanMode = 'element' | 'capture';

/**
 * Stage 2 / 3: play the file in a <video> element and measure real loudness.
 *  - 'element': MediaElementAudioSourceNode (element muted=false, volume=1; silenced by an output
 *    GainNode(0) so nothing is audible). Multiple audioTracks are all enabled when supported.
 *  - 'capture': video.captureStream()/mozCaptureStream() -> MediaStreamAudioSourceNode.
 * Every audio block is mapped onto RMS windows using el.currentTime, so nothing is skipped
 * even at high playback rates.
 */
async function levelsViaMediaPlayback(
  file: File | Blob,
  peaksPerSecond: number,
  mode: MediaScanMode,
  onProgress?: (ratio: number) => void
): Promise<RawLevels> {
  const AudioCtx = getAudioContextCtor();
  if (!AudioCtx) {
    throw new Error('このブラウザは Web Audio API に対応していません。');
  }

  const url = URL.createObjectURL(file);
  const el = document.createElement('video');
  el.preload = 'auto';
  el.playsInline = true;
  el.style.cssText =
    'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
  // 'element' mode MUST keep the element unmuted (muted => Web Audio receives zeros).
  // 'capture' mode: mute the element so the user never hears it (capture is taken from the stream).
  el.muted = mode === 'capture';
  el.volume = 1.0;
  el.src = url;
  document.body.appendChild(el);

  const ctx = new AudioCtx();
  let watchdog: number | null = null;
  let processor: ScriptProcessorNode | null = null;

  const cleanup = () => {
    if (watchdog !== null) window.clearInterval(watchdog);
    if (processor) {
      processor.onaudioprocess = null;
      try {
        processor.disconnect();
      } catch {
        /* ignore */
      }
    }
    try {
      el.pause();
    } catch {
      /* ignore */
    }
    el.removeAttribute('src');
    el.load();
    el.remove();
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

    // Enable every audio track (OBS multi-track MP4: mic may live in track 2+)
    const tracks = (
      el as unknown as {
        audioTracks?: { length: number; [i: number]: { enabled: boolean } };
      }
    ).audioTracks;
    if (tracks && tracks.length > 0) {
      for (let i = 0; i < tracks.length; i++) {
        tracks[i].enabled = true;
      }
    }

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const totalWindows = Math.max(1, Math.ceil(duration * peaksPerSecond));
    const rawRms = new Array<number>(totalWindows).fill(0);
    let maxSamplePeak = 0;
    let lastTime = 0;

    processor = ctx.createScriptProcessor(1024, 2, 1);
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0; // inaudible, but keeps the graph (and onaudioprocess) alive
    processor.connect(silentGain);
    silentGain.connect(ctx.destination);

    processor.onaudioprocess = (ev) => {
      const input = ev.inputBuffer;
      const n = input.length;
      const nch = input.numberOfChannels;
      const chans: Float32Array[] = [];
      for (let c = 0; c < nch; c++) chans.push(input.getChannelData(c));

      const t1 = el.currentTime;
      const t0 = lastTime;
      lastTime = t1;
      const b0 = Math.min(totalWindows - 1, Math.max(0, Math.floor(t0 * peaksPerSecond)));
      const b1 = Math.min(totalWindows - 1, Math.max(0, Math.floor(t1 * peaksPerSecond)));
      const forward = b1 >= b0;
      const segs = forward ? b1 - b0 + 1 : 1;

      for (let s = 0; s < segs; s++) {
        const start = Math.floor((s * n) / segs);
        const end = Math.max(start + 1, Math.floor(((s + 1) * n) / segs));
        let sumSq = 0;
        for (let i = start; i < end && i < n; i++) {
          let m = 0;
          for (let c = 0; c < nch; c++) {
            const a = Math.abs(chans[c][i]);
            if (a > m) m = a;
          }
          if (m > maxSamplePeak) maxSamplePeak = m;
          sumSq += m * m;
        }
        const rms = Math.sqrt(sumSq / Math.max(1, end - start));
        const bin = forward ? b0 + s : b1;
        if (rms > rawRms[bin]) rawRms[bin] = rms;
      }
      onProgress?.(Math.min(1, t1 / duration));
    };

    // Playback rate: fast but still reliably decoded/audible to the audio graph
    try {
      el.playbackRate = mode === 'capture' ? 4 : 8;
    } catch {
      el.playbackRate = 4;
    }

    try {
      await el.play();
    } catch {
      throw new Error('動画の再生スキャンを開始できませんでした（自動再生制限）');
    }

    if (mode === 'element') {
      const source = ctx.createMediaElementSource(el);
      source.connect(processor);
    } else {
      const capEl = el as unknown as {
        captureStream?: () => MediaStream;
        mozCaptureStream?: () => MediaStream;
      };
      const stream = capEl.captureStream?.() ?? capEl.mozCaptureStream?.();
      if (!stream) {
        throw new Error('このブラウザは captureStream に対応していません');
      }
      // Audio tracks may appear shortly after playback starts
      for (let i = 0; i < 30 && stream.getAudioTracks().length === 0; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (stream.getAudioTracks().length === 0) {
        throw new Error('captureStream に音声トラックがありません');
      }
      ctx.createMediaStreamSource(stream).connect(processor);
    }

    await new Promise<void>((resolve, reject) => {
      let lastProgressAt = Date.now();
      let lastSeen = -1;
      watchdog = window.setInterval(() => {
        if (el.currentTime !== lastSeen) {
          lastSeen = el.currentTime;
          lastProgressAt = Date.now();
        } else if (Date.now() - lastProgressAt > 20000) {
          reject(new Error('再生スキャンが停止しました'));
        }
        if (el.currentTime >= duration - 0.05) resolve();
      }, 500);
      el.onended = () => resolve();
      el.onerror = () => reject(new Error('再生スキャン中にエラーが発生しました'));
    });

    return { rawRms, maxSamplePeak, duration };
  } finally {
    cleanup();
  }
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

  if (maxSamplePeak < ZERO_PEAK_EPSILON || globalMaxWindowRms <= 1e-6) {
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
 * Three-stage strategy — a stage counts as failed (and the next one runs) if it throws OR if the
 * resulting maxPeak is < 1e-5:
 *   1. decodeAudioData with the default AudioContext (+ immediate downsampling)
 *   2. <video> playback scan: unmuted element -> AnalyserNode path -> GainNode(0) -> destination
 *   3. video.captureStream() -> MediaStreamAudioSourceNode
 * Never returns dummy zero arrays — throws a descriptive error instead.
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
  method: 'decode' | 'media-element' | 'capture-stream';
}> {
  const stages: Array<{
    method: 'decode' | 'media-element' | 'capture-stream';
    label: string;
    run: () => Promise<RawLevels>;
  }> = [
    {
      method: 'decode',
      label: 'デコード',
      run: async () => {
        onProgress?.(0.05, '音声をデコード中...');
        return levelsViaDecode(file, peaksPerSecond);
      },
    },
    {
      method: 'media-element',
      label: '再生スキャン',
      run: () =>
        levelsViaMediaPlayback(file, peaksPerSecond, 'element', (r) =>
          onProgress?.(
            0.1 + r * 0.9,
            `再生スキャンで音量を計測中 ${Math.round(r * 100)}%`
          )
        ),
    },
    {
      method: 'capture-stream',
      label: 'captureStream',
      run: () =>
        levelsViaMediaPlayback(file, peaksPerSecond, 'capture', (r) =>
          onProgress?.(
            0.1 + r * 0.9,
            `captureStream で音量を計測中 ${Math.round(r * 100)}%`
          )
        ),
    },
  ];

  const errors: string[] = [];

  for (const stage of stages) {
    try {
      const levels = await stage.run();
      const { peaks, audioStats } = buildWaveformAnalysis(
        levels.rawRms,
        levels.maxSamplePeak
      );
      return {
        peaks,
        rawRms: levels.rawRms,
        duration: levels.duration,
        sampleRate: peaksPerSecond,
        audioStats,
        method: stage.method,
      };
    } catch (err) {
      errors.push(
        `${stage.label}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  throw new Error(
    `音声の解析に失敗しました（${errors.join(' / ')}）。映像の再生・編集は可能です。`
  );
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
    const audioBuf = await decodeAudioBufferNative(asset.file);
    if (!checkAudioBufferHasSignal(audioBuf).hasSignal) {
      throw new Error(
        `「${asset.name}」の音声をデコードできませんでした（信号が 0）。先に「波形再解析」を実行してください。`
      );
    }
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
