// The PacingStore on the real `host_pacing` table, in a temporary SQLite file.
import { schema } from '@agentic-dasher/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseTarget } from '../../src/guard/index.ts';
import {
  type Admission,
  createPacer,
  hostKey,
  sqlitePacingStore,
  toStoredInstant,
} from '../../src/pacing/index.ts';
import { type TempDatabase, tempDatabase } from '../db.ts';
import { FakeClock } from './clock.ts';

const T0 = Date.UTC(2026, 10, 25, 9, 0, 0);

let temp: TempDatabase;
beforeEach(() => {
  temp = tempDatabase();
});
afterEach(() => {
  temp.dispose();
});

function keyOf(url: string): string {
  const parsed = parseTarget(url);
  if (!parsed.ok) throw new Error(`not a target: ${url}`);
  return hostKey(parsed.target);
}

describe('sqlitePacingStore', () => {
  it('writes UTC instants with three fractional digits and reads them back', () => {
    const db = temp.open();
    const store = sqlitePacingStore(db);
    expect(store.read('shop.test')).toBeNull();
    store.write('shop.test', T0 + 2_687.2);
    expect(store.read('shop.test')).toBe(T0 + 2_688);
    store.write('shop.test', T0 + 1_000);
    expect(store.read('shop.test')).toBe(T0 + 1_000);
    expect(db.orm.select().from(schema.hostPacing).all()).toEqual([
      { host: 'shop.test', nextStartAt: '2026-11-25T09:00:01.000Z' },
    ]);
  });

  it('keys hosts lower case and punycode, as the guard parses them', () => {
    const db = temp.open();
    const store = sqlitePacingStore(db);
    const host = keyOf('https://BÜCHER.example./p?x=1');
    expect(host).toBe('xn--bcher-kva.example');
    store.write(host, T0);
    expect(keyOf('http://bücher.example:8080/')).toBe(host);
    expect(store.read(host)).toBe(T0);
    expect(keyOf('https://[2001:DB8::1]/')).toBe('2001:db8::1');
  });

  it('refuses a host the table would refuse, before the database does', () => {
    const store = sqlitePacingStore(temp.open());
    expect(() => store.write('Shop.test', T0)).toThrow(RangeError);
    expect(() => store.write('', T0)).toThrow(RangeError);
    expect(() => store.write('bücher.example', T0)).toThrow(RangeError);
    expect(() => store.write('shop.test', Number.NaN)).toThrow(RangeError);
    expect(() => toStoredInstant(Date.UTC(10_000, 0, 1))).toThrow(RangeError);
  });

  it('makes the first request after a restart wait until the stored next start', async () => {
    const clock = new FakeClock(T0);
    const request = () => ({ deadline: T0 + 60_000, signal: new AbortController().signal });
    const before = temp.open();
    const first = createPacer({
      store: sqlitePacingStore(before),
      now: clock.now,
      sleep: clock.sleep,
      random: () => 0.5,
    });
    const admission = await first.acquire('shop.test', request());
    if (admission.kind !== 'granted') throw new Error('expected a slot');
    admission.slot.started();
    admission.slot.release();
    before.close();

    // The process restarts: a new database handle on the same file, a new pacer.
    const second = createPacer({
      store: sqlitePacingStore(temp.open()),
      now: clock.now,
      sleep: clock.sleep,
      random: () => 0.5,
    });
    let granted: Admission | undefined;
    void second.acquire('shop.test', request()).then((a) => {
      granted = a;
    });
    await clock.advance(2_687);
    expect(granted).toBeUndefined();
    await clock.advance(1);
    expect(granted?.kind).toBe('granted');
  });
});
