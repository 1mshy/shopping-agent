import { planJobRun as planJobRunImpl } from '@agentic-dasher/core';
import { Timestamp } from '@agentic-dasher/shared';
import { expect } from 'vitest';
import { corpusTests } from '../../harness.ts';
import { area } from './area.ts';
import type { CatchUpCase, PlanJobRun } from './contract.ts';

const planJobRun: PlanJobRun = planJobRunImpl;

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
    if (typeof item === 'string' && (key === 'now' || key.endsWith('At'))) Timestamp.parse(item);
    wellFormed(item, at);
  }
}

function check(c: CatchUpCase): void {
  wellFormed(c, c.id);
  const { job, now, running } = c.input;
  if (job.everyMs <= 0 || job.deadlineMs <= 0) throw new TypeError(`${c.id}: bad durations`);
  if (running && running.startedAt > now) throw new TypeError(`${c.id}: run starts after now`);
  if (c.expected.action === 'time_out') {
    const ran = running ? Date.parse(now) - Date.parse(running.startedAt) : -1;
    if (ran < job.deadlineMs) throw new TypeError(`${c.id}: times out a run inside its deadline`);
  } else if (c.expected.action !== 'join') {
    const offset = Date.parse(c.expected.nextRunAt) - Date.parse(job.nextRunAt);
    if (offset < 0 || offset % job.everyMs !== 0) {
      throw new TypeError(`${c.id}: the expected next slot is off the job's grid`);
    }
  }
  if (c.specDerived && !c.notes) throw new TypeError(`${c.id}: specDerived without notes`);
  if (c.specSilent && c.divergence) throw new TypeError(`${c.id}: specSilent and divergence`);
}

corpusTests(
  area,
  (c) => {
    check(c);
    return planJobRun(c.input);
  },
  (c, actual) => {
    expect(actual).toEqual(c.expected);
  },
);
