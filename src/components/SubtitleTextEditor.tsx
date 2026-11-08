import React, { useRef } from 'react';
import { SplitSquareHorizontal } from 'lucide-react';
import { useEditorStore } from '../store/useEditorStore';

/**
 * Subtitle text editor with "split here" support:
 *  - Enter splits the subtitle at the cursor (Shift+Enter inserts a line break)
 *  - the button does the same; time is divided by the character ratio
 */
export const SubtitleTextEditor: React.FC<{
  subtitleId: string;
  text: string;
  rows?: number;
  placeholder?: string;
  className?: string;
}> = ({ subtitleId, text, rows = 2, placeholder, className }) => {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const updateSubtitle = useEditorStore((s) => s.updateSubtitle);
  const splitSubtitleAtCursor = useEditorStore((s) => s.splitSubtitleAtCursor);

  const splitHere = () => {
    const el = ref.current;
    if (!el) return;
    splitSubtitleAtCursor(subtitleId, el.selectionStart ?? text.length);
  };

  return (
    <div className="space-y-1">
      <textarea
        ref={ref}
        rows={rows}
        value={text}
        onChange={(e) => updateSubtitle(subtitleId, { text: e.target.value })}
        onKeyDown={(e) => {
          // Enter = split at cursor (IME composition must not trigger it)
          if (
            e.key === 'Enter' &&
            !e.shiftKey &&
            !e.nativeEvent.isComposing &&
            e.keyCode !== 229
          ) {
            e.preventDefault();
            e.stopPropagation();
            splitHere();
          }
        }}
        placeholder={placeholder || 'テロップ文字列を入力...'}
        className={
          className ||
          'w-full px-2.5 py-1.5 rounded bg-zinc-950/90 border border-zinc-800 focus:border-cyan-500 focus:outline-none text-xs text-zinc-100 resize-none'
        }
      />
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            splitHere();
          }}
          title="カーソル位置で2つのテロップに分割（文字数比率で時間を自動計算）"
          className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-cyan-500/20 text-[10px] text-zinc-300 hover:text-cyan-300 flex items-center gap-1 transition"
        >
          <SplitSquareHorizontal className="w-3 h-3" />
          <span>ここで2つのテロップに分割</span>
        </button>
        <span className="text-[9px] text-zinc-500">
          Enter=分割 / Shift+Enter=改行
        </span>
      </div>
    </div>
  );
};
