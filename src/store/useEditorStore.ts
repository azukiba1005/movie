import { create } from 'zustand';
import {
  ActiveTool,
  AudioEffectPreset,
  AudioEffectsSettings,
  AspectRatioType,
  BgmClip,
  CustomFontAsset,
  CutInterval,
  EditorHistorySnapshot,
  InspectorTab,
  LeftPanelTab,
  MediaAsset,
  SilenceConfig,
  SubtitleItem,
  SubtitleStyle,
  VideoClip,
} from '../types/editor';

import {
  AUDIO_EFFECT_PRESETS,
  DEFAULT_AUDIO_EFFECTS,
} from '../utils/audioEffects';

export type SilencePresetId = 'mild' | 'standard' | 'jet';

/** One-touch silence-cut presets (default: mild = natural conversation, tail protection) */
export const SILENCE_PRESETS: Record<
  SilencePresetId,
  { label: string; description: string; values: Partial<SilenceConfig> }
> = {
  mild: {
    label: 'マイルド',
    description: '自然な会話・語尾保護',
    values: {
      thresholdDb: -38,
      minSilenceDurationMs: 650,
      paddingMs: 220,
      paddingBeforeMs: 180,
      paddingAfterMs: 250,
      minSpeechDurationMs: 80,
    },
  },
  standard: {
    label: '標準',
    description: 'バランス重視',
    values: {
      thresholdDb: -32,
      minSilenceDurationMs: 400,
      paddingMs: 120,
      paddingBeforeMs: 100,
      paddingAfterMs: 150,
      minSpeechDurationMs: 120,
    },
  },
  jet: {
    label: 'ジェットカット',
    description: 'テンポ重視',
    values: {
      thresholdDb: -28,
      minSilenceDurationMs: 250,
      paddingMs: 70,
      paddingBeforeMs: 60,
      paddingAfterMs: 90,
      minSpeechDurationMs: 150,
    },
  },
};

export const BUILTIN_FONTS = [
  { label: 'Noto Sans JP (ゴシック標準)', value: '"Noto Sans JP", sans-serif' },
  { label: 'M PLUS Rounded 1c (丸ゴシック)', value: '"M PLUS Rounded 1c", sans-serif' },
  { label: 'Dela Gothic One (極太インパクト)', value: '"Dela Gothic One", sans-serif' },
  { label: 'Noto Serif JP (明朝体)', value: '"Noto Serif JP", serif' },
  { label: 'Inter / システム標準', value: 'Inter, sans-serif' },
];

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: '"Noto Sans JP", sans-serif',
  fontSize: 56,
  fontWeight: 900,
  color: '#FFFFFF',
  lineHeight: 1.3,
  letterSpacing: 1,
  x: 50,
  y: 86,
  align: 'center',
  innerOutline: {
    enabled: true,
    color: '#9333ea',
    width: 8,
  },
  outerOutline: {
    enabled: true,
    color: '#ffffff',
    width: 10,
  },
  background: {
    enabled: false,
    color: '#09090b',
    opacity: 0.75,
    borderRadius: 14,
    paddingX: 28,
    paddingY: 14,
  },
  shadow: {
    enabled: true,
    color: 'rgba(0, 0, 0, 0.8)',
    blur: 10,
    offsetX: 0,
    offsetY: 4,
  },
};

export const SUBTITLE_STYLE_PRESETS: Array<{
  id: string;
  name: string;
  description: string;
  style: Partial<SubtitleStyle>;
}> = [
  {
    id: 'purple-pop',
    name: '紫ポップ（白文字×紫縁×白縁）',
    description: 'デフォルト：鮮やかな紫の二重縁取り',
    style: {
      fontFamily: '"Noto Sans JP", sans-serif',
      fontSize: 56,
      fontWeight: 900,
      color: '#FFFFFF',
      innerOutline: { enabled: true, color: '#9333ea', width: 8 },
      outerOutline: { enabled: true, color: '#ffffff', width: 10 },
      background: {
        enabled: false,
        color: '#000000',
        opacity: 0.7,
        borderRadius: 12,
        paddingX: 24,
        paddingY: 12,
      },
      shadow: {
        enabled: true,
        color: 'rgba(0,0,0,0.85)',
        blur: 10,
        offsetX: 0,
        offsetY: 4,
      },
    },
  },
  {
    id: 'variety-cyan',
    name: 'YouTube王道（白×黒×シアン二重縁）',
    description: '視認性抜群の二重アウトライン',
    style: {
      fontFamily: '"Noto Sans JP", sans-serif',
      fontSize: 56,
      fontWeight: 900,
      color: '#FFFFFF',
      innerOutline: { enabled: true, color: '#000000', width: 8 },
      outerOutline: { enabled: true, color: '#06b6d4', width: 14 },
      background: {
        enabled: false,
        color: '#000000',
        opacity: 0.7,
        borderRadius: 12,
        paddingX: 24,
        paddingY: 12,
      },
      shadow: {
        enabled: true,
        color: 'rgba(0,0,0,0.85)',
        blur: 10,
        offsetX: 0,
        offsetY: 4,
      },
    },
  },
  {
    id: 'variety-gold',
    name: 'バラエティ強調（黄×黒×赤二重縁）',
    description: 'ツッコミ・重要発言向けの強調スタイル',
    style: {
      fontFamily: '"Dela Gothic One", sans-serif',
      fontSize: 62,
      fontWeight: 900,
      color: '#FACC15',
      innerOutline: { enabled: true, color: '#000000', width: 9 },
      outerOutline: { enabled: true, color: '#DC2626', width: 16 },
      background: {
        enabled: false,
        color: '#000000',
        opacity: 0.7,
        borderRadius: 12,
        paddingX: 24,
        paddingY: 12,
      },
      shadow: {
        enabled: true,
        color: 'rgba(0,0,0,0.9)',
        blur: 12,
        offsetX: 0,
        offsetY: 5,
      },
    },
  },
  {
    id: 'business-zabuton',
    name: 'ビジネス解説（角丸座布団）',
    description: 'ニュース・解説動画向けの落ち着いた背景座布団',
    style: {
      fontFamily: '"Noto Sans JP", sans-serif',
      fontSize: 48,
      fontWeight: 700,
      color: '#FFFFFF',
      innerOutline: { enabled: true, color: '#000000', width: 3 },
      outerOutline: { enabled: false, color: '#FFFFFF', width: 0 },
      background: {
        enabled: true,
        color: '#18181b',
        opacity: 0.85,
        borderRadius: 16,
        paddingX: 32,
        paddingY: 16,
      },
      shadow: {
        enabled: true,
        color: 'rgba(0,0,0,0.5)',
        blur: 8,
        offsetX: 0,
        offsetY: 4,
      },
    },
  },
  {
    id: 'shorts-pop',
    name: 'ショート動画ポップ（丸ゴ×白太縁）',
    description: '9:16縦動画で映えるポップな二重縁取り',
    style: {
      fontFamily: '"M PLUS Rounded 1c", sans-serif',
      fontSize: 60,
      fontWeight: 900,
      color: '#FB7185',
      innerOutline: { enabled: true, color: '#FFFFFF', width: 10 },
      outerOutline: { enabled: true, color: '#18181b', width: 16 },
      background: {
        enabled: false,
        color: '#000000',
        opacity: 0.6,
        borderRadius: 20,
        paddingX: 24,
        paddingY: 12,
      },
      shadow: {
        enabled: true,
        color: 'rgba(0,0,0,0.65)',
        blur: 10,
        offsetX: 0,
        offsetY: 5,
      },
    },
  },
];

function cloneSnapshot(state: {
  videoClips: VideoClip[];
  subtitles: SubtitleItem[];
  bgmClips: BgmClip[];
  aspectRatio: AspectRatioType;
  defaultSubtitleStyle: SubtitleStyle;
}): EditorHistorySnapshot {
  return JSON.parse(
    JSON.stringify({
      videoClips: state.videoClips,
      subtitles: state.subtitles,
      bgmClips: state.bgmClips,
      aspectRatio: state.aspectRatio,
      defaultSubtitleStyle: state.defaultSubtitleStyle,
    })
  );
}

/**
 * Re-pack video clips sequentially from 0.0s (ripple mode)
 */
export function packVideoClipsRipple(clips: VideoClip[]): VideoClip[] {
  let cursor = 0;
  return clips.map((clip) => {
    const duration = Number(
      ((clip.sourceEnd - clip.sourceStart) / clip.speed).toFixed(4)
    );
    const updated: VideoClip = {
      ...clip,
      startTime: Number(cursor.toFixed(4)),
      duration: Math.max(0.05, duration),
    };
    cursor += updated.duration;
    return updated;
  });
}

export interface EditorState {
  // Project metadata
  projectName: string;
  aspectRatio: AspectRatioType;

  // Media & Fonts
  mediaAssets: MediaAsset[];
  customFonts: CustomFontAsset[];

  // Timeline Tracks
  videoClips: VideoClip[]; // Track 2 (Video + Main Audio)
  subtitles: SubtitleItem[]; // Track 1 (Text / Telop)
  bgmClips: BgmClip[]; // Track 3 (BGM)
  defaultSubtitleStyle: SubtitleStyle;

  // Master audio effects (compressor / loudness)
  audioEffects: AudioEffectsSettings;

  // Multicam (Cam 1 = main + master audio, Cam 2 = sub video only)
  cam2MediaId: string | null;
  /** cam2 media time = cam1 media source time + cam2Offset (seconds) */
  cam2Offset: number;
  multicamMode: boolean;

  // Playback & Timeline UI state
  isPlaying: boolean;
  currentTime: number;
  loopPlayback: boolean;
  zoomPxPerSec: number;
  snapEnabled: boolean;
  showCutOverlay: boolean;
  showSafeZone: boolean;
  activeTool: ActiveTool;
  leftPanelTab: LeftPanelTab;
  inspectorTab: InspectorTab;

  // Selection
  selectedItemType: 'video' | 'subtitle' | 'bgm' | null;
  selectedItemId: string | null;

  // Auto Cut & AI state
  silenceConfig: SilenceConfig;
  cutIntervals: CutInterval[];
  isTranscribing: boolean;
  transcribeProgress: number;
  transcribeStatusText: string;
  isAnalyzingAiCut: boolean;

  // Export & Modals
  isSettingsModalOpen: boolean;
  isExportModalOpen: boolean;
  appPasscode: string;
  geminiApiKey: string;
  statusNotification: string | null;

  // Undo / Redo History
  past: EditorHistorySnapshot[];
  future: EditorHistorySnapshot[];

  // Computed helper
  getTotalDuration: () => number;

  // Actions
  setProjectName: (name: string) => void;
  setAspectRatio: (ratio: AspectRatioType) => void;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setLoopPlayback: (loop: boolean) => void;
  setZoomPxPerSec: (zoom: number) => void;
  setSnapEnabled: (snap: boolean) => void;
  setShowCutOverlay: (show: boolean) => void;
  setShowSafeZone: (show: boolean) => void;
  setActiveTool: (tool: ActiveTool) => void;
  setLeftPanelTab: (tab: LeftPanelTab) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  selectItem: (type: 'video' | 'subtitle' | 'bgm' | null, id: string | null) => void;
  setStatusNotification: (msg: string | null) => void;

  // Settings & Modals
  setSettingsModalOpen: (open: boolean) => void;
  setExportModalOpen: (open: boolean) => void;
  setAppPasscode: (passcode: string) => void;
  setGeminiApiKey: (key: string) => void;

  // History
  saveHistory: () => void;
  undo: () => void;
  redo: () => void;

  // Media & Fonts Actions
  addMediaAsset: (asset: MediaAsset, autoAddToTimeline?: boolean) => void;
  updateMediaAsset: (mediaId: string, patch: Partial<MediaAsset>) => void;
  relinkMissingVideoAsset: (mediaId: string, file: File, objectUrl: string) => void;
  removeMediaAsset: (mediaId: string) => void;
  registerCustomFont: (fontAsset: CustomFontAsset) => Promise<void>;
  removeCustomFont: (fontId: string) => void;

  // Audio effects Actions
  setAudioEffects: (patch: Partial<AudioEffectsSettings>) => void;
  applyAudioPreset: (preset: Exclude<AudioEffectPreset, 'custom'>) => void;

  // Multicam Actions
  setCam2MediaId: (mediaId: string | null) => void;
  setCam2Offset: (offset: number) => void;
  setMulticamMode: (enabled: boolean) => void;
  setClipCameraAngle: (clipId: string, angle: 1 | 2) => void;
  liveSwitchAngle: (angle: 1 | 2) => void;

  // Video Clip Actions (Track 2)
  addVideoClipFromAsset: (mediaId: string) => void;
  updateVideoClip: (clipId: string, patch: Partial<VideoClip>, recordHistory?: boolean) => void;
  updateVideoClipSpeed: (clipId: string, newSpeed: number) => void;
  splitVideoClipAt: (clipId: string, timelineSplitTime: number) => void;
  splitAtPlayhead: () => void;
  rippleDeleteVideoClip: (clipId: string) => void;

  // Auto Cut & AI Cut Actions
  setSilenceConfig: (patch: Partial<SilenceConfig>) => void;
  setCutIntervals: (intervals: CutInterval[]) => void;
  toggleCutIntervalSelection: (id: string) => void;
  selectAllCutIntervals: (selected: boolean) => void;
  applySelectedCutIntervals: () => number;
  setTranscribeState: (
    isTranscribing: boolean,
    progress?: number,
    statusText?: string
  ) => void;
  setAnalyzingAiCut: (analyzing: boolean) => void;

  // Subtitle Actions (Track 1)
  addSubtitle: (item?: Partial<SubtitleItem>) => string;
  setSubtitlesFromTranscription: (
    segments: Array<{
      id: string;
      start: number;
      end: number;
      text: string;
      groupId?: string;
    }>
  ) => void;
  /** Replace all subtitles (one undo step), e.g. after re-format */
  replaceSubtitles: (
    items: Array<{
      start: number;
      end: number;
      text: string;
      style: SubtitleStyle;
      groupId?: string;
    }>
  ) => void;
  /** Split a subtitle at a text cursor position (time by character ratio) */
  splitSubtitleAtCursor: (id: string, cursor: number) => void;
  updateSubtitle: (
    id: string,
    patch: Partial<Omit<SubtitleItem, 'style'>> & { style?: Partial<SubtitleStyle> },
    recordHistory?: boolean
  ) => void;
  deleteSubtitle: (id: string) => void;
  splitSubtitle: (id: string, splitTime?: number) => void;
  mergeSubtitleWithNext: (id: string) => void;
  updateDefaultSubtitleStyle: (patch: Partial<SubtitleStyle>) => void;
  applyStyleToAllSubtitles: (style: SubtitleStyle) => void;

  // BGM Actions (Track 3)
  addBgmClipFromAsset: (mediaId: string) => void;
  updateBgmClip: (id: string, patch: Partial<BgmClip>, recordHistory?: boolean) => void;
  deleteBgmClip: (id: string) => void;

  // Project Load / Reset
  loadProjectState: (payload: {
    projectName: string;
    aspectRatio: AspectRatioType;
    mediaAssets: MediaAsset[];
    customFonts: CustomFontAsset[];
    videoClips: VideoClip[];
    subtitles: SubtitleItem[];
    bgmClips: BgmClip[];
    defaultSubtitleStyle: SubtitleStyle;
    silenceConfig: SilenceConfig;
    cam2MediaId?: string | null;
    cam2Offset?: number;
    audioEffects?: Partial<AudioEffectsSettings>;
  }) => void;
}

const STORAGE_PASSCODE_KEY = 'cloudcut_app_passcode';
const STORAGE_GEMINI_KEY = 'cloudcut_gemini_api_key';

export const useEditorStore = create<EditorState>((set, get) => ({
  projectName: '新規YouTubeプロジェクト',
  aspectRatio: '16:9',

  mediaAssets: [],
  customFonts: [],

  videoClips: [],
  subtitles: [],
  bgmClips: [],
  defaultSubtitleStyle: JSON.parse(JSON.stringify(DEFAULT_SUBTITLE_STYLE)),

  audioEffects: { ...DEFAULT_AUDIO_EFFECTS },

  cam2MediaId: null,
  cam2Offset: 0,
  multicamMode: false,

  isPlaying: false,
  currentTime: 0,
  loopPlayback: false,
  zoomPxPerSec: 60,
  snapEnabled: true,
  showCutOverlay: true,
  showSafeZone: false,
  activeTool: 'select',
  leftPanelTab: 'media',
  inspectorTab: 'subtitle',

  selectedItemType: null,
  selectedItemId: null,

  silenceConfig: {
    thresholdDb: -38,
    minSilenceDurationMs: 650,
    paddingMs: 220,
    paddingBeforeMs: 180,
    paddingAfterMs: 250,
    autoNormalize: true,
    useVoiceBandFilter: true,
    minSpeechDurationMs: 80,
    detectNoiseByTranscript: true,
    silencePreset: 'mild',
  },
  cutIntervals: [],
  isTranscribing: false,
  transcribeProgress: 0,
  transcribeStatusText: '',
  isAnalyzingAiCut: false,

  isSettingsModalOpen: false,
  isExportModalOpen: false,
  appPasscode:
    typeof window !== 'undefined'
      ? localStorage.getItem(STORAGE_PASSCODE_KEY) || ''
      : '',
  geminiApiKey:
    typeof window !== 'undefined'
      ? localStorage.getItem(STORAGE_GEMINI_KEY) || ''
      : '',
  statusNotification: null,

  past: [],
  future: [],

  getTotalDuration: () => {
    const state = get();
    let maxEnd = 0;
    for (const vc of state.videoClips) {
      if (vc.startTime + vc.duration > maxEnd) {
        maxEnd = vc.startTime + vc.duration;
      }
    }
    for (const sub of state.subtitles) {
      if (sub.endTime > maxEnd) {
        maxEnd = sub.endTime;
      }
    }
    for (const bgm of state.bgmClips) {
      if (bgm.startTime + bgm.duration > maxEnd) {
        maxEnd = bgm.startTime + bgm.duration;
      }
    }
    return Math.max(maxEnd, 10);
  },

  setProjectName: (projectName) => set({ projectName }),

  setAspectRatio: (aspectRatio) => {
    get().saveHistory();
    set({ aspectRatio });
  },

  setIsPlaying: (isPlaying) => set({ isPlaying }),

  setCurrentTime: (time) => {
    const maxDur = get().getTotalDuration();
    const clamped = Math.max(0, Math.min(time, maxDur));
    set({ currentTime: clamped });
  },

  setLoopPlayback: (loopPlayback) => set({ loopPlayback }),

  setZoomPxPerSec: (zoom) =>
    set({ zoomPxPerSec: Math.max(10, Math.min(300, zoom)) }),

  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
  setShowCutOverlay: (showCutOverlay) => set({ showCutOverlay }),
  setShowSafeZone: (showSafeZone) => set({ showSafeZone }),
  setActiveTool: (activeTool) => set({ activeTool }),
  setLeftPanelTab: (leftPanelTab) => set({ leftPanelTab }),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),

  selectItem: (selectedItemType, selectedItemId) => {
    set((state) => ({
      selectedItemType,
      selectedItemId,
      inspectorTab:
        selectedItemType === 'subtitle'
          ? 'subtitle'
          : selectedItemType === 'video' || selectedItemType === 'bgm'
          ? 'clip'
          : state.inspectorTab,
    }));
  },

  setStatusNotification: (statusNotification) => {
    set({ statusNotification });
    if (statusNotification) {
      setTimeout(() => {
        if (get().statusNotification === statusNotification) {
          set({ statusNotification: null });
        }
      }, 4000);
    }
  },

  setSettingsModalOpen: (isSettingsModalOpen) => set({ isSettingsModalOpen }),
  setExportModalOpen: (isExportModalOpen) => set({ isExportModalOpen }),

  setAppPasscode: (appPasscode) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_PASSCODE_KEY, appPasscode);
    }
    set({ appPasscode });
  },

  setGeminiApiKey: (geminiApiKey) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_GEMINI_KEY, geminiApiKey);
    }
    set({ geminiApiKey });
  },

  saveHistory: () => {
    const state = get();
    const snap = cloneSnapshot(state);
    const nextPast = [...state.past.slice(-39), snap];
    set({ past: nextPast, future: [] });
  },

  undo: () => {
    const state = get();
    if (state.past.length === 0) return;
    const previous = state.past[state.past.length - 1];
    const currentSnap = cloneSnapshot(state);
    set({
      videoClips: previous.videoClips,
      subtitles: previous.subtitles,
      bgmClips: previous.bgmClips,
      aspectRatio: previous.aspectRatio,
      defaultSubtitleStyle: previous.defaultSubtitleStyle,
      past: state.past.slice(0, -1),
      future: [currentSnap, ...state.future.slice(0, 39)],
    });
  },

  redo: () => {
    const state = get();
    if (state.future.length === 0) return;
    const next = state.future[0];
    const currentSnap = cloneSnapshot(state);
    set({
      videoClips: next.videoClips,
      subtitles: next.subtitles,
      bgmClips: next.bgmClips,
      aspectRatio: next.aspectRatio,
      defaultSubtitleStyle: next.defaultSubtitleStyle,
      past: [...state.past, currentSnap],
      future: state.future.slice(1),
    });
  },

  addMediaAsset: (asset, autoAddToTimeline = true) => {
    set((state) => ({
      mediaAssets: [...state.mediaAssets, asset],
    }));
    if (autoAddToTimeline) {
      if (asset.type === 'video') {
        get().addVideoClipFromAsset(asset.id);
      } else if (asset.type === 'bgm') {
        get().addBgmClipFromAsset(asset.id);
      }
    }
  },

  updateMediaAsset: (mediaId, patch) => {
    set((state) => ({
      mediaAssets: state.mediaAssets.map((m) =>
        m.id === mediaId ? { ...m, ...patch } : m
      ),
    }));
  },

  relinkMissingVideoAsset: (mediaId, file, objectUrl) => {
    set((state) => ({
      mediaAssets: state.mediaAssets.map((m) =>
        m.id === mediaId
          ? {
              ...m,
              file,
              objectUrl,
              missingFile: false,
            }
          : m
      ),
    }));
    get().setStatusNotification('元動画ファイルを再リンクしました');
  },

  removeMediaAsset: (mediaId) => {
    get().saveHistory();
    set((state) => {
      const target = state.mediaAssets.find((m) => m.id === mediaId);
      if (target?.objectUrl) {
        URL.revokeObjectURL(target.objectUrl);
      }
      return {
        mediaAssets: state.mediaAssets.filter((m) => m.id !== mediaId),
        videoClips: packVideoClipsRipple(
          state.videoClips.filter((c) => c.mediaId !== mediaId)
        ),
        bgmClips: state.bgmClips.filter((b) => b.mediaId !== mediaId),
        ...(state.cam2MediaId === mediaId
          ? {
              cam2MediaId: null,
              cam2Offset: 0,
              multicamMode: false,
              videoClips: packVideoClipsRipple(
                state.videoClips
                  .filter((c) => c.mediaId !== mediaId)
                  .map((c) => ({ ...c, cameraAngle: 1 as const }))
              ),
            }
          : {}),
      };
    });
  },

  registerCustomFont: async (fontAsset) => {
    try {
      const fontBufferCopy = fontAsset.data.slice(0);
      const fontFace = new FontFace(fontAsset.name, fontBufferCopy);
      const loadedFace = await fontFace.load();
      document.fonts.add(loadedFace);

      set((state) => {
        const exists = state.customFonts.some((f) => f.name === fontAsset.name);
        const updatedFonts = exists
          ? state.customFonts.map((f) =>
              f.name === fontAsset.name ? fontAsset : f
            )
          : [...state.customFonts, fontAsset];
        return { customFonts: updatedFonts };
      });
      get().setStatusNotification(
        `カスタムフォント「${fontAsset.name}」を登録しました`
      );
    } catch (err) {
      console.error('Failed to load custom font:', err);
      get().setStatusNotification(
        `フォントの読み込みに失敗しました: ${fontAsset.fileName}`
      );
    }
  },

  removeCustomFont: (fontId) => {
    set((state) => ({
      customFonts: state.customFonts.filter((f) => f.id !== fontId),
    }));
  },

  setAudioEffects: (patch) => {
    set((state) => {
      // Manually touching any tone parameter switches the preset to 'custom'
      const touchesParams = (
        [
          'threshold',
          'ratio',
          'knee',
          'attack',
          'release',
          'makeupGain',
          'autoMakeup',
          'voiceClarityEq',
        ] as const
      ).some((k) => k in patch);
      return {
        audioEffects: {
          ...state.audioEffects,
          ...patch,
          ...(touchesParams && !('preset' in patch)
            ? { preset: 'custom' as const }
            : {}),
        },
      };
    });
  },

  applyAudioPreset: (preset) => {
    set((state) => ({
      audioEffects: {
        ...state.audioEffects,
        ...AUDIO_EFFECT_PRESETS[preset].values,
        preset,
        compressorEnabled: true,
      },
    }));
  },

  setCam2MediaId: (cam2MediaId) => {
    set((state) => ({
      cam2MediaId,
      cam2Offset: cam2MediaId ? state.cam2Offset : 0,
      multicamMode: cam2MediaId ? state.multicamMode : false,
      videoClips: cam2MediaId
        ? state.videoClips
        : state.videoClips.map((c) => ({ ...c, cameraAngle: 1 as const })),
    }));
  },

  setCam2Offset: (offset) => {
    const safe = Number.isFinite(offset) ? offset : 0;
    set({ cam2Offset: Number(Math.max(-3600, Math.min(3600, safe)).toFixed(3)) });
  },

  setMulticamMode: (multicamMode) => set({ multicamMode }),

  setClipCameraAngle: (clipId, angle) => {
    const state = get();
    if (angle === 2 && !state.cam2MediaId) {
      state.setStatusNotification('先にCam 2（サブカメラ）を登録してください');
      return;
    }
    const target = state.videoClips.find((c) => c.id === clipId);
    if (!target || (target.cameraAngle ?? 1) === angle) return;
    state.saveHistory();
    set({
      videoClips: state.videoClips.map((c) =>
        c.id === clipId ? { ...c, cameraAngle: angle } : c
      ),
    });
  },

  /**
   * Live switching: split the clip under the playhead at currentTime and switch the angle
   * from there. The new angle also carries over to following clips until a clip that
   * already had a different angle than the original one is reached.
   */
  liveSwitchAngle: (angle) => {
    const state = get();
    if (angle === 2 && !state.cam2MediaId) {
      state.setStatusNotification('先にCam 2（サブカメラ）を登録してください');
      return;
    }
    const t = state.currentTime;
    const idx = state.videoClips.findIndex(
      (c) => t >= c.startTime && t < c.startTime + c.duration
    );
    if (idx === -1) return;
    const clip = state.videoClips[idx];
    const baseAngle = clip.cameraAngle ?? 1;
    if (baseAngle === angle) return;

    state.saveHistory();

    const rel = t - clip.startTime;
    const next = [...state.videoClips];
    let firstChanged = idx;

    if (rel > 0.08 && rel < clip.duration - 0.08) {
      const sourceSplit = Number((clip.sourceStart + rel * clip.speed).toFixed(4));
      const first: VideoClip = {
        ...clip,
        sourceEnd: sourceSplit,
        duration: Number(((sourceSplit - clip.sourceStart) / clip.speed).toFixed(4)),
      };
      const second: VideoClip = {
        ...clip,
        id: `vclip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sourceStart: sourceSplit,
        duration: Number(((clip.sourceEnd - sourceSplit) / clip.speed).toFixed(4)),
      };
      next.splice(idx, 1, first, second);
      firstChanged = idx + 1;
    }

    for (let i = firstChanged; i < next.length; i++) {
      if (i > firstChanged && (next[i].cameraAngle ?? 1) !== baseAngle) break;
      next[i] = { ...next[i], cameraAngle: angle };
    }

    set({ videoClips: packVideoClipsRipple(next) });
  },

  addVideoClipFromAsset: (mediaId) => {
    const state = get();
    const asset = state.mediaAssets.find(
      (a) => a.id === mediaId && a.type === 'video'
    );
    if (!asset) return;

    state.saveHistory();
    const lastEnd = state.videoClips.reduce(
      (acc, c) => Math.max(acc, c.startTime + c.duration),
      0
    );

    const newClip: VideoClip = {
      id: `vclip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      mediaId: asset.id,
      name: asset.name,
      startTime: Number(lastEnd.toFixed(4)),
      duration: Number(asset.duration.toFixed(4)),
      sourceStart: 0,
      sourceEnd: Number(asset.duration.toFixed(4)),
      speed: 1.0,
      volume: 1.0,
      muted: false,
      positionX: 0,
      positionY: 0,
      scale: 1.0,
    };

    set({
      videoClips: [...state.videoClips, newClip],
      selectedItemType: 'video',
      selectedItemId: newClip.id,
      inspectorTab: 'clip',
    });
  },

  updateVideoClip: (clipId, patch, recordHistory = false) => {
    if (recordHistory) {
      get().saveHistory();
    }
    set((state) => {
      const updated = state.videoClips.map((c) => {
        if (c.id !== clipId) return c;
        const merged = { ...c, ...patch };
        merged.duration = Number(
          Math.max(
            0.05,
            (merged.sourceEnd - merged.sourceStart) / merged.speed
          ).toFixed(4)
        );
        return merged;
      });
      return {
        videoClips: packVideoClipsRipple(updated),
      };
    });
  },

  updateVideoClipSpeed: (clipId, newSpeed) => {
    const clampedSpeed = Number(
      Math.max(0.25, Math.min(4.0, newSpeed)).toFixed(2)
    );
    const state = get();
    const target = state.videoClips.find((c) => c.id === clipId);
    if (!target) return;

    state.saveHistory();

    const oldDuration = target.duration;
    const newDuration = Number(
      ((target.sourceEnd - target.sourceStart) / clampedSpeed).toFixed(4)
    );
    const delta = newDuration - oldDuration;
    const clipStart = target.startTime;
    const clipOldEnd = clipStart + oldDuration;
    const speedRatio = target.speed / clampedSpeed;

    const updatedVideoClips = packVideoClipsRipple(
      state.videoClips.map((c) =>
        c.id === clipId
          ? {
              ...c,
              speed: clampedSpeed,
              duration: newDuration,
            }
          : c
      )
    );

    // Adjust subtitles overlapping or after this clip so they stay synchronized
    const updatedSubtitles = state.subtitles.map((sub) => {
      if (sub.endTime <= clipStart) {
        return sub;
      }
      if (sub.startTime >= clipOldEnd) {
        return {
          ...sub,
          startTime: Number(Math.max(0, sub.startTime + delta).toFixed(3)),
          endTime: Number(Math.max(0.2, sub.endTime + delta).toFixed(3)),
        };
      }
      // Inside the speed-adjusted clip
      const relStart = Math.max(0, sub.startTime - clipStart);
      const relEnd = Math.max(relStart + 0.2, sub.endTime - clipStart);
      return {
        ...sub,
        startTime: Number((clipStart + relStart * speedRatio).toFixed(3)),
        endTime: Number((clipStart + relEnd * speedRatio).toFixed(3)),
      };
    });

    set({
      videoClips: updatedVideoClips,
      subtitles: updatedSubtitles,
    });
  },

  splitVideoClipAt: (clipId, timelineSplitTime) => {
    const state = get();
    const clipIndex = state.videoClips.findIndex((c) => c.id === clipId);
    if (clipIndex === -1) return;

    const clip = state.videoClips[clipIndex];
    const relTime = timelineSplitTime - clip.startTime;
    if (relTime <= 0.08 || relTime >= clip.duration - 0.08) {
      return;
    }

    state.saveHistory();

    const sourceSplit = Number(
      (clip.sourceStart + relTime * clip.speed).toFixed(4)
    );

    const firstHalf: VideoClip = {
      ...clip,
      sourceEnd: sourceSplit,
      duration: Number(
        ((sourceSplit - clip.sourceStart) / clip.speed).toFixed(4)
      ),
    };

    const secondHalf: VideoClip = {
      ...clip,
      id: `vclip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      startTime: Number((clip.startTime + firstHalf.duration).toFixed(4)),
      sourceStart: sourceSplit,
      duration: Number(
        ((clip.sourceEnd - sourceSplit) / clip.speed).toFixed(4)
      ),
    };

    const nextClips = [...state.videoClips];
    nextClips.splice(clipIndex, 1, firstHalf, secondHalf);

    set({
      videoClips: packVideoClipsRipple(nextClips),
      selectedItemType: 'video',
      selectedItemId: secondHalf.id,
    });
  },

  splitAtPlayhead: () => {
    const state = get();
    const t = state.currentTime;

    // If a subtitle is selected and playhead is inside it, split subtitle
    if (state.selectedItemType === 'subtitle' && state.selectedItemId) {
      const sub = state.subtitles.find((s) => s.id === state.selectedItemId);
      if (sub && t > sub.startTime + 0.1 && t < sub.endTime - 0.1) {
        state.splitSubtitle(sub.id, t);
        return;
      }
    }

    // Find video clip under playhead
    const clip = state.videoClips.find(
      (c) => t > c.startTime + 0.08 && t < c.startTime + c.duration - 0.08
    );
    if (clip) {
      state.splitVideoClipAt(clip.id, t);
      state.setStatusNotification('再生ヘッド位置でクリップを分割しました');
    }
  },

  rippleDeleteVideoClip: (clipId) => {
    const state = get();
    const target = state.videoClips.find((c) => c.id === clipId);
    if (!target) return;

    state.saveHistory();

    const cutStart = target.startTime;
    const cutEnd = target.startTime + target.duration;
    const cutLen = target.duration;

    const remainingClips = packVideoClipsRipple(
      state.videoClips.filter((c) => c.id !== clipId)
    );

    // Ripple-shift subtitles
    const updatedSubtitles = state.subtitles
      .filter((sub) => !(sub.startTime >= cutStart && sub.endTime <= cutEnd))
      .map((sub) => {
        if (sub.endTime <= cutStart) return sub;
        if (sub.startTime >= cutEnd) {
          return {
            ...sub,
            startTime: Number((sub.startTime - cutLen).toFixed(3)),
            endTime: Number((sub.endTime - cutLen).toFixed(3)),
          };
        }
        // Partially overlapping
        const newStart =
          sub.startTime < cutStart ? sub.startTime : cutStart;
        const newEnd = Math.max(
          newStart + 0.2,
          sub.endTime > cutEnd ? sub.endTime - cutLen : cutStart
        );
        return {
          ...sub,
          startTime: Number(newStart.toFixed(3)),
          endTime: Number(newEnd.toFixed(3)),
        };
      });

    set({
      videoClips: remainingClips,
      subtitles: updatedSubtitles,
      selectedItemId:
        state.selectedItemId === clipId ? null : state.selectedItemId,
      selectedItemType:
        state.selectedItemId === clipId ? null : state.selectedItemType,
    });
    state.setStatusNotification('リップル削除を実行しました');
  },

  setSilenceConfig: (patch) =>
    set((state) => ({
      silenceConfig: { ...state.silenceConfig, ...patch },
    })),

  setCutIntervals: (cutIntervals) => set({ cutIntervals, showCutOverlay: true }),

  toggleCutIntervalSelection: (id) =>
    set((state) => ({
      cutIntervals: state.cutIntervals.map((ci) =>
        ci.id === id ? { ...ci, selected: !ci.selected } : ci
      ),
    })),

  selectAllCutIntervals: (selected) =>
    set((state) => ({
      cutIntervals: state.cutIntervals.map((ci) => ({ ...ci, selected })),
    })),

  applySelectedCutIntervals: () => {
    const state = get();
    const activeCuts = state.cutIntervals
      .filter((c) => c.selected && c.end > c.start + 0.05)
      .sort((a, b) => a.start - b.start);

    if (activeCuts.length === 0 || state.videoClips.length === 0) {
      return 0;
    }

    state.saveHistory();

    // Merge overlapping cut intervals
    const mergedCuts: Array<{ start: number; end: number }> = [];
    for (const c of activeCuts) {
      if (mergedCuts.length === 0) {
        mergedCuts.push({ start: c.start, end: c.end });
      } else {
        const last = mergedCuts[mergedCuts.length - 1];
        if (c.start <= last.end + 0.02) {
          last.end = Math.max(last.end, c.end);
        } else {
          mergedCuts.push({ start: c.start, end: c.end });
        }
      }
    }

    // Slice videoClips by subtracting all mergedCuts
    const resultClips: VideoClip[] = [];
    let counter = 0;

    for (const clip of state.videoClips) {
      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + clip.duration;

      // Find cuts intersecting this clip
      const relevantCuts = mergedCuts.filter(
        (mc) => mc.end > clipStart + 0.02 && mc.start < clipEnd - 0.02
      );

      if (relevantCuts.length === 0) {
        resultClips.push({ ...clip });
        continue;
      }

      let cursor = clipStart;
      for (const cut of relevantCuts) {
        const keepEnd = Math.max(cursor, Math.min(clipEnd, cut.start));
        if (keepEnd - cursor >= 0.08) {
          const relStart = cursor - clipStart;
          const relEnd = keepEnd - clipStart;
          const srcStart = Number(
            (clip.sourceStart + relStart * clip.speed).toFixed(4)
          );
          const srcEnd = Number(
            (clip.sourceStart + relEnd * clip.speed).toFixed(4)
          );
          resultClips.push({
            ...clip,
            id: `vclip-${Date.now()}-${counter++}`,
            sourceStart: srcStart,
            sourceEnd: srcEnd,
            duration: Number(((srcEnd - srcStart) / clip.speed).toFixed(4)),
          });
        }
        cursor = Math.max(cursor, Math.min(clipEnd, cut.end));
      }

      if (clipEnd - cursor >= 0.08) {
        const relStart = cursor - clipStart;
        const relEnd = clipEnd - clipStart;
        const srcStart = Number(
          (clip.sourceStart + relStart * clip.speed).toFixed(4)
        );
        const srcEnd = Number(
          (clip.sourceStart + relEnd * clip.speed).toFixed(4)
        );
        resultClips.push({
          ...clip,
          id: `vclip-${Date.now()}-${counter++}`,
          sourceStart: srcStart,
          sourceEnd: srcEnd,
          duration: Number(((srcEnd - srcStart) / clip.speed).toFixed(4)),
        });
      }
    }

    const packedVideoClips = packVideoClipsRipple(resultClips);

    // Helper to map an old timeline timestamp to the new ripple-packed timeline timestamp
    const mapOldTimeToNew = (t: number): number => {
      let removedBefore = 0;
      for (const cut of mergedCuts) {
        if (t <= cut.start) break;
        if (t >= cut.end) {
          removedBefore += cut.end - cut.start;
        } else {
          removedBefore += t - cut.start;
        }
      }
      return Math.max(0, t - removedBefore);
    };

    const updatedSubtitles: SubtitleItem[] = [];
    for (const sub of state.subtitles) {
      // Check if subtitle is completely inside a cut
      const completelyCut = mergedCuts.some(
        (c) => sub.startTime >= c.start - 0.05 && sub.endTime <= c.end + 0.05
      );
      if (completelyCut) continue;

      const newStart = Number(mapOldTimeToNew(sub.startTime).toFixed(3));
      const newEnd = Number(mapOldTimeToNew(sub.endTime).toFixed(3));
      if (newEnd - newStart >= 0.15) {
        updatedSubtitles.push({
          ...sub,
          startTime: newStart,
          endTime: newEnd,
        });
      }
    }

    const totalCutSec = mergedCuts.reduce(
      (acc, c) => acc + (c.end - c.start),
      0
    );

    set({
      videoClips: packedVideoClips,
      subtitles: updatedSubtitles,
      cutIntervals: [],
      currentTime: 0,
    });

    state.setStatusNotification(
      `${mergedCuts.length}箇所（計 ${totalCutSec.toFixed(1)}秒）を自動リップルカットしました`
    );

    return mergedCuts.length;
  },

  setTranscribeState: (isTranscribing, progress = 0, statusText = '') =>
    set({
      isTranscribing,
      transcribeProgress: progress,
      transcribeStatusText: statusText,
    }),

  setAnalyzingAiCut: (isAnalyzingAiCut) => set({ isAnalyzingAiCut }),

  addSubtitle: (item) => {
    const state = get();
    state.saveHistory();
    const start =
      typeof item?.startTime === 'number'
        ? item.startTime
        : Number(state.currentTime.toFixed(2));
    const end =
      typeof item?.endTime === 'number'
        ? item.endTime
        : Number((start + 3.0).toFixed(2));
    const newSub: SubtitleItem = {
      id: item?.id || `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text: item?.text ?? 'テキストを入力してください',
      startTime: start,
      endTime: end,
      style: item?.style
        ? JSON.parse(JSON.stringify(item.style))
        : JSON.parse(JSON.stringify(state.defaultSubtitleStyle)),
    };

    const nextSubs = [...state.subtitles, newSub].sort(
      (a, b) => a.startTime - b.startTime
    );

    set({
      subtitles: nextSubs,
      selectedItemType: 'subtitle',
      selectedItemId: newSub.id,
      inspectorTab: 'subtitle',
    });

    return newSub.id;
  },

  setSubtitlesFromTranscription: (segments) => {
    const state = get();
    state.saveHistory();
    const baseStyle = state.defaultSubtitleStyle;

    const newSubs: SubtitleItem[] = segments.map((seg, idx) => ({
      id: seg.id || `sub-ai-${Date.now()}-${idx}`,
      text: seg.text,
      startTime: Number(seg.start.toFixed(3)),
      endTime: Number(Math.max(seg.start + 0.3, seg.end).toFixed(3)),
      style: JSON.parse(JSON.stringify(baseStyle)),
      ...(seg.groupId ? { groupId: seg.groupId } : {}),
    }));

    set({
      subtitles: newSubs.sort((a, b) => a.startTime - b.startTime),
      selectedItemType: newSubs.length > 0 ? 'subtitle' : null,
      selectedItemId: newSubs[0]?.id || null,
      inspectorTab: 'subtitle',
    });
  },

  replaceSubtitles: (items) => {
    const state = get();
    state.saveHistory();
    const subs: SubtitleItem[] = items.map((it, idx) => ({
      id: `sub-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
      text: it.text,
      startTime: Number(it.start.toFixed(3)),
      endTime: Number(Math.max(it.start + 0.15, it.end).toFixed(3)),
      style: JSON.parse(JSON.stringify(it.style)),
      ...(it.groupId ? { groupId: it.groupId } : {}),
    }));
    subs.sort((a, b) => a.startTime - b.startTime);
    set({
      subtitles: subs,
      selectedItemType: subs.length > 0 ? 'subtitle' : null,
      selectedItemId: subs[0]?.id || null,
      inspectorTab: 'subtitle',
    });
  },

  splitSubtitleAtCursor: (id, cursor) => {
    const state = get();
    const target = state.subtitles.find((s) => s.id === id);
    if (!target) return;
    const left = target.text.slice(0, cursor).replace(/^[\s\n]+|[\s\n]+$/g, '');
    const right = target.text.slice(cursor).replace(/^[\s\n]+|[\s\n]+$/g, '');
    if (!left || !right) {
      state.setStatusNotification('カーソルを文字の途中に置いてください（先頭・末尾では分割できません）');
      return;
    }
    const lc = left.replace(/\n/g, '').length;
    const rc = right.replace(/\n/g, '').length;
    const dur = target.endTime - target.startTime;
    const minPart = Math.min(0.15, dur / 3);
    const mid = Number(
      Math.max(
        target.startTime + minPart,
        Math.min(target.endTime - minPart, target.startTime + (dur * lc) / (lc + rc))
      ).toFixed(3)
    );
    state.saveHistory();
    const groupId =
      target.groupId || `grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const first: SubtitleItem = { ...target, text: left, endTime: mid, groupId };
    const second: SubtitleItem = {
      ...JSON.parse(JSON.stringify(target)),
      id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text: right,
      startTime: mid,
      endTime: target.endTime,
      groupId,
    };
    set((s) => ({
      subtitles: s.subtitles
        .flatMap((item) => (item.id === id ? [first, second] : [item]))
        .sort((a, b) => a.startTime - b.startTime),
      selectedItemType: 'subtitle',
      selectedItemId: second.id,
    }));
  },

  updateSubtitle: (id, patch, recordHistory = false) => {
    if (recordHistory) {
      get().saveHistory();
    }
    set((state) => ({
      subtitles: state.subtitles
        .map((sub) => {
          if (sub.id !== id) return sub;
          const nextStyle: SubtitleStyle = patch.style
            ? {
                ...sub.style,
                ...patch.style,
                innerOutline: patch.style.innerOutline
                  ? { ...sub.style.innerOutline, ...patch.style.innerOutline }
                  : sub.style.innerOutline,
                outerOutline: patch.style.outerOutline
                  ? { ...sub.style.outerOutline, ...patch.style.outerOutline }
                  : sub.style.outerOutline,
                background: patch.style.background
                  ? { ...sub.style.background, ...patch.style.background }
                  : sub.style.background,
                shadow: patch.style.shadow
                  ? { ...sub.style.shadow, ...patch.style.shadow }
                  : sub.style.shadow,
              }
            : sub.style;

          return {
            ...sub,
            ...patch,
            style: nextStyle,
          };
        })
        .sort((a, b) => a.startTime - b.startTime),
    }));
  },

  deleteSubtitle: (id) => {
    get().saveHistory();
    set((state) => ({
      subtitles: state.subtitles.filter((s) => s.id !== id),
      selectedItemId: state.selectedItemId === id ? null : state.selectedItemId,
      selectedItemType:
        state.selectedItemId === id ? null : state.selectedItemType,
    }));
  },

  splitSubtitle: (id, splitTime) => {
    const state = get();
    const target = state.subtitles.find((s) => s.id === id);
    if (!target) return;

    const mid =
      typeof splitTime === 'number' &&
      splitTime > target.startTime + 0.1 &&
      splitTime < target.endTime - 0.1
        ? Number(splitTime.toFixed(3))
        : Number(((target.startTime + target.endTime) / 2).toFixed(3));

    if (mid <= target.startTime + 0.1 || mid >= target.endTime - 0.1) return;

    state.saveHistory();

    // Split text roughly in half if single line
    const chars = Array.from(target.text);
    const halfIdx = Math.ceil(chars.length / 2);
    const firstText =
      chars.length > 4 ? chars.slice(0, halfIdx).join('') : target.text;
    const secondText =
      chars.length > 4 ? chars.slice(halfIdx).join('') : target.text;

    const firstSub: SubtitleItem = {
      ...target,
      endTime: mid,
      text: firstText,
    };

    const secondSub: SubtitleItem = {
      ...JSON.parse(JSON.stringify(target)),
      id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      startTime: mid,
      endTime: target.endTime,
      text: secondText,
    };

    set((s) => ({
      subtitles: s.subtitles
        .flatMap((item) => (item.id === id ? [firstSub, secondSub] : [item]))
        .sort((a, b) => a.startTime - b.startTime),
      selectedItemType: 'subtitle',
      selectedItemId: secondSub.id,
    }));
  },

  mergeSubtitleWithNext: (id) => {
    const state = get();
    const sorted = [...state.subtitles].sort(
      (a, b) => a.startTime - b.startTime
    );
    const idx = sorted.findIndex((s) => s.id === id);
    if (idx === -1 || idx >= sorted.length - 1) return;

    state.saveHistory();
    const current = sorted[idx];
    const next = sorted[idx + 1];

    const merged: SubtitleItem = {
      ...current,
      endTime: next.endTime,
      text: `${current.text}${next.text}`,
    };

    set({
      subtitles: sorted.filter((s) => s.id !== next.id).map((s) =>
        s.id === current.id ? merged : s
      ),
      selectedItemType: 'subtitle',
      selectedItemId: merged.id,
    });
  },

  updateDefaultSubtitleStyle: (patch) => {
    set((state) => ({
      defaultSubtitleStyle: {
        ...state.defaultSubtitleStyle,
        ...patch,
        innerOutline: patch.innerOutline
          ? { ...state.defaultSubtitleStyle.innerOutline, ...patch.innerOutline }
          : state.defaultSubtitleStyle.innerOutline,
        outerOutline: patch.outerOutline
          ? { ...state.defaultSubtitleStyle.outerOutline, ...patch.outerOutline }
          : state.defaultSubtitleStyle.outerOutline,
        background: patch.background
          ? { ...state.defaultSubtitleStyle.background, ...patch.background }
          : state.defaultSubtitleStyle.background,
        shadow: patch.shadow
          ? { ...state.defaultSubtitleStyle.shadow, ...patch.shadow }
          : state.defaultSubtitleStyle.shadow,
      },
    }));
  },

  applyStyleToAllSubtitles: (style) => {
    const state = get();
    state.saveHistory();
    const clonedStyle: SubtitleStyle = JSON.parse(JSON.stringify(style));
    set({
      defaultSubtitleStyle: clonedStyle,
      subtitles: state.subtitles.map((sub) => ({
        ...sub,
        style: JSON.parse(JSON.stringify(clonedStyle)),
      })),
    });
    state.setStatusNotification(
      `全 ${state.subtitles.length} 件のテロップに現在のスタイルを一括適用しました`
    );
  },

  addBgmClipFromAsset: (mediaId) => {
    const state = get();
    const asset = state.mediaAssets.find(
      (a) => a.id === mediaId && a.type === 'bgm'
    );
    if (!asset) return;

    state.saveHistory();
    const lastEnd = state.bgmClips.reduce(
      (acc, b) => Math.max(acc, b.startTime + b.duration),
      0
    );

    const newBgm: BgmClip = {
      id: `bgm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      mediaId: asset.id,
      name: asset.name,
      startTime: Number(lastEnd.toFixed(3)),
      duration: Number(asset.duration.toFixed(3)),
      sourceStart: 0,
      sourceEnd: Number(asset.duration.toFixed(3)),
      volume: 0.35,
      muted: false,
      fadeIn: 1.5,
      fadeOut: 2.0,
    };

    set({
      bgmClips: [...state.bgmClips, newBgm],
      selectedItemType: 'bgm',
      selectedItemId: newBgm.id,
      inspectorTab: 'clip',
    });
  },

  updateBgmClip: (id, patch, recordHistory = false) => {
    if (recordHistory) {
      get().saveHistory();
    }
    set((state) => ({
      bgmClips: state.bgmClips.map((b) =>
        b.id === id ? { ...b, ...patch } : b
      ),
    }));
  },

  deleteBgmClip: (id) => {
    get().saveHistory();
    set((state) => ({
      bgmClips: state.bgmClips.filter((b) => b.id !== id),
      selectedItemId: state.selectedItemId === id ? null : state.selectedItemId,
      selectedItemType:
        state.selectedItemId === id ? null : state.selectedItemType,
    }));
  },

  loadProjectState: (payload) => {
    set({
      projectName: payload.projectName,
      aspectRatio: payload.aspectRatio,
      mediaAssets: payload.mediaAssets,
      customFonts: payload.customFonts,
      videoClips: payload.videoClips,
      subtitles: payload.subtitles,
      bgmClips: payload.bgmClips,
      defaultSubtitleStyle: payload.defaultSubtitleStyle,
      silenceConfig: payload.silenceConfig,
      audioEffects: { ...DEFAULT_AUDIO_EFFECTS, ...(payload.audioEffects || {}) },
      cam2MediaId: payload.cam2MediaId ?? null,
      cam2Offset: payload.cam2Offset ?? 0,
      multicamMode: false,
      currentTime: 0,
      isPlaying: false,
      selectedItemId: null,
      selectedItemType: null,
      cutIntervals: [],
      past: [],
      future: [],
    });
  },
}));

