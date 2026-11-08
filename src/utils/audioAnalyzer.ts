import {
  AudioLevelStats,
  CutInterval,
  MediaAsset,
  SilenceConfig,
  SubtitleItem,
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

/** Voice band (human speech fundamentals) used for silence judgement */
const VOICE_BAND_LOW_HZ = 300;
const VOICE_BAND_HIGH_HZ = 3000;

class Biquad {
  private z1 = 0;
  private z2 = 0;
  constructor(
    private b0: number,
    private b1: number,
    private b2: number,
    private a1: number,
    private a2: number
  ) {}
  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

function makeBiquad(type: 'hp' | 'lp', fs: number, f0: number): Biquad {
  const q = Math.SQRT1_2;
  const w0 = (2 * Math.PI * f0) / fs;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  if (type === 'lp') {
    const b = (1 - cos) / 2 / a0;
    return new Biquad(b, (1 - cos) / a0, b, a1, a2);
  }
  const b = (1 + cos) / 2 / a0;
  return new Biquad(b, -(1 + cos) / a0, b, a1, a2);
}

/**
 * 4th-order Butterworth-like band-pass (2x high-pass @300Hz + 2x low-pass @3kHz).
 * Attenuates desk rumble (<300Hz) and keyboard/mouse-click attack (>3kHz).
 * Time-domain & streaming: can be fed sample by sample (offline decode or live playback scan).
 */
class VoiceBandFilter {
  private stages: Biquad[];
  constructor(sampleRate: number) {
    const hi = Math.min(VOICE_BAND_HIGH_HZ, sampleRate * 0.45);
    const lo = Math.min(VOICE_BAND_LOW_HZ, hi * 0.5);
    this.stages = [
      makeBiquad('hp', sampleRate, lo),
      makeBiquad('hp', sampleRate, lo),
      makeBiquad('lp', sampleRate, hi),
      makeBiquad('lp', sampleRate, hi),
    ];
  }
  process(x: number): number {
    let v = x;
    for (let i = 0; i < this.stages.length; i++) v = this.stages[i].process(v);
    return v;
  }
}

type RawLevels = {
  rawRms: number[];
  /** Voice-band (300–3000Hz) RMS windows, same length as rawRms */
  voiceRms: number[];
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
): { rawRms: number[]; voiceRms: number[]; maxSamplePeak: number } {
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
  const voiceRms: number[] = new Array(totalWindows);
  let maxSamplePeak = 0;
  const filters = channels.map(() => new VoiceBandFilter(audioBuffer.sampleRate));

  for (let w = 0; w < totalWindows; w++) {
    const startIdx = w * samplesPerWindow;
    const endIdx =
      w === totalWindows - 1
        ? totalSamples
        : Math.min(totalSamples, startIdx + samplesPerWindow);
    const count = Math.max(1, endIdx - startIdx);
    let sumSquares = 0;
    let sumSquaresVoice = 0;

    for (let j = startIdx; j < endIdx; j++) {
      let maxCh = 0;
      let maxVoice = 0;
      for (let c = 0; c < numChannels; c++) {
        const x = channels[c][j];
        const abs = Math.abs(x);
        if (abs > maxCh) maxCh = abs;
        const fv = Math.abs(filters[c].process(x));
        if (fv > maxVoice) maxVoice = fv;
      }
      if (maxCh > maxSamplePeak) maxSamplePeak = maxCh;
      sumSquares += maxCh * maxCh;
      sumSquaresVoice += maxVoice * maxVoice;
    }
    rawRms[w] = Number(Math.sqrt(sumSquares / count).toFixed(6));
    voiceRms[w] = Number(Math.sqrt(sumSquaresVoice / count).toFixed(6));
  }

  return { rawRms, voiceRms, maxSamplePeak };
}

/** Stage 1: decodeAudioData with the default AudioContext, then downsample to RMS windows */
async function levelsViaDecode(
  file: File | Blob,
  peaksPerSecond: number
): Promise<RawLevels> {
  const buffer = await decodeAudioBufferNative(file);
  const duration = buffer.duration;
  const { rawRms, voiceRms, maxSamplePeak } = rmsWindowsFromBuffer(
    buffer,
    peaksPerSecond
  );
  if (maxSamplePeak < ZERO_PEAK_EPSILON) {
    throw new Error('デコード結果の信号がすべて 0 でした');
  }
  return { rawRms, voiceRms, maxSamplePeak, duration };
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
    const voiceRms = new Array<number>(totalWindows).fill(0);
    let maxSamplePeak = 0;
    let lastTime = 0;
    const scanFilters: VoiceBandFilter[] = [];
    let mAll = new Float32Array(0);
    let mVoice = new Float32Array(0);

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

      // Per-sample peak across channels: full band + voice band (filters keep state across blocks)
      while (scanFilters.length < nch) scanFilters.push(new VoiceBandFilter(ctx.sampleRate));
      if (mAll.length < n) {
        mAll = new Float32Array(n);
        mVoice = new Float32Array(n);
      }
      for (let i = 0; i < n; i++) {
        let m = 0;
        let mv = 0;
        for (let c = 0; c < nch; c++) {
          const x = chans[c][i];
          const a = Math.abs(x);
          if (a > m) m = a;
          const fv = Math.abs(scanFilters[c].process(x));
          if (fv > mv) mv = fv;
        }
        mAll[i] = m;
        mVoice[i] = mv;
      }

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
        let sumSqV = 0;
        for (let i = start; i < end && i < n; i++) {
          const m = mAll[i];
          if (m > maxSamplePeak) maxSamplePeak = m;
          sumSq += m * m;
          sumSqV += mVoice[i] * mVoice[i];
        }
        const rms = Math.sqrt(sumSq / Math.max(1, end - start));
        const rmsV = Math.sqrt(sumSqV / Math.max(1, end - start));
        const bin = forward ? b0 + s : b1;
        if (rms > rawRms[bin]) rawRms[bin] = rms;
        if (rmsV > voiceRms[bin]) voiceRms[bin] = rmsV;
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

    return { rawRms, voiceRms, maxSamplePeak, duration };
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
  /** Voice-band (300–3000Hz) raw RMS windows */
  voiceRms: number[];
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
        voiceRms: levels.voiceRms,
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
 * Normalize a raw RMS envelope so the 98th percentile window sits at 0 dB
 * (same rule as the full-band waveformPeaks). Cached per array instance.
 */
const normalizedEnvelopeCache = new WeakMap<number[], number[]>();
function normalizeEnvelope(raw: number[]): number[] {
  const cached = normalizedEnvelopeCache.get(raw);
  if (cached) return cached;
  let max = 0;
  for (const v of raw) if (v > max) max = v;
  const sorted = Float32Array.from(raw).sort();
  const p98 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))] || max;
  const ref = Math.max(p98, max * 0.5, 1e-5);
  const out = raw.map((v) => Math.min(1, v / ref));
  normalizedEnvelopeCache.set(raw, out);
  return out;
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
  const minSpeechSec = Math.max(0, (config.minSpeechDurationMs ?? 150) / 1000);

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

    // Prefer the voice-band (300–3000Hz) envelope: keyboard clicks / desk thumps are attenuated
    const voiceRaw =
      config.useVoiceBandFilter !== false &&
      asset.voiceBandRms &&
      asset.voiceBandRms.length > 0
        ? asset.voiceBandRms
        : null;
    const sourceArray = voiceRaw
      ? useNormalized
        ? normalizeEnvelope(voiceRaw)
        : voiceRaw
      : !useNormalized &&
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
          }dB${useNormalized ? ' 正規化基準' : ' Raw dBFS'}${
            voiceRaw ? ' / 声帯域300-3000Hz' : ''
          }${minSpeechSec > 0 ? ` / ${Math.round(minSpeechSec * 1000)}ms未満の短音は無視` : ''})`,
          selected: true,
        });
      }
    };

    // Step 1: provisional voiced / silent decision per window by threshold
    const winCount = Math.max(0, endPeakIdx - startPeakIdx + 1);
    const silent: boolean[] = new Array(winCount);
    for (let i = startPeakIdx; i <= endPeakIdx; i++) {
      // 3-point local RMS smoothing (prevents 20ms zero-crossings in speech from splitting)
      const prev = sourceArray[Math.max(startPeakIdx, i - 1)] ?? 0;
      const curr = sourceArray[i] ?? 0;
      const next = sourceArray[Math.min(endPeakIdx, i + 1)] ?? 0;
      const smoothedRms = Math.max(curr, (prev + curr + next) / 3) * dynamicGain;

      // Convert linear RMS to dB: 20 * log10(rms)
      const currentDb =
        smoothedRms <= 1e-6 ? -100 : 20 * Math.log10(smoothedRms);
      silent[i - startPeakIdx] = currentDb < config.thresholdDb;
    }

    // Step 2: de-glitch — voiced runs shorter than minSpeechDurationMs (keyboard clicks, coughs,
    // mic pops) are not speech: absorb them into silence.
    const minSpeechWindows = Math.round(minSpeechSec * rate);
    if (minSpeechWindows > 1) {
      let runStart = -1;
      for (let k = 0; k <= winCount; k++) {
        const voiced = k < winCount && !silent[k];
        if (voiced && runStart === -1) {
          runStart = k;
        } else if (!voiced && runStart !== -1) {
          if (k - runStart < minSpeechWindows) {
            for (let q = runStart; q < k; q++) silent[q] = true;
          }
          runStart = -1;
        }
      }
    }

    // Step 3: silent runs -> candidates (minSilenceDuration is enforced in recordSilentSegment)
    let silentStartPeak: number | null = null;
    for (let k = 0; k <= winCount; k++) {
      const isSilent = k < winCount && silent[k];
      if (isSilent && silentStartPeak === null) {
        silentStartPeak = k;
      } else if (!isSilent && silentStartPeak !== null) {
        recordSilentSegment(startPeakIdx + silentStartPeak, startPeakIdx + k);
        silentStartPeak = null;
      }
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
    const firstAsset = mediaAssets.find(
      (m) => m.type === 'video' && videoClips.some((c) => c.mediaId === m.id)
    );
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
 * Transcript-linked non-speech noise detection (coughs, keyboard, rustling):
 * finds regions where the waveform is above the threshold while NO subtitle (speech text)
 * covers the time. Returns `type: 'noise'` cut candidates.
 * Uses the full-band normalized envelope (coughs / typing are broadband and must be seen).
 */
export function detectNoiseOutsideSubtitles(
  videoClips: VideoClip[],
  mediaAssets: MediaAsset[],
  subtitles: SubtitleItem[],
  config: SilenceConfig,
  existingSilence: CutInterval[] = []
): CutInterval[] {
  if (subtitles.length === 0) return [];

  const SUB_MARGIN = 0.12; // speech margin around each subtitle (s)
  const MIN_NOISE_SEC = 0.12;
  const MERGE_GAP_SEC = 0.12;
  const EDGE_EXTEND = 0.06;

  // Merged speech coverage on the timeline
  const speech: Array<{ s: number; e: number }> = [];
  for (const sub of [...subtitles].sort((a, b) => a.startTime - b.startTime)) {
    const s0 = sub.startTime - SUB_MARGIN;
    const e0 = sub.endTime + SUB_MARGIN;
    const last = speech[speech.length - 1];
    if (last && s0 <= last.e) last.e = Math.max(last.e, e0);
    else speech.push({ s: s0, e: e0 });
  }
  const isCovered = (t: number) => speech.some((r) => t >= r.s && t < r.e);
  const nextSpeechStart = (t: number) =>
    speech.find((r) => r.s > t)?.s ?? Infinity;
  const prevSpeechEnd = (t: number) => {
    let v = -Infinity;
    for (const r of speech) if (r.e <= t) v = r.e;
    return v;
  };

  const useNormalized = config.autoNormalize !== false;
  const out: CutInterval[] = [];
  let counter = 0;

  for (const clip of videoClips) {
    const asset = mediaAssets.find((m) => m.id === clip.mediaId);
    if (!asset || asset.audioAnalyzing || asset.audioDecodeError) continue;
    const arr =
      !useNormalized && asset.rawWaveformRms && asset.rawWaveformRms.length > 0
        ? asset.rawWaveformRms
        : asset.waveformPeaks;
    if (!arr || arr.length === 0) continue;
    const rate = asset.waveformSampleRate || 50;
    const i0 = Math.max(0, Math.floor(clip.sourceStart * rate));
    const i1 = Math.min(arr.length - 1, Math.ceil(clip.sourceEnd * rate) - 1);
    const toTimeline = (srcSec: number) =>
      clip.startTime + (srcSec - clip.sourceStart) / clip.speed;

    let runStart = -1;
    const flush = (endIdx: number) => {
      // [runStart, endIdx) windows
      let start = toTimeline(Math.max(clip.sourceStart, runStart / rate));
      let end = toTimeline(Math.min(clip.sourceEnd, endIdx / rate));
      if (end - start < MIN_NOISE_SEC) return;
      // Extend a little to catch the decay tail, but never into speech
      start = Math.max(start - EDGE_EXTEND, prevSpeechEnd(start), clip.startTime);
      end = Math.min(
        end + EDGE_EXTEND,
        nextSpeechStart(end),
        clip.startTime + clip.duration
      );
      if (end - start < MIN_NOISE_SEC) return;
      // Skip when already fully inside a silence candidate
      if (existingSilence.some((c) => start >= c.start - 0.02 && end <= c.end + 0.02)) {
        return;
      }
      out.push({
        id: `noise-${counter++}-${Math.round(start * 1000)}`,
        start: Number(start.toFixed(3)),
        end: Number(end.toFixed(3)),
        type: 'noise',
        category: 'noise',
        reason: `[ノイズ/咳・打鍵音] 字幕のない時間帯に ${config.thresholdDb}dB 超の音 (${(
          end - start
        ).toFixed(2)}s)`,
        selected: true,
      });
    };

    let quietGap = 0;
    for (let i = i0; i <= i1 + 1; i++) {
      let loud = false;
      if (i <= i1) {
        const v = arr[i] ?? 0;
        const db = v <= 1e-6 ? -100 : 20 * Math.log10(v);
        const t = toTimeline(i / rate + 0.5 / rate);
        loud = db >= config.thresholdDb && !isCovered(t);
      }
      if (loud) {
        if (runStart === -1) runStart = i;
        quietGap = 0;
      } else if (runStart !== -1) {
        quietGap++;
        if (quietGap >= Math.max(1, Math.round(MERGE_GAP_SEC * rate)) || i > i1) {
          flush(i - quietGap + 1);
          runStart = -1;
          quietGap = 0;
        }
      }
    }
  }

  return out.sort((a, b) => a.start - b.start);
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


/**
 * Convert an RMS envelope slice into a zero-mean, unit-variance "feature" signal that is robust
 * against gain / mic differences between two cameras (sqrt compression + 1s moving-average removal).
 */
function envelopeToSyncFeature(
  env: ArrayLike<number>,
  rate: number,
  maxSeconds: number
): Float32Array {
  const n = Math.min(env.length, Math.floor(maxSeconds * rate));
  const comp = new Float32Array(n);
  for (let i = 0; i < n; i++) comp[i] = Math.sqrt(Math.max(0, env[i] ?? 0));

  const half = Math.max(1, Math.round(rate * 0.5));
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + comp[i];

  const out = new Float32Array(n);
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    const mean = (prefix[b] - prefix[a]) / (b - a);
    out[i] = comp[i] - mean;
    sumSq += out[i] * out[i];
  }
  const std = Math.sqrt(sumSq / Math.max(1, n)) || 1;
  for (let i = 0; i < n; i++) out[i] /= std;
  return out;
}

export interface Cam2SyncResult {
  /** cam2 media time = cam1 media time + offsetSec */
  offsetSec: number;
  /** Normalized cross-correlation at the peak (0..1) */
  confidence: number;
}

/**
 * Estimate the time offset between Cam 1 and Cam 2 by cross-correlating the audio loudness
 * envelopes (RMS windows) of the first `analyzeSeconds` of each recording.
 * Returned `offsetSec` is sub-window precise (parabolic peak interpolation).
 * Positive offset: the same sound happens LATER in the Cam 2 file than in the Cam 1 file.
 */
export function estimateCam2Offset(
  cam1: MediaAsset,
  cam2: MediaAsset,
  analyzeSeconds = 120,
  maxLagSeconds = 90
): Cam2SyncResult {
  const pickEnv = (a: MediaAsset) =>
    a.rawWaveformRms && a.rawWaveformRms.length > 0
      ? a.rawWaveformRms
      : a.waveformPeaks;

  for (const a of [cam1, cam2]) {
    if (a.audioAnalyzing) {
      throw new Error(`「${a.name}」の音声を解析中です。完了するまでお待ちください。`);
    }
    if (!pickEnv(a) || pickEnv(a).length === 0) {
      throw new Error(
        `「${a.name}」の音声波形がありません。音声が無い、または解析に失敗しています。`
      );
    }
  }

  const rate1 = cam1.waveformSampleRate || 50;
  const rate2 = cam2.waveformSampleRate || 50;
  if (Math.abs(rate1 - rate2) > 1e-6) {
    throw new Error('2つの動画の波形サンプルレートが異なります。波形を再解析してください。');
  }
  const rate = rate1;

  const fa = envelopeToSyncFeature(pickEnv(cam1), rate, analyzeSeconds);
  const fb = envelopeToSyncFeature(pickEnv(cam2), rate, analyzeSeconds);
  const na = fa.length;
  const nb = fb.length;
  const minOverlap = Math.floor(Math.min(20, analyzeSeconds / 4) * rate);
  if (na < minOverlap || nb < minOverlap) {
    throw new Error('同期に使える音声が短すぎます（最低でも約20秒必要です）。');
  }

  const maxLag = Math.floor(maxLagSeconds * rate);
  const lagMin = -Math.min(maxLag, na - minOverlap);
  const lagMax = Math.min(maxLag, nb - minOverlap);
  const scores = new Float32Array(lagMax - lagMin + 1);

  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let k = lagMin; k <= lagMax; k++) {
    // cam2[i + k] ~ cam1[i]
    const i0 = Math.max(0, -k);
    const i1 = Math.min(na, nb - k);
    const overlap = i1 - i0;
    if (overlap < minOverlap) {
      scores[k - lagMin] = -1;
      continue;
    }
    let dot = 0;
    let sa = 0;
    let sb = 0;
    for (let i = i0; i < i1; i++) {
      const x = fa[i];
      const y = fb[i + k];
      dot += x * y;
      sa += x * x;
      sb += y * y;
    }
    const score = dot / (Math.sqrt(sa * sb) || 1);
    scores[k - lagMin] = score;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = k - lagMin;
    }
  }

  if (!Number.isFinite(bestScore) || bestScore < 0.12) {
    throw new Error(
      '音声の一致を検出できませんでした（相関が低すぎます）。両カメラに同じ音が録音されているか確認し、手動で調整してください。'
    );
  }

  // Parabolic interpolation around the peak for sub-window precision
  let delta = 0;
  if (bestIdx > 0 && bestIdx < scores.length - 1) {
    const y0 = scores[bestIdx - 1];
    const y1 = scores[bestIdx];
    const y2 = scores[bestIdx + 1];
    const denom = y0 - 2 * y1 + y2;
    if (Math.abs(denom) > 1e-9) {
      delta = Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom));
    }
  }

  const lag = lagMin + bestIdx + delta;
  return {
    offsetSec: Number((lag / rate).toFixed(3)) + 0,
    confidence: Number(Math.max(0, Math.min(1, bestScore)).toFixed(3)),
  };
}
