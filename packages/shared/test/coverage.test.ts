import { describe, it } from 'vitest';
import { CoverageRecord } from '../src/index.ts';
import { expectRefused, expectValid } from './check.ts';

const flags = { enabled: true, attempted: true, completed: true, walled: false, timedOut: false };
const counts = { foundUnverified: 0, verified: 0 };

// A fast search in Canada (S§5.6 step 2): the Catalog, two engines (Brave did not answer in time),
// three directory stores (one walled, one cut by the deadline), and a disabled marketplace.
const record = {
  sources: [
    { kind: 'catalog', ...flags, foundUnverified: 6, verified: 0 },
    { kind: 'web_search', engine: 'duckduckgo', ...flags, foundUnverified: 9, verified: 3 },
    { kind: 'web_search', engine: 'brave', ...flags, completed: false, timedOut: true, ...counts },
    {
      kind: 'store',
      host: 'www.bestbuy.ca',
      storeId: 4,
      ...flags,
      foundUnverified: 1,
      verified: 2,
    },
    {
      kind: 'store',
      host: 'shop.example.ca',
      storeId: null,
      ...flags,
      completed: true,
      walled: true,
      ...counts,
    },
    {
      kind: 'store',
      host: 'slow.example.ca',
      storeId: 9,
      ...flags,
      completed: false,
      timedOut: true,
      ...counts,
    },
    {
      kind: 'marketplace',
      adapterId: 'kijiji',
      ...flags,
      enabled: false,
      attempted: false,
      completed: false,
      ...counts,
    },
  ],
};
const store = record.sources[3];

describe('CoverageRecord (S§2.8)', () => {
  it('accepts a realistic record, including an unresponsive engine', () => {
    expectValid(CoverageRecord, record);
    expectValid(CoverageRecord, { sources: [] });
    // Enabled but never attempted (the deadline came first).
    expectValid(CoverageRecord, {
      sources: [{ ...store, attempted: false, completed: false, ...counts }],
    });
  });

  it('cannot attempt a disabled source, or complete, wall or time out an unattempted one', () => {
    const one = (o: object) => ({ sources: [{ ...store, ...o }] });
    expectRefused(CoverageRecord, one({ enabled: false }), 'sources.0.attempted');
    expectRefused(CoverageRecord, one({ attempted: false }), 'sources.0.completed');
    const idle = { attempted: false, completed: false, ...counts };
    expectRefused(CoverageRecord, one({ ...idle, walled: true }), 'sources.0.walled');
    expectRefused(CoverageRecord, one({ ...idle, timedOut: true }), 'sources.0.timedOut');
  });

  it('cannot count what was not attempted, nor be completed and timed out at once', () => {
    const one = (o: object) => ({ sources: [{ ...store, ...o }] });
    const idle = { attempted: false, completed: false };
    expectRefused(
      CoverageRecord,
      one({ ...idle, verified: 1, foundUnverified: 0 }),
      'sources.0.verified',
    );
    expectRefused(
      CoverageRecord,
      one({ ...idle, verified: 0, foundUnverified: 2 }),
      'sources.0.foundUnverified',
    );
    expectRefused(CoverageRecord, one({ timedOut: true }), 'sources.0.timedOut');
  });

  it('holds counts as non-negative integers and refuses model-shaped extras', () => {
    expectRefused(CoverageRecord, { sources: [{ ...store, verified: 1.5 }] }, 'sources.0.verified');
    expectRefused(CoverageRecord, { sources: [{ ...store, verified: -1 }] }, 'sources.0.verified');
    expectRefused(CoverageRecord, { sources: [{ ...store, note: 'mostly fine' }] }, 'sources.0');
    expectRefused(CoverageRecord, { sources: [{ ...store, kind: 'deal_feed' }] }, 'sources.0.kind');
  });

  it('lists each source once and identifies it properly', () => {
    expectRefused(CoverageRecord, { sources: [store, { ...store, storeId: 5 }] }, 'sources');
    const catalog = record.sources[0];
    expectRefused(CoverageRecord, { sources: [catalog, catalog] }, 'sources');
    expectRefused(
      CoverageRecord,
      { sources: [{ ...store, host: 'WWW.BestBuy.ca' }] },
      'sources.0.host',
    );
    expectRefused(
      CoverageRecord,
      { sources: [{ ...store, host: 'https://bestbuy.ca' }] },
      'sources.0.host',
    );
    const engine = record.sources[1];
    expectRefused(
      CoverageRecord,
      { sources: [{ ...engine, engine: 'Duck Duck Go' }] },
      'sources.0.engine',
    );
  });
});
