import { Hono } from 'hono';
import { cors } from 'hono/cors';

export interface Env {
  AI?: Ai;
  ASSETS?: Fetcher;
  APP_PASSCODE?: string;
  GEMINI_API_KEY?: string;
}

export interface TranscribeSegment {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface CutCandidate {
  id: string;
  start: number;
  end: number;
  category: 'retake' | 'filler' | 'tangent';
  reason: string;
  text: string;
  confidence: number;
}

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for local Vite development and API calls
app.use(
  '/api/*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-App-Passcode',
      'X-Gemini-Api-Key',
    ],
  })
);

// Passcode authentication middleware for /api/*
app.use('/api/*', async (c, next) => {
  // Allow health check without auth so client knows if passcode is required
  if (c.req.path === '/api/health') {
    return next();
  }

  const requiredPasscode = c.env.APP_PASSCODE?.trim();
  if (!requiredPasscode) {
    // Local development mode: bypass if APP_PASSCODE is not set
    return next();
  }

  const headerPasscode =
    c.req.header('X-App-Passcode')?.trim() ||
    c.req.header('Authorization')?.replace(/^Bearer\s+/i, '').trim();

  if (!headerPasscode || headerPasscode !== requiredPasscode) {
    return c.json(
      {
        error:
          '認証エラー: パスコードが一致しません。右上の「設定」から正しいアクセス用パスコードを入力してください。',
        code: 'UNAUTHORIZED',
      },
      401
    );
  }

  return next();
});

/**
 * Convert an ArrayBuffer to a Base64 string safely in Cloudflare Workers
 * without exceeding call stack limits on large buffers.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // 32KB chunks
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

/**
 * Parse WebVTT fallback if segments array is not directly returned
 */
function parseVttToSegments(vtt: string, offsetSeconds: number): TranscribeSegment[] {
  const lines = vtt.split(/\r?\n/);
  const segments: TranscribeSegment[] = [];
  const timeRegex =
    /(?:(\d{2}):)?(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(?:(\d{2}):)?(\d{2}):(\d{2})\.(\d{3})/;

  let i = 0;
  while (i < lines.length) {
    const match = lines[i].match(timeRegex);
    if (match) {
      const startH = parseInt(match[1] || '0', 10);
      const startM = parseInt(match[2], 10);
      const startS = parseInt(match[3], 10);
      const startMs = parseInt(match[4], 10);

      const endH = parseInt(match[5] || '0', 10);
      const endM = parseInt(match[6], 10);
      const endS = parseInt(match[7], 10);
      const endMs = parseInt(match[8], 10);

      const start =
        startH * 3600 + startM * 60 + startS + startMs / 1000 + offsetSeconds;
      const end =
        endH * 3600 + endM * 60 + endS + endMs / 1000 + offsetSeconds;

      i++;
      const textLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(lines[i].trim());
        i++;
      }
      const text = textLines.join(' ').trim();
      if (text) {
        segments.push({
          id: `seg-${Math.round(start * 1000)}-${segments.length}`,
          start: Number(start.toFixed(3)),
          end: Number(Math.max(start + 0.3, end).toFixed(3)),
          text,
        });
      }
    } else {
      i++;
    }
  }
  return segments;
}

// Health & Auth Status Check
app.get('/api/health', (c) => {
  const passcodeRequired = Boolean(c.env.APP_PASSCODE?.trim());
  const providedPasscode = c.req.header('X-App-Passcode')?.trim() || '';
  const passcodeValid =
    !passcodeRequired || providedPasscode === c.env.APP_PASSCODE?.trim();

  return c.json({
    ok: true,
    passcodeRequired,
    passcodeValid,
    hasWorkersAI: Boolean(c.env.AI),
    hasServerGeminiKey: Boolean(c.env.GEMINI_API_KEY?.trim()),
  });
});

/**
 * POST /api/transcribe
 * Transcribes a chunk of audio (e.g. 30-60s 16kHz mono WAV) using Cloudflare Workers AI
 * `@cf/openai/whisper-large-v3-turbo` and returns timestamped segments shifted by offsetSeconds.
 */
app.post('/api/transcribe', async (c) => {
  try {
    let audioBuffer: ArrayBuffer | null = null;
    let audioBase64 = '';
    let offsetSeconds = 0;
    let language = 'ja';
    let initialPrompt = '';

    const contentType = c.req.header('Content-Type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await c.req.formData();
      const audioFile = formData.get('audio');
      if (!audioFile || typeof audioFile === 'string') {
        return c.json({ error: '音声ファイル (audio) が指定されていません。' }, 400);
      }
      audioBuffer = await audioFile.arrayBuffer();
      audioBase64 = arrayBufferToBase64(audioBuffer);
      offsetSeconds = parseFloat(String(formData.get('offsetSeconds') || '0')) || 0;
      language = String(formData.get('language') || 'ja');
      initialPrompt = String(formData.get('prompt') || '');
    } else {
      const body = await c.req.json<{
        audioBase64?: string;
        offsetSeconds?: number;
        language?: string;
        prompt?: string;
      }>();
      if (!body.audioBase64) {
        return c.json({ error: 'audioBase64 が指定されていません。' }, 400);
      }
      audioBase64 = body.audioBase64.replace(/^data:audio\/[^;]+;base64,/, '');
      offsetSeconds = Number(body.offsetSeconds || 0);
      language = body.language || 'ja';
      initialPrompt = body.prompt || '';
    }

    if (!c.env.AI) {
      return c.json(
        {
          error:
            'Cloudflare Workers AI バインディング (env.AI) が検出されませんでした。`wrangler dev` または Cloudflare Workers 環境で実行してください。',
          code: 'NO_AI_BINDING',
        },
        503
      );
    }

    // Run @cf/openai/whisper-large-v3-turbo
    interface WhisperRawSegment {
      start?: number;
      end?: number;
      text?: string;
    }

    interface WhisperResult {
      text?: string;
      vtt?: string;
      segments?: WhisperRawSegment[];
      words?: Array<{ word?: string; start?: number; end?: number }>;
    }

    let result: WhisperResult;
    try {
      result = (await c.env.AI.run(
        '@cf/openai/whisper-large-v3-turbo' as Parameters<Ai['run']>[0],
        {
          audio: audioBase64,
          language,
          task: 'transcribe',
          vad_filter: true,
          initial_prompt:
            initialPrompt ||
            'こんにちは。YouTube動画の字幕・テロップ用の日本語文字起こしです。句読点を適切に含めてください。',
        }
      )) as WhisperResult;
    } catch (primaryErr) {
      // Fallback to standard @cf/openai/whisper if large-v3-turbo fails in older local runtime
      if (!audioBuffer) {
        const binaryStr = atob(audioBase64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        audioBuffer = bytes.buffer;
      }
      result = (await c.env.AI.run('@cf/openai/whisper', {
        audio: [...new Uint8Array(audioBuffer)],
      })) as WhisperResult;
      void primaryErr;
    }

    let segments: TranscribeSegment[] = [];

    if (Array.isArray(result.segments) && result.segments.length > 0) {
      segments = result.segments
        .map((seg, idx) => {
          const rawStart = typeof seg.start === 'number' ? seg.start : 0;
          const rawEnd =
            typeof seg.end === 'number' ? seg.end : rawStart + 2.5;
          const start = Number((rawStart + offsetSeconds).toFixed(3));
          const end = Number(
            Math.max(start + 0.25, rawEnd + offsetSeconds).toFixed(3)
          );
          const text = (seg.text || '').trim();
          return {
            id: `seg-${Math.round(start * 1000)}-${idx}`,
            start,
            end,
            text,
          };
        })
        .filter((s) => s.text.length > 0);
    } else if (typeof result.vtt === 'string' && result.vtt.trim().length > 0) {
      segments = parseVttToSegments(result.vtt, offsetSeconds);
    } else if (typeof result.text === 'string' && result.text.trim().length > 0) {
      // Fallback: split text into natural sentences across the chunk
      const sentences = result.text
        .trim()
        .split(/(?<=[。！？!?])\s*|\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const avgDuration = 3.0;
      segments = sentences.map((sentence, idx) => {
        const start = Number((offsetSeconds + idx * avgDuration).toFixed(3));
        const end = Number((start + avgDuration).toFixed(3));
        return {
          id: `seg-${Math.round(start * 1000)}-${idx}`,
          start,
          end,
          text: sentence,
        };
      });
    }

    return c.json({
      text: result.text || segments.map((s) => s.text).join(' '),
      segments,
      offsetSeconds,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json(
      {
        error: `Whisper 文字起こし処理に失敗しました: ${message}`,
      },
      500
    );
  }
});

/**
 * POST /api/analyze-cut
 * Uses Gemini API (`gemini-2.5-flash`) to analyze timestamped transcription segments
 * and detect retakes ("言い直し"), fillers ("えー、あー"), and unnecessary chatter ("不要な雑談").
 */
app.post('/api/analyze-cut', async (c) => {
  try {
    const body = await c.req.json<{
      segments: TranscribeSegment[];
      apiKey?: string;
      customInstruction?: string;
    }>();

    const geminiApiKey =
      body.apiKey?.trim() ||
      c.req.header('X-Gemini-Api-Key')?.trim() ||
      c.env.GEMINI_API_KEY?.trim();

    if (!geminiApiKey) {
      return c.json(
        {
          error:
            'Gemini APIキーが設定されていません。画面右上の「設定」ボタンから Gemini API キーを入力するか、環境変数 GEMINI_API_KEY を設定してください。',
          code: 'MISSING_GEMINI_KEY',
        },
        400
      );
    }

    const segments = body.segments || [];
    if (!Array.isArray(segments) || segments.length === 0) {
      return c.json(
        {
          error:
            '解析対象の文字起こしセグメントが空です。先に「自動文字起こし」を実行するかテロップを追加してください。',
        },
        400
      );
    }

    const transcriptText = segments
      .map(
        (seg, idx) =>
          `[${idx}] (${seg.start.toFixed(2)}s - ${seg.end.toFixed(2)}s): ${seg.text}`
      )
      .join('\n');

    const systemInstruction = `あなたはプロのYouTube動画編集ディレクターです。
与えられたタイムスタンプ付き文字起こしデータを解析し、テンポの良い動画にするためにカット（削除）すべき区間を特定してください。

特に以下の3つのカテゴリを重点的に検出してください：
1. "retake"（言い直し・噛み・重複発言）：同じ内容を直後に言い直している場合の「最初の失敗した発言区間」
2. "filler"（フィラー・不要な感嘆詞）：「えー」「あー」「そのー」「なんか」「えっと」など、文脈上不要なフィラーだけの区間や冗長な間つなぎ
3. "tangent"（不要な雑談・脱線・準備発言）：「テストテスト」「マイク入ってるかな」「ちょっと待ってね」等の収録前後の不要発言や本筋から完全に外れた脱線

注意事項：
- start と end は元のセグメントの秒数（小数）を正確に指定してください。
- 必要な本編の解説まで誤ってカットしないよう、明確に不要な区間のみを選出してください。
${body.customInstruction ? `\n追加指示: ${body.customInstruction}` : ''}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
      geminiApiKey
    )}`;

    const geminiPayload = {
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `以下のタイムスタンプ付き文字起こしからカット候補をJSON形式で出力してください。\n\n${transcriptText}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            candidates: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  start: {
                    type: 'NUMBER',
                    description: 'カット開始秒数 (例: 12.4)',
                  },
                  end: {
                    type: 'NUMBER',
                    description: 'カット終了秒数 (例: 15.8)',
                  },
                  category: {
                    type: 'STRING',
                    enum: ['retake', 'filler', 'tangent'],
                    description:
                      'カテゴリ: retake(言い直し), filler(フィラー), tangent(不要な雑談)',
                  },
                  reason: {
                    type: 'STRING',
                    description: 'カット推奨理由の簡潔な説明（日本語）',
                  },
                  text: {
                    type: 'STRING',
                    description: '該当区間の発話テキスト',
                  },
                  confidence: {
                    type: 'NUMBER',
                    description: '推奨度 (0.0〜1.0)',
                  },
                },
                required: [
                  'start',
                  'end',
                  'category',
                  'reason',
                  'text',
                  'confidence',
                ],
              },
            },
          },
          required: ['candidates'],
        },
      },
    };

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(geminiPayload),
    });

    if (!response.ok) {
      const errText = await response.text();
      return c.json(
        {
          error: `Gemini API エラー (${response.status}): ${errText}`,
        },
        response.status as 400 | 401 | 403 | 429 | 500
      );
    }

    const geminiData = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const rawJsonText =
      geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '{"candidates":[]}';
    const parsed = JSON.parse(rawJsonText) as {
      candidates?: Array<{
        start: number;
        end: number;
        category: 'retake' | 'filler' | 'tangent';
        reason: string;
        text: string;
        confidence?: number;
      }>;
    };

    const rawCandidates = Array.isArray(parsed.candidates)
      ? parsed.candidates
      : [];

    const candidates: CutCandidate[] = rawCandidates
      .filter(
        (item) =>
          typeof item.start === 'number' &&
          typeof item.end === 'number' &&
          item.end > item.start
      )
      .map((item, idx) => ({
        id: `ai-cut-${idx}-${Math.round(item.start * 1000)}`,
        start: Number(item.start.toFixed(3)),
        end: Number(item.end.toFixed(3)),
        category:
          item.category === 'retake' ||
          item.category === 'filler' ||
          item.category === 'tangent'
            ? item.category
            : 'filler',
        reason: item.reason || '不要な発話区間',
        text: item.text || '',
        confidence:
          typeof item.confidence === 'number'
            ? Math.min(1, Math.max(0, item.confidence))
            : 0.85,
      }))
      .sort((a, b) => a.start - b.start);

    return c.json({ candidates });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json(
      {
        error: `AI文脈カット解析中にエラーが発生しました: ${message}`,
      },
      500
    );
  }
});

// Fallback to Cloudflare Static Assets for SPA routes
app.all('*', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('CloudCut Pro Worker API is running.', 200);
});

export default app;

