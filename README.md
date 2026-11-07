# CloudCut Pro — Cloudflare Workers AI Video Studio

Cloudflare Workers（Hono + Static Assets）上で動作する、YouTube長尺動画（16:9）およびYouTubeショート（9:16）両対応のブラウザベース動画編集Webアプリケーションです。

## 主な機能
1. **DaVinci Resolve ライクなダークモード 100vh/100vw 固定UI**
   - 16:9（1920×1080 横動画）/ 9:16（1080×1920 ショート縦動画）ワンクリック切替
   - 60fps HTML5 `<canvas>` リアルタイム合成プレビュー（プレビュー上でのテロップ直接ドラッグ移動、セーフゾーン表示対応）
   - アンドゥ / リドゥ履歴管理 (`Ctrl+Z` / `Ctrl+Y`)
2. **ハイブリッド自動カット機能**
   - **無音ジェットカット**: Web Audio API で音声波形を解析し、しきい値 (dB)・最小無音時間 (ms)・前後パディング (ms) に基づいて無音区間をプレビュー表示＆一括リップル削除
   - **AI文脈カット (`gemini-2.5-flash`)**: 文字起こしテキストから「言い直し」「フィラー（えー、あー）」「不要な雑談」のタイムスタンプ区間をAIが自動検出し、タイムライン上でハイライト＆一括リップル削除
3. **Cloudflare Workers AI 自動テロップ生成 (`@cf/openai/whisper-large-v3-turbo`)**
   - 長尺動画でもメモリやリクエスト制限を超えないよう、`OfflineAudioContext` で音声を **35秒単位の 16kHz モノラル WAV チャンク** に自動分割して `/api/transcribe` へ送信
   - 生成された字幕リストのインライン手直し、分割、次との結合、タイムスタンプ微調整に対応
4. **プロ仕様のテロップ装飾 & カスタムフォント動的反映**
   - `.ttf` / `.otf` / `.woff2` カスタムフォントをドラッグ＆ドロップすると `FontFace` API で即座にCanvasプレビューへ反映
   - **二重縁取り（内側アウトライン＋外側アウトライン）**、**背景座布団（角丸・不透明度・パディング）**、**ドロップシャドウ**、**全テロップへのスタイル一括適用**
5. **独自プロジェクトファイル（`.vedit.zip`）の保存・復元**
   - `fflate` ストリーミングZIP処理により、長尺動画を含む **完全パック** または編集データ・フォント・BGMのみを高速保存する **軽量パック** を選択可能
6. **書き出し（Export）**
   - **MP4 直接出力**: WebCodecs API (`VideoEncoder` / `AudioEncoder`) + `mp4-muxer` (`StreamTarget`) によるクライアントサイドMP4エンコード
   - **DaVinci Resolve 連携 FCPXML (`.fcpxml` v1.9)**: カット・速度変更・BGM・字幕配置を反映したタイムラインXML出力
   - **SRT 字幕出力 (`.srt`)**: 手直し後の全テロップを標準SRTフォーマットで出力

## セットアップと起動方法

```bash
# 依存パッケージのインストール
npm install

# ローカル開発（フロントエンド Vite 起動）
npm run dev

# Cloudflare Workers + Workers AI ローカル起動（別ターミナルまたはビルド後）
npm run build
npm run dev:worker

# Cloudflare Workers 本番デプロイ
npm run deploy
```

## 環境変数・シークレット設定
- `APP_PASSCODE`: `/api/*` エンドポイント保護用パスコード（未設定時はローカル開発用として認証スルー）
- `GEMINI_API_KEY`: Gemini APIキー（未設定時はフロントエンド右上の「設定」モーダルから入力したキーを使用）

