import { intakeWatch as coreIntakeWatch } from '@agentic-dasher/core';
import { Money } from '@agentic-dasher/shared';
import { expect } from 'vitest';
import { corpusTests } from '../../harness.ts';
import { area } from './area.ts';
import type { IntakeCase, IntakeWatch } from './contract.ts';

const intakeWatch: IntakeWatch = coreIntakeWatch;

/** Throws on malformed case data, so a bad case fails instead of counting as pending. */
function wellFormed(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) wellFormed(item, `${path}[${i}]`);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if ('amountMinor' in value) Money.parse(value);
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'number' && !Number.isSafeInteger(item)) {
      throw new TypeError(`${path}.${key}: ${item} is not an integer`);
    }
    wellFormed(item, `${path}.${key}`);
  }
}

function check(c: IntakeCase): void {
  wellFormed(c, c.id);
  const keys = new Set<string>();
  for (const w of c.input.existing) {
    if (keys.has(w.key)) throw new TypeError(`${c.id}: two existing watches share a key`);
    keys.add(w.key);
  }
  if (c.expected.ok && c.expected.action === 'existing') {
    const id = c.expected.watchId;
    if (!c.input.existing.some((w) => w.watchId === id)) {
      throw new TypeError(`${c.id}: the expected watch is not among the existing ones`);
    }
  }
  if (c.specDerived && !c.notes) throw new TypeError(`${c.id}: specDerived without notes`);
  if (c.specSilent && c.divergence) throw new TypeError(`${c.id}: specSilent and divergence`);
}

corpusTests(
  area,
  (c) => {
    check(c);
    return intakeWatch(c.input);
  },
  (c, actual) => {
    expect(actual).toEqual(c.expected);
  },
);
