import { Timestamp } from '@agentic-dasher/shared';
import { expect } from 'vitest';
import { corpusTests, notImplemented } from '../../harness.ts';
import { area } from './area.ts';
import type { AttemptResult, DecideDeliveryRetry, NotifyRetryCase } from './contract.ts';

/** Phase 1 replaces this stub with the real function. */
const decideDeliveryRetry: DecideDeliveryRetry = () => notImplemented('decideDeliveryRetry');

/** Throws on malformed case data, so a bad case fails instead of counting as pending. */
function wellFormed(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) wellFormed(item, `${path}[${i}]`);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    const at = `${path}.${key}`;
    if (typeof item === 'number' && !Number.isSafeInteger(item)) {
      throw new TypeError(`${at}: ${item} is not an integer`);
    }
    if (typeof item === 'string' && (key === 'now' || key.endsWith('At') || key === 'notBefore')) {
      Timestamp.parse(item);
    }
    wellFormed(item, at);
  }
}

/** An attempt after which the pass went on: a failure that is retried within the pass. */
function retriedWithinPass(a: AttemptResult): boolean {
  if (a.kind === 'transport_error') return true;
  if (a.kind !== 'http_status') return false;
  const s = a.status;
  return s === 408 || s === 425 || s === 429 || (s >= 500 && s <= 599);
}

function check(c: NotifyRetryCase): void {
  wellFormed(c, c.id);
  const input = c.input;
  if (input.kind === 'after_attempt') {
    const n = input.attempts.length;
    if (n < 1 || n > 4) throw new TypeError(`${c.id}: a pass makes 1 to 4 attempts`);
    if (!input.attempts.slice(0, -1).every(retriedWithinPass)) {
      throw new TypeError(`${c.id}: an earlier attempt would have ended the pass`);
    }
    for (const a of input.attempts) {
      if (a.kind === 'http_status' && (a.status < 300 || a.status > 599)) {
        throw new TypeError(`${c.id}: ${a.status} is not a failure status`);
      }
    }
    if (c.expected.action === 'attempt' || c.expected.action === 'not_due') {
      throw new TypeError(`${c.id}: a due-check answer after an attempt`);
    }
  } else if (c.expected.action !== 'attempt' && c.expected.action !== 'not_due') {
    throw new TypeError(`${c.id}: a due check answers attempt or not_due`);
  }
  if (c.specDerived && !c.notes) throw new TypeError(`${c.id}: specDerived without notes`);
  if (c.specSilent && c.divergence) throw new TypeError(`${c.id}: specSilent and divergence`);
}

corpusTests(
  area,
  (c) => {
    check(c);
    return decideDeliveryRetry(c.input);
  },
  (c, actual) => {
    expect(actual).toEqual(c.expected);
  },
);
