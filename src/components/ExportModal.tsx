import React, { useRef, useState } from 'react';
import {
  X,
  Video,
  FileCode2,
  FileText,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { useEditorStore } from '../store/useEditorStore';
import { exportTimelineToMp4 } from '../utils/mp4Exporter';
import { downloadFcpxmlFile, downloadSrtFile } from '../utils/exporters';
import { getCanvasDimensions } from '../utils/canvasRenderer';

export const ExportModal: React.FC = () => {
  const isOpen = useEditorStore((s) => s.isExportModalOpen);
  const projectName = useEditorStore((s) => s.projectName);
  const aspectRatio = useEditorStore((s) => s.aspectRatio);
  const mediaAssets = useEditorStore((s) => s.mediaAssets);
  const videoClips = useEditorStore((s) => s.videoClips);
  const subtitles = useEditorStore((s) => s.subtitles);
  const bgmClips = useEditorStore((s) => s.bgmClips);

  const setExportModalOpen = useEditorStore((s) => s.setExportModalOpen);
  const setStatusNotification = useEditorStore((s) => s.setStatusNotification);

  const [fps, setFps] = useState<number>(30);
  const [bitrateMbps, setBitrateMbps] = useState<number>(8);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stageText, setStageText] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  if (!isOpen) return null;

  const { width, height } = getCanvasDimensions(aspectRatio);

  const handleStartMp4Export = async () => {
    setIsExporting(true);
    setProgress(0);
    setStageText('MP4エンコーダーを初期化しています...');
    setErrorText(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await exportTimelineToMp4({
        projectName,
        aspectRatio,
        fps,
        videoBitrate: bitrateMbps * 1_000_000,
        mediaAssets,
        videoClips,
        subtitles,
        bgmClips,
        signal: controller.signal,
        onProgress: (pct, text) => {
          setProgress(pct);
          setStageText(text);
        },
      });
      setStatusNotification('MP4動画ファイルのダウンロードを開始しました');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorText(msg);
    } finally {
      setIsExporting(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancelExport = () => {
    abortControllerRef.current?.abort();
  };

  const handleFcpxml = () => {
    downloadFcpxmlFile({
      projectName,
      aspectRatio,
      mediaAssets,
      videoClips,
      subtitles,
      bgmClips,
    });
    setStatusNotification('DaVinci Resolve用 FCPXML (.fcpxml) を出力しました');
  };

  const handleSrt = () => {
    downloadSrtFile(projectName, subtitles);
    setStatusNotification('SRT字幕ファイル (.srt) を出力しました');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl rounded-xl bg-[#1f1f23] border border-zinc-700 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#18181b] border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Video className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-zinc-100">
              動画・タイムライン・字幕の書き出し (Export)
            </h2>
          </div>
          <button
            onClick={() => !isExporting && setExportModalOpen(false)}
            disabled={isExporting}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 disabled:opacity-40 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* 1. MP4 Client-side Export Section */}
          <div className="p-4 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-xs font-bold text-zinc-100 flex items-center gap-2">
                  <span>1. MP4 直接出力（WebCodecs + カスタムフォント合成）</span>
                  <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono text-[10px]">
                    {width}×{height}
                  </span>
                </h3>
                <p className="text-[11px] text-zinc-400 mt-1">
                  Canvasのテロップ装飾（二重縁取り・座布団・影）と、速度変更・BGMフェード反映済みの音声を結合してMP4を生成します。
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  フレームレート (FPS)
                </label>
                <select
                  value={fps}
                  disabled={isExporting}
                  onChange={(e) => setFps(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-xs text-zinc-100 focus:outline-none"
                >
                  <option value={24}>24 fps (シネマティック)</option>
                  <option value={30}>30 fps (YouTube標準)</option>
                  <option value={60}>60 fps (高フレームレート)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  映像ビットレート (画質)
                </label>
                <select
                  value={bitrateMbps}
                  disabled={isExporting}
                  onChange={(e) => setBitrateMbps(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-xs text-zinc-100 focus:outline-none"
                >
                  <option value={5}>5 Mbps (軽量・高速)</option>
                  <option value={8}>8 Mbps (YouTube推奨・高画質)</option>
                  <option value={14}>14 Mbps (最高画質)</option>
                </select>
              </div>
            </div>

            {/* Progress Bar */}
            {(isExporting || progress === 100) && (
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300 flex items-center gap-1.5">
                    {isExporting ? (
                      <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    )}
                    <span>{stageText}</span>
                  </span>
                  <span className="font-mono font-bold text-cyan-400">
                    {progress}%
                  </span>
                </div>
                <div className="w-full h-2.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-150"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            {errorText && (
              <div className="p-2.5 rounded bg-rose-500/15 border border-rose-500/40 text-xs text-rose-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorText}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              {isExporting ? (
                <button
                  onClick={handleCancelExport}
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition"
                >
                  書き出しを中止
                </button>
              ) : (
                <button
                  onClick={handleStartMp4Export}
                  className="w-full py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-zinc-950 font-bold text-xs shadow transition flex items-center justify-center gap-2"
                >
                  <Video className="w-4 h-4" />
                  <span>MP4 ファイルをレンダリングしてダウンロード</span>
                </button>
              )}
            </div>
          </div>

          {/* 2. DaVinci Resolve FCPXML & SRT Export Section */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handleFcpxml}
              disabled={isExporting}
              className="p-3.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-800/90 border border-zinc-800 text-left transition flex flex-col justify-between group"
            >
              <div className="flex items-center gap-2 text-amber-400 font-bold text-xs">
                <FileCode2 className="w-4 h-4" />
                <span>DaVinci Resolve 連携 (.fcpxml)</span>
              </div>
              <p className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">
                ジェットカット・速度変更・BGM配置を反映した FCPXML v1.9 を出力します。
              </p>
            </button>

            <button
              onClick={handleSrt}
              disabled={isExporting}
              className="p-3.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-800/90 border border-zinc-800 text-left transition flex flex-col justify-between group"
            >
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                <FileText className="w-4 h-4" />
                <span>SRT 字幕ファイル (.srt)</span>
              </div>
              <p className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">
                手直し完了後の全テロップ（{subtitles.length}件）を標準SRT形式で出力します。
              </p>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

