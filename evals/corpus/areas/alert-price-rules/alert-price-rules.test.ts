import { Money, Timestamp } from '@agentic-dasher/shared';
import { expect } from 'vitest';
import { corpusTests, notImplemented } from '../../harness.ts';
import { area } from './area.ts';
import type { EvaluatePriceAlert, ListingRead, PriceAlertCase } from './contract.ts';

/** Phase 1 replaces this stub with the real function from packages/core. */
const evaluatePriceAlert: EvaluatePriceAlert = () => notImplemented('evaluatePriceAlert');

/** Throws on malformed case data, so a bad case fails instead of counting as pending. */
function wellFormed(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) wellFormed(item, `${path}[${i}]`);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if ('amountMinor' in value) Money.parse(value);
  for (const [key, item] of Object.entries(value)) {
    const at = `${path}.${key}`;
    if (typeof item === 'number' && !Number.isSafeInteger(item)) {
      throw new TypeError(`${at}: ${item} is not an integer`);
    }
    if (typeof item === 'string' && (key === 'now' || key === 'at' || key.endsWith('At'))) {
      Timestamp.parse(item);
    }
    wellFormed(item, at);
  }
}

const readTime = (read: ListingRead) => (read.kind === 'failed' ? read.at : read.observedAt);

function check(c: PriceAlertCase): void {
  wellFormed(c, c.id);
  const times = c.input.reads.map(readTime);
  if (times.length === 0) throw new TypeError(`${c.id}: no read to evaluate`);
  for (let i = 1; i < times.length; i++) {
    if ((times[i] as string) <= (times[i - 1] as string)) {
      throw new TypeError(`${c.id}: reads are not oldest first at ${i}`);
    }
  }
  if ((times[times.length - 1] as string) > c.input.now) {
    throw new TypeError(`${c.id}: the evaluated read is after now`);
  }
  if (c.specDerived && !c.notes) throw new TypeError(`${c.id}: specDerived without notes`);
  if (c.specSilent && c.divergence) throw new TypeError(`${c.id}: specSilent and divergence`);
}

corpusTests(
  area,
  (c) => {
    check(c);
    return evaluatePriceAlert(c.input);
  },
  (c, actual) => {
    expect(actual).toEqual(c.expected);
  },
);
