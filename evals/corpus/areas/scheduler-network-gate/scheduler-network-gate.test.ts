import { networkGate as networkGateImpl } from '@agentic-dasher/core';
import { Timestamp } from '@agentic-dasher/shared';
import { expect } from 'vitest';
import { corpusTests } from '../../harness.ts';
import { area } from './area.ts';
import type { GateCase, NetworkGate } from './contract.ts';

const networkGate: NetworkGate = networkGateImpl;

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
    if (typeof item === 'string' && (key === 'now' || key === 'at' || key.endsWith('At'))) {
      Timestamp.parse(item);
    }
    wellFormed(item, at);
  }
}

function check(c: GateCase): void {
  wellFormed(c, c.id);
  const input = c.input;
  if (input.kind === 'gate') {
    let previous = input.gateStartedAt;
    for (const p of input.probes) {
      if (p.at < previous) throw new TypeError(`${c.id}: probes are not in order`);
      previous = p.at;
    }
    if (input.now < previous) throw new TypeError(`${c.id}: now is before the last probe`);
    if (input.probes.slice(0, -1).some((p) => p.resolved)) {
      throw new TypeError(`${c.id}: the gate continued after a resolved probe`);
    }
  }
  if (c.specDerived && !c.notes) throw new TypeError(`${c.id}: specDerived without notes`);
  if (c.specSilent && c.divergence) throw new TypeError(`${c.id}: specSilent and divergence`);
}

corpusTests(
  area,
  (c) => {
    check(c);
    return networkGate(c.input);
  },
  (c, actual) => {
    expect(actual).toEqual(c.expected);
  },
);
