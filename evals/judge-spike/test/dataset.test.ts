import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { area as wrongVariant } from '../../corpus/areas/known-failure-wrong-variant/area.ts';
import { area as identifiers } from '../../corpus/areas/match-identifiers/area.ts';
import { area as ownerRulings } from '../../corpus/areas/match-owner-rulings/area.ts';
import { area as titleRules } from '../../corpus/areas/match-title-rules/area.ts';
import type { MatchCase } from '../../corpus/areas/match-title-rules/contract.ts';
import { asked, listing } from '../../corpus/areas/match-title-rules/contract.ts';
import { defineArea } from '../../corpus/harness.ts';
import {
  buildDataset,
  composition,
  compositionMarkdown,
  DATASET,
  datasetFingerprint,
  errorClassOf,
  VARIANT_SPLIT,
} from '../dataset.ts';

const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

function fakeCase(id: string, expected: MatchCase['expected'], kinds: string[] = ['test']) {
  return {
    id,
    what: `case ${id}`,
    input: { asked: asked('Acme Widget 3'), listing: listing(`Listing ${id}`) },
    expected,
    from: kinds.map((kind) => ({ kind, ref: 'somewhere' })),
    label: 'hand-built for the test',
  } as MatchCase;
}

describe('the dataset', () => {
  it('has one item per case of the four matcher areas, by import', () => {
    // 87 + 16 + 48 + 7 = 158 (the corpus counts in docs/progress.md).
    expect(DATASET).toHaveLength(158);
    const byArea = new Map<string, number>();
    for (const i of DATASET) byArea.set(i.area, (byArea.get(i.area) ?? 0) + 1);
    expect(Object.fromEntries(byArea)).toEqual({
      'match-title-rules': titleRules.cases.length,
      'match-identifiers': identifiers.cases.length,
      'match-owner-rulings': ownerRulings.cases.length,
      'known-failure-wrong-variant': wrongVariant.cases.length,
    });
    expect(new Set(DATASET.map((i) => i.key)).size).toBe(158);
  });

  it('keeps the asked side, the listing and the expectation exactly as the corpus has them', () => {
    for (const a of [titleRules, identifiers, ownerRulings, wrongVariant]) {
      for (const c of a.cases) {
        const item = DATASET.find((i) => i.key === `${a.id}/${c.id}`);
        expect(item?.asked).toBe(c.input.asked);
        expect(item?.listing).toBe(c.input.listing);
        expect(item?.gold).toBe(c.expected);
      }
    }
  });

  // 123 single and 35 sets at d5acab7, where spike D was measured; 2026-11-24 (P0-3e): two URL-only
  // exacts became unknown (singles still) and two other_line singles became sets.
  it('counts 121 single labels and 37 sets, and no set holds exact', () => {
    const sets = DATASET.filter((i) => 'oneOf' in i.gold);
    expect(sets).toHaveLength(37);
    expect(DATASET.length - sets.length).toBe(121);
    for (const i of sets) expect('oneOf' in i.gold && i.gold.oneOf.includes('exact')).toBe(false);
  });

  it('gives an error class only to single non-exact labels', () => {
    for (const i of DATASET) {
      if ('oneOf' in i.gold || i.gold.relation === 'exact') expect(i.errorClass).toBeNull();
      else expect(i.errorClass).not.toBeNull();
    }
  });

  it('splits a variant only where the case itself says which, quoting it', () => {
    for (const [key, split] of Object.entries(VARIANT_SPLIT)) {
      const item = DATASET.find((i) => i.key === key);
      expect(item, key).toBeDefined();
      expect(item && 'relation' in item.gold && item.gold.relation).toBe('variant');
      const [areaId, caseId] = key.split('/');
      const c = [titleRules, identifiers, ownerRulings, wrongVariant]
        .find((a) => a.id === areaId)
        ?.cases.find((x) => x.id === caseId);
      expect(`${c?.what} ${c?.label}`).toContain(split.quote);
      expect(item?.errorClass).toBe(`variant:${split.subclass}`);
    }
    const unsplit = DATASET.filter(
      (i) => 'relation' in i.gold && i.gold.relation === 'variant' && !(i.key in VARIANT_SPLIT),
    );
    for (const i of unsplit) expect(i.errorClass).toBe('variant:unspecified');
  });

  it('maps hand-built cases to the classes by their single gold relation', () => {
    const area = defineArea<MatchCase>({
      id: 'fake-area',
      status: 'pending',
      sources: ['hand-built'],
      cases: [
        fakeCase('a', { relation: 'exact' }),
        fakeCase('b', { relation: 'other_line' }),
        fakeCase('c', { relation: 'other_model' }),
        fakeCase('d', { relation: 'bundle' }),
        fakeCase('e', { relation: 'accessory_or_part' }),
        fakeCase('f', { relation: 'unknown' }),
        fakeCase('g', { relation: 'variant' }),
        fakeCase('h', { oneOf: ['variant', 'bundle'] }, ['review', 'run']),
      ],
    });
    const items = buildDataset([area]);
    expect(items.map((i) => i.errorClass)).toEqual([
      null,
      'other_line',
      'other_model',
      'bundle',
      'accessory_or_part',
      'no_positive_evidence',
      'variant:unspecified',
      null,
    ]);
    expect(errorClassOf('fake-area', area.cases[6] as MatchCase)).toBe('variant:unspecified');
    // By hand: 8 items, 7 single (1 exact), 1 set; evidence: test on 7 items, review and run on 1.
    const comp = composition(items);
    expect(comp.total).toBe(8);
    expect(comp.single).toBe(7);
    expect(comp.set).toBe(1);
    expect(comp.byRelation).toMatchObject({ exact: 1, variant: 1, unknown: 1, set: 1 });
    expect(comp.byEvidence).toMatchObject({ test: 7, review: 1, run: 1, spec: 0 });
    expect(comp.byArea['fake-area']).toEqual({ single: 7, set: 1, total: 8 });
  });

  it('marks the listing URL as withheld from the judge where the corpus has one', () => {
    const withUrl = DATASET.filter((i) => i.listing.url !== null);
    expect(withUrl.length).toBeGreaterThan(0);
    for (const i of DATASET) expect(i.withheld).toEqual(i.listing.url === null ? [] : ['url']);
  });

  it('has a stable fingerprint', () => {
    expect(datasetFingerprint(DATASET)).toBe(datasetFingerprint(buildDataset()));
    expect(datasetFingerprint(DATASET)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is described in the README by the table the code computes', () => {
    expect(README).toContain(compositionMarkdown(DATASET));
  });
});
