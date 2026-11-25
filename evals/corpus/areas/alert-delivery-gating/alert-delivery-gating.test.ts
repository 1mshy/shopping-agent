import { gateOnDelivery as gateOnDeliveryImpl } from '@agentic-dasher/core';
import { Money, Timestamp } from '@agentic-dasher/shared';
import { expect } from 'vitest';
import { corpusTests } from '../../harness.ts';
import { area } from './area.ts';
import type { DeliveryGatingCase, GateOnDelivery } from './contract.ts';

const gateOnDelivery: GateOnDelivery = gateOnDeliveryImpl;

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

function check(c: DeliveryGatingCase): void {
  wellFormed(c, c.id);
  const channels = new Set<number>();
  for (const d of c.input.deliveries) {
    if ((d.acceptedAt !== null) !== (d.state === 'accepted')) {
      throw new TypeError(`${c.id}: acceptedAt must be set exactly when accepted (S§4.4)`);
    }
    if (channels.has(d.channelId)) throw new TypeError(`${c.id}: two deliveries on one channel`);
    channels.add(d.channelId);
  }
  if (c.specDerived && !c.notes) throw new TypeError(`${c.id}: specDerived without notes`);
  if (c.specSilent && c.divergence) throw new TypeError(`${c.id}: specSilent and divergence`);
}

corpusTests(
  area,
  (c) => {
    check(c);
    return gateOnDelivery(c.input);
  },
  (c, actual) => {
    expect(actual).toEqual(c.expected);
  },
);
