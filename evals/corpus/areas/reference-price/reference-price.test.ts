import { Money, Timestamp } from '@agentic-dasher/shared';
import { expect } from 'vitest';
import { corpusTests, notImplemented } from '../../harness.ts';
import { area } from './area.ts';
import type { ChooseReferencePrice, ReferenceCase } from './contract.ts';

/** Phase 1 replaces this stub with the real function from packages/core. */
const chooseReferencePrice: ChooseReferencePrice = () => notImplemented('chooseReferencePrice');

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
    if (typeof item === 'string' && (key === 'at' || key.endsWith('At'))) Timestamp.parse(item);
    wellFormed(item, at);
  }
}

function check(c: ReferenceCase): void {
  wellFormed(c, c.id);
  const ids = new Set<number>();
  for (const l of c.input.listings) {
    if (ids.has(l.listingId)) throw new TypeError(`${c.id}: listing ${l.listingId} twice`);
    ids.add(l.listingId);
  }
  const { reference, currency } = c.input.watch;
  if (reference && reference.price.currency !== currency) {
    throw new TypeError(`${c.id}: the reference is not in the watch's currency`);
  }
  if (c.expected.action === 'set') {
    for (const id of c.expected.fromListings) {
      if (!ids.has(id)) throw new TypeError(`${c.id}: expected listing ${id} is not an input`);
    }
    if (c.expected.price.currency !== c.expected.currency) {
      throw new TypeError(`${c.id}: the expected price is not in the expected currency`);
    }
  }
  if (c.specDerived && !c.notes) throw new TypeError(`${c.id}: specDerived without notes`);
  if (c.specSilent && c.divergence) throw new TypeError(`${c.id}: specSilent and divergence`);
}

corpusTests(
  area,
  (c) => {
    check(c);
    return chooseReferencePrice(c.input);
  },
  (c, actual) => {
    expect(actual).toEqual(c.expected);
  },
);
