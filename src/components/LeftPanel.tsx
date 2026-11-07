import React, { useRef, useState } from 'react';
import {
  FolderOpen,
  Scissors,
  Subtitles,
  Upload,
  Film,
  Music,
  Type,
  Plus,
  Trash2,
  Sparkles,
  VolumeX,
  CheckSquare,
  Square,
  Play,
  SplitSquareHorizontal,
  Merge,
  RefreshCw,
  Wand2,
  Loader2,
} from 'lucide-react';
import { useEditorStore } from '../store/useEditorStore';
import {
  detectSilenceOnTimeline,
   encodeMonoAudioBufferToWav,
  extractWaveformPeaks,
  probeMediaMetadata,
  renderTimelineAudioChunksForWhisper,
} from '../utils/audioAnalyzer';
import { CustomFontAsset, CutInterval, MediaAsset } from '../types/editor';

export const LeftPanel: React.FC = () => {
  const leftPanelTab = useEditorStore((s) => s.leftPanelTab);
  const mediaAssets = useEditorStore((s) => s.mediaAssets);
  const customFonts = useEditorStore((s) => s.customFonts);
  const videoClips = useEditorStore((s) => s.videoClips);
  const subtitles = useEditorStore((s) => s.subtitles);
  const silenceConfig = useEditorStore((s) => s.silenceConfig);
  const cutIntervals = useEditorStore((s) => s.cutIntervals);
  const isTranscribing = useEditorStore((s) => s.isTranscribing);
  const transcribeProgress = useEditorStore((s) => s.transcribeProgress);
  const transcribeStatusText = useEditorStore((s) => s.transcribeStatusText);
  const isAnalyzingAiCut = useEditorStore((s) => s.isAnalyzingAiCut);
  const selectedItemId = useEditorStore((s) => s.selectedItemId);
  const appPasscode = useEditorStore((s) => s.appPasscode);
  const geminiApiKey = useEditorStore((s) => s.geminiApiKey);

  const setLeftPanelTab = useEditorStore((s) => s.setLeftPanelTab);
  const addMediaAsset = useEditorStore((s) => s.addMediaAsset);
  const relinkMissingVideoAsset = useEditorStore(
    (s) => s.relinkMissingVideoAsset
  );
  const removeMediaAsset = useEditorStore((s) => s.removeMediaAsset);
  const registerCustomFont = useEditorStore((s) => s.registerCustomFont);
  const removeCustomFont = useEditorStore((s) => s.removeCustomFont);
  const addVideoClipFromAsset = useEditorStore((s) => s.addVideoClipFromAsset);
  const addBgmClipFromAsset = useEditorStore((s) => s.addBgmClipFromAsset);
  const setSilenceConfig = useEditorStore((s) => s.setSilenceConfig);
  const setCutIntervals = useEditorStore((s) => s.setCutIntervals);
  const toggleCutIntervalSelection = useEditorStore(
    (s) => s.toggleCutIntervalSelection
  );
  const selectAllCutIntervals = useEditorStore((s) => s.selectAllCutIntervals);
  const applySelectedCutIntervals = useEditorStore(
    (s) => s.applySelectedCutIntervals
  );
  const setTranscribeState = useEditorStore((s) => s.setTranscribeState);
  const setAnalyzingAiCut = useEditorStore((s) => s.setAnalyzingAiCut);
  const addSubtitle = useEditorStore((s) => s.addSubtitle);
  const setSubtitlesFromTranscription = useEditorStore(
    (s) => s.setSubtitlesFromTranscription
  );
  const updateSubtitle = useEditorStore((s) => s.updateSubtitle);
  const deleteSubtitle = useEditorStore((s) => s.deleteSubtitle);
  const splitSubtitle = useEditorStore((s) => s.splitSubtitle);
  const mergeSubtitleWithNext = useEditorStore((s) => s.mergeSubtitleWithNext);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const selectItem = useEditorStore((s) => s.selectItem);
  const setStatusNotification = useEditorStore((s) => s.setStatusNotification);

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [relinkTargetId, setRelinkTargetId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const relinkInputRef = useRef<HTMLInputElement | null>(null);

  // Process uploaded files (Video, BGM Audio, or Custom Font .ttf/.otf/.woff2)
  const handleFilesSelected = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    setIsLoadingFiles(true);
    try {
      for (const file of files) {
        const lower = file.name.toLowerCase();

        // 1. Custom Font (.ttf, .otf, .woff2)
        if (
          lower.endsWith('.ttf') ||
          lower.endsWith('.otf') ||
          lower.endsWith('.woff2')
        ) {
          const ext = lower.endsWith('.woff2')
            ? 'woff2'
            : lower.endsWith('.otf')
            ? 'otf'
            : 'ttf';
          const cleanName = file.name
            .replace(/\.(ttf|otf|woff2)$/i, '')
            .replace(/[^a-zA-Z0-9\u3000-\u9fff_-]/g, '');
          const fontName = cleanName || `CustomFont_${Date.now()}`;
          const buf = await file.arrayBuffer();
          const fontAsset: CustomFontAsset = {
            id: `font-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: fontName,
            fileName: file.name,
            format: ext,
            data: buf,
          };
          await registerCustomFont(fontAsset);
          continue;
        }

        // 2. Video File (.mp4, .mov, .webm, .mkv)
        if (
          file.type.startsWith('video/') ||
          lower.endsWith('.mp4') ||
          lower.endsWith('.mov') ||
          lower.endsWith('.webm')
        ) {
          const objectUrl = URL.createObjectURL(file);
          const meta = await probeMediaMetadata(objectUrl, 'video');
          const waveform = await extractWaveformPeaks(file, 50);

          const asset: MediaAsset = {
            id: `media-v-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 6)}`,
            name: file.name,
            type: 'video',
            file,
            objectUrl,
            duration: waveform.duration > 0 ? waveform.duration : meta.duration,
            width: meta.width,
            height: meta.height,
            sizeBytes: file.size,
            mimeType: file.type || 'video/mp4',
            waveformPeaks: waveform.peaks,
            waveformSampleRate: waveform.sampleRate,
          };
          addMediaAsset(asset, true);
          setStatusNotification(`動画「${file.name}」を追加しました`);
          continue;
        }

        // 3. BGM Audio File (.mp3, .wav, .m4a, .aac, .ogg)
        if (
          file.type.startsWith('audio/') ||
          lower.endsWith('.mp3') ||
          lower.endsWith('.wav') ||
          lower.endsWith('.m4a') ||
          lower.endsWith('.aac')
        ) {
          const objectUrl = URL.createObjectURL(file);
          const meta = await probeMediaMetadata(objectUrl, 'bgm');
          const waveform = await extractWaveformPeaks(file, 30);

          const asset: MediaAsset = {
            id: `media-a-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 6)}`,
            name: file.name,
            type: 'bgm',
            file,
            objectUrl,
            duration: waveform.duration > 0 ? waveform.duration : meta.duration,
            sizeBytes: file.size,
            mimeType: file.type || 'audio/mpeg',
            waveformPeaks: waveform.peaks,
            waveformSampleRate: waveform.sampleRate,
          };
          addMediaAsset(asset, true);
          setStatusNotification(`BGM「${file.name}」を追加しました`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusNotification(`ファイル読込エラー: ${msg}`);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  // Generate a synthetic playable demo project (with real audio buffer, silent intervals, and retakes/fillers)
  const handleLoadDemoProject = async () => {
    setIsLoadingFiles(true);
    try {
      const durationSec = 20;
      const sampleRate = 16000;
      const offlineCtx = new OfflineAudioContext(
        1,
        durationSec * sampleRate,
        sampleRate
      );

      // Spoken intervals vs Silent intervals (to demonstrate Silence Jet Cut & AI Cut)
      const speechSegments = [
        {
          start: 0.2,
          end: 2.6,
          text: 'えー、あー、マイクテスト中です、ちょっと待ってくださいね。',
        },
        // 2.6s - 4.0s: 1.4s SILENCE
        {
          start: 4.0,
          end: 6.5,
          text: 'こんにちは！今日はCloudflare Workersで動画編集…あ、噛みました。',
        },
        // 6.5s - 7.7s: 1.2s SILENCE
        {
          start: 7.7,
          end: 11.5,
          text: 'こんにちは！今回はCloudflare WorkersとAIで作る最新ブラウザ動画編集アプリを紹介します！',
        },
        // 11.5s - 12.8s: 1.3s SILENCE
        {
          start: 12.8,
          end: 14.2,
          text: 'えーっと、そのー、なんだっけな…',
        },
        {
          start: 14.3,
          end: 19.5,
          text: '無音ジェットカットもAI文脈カットも、二重縁取りテロップもすべてブラウザだけで完結します！',
        },
      ];

      // Synthesize pleasant voice-like harmonic bursts during speechSegments
      for (const seg of speechSegments) {
        const osc = offlineCtx.createOscillator();
        const gain = offlineCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(190, seg.start);

        gain.gain.setValueAtTime(0.001, seg.start);
        gain.gain.linearRampToValueAtTime(0.35, seg.start + 0.05);
        gain.gain.setValueAtTime(0.35, seg.end - 0.06);
        gain.gain.linearRampToValueAtTime(0.001, seg.end);

        osc.connect(gain);
        gain.connect(offlineCtx.destination);
        osc.start(seg.start);
        osc.stop(seg.end);
      }

      const renderedBuf = await offlineCtx.startRendering();
      const wavBlob = encodeMonoAudioBufferToWav(renderedBuf);
      const demoFile = new File([wavBlob], 'demo_youtube_talk.wav', {
        type: 'audio/wav',
      });
      const objectUrl = URL.createObjectURL(demoFile);
      const waveform = await extractWaveformPeaks(demoFile, 50);

      const demoAsset: MediaAsset = {
        id: `media-demo-${Date.now()}`,
        name: 'YouTubeトーク収録デモ素材 (20秒)',
        type: 'video',
        file: demoFile,
        objectUrl,
        duration: durationSec,
        width: 1920,
        height: 1080,
        sizeBytes: demoFile.size,
        mimeType: 'audio/wav',
        waveformPeaks: waveform.peaks,
        waveformSampleRate: waveform.sampleRate,
      };

      addMediaAsset(demoAsset, true);
      setSubtitlesFromTranscription(
        speechSegments.map((s, idx) => ({
          id: `demo-sub-${idx}`,
          start: s.start,
          end: s.end,
          text: s.text,
        }))
      );
      setStatusNotification(
        'デモ素材（音声波形・無音区間・言い直しテロップ付き）を読み込みました！'
      );
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  // Run Silence Detection on Track 2
  const handleDetectSilence = () => {
    if (videoClips.length === 0) {
      setStatusNotification('先に動画クリップをタイムラインに追加してください');
      return;
    }
    const intervals = detectSilenceOnTimeline(
      videoClips,
      mediaAssets,
      silenceConfig
    );
    setCutIntervals(intervals);
    if (intervals.length === 0) {
      setStatusNotification(
        '現在のしきい値条件では無音区間が検出されませんでした'
      );
    } else {
      const totalSaved = intervals.reduce(
        (acc, i) => acc + (i.end - i.start),
        0
      );
      setStatusNotification(
        `${intervals.length}箇所の無音区間（計 ${totalSaved.toFixed(
          1
        )}秒）を検出しました`
      );
    }
  };

  // Run AI Context Cut (Gemini 2.5 Flash)
  const handleAnalyzeAiCut = async () => {
    if (subtitles.length === 0) {
      setStatusNotification(
        '先に「テロップ」タブで自動文字起こしを実行するか、字幕を作成してください'
      );
      return;
    }

    setAnalyzingAiCut(true);
    try {
      const segmentsPayload = subtitles.map((s) => ({
        id: s.id,
        start: s.startTime,
        end: s.endTime,
        text: s.text,
      }));

      const res = await fetch('/api/analyze-cut', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Passcode': appPasscode,
          'X-Gemini-Api-Key': geminiApiKey,
        },
        body: JSON.stringify({
          segments: segmentsPayload,
          apiKey: geminiApiKey,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `API Error (${res.status})`);
      }

      const candidates: CutInterval[] = (data.candidates || []).map(
        (c: {
          id: string;
          start: number;
          end: number;
          category: 'retake' | 'filler' | 'tangent';
          reason: string;
          text: string;
          confidence: number;
        }) => ({
          id: c.id,
          start: c.start,
          end: c.end,
          type: 'ai',
          category: c.category,
          reason: c.reason,
          text: c.text,
          confidence: c.confidence,
          selected: true,
        })
      );

      setCutIntervals(candidates);
      if (candidates.length === 0) {
        setStatusNotification(
          'AI解析完了: カットすべき言い直しや不要区間は見つかりませんでした'
        );
      } else {
        setStatusNotification(
          `Gemini AIが ${candidates.length} 箇所のカット候補（言い直し・フィラー等）を検出しました`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusNotification(`AIカット解析エラー: ${msg}`);
    } finally {
      setAnalyzingAiCut(false);
    }
  };

  // Run Cloudflare Workers AI Whisper Transcription in 35s 16kHz Mono WAV Chunks
  const handleRunWhisperTranscription = async () => {
    if (videoClips.length === 0) {
      setStatusNotification('先にタイムラインに動画を追加してください');
      return;
    }

    setTranscribeState(true, 5, '音声チャンク(16kHz Mono WAV)を生成中...');

    try {
      const chunks = await renderTimelineAudioChunksForWhisper(
        videoClips,
        mediaAssets,
        35,
        (msg) => setTranscribeState(true, 10, msg)
      );

      const allSegments: Array<{
        id: string;
        start: number;
        end: number;
        text: string;
      }> = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const pct = 15 + Math.round(((i + 0.5) / chunks.length) * 80);
        setTranscribeState(
          true,
          pct,
          `Workers AI Whisper 文字起こし中 (${i + 1}/${chunks.length} チャンク)...`
        );

        const formData = new FormData();
        formData.append('audio', chunk.blob, `chunk_${i}.wav`);
        formData.append('offsetSeconds', String(chunk.offsetSeconds));
        formData.append('language', 'ja');

        const res = await fetch('/api/transcribe', {
          method: 'POST',
          headers: {
            'X-App-Passcode': appPasscode,
          },
          body: formData,
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || `Whisper API Error (${res.status})`);
        }

        if (Array.isArray(data.segments)) {
          allSegments.push(...data.segments);
        }
      }

      if (allSegments.length > 0) {
        setSubtitlesFromTranscription(allSegments);
        setStatusNotification(
          `自動文字起こしが完了しました（${allSegments.length}件のテロップを生成）`
        );
      } else {
        setStatusNotification(
          '文字起こしが完了しましたが、発話セグメントが検出されませんでした'
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusNotification(`文字起こしエラー: ${msg}`);
    } finally {
      setTranscribeState(false, 0, '');
    }
  };

  const selectedCutCount = cutIntervals.filter((c) => c.selected).length;

  return (
    <div className="flex flex-col h-full bg-[#1b1b1f] border-r border-zinc-800 select-none overflow-hidden">
      {/* Hidden File Pickers */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/*,audio/*,.mp4,.mov,.webm,.mp3,.wav,.m4a,.aac,.ttf,.otf,.woff2"
        onChange={(e) => {
          if (e.target.files) handleFilesSelected(e.target.files);
          e.target.value = '';
        }}
        className="hidden"
      />
      <input
        ref={relinkInputRef}
        type="file"
        accept="video/*,.mp4,.mov,.webm"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file && relinkTargetId) {
            const url = URL.createObjectURL(file);
            relinkMissingVideoAsset(relinkTargetId, file, url);
            setRelinkTargetId(null);
          }
        }}
        className="hidden"
      />

      {/* Panel Navigation Tabs */}
      <div className="h-9 px-2 bg-[#16161a] border-b border-zinc-800 grid grid-cols-3 gap-1 items-center shrink-0">
        <button
          onClick={() => setLeftPanelTab('media')}
          className={`h-7 px-2 rounded text-xs font-medium flex items-center justify-center gap-1.5 transition ${
            leftPanelTab === 'media'
              ? 'bg-zinc-800 text-cyan-300 border border-zinc-700'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
          }`}
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span className="truncate">素材・フォント</span>
        </button>

        <button
          onClick={() => setLeftPanelTab('autocut')}
          className={`h-7 px-2 rounded text-xs font-medium flex items-center justify-center gap-1.5 transition ${
            leftPanelTab === 'autocut'
              ? 'bg-zinc-800 text-cyan-300 border border-zinc-700'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
          }`}
        >
          <Scissors className="w-3.5 h-3.5" />
          <span className="truncate">自動カット</span>
          {cutIntervals.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-mono">
              {cutIntervals.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setLeftPanelTab('subtitles')}
          className={`h-7 px-2 rounded text-xs font-medium flex items-center justify-center gap-1.5 transition ${
            leftPanelTab === 'subtitles'
              ? 'bg-zinc-800 text-cyan-300 border border-zinc-700'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
          }`}
        >
          <Subtitles className="w-3.5 h-3.5" />
          <span className="truncate">AI字幕({subtitles.length})</span>
        </button>
      </div>

      {/* Tab Content Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* ================= TAB 1: MEDIA POOL & CUSTOM FONTS ================= */}
        {leftPanelTab === 'media' && (
          <>
            {/* Drag & Drop Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingOver(true);
              }}
              onDragLeave={() => setIsDraggingOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingOver(false);
                if (e.dataTransfer.files) {
                  handleFilesSelected(e.dataTransfer.files);
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`p-4 rounded-xl border-2 border-dashed cursor-pointer transition flex flex-col items-center justify-center text-center ${
                isDraggingOver
                  ? 'border-cyan-400 bg-cyan-500/10'
                  : 'border-zinc-700/80 hover:border-cyan-500/60 bg-zinc-900/50 hover:bg-zinc-900'
              }`}
            >
              {isLoadingFiles ? (
                <Loader2 className="w-6 h-6 text-cyan-400 animate-spin mb-1.5" />
              ) : (
                <Upload className="w-6 h-6 text-cyan-400 mb-1.5" />
              )}
              <div className="text-xs font-semibold text-zinc-200">
                動画・BGM・カスタムフォントをドロップ
              </div>
              <div className="text-[11px] text-zinc-400 mt-0.5">
                MP4 / MOV / WebM / MP3 / WAV / TTF / OTF / WOFF2 対応
              </div>
            </div>

            {/* 1-Click Demo Project Generator */}
            {mediaAssets.length === 0 && (
              <button
                onClick={handleLoadDemoProject}
                className="w-full py-2 px-3 rounded-lg bg-zinc-800/90 hover:bg-zinc-800 border border-cyan-500/30 text-xs text-cyan-300 font-medium flex items-center justify-center gap-2 transition"
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span>サンプル収録データ（無音・言い直し入り）を生成して試す</span>
              </button>
            )}

            {/* Video & BGM Media List */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-zinc-300">
                <span>メディアプール ({mediaAssets.length})</span>
              </div>

              {mediaAssets.length === 0 ? (
                <div className="p-4 rounded-lg bg-zinc-900/40 border border-zinc-800/80 text-center text-xs text-zinc-500">
                  まだ動画やBGMが追加されていません
                </div>
              ) : (
                <div className="space-y-1.5">
                  {mediaAssets.map((asset) => (
                    <div
                      key={asset.id}
                      className="p-2.5 rounded-lg bg-zinc-900/90 border border-zinc-800 hover:border-zinc-700 flex items-center justify-between gap-2 transition"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-8 h-8 rounded flex items-center justify-center shrink-0 ${
                            asset.type === 'video'
                              ? 'bg-cyan-500/15 text-cyan-400'
                              : 'bg-emerald-500/15 text-emerald-400'
                          }`}
                        >
                          {asset.type === 'video' ? (
                            <Film className="w-4 h-4" />
                          ) : (
                            <Music className="w-4 h-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-zinc-200 truncate">
                            {asset.name}
                          </div>
                          <div className="text-[11px] text-zinc-400 flex items-center gap-2 font-mono">
                            <span>{asset.duration.toFixed(1)}s</span>
                            {asset.width && asset.height && (
                              <span>
                                {asset.width}×{asset.height}
                              </span>
                            )}
                            {asset.missingFile && (
                              <span className="text-amber-400 font-sans font-semibold">
                                要再選択
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {asset.missingFile && (
                          <button
                            onClick={() => {
                              setRelinkTargetId(asset.id);
                              relinkInputRef.current?.click();
                            }}
                            title="元動画ファイルを再選択してリンク"
                            className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px] flex items-center gap-1"
                          >
                            <RefreshCw className="w-3 h-3" />
                            <span>再選択</span>
                          </button>
                        )}
                        <button
                          onClick={() =>
                            asset.type === 'video'
                              ? addVideoClipFromAsset(asset.id)
                              : addBgmClipFromAsset(asset.id)
                          }
                          title="タイムライン末尾に追加"
                          className="p-1.5 rounded bg-zinc-800 hover:bg-cyan-500/20 text-zinc-300 hover:text-cyan-300 transition"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => removeMediaAsset(asset.id)}
                          title="素材を削除"
                          className="p-1.5 rounded bg-zinc-800 hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Custom Fonts List */}
            <div className="space-y-2 pt-2 border-t border-zinc-800">
              <div className="flex items-center justify-between text-xs font-semibold text-zinc-300">
                <span className="flex items-center gap-1.5">
                  <Type className="w-3.5 h-3.5 text-amber-400" />
                  <span>カスタムフォント ({customFonts.length})</span>
                </span>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[11px] text-cyan-400 hover:underline"
                >
                  + フォント追加
                </button>
              </div>

              {customFonts.length === 0 ? (
                <div className="p-3 rounded-lg bg-zinc-900/40 border border-zinc-800/80 text-[11px] text-zinc-500">
                  .ttf / .otf / .woff2 ファイルをドロップすると FontFace API
                  で即座にテロップへ反映＆ZIP保存時に同梱されます。
                </div>
              ) : (
                <div className="space-y-1.5">
                  {customFonts.map((font) => (
                    <div
                      key={font.id}
                      className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-between"
                    >
                      <div className="min-w-0">
                        <div
                          className="text-xs text-zinc-100 truncate"
                          style={{ fontFamily: `"${font.name}", sans-serif` }}
                        >
                          {font.name} (あいうABC123)
                        </div>
                        <div className="text-[10px] text-zinc-500 truncate">
                          {font.fileName}
                        </div>
                      </div>
                      <button
                        onClick={() => removeCustomFont(font.id)}
                        className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-rose-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ================= TAB 2: AUTO CUT (SILENCE JET CUT + AI CUT) ================= */}
        {leftPanelTab === 'autocut' && (
          <>
            {/* Section 1: Silence Jet Cut */}
            <div className="p-3.5 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-100">
                  <VolumeX className="w-4 h-4 text-cyan-400" />
                  <span>① 無音ジェットカット (Web Audio API)</span>
                </div>
              </div>

              {/* Threshold dB Slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-zinc-400">無音しきい値 (Threshold)</span>
                  <span className="font-mono text-cyan-300">
                    {silenceConfig.thresholdDb} dB
                  </span>
                </div>
                <input
                  type="range"
                  min={-60}
                  max={-15}
                  step={1}
                  value={silenceConfig.thresholdDb}
                  onChange={(e) =>
                    setSilenceConfig({ thresholdDb: Number(e.target.value) })
                  }
                  className="w-full accent-cyan-500 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
                />
              </div>

              {/* Min Silence Duration ms Slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-zinc-400">最小無音継続時間</span>
                  <span className="font-mono text-cyan-300">
                    {silenceConfig.minSilenceDurationMs} ms
                  </span>
                </div>
                <input
                  type="range"
                  min={100}
                  max={2000}
                  step={50}
                  value={silenceConfig.minSilenceDurationMs}
                  onChange={(e) =>
                    setSilenceConfig({
                      minSilenceDurationMs: Number(e.target.value),
                    })
                  }
                  className="w-full accent-cyan-500 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
                />
              </div>

              {/* Padding ms Slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-zinc-400">カット前後の余白 (パディング)</span>
                  <span className="font-mono text-cyan-300">
                    {silenceConfig.paddingMs} ms
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={400}
                  step={10}
                  value={silenceConfig.paddingMs}
                  onChange={(e) =>
                    setSilenceConfig({ paddingMs: Number(e.target.value) })
                  }
                  className="w-full accent-cyan-500 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
                />
              </div>

              <button
                onClick={handleDetectSilence}
                className="w-full py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 font-semibold text-xs flex items-center justify-center gap-1.5 transition"
              >
                <VolumeX className="w-3.5 h-3.5" />
                <span>無音区間をプレビュー検出</span>
              </button>
            </div>

            {/* Section 2: AI Context Cut (Gemini 2.5 Flash) */}
            <div className="p-3.5 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-100">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>② AI文脈カット (Gemini 2.5 Flash)</span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                文字起こしテキストから「言い直し」「フィラー（えー、あー）」「不要な雑談」のタイムスタンプ区間をAIで自動特定します。
              </p>

              <button
                onClick={handleAnalyzeAiCut}
                disabled={isAnalyzingAiCut}
                className="w-full py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-50 text-amber-300 border border-amber-500/40 font-semibold text-xs flex items-center justify-center gap-1.5 transition"
              >
                {isAnalyzingAiCut ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Gemini 2.5 Flash で文脈解析中...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>言い直しや不要部分をAIで検出</span>
                  </>
                )}
              </button>
            </div>

            {/* Section 3: Detected Cut Candidates List & Batch Ripple Cut Execution */}
            {cutIntervals.length > 0 && (
              <div className="space-y-2.5 pt-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-rose-300">
                    検出されたカット候補 ({selectedCutCount}/{cutIntervals.length})
                  </span>
                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      onClick={() => selectAllCutIntervals(true)}
                      className="text-cyan-400 hover:underline"
                    >
                      全選択
                    </button>
                    <button
                      onClick={() => selectAllCutIntervals(false)}
                      className="text-zinc-400 hover:underline"
                    >
                      全解除
                    </button>
                  </div>
                </div>

                <button
                  onClick={() => applySelectedCutIntervals()}
                  disabled={selectedCutCount === 0}
                  className="w-full py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white font-bold text-xs shadow-lg flex items-center justify-center gap-1.5 transition"
                >
                  <Scissors className="w-4 h-4" />
                  <span>
                    選択した {selectedCutCount} 箇所を一括分割＆リップル削除 (Undo可)
                  </span>
                </button>

                <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                  {cutIntervals.map((ci) => (
                    <div
                      key={ci.id}
                      className={`p-2 rounded-lg border text-xs flex items-start justify-between gap-2 transition ${
                        ci.selected
                          ? 'bg-rose-950/30 border-rose-500/40 text-zinc-100'
                          : 'bg-zinc-900/60 border-zinc-800 text-zinc-400'
                      }`}
                    >
                      <button
                        onClick={() => toggleCutIntervalSelection(ci.id)}
                        className="mt-0.5 text-rose-400 shrink-0"
                      >
                        {ci.selected ? (
                          <CheckSquare className="w-4 h-4" />
                        ) : (
                          <Square className="w-4 h-4 text-zinc-500" />
                        )}
                      </button>

                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => setCurrentTime(ci.start)}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[11px] text-rose-300 font-semibold">
                            {ci.start.toFixed(2)}s - {ci.end.toFixed(2)}s
                          </span>
                          <span className="px-1.5 py-0.2 rounded bg-zinc-800 text-[10px] text-zinc-300">
                            {ci.category === 'retake'
                              ? '言い直し'
                              : ci.category === 'filler'
                              ? 'フィラー'
                              : ci.category === 'tangent'
                              ? '不要雑談'
                              : '無音'}
                          </span>
                        </div>
                        {ci.text && (
                          <div className="text-[11px] text-zinc-300 truncate mt-0.5">
                            「{ci.text}」
                          </div>
                        )}
                        {ci.reason && (
                          <div className="text-[10px] text-zinc-400 mt-0.5">
                            {ci.reason}
                          </div>
                        )}
                      </div>

                      <button
                        onClick={() => setCurrentTime(ci.start)}
                        title="この位置をプレビュー"
                        className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-cyan-300 shrink-0"
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ================= TAB 3: SUBTITLES & WHISPER AI TRANSCRIPTION ================= */}
        {leftPanelTab === 'subtitles' && (
          <>
            {/* Whisper Auto Transcription Card */}
            <div className="p-3.5 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-zinc-100 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-cyan-400" />
                  <span>Workers AI Whisper 自動文字起こし</span>
                </div>
                <span className="text-[10px] font-mono text-zinc-400">
                  large-v3-turbo
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                音声を16kHzモノラルWAVチャンクに分割してCloudflare Workers
                AIへ送信し、タイムスタンプ付きテロップを自動配置します。
              </p>

              {isTranscribing && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-cyan-300">
                    <span>{transcribeStatusText}</span>
                    <span className="font-mono">{transcribeProgress}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full bg-cyan-500 transition-all duration-150"
                      style={{ width: `${transcribeProgress}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  onClick={handleRunWhisperTranscription}
                  disabled={isTranscribing}
                  className="flex-1 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-zinc-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow transition"
                >
                  {isTranscribing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>AI自動テロップ生成</span>
                </button>

                <button
                  onClick={() => addSubtitle()}
                  className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex items-center gap-1 transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>手動追加</span>
                </button>
              </div>
            </div>

            {/* Subtitle List & Direct Editor */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-zinc-300">
                <span>字幕リスト・直接手直し ({subtitles.length}件)</span>
              </div>

              {subtitles.length === 0 ? (
                <div className="p-6 rounded-lg bg-zinc-900/40 border border-zinc-800/80 text-center text-xs text-zinc-500">
                  テロップがありません。「AI自動テロップ生成」または「手動追加」を押してください。
                </div>
              ) : (
                <div className="space-y-2">
                  {subtitles.map((sub, idx) => {
                    const isSelected = selectedItemId === sub.id;
                    return (
                      <div
                        key={sub.id}
                        onClick={() => selectItem('subtitle', sub.id)}
                        className={`p-2.5 rounded-lg border transition space-y-2 ${
                          isSelected
                            ? 'bg-zinc-800/90 border-cyan-500/60 shadow-sm'
                            : 'bg-zinc-900/80 border-zinc-800 hover:border-zinc-700'
                        }`}
                      >
                        {/* Top row: Timestamp inputs & Split / Merge / Delete actions */}
                        <div className="flex items-center justify-between gap-1 text-[11px]">
                          <div className="flex items-center gap-1 font-mono">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setCurrentTime(sub.startTime);
                              }}
                              title="このテロップの先頭へ移動"
                              className="px-1.5 py-0.5 rounded bg-zinc-950 text-cyan-400 hover:bg-cyan-500/20"
                            >
                              #{idx + 1}
                            </button>
                            <input
                              type="number"
                              step={0.1}
                              min={0}
                              value={sub.startTime}
                              onChange={(e) =>
                                updateSubtitle(
                                  sub.id,
                                  {
                                    startTime: Math.max(
                                      0,
                                      Number(e.target.value)
                                    ),
                                  },
                                  true
                                )
                              }
                              className="w-16 px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 text-center"
                            />
                            <span className="text-zinc-500">→</span>
                            <input
                              type="number"
                              step={0.1}
                              min={sub.startTime + 0.1}
                              value={sub.endTime}
                              onChange={(e) =>
                                updateSubtitle(
                                  sub.id,
                                  {
                                    endTime: Math.max(
                                      sub.startTime + 0.1,
                                      Number(e.target.value)
                                    ),
                                  },
                                  true
                                )
                              }
                              className="w-16 px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 text-center"
                            />
                          </div>

                          <div className="flex items-center gap-0.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                splitSubtitle(sub.id);
                              }}
                              title="テロップを2つに分割"
                              className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100"
                            >
                              <SplitSquareHorizontal className="w-3.5 h-3.5" />
                            </button>
                            {idx < subtitles.length - 1 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  mergeSubtitleWithNext(sub.id);
                                }}
                                title="次のテロップと結合"
                                className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100"
                              >
                                <Merge className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteSubtitle(sub.id);
                              }}
                              title="テロップを削除"
                              className="p-1 rounded hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Direct Text Area Editor */}
                        <textarea
                          rows={2}
                          value={sub.text}
                          onChange={(e) =>
                            updateSubtitle(sub.id, { text: e.target.value })
                          }
                          placeholder="テロップ文字列を入力..."
                          className="w-full px-2.5 py-1.5 rounded bg-zinc-950/90 border border-zinc-800 focus:border-cyan-500 focus:outline-none text-xs text-zinc-100 resize-none"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

