import { describe, expect, it } from 'vitest';
import { applyBlockPatch, foldStream, StreamBlock, StreamEvent } from '../src/index.ts';
import { expectRefused, expectValid } from './check.ts';

const intent = {
  kind: 'exact',
  name: 'Sony WH-1000XM5 headphones',
  brand: 'Sony',
  model: 'WH-1000XM5',
  mustHave: [],
  substitutes: [],
  conditions: ['new'],
  packQuantity: null,
  fulfilment: ['delivery'],
  gtin: null,
  mpn: null,
  currency: 'CAD',
  location: { country: 'CA', postalCode: null },
  budget: null,
};
const cad = (amountMinor: number) => ({ amountMinor, currency: 'CAD' });

const plan = {
  type: 'plan',
  mode: 'fast',
  intent,
  queries: ['Sony WH-1000XM5', 'WH-1000XM5 Canada', 'Sony XM5'],
};
const reading = {
  type: 'store_read',
  state: 'reading',
  host: 'www.bestbuy.ca',
  storeId: 4,
  url: 'https://www.bestbuy.ca/en-ca/product/17396614',
  observationId: null,
  price: null,
  wallVendor: null,
};
const priced = { ...reading, state: 'priced', observationId: 9081, price: cad(39999) };
const candidate = {
  type: 'candidate',
  listingId: 33,
  storeId: 4,
  host: 'www.bestbuy.ca',
  url: 'https://www.bestbuy.ca/en-ca/product/17396614',
  title: 'Sony WH-1000XM5 Wireless Headphones - Black',
  condition: 'new',
  trustTier: 'known',
  observation: {
    id: 9081,
    observedAt: '2026-11-17T10:00:03.120Z',
    itemPrice: cad(39999),
    landed: null,
    taxIncluded: false,
    readPath: 'json_ld',
    rung: 'http',
  },
};
const verdict = {
  type: 'verdict',
  listingId: 33,
  relation: 'exact',
  decidedBy: 'identifier',
  group: 'exact',
  deal: { label: 'cheapest_of_n', storeCount: 6, underMedianBp: 1250 },
  shareAtOrBelow90dBp: null,
};
const summary = {
  type: 'summary',
  segments: [
    { kind: 'text', text: 'The lowest verified price is ' },
    { kind: 'money', observationId: 9081, amount: cad(39999) },
    { kind: 'text', text: ' at ' },
    { kind: 'store', host: 'www.bestbuy.ca' },
    { kind: 'text', text: ', the cheapest of ' },
    { kind: 'count', n: 6 },
    { kind: 'text', text: ' stores checked.' },
  ],
};
const coverage = {
  type: 'coverage',
  coverage: {
    sources: [
      {
        kind: 'store',
        host: 'www.bestbuy.ca',
        storeId: 4,
        enabled: true,
        attempted: true,
        completed: true,
        walled: false,
        timedOut: false,
        foundUnverified: 0,
        verified: 1,
      },
    ],
  },
};

describe('StreamBlock (S§5.6)', () => {
  it('accepts each block type', () => {
    for (const block of [plan, reading, priced, candidate, verdict, summary, coverage]) {
      expectValid(StreamBlock, block);
    }
    expectValid(StreamBlock, { ...reading, state: 'walled', wallVendor: 'akamai' });
    expectValid(StreamBlock, { ...reading, state: 'no_price' });
    expectValid(StreamBlock, {
      ...verdict,
      deal: { label: 'good_price' },
      shareAtOrBelow90dBp: 2200,
    });
  });

  it('carries a price only as Money with the observation it came from', () => {
    expectRefused(StreamBlock, { ...priced, price: 399.99 }, 'price');
    expectRefused(StreamBlock, { ...priced, price: '$399.99' }, 'price');
    expectRefused(
      StreamBlock,
      { ...priced, price: { amountMinor: 399.99, currency: 'CAD' } },
      'price.amountMinor',
    );
    expectRefused(StreamBlock, { ...priced, observationId: null }, 'observationId');
    expectRefused(StreamBlock, { ...reading, price: cad(39999) }, 'price');
    expectRefused(StreamBlock, { ...priced, state: 'no_price' }, 'price');
    expectRefused(StreamBlock, { ...reading, wallVendor: 'akamai' }, 'wallVendor');
    const observation = {
      ...candidate.observation,
      landed: { amountMinor: 41000, currency: 'USD' },
    };
    expectRefused(StreamBlock, { ...candidate, observation }, 'observation.landed');
    const lower = { ...candidate.observation, landed: cad(100) };
    expectRefused(StreamBlock, { ...candidate, observation: lower }, 'observation.landed');
  });

  it('keeps model prose and code-filled values in separate segments', () => {
    const joined = {
      type: 'summary',
      segments: [{ kind: 'text', text: 'Lowest is $399.99 at Best Buy.' }],
    };
    expectRefused(StreamBlock, joined, 'segments.0.text');
    const floatMoney = { kind: 'money', observationId: 9081, amount: 399.99 };
    expectRefused(StreamBlock, { type: 'summary', segments: [floatMoney] }, 'segments.0.amount');
    const pre = { kind: 'text', text: 'x', value: cad(1) };
    expectRefused(StreamBlock, { type: 'summary', segments: [pre] }, 'segments.0');
    expectRefused(
      StreamBlock,
      { type: 'summary', segments: [{ kind: 'count', n: 2.5 }] },
      'segments.0.n',
    );
  });

  it('takes labels from the vocabularies and never shows a substitute as exact', () => {
    expectRefused(StreamBlock, { ...verdict, relation: 'variant' }, 'group');
    expectRefused(StreamBlock, { ...verdict, deal: { label: 'great_deal' } }, 'deal.label');
    expectRefused(
      StreamBlock,
      { ...verdict, deal: { label: 'cheapest_of_n', storeCount: 1, underMedianBp: 0 } },
      'deal.storeCount',
    );
    expectRefused(StreamBlock, { ...verdict, deal: { label: 'typical', storeCount: 6 } }, 'deal');
    expectRefused(StreamBlock, { ...verdict, shareAtOrBelow90dBp: 12000 }, 'shareAtOrBelow90dBp');
    expectRefused(StreamBlock, { ...candidate, trustTier: 'trusted' }, 'trustTier');
    expectRefused(StreamBlock, { ...priced, state: 'done' }, 'state');
  });
});

const ev = {
  plan: { event: 'block', seq: 1, blockId: 1, block: plan },
  read: { event: 'block', seq: 2, blockId: 2, block: reading },
  pricedPatch: {
    event: 'patch',
    seq: 3,
    blockId: 2,
    ops: [
      { op: 'replace', path: '/state', value: 'priced' },
      { op: 'replace', path: '/observationId', value: 9081 },
      { op: 'replace', path: '/price', value: cad(39999) },
    ],
  },
};
const end = (seq: number, status: string) => ({
  event: 'end',
  seq,
  status,
  coverage: coverage.coverage,
});

describe('StreamEvent and the patch subset', () => {
  it('accepts block, patch and end events', () => {
    for (const e of [ev.plan, ev.read, ev.pricedPatch, end(4, 'completed')])
      expectValid(StreamEvent, e);
  });

  it('allows only add and replace, never on the block type', () => {
    const patch = (op: object) => ({ ...ev.pricedPatch, ops: [op] });
    for (const op of ['remove', 'move', 'copy', 'test']) {
      expectRefused(StreamEvent, patch({ op, path: '/state', from: '/x', value: 1 }), 'ops.0.op');
    }
    expectRefused(
      StreamEvent,
      patch({ op: 'replace', path: '/type', value: 'summary' }),
      'ops.0.path',
    );
    expectRefused(
      StreamEvent,
      patch({ op: 'replace', path: 'state', value: 'priced' }),
      'ops.0.path',
    );
    expectRefused(StreamEvent, { ...ev.pricedPatch, ops: [] }, 'ops');
  });

  it('ends with a final status and the coverage record, cancellation included (S§6)', () => {
    expectValid(StreamEvent, end(9, 'cancelled'));
    expectRefused(StreamEvent, end(9, 'running'), 'status');
    expectRefused(StreamEvent, { event: 'end', seq: 9, status: 'completed' }, 'coverage');
    expectRefused(StreamEvent, { ...ev.plan, seq: 0 }, 'seq');
  });

  it('applies a patch and re-validates the block', () => {
    const patched = applyBlockPatch(reading, ev.pricedPatch.ops);
    expect(patched).toEqual({ ok: true, block: priced });
    // A patch that would leave a float price, or a price without its observation, is refused.
    const float = applyBlockPatch(reading, [
      ...ev.pricedPatch.ops.slice(0, 2),
      { op: 'replace', path: '/price', value: 399.99 },
    ]);
    expect(float.ok).toBe(false);
    expect(applyBlockPatch(reading, [{ op: 'replace', path: '/state', value: 'priced' }]).ok).toBe(
      false,
    );
    expect(applyBlockPatch(reading, [{ op: 'replace', path: '/nope', value: 1 }]).ok).toBe(false);
    const appended = applyBlockPatch(summary, [
      { op: 'add', path: '/segments/-', value: { kind: 'text', text: ' Done.' } },
    ]);
    expect(appended.ok && appended.block.type === 'summary' && appended.block.segments.length).toBe(
      8,
    );
  });

  it('folds a cancelled stream into its partial evidence', () => {
    const result = foldStream([ev.plan, ev.read, ev.pricedPatch, end(4, 'cancelled')]);
    expect(result).toEqual({
      ok: true,
      blocks: [plan, priced],
      end: end(4, 'cancelled'),
    });
  });

  it('refuses gaps, unknown blocks, reused ids and events after the end', () => {
    expect(foldStream([ev.plan, { ...ev.read, seq: 3 }]).ok).toBe(false);
    expect(foldStream([ev.plan, { ...ev.pricedPatch, seq: 2 }]).ok).toBe(false);
    expect(foldStream([ev.plan, { ...ev.read, blockId: 1 }]).ok).toBe(false);
    expect(foldStream([ev.plan, end(2, 'completed'), { ...ev.read, seq: 3 }]).ok).toBe(false);
    // Resuming after seq 1 (the reconnect route) folds the rest onto what the client holds.
    const resumed = foldStream([ev.read, ev.pricedPatch], {
      afterSeq: 1,
      blocks: [{ blockId: 1, block: plan }],
    });
    expect(resumed.ok && resumed.blocks).toEqual([plan, priced]);
  });
});
