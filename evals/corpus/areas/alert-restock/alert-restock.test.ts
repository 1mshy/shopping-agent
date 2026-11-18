import { Money, Timestamp } from '@agentic-dasher/shared';
import { expect } from 'vitest';
import { corpusTests, notImplemented } from '../../harness.ts';
import { area } from './area.ts';
import type { EvaluateRestock, ListingRead, RestockCase } from './contract.ts';

/** Phase 1 replaces this stub with the real function from packages/core. */
const evaluateRestock: EvaluateRestock = () => notImplemented('evaluateRestock');

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

function check(c: RestockCase): void {
  wellFormed(c, c.id);
  const { now, watch, listings } = c.input;
  for (const stamp of [watch.restockRuleOnSince, watch.lastAcceptedRestockAt]) {
    if (stamp !== null && stamp > now) throw new TypeError(`${c.id}: a watch stamp is after now`);
  }
  if (listings.length === 0) throw new TypeError(`${c.id}: no listing`);
  for (const listing of listings) {
    const times = listing.reads.map(readTime);
    for (let i = 0; i < times.length; i++) {
      const t = times[i] as string;
      if (t > now) throw new TypeError(`${c.id}: a read is after now`);
      if (i > 0 && t <= (times[i - 1] as string)) {
        throw new TypeError(`${c.id}: reads of ${listing.listingId} are not oldest first`);
      }
    }
  }
  if (c.specDerived && !c.notes) throw new TypeError(`${c.id}: specDerived without notes`);
  if (c.specSilent && c.divergence) throw new TypeError(`${c.id}: specSilent and divergence`);
}

corpusTests(
  area,
  (c) => {
    check(c);
    return evaluateRestock(c.input);
  },
  (c, actual) => {
    expect(actual).toEqual(c.expected);
  },
);
