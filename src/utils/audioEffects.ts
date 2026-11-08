import {
  AudioEffectsSettings,
  AudioEffectPreset,
  AudioLevelStats,
  MediaAsset,
  VideoClip,
} from '../types/editor';

export const DEFAULT_AUDIO_EFFECTS: AudioEffectsSettings = {
  compressorEnabled: false,
  preset: 'youtube_voice',
  threshold: -24,
  ratio: 4,
  knee: 12,
  attack: 0.003,
  release: 0.25,
  makeupGain: 6,
  autoMakeup: false,
  voiceClarityEq: true,
};

type PresetValues = Omit<AudioEffectsSettings, 'compressorEnabled' | 'preset'>;

export const AUDIO_EFFECT_PRESETS: Record<
  Exclude<AudioEffectPreset, 'custom'>,
  { label: string; description: string; values: PresetValues }
> = {
  youtube_voice: {
    label: '標準トーク（YouTube最適）',
    description: '実況・トーク向けの標準的な圧縮',
    values: {
      threshold: -24,
      ratio: 4,
      knee: 12,
      attack: 0.003,
      release: 0.25,
      makeupGain: 6,
      autoMakeup: false,
      voiceClarityEq: true,
    },
  },
  strong_leveler: {
    label: '強め均一化',
    description: '小声〜大声の差を強力に無くす',
    values: {
      threshold: -32,
      ratio: 8,
      knee: 8,
      attack: 0.002,
      release: 0.18,
      makeupGain: 10,
      autoMakeup: true,
      voiceClarityEq: true,
    },
  },
  soft: {
    label: 'ナチュラル',
    description: '自然な軽い圧縮',
    values: {
      threshold: -20,
      ratio: 2.5,
      knee: 20,
      attack: 0.01,
      release: 0.35,
      makeupGain: 3,
      autoMakeup: false,
      voiceClarityEq: false,
    },
  },
};

export const dbToGain = (db: number) => Math.pow(10, db / 20);

/** Live gain reduction (dB, <= 0) written by the preview player, read by the inspector meter */
export const gainReductionMeter = { valueDb: 0 };

/** Static compression curve (WebAudio DynamicsCompressor: soft knee) — output dB for input dB */
export function compressorStaticCurveDb(
  inDb: number,
  threshold: number,
  ratio: number,
  knee: number
): number {
  const r = Math.max(1, ratio);
  const k = Math.max(0, knee);
  if (k > 0 && inDb > threshold - k / 2 && inDb < threshold + k / 2) {
    const x = inDb - threshold + k / 2;
    return inDb + ((1 / r - 1) * x * x) / (2 * k);
  }
  if (inDb <= threshold - k / 2) return inDb;
  return threshold + (inDb - threshold) / r;
}

/**
 * WebAudio's DynamicsCompressorNode applies its OWN automatic makeup gain
 * (1 / curve(0 dB))^0.6. We cancel it so the UI makeup value is the real extra gain.
 */
export function builtInMakeupDb(
  threshold: number,
  ratio: number,
  knee: number
): number {
  return -0.6 * compressorStaticCurveDb(0, threshold, ratio, knee);
}

const LIMITER = { threshold: -1, ratio: 20, knee: 0, attack: 0.001, release: 0.05 };
const TARGET_SPEECH_RMS_DB = -16; // ≈ -14 LUFS for speech
const TARGET_PEAK_DB = -2;
const LIMITER_ALLOWANCE_DB = 3; // brief peaks may be caught by the safety limiter

/** Auto makeup (dB) from the analysed level stats; null when no stats are available */
export function computeAutoMakeupDb(
  fx: AudioEffectsSettings,
  stats?: AudioLevelStats | null
): number | null {
  if (!stats) return null;
  const speechOut = compressorStaticCurveDb(
    stats.rawSpeechRmsDb,
    fx.threshold,
    fx.ratio,
    fx.knee
  );
  const peakOut = compressorStaticCurveDb(
    stats.rawPeakDb,
    fx.threshold,
    fx.ratio,
    fx.knee
  );
  const gain = Math.min(
    TARGET_SPEECH_RMS_DB - speechOut,
    TARGET_PEAK_DB - peakOut + LIMITER_ALLOWANCE_DB
  );
  return Number(Math.max(0, Math.min(24, gain)).toFixed(1));
}

/** Level stats of the master audio (first main-camera clip's media; Cam 2 is never used) */
export function getMasterAudioStats(
  videoClips: VideoClip[],
  mediaAssets: MediaAsset[],
  cam2MediaId?: string | null
): AudioLevelStats | null {
  for (const clip of videoClips) {
    if (clip.mediaId === cam2MediaId) continue;
    const a = mediaAssets.find((m) => m.id === clip.mediaId);
    if (a?.audioStats) return a.audioStats;
  }
  return null;
}

/** Effective makeup in dB (auto if enabled and stats exist, else manual) */
export function resolveMakeupDb(
  fx: AudioEffectsSettings,
  stats?: AudioLevelStats | null
): number {
  if (fx.autoMakeup) {
    const auto = computeAutoMakeupDb(fx, stats);
    if (auto !== null) return auto;
  }
  return fx.makeupGain;
}

export interface EffectChain {
  input: AudioNode;
  output: AudioNode;
  compressor: DynamicsCompressorNode;
  /** Apply settings. smooth=true ramps params (realtime), false assigns directly (offline) */
  update: (fx: AudioEffectsSettings, makeupDb: number, smooth: boolean) => void;
}

/**
 * Shared graph used by BOTH realtime preview and offline export:
 *   input -> HighPass(100Hz) -> Presence(+3dB @3kHz) -> Compressor -> MakeupGain -> Limiter -> output
 */
export function createEffectChain(
  ctx: BaseAudioContext,
  fx: AudioEffectsSettings,
  makeupDb: number
): EffectChain {
  const input = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.Q.value = Math.SQRT1_2;
  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 3000;
  presence.Q.value = 1.0;
  const compressor = ctx.createDynamicsCompressor();
  const makeup = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = LIMITER.threshold;
  limiter.knee.value = LIMITER.knee;
  limiter.ratio.value = LIMITER.ratio;
  limiter.attack.value = LIMITER.attack;
  limiter.release.value = LIMITER.release;

  input.connect(hp);
  hp.connect(presence);
  presence.connect(compressor);
  compressor.connect(makeup);
  makeup.connect(limiter);

  const limiterBuiltIn = builtInMakeupDb(
    LIMITER.threshold,
    LIMITER.ratio,
    LIMITER.knee
  );

  const set = (
    param: AudioParam,
    value: number,
    smooth: boolean,
    tc = 0.03
  ) => {
    if (smooth) param.setTargetAtTime(value, ctx.currentTime, tc);
    else param.value = value;
  };

  const update = (s: AudioEffectsSettings, mkDb: number, smooth: boolean) => {
    set(hp.frequency, s.voiceClarityEq ? 100 : 10, smooth);
    set(presence.gain, s.voiceClarityEq ? 3 : 0, smooth);
    set(compressor.threshold, s.threshold, smooth);
    set(compressor.ratio, s.ratio, smooth);
    set(compressor.knee, s.knee, smooth);
    set(compressor.attack, s.attack, smooth);
    set(compressor.release, s.release, smooth);
    const compBuiltIn = builtInMakeupDb(s.threshold, s.ratio, s.knee);
    set(
      makeup.gain,
      dbToGain(mkDb - compBuiltIn - limiterBuiltIn),
      smooth
    );
  };

  update(fx, makeupDb, false);
  return { input, output: limiter, compressor, update };
}
