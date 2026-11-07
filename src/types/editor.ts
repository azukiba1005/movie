export type AspectRatioType = '16:9' | '9:16';

export type ActiveTool = 'select' | 'razor';

export type LeftPanelTab = 'media' | 'autocut' | 'subtitles';

export type InspectorTab = 'clip' | 'subtitle';

export interface SubtitleOutline {
  enabled: boolean;
  color: string;
  width: number; // px (at 1080p base resolution)
}

export interface SubtitleBackground {
  enabled: boolean;
  color: string;
  opacity: number; // 0.0 to 1.0
  borderRadius: number; // px
  paddingX: number; // px
  paddingY: number; // px
}

export interface SubtitleShadow {
  enabled: boolean;
  color: string;
  blur: number; // px
  offsetX: number; // px
  offsetY: number; // px
}

export interface SubtitleStyle {
  fontFamily: string;
  fontSize: number; // px at 1080p reference height/width
  fontWeight: number; // 400 | 700 | 900
  color: string;
  lineHeight: number; // multiplier e.g. 1.3
  letterSpacing: number; // px
  x: number; // percentage 0 - 100 (50 = centered)
  y: number; // percentage 0 - 100 (85 = bottom area)
  align: 'left' | 'center' | 'right';
  innerOutline: SubtitleOutline;
  outerOutline: SubtitleOutline;
  background: SubtitleBackground;
  shadow: SubtitleShadow;
}

export interface SubtitleItem {
  id: string;
  text: string;
  startTime: number; // timeline seconds
  endTime: number; // timeline seconds
  style: SubtitleStyle;
}

export interface VideoClip {
  id: string;
  mediaId: string;
  name: string;
  /** Start time on the timeline (seconds) */
  startTime: number;
  /** Duration on the timeline (seconds) = (sourceEnd - sourceStart) / speed */
  duration: number;
  /** Start offset in the source video file (seconds) */
  sourceStart: number;
  /** End offset in the source video file (seconds) */
  sourceEnd: number;
  /** Playback rate: 0.25 to 4.0 */
  speed: number;
  /** Audio volume: 0.0 to 2.0 (1.0 = 100%) */
  volume: number;
  muted: boolean;
  /** Position X offset in canvas pixels (0 = centered) */
  positionX: number;
  /** Position Y offset in canvas pixels (0 = centered) */
  positionY: number;
  /** Scale multiplier (1.0 = 100% fit) */
  scale: number;
}

export interface BgmClip {
  id: string;
  mediaId: string;
  name: string;
  startTime: number; // timeline seconds
  duration: number; // timeline seconds
  sourceStart: number; // source audio seconds
  sourceEnd: number; // source audio seconds
  volume: number; // 0.0 to 2.0
  muted: boolean;
  fadeIn: number; // seconds
  fadeOut: number; // seconds
}

export interface MediaAsset {
  id: string;
  name: string;
  type: 'video' | 'bgm';
  file?: File;
  objectUrl: string;
  duration: number; // seconds
  width?: number;
  height?: number;
  sizeBytes: number;
  mimeType: string;
  /** Normalized waveform peaks (0..1) sampled at e.g. 50 peaks/sec of source media */
  waveformPeaks: number[];
  waveformSampleRate: number; // peaks per second (e.g. 50)
  missingFile?: boolean; // true when loaded from a lightweight .zip pack before video re-link
}

export interface CustomFontAsset {
  id: string;
  name: string; // CSS font-family name
  fileName: string;
  format: 'ttf' | 'otf' | 'woff2';
  data: ArrayBuffer;
}

export interface SilenceConfig {
  thresholdDb: number; // e.g. -38 dB
  minSilenceDurationMs: number; // e.g. 400 ms
  paddingMs: number; // e.g. 100 ms before & after speech
}

export interface CutInterval {
  id: string;
  start: number; // timeline seconds
  end: number; // timeline seconds
  type: 'silence' | 'ai';
  category?: 'retake' | 'filler' | 'tangent' | 'silence';
  reason?: string;
  text?: string;
  confidence?: number;
  selected: boolean;
}

export interface EditorHistorySnapshot {
  videoClips: VideoClip[];
  subtitles: SubtitleItem[];
  bgmClips: BgmClip[];
  aspectRatio: AspectRatioType;
  defaultSubtitleStyle: SubtitleStyle;
}

export interface SerializedProjectJson {
  version: string;
  projectName: string;
  aspectRatio: AspectRatioType;
  packMode: 'full' | 'lightweight';
  createdAt: string;
  videoClips: VideoClip[];
  subtitles: SubtitleItem[];
  bgmClips: BgmClip[];
  defaultSubtitleStyle: SubtitleStyle;
  silenceConfig: SilenceConfig;
  mediaMetadata: Array<{
    id: string;
    name: string;
    type: 'video' | 'bgm';
    duration: number;
    width?: number;
    height?: number;
    sizeBytes: number;
    mimeType: string;
    waveformPeaks: number[];
    waveformSampleRate: number;
    includedInZip: boolean;
    zipPath?: string;
  }>;
  fontMetadata: Array<{
    id: string;
    name: string;
    fileName: string;
    format: 'ttf' | 'otf' | 'woff2';
    zipPath: string;
  }>;
}

