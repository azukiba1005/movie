import React from 'react';
import {
  Sliders,
  Type,
  Gauge,
  Volume2,
  VolumeX,
  Move,
  RotateCcw,
  AlignLeft,
  AlignCenter,
  AlignRight,
  CopyCheck,
  Sparkles,
  Layers,
  Square as SquareIcon,
  SunDim,
} from 'lucide-react';
import {
  BUILTIN_FONTS,
  SUBTITLE_STYLE_PRESETS,
  useEditorStore,
} from '../store/useEditorStore';
import { SubtitleStyle } from '../types/editor';

export const Inspector: React.FC = () => {
  const inspectorTab = useEditorStore((s) => s.inspectorTab);
  const selectedItemType = useEditorStore((s) => s.selectedItemType);
  const selectedItemId = useEditorStore((s) => s.selectedItemId);
  const currentTime = useEditorStore((s) => s.currentTime);
  const videoClips = useEditorStore((s) => s.videoClips);
  const subtitles = useEditorStore((s) => s.subtitles);
  const bgmClips = useEditorStore((s) => s.bgmClips);
  const customFonts = useEditorStore((s) => s.customFonts);
  const defaultSubtitleStyle = useEditorStore((s) => s.defaultSubtitleStyle);

  const setInspectorTab = useEditorStore((s) => s.setInspectorTab);
  const updateVideoClip = useEditorStore((s) => s.updateVideoClip);
  const updateVideoClipSpeed = useEditorStore((s) => s.updateVideoClipSpeed);
  const updateBgmClip = useEditorStore((s) => s.updateBgmClip);
  const updateSubtitle = useEditorStore((s) => s.updateSubtitle);
  const updateDefaultSubtitleStyle = useEditorStore(
    (s) => s.updateDefaultSubtitleStyle
  );
  const applyStyleToAllSubtitles = useEditorStore(
    (s) => s.applyStyleToAllSubtitles
  );

  // Resolve target video clip (selected or under playhead)
  const targetVideoClip =
    (selectedItemType === 'video' &&
      videoClips.find((c) => c.id === selectedItemId)) ||
    videoClips.find(
      (c) =>
        currentTime >= c.startTime && currentTime < c.startTime + c.duration
    ) ||
    videoClips[0] ||
    null;

  // Resolve target BGM clip (if selected)
  const targetBgmClip =
    selectedItemType === 'bgm'
      ? bgmClips.find((b) => b.id === selectedItemId) || null
      : null;

  // Resolve target subtitle (selected or active at playhead)
  const targetSubtitle =
    (selectedItemType === 'subtitle' &&
      subtitles.find((s) => s.id === selectedItemId)) ||
    subtitles.find(
      (s) => currentTime >= s.startTime && currentTime <= s.endTime
    ) ||
    null;

  const activeStyle: SubtitleStyle = targetSubtitle
    ? targetSubtitle.style
    : defaultSubtitleStyle;

  const handleStyleChange = (
    patch: Partial<SubtitleStyle>,
    recordHistory = false
  ) => {
    if (targetSubtitle) {
      updateSubtitle(targetSubtitle.id, { style: patch }, recordHistory);
    }
    updateDefaultSubtitleStyle(patch);
  };

  return (
    <div className="flex flex-col h-full bg-[#1b1b1f] select-none overflow-hidden">
      {/* Top Tab Switcher */}
      <div className="h-9 px-2 bg-[#16161a] border-b border-zinc-800 grid grid-cols-2 gap-1 items-center shrink-0">
        <button
          onClick={() => setInspectorTab('subtitle')}
          className={`h-7 px-2 rounded text-xs font-medium flex items-center justify-center gap-1.5 transition ${
            inspectorTab === 'subtitle'
              ? 'bg-zinc-800 text-cyan-300 border border-zinc-700'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
          }`}
        >
          <Type className="w-3.5 h-3.5" />
          <span>テロップ装飾</span>
        </button>

        <button
          onClick={() => setInspectorTab('clip')}
          className={`h-7 px-2 rounded text-xs font-medium flex items-center justify-center gap-1.5 transition ${
            inspectorTab === 'clip'
              ? 'bg-zinc-800 text-cyan-300 border border-zinc-700'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>クリップ・速度・音量</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* ================= TAB 1: SUBTITLE DETAILED DESIGN INSPECTOR ================= */}
        {inspectorTab === 'subtitle' && (
          <>
            {/* Active Target Indicator & Batch Apply Button */}
            <div className="p-2.5 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-zinc-400">編集対象:</span>
                <span className="font-semibold text-cyan-300 truncate max-w-[180px]">
                  {targetSubtitle
                    ? `「${targetSubtitle.text.slice(0, 14)}」`
                    : 'デフォルトスタイル'}
                </span>
              </div>

              {targetSubtitle && (
                <textarea
                  rows={2}
                  value={targetSubtitle.text}
                  onChange={(e) =>
                    updateSubtitle(targetSubtitle.id, { text: e.target.value })
                  }
                  className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-700 focus:border-cyan-500 focus:outline-none text-xs text-zinc-100 resize-none"
                  placeholder="テロップ文字列..."
                />
              )}

              <button
                onClick={() => applyStyleToAllSubtitles(activeStyle)}
                className="w-full py-2 px-3 rounded-lg bg-gradient-to-r from-cyan-500/20 to-blue-500/20 hover:from-cyan-500/30 hover:to-blue-500/30 text-cyan-300 border border-cyan-500/40 font-bold text-xs flex items-center justify-center gap-1.5 transition shadow-sm"
              >
                <CopyCheck className="w-3.5 h-3.5" />
                <span>現在のテロップスタイルを全テロップに一括適用</span>
              </button>
            </div>

            {/* Quick Presets */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-400" />
                <span>ワンクリック装飾プリセット</span>
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {SUBTITLE_STYLE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => handleStyleChange(preset.style, true)}
                    title={preset.description}
                    className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-left transition"
                  >
                    <div className="text-[11px] font-semibold text-zinc-200 truncate">
                      {preset.name}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Font Family & Typography */}
            <div className="p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-3">
              <div className="text-xs font-bold text-zinc-200 flex items-center gap-1.5">
                <Type className="w-3.5 h-3.5 text-cyan-400" />
                <span>フォント & 文字設定</span>
              </div>

              {/* Font Selector (Custom Fonts + Built-in Fonts) */}
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  フォントファミリー（カスタムフォント動的反映）
                </label>
                <select
                  value={activeStyle.fontFamily}
                  onChange={(e) =>
                    handleStyleChange({ fontFamily: e.target.value }, true)
                  }
                  className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
                >
                  {customFonts.length > 0 && (
                    <optgroup label="アップロード済みカスタムフォント">
                      {customFonts.map((cf) => (
                        <option key={cf.id} value={`"${cf.name}", sans-serif`}>
                          ★ {cf.name} ({cf.fileName})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="標準搭載フォント">
                    {BUILTIN_FONTS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              {/* Size & Weight & Color */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] text-zinc-400 mb-1">
                    サイズ ({activeStyle.fontSize}px)
                  </label>
                  <input
                    type="number"
                    min={16}
                    max={160}
                    value={activeStyle.fontSize}
                    onChange={(e) =>
                      handleStyleChange({
                        fontSize: Math.max(12, Number(e.target.value)),
                      })
                    }
                    className="w-full px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-xs text-zinc-100 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-zinc-400 mb-1">
                    太さ (Weight)
                  </label>
                  <select
                    value={activeStyle.fontWeight}
                    onChange={(e) =>
                      handleStyleChange({
                        fontWeight: Number(e.target.value),
                      })
                    }
                    className="w-full px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-xs text-zinc-100"
                  >
                    <option value={500}>中 (500)</option>
                    <option value={700}>太字 (700)</option>
                    <option value={900}>極太 (900)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] text-zinc-400 mb-1">
                    文字色
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="color"
                      value={activeStyle.color}
                      onChange={(e) =>
                        handleStyleChange({ color: e.target.value })
                      }
                      className="w-7 h-7 rounded bg-zinc-950 border border-zinc-700 cursor-pointer shrink-0"
                    />
                    <input
                      type="text"
                      value={activeStyle.color}
                      onChange={(e) =>
                        handleStyleChange({ color: e.target.value })
                      }
                      className="w-full px-1.5 py-1 rounded bg-zinc-950 border border-zinc-700 text-[10px] font-mono text-zinc-200"
                    />
                  </div>
                </div>
              </div>

              {/* Line Height & Letter Spacing */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex justify-between text-[10px] text-zinc-400 mb-1">
                    <span>行間</span>
                    <span className="font-mono text-zinc-200">
                      {activeStyle.lineHeight.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1.0}
                    max={2.0}
                    step={0.05}
                    value={activeStyle.lineHeight}
                    onChange={(e) =>
                      handleStyleChange({ lineHeight: Number(e.target.value) })
                    }
                    className="w-full accent-cyan-500 h-1.5 bg-zinc-800 rounded-lg"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[10px] text-zinc-400 mb-1">
                    <span>文字間隔</span>
                    <span className="font-mono text-zinc-200">
                      {activeStyle.letterSpacing}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-2}
                    max={20}
                    step={1}
                    value={activeStyle.letterSpacing}
                    onChange={(e) =>
                      handleStyleChange({
                        letterSpacing: Number(e.target.value),
                      })
                    }
                    className="w-full accent-cyan-500 h-1.5 bg-zinc-800 rounded-lg"
                  />
                </div>
              </div>

              {/* Position X/Y & Alignment Presets */}
              <div className="space-y-2 pt-1 border-t border-zinc-800/80">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-zinc-400">
                    配置 (X: {activeStyle.x.toFixed(0)}% / Y:{' '}
                    {activeStyle.y.toFixed(0)}%)
                  </span>
                  <div className="flex items-center bg-zinc-950 rounded border border-zinc-800 p-0.5">
                    <button
                      onClick={() => handleStyleChange({ align: 'left' })}
                      className={`p-1 rounded ${
                        activeStyle.align === 'left'
                          ? 'bg-cyan-500/20 text-cyan-300'
                          : 'text-zinc-400'
                      }`}
                    >
                      <AlignLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleStyleChange({ align: 'center' })}
                      className={`p-1 rounded ${
                        activeStyle.align === 'center'
                          ? 'bg-cyan-500/20 text-cyan-300'
                          : 'text-zinc-400'
                      }`}
                    >
                      <AlignCenter className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleStyleChange({ align: 'right' })}
                      className={`p-1 rounded ${
                        activeStyle.align === 'right'
                          ? 'bg-cyan-500/20 text-cyan-300'
                          : 'text-zinc-400'
                      }`}
                    >
                      <AlignRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] text-zinc-500">X座標 (%)</span>
                    <input
                      type="range"
                      min={5}
                      max={95}
                      step={1}
                      value={activeStyle.x}
                      onChange={(e) =>
                        handleStyleChange({ x: Number(e.target.value) })
                      }
                      className="w-full accent-cyan-500 h-1.5 bg-zinc-800 rounded-lg"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-500">Y座標 (%)</span>
                    <input
                      type="range"
                      min={5}
                      max={95}
                      step={1}
                      value={activeStyle.y}
                      onChange={(e) =>
                        handleStyleChange({ y: Number(e.target.value) })
                      }
                      className="w-full accent-cyan-500 h-1.5 bg-zinc-800 rounded-lg"
                    />
                  </div>
                </div>

                {/* Preset Placement Buttons */}
                <div className="grid grid-cols-4 gap-1 text-[10px]">
                  <button
                    onClick={() =>
                      handleStyleChange({ x: 50, y: 14, align: 'center' })
                    }
                    className="py-1 rounded bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300"
                  >
                    上部中央
                  </button>
                  <button
                    onClick={() =>
                      handleStyleChange({ x: 50, y: 50, align: 'center' })
                    }
                    className="py-1 rounded bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300"
                  >
                    画面中央
                  </button>
                  <button
                    onClick={() =>
                      handleStyleChange({ x: 50, y: 74, align: 'center' })
                    }
                    className="py-1 rounded bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300"
                  >
                    ショート推奨
                  </button>
                  <button
                    onClick={() =>
                      handleStyleChange({ x: 50, y: 86, align: 'center' })
                    }
                    className="py-1 rounded bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300"
                  >
                    下部標準
                  </button>
                </div>
              </div>
            </div>

            {/* Double Outline (二重縁取り) */}
            <div className="p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-3">
              <div className="text-xs font-bold text-zinc-200 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-cyan-400" />
                <span>二重縁取り（アウトライン）設定</span>
              </div>

              {/* Inner Outline */}
              <div className="space-y-1.5 p-2 rounded-lg bg-zinc-950/70 border border-zinc-800/80">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={activeStyle.innerOutline.enabled}
                      onChange={(e) =>
                        handleStyleChange({
                          innerOutline: {
                            ...activeStyle.innerOutline,
                            enabled: e.target.checked,
                          },
                        })
                      }
                      className="accent-cyan-500"
                    />
                    <span>内側枠線 (Inner Outline)</span>
                  </label>
                  <input
                    type="color"
                    value={activeStyle.innerOutline.color}
                    onChange={(e) =>
                      handleStyleChange({
                        innerOutline: {
                          ...activeStyle.innerOutline,
                          color: e.target.value,
                        },
                      })
                    }
                    className="w-6 h-6 rounded bg-zinc-900 border border-zinc-700 cursor-pointer"
                  />
                </div>
                {activeStyle.innerOutline.enabled && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-400 w-16">
                      太さ: {activeStyle.innerOutline.width}px
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={28}
                      value={activeStyle.innerOutline.width}
                      onChange={(e) =>
                        handleStyleChange({
                          innerOutline: {
                            ...activeStyle.innerOutline,
                            width: Number(e.target.value),
                          },
                        })
                      }
                      className="flex-1 accent-cyan-500 h-1.5 bg-zinc-800 rounded-lg"
                    />
                  </div>
                )}
              </div>

              {/* Outer Outline */}
              <div className="space-y-1.5 p-2 rounded-lg bg-zinc-950/70 border border-zinc-800/80">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={activeStyle.outerOutline.enabled}
                      onChange={(e) =>
                        handleStyleChange({
                          outerOutline: {
                            ...activeStyle.outerOutline,
                            enabled: e.target.checked,
                          },
                        })
                      }
                      className="accent-cyan-500"
                    />
                    <span>外側枠線 (Outer Outline)</span>
                  </label>
                  <input
                    type="color"
                    value={activeStyle.outerOutline.color}
                    onChange={(e) =>
                      handleStyleChange({
                        outerOutline: {
                          ...activeStyle.outerOutline,
                          color: e.target.value,
                        },
                      })
                    }
                    className="w-6 h-6 rounded bg-zinc-900 border border-zinc-700 cursor-pointer"
                  />
                </div>
                {activeStyle.outerOutline.enabled && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-400 w-16">
                      太さ: {activeStyle.outerOutline.width}px
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={32}
                      value={activeStyle.outerOutline.width}
                      onChange={(e) =>
                        handleStyleChange({
                          outerOutline: {
                            ...activeStyle.outerOutline,
                            width: Number(e.target.value),
                          },
                        })
                      }
                      className="flex-1 accent-cyan-500 h-1.5 bg-zinc-800 rounded-lg"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Background Box (背景座布団) */}
            <div className="p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs font-bold text-zinc-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={activeStyle.background.enabled}
                    onChange={(e) =>
                      handleStyleChange({
                        background: {
                          ...activeStyle.background,
                          enabled: e.target.checked,
                        },
                      })
                    }
                    className="accent-cyan-500"
                  />
                  <SquareIcon className="w-3.5 h-3.5 text-emerald-400" />
                  <span>背景座布団 (Background Box)</span>
                </label>
                <input
                  type="color"
                  value={activeStyle.background.color}
                  onChange={(e) =>
                    handleStyleChange({
                      background: {
                        ...activeStyle.background,
                        color: e.target.value,
                      },
                    })
                  }
                  className="w-6 h-6 rounded bg-zinc-950 border border-zinc-700 cursor-pointer"
                />
              </div>

              {activeStyle.background.enabled && (
                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <div>
                    <div className="flex justify-between text-[10px] text-zinc-400">
                      <span>不透明度</span>
                      <span>
                        {Math.round(activeStyle.background.opacity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.1}
                      max={1.0}
                      step={0.05}
                      value={activeStyle.background.opacity}
                      onChange={(e) =>
                        handleStyleChange({
                          background: {
                            ...activeStyle.background,
                            opacity: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full accent-cyan-500 h-1.5 bg-zinc-800 rounded-lg"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[10px] text-zinc-400">
                      <span>角丸 (Radius)</span>
                      <span>{activeStyle.background.borderRadius}px</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={48}
                      value={activeStyle.background.borderRadius}
                      onChange={(e) =>
                        handleStyleChange({
                          background: {
                            ...activeStyle.background,
                            borderRadius: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full accent-cyan-500 h-1.5 bg-zinc-800 rounded-lg"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[10px] text-zinc-400">
                      <span>横余白 (Pad X)</span>
                      <span>{activeStyle.background.paddingX}px</span>
                    </div>
                    <input
                      type="range"
                      min={4}
                      max={64}
                      value={activeStyle.background.paddingX}
                      onChange={(e) =>
                        handleStyleChange({
                          background: {
                            ...activeStyle.background,
                            paddingX: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full accent-cyan-500 h-1.5 bg-zinc-800 rounded-lg"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[10px] text-zinc-400">
                      <span>縦余白 (Pad Y)</span>
                      <span>{activeStyle.background.paddingY}px</span>
                    </div>
                    <input
                      type="range"
                      min={2}
                      max={48}
                      value={activeStyle.background.paddingY}
                      onChange={(e) =>
                        handleStyleChange({
                          background: {
                            ...activeStyle.background,
                            paddingY: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full accent-cyan-500 h-1.5 bg-zinc-800 rounded-lg"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Drop Shadow (ドロップシャドウ) */}
            <div className="p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs font-bold text-zinc-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={activeStyle.shadow.enabled}
                    onChange={(e) =>
                      handleStyleChange({
                        shadow: {
                          ...activeStyle.shadow,
                          enabled: e.target.checked,
                        },
                      })
                    }
                    className="accent-cyan-500"
                  />
                  <SunDim className="w-3.5 h-3.5 text-amber-400" />
                  <span>ドロップシャドウ (影)</span>
                </label>
                <input
                  type="color"
                  value={
                    activeStyle.shadow.color.startsWith('#')
                      ? activeStyle.shadow.color
                      : '#000000'
                  }
                  onChange={(e) =>
                    handleStyleChange({
                      shadow: {
                        ...activeStyle.shadow,
                        color: e.target.value,
                      },
                    })
                  }
                  className="w-6 h-6 rounded bg-zinc-950 border border-zinc-700 cursor-pointer"
                />
              </div>

              {activeStyle.shadow.enabled && (
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <div>
                    <div className="text-[10px] text-zinc-400 mb-0.5">
                      ぼかし ({activeStyle.shadow.blur}px)
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={30}
                      value={activeStyle.shadow.blur}
                      onChange={(e) =>
                        handleStyleChange({
                          shadow: {
                            ...activeStyle.shadow,
                            blur: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full accent-cyan-500 h-1.5 bg-zinc-800 rounded-lg"
                    />
                  </div>

                  <div>
                    <div className="text-[10px] text-zinc-400 mb-0.5">
                      X ({activeStyle.shadow.offsetX}px)
                    </div>
                    <input
                      type="range"
                      min={-20}
                      max={20}
                      value={activeStyle.shadow.offsetX}
                      onChange={(e) =>
                        handleStyleChange({
                          shadow: {
                            ...activeStyle.shadow,
                            offsetX: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full accent-cyan-500 h-1.5 bg-zinc-800 rounded-lg"
                    />
                  </div>

                  <div>
                    <div className="text-[10px] text-zinc-400 mb-0.5">
                      Y ({activeStyle.shadow.offsetY}px)
                    </div>
                    <input
                      type="range"
                      min={-20}
                      max={20}
                      value={activeStyle.shadow.offsetY}
                      onChange={(e) =>
                        handleStyleChange({
                          shadow: {
                            ...activeStyle.shadow,
                            offsetY: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full accent-cyan-500 h-1.5 bg-zinc-800 rounded-lg"
                    />
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* ================= TAB 2: VIDEO CLIP & BGM INSPECTOR ================= */}
        {inspectorTab === 'clip' && (
          <>
            {/* BGM Clip Settings (when BGM is selected) */}
            {targetBgmClip && (
              <div className="p-3.5 rounded-xl bg-zinc-900/90 border border-emerald-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-emerald-300">
                    BGMクリップ設定: {targetBgmClip.name}
                  </div>
                  <button
                    onClick={() =>
                      updateBgmClip(
                        targetBgmClip.id,
                        { muted: !targetBgmClip.muted },
                        true
                      )
                    }
                    className={`p-1 rounded ${
                      targetBgmClip.muted
                        ? 'bg-rose-500/20 text-rose-400'
                        : 'bg-zinc-800 text-zinc-300'
                    }`}
                  >
                    {targetBgmClip.muted ? (
                      <VolumeX className="w-4 h-4" />
                    ) : (
                      <Volume2 className="w-4 h-4" />
                    )}
                  </button>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-zinc-400">BGM音量</span>
                    <span className="font-mono text-emerald-300">
                      {Math.round(targetBgmClip.volume * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1.5}
                    step={0.02}
                    value={targetBgmClip.volume}
                    onChange={(e) =>
                      updateBgmClip(targetBgmClip.id, {
                        volume: Number(e.target.value),
                      })
                    }
                    className="w-full accent-emerald-500 h-1.5 bg-zinc-800 rounded-lg"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-zinc-400">フェードイン</span>
                      <span className="font-mono text-zinc-200">
                        {targetBgmClip.fadeIn.toFixed(1)}s
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={8}
                      step={0.2}
                      value={targetBgmClip.fadeIn}
                      onChange={(e) =>
                        updateBgmClip(targetBgmClip.id, {
                          fadeIn: Number(e.target.value),
                        })
                      }
                      className="w-full accent-emerald-500 h-1.5 bg-zinc-800 rounded-lg"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-zinc-400">フェードアウト</span>
                      <span className="font-mono text-zinc-200">
                        {targetBgmClip.fadeOut.toFixed(1)}s
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={8}
                      step={0.2}
                      value={targetBgmClip.fadeOut}
                      onChange={(e) =>
                        updateBgmClip(targetBgmClip.id, {
                          fadeOut: Number(e.target.value),
                        })
                      }
                      className="w-full accent-emerald-500 h-1.5 bg-zinc-800 rounded-lg"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Main Video Clip Settings */}
            {targetVideoClip ? (
              <div className="space-y-3">
                {/* Playback Speed Card */}
                <div className="p-3.5 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-zinc-100 flex items-center gap-1.5">
                      <Gauge className="w-4 h-4 text-cyan-400" />
                      <span>再生速度変更 (0.25x 〜 4.0x)</span>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono text-xs font-bold">
                      {targetVideoClip.speed.toFixed(2)}x
                    </span>
                  </div>

                  <input
                    type="range"
                    min={0.25}
                    max={4.0}
                    step={0.05}
                    value={targetVideoClip.speed}
                    onChange={(e) =>
                      updateVideoClipSpeed(
                        targetVideoClip.id,
                        Number(e.target.value)
                      )
                    }
                    className="w-full accent-cyan-500 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
                  />

                  <div className="grid grid-cols-6 gap-1 text-[11px] font-mono">
                    {[0.5, 1.0, 1.25, 1.5, 2.0, 4.0].map((presetSpeed) => (
                      <button
                        key={presetSpeed}
                        onClick={() =>
                          updateVideoClipSpeed(targetVideoClip.id, presetSpeed)
                        }
                        className={`py-1 rounded border transition ${
                          Math.abs(targetVideoClip.speed - presetSpeed) < 0.02
                            ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 font-bold'
                            : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {presetSpeed}x
                      </button>
                    ))}
                  </div>
                </div>

                {/* Audio Volume Card */}
                <div className="p-3.5 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-zinc-100 flex items-center gap-1.5">
                      {targetVideoClip.muted ? (
                        <VolumeX className="w-4 h-4 text-rose-400" />
                      ) : (
                        <Volume2 className="w-4 h-4 text-cyan-400" />
                      )}
                      <span>クリップ音量</span>
                    </div>
                    <button
                      onClick={() =>
                        updateVideoClip(
                          targetVideoClip.id,
                          { muted: !targetVideoClip.muted },
                          true
                        )
                      }
                      className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                        targetVideoClip.muted
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          : 'bg-zinc-800 text-zinc-300'
                      }`}
                    >
                      {targetVideoClip.muted ? 'ミュート中' : 'ミュート切替'}
                    </button>
                  </div>

                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={2.0}
                      step={0.05}
                      value={targetVideoClip.volume}
                      onChange={(e) =>
                        updateVideoClip(targetVideoClip.id, {
                          volume: Number(e.target.value),
                        })
                      }
                      className="flex-1 accent-cyan-500 h-1.5 bg-zinc-800 rounded-lg"
                    />
                    <span className="font-mono text-xs text-cyan-300 w-12 text-right">
                      {Math.round(targetVideoClip.volume * 100)}%
                    </span>
                  </div>
                </div>

                {/* Transform: Scale & Position X/Y */}
                <div className="p-3.5 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-zinc-100 flex items-center gap-1.5">
                      <Move className="w-4 h-4 text-cyan-400" />
                      <span>位置・スケール (Transform)</span>
                    </div>
                    <button
                      onClick={() =>
                        updateVideoClip(
                          targetVideoClip.id,
                          { scale: 1.0, positionX: 0, positionY: 0 },
                          true
                        )
                      }
                      title="位置とスケールをリセット"
                      className="text-[11px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>リセット</span>
                    </button>
                  </div>

                  {/* Scale */}
                  <div>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-zinc-400">拡大率 (Scale)</span>
                      <span className="font-mono text-cyan-300">
                        {Math.round(targetVideoClip.scale * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.2}
                      max={3.5}
                      step={0.05}
                      value={targetVideoClip.scale}
                      onChange={(e) =>
                        updateVideoClip(targetVideoClip.id, {
                          scale: Number(e.target.value),
                        })
                      }
                      className="w-full accent-cyan-500 h-1.5 bg-zinc-800 rounded-lg"
                    />
                  </div>

                  {/* Position X / Y */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="flex justify-between text-[10px] text-zinc-400 mb-1">
                        <span>X位置</span>
                        <span className="font-mono">
                          {targetVideoClip.positionX}px
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-960}
                        max={960}
                        step={10}
                        value={targetVideoClip.positionX}
                        onChange={(e) =>
                          updateVideoClip(targetVideoClip.id, {
                            positionX: Number(e.target.value),
                          })
                        }
                        className="w-full accent-cyan-500 h-1.5 bg-zinc-800 rounded-lg"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[10px] text-zinc-400 mb-1">
                        <span>Y位置</span>
                        <span className="font-mono">
                          {targetVideoClip.positionY}px
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-960}
                        max={960}
                        step={10}
                        value={targetVideoClip.positionY}
                        onChange={(e) =>
                          updateVideoClip(targetVideoClip.id, {
                            positionY: Number(e.target.value),
                          })
                        }
                        className="w-full accent-cyan-500 h-1.5 bg-zinc-800 rounded-lg"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-6 rounded-xl bg-zinc-900/40 border border-zinc-800 text-center text-xs text-zinc-500">
                タイムライン上の動画クリップまたはBGMクリップを選択してください
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

