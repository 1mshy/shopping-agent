import type { MatchVerdict } from '@agentic-dasher/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../src/index.ts';
import { readEffectiveVerdict, readVerdicts, writeVerdict } from '../src/verdict-cache.ts';
import { migratedDb } from './fixtures.ts';

const now = { matcherVersion: 'matcher-2', promptVersion: 'judge.v1', modelId: 'model-a' };

function v(more: Partial<MatchVerdict>): MatchVerdict {
  const decidedBy = more.decidedBy ?? 'rules';
  return {
    specFp: 'spec1:0000000000000001',
    listingFp: 'listing1:0000000000000002',
    relation: 'unknown',
    differingAttrs: [],
    decidedBy,
    matcherVersion: 'matcher-2',
    promptVersion: decidedBy === 'model' ? 'judge.v1' : null,
    modelId: decidedBy === 'model' ? 'model-a' : null,
    decidedAt: '2026-11-20T10:00:00.000Z',
    ...more,
  };
}

const read = (db: Database) =>
  readEffectiveVerdict(db, 'spec1:0000000000000001', 'listing1:0000000000000002', now);

describe('verdict cache', () => {
  let db: Database;
  beforeEach(() => {
    db = migratedDb();
  });
  afterEach(() => db.close());

  it('writes a verdict and reads it back under its key', () => {
    const verdict = v({ relation: 'exact', decidedBy: 'identifier' });
    writeVerdict(db, verdict);
    expect(read(db)).toEqual(verdict);
    expect(readVerdicts(db, verdict.specFp, verdict.listingFp)).toEqual([verdict]);
  });

  it('a re-decision under the same key replaces the row', () => {
    writeVerdict(db, v({ relation: 'unknown' }));
    writeVerdict(
      db,
      v({ relation: 'variant', differingAttrs: ['colour'], decidedAt: '2026-11-21T10:00:00.000Z' }),
    );
    const all = readVerdicts(db, 'spec1:0000000000000001', 'listing1:0000000000000002');
    expect(all).toHaveLength(1);
    expect(all[0]?.relation).toBe('variant');
  });

  it('refuses a verdict that breaks the contract (an exact with a differing attribute)', () => {
    expect(() => writeVerdict(db, v({ relation: 'exact', differingAttrs: ['colour'] }))).toThrow();
  });

  it('a person override beats every other verdict, whatever its matcher version', () => {
    writeVerdict(db, v({ decidedBy: 'identifier', relation: 'exact' }));
    writeVerdict(db, v({ decidedBy: 'model', relation: 'exact' }));
    const person = v({
      decidedBy: 'person',
      relation: 'other_model',
      differingAttrs: ['model'],
      matcherVersion: 'matcher-1',
    });
    writeVerdict(db, person);
    expect(read(db)).toEqual(person);
  });

  it('the latest person override wins', () => {
    writeVerdict(db, v({ decidedBy: 'person', relation: 'exact', matcherVersion: 'matcher-1' }));
    const later = v({
      decidedBy: 'person',
      relation: 'variant',
      decidedAt: '2026-11-22T10:00:00.000Z',
    });
    writeVerdict(db, later);
    expect(read(db)).toEqual(later);
  });

  it('without a person, only the current matcher, prompt and model count', () => {
    writeVerdict(db, v({ relation: 'exact', matcherVersion: 'matcher-1' }));
    writeVerdict(db, v({ decidedBy: 'model', relation: 'exact', modelId: 'model-b' }));
    expect(read(db)).toBeNull();
  });

  it('a decided verdict before an undecided one, identifier before rules', () => {
    writeVerdict(db, v({ relation: 'unknown' }));
    const judge = v({ decidedBy: 'model', relation: 'exact' });
    writeVerdict(db, judge);
    expect(read(db)).toEqual(judge);
    const id = v({ decidedBy: 'identifier', relation: 'exact' });
    writeVerdict(db, id);
    expect(read(db)).toEqual(id);
  });
});
