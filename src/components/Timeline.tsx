import React, { useEffect, useRef, useState } from 'react';
import {
  MousePointer,
  Scissors,
  Trash2,
  Magnet,
  ZoomIn,
  ZoomOut,
  Subtitles,
  Film,
  Music,
  Eye,
  Plus,
} from 'lucide-react';
import { useEditorStore } from '../store/useEditorStore';
import { MediaAsset, VideoClip } from '../types/editor';

/**
 * Dedicated Canvas Waveform component for Track 2 VideoClips & Track 3 BGM
 */
const ClipWaveformCanvas: React.FC<{
  asset: MediaAsset | undefined;
  sourceStart: number;
  sourceEnd: number;
  widthPx: number;
  heightPx: number;
  color: string;
  fadeInSec?: number;
  fadeOutSec?: number;
  clipDurationSec?: number;
}> = ({
  asset,
  sourceStart,
  sourceEnd,
  widthPx,
  heightPx,
  color,
  fadeInSec = 0,
  fadeOutSec = 0,
  clipDurationSec = 1,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const drawW = Math.max(1, Math.min(4000, Math.floor(widthPx)));
    const drawH = Math.max(1, Math.floor(heightPx));
    canvas.width = drawW;
    canvas.height = drawH;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, drawW, drawH);

    const peaks = asset?.waveformPeaks;
    const sampleRate = asset?.waveformSampleRate || 50;

    if (!peaks || peaks.length === 0) {
      // Draw subtle center line if no audio peaks
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.moveTo(0, drawH / 2);
      ctx.lineTo(drawW, drawH / 2);
      ctx.stroke();
      return;
    }

    const startIdx = Math.max(0, Math.floor(sourceStart * sampleRate));
    const endIdx = Math.min(peaks.length - 1, Math.ceil(sourceEnd * sampleRate));
    const totalIndices = Math.max(1, endIdx - startIdx);

    ctx.fillStyle = color;
    const barStep = 2;
    const midY = drawH / 2;

    for (let x = 0; x < drawW; x += barStep) {
      const ratio = x / drawW;
      const peakIndex = Math.min(
        peaks.length - 1,
        startIdx + Math.floor(ratio * totalIndices)
      );
      const amp = peaks[peakIndex] ?? 0.05;
      const barH = Math.max(2, amp * (drawH * 0.88));
      ctx.fillRect(x, midY - barH / 2, 1.5, barH);
    }

    // Draw Fade-in / Fade-out envelope line if applicable (BGM track)
    if ((fadeInSec > 0 || fadeOutSec > 0) && clipDurationSec > 0) {
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const fadeInX = Math.min(
        drawW,
        (fadeInSec / clipDurationSec) * drawW
      );
      const fadeOutStartX = Math.max(
        fadeInX,
        drawW - (fadeOutSec / clipDurationSec) * drawW
      );
      ctx.moveTo(0, drawH);
      ctx.lineTo(fadeInX, 4);
      ctx.lineTo(fadeOutStartX, 4);
      ctx.lineTo(drawW, drawH);
      ctx.stroke();
    }
  }, [
    asset,
    sourceStart,
    sourceEnd,
    widthPx,
    heightPx,
    color,
    fadeInSec,
    fadeOutSec,
    clipDurationSec,
  ]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full pointer-events-none block opacity-85"
    />
  );
};

export const Timeline: React.FC = () => {
  const videoClips = useEditorStore((s) => s.videoClips);
  const subtitles = useEditorStore((s) => s.subtitles);
  const bgmClips = useEditorStore((s) => s.bgmClips);
  const mediaAssets = useEditorStore((s) => s.mediaAssets);
  const currentTime = useEditorStore((s) => s.currentTime);
  const zoomPxPerSec = useEditorStore((s) => s.zoomPxPerSec);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const showCutOverlay = useEditorStore((s) => s.showCutOverlay);
  const cutIntervals = useEditorStore((s) => s.cutIntervals);
  const activeTool = useEditorStore((s) => s.activeTool);
  const selectedItemType = useEditorStore((s) => s.selectedItemType);
  const selectedItemId = useEditorStore((s) => s.selectedItemId);

  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const setZoomPxPerSec = useEditorStore((s) => s.setZoomPxPerSec);
  const setSnapEnabled = useEditorStore((s) => s.setSnapEnabled);
  const setShowCutOverlay = useEditorStore((s) => s.setShowCutOverlay);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const selectItem = useEditorStore((s) => s.selectItem);
  const splitVideoClipAt = useEditorStore((s) => s.splitVideoClipAt);
  const splitAtPlayhead = useEditorStore((s) => s.splitAtPlayhead);
  const rippleDeleteVideoClip = useEditorStore((s) => s.rippleDeleteVideoClip);
  const updateVideoClip = useEditorStore((s) => s.updateVideoClip);
  const addSubtitle = useEditorStore((s) => s.addSubtitle);
  const updateSubtitle = useEditorStore((s) => s.updateSubtitle);
  const splitSubtitle = useEditorStore((s) => s.splitSubtitle);
  const deleteSubtitle = useEditorStore((s) => s.deleteSubtitle);
  const updateBgmClip = useEditorStore((s) => s.updateBgmClip);
  const deleteBgmClip = useEditorStore((s) => s.deleteBgmClip);
  const getTotalDuration = useEditorStore((s) => s.getTotalDuration);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const tracksAreaRef = useRef<HTMLDivElement | null>(null);

  const [isScrubbing, setIsScrubbing] = useState(false);

  // Dragging state for Subtitle or BGM or Video trim
  const [dragState, setDragState] = useState<{
    kind:
      | 'sub-move'
      | 'sub-trim-left'
      | 'sub-trim-right'
      | 'video-trim-left'
      | 'video-trim-right'
      | 'bgm-move'
      | 'bgm-trim-right';
    id: string;
    startX: number;
    initialStart: number;
    initialEnd: number;
    initialSourceStart?: number;
    initialSourceEnd?: number;
    clipSpeed?: number;
    maxAssetDur?: number;
  } | null>(null);

  const totalDuration = Math.max(getTotalDuration() + 8, 25);
  const timelineWidthPx = Math.max(900, Math.ceil(totalDuration * zoomPxPerSec));

  // Snap helper
  const snapTime = (rawSec: number, ignoreId?: string): number => {
    if (!snapEnabled) return Math.max(0, rawSec);
    const thresholdSec = 7 / zoomPxPerSec;
    const candidates: number[] = [0, currentTime];

    for (const vc of videoClips) {
      if (vc.id !== ignoreId) {
        candidates.push(vc.startTime, vc.startTime + vc.duration);
      }
    }
    for (const sub of subtitles) {
      if (sub.id !== ignoreId) {
        candidates.push(sub.startTime, sub.endTime);
      }
    }

    for (const pt of candidates) {
      if (Math.abs(rawSec - pt) <= thresholdSec) {
        return pt;
      }
    }
    return Math.max(0, rawSec);
  };

  // Convert mouse clientX inside tracks area to timeline seconds
  const clientXToSeconds = (clientX: number): number => {
    if (!tracksAreaRef.current) return 0;
    const rect = tracksAreaRef.current.getBoundingClientRect();
    const offsetX = Math.max(0, clientX - rect.left);
    return offsetX / zoomPxPerSec;
  };

  // Scrubbing handlers
  const handleRulerMouseDown = (e: React.MouseEvent) => {
    setIsPlaying(false);
    setIsScrubbing(true);
    setCurrentTime(clientXToSeconds(e.clientX));
  };

  useEffect(() => {
    if (!isScrubbing && !dragState) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      if (isScrubbing) {
        setCurrentTime(clientXToSeconds(e.clientX));
        return;
      }

      if (dragState) {
        const deltaSec = (e.clientX - dragState.startX) / zoomPxPerSec;

        if (dragState.kind === 'sub-move') {
          const dur = dragState.initialEnd - dragState.initialStart;
          const nextStart = snapTime(
            Math.max(0, dragState.initialStart + deltaSec),
            dragState.id
          );
          updateSubtitle(
            dragState.id,
            {
              startTime: Number(nextStart.toFixed(3)),
              endTime: Number((nextStart + dur).toFixed(3)),
            },
            false
          );
        } else if (dragState.kind === 'sub-trim-left') {
          const nextStart = snapTime(
            Math.min(
              dragState.initialEnd - 0.2,
              Math.max(0, dragState.initialStart + deltaSec)
            ),
            dragState.id
          );
          updateSubtitle(
            dragState.id,
            { startTime: Number(nextStart.toFixed(3)) },
            false
          );
        } else if (dragState.kind === 'sub-trim-right') {
          const nextEnd = snapTime(
            Math.max(
              dragState.initialStart + 0.2,
              dragState.initialEnd + deltaSec
            ),
            dragState.id
          );
          updateSubtitle(
            dragState.id,
            { endTime: Number(nextEnd.toFixed(3)) },
            false
          );
        } else if (dragState.kind === 'video-trim-left') {
          const speed = dragState.clipSpeed || 1;
          const srcStart = dragState.initialSourceStart ?? 0;
          const srcEnd = dragState.initialSourceEnd ?? 5;
          const nextSrcStart = Math.max(
            0,
            Math.min(srcEnd - 0.15, srcStart + deltaSec * speed)
          );
          updateVideoClip(
            dragState.id,
            { sourceStart: Number(nextSrcStart.toFixed(3)) },
            false
          );
        } else if (dragState.kind === 'video-trim-right') {
          const speed = dragState.clipSpeed || 1;
          const srcStart = dragState.initialSourceStart ?? 0;
          const srcEnd = dragState.initialSourceEnd ?? 5;
          const maxDur = dragState.maxAssetDur ?? 3600;
          const nextSrcEnd = Math.min(
            maxDur,
            Math.max(srcStart + 0.15, srcEnd + deltaSec * speed)
          );
          updateVideoClip(
            dragState.id,
            { sourceEnd: Number(nextSrcEnd.toFixed(3)) },
            false
          );
        } else if (dragState.kind === 'bgm-move') {
          const nextStart = snapTime(
            Math.max(0, dragState.initialStart + deltaSec),
            dragState.id
          );
          updateBgmClip(
            dragState.id,
            { startTime: Number(nextStart.toFixed(3)) },
            false
          );
        } else if (dragState.kind === 'bgm-trim-right') {
          const targetBgm = useEditorStore
            .getState()
            .bgmClips.find((b) => b.id === dragState.id);
          const bgmAsset = targetBgm
            ? useEditorStore
                .getState()
                .mediaAssets.find((m) => m.id === targetBgm.mediaId)
            : undefined;
          const maxBgmDur =
            targetBgm && bgmAsset && bgmAsset.duration > 0
              ? Math.max(0.5, bgmAsset.duration - targetBgm.sourceStart)
              : Infinity;
          const nextDur = Math.min(
            maxBgmDur,
            Math.max(
              0.5,
              dragState.initialEnd - dragState.initialStart + deltaSec
            )
          );
          updateBgmClip(
            dragState.id,
            {
              duration: Number(nextDur.toFixed(3)),
              ...(targetBgm
                ? {
                    sourceEnd: Number(
                      (targetBgm.sourceStart + nextDur).toFixed(3)
                    ),
                  }
                : {}),
            },
            false
          );
        }
      }
    };

    const handleWindowMouseUp = () => {
      setIsScrubbing(false);
      setDragState(null);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  });

  // Delete currently selected item on toolbar trash click
  const handleDeleteSelected = () => {
    if (!selectedItemId || !selectedItemType) return;
    if (selectedItemType === 'video') {
      rippleDeleteVideoClip(selectedItemId);
    } else if (selectedItemType === 'subtitle') {
      deleteSubtitle(selectedItemId);
    } else if (selectedItemType === 'bgm') {
      deleteBgmClip(selectedItemId);
    }
  };

  // Compute ruler tick interval based on zoomPxPerSec
  const majorTickSec =
    zoomPxPerSec >= 120
      ? 1
      : zoomPxPerSec >= 50
      ? 2
      : zoomPxPerSec >= 25
      ? 5
      : 10;

  const ticks: number[] = [];
  for (let s = 0; s <= totalDuration; s += majorTickSec) {
    ticks.push(s);
  }

  return (
    <div className="flex flex-col h-full bg-[#18181b] border-t border-zinc-800 select-none overflow-hidden">
      {/* 1. Timeline Toolbar */}
      <div className="h-9 px-3 bg-[#1f1f23] border-b border-zinc-800 flex items-center justify-between shrink-0">
        {/* Left: Editing Tools */}
        <div className="flex items-center gap-1.5">
          {/* Select Tool (V) */}
          <button
            onClick={() => setActiveTool('select')}
            title="選択・移動ツール (ショートカット: V)"
            className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1 transition ${
              activeTool === 'select'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'hover:bg-zinc-800 text-zinc-400'
            }`}
          >
            <MousePointer className="w-3.5 h-3.5" />
            <span>選択 (V)</span>
          </button>

          {/* Razor / Split Tool (B / S) */}
          <button
            onClick={() => setActiveTool('razor')}
            title="カミソリ分割ツール (ショートカット: B または S)"
            className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1 transition ${
              activeTool === 'razor'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'hover:bg-zinc-800 text-zinc-400'
            }`}
          >
            <Scissors className="w-3.5 h-3.5" />
            <span>カミソリ (B)</span>
          </button>

          <div className="w-px h-4 bg-zinc-700 mx-1" />

          {/* Split at Playhead */}
          <button
            onClick={splitAtPlayhead}
            title="再生ヘッド位置でクリップを分割 (S)"
            className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs flex items-center gap-1 transition"
          >
            <Scissors className="w-3.5 h-3.5 text-cyan-400" />
            <span>再生位置で分割</span>
          </button>

          {/* Ripple Delete Selected */}
          <button
            onClick={handleDeleteSelected}
            disabled={!selectedItemId}
            title="選択中のクリップをリップル削除 (Delete / Backspace)"
            className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-rose-500/20 disabled:opacity-40 text-zinc-200 hover:text-rose-300 text-xs flex items-center gap-1 transition"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            <span>リップル削除</span>
          </button>

          <div className="w-px h-4 bg-zinc-700 mx-1" />

          {/* Snap Toggle */}
          <button
            onClick={() => setSnapEnabled(!snapEnabled)}
            title="スナップ機能（吸着）のON/OFF"
            className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition ${
              snapEnabled
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                : 'text-zinc-500 hover:bg-zinc-800'
            }`}
          >
            <Magnet className="w-3.5 h-3.5" />
            <span className="hidden md:inline">スナップ</span>
          </button>

          {/* Cut Overlay Toggle */}
          {cutIntervals.length > 0 && (
            <button
              onClick={() => setShowCutOverlay(!showCutOverlay)}
              className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition ${
                showCutOverlay
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  : 'text-zinc-500 hover:bg-zinc-800'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>カット候補表示 ({cutIntervals.length})</span>
            </button>
          )}
        </div>

        {/* Right: Zoom Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoomPxPerSec(zoomPxPerSec - 15)}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            title="タイムライン縮小"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <input
            type="range"
            min={15}
            max={240}
            value={zoomPxPerSec}
            onChange={(e) => setZoomPxPerSec(Number(e.target.value))}
            className="w-28 accent-cyan-500 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
          />
          <button
            onClick={() => setZoomPxPerSec(zoomPxPerSec + 15)}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            title="タイムライン拡大"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <span className="text-[11px] font-mono text-zinc-500 w-14 text-right">
            {zoomPxPerSec}px/s
          </span>
        </div>
      </div>

      {/* 2. Main Multi-Track Body (Left Track Headers + Right Scrollable Tracks) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Fixed Track Headers Column */}
        <div className="w-40 bg-[#1b1b1f] border-r border-zinc-800 flex flex-col shrink-0 z-10">
          {/* Ruler Header Corner */}
          <div className="h-7 px-3 border-b border-zinc-800 flex items-center justify-between text-[10px] font-mono text-zinc-500">
            <span>TIMELINE</span>
            <span>3 TRACKS</span>
          </div>

          {/* Track 1 Header: Subtitles (Text) */}
          <div className="h-14 px-3 border-b border-zinc-800/90 flex items-center justify-between bg-[#1e1e24]">
            <div className="flex items-center gap-2">
              <Subtitles className="w-4 h-4 text-amber-400" />
              <div>
                <div className="text-xs font-bold text-zinc-200">
                  Track 1 (Text)
                </div>
                <div className="text-[10px] text-zinc-400">
                  テロップ ({subtitles.length})
                </div>
              </div>
            </div>
            <button
              onClick={() => addSubtitle()}
              title="現在位置にテロップ追加"
              className="p-1 rounded bg-zinc-800 hover:bg-amber-500/20 text-zinc-300 hover:text-amber-300"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Track 2 Header: Main Video + Audio */}
          <div className="h-20 px-3 border-b border-zinc-800/90 flex items-center justify-between bg-[#1b1b20]">
            <div className="flex items-center gap-2">
              <Film className="w-4 h-4 text-cyan-400" />
              <div>
                <div className="text-xs font-bold text-zinc-200">
                  Track 2 (Video)
                </div>
                <div className="text-[10px] text-zinc-400">
                  メイン映像＋音声波形
                </div>
              </div>
            </div>
          </div>

          {/* Track 3 Header: BGM */}
          <div className="h-14 px-3 border-b border-zinc-800/90 flex items-center justify-between bg-[#18181d]">
            <div className="flex items-center gap-2">
              <Music className="w-4 h-4 text-emerald-400" />
              <div>
                <div className="text-xs font-bold text-zinc-200">
                  Track 3 (BGM)
                </div>
                <div className="text-[10px] text-zinc-400">
                  BGM・フェード制御
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Scrollable Timeline Area */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-x-auto overflow-y-auto relative bg-[#141417]"
        >
          <div
            ref={tracksAreaRef}
            style={{ width: `${timelineWidthPx}px` }}
            className={`relative min-h-full ${
              activeTool === 'razor' ? 'cursor-crosshair' : ''
            }`}
          >
            {/* Time Ruler */}
            <div
              onMouseDown={handleRulerMouseDown}
              className="h-7 bg-[#1a1a1f] border-b border-zinc-800 relative cursor-pointer sticky top-0 z-20"
            >
              {ticks.map((sec) => {
                const leftPx = sec * zoomPxPerSec;
                const mins = Math.floor(sec / 60);
                const remSec = sec % 60;
                const label = `${String(mins).padStart(2, '0')}:${String(
                  remSec
                ).padStart(2, '0')}`;
                return (
                  <div
                    key={sec}
                    style={{ left: `${leftPx}px` }}
                    className="absolute top-0 bottom-0 flex flex-col justify-end pointer-events-none"
                  >
                    <span className="text-[10px] font-mono text-zinc-400 pl-1.5 pb-1">
                      {label}
                    </span>
                    <div className="w-px h-2 bg-zinc-600" />
                  </div>
                );
              })}
            </div>

            {/* ================= TRACK 1: SUBTITLES (TEXT) ================= */}
            <div className="h-14 border-b border-zinc-800/80 relative bg-[#18181d]/60">
              {subtitles.map((sub) => {
                const leftPx = sub.startTime * zoomPxPerSec;
                const widthPx = Math.max(
                  18,
                  (sub.endTime - sub.startTime) * zoomPxPerSec
                );
                const isSelected =
                  selectedItemType === 'subtitle' && selectedItemId === sub.id;

                return (
                  <div
                    key={sub.id}
                    style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      if (activeTool === 'razor') {
                        const clickSec = clientXToSeconds(e.clientX);
                        splitSubtitle(sub.id, clickSec);
                        return;
                      }
                      selectItem('subtitle', sub.id);
                      useEditorStore.getState().saveHistory();
                      setDragState({
                        kind: 'sub-move',
                        id: sub.id,
                        startX: e.clientX,
                        initialStart: sub.startTime,
                        initialEnd: sub.endTime,
                      });
                    }}
                    className={`absolute top-1.5 bottom-1.5 rounded-md border flex items-center px-2 cursor-grab active:cursor-grabbing group overflow-hidden transition-colors ${
                      isSelected
                        ? 'bg-amber-500/30 border-amber-400 text-amber-100 ring-1 ring-amber-400/50 z-10'
                        : 'bg-amber-500/15 hover:bg-amber-500/25 border-amber-500/40 text-amber-200'
                    }`}
                  >
                    {/* Left Trim Handle */}
                    <div
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        selectItem('subtitle', sub.id);
                        useEditorStore.getState().saveHistory();
                        setDragState({
                          kind: 'sub-trim-left',
                          id: sub.id,
                          startX: e.clientX,
                          initialStart: sub.startTime,
                          initialEnd: sub.endTime,
                        });
                      }}
                      className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-amber-400/60"
                    />

                    <span className="text-[11px] font-medium truncate pointer-events-none">
                      {sub.text}
                    </span>

                    {/* Right Trim Handle */}
                    <div
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        selectItem('subtitle', sub.id);
                        useEditorStore.getState().saveHistory();
                        setDragState({
                          kind: 'sub-trim-right',
                          id: sub.id,
                          startX: e.clientX,
                          initialStart: sub.startTime,
                          initialEnd: sub.endTime,
                        });
                      }}
                      className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-amber-400/60"
                    />
                  </div>
                );
              })}
            </div>

            {/* ================= TRACK 2: MAIN VIDEO + AUDIO WAVEFORM ================= */}
            <div className="h-20 border-b border-zinc-800/80 relative bg-[#151519]">
              {videoClips.map((clip: VideoClip) => {
                const leftPx = clip.startTime * zoomPxPerSec;
                const widthPx = Math.max(12, clip.duration * zoomPxPerSec);
                const isSelected =
                  selectedItemType === 'video' && selectedItemId === clip.id;
                const asset = mediaAssets.find((m) => m.id === clip.mediaId);

                return (
                  <div
                    key={clip.id}
                    style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      if (activeTool === 'razor') {
                        const splitTime = clientXToSeconds(e.clientX);
                        splitVideoClipAt(clip.id, splitTime);
                        return;
                      }
                      selectItem('video', clip.id);
                    }}
                    className={`absolute top-1.5 bottom-1.5 rounded-md border flex flex-col justify-between overflow-hidden transition-colors ${
                      isSelected
                        ? 'bg-cyan-950/80 border-cyan-400 ring-1 ring-cyan-400/50 z-10'
                        : 'bg-cyan-950/45 hover:bg-cyan-950/65 border-cyan-600/40'
                    }`}
                  >
                    {/* Left Trim Handle */}
                    <div
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        selectItem('video', clip.id);
                        useEditorStore.getState().saveHistory();
                        setDragState({
                          kind: 'video-trim-left',
                          id: clip.id,
                          startX: e.clientX,
                          initialStart: clip.startTime,
                          initialEnd: clip.startTime + clip.duration,
                          initialSourceStart: clip.sourceStart,
                          initialSourceEnd: clip.sourceEnd,
                          clipSpeed: clip.speed,
                          maxAssetDur: asset?.duration || 3600,
                        });
                      }}
                      className="absolute left-0 top-0 bottom-0 w-2.5 cursor-ew-resize hover:bg-cyan-400/60 z-10"
                    />

                    {/* Clip Header Bar */}
                    <div className="h-5 px-2 bg-cyan-950/90 border-b border-cyan-500/20 flex items-center justify-between text-[10px] text-cyan-200 pointer-events-none shrink-0">
                      <span className="font-medium truncate">{clip.name}</span>
                      <div className="flex items-center gap-1 font-mono shrink-0">
                        {Math.abs(clip.speed - 1.0) > 0.01 && (
                          <span className="px-1 rounded bg-cyan-500/30 text-cyan-200 font-bold">
                            {clip.speed.toFixed(2)}x
                          </span>
                        )}
                        <span className="text-cyan-400/80">
                          {clip.duration.toFixed(1)}s
                        </span>
                      </div>
                    </div>

                    {/* Audio Waveform Area */}
                    <div className="flex-1 relative w-full overflow-hidden">
                      <ClipWaveformCanvas
                        asset={asset}
                        sourceStart={clip.sourceStart}
                        sourceEnd={clip.sourceEnd}
                        widthPx={widthPx}
                        heightPx={46}
                        color="#22d3ee"
                      />
                    </div>

                    {/* Right Trim Handle */}
                    <div
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        selectItem('video', clip.id);
                        useEditorStore.getState().saveHistory();
                        setDragState({
                          kind: 'video-trim-right',
                          id: clip.id,
                          startX: e.clientX,
                          initialStart: clip.startTime,
                          initialEnd: clip.startTime + clip.duration,
                          initialSourceStart: clip.sourceStart,
                          initialSourceEnd: clip.sourceEnd,
                          clipSpeed: clip.speed,
                          maxAssetDur: asset?.duration || 3600,
                        });
                      }}
                      className="absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize hover:bg-cyan-400/60 z-10"
                    />
                  </div>
                );
              })}

              {/* Silence / AI Cut Candidate Visual Overlays on Track 2 */}
              {showCutOverlay &&
                cutIntervals.map((ci) => {
                  const leftPx = ci.start * zoomPxPerSec;
                  const widthPx = Math.max(4, (ci.end - ci.start) * zoomPxPerSec);
                  return (
                    <div
                      key={ci.id}
                      style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setCurrentTime(ci.start);
                      }}
                      title={`${
                        ci.type === 'silence' ? '無音区間' : 'AI検出区間'
                      }: ${ci.reason || ''}`}
                      className={`absolute top-1 bottom-1 rounded pointer-events-auto cursor-pointer border z-15 flex items-center justify-center overflow-hidden ${
                        ci.selected
                          ? 'bg-rose-500/35 border-rose-400/80'
                          : 'bg-zinc-700/30 border-zinc-500/40'
                      }`}
                    >
                      <span className="text-[9px] font-bold text-rose-100 bg-rose-950/80 px-1 rounded truncate">
                        {ci.type === 'silence' ? '無音' : 'AIカット'}
                      </span>
                    </div>
                  );
                })}
            </div>

            {/* ================= TRACK 3: BGM AUDIO ================= */}
            <div className="h-14 border-b border-zinc-800/80 relative bg-[#121216]">
              {bgmClips.map((bgm) => {
                const leftPx = bgm.startTime * zoomPxPerSec;
                const widthPx = Math.max(18, bgm.duration * zoomPxPerSec);
                const isSelected =
                  selectedItemType === 'bgm' && selectedItemId === bgm.id;
                const asset = mediaAssets.find((m) => m.id === bgm.mediaId);

                return (
                  <div
                    key={bgm.id}
                    style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      selectItem('bgm', bgm.id);
                      useEditorStore.getState().saveHistory();
                      setDragState({
                        kind: 'bgm-move',
                        id: bgm.id,
                        startX: e.clientX,
                        initialStart: bgm.startTime,
                        initialEnd: bgm.startTime + bgm.duration,
                      });
                    }}
                    className={`absolute top-1.5 bottom-1.5 rounded-md border flex flex-col justify-between overflow-hidden cursor-grab active:cursor-grabbing ${
                      isSelected
                        ? 'bg-emerald-950/80 border-emerald-400 ring-1 ring-emerald-400/50 z-10'
                        : 'bg-emerald-950/40 hover:bg-emerald-950/60 border-emerald-600/40'
                    }`}
                  >
                    <div className="h-4 px-2 bg-emerald-950/90 flex items-center justify-between text-[10px] text-emerald-200 pointer-events-none">
                      <span className="truncate">{bgm.name}</span>
                      <span className="font-mono">
                        {Math.round(bgm.volume * 100)}%
                      </span>
                    </div>

                    <div className="flex-1 relative w-full overflow-hidden">
                      <ClipWaveformCanvas
                        asset={asset}
                        sourceStart={bgm.sourceStart}
                        sourceEnd={bgm.sourceStart + bgm.duration}
                        widthPx={widthPx}
                        heightPx={28}
                        color="#34d399"
                        fadeInSec={bgm.fadeIn}
                        fadeOutSec={bgm.fadeOut}
                        clipDurationSec={bgm.duration}
                      />
                    </div>

                    {/* Right Trim Handle */}
                    <div
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        selectItem('bgm', bgm.id);
                        useEditorStore.getState().saveHistory();
                        setDragState({
                          kind: 'bgm-trim-right',
                          id: bgm.id,
                          startX: e.clientX,
                          initialStart: bgm.startTime,
                          initialEnd: bgm.startTime + bgm.duration,
                        });
                      }}
                      className="absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize hover:bg-emerald-400/60 z-10"
                    />
                  </div>
                );
              })}
            </div>

            {/* ================= RED PLAYHEAD (再生ヘッド) ================= */}
            <div
              style={{ left: `${currentTime * zoomPxPerSec}px` }}
              className="absolute top-0 bottom-0 w-px bg-rose-500 z-30 pointer-events-none"
            >
              {/* Playhead Cap */}
              <div
                onMouseDown={handleRulerMouseDown}
                className=" -ml-2 w-4 h-4 bg-rose-500 rotate-45 rounded-xs shadow cursor-ew-resize pointer-events-auto"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

