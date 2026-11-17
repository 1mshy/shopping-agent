import { describe, expect, it } from 'vitest';
import { JudgeBatch, MatchVerdict } from '../src/index.ts';
import { expectRefused, expectValid } from './check.ts';

const byModel = {
  specFp: 'spec:5f2c9a',
  listingFp: 'lst:shop.example.ca|WH1000XM5/B|t:91ac|colour=black',
  relation: 'variant',
  differingAttrs: ['colour'],
  decidedBy: 'model',
  matcherVersion: 'rules-3',
  promptVersion: 'judge-2',
  modelId: 'openai/gpt-5-mini',
  decidedAt: '2026-11-17T09:31:00.000Z',
};
const byRules = {
  ...byModel,
  relation: 'exact',
  differingAttrs: [],
  decidedBy: 'rules',
  promptVersion: null,
  modelId: null,
};

describe('MatchVerdict', () => {
  it('accepts model and rules verdicts', () => {
    expectValid(MatchVerdict, byModel);
    expectValid(MatchVerdict, byRules);
    expectValid(MatchVerdict, { ...byRules, decidedBy: 'person' });
  });

  it('keys a model verdict on its prompt version and model id, and only a model verdict (S§5.4)', () => {
    expectRefused(MatchVerdict, { ...byModel, promptVersion: null }, 'promptVersion');
    expectRefused(MatchVerdict, { ...byModel, modelId: null }, 'modelId');
    expectRefused(MatchVerdict, { ...byRules, modelId: 'openai/gpt-5-mini' }, 'modelId');
  });

  it('refuses a relation outside the vocabulary and attribute values in place of names', () => {
    expectRefused(MatchVerdict, { ...byModel, relation: 'similar' }, 'relation');
    expectRefused(
      MatchVerdict,
      { ...byModel, differingAttrs: ['capacity 512GB'] },
      'differingAttrs.0',
    );
  });
});

const judged = {
  verdicts: [
    { id: 'l1', relation: 'exact', differingAttrs: [], reason: 'Same model and colour.' },
    { id: 'l2', relation: 'variant', differingAttrs: ['capacity'], reason: 'Other storage size.' },
    {
      id: 'l3',
      relation: 'accessory_or_part',
      differingAttrs: [],
      reason: 'A replacement ear pad.',
    },
  ],
};

describe('JudgeBatch (model output, S§5.4)', () => {
  it('accepts a batch of {id, relation, differingAttrs, reason}', () => {
    expectValid(JudgeBatch, judged);
  });

  it('refuses an unknown relation', () => {
    const verdicts = [{ ...judged.verdicts[0], relation: 'similar' }];
    expectRefused(JudgeBatch, { verdicts }, 'verdicts.0.relation');
  });

  it('refuses any extra field, so the model cannot hand back a figure (S§2.1)', () => {
    for (const extra of [{ price: 199.99 }, { confidence: 0.8 }, { total: '$199' }]) {
      const result = JudgeBatch.safeParse({ verdicts: [{ ...judged.verdicts[0], ...extra }] });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
    }
    expectRefused(JudgeBatch, { ...judged, cheapest: 'l2' }, '');
  });

  it('refuses figures in differing attributes, duplicate ids and oversized batches', () => {
    const v = judged.verdicts[1];
    expectRefused(
      JudgeBatch,
      { verdicts: [{ ...v, differingAttrs: ['price_199'] }] },
      'verdicts.0.differingAttrs.0',
    );
    expectRefused(JudgeBatch, { verdicts: [v, v] }, 'verdicts');
    const many = Array.from({ length: 16 }, (_, i) => ({ ...v, id: `l${i}` }));
    expectRefused(JudgeBatch, { verdicts: many }, 'verdicts');
    expectRefused(JudgeBatch, { verdicts: [] }, 'verdicts');
  });

  it('refuses exact with differing attributes, repeated attributes and an empty reason', () => {
    const v = judged.verdicts[1];
    const one = (o: object) => ({ verdicts: [{ ...v, ...o }] });
    expectRefused(JudgeBatch, one({ relation: 'exact' }), 'verdicts.0.differingAttrs');
    expectRefused(
      JudgeBatch,
      one({ differingAttrs: ['capacity', 'capacity'] }),
      'verdicts.0.differingAttrs',
    );
    expectRefused(JudgeBatch, one({ reason: '' }), 'verdicts.0.reason');
  });

  it('refuses price-like attribute names as a second line (S§2.1)', () => {
    for (const name of ['price', 'sale_price', 'budget', 'cost', 'discount', 'deal', 'on_sale']) {
      expectRefused(
        JudgeBatch,
        { verdicts: [{ ...judged.verdicts[1], differingAttrs: [name] }] },
        'verdicts.0.differingAttrs.0',
      );
    }
  });
});

describe('MatchVerdict exact', () => {
  it('means the two would share a barcode: no differing attribute (S§5.4)', () => {
    expectRefused(MatchVerdict, { ...byModel, relation: 'exact' }, 'differingAttrs');
    expectRefused(
      MatchVerdict,
      { ...byModel, differingAttrs: ['colour', 'colour'] },
      'differingAttrs',
    );
  });
});
