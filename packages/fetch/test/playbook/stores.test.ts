// Both PlaybookStores against one contract; the SQLite one on the real `host_access` table.
import { schema } from '@agentic-dasher/db';
import { afterEach, describe, expect, it } from 'vitest';
import {
  memoryPlaybookStore,
  type PlaybookEntry,
  type PlaybookStore,
  recordOutcome,
  sqlitePlaybookStore,
} from '../../src/playbook/index.ts';
import { type TempDatabase, tempDatabase } from '../db.ts';

const T0 = Date.UTC(2026, 10, 25, 9, 0, 0);

const walled: PlaybookEntry = {
  host: 'shop.test',
  pageKind: 'product',
  rung: 'http',
  lastOutcome: 'wall',
  wallVendor: 'datadome',
  expiresAt: null,
  backoffUntil: T0 + 300_000,
  attempts: 1,
};

const temps: TempDatabase[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) t.dispose();
});

function sqlite(): PlaybookStore {
  const temp = tempDatabase();
  temps.push(temp);
  return sqlitePlaybookStore(temp.open());
}

describe.each([
  ['memory', () => memoryPlaybookStore()],
  ['sqlite', sqlite],
])('%s playbook store', (_name, make) => {
  it('reads back what it wrote, per host and page kind', () => {
    const store = make();
    expect(store.read('shop.test', 'product')).toBeNull();
    store.write(walled);
    expect(store.read('shop.test', 'product')).toEqual(walled);
    expect(store.read('shop.test', 'search')).toBeNull();
    expect(store.read('other.test', 'product')).toBeNull();
  });

  it('replaces the entry of the same host and page kind', () => {
    const store = make();
    store.write(walled);
    const hint = recordOutcome(walled, walled, { kind: 'ok', rung: 'http' }, T0 + 1);
    if (hint === null) throw new Error('expected an entry');
    store.write(hint);
    expect(store.read('shop.test', 'product')).toEqual(hint);
    store.write({
      ...walled,
      pageKind: 'api',
      rung: 'api',
      lastOutcome: 'empty',
      wallVendor: null,
    });
    expect(store.read('shop.test', 'product')).toEqual(hint);
    expect(store.read('shop.test', 'api')?.lastOutcome).toBe('empty');
  });

  it('refuses an entry the table would refuse', () => {
    const store = make();
    expect(() => store.write({ ...walled, host: 'Shop.test' })).toThrow(RangeError);
    expect(() => store.write({ ...walled, attempts: -1 })).toThrow(RangeError);
    expect(() => store.write({ ...walled, backoffUntil: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    );
  });
});

describe('sqlitePlaybookStore', () => {
  it('stores UTC instants with three fractional digits', () => {
    const temp = tempDatabase();
    temps.push(temp);
    const db = temp.open();
    const store = sqlitePlaybookStore(db);
    store.write(walled);
    const hint = recordOutcome(walled, walled, { kind: 'ok', rung: 'http' }, T0 + 0.4);
    if (hint === null) throw new Error('expected an entry');
    store.write({ ...hint, pageKind: 'search' });
    const rows = db.orm.select().from(schema.hostAccess).all();
    expect(rows.map((r) => [r.pageKind, r.expiresAt, r.backoffUntil, r.attempts])).toEqual([
      ['product', null, '2026-11-25T09:05:00.000Z', 1],
      ['search', '2026-11-26T09:00:00.001Z', null, 0],
    ]);
  });
});
