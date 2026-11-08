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
  /** Word-level timestamps (timeline seconds, offset applied) when Whisper returns them */
  words?: Array<{ text: string; start: number; end: number }>;
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

/** Preferred Gemini models (current names). If the first one 404s we auto-discover via ListModels. */
const GEMINI_PREFERRED_MODELS = [
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-3.1-pro-preview',
  'gemini-3-pro-preview',
  'gemini-flash-latest',
  'gemini-pro-latest',
];

/** Cloudflare Workers AI backup models (used when Gemini key is missing / quota / all models fail) */
const WORKERS_AI_CUT_MODELS = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-3.1-8b-instruct',
];

/** Last model that worked in this isolate (avoids a 404 + ListModels round-trip on every call) */
let cachedGeminiModel: string | null = null;

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function isModelUnavailable(status: number, body: string): boolean {
  return (
    status === 404 ||
    /no longer available|is not found|not found for api version|is not supported|deprecated/i.test(
      body
    )
  );
}

/** GET v1beta/models -> names (without "models/") that support generateContent and contain "gemini" */
async function listGeminiGenerateContentModels(
  apiKey: string
): Promise<string[]> {
  const names: string[] = [];
  let pageToken = '';
  for (let page = 0; page < 5; page++) {
    const url =
      `${GEMINI_BASE}/models?pageSize=200&key=${encodeURIComponent(apiKey)}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`ListModels (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
      nextPageToken?: string;
    };
    for (const m of data.models || []) {
      if (
        m.name &&
        /gemini/i.test(m.name) &&
        (m.supportedGenerationMethods || []).includes('generateContent')
      ) {
        names.push(m.name.replace(/^models\//, ''));
      }
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return names;
}

/** Order discovered models: flash first, then pro, then others; non-lite before lite; newest version first */
function rankDiscoveredGeminiModels(names: string[]): string[] {
  const usable = names.filter(
    (n) =>
      !/embed|image|tts|live|audio|native|aqa|robotics|computer-use|learnlm|imagen/i.test(
        n
      )
  );
  const group = (n: string) => (/flash/i.test(n) ? 0 : /pro/i.test(n) ? 1 : 2);
  const version = (n: string) => {
    const m = n.match(/gemini-(\d+(?:\.\d+)?)/i);
    return m ? parseFloat(m[1]) : 0;
  };
  const lite = (n: string) => (/lite/i.test(n) ? 1 : 0);
  const preview = (n: string) => (/preview|exp/i.test(n) ? 1 : 0);
  return [...usable].sort(
    (a, b) =>
      group(a) - group(b) ||
      lite(a) - lite(b) ||
      version(b) - version(a) ||
      preview(a) - preview(b) ||
      a.localeCompare(b)
  );
}

/**
 * Call Gemini with automatic model discovery:
 *  1. try the cached / first preferred model
 *  2. on 404 / "no longer available" (or quota/5xx) call ListModels and try the preferred models that
 *     actually exist, then dynamically ranked ones (flash > pro)
 * Throws on hard errors (invalid key etc.) or when no model works.
 */
async function runGeminiWithModelDiscovery(
  apiKey: string,
  payload: unknown
): Promise<{ text: string; model: string }> {
  const errors: string[] = [];
  const tried = new Set<string>();

  const attempt = async (
    model: string
  ): Promise<{ text: string; model: string } | 'retry'> => {
    tried.add(model);
    let res: Response;
    try {
      res = await fetch(
        `${GEMINI_BASE}/models/${model}:generateContent?key=${encodeURIComponent(
          apiKey
        )}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
    } catch (err) {
      errors.push(`${model}: ${err instanceof Error ? err.message : String(err)}`);
      return 'retry';
    }
    const bodyText = await res.text();
    if (res.ok) {
      const data = JSON.parse(bodyText) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = (data.candidates?.[0]?.content?.parts || [])
        .map((p) => p.text || '')
        .join('');
      cachedGeminiModel = model;
      return { text: text || '{"candidates":[]}', model };
    }
    errors.push(`${model} (${res.status}): ${bodyText.slice(0, 200)}`);
    if (cachedGeminiModel === model && isModelUnavailable(res.status, bodyText)) {
      cachedGeminiModel = null;
    }
    if (
      isModelUnavailable(res.status, bodyText) ||
      res.status === 429 ||
      res.status >= 500
    ) {
      return 'retry';
    }
    throw new Error(`Gemini API エラー (${res.status}): ${bodyText.slice(0, 300)}`);
  };

  const first = cachedGeminiModel || GEMINI_PREFERRED_MODELS[0];
  const firstResult = await attempt(first);
  if (firstResult !== 'retry') return firstResult;

  // Discover what this API key can actually use
  let ordered: string[] = [];
  try {
    const available = await listGeminiGenerateContentModels(apiKey);
    const availableSet = new Set(available);
    const preferredAvailable = GEMINI_PREFERRED_MODELS.filter((m) =>
      availableSet.has(m)
    );
    ordered = [...preferredAvailable, ...rankDiscoveredGeminiModels(available)];
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    ordered = [...GEMINI_PREFERRED_MODELS]; // blind fallback if ListModels itself fails
  }

  let attempts = 0;
  for (const model of ordered) {
    if (tried.has(model)) continue;
    if (attempts++ >= 5) break;
    const result = await attempt(model);
    if (result !== 'retry') return result;
  }

  throw new Error(`利用可能なGeminiモデルが見つかりません: ${errors.join(' | ')}`);
}

/** Backup: same cut analysis with Cloudflare Workers AI (Llama), returns raw JSON text */
async function runWorkersAiCutAnalysis(
  ai: Ai,
  systemInstruction: string,
  transcriptText: string
): Promise<{ text: string; model: string }> {
  const runner = ai as unknown as {
    run: (model: string, input: unknown) => Promise<unknown>;
  };
  const jsonRule = `

出力は次の形式のJSONオブジェクトのみを返してください（説明文・コードブロック・前置きは禁止）:
{"candidates":[{"start":数値(秒),"end":数値(秒),"category":"retake"|"filler"|"tangent","reason":"日本語の理由","text":"該当発話","confidence":0.0〜1.0の数値}]}
カットすべき区間が無い場合は {"candidates":[]} を返してください。`;

  const errors: string[] = [];
  for (const model of WORKERS_AI_CUT_MODELS) {
    try {
      const out = await runner.run(model, {
        messages: [
          { role: 'system', content: systemInstruction + jsonRule },
          {
            role: 'user',
            content: `以下のタイムスタンプ付き文字起こしからカット候補をJSONで出力してください。\n\n${transcriptText}`,
          },
        ],
        max_tokens: 2048,
        temperature: 0.2,
      });
      const r = (out as { response?: unknown } | null)?.response;
      const text =
        typeof r === 'string' ? r : JSON.stringify(r ?? out ?? { candidates: [] });
      return { text, model: `workers-ai:${model}` };
    } catch (err) {
      errors.push(`${model}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(errors.join(' | '));
}

/** Tolerant JSON extraction for LLM output (handles code fences / surrounding prose / bare arrays) */
function parseCutJson(raw: string): {
  candidates?: Array<{
    start: number;
    end: number;
    category: 'retake' | 'filler' | 'tangent';
    reason: string;
    text: string;
    confidence?: number;
  }>;
} {
  const tryParse = (t: string) => {
    try {
      return JSON.parse(t) as unknown;
    } catch {
      return undefined;
    }
  };
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  let value = tryParse(cleaned);
  if (value === undefined) {
    const o1 = cleaned.indexOf('{');
    const o2 = cleaned.lastIndexOf('}');
    if (o1 >= 0 && o2 > o1) value = tryParse(cleaned.slice(o1, o2 + 1));
  }
  if (value === undefined) {
    const a1 = cleaned.indexOf('[');
    const a2 = cleaned.lastIndexOf(']');
    if (a1 >= 0 && a2 > a1) value = tryParse(cleaned.slice(a1, a2 + 1));
  }
  if (Array.isArray(value)) return { candidates: value as never };
  if (value && typeof value === 'object') return value as never;
  return { candidates: [] };
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
    interface WhisperRawWord {
      word?: string;
      text?: string;
      start?: number;
      end?: number;
    }

    interface WhisperRawSegment {
      start?: number;
      end?: number;
      text?: string;
      words?: WhisperRawWord[];
    }

    interface WhisperResult {
      text?: string;
      vtt?: string;
      segments?: WhisperRawSegment[];
      words?: WhisperRawWord[];
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

          // Word timestamps: prefer the segment's own words, else top-level words inside this span
          const rawWords: WhisperRawWord[] =
            Array.isArray(seg.words) && seg.words.length > 0
              ? seg.words
              : (result.words || []).filter(
                  (w) =>
                    typeof w.start === 'number' &&
                    w.start >= rawStart - 0.05 &&
                    w.start < rawEnd + 0.05
                );
          const words = rawWords
            .map((w) => {
              const wText = (w.word ?? w.text ?? '').trim();
              if (!wText || typeof w.start !== 'number') return null;
              const ws = Number((w.start + offsetSeconds).toFixed(3));
              const we = Number(
                Math.max(
                  ws + 0.02,
                  (typeof w.end === 'number' ? w.end : w.start + 0.2) + offsetSeconds
                ).toFixed(3)
              );
              return { text: wText, start: ws, end: we };
            })
            .filter((w): w is { text: string; start: number; end: number } => w !== null);

          return {
            id: `seg-${Math.round(start * 1000)}-${idx}`,
            start,
            end,
            text,
            ...(words.length > 0 ? { words } : {}),
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

    let rawJsonText = '';
    let usedModel = '';
    let provider: 'gemini' | 'workers-ai' = 'gemini';
    const failures: string[] = [];

    // 1) Gemini with dynamic model discovery
    if (geminiApiKey) {
      try {
        const r = await runGeminiWithModelDiscovery(geminiApiKey, geminiPayload);
        rawJsonText = r.text;
        usedModel = r.model;
      } catch (err) {
        failures.push(`Gemini: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      failures.push('Gemini: APIキーが未設定です');
    }

    // 2) Backup: Cloudflare Workers AI (Llama)
    if (!usedModel) {
      if (!c.env.AI) {
        return c.json(
          {
            error: `AI文脈カットに失敗しました（Workers AI バインディングも利用できません）: ${failures.join(
              ' | '
            )}`,
            code: geminiApiKey ? 'GEMINI_FAILED' : 'MISSING_GEMINI_KEY',
          },
          geminiApiKey ? 502 : 400
        );
      }
      try {
        const r = await runWorkersAiCutAnalysis(
          c.env.AI,
          systemInstruction,
          transcriptText
        );
        rawJsonText = r.text;
        usedModel = r.model;
        provider = 'workers-ai';
      } catch (err) {
        failures.push(
          `Workers AI: ${err instanceof Error ? err.message : String(err)}`
        );
        return c.json(
          { error: `AI文脈カットに失敗しました: ${failures.join(' | ')}` },
          502
        );
      }
    }

    c.header('X-Gemini-Model-Used', usedModel);
    const parsed = parseCutJson(rawJsonText);

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

    return c.json({
      candidates,
      model: usedModel,
      provider,
      warnings: failures,
    });
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

/** Generic Workers AI JSON call (backup LLM) */
async function runWorkersAiJson(
  ai: Ai,
  systemInstruction: string,
  userText: string
): Promise<{ text: string; model: string }> {
  const runner = ai as unknown as {
    run: (model: string, input: unknown) => Promise<unknown>;
  };
  const errors: string[] = [];
  for (const model of WORKERS_AI_CUT_MODELS) {
    try {
      const out = await runner.run(model, {
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userText },
        ],
        max_tokens: 4096,
        temperature: 0.2,
      });
      const r = (out as { response?: unknown } | null)?.response;
      const text = typeof r === 'string' ? r : JSON.stringify(r ?? out ?? {});
      return { text, model: `workers-ai:${model}` };
    } catch (err) {
      errors.push(`${model}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(errors.join(' | '));
}

/** Tolerant JSON extraction for LLM output */
function parseLooseJson(raw: string): unknown {
  const tryParse = (t: string) => {
    try {
      return JSON.parse(t) as unknown;
    } catch {
      return undefined;
    }
  };
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  let v = tryParse(cleaned);
  if (v === undefined) {
    const o1 = cleaned.indexOf('{');
    const o2 = cleaned.lastIndexOf('}');
    if (o1 >= 0 && o2 > o1) v = tryParse(cleaned.slice(o1, o2 + 1));
  }
  if (v === undefined) {
    const a1 = cleaned.indexOf('[');
    const a2 = cleaned.lastIndexOf(']');
    if (a1 >= 0 && a2 > a1) v = tryParse(cleaned.slice(a1, a2 + 1));
  }
  return v;
}

/**
 * POST /api/format-subtitles
 * LLM "pro editor" formatting of subtitle segments: removes fillers, fixes kanji / mis-conversions,
 * and splits each segment into short, easy-to-read chunks (chunks may contain "\n" for 2-line layout).
 * Timing is allocated by the client (character ratio inside the original segment span).
 */
app.post('/api/format-subtitles', async (c) => {
  try {
    const body = await c.req.json<{
      segments: Array<{ index: number; start: number; end: number; text: string }>;
      apiKey?: string;
      aspectRatio?: '16:9' | '9:16';
      style?: 'machinegun' | 'standard' | 'twoline';
      maxCharsPerLine?: number;
      removeFillers?: boolean;
      removePunctuation?: boolean;
      customInstruction?: string;
    }>();

    const segments = (body.segments || []).slice(0, 60);
    if (segments.length === 0) {
      return c.json({ error: '整形対象のテロップがありません。' }, 400);
    }

    const geminiApiKey =
      body.apiKey?.trim() ||
      c.req.header('X-Gemini-Api-Key')?.trim() ||
      c.env.GEMINI_API_KEY?.trim();

    const aspect = body.aspectRatio === '9:16' ? '9:16' : '16:9';
    const style = body.style || 'standard';
    const maxChars = Math.max(
      6,
      Math.min(30, Math.round(body.maxCharsPerLine || (aspect === '9:16' ? 9 : 14)))
    );
    const maxLines = style === 'machinegun' ? 1 : 2;

    const systemInstruction = `あなたはプロのYouTube動画編集者です。話し言葉の文字起こしを、そのまま公開できる読みやすいテロップに整形します。

【ルール】
- 入力の各セグメント(index)ごとに、テロップ1枚ぶんの文字列を並べた配列 chunks を返す（時間順）。
- 1つの chunk は 1枚のテロップ。最大 ${maxLines} 行、1行あたり最大 ${maxChars} 文字（全角換算）。${
      maxLines > 1
        ? '2行にする場合は chunk 内に "\\n" を入れ、上下の文字数が均等で文節の切れ目になる位置で改行する。'
        : '1行のみ（改行しない）。'
    }
- ${aspect === '9:16' ? '縦型ショート動画向け: テンポよく短く区切る。' : '横型動画向け: 意味の塊ごとに区切る。'}
- 分割・改行は必ず意味の切れ目（文節・句読点・接続助詞の後）で行い、単語の途中（「自動|編集」「You|Tube」等）で切らない。
${
  body.removeFillers === false
    ? ''
    : '- 「えー」「あー」「えっと」「そのー」「まあ」などの不要なフィラー・言い淀みは削除する。\n'
}- 漢字が連続して読みにくい箇所や明らかな誤変換は、文脈に合う自然な表記に直す。意味や内容は変えない・足さない。
${
  body.removePunctuation === false
    ? ''
    : '- 句点「。」と読点「、」は出力しない（！？… は残してよい）。\n'
}- 発話がフィラーのみで内容が無い場合は chunks を空配列にする。
${body.customInstruction ? `\n追加指示: ${body.customInstruction}` : ''}`;

    const userText =
      '次のセグメントを整形してください。\n\n' +
      JSON.stringify(
        segments.map((s) => ({
          index: s.index,
          start: s.start,
          end: s.end,
          text: s.text,
        }))
      );

    const geminiPayload = {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            results: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  index: { type: 'INTEGER' },
                  chunks: { type: 'ARRAY', items: { type: 'STRING' } },
                },
                required: ['index', 'chunks'],
              },
            },
          },
          required: ['results'],
        },
      },
    };

    let rawText = '';
    let usedModel = '';
    let provider: 'gemini' | 'workers-ai' = 'gemini';
    const failures: string[] = [];

    if (geminiApiKey) {
      try {
        const r = await runGeminiWithModelDiscovery(geminiApiKey, geminiPayload);
        rawText = r.text;
        usedModel = r.model;
      } catch (err) {
        failures.push(`Gemini: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      failures.push('Gemini: APIキーが未設定です');
    }

    if (!usedModel) {
      if (!c.env.AI) {
        return c.json(
          {
            error: `テロップ整形に失敗しました（Workers AI も利用できません）: ${failures.join(' | ')}`,
            code: geminiApiKey ? 'GEMINI_FAILED' : 'MISSING_GEMINI_KEY',
          },
          geminiApiKey ? 502 : 400
        );
      }
      try {
        const jsonRule = `\n\n出力は次の形式のJSONオブジェクトのみ（説明・コードブロック禁止）:\n{"results":[{"index":数値,"chunks":["テロップ1","テロップ2"]}]}`;
        const r = await runWorkersAiJson(c.env.AI, systemInstruction + jsonRule, userText);
        rawText = r.text;
        usedModel = r.model;
        provider = 'workers-ai';
      } catch (err) {
        failures.push(`Workers AI: ${err instanceof Error ? err.message : String(err)}`);
        return c.json({ error: `テロップ整形に失敗しました: ${failures.join(' | ')}` }, 502);
      }
    }

    const parsed = parseLooseJson(rawText) as
      | { results?: unknown }
      | unknown[]
      | undefined;
    const list: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { results?: unknown } | undefined)?.results)
      ? ((parsed as { results: unknown[] }).results)
      : [];

    const validIndexes = new Set(segments.map((s) => s.index));
    const results = list
      .map((item) => {
        const it = item as { index?: unknown; chunks?: unknown };
        const index = typeof it.index === 'number' ? it.index : NaN;
        const chunks = Array.isArray(it.chunks)
          ? it.chunks
              .filter((x): x is string => typeof x === 'string')
              .map((x) => x.replace(/\\n/g, '\n').trim())
              .filter((x) => x.length > 0)
          : [];
        return { index, chunks };
      })
      .filter((r) => validIndexes.has(r.index));

    c.header('X-Gemini-Model-Used', usedModel);
    return c.json({ results, model: usedModel, provider, warnings: failures });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `テロップ整形中にエラーが発生しました: ${message}` }, 500);
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

