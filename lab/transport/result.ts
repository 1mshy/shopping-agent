// Result lines of spike A (one JSON line per host) and the classification of one client's answer.
import { classifyObserved, type HttpResponse, type Observed, observe } from '../routes/classify.ts';
import { answerEvidence } from '../routes/evidence.ts';
import type { Evidence, Outcome, Validation } from '../routes/outcome.ts';
import type { Hop } from './get.ts';
import type { Predecessor } from './hosts/hosts.ts';
import { type Readability, readability } from './readable.ts';
import type { ClientId } from './transport.ts';

export interface ClientEvidence extends Evidence {
  /** The readable criterion's verdict on the stored body (readable.ts). */
  readable?: Readability;
  /** The stored body, gzipped, relative to the result file's directory (bodies/<sha256>.gz). */
  body?: string;
  sha256?: string;
}

export interface ClientResult {
  client: ClientId;
  library: string;
  version: string;
  profile: string;
  /** Position of this client in the host's order (0 = first request to the host). */
  position: number;
  startedAt: string;
  ms: number;
  requests: number;
  outcome: Outcome;
  evidence: ClientEvidence;
  chain: Hop[];
  facts: Record<string, string | number | boolean>;
}

export interface HostResult {
  /** 1: first version of the spike A result line. */
  v: 1;
  key: string;
  host: string;
  url: string;
  source: 'lab' | 'playbook';
  group: string;
  predecessor: Predecessor;
  order: ClientId[];
  startedAt: string;
  ms: number;
  requests: number;
  results: ClientResult[];
}

export const validationOf = (r: Readability): Validation =>
  r.readable
    ? { valid: true, items: r.prices.length, note: r.methods.join('+') }
    : { valid: false, reason: 'no_price_markup' };

// Added after the full run, from the classification review: Amazon serves its captcha at the
// product URL with status 200, a generic title ("amazon.ca") and no vendor header, which spike C's
// rule cannot see. The marker is the captcha form's own action path, in a small HTML answer, not
// a phrase of body text.
const CAPTCHA_FORM = /<form\b[^>]*\baction\s*=\s*["']\/errors(?:_page)?\/validateCaptcha["']/i;
const SMALL = 64 * 1024;

/** A wall spike C's rule misses, decided on the body (see CAPTCHA_FORM). */
export function bodyWall(
  contentType: string,
  bytes: number,
  body: string,
): { outcome: Outcome; signal: string } | undefined {
  if (!/html/i.test(contentType) || bytes >= SMALL) return undefined;
  if (CAPTCHA_FORM.test(body)) {
    return {
      outcome: { kind: 'wall', vendor: 'unknown', mode: 'challenge' },
      signal: 'form:amazon_captcha',
    };
  }
  return undefined;
}

/**
 * Spike C's classifier with the readable criterion as its validator: `ok` is readable, a 2xx
 * without price markup and without wall evidence is `invalid_payload` (reported as "served, no
 * price markup"), and every failure kind (wall, rate_limited, forbidden, not_found, …) is spike C's,
 * plus the one body rule above for an answer spike C would not call a wall.
 */
export function classifyBody(
  o: Observed,
  body: string,
): { outcome: Outcome; signals: string[]; readable: Readability; v: Validation } {
  const readable = readability(o.headers['content-type'] ?? '', body);
  const v = validationOf(readable);
  const c = classifyObserved(o, v, 'any');
  if (c.outcome.kind !== 'ok' && c.outcome.kind !== 'wall') {
    const w = bodyWall(o.headers['content-type'] ?? '', o.bytes, body);
    if (w) return { outcome: w.outcome, signals: [...c.signals, w.signal], readable, v };
  }
  return { ...c, readable, v };
}

export function classifyAnswer(
  res: HttpResponse,
  hops: number,
  ms: number,
): { outcome: Outcome; evidence: ClientEvidence } {
  const c = classifyBody(observe(res), res.body);
  return {
    outcome: c.outcome,
    evidence: {
      ...answerEvidence(res, c.v, { signals: c.signals, hops, ms }),
      readable: c.readable,
    },
  };
}

export const isReadable = (o: Outcome) => o.kind === 'ok' || o.kind === 'empty';
