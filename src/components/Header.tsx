import React, { useRef, useState } from 'react';
import {
  Film,
  Monitor,
  Smartphone,
  Undo2,
  Redo2,
  FolderDown,
  FolderUp,
  Download,
  Settings,
  ChevronDown,
  PackageCheck,
  Feather,
  FileCode2,
  FileText,
  Video,
} from 'lucide-react';
import { useEditorStore } from '../store/useEditorStore';
import { exportProjectToZip, importProjectFromZip } from '../utils/projectZip';
import { downloadFcpxmlFile, downloadSrtFile } from '../utils/exporters';

export const Header: React.FC = () => {
  const projectName = useEditorStore((s) => s.projectName);
  const aspectRatio = useEditorStore((s) => s.aspectRatio);
  const pastCount = useEditorStore((s) => s.past.length);
  const futureCount = useEditorStore((s) => s.future.length);
  const statusNotification = useEditorStore((s) => s.statusNotification);

  const setProjectName = useEditorStore((s) => s.setProjectName);
  const setAspectRatio = useEditorStore((s) => s.setAspectRatio);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const setSettingsModalOpen = useEditorStore((s) => s.setSettingsModalOpen);
  const setExportModalOpen = useEditorStore((s) => s.setExportModalOpen);
  const setStatusNotification = useEditorStore((s) => s.setStatusNotification);

  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const [zipBusyText, setZipBusyText] = useState<string | null>(null);
  const zipInputRef = useRef<HTMLInputElement | null>(null);

  const handleSaveZip = async (mode: 'full' | 'lightweight') => {
    setSaveMenuOpen(false);
    try {
      await exportProjectToZip(mode, (_pct, msg) => {
        setZipBusyText(msg);
      });
      setStatusNotification(
        mode === 'full'
          ? '完全パック (.vedit.zip) を保存しました'
          : '軽量パック (.light.vedit.zip) を保存しました'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusNotification(`ZIP保存エラー: ${msg}`);
    } finally {
      setZipBusyText(null);
    }
  };

  const handleImportZipChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const { missingVideoCount } = await importProjectFromZip(
        file,
        (_pct, msg) => {
          setZipBusyText(msg);
        }
      );
      if (missingVideoCount > 0) {
        setStatusNotification(
          '軽量パックを復元しました。左パネルから元動画ファイルを再選択してください。'
        );
      } else {
        setStatusNotification('プロジェクトZIPを完全復元しました！');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusNotification(`ZIP読込エラー: ${msg}`);
    } finally {
      setZipBusyText(null);
    }
  };

  const handleQuickFcpxml = () => {
    setExportDropdownOpen(false);
    const state = useEditorStore.getState();
    downloadFcpxmlFile({
      projectName: state.projectName,
      aspectRatio: state.aspectRatio,
      mediaAssets: state.mediaAssets,
      videoClips: state.videoClips,
      subtitles: state.subtitles,
      bgmClips: state.bgmClips,
    });
    setStatusNotification('DaVinci Resolve用 FCPXML (.fcpxml) を出力しました');
  };

  const handleQuickSrt = () => {
    setExportDropdownOpen(false);
    const state = useEditorStore.getState();
    downloadSrtFile(state.projectName, state.subtitles);
    setStatusNotification('SRT字幕ファイル (.srt) を出力しました');
  };

  return (
    <header className="h-12 px-3 bg-[#18181b] border-b border-zinc-800 flex items-center justify-between shrink-0 z-30">
      {/* Left: Brand & Project Title + Aspect Ratio Switcher */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-sm">
            <Film className="w-4 h-4 text-zinc-950 stroke-[2.5]" />
          </div>
          <span className="font-bold text-sm tracking-tight text-zinc-100 hidden sm:inline">
            CloudCut <span className="text-cyan-400 font-mono text-xs">PRO</span>
          </span>
        </div>

        <div className="h-4 w-px bg-zinc-800" />

        <input
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          className="bg-zinc-900/90 hover:bg-zinc-900 focus:bg-zinc-900 text-xs font-medium text-zinc-100 px-2.5 py-1.5 rounded border border-zinc-800 focus:border-cyan-500 focus:outline-none w-44 sm:w-52 transition"
          placeholder="プロジェクト名を入力..."
        />

        {/* Aspect Ratio Toggle: 16:9 YouTube vs 9:16 Shorts */}
        <div className="flex items-center bg-zinc-900 p-0.5 rounded-md border border-zinc-800">
          <button
            onClick={() => setAspectRatio('16:9')}
            className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition ${
              aspectRatio === '16:9'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>16:9 横動画</span>
          </button>
          <button
            onClick={() => setAspectRatio('9:16')}
            className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition ${
              aspectRatio === '9:16'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>9:16 ショート</span>
          </button>
        </div>

        {/* Undo / Redo */}
        <div className="flex items-center gap-1 ml-1">
          <button
            onClick={undo}
            disabled={pastCount === 0}
            title="元に戻す (Ctrl+Z / Cmd+Z)"
            className="p-1.5 rounded bg-zinc-900 hover:bg-zinc-800 disabled:opacity-35 disabled:pointer-events-none text-zinc-300 border border-zinc-800 transition"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={redo}
            disabled={futureCount === 0}
            title="やり直す (Ctrl+Y / Cmd+Shift+Z)"
            className="p-1.5 rounded bg-zinc-900 hover:bg-zinc-800 disabled:opacity-35 disabled:pointer-events-none text-zinc-300 border border-zinc-800 transition"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Center: Status Toast / Progress Banner */}
      <div className="hidden lg:flex items-center justify-center">
        {(zipBusyText || statusNotification) && (
          <div className="px-3 py-1 rounded-full bg-zinc-900 border border-cyan-500/40 text-xs text-cyan-300 flex items-center gap-2 shadow-sm animate-fade-in">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            <span>{zipBusyText || statusNotification}</span>
          </div>
        )}
      </div>

      {/* Right: Project ZIP Save/Load, Export Menu, Settings */}
      <div className="flex items-center gap-2">
        {/* Hidden file input for ZIP import */}
        <input
          ref={zipInputRef}
          type="file"
          accept=".zip"
          onChange={handleImportZipChange}
          className="hidden"
        />

        {/* Project Save Dropdown */}
        <div className="relative">
          <button
            onClick={() => {
              setSaveMenuOpen(!saveMenuOpen);
              setExportDropdownOpen(false);
            }}
            className="px-2.5 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700/80 text-xs font-medium flex items-center gap-1.5 transition"
          >
            <FolderDown className="w-3.5 h-3.5 text-cyan-400" />
            <span>プロジェクト保存 (.zip)</span>
            <ChevronDown className="w-3 h-3 text-zinc-400" />
          </button>

          {saveMenuOpen && (
            <div className="absolute right-0 mt-1.5 w-72 rounded-lg bg-[#1f1f23] border border-zinc-700 shadow-2xl py-1.5 z-50">
              <button
                onClick={() => handleSaveZip('full')}
                className="w-full px-3 py-2 text-left hover:bg-zinc-800 flex items-start gap-2.5 transition"
              >
                <PackageCheck className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-semibold text-zinc-100">
                    完全パック保存（動画・BGM・フォント全部入り）
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    ストリームZIP処理で元動画も同梱（別PCへの完全移行用）
                  </div>
                </div>
              </button>
              <div className="my-1 border-t border-zinc-800" />
              <button
                onClick={() => handleSaveZip('lightweight')}
                className="w-full px-3 py-2 text-left hover:bg-zinc-800 flex items-start gap-2.5 transition"
              >
                <Feather className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-semibold text-zinc-100">
                    軽量パック保存（編集データ・フォント・BGMのみ）
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    数GBの長尺動画でも一瞬で保存（読込時に元動画のみ再選択）
                  </div>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Project Load Button */}
        <button
          onClick={() => zipInputRef.current?.click()}
          className="px-2.5 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700/80 text-xs font-medium flex items-center gap-1.5 transition"
        >
          <FolderUp className="w-3.5 h-3.5 text-emerald-400" />
          <span>読込 (.zip)</span>
        </button>

        {/* Export Menu Dropdown */}
        <div className="relative">
          <button
            onClick={() => {
              setExportDropdownOpen(!exportDropdownOpen);
              setSaveMenuOpen(false);
            }}
            className="px-3 py-1.5 rounded bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-zinc-950 font-semibold text-xs flex items-center gap-1.5 shadow transition"
          >
            <Download className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>書き出し</span>
            <ChevronDown className="w-3 h-3 stroke-[2.5]" />
          </button>

          {exportDropdownOpen && (
            <div className="absolute right-0 mt-1.5 w-64 rounded-lg bg-[#1f1f23] border border-zinc-700 shadow-2xl py-1.5 z-50">
              <button
                onClick={() => {
                  setExportDropdownOpen(false);
                  setExportModalOpen(true);
                }}
                className="w-full px-3 py-2 text-left hover:bg-zinc-800 flex items-start gap-2.5 transition"
              >
                <Video className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-semibold text-zinc-100">
                    MP4 動画直接出力 (WebCodecs)
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    カスタムフォント字幕・BGM合成済みMP4
                  </div>
                </div>
              </button>

              <button
                onClick={handleQuickFcpxml}
                className="w-full px-3 py-2 text-left hover:bg-zinc-800 flex items-start gap-2.5 transition"
              >
                <FileCode2 className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-semibold text-zinc-100">
                    DaVinci Resolve用 FCPXML出力
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    カット・速度・BGM配置をFCPXML v1.9で出力
                  </div>
                </div>
              </button>

              <button
                onClick={handleQuickSrt}
                className="w-full px-3 py-2 text-left hover:bg-zinc-800 flex items-start gap-2.5 transition"
              >
                <FileText className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-semibold text-zinc-100">
                    SRT 字幕ファイル出力 (.srt)
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    手直し後の全テロップを標準SRT形式で出力
                  </div>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Settings Modal Button */}
        <button
          onClick={() => setSettingsModalOpen(true)}
          title="APIパスコード・Gemini APIキー設定"
          className="p-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700/80 transition"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};

