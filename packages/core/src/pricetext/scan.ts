// Finds the figures and the currency marks in normalised page text (see normalise.ts). Pure string
// work, linear in the text: no regular expression here can backtrack beyond one figure.
import {
  DOLLAR_FAMILY,
  GLYPH_MARKS,
  type MarkInfo,
  qualifiedDollar,
  SIGN_CHARACTERS,
  wordMark,
} from './marks.ts';

export interface FigureToken {
  readonly start: number;
  /** After the figure, and after its "%" when it is a percentage. */
  readonly end: number;
  /** Digits and separators exactly as in the normalised text. */
  readonly text: string;
  readonly percent: boolean;
  /** Touches letters that are no currency mark: a model number ("RTX4090"), "1.2k", "100g". */
  readonly glued: boolean;
  /** Starts right after a lone "." or ",", as in "$.99": its scale cannot be told. */
  readonly orphanSeparator: boolean;
}

export interface MarkToken {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly info: MarkInfo;
}

export interface Scan {
  readonly figures: readonly FigureToken[];
  readonly marks: readonly MarkToken[];
}

// Digit groups joined by a separator: "." or "," (also with a space on both sides, as a split
// buy-box price joins "$ 99 . 97"), an apostrophe, or a single space.
const FIGURE_RUN = /\d+(?:(?:[.,]| [.,] |'| )\d+)*/g;
const RUN_PART = /\d+| [.,] |[.,' ]/g;
const LETTER = /[\p{L}\p{M}]/u;
const WORD = /[\p{L}\p{M}]+/gu;
const DIGIT = /[0-9]/;
// What may stand between a word mark and its figure: "USD 12", "12 USD", "CAD: 12", "49.- CHF".
const BETWEEN_MARK_AND_FIGURE = new Set([' ', ':', '.', ',', '-']);

/**
 * Splits a run at a space that does not group thousands: a space is a thousands separator only
 * between a group of at most three digits and a group of exactly three ("1 299", "12 345 678").
 * "2 19.99" is two figures, never 219.99.
 */
function splitRun(run: string, offset: number): { start: number; end: number }[] {
  const pieces: { start: number; end: number }[] = [];
  const parts = [...run.matchAll(RUN_PART)].map((m) => ({ text: m[0], at: m.index }));
  let pieceStart = 0;
  for (let i = 1; i < parts.length - 1; i += 2) {
    const joint = parts[i];
    const before = parts[i - 1];
    const after = parts[i + 1];
    if (joint === undefined || before === undefined || after === undefined) continue;
    if (joint.text === ' ' && !(before.text.length <= 3 && after.text.length === 3)) {
      pieces.push({ start: offset + pieceStart, end: offset + joint.at });
      pieceStart = after.at;
    }
  }
  pieces.push({ start: offset + pieceStart, end: offset + run.length });
  return pieces;
}

function isLetter(ch: string | undefined): boolean {
  return ch !== undefined && LETTER.test(ch);
}

export function scan(text: string): Scan {
  const spans: { start: number; end: number }[] = [];
  for (const m of text.matchAll(FIGURE_RUN)) spans.push(...splitRun(m[0], m.index));

  const marks: MarkToken[] = [];
  const consumedWords = new Set<number>(); // start index of a word that qualifies a "$"
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    if (ch === '$') {
      let j = i - 1;
      const spaced = text[j] === ' ';
      if (spaced) j -= 1;
      let k = j;
      while (k >= 0 && isLetter(text[k])) k -= 1;
      const letters = text.slice(k + 1, j + 1);
      const qualified = letters === '' ? null : qualifiedDollar(letters, spaced);
      if (qualified !== null) {
        marks.push({ start: k + 1, end: i + 1, text: text.slice(k + 1, i + 1), info: qualified });
        consumedWords.add(k + 1);
      } else {
        marks.push({ start: i, end: i + 1, text: '$', info: DOLLAR_FAMILY });
      }
    } else if (Object.hasOwn(GLYPH_MARKS, ch)) {
      const info = GLYPH_MARKS[ch];
      if (info !== undefined) marks.push({ start: i, end: i + 1, text: ch, info });
    }
  }

  const hasDigits = DIGIT.test(text);
  const words = [...text.matchAll(WORD)].map((m) => ({ text: m[0], start: m.index }));
  for (const word of words) {
    if (consumedWords.has(word.start)) continue;
    const info = wordMark(word.text);
    if (info === null) continue;
    const end = word.start + word.text.length;
    const alone = !hasDigits && words.length === 1;
    if (alone || besideFigure(text, word.start, end)) {
      marks.push({ start: word.start, end, text: word.text, info });
    }
  }
  marks.sort((a, b) => a.start - b.start);

  const markWordAt = (index: number): boolean =>
    marks.some((mark) => index >= mark.start && index < mark.end);
  const figures = spans.map(({ start, end }): FigureToken => {
    let stop = end;
    let percent = false;
    const afterSpace = text[stop] === ' ' ? stop + 1 : stop;
    if (text[afterSpace] === '%' || text[afterSpace] === '‰') {
      percent = true;
      stop = afterSpace + 1;
    }
    const gluedBefore = isLetter(text[start - 1]) && !markWordAt(start - 1);
    const gluedAfter = !percent && isLetter(text[end]) && !markWordAt(end);
    const before = text[start - 1];
    return {
      start,
      end: stop,
      text: text.slice(start, end),
      percent,
      glued: gluedBefore || gluedAfter,
      orphanSeparator: before === '.' || before === ',',
    };
  });
  return { figures, marks };
}

/** A word mark counts only next to a figure, with spaces, colons, dashes or signs between. */
function besideFigure(text: string, start: number, end: number): boolean {
  const skippable = (ch: string | undefined) =>
    ch !== undefined && (BETWEEN_MARK_AND_FIGURE.has(ch) || SIGN_CHARACTERS.has(ch));
  let i = start - 1;
  while (skippable(text[i])) i -= 1;
  if (DIGIT.test(text[i] ?? '')) return true;
  let j = end;
  while (skippable(text[j])) j += 1;
  return DIGIT.test(text[j] ?? '');
}
