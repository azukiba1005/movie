import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  Repeat,
  ShieldAlert,
  Maximize2,
} from 'lucide-react';
import { useEditorStore } from '../store/useEditorStore';
import {
  getCanvasDimensions,
  renderCompositeFrame,
} from '../utils/canvasRenderer';

export function formatTimecode(seconds: number, fps = 30): string {
  const safeSec = Math.max(0, seconds || 0);
  const totalFrames = Math.floor(safeSec * fps);
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(safeSec);
  const secs = totalSeconds % 60;
  const mins = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}:${pad(frames)}`;
}

export const PreviewPlayer: React.FC = () => {
  const aspectRatio = useEditorStore((s) => s.aspectRatio);
  const mediaAssets = useEditorStore((s) => s.mediaAssets);
  const videoClips = useEditorStore((s) => s.videoClips);
  const subtitles = useEditorStore((s) => s.subtitles);
  const bgmClips = useEditorStore((s) => s.bgmClips);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const currentTime = useEditorStore((s) => s.currentTime);
  const loopPlayback = useEditorStore((s) => s.loopPlayback);
  const showSafeZone = useEditorStore((s) => s.showSafeZone);
  const cutIntervals = useEditorStore((s) => s.cutIntervals);
  const selectedItemId = useEditorStore((s) => s.selectedItemId);
  const selectedItemType = useEditorStore((s) => s.selectedItemType);

  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const setLoopPlayback = useEditorStore((s) => s.setLoopPlayback);
  const setShowSafeZone = useEditorStore((s) => s.setShowSafeZone);
  const updateSubtitle = useEditorStore((s) => s.updateSubtitle);
  const selectItem = useEditorStore((s) => s.selectItem);
  const getTotalDuration = useEditorStore((s) => s.getTotalDuration);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeVideoUrlRef = useRef<string>('');
  const activeBgmUrlRef = useRef<string>('');
  const activeClipIdRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFramePerfRef = useRef<number>(0);

  // Dragging subtitle directly on Canvas
  const [draggingSubId, setDraggingSubId] = useState<string | null>(null);

  const { width: canvasWidth, height: canvasHeight } =
    getCanvasDimensions(aspectRatio);

  // Find active video clip at given timeline time
  const getActiveClipAt = useCallback(
    (t: number) => {
      return (
        videoClips.find(
          (c) => t >= c.startTime && t < c.startTime + c.duration
        ) || null
      );
    },
    [videoClips]
  );

  // Find active BGM clip at given timeline time
  const getActiveBgmAt = useCallback(
    (t: number) => {
      return (
        bgmClips.find(
          (b) => t >= b.startTime && t < b.startTime + b.duration
        ) || null
      );
    },
    [bgmClips]
  );

  // Sync underlying <video> & <audio> elements to timeline time
  const syncMediaElements = useCallback(
    (timelineTime: number, playing: boolean) => {
      const videoEl = videoRef.current;
      const activeClip = getActiveClipAt(timelineTime);

      if (videoEl) {
        if (activeClip) {
          const asset = mediaAssets.find((m) => m.id === activeClip.mediaId);
          if (asset && asset.objectUrl && !asset.missingFile) {
            if (activeVideoUrlRef.current !== asset.objectUrl) {
              activeVideoUrlRef.current = asset.objectUrl;
              videoEl.src = asset.objectUrl;
              videoEl.load();
            }

            const targetSourceTime =
              activeClip.sourceStart +
              (timelineTime - activeClip.startTime) * activeClip.speed;

            const safeRate = Math.max(0.25, Math.min(4.0, activeClip.speed));
            if (Math.abs(videoEl.playbackRate - safeRate) > 0.01) {
              videoEl.playbackRate = safeRate;
            }

            const effectiveVol = activeClip.muted
              ? 0
              : Math.max(0, Math.min(1, activeClip.volume));
            if (Math.abs(videoEl.volume - effectiveVol) > 0.01) {
              videoEl.volume = effectiveVol;
            }

            const driftThreshold = playing ? 0.22 * safeRate : 0.03;
            if (
              Math.abs(videoEl.currentTime - targetSourceTime) >
                driftThreshold ||
              activeClipIdRef.current !== activeClip.id
            ) {
              try {
                videoEl.currentTime = Math.max(0, targetSourceTime);
              } catch {
                // Ignore if metadata not yet loaded
              }
              activeClipIdRef.current = activeClip.id;
            }

            if (playing && videoEl.paused && videoEl.readyState >= 2) {
              videoEl.play().catch(() => {});
            } else if (!playing && !videoEl.paused) {
              videoEl.pause();
            }
          } else {
            if (!videoEl.paused) videoEl.pause();
          }
        } else {
          if (!videoEl.paused) videoEl.pause();
          activeClipIdRef.current = null;
        }
      }

      // Sync BGM audio element
      const bgmEl = bgmAudioRef.current;
      const activeBgm = getActiveBgmAt(timelineTime);
      if (bgmEl) {
        if (activeBgm && !activeBgm.muted) {
          const asset = mediaAssets.find((m) => m.id === activeBgm.mediaId);
          if (asset && asset.objectUrl) {
            if (activeBgmUrlRef.current !== asset.objectUrl) {
              activeBgmUrlRef.current = asset.objectUrl;
              bgmEl.src = asset.objectUrl;
              bgmEl.load();
            }

            const relBgmTime = timelineTime - activeBgm.startTime;
            const targetBgmSource = activeBgm.sourceStart + relBgmTime;

            // Compute fade-in / fade-out envelope multiplier
            let fadeGain = 1.0;
            if (activeBgm.fadeIn > 0 && relBgmTime < activeBgm.fadeIn) {
              fadeGain = Math.max(0, relBgmTime / activeBgm.fadeIn);
            }
            const remaining = activeBgm.duration - relBgmTime;
            if (activeBgm.fadeOut > 0 && remaining < activeBgm.fadeOut) {
              fadeGain = Math.min(
                fadeGain,
                Math.max(0, remaining / activeBgm.fadeOut)
              );
            }

            bgmEl.volume = Math.max(
              0,
              Math.min(1, activeBgm.volume * fadeGain)
            );

            if (Math.abs(bgmEl.currentTime - targetBgmSource) > 0.25) {
              try {
                bgmEl.currentTime = Math.max(0, targetBgmSource);
              } catch {
                // Ignore
              }
            }

            if (playing && bgmEl.paused && bgmEl.readyState >= 2) {
              bgmEl.play().catch(() => {});
            } else if (!playing && !bgmEl.paused) {
              bgmEl.pause();
            }
          }
        } else {
          if (!bgmEl.paused) bgmEl.pause();
        }
      }
    },
    [getActiveClipAt, getActiveBgmAt, mediaAssets]
  );

  // Draw current composite frame to Canvas
  const drawCurrentFrame = useCallback(
    (t: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const activeClip = getActiveClipAt(t);
      const asset = activeClip
        ? mediaAssets.find((m) => m.id === activeClip.mediaId)
        : undefined;

      renderCompositeFrame({
        ctx,
        canvasWidth,
        canvasHeight,
        aspectRatio,
        timelineTime: t,
        activeClip,
        videoElement: videoRef.current,
        subtitles,
        showSafeZone,
        missingVideoFile: Boolean(asset?.missingFile),
      });
    },
    [
      canvasWidth,
      canvasHeight,
      aspectRatio,
      getActiveClipAt,
      mediaAssets,
      subtitles,
      showSafeZone,
    ]
  );

  // Main 60fps requestAnimationFrame loop
  useEffect(() => {
    lastFramePerfRef.current = performance.now();

    const tick = (now: number) => {
      const state = useEditorStore.getState();
      if (state.isPlaying) {
        const dt = Math.min(0.1, (now - lastFramePerfRef.current) / 1000);
        lastFramePerfRef.current = now;

        const totalDur = state.getTotalDuration();
        let nextTime = state.currentTime + dt;

        if (nextTime >= totalDur) {
          if (state.loopPlayback) {
            nextTime = 0;
          } else {
            nextTime = totalDur;
            state.setIsPlaying(false);
          }
        }

        state.setCurrentTime(nextTime);
        syncMediaElements(nextTime, state.isPlaying);
        drawCurrentFrame(nextTime);
      } else {
        lastFramePerfRef.current = now;
        syncMediaElements(state.currentTime, false);
        drawCurrentFrame(state.currentTime);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [syncMediaElements, drawCurrentFrame]);

  // Re-draw immediately when currentTime, subtitles, or aspectRatio changes while paused
  useEffect(() => {
    if (!isPlaying) {
      syncMediaElements(currentTime, false);
      drawCurrentFrame(currentTime);
    }
  }, [currentTime, isPlaying, subtitles, aspectRatio, showSafeZone, syncMediaElements, drawCurrentFrame]);

  // Interactive Canvas drag to reposition active subtitle
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const activeSubs = subtitles.filter(
      (s) => currentTime >= s.startTime && currentTime <= s.endTime
    );
    if (activeSubs.length === 0) return;

    const targetSub =
      activeSubs.find(
        (s) => selectedItemType === 'subtitle' && s.id === selectedItemId
      ) || activeSubs[activeSubs.length - 1];

    selectItem('subtitle', targetSub.id);
    useEditorStore.getState().saveHistory();
    setDraggingSubId(targetSub.id);
    e.preventDefault();
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!draggingSubId || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * 100;
    const relY = ((e.clientY - rect.top) / rect.height) * 100;

    updateSubtitle(
      draggingSubId,
      {
        style: {
          x: Number(Math.max(5, Math.min(95, relX)).toFixed(1)),
          y: Number(Math.max(5, Math.min(95, relY)).toFixed(1)),
        },
      },
      false
    );
  };

  const handleCanvasMouseUp = () => {
    if (draggingSubId) {
      setDraggingSubId(null);
    }
  };

  const totalDuration = getTotalDuration();
  const activeClip = getActiveClipAt(currentTime);
  const activeCutCandidate = cutIntervals.find(
    (ci) => ci.selected && currentTime >= ci.start && currentTime <= ci.end
  );

  return (
    <div className="flex flex-col h-full bg-[#141417] border-r border-zinc-800 select-none overflow-hidden">
      {/* Hidden Video & BGM Audio Elements */}
      <video
        ref={videoRef}
        className="hidden"
        playsInline
        preload="auto"
        crossOrigin="anonymous"
      />
      <audio ref={bgmAudioRef} className="hidden" preload="auto" />

      {/* Top Monitor Status Bar */}
      <div className="h-8 px-3 bg-[#1c1c20] border-b border-zinc-800/80 flex items-center justify-between text-xs text-zinc-400 shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-zinc-200 tracking-wide">
            PROGRAM MONITOR
          </span>
          <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono text-[11px]">
            {aspectRatio === '16:9' ? '1920×1080 (16:9)' : '1080×1920 (9:16)'}
          </span>
          {activeClip && (
            <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-mono text-[11px]">
              {activeClip.speed.toFixed(2)}x
            </span>
          )}
          {activeCutCandidate && (
            <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[11px] font-medium animate-pulse">
              カット候補区間 ({activeCutCandidate.type === 'silence' ? '無音' : 'AI検出'})
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowSafeZone(!showSafeZone)}
            title="YouTube / ショート セーフゾーン枠の表示切替"
            className={`px-2 py-0.5 rounded text-[11px] flex items-center gap-1 transition ${
              showSafeZone
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'hover:bg-zinc-800 text-zinc-400'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>セーフゾーン</span>
          </button>
        </div>
      </div>

      {/* Center Canvas Viewport */}
      <div
        className="flex-1 relative flex items-center justify-center p-3 overflow-hidden bg-[#0e0e11]"
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseUp}
      >
        <div
          className={`relative flex items-center justify-center shadow-2xl ring-1 ring-zinc-800 bg-black overflow-hidden ${
            aspectRatio === '16:9'
              ? 'w-full max-w-[820px] aspect-video max-h-full'
              : 'h-full max-h-full aspect-[9/16]'
          }`}
        >
          <canvas
            ref={canvasRef}
            width={canvasWidth}
            height={canvasHeight}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            className="w-full h-full object-contain cursor-move"
          />

          {videoClips.length === 0 && subtitles.length === 0 && (
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center text-center p-6 bg-black/40 backdrop-blur-[1px]">
              <Maximize2 className="w-8 h-8 text-cyan-400/70 mb-2" />
              <p className="text-sm font-medium text-zinc-200">
                左パネルから動画・BGM・フォントを追加するか、デモ素材を読み込んでください
              </p>
              <p className="text-xs text-zinc-400 mt-1">
                プレビュー上のテロップはマウスドラッグで直感的に位置調整できます
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Transport Controls & Timecode Bar */}
      <div className="h-11 px-4 bg-[#1c1c20] border-t border-zinc-800 flex items-center justify-between shrink-0">
        {/* Left: Current Timecode */}
        <div className="flex items-center gap-2 min-w-[165px]">
          <span className="font-mono text-sm font-semibold text-cyan-400 tracking-wider bg-zinc-900/90 px-2.5 py-1 rounded border border-zinc-800">
            {formatTimecode(currentTime)}
          </span>
          <span className="text-[11px] font-mono text-zinc-500">
            ({currentTime.toFixed(2)}s)
          </span>
        </div>

        {/* Center: Transport Buttons */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              setIsPlaying(false);
              setCurrentTime(0);
            }}
            title="先頭へ移動 (Home)"
            className="p-1.5 rounded hover:bg-zinc-800 text-zinc-300 hover:text-white transition"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              setIsPlaying(false);
              setCurrentTime(Math.max(0, currentTime - 1 / 30));
            }}
            title="1フレーム戻る (←)"
            className="p-1.5 rounded hover:bg-zinc-800 text-zinc-300 hover:text-white transition"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              if (!isPlaying && currentTime >= totalDuration - 0.05) {
                setCurrentTime(0);
              }
              setIsPlaying(!isPlaying);
            }}
            title="再生 / 一時停止 (Space)"
            className={`px-3.5 py-1.5 rounded-md font-medium flex items-center gap-1.5 transition shadow ${
              isPlaying
                ? 'bg-amber-500 hover:bg-amber-400 text-zinc-950'
                : 'bg-cyan-500 hover:bg-cyan-400 text-zinc-950'
            }`}
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current" />
            )}
          </button>

          <button
            onClick={() => {
              setIsPlaying(false);
              setCurrentTime(Math.min(totalDuration, currentTime + 1 / 30));
            }}
            title="1フレーム進む (→)"
            className="p-1.5 rounded hover:bg-zinc-800 text-zinc-300 hover:text-white transition"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              setIsPlaying(false);
              setCurrentTime(totalDuration);
            }}
            title="末尾へ移動 (End)"
            className="p-1.5 rounded hover:bg-zinc-800 text-zinc-300 hover:text-white transition"
          >
            <SkipForward className="w-4 h-4" />
          </button>

          <div className="w-px h-4 bg-zinc-800 mx-1" />

          <button
            onClick={() => setLoopPlayback(!loopPlayback)}
            title="ループ再生"
            className={`p-1.5 rounded transition ${
              loopPlayback
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'hover:bg-zinc-800 text-zinc-400'
            }`}
          >
            <Repeat className="w-4 h-4" />
          </button>
        </div>

        {/* Right: Total Duration Timecode */}
        <div className="flex items-center justify-end gap-2 min-w-[165px]">
          <span className="text-[11px] text-zinc-500">TOTAL</span>
          <span className="font-mono text-sm text-zinc-300 bg-zinc-900/70 px-2.5 py-1 rounded border border-zinc-800">
            {formatTimecode(totalDuration)}
          </span>
        </div>
      </div>
    </div>
  );
};

