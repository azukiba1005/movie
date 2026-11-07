import React, { useEffect } from 'react';
import { Header } from './components/Header';
import { LeftPanel } from './components/LeftPanel';
import { PreviewPlayer } from './components/PreviewPlayer';
import { Inspector } from './components/Inspector';
import { Timeline } from './components/Timeline';
import { SettingsModal } from './components/SettingsModal';
import { ExportModal } from './components/ExportModal';
import { useEditorStore } from './store/useEditorStore';

export const App: React.FC = () => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditingInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isEditingInput) return;

      const state = useEditorStore.getState();

      // Undo: Ctrl+Z / Cmd+Z
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          state.redo();
        } else {
          state.undo();
        }
        return;
      }

      // Redo: Ctrl+Y / Cmd+Y
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        state.redo();
        return;
      }

      // Play / Pause: Space
      if (e.code === 'Space') {
        e.preventDefault();
        if (
          !state.isPlaying &&
          state.currentTime >= state.getTotalDuration() - 0.05
        ) {
          state.setCurrentTime(0);
        }
        state.setIsPlaying(!state.isPlaying);
        return;
      }

      // Split at Playhead / Razor Tool: B or S
      if (e.key.toLowerCase() === 'b' || e.key.toLowerCase() === 's') {
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          state.splitAtPlayhead();
          return;
        }
      }

      // Select Tool: V
      if (e.key.toLowerCase() === 'v' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        state.setActiveTool('select');
        return;
      }

      // Ripple Delete: Delete or Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (state.selectedItemType === 'video' && state.selectedItemId) {
          state.rippleDeleteVideoClip(state.selectedItemId);
        } else if (
          state.selectedItemType === 'subtitle' &&
          state.selectedItemId
        ) {
          state.deleteSubtitle(state.selectedItemId);
        } else if (state.selectedItemType === 'bgm' && state.selectedItemId) {
          state.deleteBgmClip(state.selectedItemId);
        }
        return;
      }

      // Frame step left / right
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        state.setIsPlaying(false);
        const step = e.shiftKey ? 1.0 : 1 / 30;
        state.setCurrentTime(Math.max(0, state.currentTime - step));
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        state.setIsPlaying(false);
        const step = e.shiftKey ? 1.0 : 1 / 30;
        state.setCurrentTime(
          Math.min(state.getTotalDuration(), state.currentTime + step)
        );
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#18181b] text-zinc-100 select-none">
      {/* 1. Top Header Bar */}
      <Header />

      {/* 2. Upper 3-Column DaVinci Resolve Workspace */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left: Media Pool, Custom Fonts, Auto Cut & Whisper AI Panel */}
        <div className="w-[340px] xl:w-[370px] shrink-0 h-full overflow-hidden">
          <LeftPanel />
        </div>

        {/* Center: 60fps Canvas Composite Program Monitor */}
        <div className="flex-1 min-w-0 h-full overflow-hidden">
          <PreviewPlayer />
        </div>

        {/* Right: Clip Speed/Transform & Double-Outline Subtitle Inspector */}
        <div className="w-[340px] xl:w-[370px] shrink-0 h-full overflow-hidden">
          <Inspector />
        </div>
      </div>

      {/* 3. Bottom Multi-Track Timeline */}
      <div className="h-[238px] shrink-0 overflow-hidden">
        <Timeline />
      </div>

      {/* Modals */}
      <SettingsModal />
      <ExportModal />
    </div>
  );
};

export default App;

