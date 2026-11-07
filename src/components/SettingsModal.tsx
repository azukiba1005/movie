import React, { useEffect, useState } from 'react';
import {
  X,
  KeyRound,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useEditorStore } from '../store/useEditorStore';

export const SettingsModal: React.FC = () => {
  const isOpen = useEditorStore((s) => s.isSettingsModalOpen);
  const appPasscode = useEditorStore((s) => s.appPasscode);
  const geminiApiKey = useEditorStore((s) => s.geminiApiKey);
  const setSettingsModalOpen = useEditorStore((s) => s.setSettingsModalOpen);
  const setAppPasscode = useEditorStore((s) => s.setAppPasscode);
  const setGeminiApiKey = useEditorStore((s) => s.setGeminiApiKey);
  const setStatusNotification = useEditorStore((s) => s.setStatusNotification);

  const [passcodeInput, setPasscodeInput] = useState(appPasscode);
  const [geminiInput, setGeminiInput] = useState(geminiApiKey);
  const [serverStatus, setServerStatus] = useState<{
    checked: boolean;
    passcodeRequired?: boolean;
    passcodeValid?: boolean;
    hasWorkersAI?: boolean;
    hasServerGeminiKey?: boolean;
    error?: string;
  }>({ checked: false });

  useEffect(() => {
    if (isOpen) {
      setPasscodeInput(appPasscode);
      setGeminiInput(geminiApiKey);
      checkHealth(appPasscode);
    }
  }, [isOpen, appPasscode, geminiApiKey]);

  const checkHealth = async (codeToTest: string) => {
    try {
      const res = await fetch('/api/health', {
        headers: {
          'X-App-Passcode': codeToTest,
        },
      });
      if (!res.ok) {
        setServerStatus({
          checked: true,
          error: `Worker API 応答エラー (${res.status})`,
        });
        return;
      }
      const data = await res.json();
      setServerStatus({
        checked: true,
        passcodeRequired: data.passcodeRequired,
        passcodeValid: data.passcodeValid,
        hasWorkersAI: data.hasWorkersAI,
        hasServerGeminiKey: data.hasServerGeminiKey,
      });
    } catch {
      setServerStatus({
        checked: true,
        error:
          'Worker API に接続できません（フロントエンド単体起動中、または wrangler dev 未起動）',
      });
    }
  };

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setAppPasscode(passcodeInput.trim());
    setGeminiApiKey(geminiInput.trim());
    checkHealth(passcodeInput.trim());
    setStatusNotification('APIアクセス設定を保存しました');
    setSettingsModalOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-xl bg-[#1f1f23] border border-zinc-700 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#18181b] border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-zinc-100">
              システム設定 & API認証
            </h2>
          </div>
          <button
            onClick={() => setSettingsModalOpen(false)}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-5">
          {/* Server Connection Status Box */}
          {serverStatus.checked && (
            <div className="p-3 rounded-lg bg-zinc-900/90 border border-zinc-800 text-xs space-y-1.5">
              <div className="font-semibold text-zinc-300 flex items-center gap-1.5">
                {serverStatus.error ? (
                  <>
                    <AlertCircle className="w-4 h-4 text-amber-400" />
                    <span className="text-amber-300">{serverStatus.error}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="text-emerald-300">
                      Cloudflare Workers API 接続オンライン
                    </span>
                  </>
                )}
              </div>
              {!serverStatus.error && (
                <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-zinc-400">
                  <div>
                    パスコード保護:{' '}
                    <span className="text-zinc-200 font-medium">
                      {serverStatus.passcodeRequired
                        ? serverStatus.passcodeValid
                          ? '認証OK'
                          : '要パスコード入力'
                        : '未設定（開発用スルー）'}
                    </span>
                  </div>
                  <div>
                    Workers AI (Whisper):{' '}
                    <span className="text-zinc-200 font-medium">
                      {serverStatus.hasWorkersAI ? '有効' : '未バインド'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* APP_PASSCODE */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-cyan-400" />
              <span>APIアクセス用パスコード (APP_PASSCODE)</span>
            </label>
            <input
              type="password"
              value={passcodeInput}
              onChange={(e) => setPasscodeInput(e.target.value)}
              placeholder="Workersの環境変数 APP_PASSCODE と一致するパスコード..."
              className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
            />
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              公開運用時に第三者による Workers AI の不正利用を防ぐためのパスコードです。サーバー側で{' '}
              <code className="text-zinc-300">APP_PASSCODE</code>{' '}
              が未設定の場合は空欄のままで動作します。
            </p>
          </div>

          {/* GEMINI_API_KEY */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>Gemini API キー (gemini-2.5-flash 文脈カット用)</span>
            </label>
            <input
              type="password"
              value={geminiInput}
              onChange={(e) => setGeminiInput(e.target.value)}
              placeholder="AIzaSy... (サーバー環境変数 GEMINI_API_KEY 設定時は省略可)"
              className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
            />
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              文字起こし結果から「言い直し」「フィラー（えー、あー）」「不要な雑談」を{' '}
              <code className="text-zinc-300">gemini-2.5-flash</code>{' '}
              で自動検出する際に使用します。ブラウザのローカルストレージにのみ保存されます。
            </p>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2 border-t border-zinc-800">
            <button
              type="button"
              onClick={() => checkHealth(passcodeInput.trim())}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 transition"
            >
              接続テスト
            </button>
            <button
              type="button"
              onClick={() => setSettingsModalOpen(false)}
              className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-xs text-zinc-400 transition"
            >
              キャンセル
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-semibold text-xs transition"
            >
              設定を保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

