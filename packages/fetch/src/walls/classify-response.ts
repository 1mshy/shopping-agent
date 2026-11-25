// The wall classifier on the `api` and `http` rungs: `fetchPage`'s `Classify` hook. It reduces a
// response to the classifier's evidence and returns a wall, `empty`, or null for no opinion, in
// which case `fetchPage` applies `defaultClassify` (a bare 403 is a wall of unknown vendor) and
// then maps the status (Retry-After, 402, the statuses without a kind) with its own clock.
//
// What a body may say depends on what it is:
// - HTML (declared, or sniffed when the type is absent, plain text or JSON): every rule. An HTML
//   challenge served where JSON was asked for is a wall like any other.
// - JSON (declared, or a body that starts with `{` or `[`) and anything else (images, XML, plain
//   text): never a wall because of words inside it. Only a bot manager's own header can make it
//   one, and a 403 is still a block.
// - An empty body on a 2xx: `empty`, whatever the type.
import type { ClassifierVerdict, Classify, ClassifyInput } from '../page/classify.ts';
import { findWall, judgePage } from './classify-page.ts';
import type { PageEvidence } from './evidence.ts';
import { readHtml } from './html.ts';

export type BodyKind = 'html' | 'json' | 'other' | 'none';

/** First character of the body that is not whitespace (or a byte order mark); '' when none. */
function firstCharacter(text: string): string {
  const limit = Math.min(text.length, 4_096);
  for (let i = 0; i < limit; i++) {
    const c = text[i] ?? '';
    if (c !== '﻿' && !/\s/.test(c)) return c;
  }
  return limit < text.length ? '?' : '';
}

/** What a response body is, from its Content-Type and its first character. */
export function bodyKind(contentType: string | null, text: string): BodyKind {
  const first = firstCharacter(text);
  if (first === '') return 'none';
  if (first === '{' || first === '[') return 'json';
  const type = (contentType ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (type === 'text/html' || type === 'application/xhtml+xml') return 'html';
  const sniffable =
    type === '' || type === 'text/plain' || type === 'application/json' || type.endsWith('+json');
  if (first === '<' && sniffable) return 'html';
  return type.includes('json') ? 'json' : 'other';
}

function evidenceOf(input: ClassifyInput, kind: BodyKind): PageEvidence {
  const base = {
    rung: input.rung,
    status: input.status,
    finalUrl: input.finalUrl,
    headers: input.headers,
    documentBytes: input.body.byteLength,
  };
  if (kind === 'html') return { ...base, ...readHtml(input.text) };
  return { ...base, title: '', visibleText: '', visibleChars: 0, markup: [] };
}

/** The wall classifier as `fetchPage`'s `Classify` hook. Pure and synchronous; never throws. */
export const classifyResponse: Classify = (input): ClassifierVerdict | null => {
  try {
    const kind = bodyKind(input.contentType, input.text);
    const page = evidenceOf(input, kind);
    if (kind === 'html') return judgePage(page);
    // Not HTML: a page with no text at all, so only headers and the status speak.
    const wall = findWall(page);
    if (wall !== null) return wall;
    return kind === 'none' && input.status >= 200 && input.status <= 299 ? { kind: 'empty' } : null;
  } catch {
    return null;
  }
};
