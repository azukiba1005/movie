import { SubtitleItem, SubtitleStyle } from '../types/editor';

/**
 * Smart subtitle formatter for YouTube / Shorts:
 *  - splits long Whisper segments into several short subtitles (time is allocated from word timestamps
 *    when available, otherwise by character ratio)
 *  - inserts natural line breaks at bunsetsu (phrase) boundaries
 *  - Japanese kinsoku rules, never cuts inside kanji compounds / katakana words / Latin words
 *  - optional removal of 。 and 、
 */

export type SplitStyle = 'machinegun' | 'standard' | 'twoline';
export type SubtitleAspect = '16:9' | '9:16';

export interface SubtitleFormatOptions {
  aspectRatio: SubtitleAspect;
  style: SplitStyle;
  /** Max characters per line (8..22) */
  maxCharsPerLine: number;
  /** Remove 。 and 、 (default true) */
  removePunctuation: boolean;
}

export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

export interface RawSegment {
  id?: string;
  start: number;
  end: number;
  text: string;
  words?: TimedWord[];
  groupId?: string;
}

export interface FormattedPiece {
  start: number;
  end: number;
  text: string; // may contain '\n'
  groupId: string;
}

export const SPLIT_STYLE_INFO: Record<
  SplitStyle,
  { label: string; description: string }
> = {
  machinegun: {
    label: 'マシンガン',
    description: '短文1行・テンポ重視（実況／ショート向け）',
  },
  standard: {
    label: '標準',
    description: '文節分割（最大2行のバランス改行）',
  },
  twoline: {
    label: '2行改行',
    description: '2行に美しく折り返す',
  },
};

/** Default max chars per line for each style / aspect */
export function defaultMaxChars(
  aspect: SubtitleAspect,
  style: SplitStyle
): number {
  if (aspect === '9:16') return style === 'machinegun' ? 10 : 9;
  return style === 'machinegun' ? 15 : 14;
}

const maxLinesFor = (style: SplitStyle) => (style === 'machinegun' ? 1 : 2);

// ---------------------------------------------------------------------------------------------
// Character classes
// ---------------------------------------------------------------------------------------------
const isKanji = (c: string) => /[\u4e00-\u9fff\u3400-\u4dbf々〆ヶ]/.test(c);
const isHira = (c: string) => /[\u3041-\u309f]/.test(c);
const isKata = (c: string) => /[\u30a1-\u30fa\u30fc\u30fd\u30fe]/.test(c);
const isAlnum = (c: string) => /[A-Za-z0-9０-９Ａ-Ｚａ-ｚ]/.test(c);

const SMALL_OR_PROLONG = 'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮー々';
const CLOSING_OR_PUNCT = '、。，．！？!?…‥」』）)・,.:;：；';
const OPENING = '「『（(';

/** Display width of a character (Latin is narrower than a Japanese glyph) */
const widthOf = (c: string) => (isAlnum(c) ? 0.6 : c === ' ' ? 0.5 : 1);

// ---------------------------------------------------------------------------------------------
// Break-point scoring
// ---------------------------------------------------------------------------------------------
// Level: 3 punctuation / space, 2 clause ending, 1.5 particle / te-form, 1 script change,
//        0 allowed-but-bad, -1 forbidden (kinsoku / inside a word)
const penaltyOf = (lv: number) => {
  if (lv < 0) return 400;
  if (lv >= 3) return 0;
  if (lv >= 2) return 3;
  if (lv >= 1.5) return 6;
  if (lv >= 1) return 10;
  return 38;
};

const CLAUSE_ENDINGS = [
  'けれども',
  'けれど',
  'けども',
  'けど',
  'でしたが',
  'ましたが',
  'ですが',
  'ますが',
  'ですので',
  'ますので',
  'ですから',
  'ますから',
  'ですね',
  'ますね',
  'ですよ',
  'ますよ',
  'ですか',
  'ますか',
  'でした',
  'ました',
  'ません',
  'のに',
  'ので',
  'から',
  'です',
  'ます',
  'だよ',
  'よね',
];
const SENTENCE_FINAL = new Set([
  'ですね',
  'ますね',
  'ですよ',
  'ますよ',
  'ですか',
  'ますか',
  'でした',
  'ました',
  'ません',
  'です',
  'ます',
  'だよ',
  'よね',
]);
const TE_FORMS = [
  'ないで',
  'ながら',
  'して',
  'って',
  'んで',
  'いて',
  'きて',
  'えて',
  'けて',
  'めて',
  'れて',
  'ても',
  'でも',
  'たら',
  'なら',
  'れば',
  'ずに',
];
const PARTICLES = 'はがをにでともへも';
const PARTICLE_CHAIN = 'はもとがをにへやしかねすって';

const isContentStart = (c: string | undefined) =>
  !!c && (isKanji(c) || isKata(c) || isAlnum(c));

function clauseEndingLevel(chars: string[], i: number): number {
  const tail = chars.slice(Math.max(0, i - 4), i + 1).join('');
  const rest = chars.slice(i + 1, i + 4);
  const next = rest[0];
  if (!next) return -1;

  // 1) clause / sentence endings
  for (const e of CLAUSE_ENDINGS) {
    if (tail.endsWith(e)) {
      if (SENTENCE_FINAL.has(e) && 'かねよわなぞぜさがけからのしもと'.includes(next)) {
        break; // the sentence-final particle / next connector attaches to it
      }
      if (!SENTENCE_FINAL.has(e) && 'すっゃゅょ'.includes(next)) break;
      return 2;
    }
  }

  // 2) te-forms etc: only when a content word starts right after
  for (const e of TE_FORMS) {
    if (tail.endsWith(e) && isContentStart(next)) return 1.5;
  }

  // 3) single particles after a noun-like char
  const c = chars[i];
  const prev = chars[i - 1];
  if (
    PARTICLES.includes(c) &&
    prev &&
    (isKanji(prev) || isKata(prev) || isAlnum(prev) || prev === 'ー') &&
    !PARTICLE_CHAIN.includes(next)
  ) {
    if (c === 'と' && 'いこかき'.includes(next)) return 0;
    return 1.5;
  }
  return 0;
}

/** Break level after chars[i] (between i and i+1) */
function breakLevel(chars: string[], i: number): number {
  const c = chars[i];
  const nx = chars[i + 1];
  if (nx === undefined) return 3;

  if (OPENING.includes(c)) return -1;
  if (SMALL_OR_PROLONG.includes(nx) || CLOSING_OR_PUNCT.includes(nx)) return -1;
  if (nx === ' ' || nx === '　') return -1; // cut after the space instead

  // a space between two Latin tokens is only a weak break ("Cloudflare Workers")
  if (c === ' ' && isAlnum(chars[i - 1] ?? '') && isAlnum(nx)) return 1.5;
  if (c === ' ' || c === '　' || c === '\n') return 3;
  if ('。！？!?…‥」』）)、，'.includes(c)) return 3;

  // inside a Latin / number token
  if (isAlnum(c) && isAlnum(nx)) return -1;
  if (isAlnum(c) && '.%％\'’-+＋'.includes(nx)) return -1;
  if ('.-\'’'.includes(c) && isAlnum(chars[i - 1] ?? '') && isAlnum(nx)) return -1;
  // katakana word / kanji compound are single words
  if (isKata(c) && isKata(nx)) return -1;
  if (isKanji(c) && isKanji(nx)) return -1;

  let lv = clauseEndingLevel(chars, i);

  // script change: start of a new content word
  if (
    (isHira(c) && (isKanji(nx) || isKata(nx) || isAlnum(nx)) && !'おごみ'.includes(c)) ||
    (isKata(c) && isKanji(nx)) ||
    (isKanji(c) && (isKata(nx) || isAlnum(nx))) ||
    (isAlnum(c) && (isKanji(nx) || isKata(nx)))
  ) {
    lv = Math.max(lv, 1);
  }
  return lv;
}

function computeBreaks(chars: string[]): number[] {
  return chars.map((_, i) => breakLevel(chars, i));
}

// ---------------------------------------------------------------------------------------------
// Core data
// ---------------------------------------------------------------------------------------------
interface Ch {
  ch: string;
  orig: number; // index in the original code-point array, -1 for synthetic spaces
}

const widthSum = (arr: Ch[], a: number, b: number) => {
  let w = 0;
  for (let i = a; i < b; i++) w += widthOf(arr[i].ch);
  return w;
};

/** Build the working char list (punctuation removal & space handling) */
function buildChars(text: string, removePunct: boolean): Ch[] {
  const orig = Array.from(text);
  const out: Ch[] = [];
  const isRemovable = (c: string, i: number) => {
    if (c === '。' || c === '、' || c === '，' || c === '､' || c === '．') return removePunct;
    if (c === ',' || c === '.') {
      const nx = orig[i + 1];
      const pv = orig[i - 1];
      if (c === '.' && pv && nx && isAlnum(pv) && isAlnum(nx)) return false; // 3.5, a.b
      if (c === ',' && pv && nx && /[0-9]/.test(pv) && /[0-9]/.test(nx)) return false; // 1,000
      return removePunct && (nx === undefined || nx === ' ' || nx === '　' || !isAlnum(nx));
    }
    return false;
  };

  for (let i = 0; i < orig.length; i++) {
    const c = orig[i];
    if (c === '\n' || c === '\r' || c === '\t') {
      out.push({ ch: ' ', orig: i });
      continue;
    }
    if (isRemovable(c, i)) {
      // a removed punctuation mark keeps a break opportunity (as a space)
      out.push({ ch: ' ', orig: i });
      continue;
    }
    out.push({ ch: c, orig: i });
  }

  // collapse spaces; keep a single space only between two Latin/number tokens
  const collapsed: Ch[] = [];
  for (let i = 0; i < out.length; i++) {
    const cur = out[i];
    if (cur.ch === ' ' || cur.ch === '　') {
      const last = collapsed[collapsed.length - 1];
      if (!last) continue;
      if (last.ch === ' ') continue;
      collapsed.push({ ch: ' ', orig: cur.orig });
    } else {
      collapsed.push(cur);
    }
  }
  while (collapsed.length && collapsed[collapsed.length - 1].ch === ' ') collapsed.pop();

  // Spaces between Japanese chars are only break hints: they are dropped when the pieces are
  // built (see trimSpaces); between Latin tokens they stay as real spaces.
  return collapsed;
}

interface Piece {
  chars: Ch[];
  whole: boolean; // a complete clause (can be merged with neighbours)
}

const SPACE: Ch = { ch: ' ', orig: -1 };

/** DP: split chars[a,b) into exactly k pieces ≤ cap, minimising imbalance and bad cut points */
function dpSplit(
  chars: Ch[],
  br: number[],
  a: number,
  b: number,
  k: number,
  cap: number
): { ranges: Array<[number, number]>; cost: number } | null {
  const total = widthSum(chars, a, b);
  const avg = total / k;
  const n = b - a;
  const INF = 1e9;
  const dp: number[][] = Array.from({ length: k + 1 }, () =>
    new Array(n + 1).fill(INF)
  );
  const from: number[][] = Array.from({ length: k + 1 }, () =>
    new Array(n + 1).fill(-1)
  );
  dp[0][0] = 0;
  for (let m = 1; m <= k; m++) {
    for (let j = m; j <= n; j++) {
      for (let i = m - 1; i < j; i++) {
        if (dp[m - 1][i] >= INF) continue;
        const w = widthSum(chars, a + i, a + j);
        if (w > cap || w <= 0) continue;
        const cutPen = i > 0 ? penaltyOf(br[a + i - 1]) : 0;
        const cost = dp[m - 1][i] + (w - avg) * (w - avg) * 0.5 + cutPen;
        if (cost < dp[m][j]) {
          dp[m][j] = cost;
          from[m][j] = i;
        }
      }
    }
  }
  if (dp[k][n] >= INF) return null;
  const ranges: Array<[number, number]> = [];
  let j = n;
  for (let m = k; m >= 1; m--) {
    const i = from[m][j];
    ranges.unshift([a + i, a + j]);
    j = i;
  }
  return { ranges, cost: dp[k][n] + (k - 1) * 4 };
}

function splitIntoPieces(chars: Ch[], cap: number): Piece[] {
  if (chars.length === 0) return [];
  const br = computeBreaks(chars.map((c) => c.ch));

  // 1) clauses at strong breaks
  const clauses: Array<[number, number]> = [];
  let s = 0;
  for (let i = 0; i < chars.length; i++) {
    if (br[i] >= 3 || i === chars.length - 1) {
      clauses.push([s, i + 1]);
      s = i + 1;
    }
  }

  // 2) split long clauses
  const pieces: Piece[] = [];
  for (const [a, b] of clauses) {
    const slice = chars.slice(a, b);
    // drop surrounding spaces of the clause
    let ca = 0;
    let cb = slice.length;
    while (ca < cb && slice[ca].ch === ' ') ca++;
    while (cb > ca && slice[cb - 1].ch === ' ') cb--;
    if (cb <= ca) continue;
    const aa = a + ca;
    const bb = a + cb;
    const w = widthSum(chars, aa, bb);
    if (w <= cap) {
      pieces.push({ chars: chars.slice(aa, bb), whole: true });
      continue;
    }
    let ranges: Array<[number, number]> | null = null;
    let bestCost = Infinity;
    const kMin = Math.max(2, Math.ceil(w / cap));
    // try a few piece counts and keep the cheapest (avoids cutting inside a word to save a piece)
    for (let k = kMin; k <= kMin + 2; k++) {
      const r = dpSplit(chars, br, aa, bb, k, cap);
      if (r && r.cost < bestCost) {
        bestCost = r.cost;
        ranges = r.ranges;
      }
    }
    if (!ranges) {
      // extreme fallback: hard cut
      ranges = [];
      let st = aa;
      let acc = 0;
      for (let i = aa; i < bb; i++) {
        acc += widthOf(chars[i].ch);
        if (acc >= cap && i + 1 < bb) {
          ranges.push([st, i + 1]);
          st = i + 1;
          acc = 0;
        }
      }
      ranges.push([st, bb]);
    }
    for (const [ra, rb] of ranges) {
      pieces.push({ chars: chars.slice(ra, rb), whole: false });
    }
  }

  // 3) merge neighbouring whole clauses while they fit (joined by a space = break hint)
  const merged: Piece[] = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (last && last.whole && p.whole) {
      const w =
        widthSum(last.chars, 0, last.chars.length) +
        widthOf(' ') +
        widthSum(p.chars, 0, p.chars.length);
      if (w <= cap) {
        last.chars = [...last.chars, SPACE, ...p.chars];
        continue;
      }
    }
    merged.push({ chars: [...p.chars], whole: p.whole });
  }
  return merged;
}

/** Build the subtitle text (with a balanced line break when needed) */
function pieceToLines(
  chars: Ch[],
  maxChars: number,
  maxLines: number,
  forceTwoLine: boolean
): string {
  const joinChars = (arr: Ch[]) => {
    let out = '';
    for (let i = 0; i < arr.length; i++) {
      const c = arr[i].ch;
      if (c === ' ') {
        // joined clauses / Latin words keep a single visible space
        if (out.length > 0 && !out.endsWith(' ') && i < arr.length - 1) out += ' ';
        continue;
      }
      out += c;
    }
    return out.trim();
  };

  const total = widthSum(chars, 0, chars.length);
  const needBreak =
    maxLines >= 2 &&
    chars.length >= 4 &&
    (total > maxChars + 0.5 || (forceTwoLine && total > maxChars * 0.8));
  if (!needBreak) return joinChars(chars);

  const br = computeBreaks(chars.map((c) => c.ch));
  let bestPos = -1;
  let bestCost = Infinity;
  for (let p = 1; p < chars.length - 1; p++) {
    // cut after index p-1 (left = [0,p), right = [p,end))
    const left = widthSum(chars, 0, p);
    const right = total - left;
    if (left < 2 || right < 2) continue;
    const overflow = Math.max(0, left - maxChars - 1) + Math.max(0, right - maxChars - 1);
    const cost =
      Math.abs(left - right) * 1.0 + penaltyOf(br[p - 1]) * 1.5 + overflow * 20;
    if (cost < bestCost) {
      bestCost = cost;
      bestPos = p;
    }
  }
  if (bestPos < 0) return joinChars(chars);
  const l = joinChars(chars.slice(0, bestPos));
  const r = joinChars(chars.slice(bestPos));
  return r ? `${l}\n${r}` : l;
}

// ---------------------------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------------------------
interface CharTimes {
  start: number[];
  end: number[];
}

function buildCharTimes(seg: RawSegment, text: string): CharTimes {
  const orig = Array.from(text);
  const n = Math.max(1, orig.length);
  const dur = Math.max(0.01, seg.end - seg.start);
  const start = new Array<number>(n).fill(NaN);
  const end = new Array<number>(n).fill(NaN);

  let alignedChars = 0;
  const nonSpace = orig.filter((c) => c.trim() !== '').length || 1;

  if (seg.words && seg.words.length > 0) {
    const joined = orig.join('');
    let cursorChars = 0;
    for (const w of seg.words) {
      const wt = Array.from((w.text || '').replace(/\s+/g, ''));
      if (wt.length === 0) continue;
      // find the word starting from the cursor (code-point aware)
      const hay = orig.slice(cursorChars);
      const hayStr = hay.join('');
      const found = hayStr.indexOf(wt.join(''));
      void joined;
      if (found < 0) continue;
      const foundChars = Array.from(hayStr.slice(0, found)).length;
      if (foundChars > 14) continue; // too far: probably a mismatch
      const idx = cursorChars + foundChars;
      const span = Math.max(1e-3, w.end - w.start);
      for (let k = 0; k < wt.length && idx + k < n; k++) {
        start[idx + k] = w.start + (span * k) / wt.length;
        end[idx + k] = w.start + (span * (k + 1)) / wt.length;
        alignedChars++;
      }
      cursorChars = idx + wt.length;
    }
  }

  if (alignedChars / nonSpace < 0.5) {
    // fallback: proportional by character count
    for (let i = 0; i < n; i++) {
      start[i] = seg.start + (dur * i) / n;
      end[i] = seg.start + (dur * (i + 1)) / n;
    }
    return { start, end };
  }

  // fill unaligned chars (punctuation etc.) by interpolating between aligned neighbours
  let i = 0;
  while (i < n) {
    if (!Number.isNaN(start[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && Number.isNaN(start[j])) j++;
    const t0 = i > 0 ? end[i - 1] : seg.start;
    const t1 = j < n ? start[j] : seg.end;
    const cnt = j - i;
    for (let k = 0; k < cnt; k++) {
      start[i + k] = t0 + ((t1 - t0) * k) / cnt;
      end[i + k] = t0 + ((t1 - t0) * (k + 1)) / cnt;
    }
    i = j;
  }
  for (let k = 0; k < n; k++) {
    start[k] = Math.max(seg.start, Math.min(seg.end, start[k]));
    end[k] = Math.max(start[k], Math.min(seg.end, end[k]));
  }
  return { start, end };
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------
let groupCounter = 0;
const newGroupId = () =>
  `grp-${Date.now().toString(36)}-${(groupCounter++).toString(36)}`;

/** Format one segment into one or more subtitle pieces */
export function formatSegment(
  seg: RawSegment,
  opts: SubtitleFormatOptions
): FormattedPiece[] {
  const groupId = seg.groupId || newGroupId();
  const text = (seg.text || '').trim();
  if (!text) return [];

  const maxLines = maxLinesFor(opts.style);
  const maxChars = Math.max(6, opts.maxCharsPerLine);
  const cap = maxLines * maxChars + 1;

  const chars = buildChars(text, opts.removePunctuation);
  if (chars.length === 0) return [];
  const pieces = splitIntoPieces(chars, cap);
  if (pieces.length === 0) return [];

  const times = buildCharTimes(seg, text);
  const raw = pieces.map((p) => {
    const real = p.chars.filter((c) => c.orig >= 0);
    const first = real[0]?.orig ?? 0;
    const last = real[real.length - 1]?.orig ?? first;
    return {
      text: pieceToLines(p.chars, maxChars, maxLines, opts.style === 'twoline'),
      s: times.start[Math.min(first, times.start.length - 1)],
      e: times.end[Math.min(last, times.end.length - 1)],
    };
  });

  const MIN_DUR = 0.4;
  const result: FormattedPiece[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (!raw[i].text) continue;
    const nextStart = i < raw.length - 1 ? raw[i + 1].s : seg.end;
    let start = Math.max(seg.start, raw[i].s);
    let end: number;
    if (i === raw.length - 1) {
      end = Math.max(raw[i].e, seg.end);
    } else {
      // keep the subtitle on screen until the next one starts (unless a long pause)
      end = nextStart - raw[i].e <= 0.6 ? nextStart : raw[i].e;
    }
    if (end - start < MIN_DUR) {
      end = Math.min(Math.max(nextStart, start + 0.15), start + MIN_DUR);
      if (i === raw.length - 1) end = Math.max(end, start + MIN_DUR);
    }
    start = Number(start.toFixed(3));
    end = Number(Math.max(end, start + 0.15).toFixed(3));
    result.push({ start, end, text: raw[i].text, groupId });
  }
  return result;
}

/** Format all Whisper segments (in order) */
export function formatSegments(
  segments: RawSegment[],
  opts: SubtitleFormatOptions
): FormattedPiece[] {
  const out: FormattedPiece[] = [];
  for (const seg of segments) out.push(...formatSegment(seg, opts));
  return out;
}

export interface SubtitleGroup {
  items: SubtitleItem[];
  segment: RawSegment;
}

/**
 * Merge adjacent subtitles that came from the same original segment (same groupId) back into
 * one segment, using each subtitle as a "timed word" so timing stays accurate.
 */
export function groupSubtitles(subs: SubtitleItem[]): SubtitleGroup[] {
  const sorted = [...subs].sort((a, b) => a.startTime - b.startTime);
  const groups: SubtitleItem[][] = [];
  for (const s of sorted) {
    const last = groups[groups.length - 1];
    if (last && s.groupId && last[last.length - 1].groupId === s.groupId) {
      last.push(s);
    } else {
      groups.push([s]);
    }
  }
  return groups.map((items) => {
    const words: TimedWord[] = [];
    let text = '';
    for (const it of items) {
      const t = it.text.replace(/\r?\n/g, '').trim();
      if (!t) continue;
      // Latin-Latin needs a real space; after a sentence ending a space is kept as a clause hint
      const needSpace =
        text.length > 0 &&
        ((isAlnum(text[text.length - 1]) && isAlnum(t[0])) ||
          /(です|ます|でした|ました|ません|！|？|…)$/.test(text));
      if (needSpace) text += ' ';
      text += t;
      words.push({ text: t, start: it.startTime, end: it.endTime });
    }
    return {
      items,
      segment: {
        id: items[0].id,
        start: items[0].startTime,
        end: items[items.length - 1].endTime,
        text,
        words,
        groupId: items[0].groupId,
      },
    };
  });
}

export interface ReformattedSubtitle extends FormattedPiece {
  style: SubtitleStyle;
}

/** Re-split / re-wrap the existing subtitles (keeps each group's style) */
export function reformatSubtitleItems(
  subs: SubtitleItem[],
  opts: SubtitleFormatOptions
): ReformattedSubtitle[] {
  const out: ReformattedSubtitle[] = [];
  for (const g of groupSubtitles(subs)) {
    const pieces = formatSegment(g.segment, opts);
    if (pieces.length === 0) {
      // nothing to format (empty text): keep as is
      for (const it of g.items) {
        out.push({
          start: it.startTime,
          end: it.endTime,
          text: it.text,
          groupId: it.groupId || newGroupId(),
          style: it.style,
        });
      }
      continue;
    }
    for (const p of pieces) out.push({ ...p, style: g.items[0].style });
  }
  return out;
}

// ---- LLM result post-processing ----------------------------------------------------------

/** Does the text already satisfy the layout (line count & per-line width)? */
export function fitsLayout(text: string, opts: SubtitleFormatOptions): boolean {
  const lines = text.split('\n');
  if (lines.length > maxLinesFor(opts.style)) return false;
  return lines.every((l) => {
    let w = 0;
    for (const c of Array.from(l)) w += widthOf(c);
    return w <= opts.maxCharsPerLine + 1.5;
  });
}

/** Remove 。 and 、 (keeping ！ ？ …) */
export function stripPunctuation(text: string): string {
  return text.replace(/[。、，､]/g, '').replace(/[ \t]+$/gm, '').trim();
}

/**
 * Distribute [start,end] over LLM chunks by character ratio; chunks that still overflow the
 * layout are re-split with the rule-based formatter.
 */
export function layoutLlmChunks(
  chunks: string[],
  start: number,
  end: number,
  opts: SubtitleFormatOptions,
  groupId: string
): FormattedPiece[] {
  const cleaned = chunks
    .map((c) => (opts.removePunctuation ? stripPunctuation(c) : c.trim()))
    .filter((c) => c.replace(/\s/g, '').length > 0);
  if (cleaned.length === 0) return [];

  const counts = cleaned.map((c) => Math.max(1, c.replace(/\s/g, '').length));
  const sum = counts.reduce((a, b) => a + b, 0);
  const dur = Math.max(0.2, end - start);
  const out: FormattedPiece[] = [];
  let acc = 0;
  cleaned.forEach((text, i) => {
    const s = start + (dur * acc) / sum;
    acc += counts[i];
    const e = start + (dur * acc) / sum;
    if (fitsLayout(text, opts)) {
      out.push({
        start: Number(s.toFixed(3)),
        end: Number(e.toFixed(3)),
        text,
        groupId,
      });
    } else {
      out.push(
        ...formatSegment(
          { start: s, end: e, text: text.replace(/\n/g, ''), groupId },
          opts
        )
      );
    }
  });
  return out;
}
