import {
  applyRead as applyReadImpl,
  showWatchPrice as showWatchPriceImpl,
} from '@agentic-dasher/core';
import { Money, Timestamp } from '@agentic-dasher/shared';
import { expect } from 'vitest';
import { corpusTests } from '../../harness.ts';
import { area } from './area.ts';
import type { ApplyRead, ListingReadState, ShowWatchPrice, StaleReadCase } from './contract.ts';

const applyRead: ApplyRead = applyReadImpl;
const showWatchPrice: ShowWatchPrice = showWatchPriceImpl;

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
    if (
      typeof item === 'string' &&
      (key === 'now' || key === 'at' || key.endsWith('At') || key === 'asOf')
    ) {
      Timestamp.parse(item);
    }
    wellFormed(item, at);
  }
}

function consistent(state: ListingReadState, id: string): void {
  if (state.lastReadFailed !== state.consecutiveErrors > 0) {
    throw new TypeError(`${id}: lastReadFailed and consecutiveErrors disagree`);
  }
  if (state.lastPrice && state.lastReadAt && state.lastPrice.observedAt > state.lastReadAt) {
    throw new TypeError(`${id}: the last price is newer than the last read`);
  }
}

function check(c: StaleReadCase): void {
  wellFormed(c, c.id);
  if (c.subject === 'applyRead') {
    const { state, read } = c.input;
    if (state) {
      consistent(state, c.id);
      if (state.lastReadAt !== null && read.at <= state.lastReadAt) {
        throw new TypeError(`${c.id}: the read is not after the last read`);
      }
    }
    consistent(c.expected.state, c.id);
  } else {
    for (const listing of c.input.listings) consistent(listing.state, c.id);
  }
  if (c.specDerived && !c.notes) throw new TypeError(`${c.id}: specDerived without notes`);
  if (c.specSilent && c.divergence) throw new TypeError(`${c.id}: specSilent and divergence`);
}

corpusTests(
  area,
  (c) => {
    check(c);
    return c.subject === 'applyRead' ? applyRead(c.input) : showWatchPrice(c.input);
  },
  (c, actual) => {
    expect(actual).toEqual(c.expected);
  },
);
