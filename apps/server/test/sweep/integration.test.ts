// The sweep with the real outbox (cooldown read back from accepted deliveries), the outlier rule
// across several listings, and one read end to end through the real reader ladder with a scripted
// fetcher serving a saved page.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Fetcher, FetcherResult } from '@agentic-dasher/fetch';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runOutboxPass } from '../../src/notify/index.ts';
import { createSecretBox } from '../../src/secrets/index.ts';
import { checkListing } from '../../src/sweep/index.ts';
import {
  Clock,
  depsOf,
  eventsOf,
  follow,
  insertListing,
  insertStore,
  insertWatch,
  listingRow,
  MIN,
  observationsOf,
  Script,
  type Scripted,
  storeRow,
  TempDb,
  watchRow,
} from './harness.ts';

let tmp: TempDb;
let clock: Clock;
let script: Script;

beforeEach(() => {
  tmp = new TempDb();
  clock = new Clock();
  script = new Script();
});
afterEach(() => tmp.dispose());

async function readOnce(listingId: number, url: string, step: Scripted) {
  clock.advance(30 * MIN);
  script.push(url, step);
  return checkListing(depsOf(tmp, clock, script.read), listingId, { force: true });
}

describe('the cooldown, read back from the outbox', () => {
  it('is honoured only once a delivery was accepted, and a further drop passes it', async () => {
    const storeId = insertStore(tmp.db);
    const listingId = insertListing(tmp.db, clock, { storeId });
    const watchId = insertWatch(tmp.db, clock);
    follow(tmp.db, watchId, listingId);
    const url = listingRow(tmp.db, listingId)?.urlCanonical as string;
    for (let i = 0; i < 8; i++) await readOnce(listingId, url, { price: 10_000 });
    await readOnce(listingId, url, { price: 9_500 });
    await readOnce(listingId, url, { price: 9_500 });
    expect(eventsOf(tmp.db)).toHaveLength(1);

    // Not yet accepted: a repeat is held only because the first is still on its way.
    let r = await readOnce(listingId, url, { price: 9_500 });
    expect(r.outcome.kind === 'read' && r.outcome.evaluations[0]?.price?.silence).toBe(
      'awaiting_delivery',
    );

    // The real outbox pass, in-app channel only: the in-app acceptance is the delivery.
    const pass = await runOutboxPass({
      db: tmp.db,
      secrets: createSecretBox(randomBytes(32)),
      now: clock.now,
      sleep: async () => {},
    });
    expect(pass.accepted).toBe(1);
    r = await readOnce(listingId, url, { price: 9_500 });
    expect(r.outcome.kind === 'read' && r.outcome.evaluations[0]?.price?.silence).toBe('cooldown');
    expect(eventsOf(tmp.db)).toHaveLength(1);

    // A further drop bypasses the cooldown.
    r = await readOnce(listingId, url, { price: 9_000 });
    expect(r.outcome.kind === 'read' && r.outcome.evaluations[0]?.price).toMatchObject({
      fired: true,
      created: true,
    });
    expect(eventsOf(tmp.db)).toHaveLength(2);
    expect(watchRow(tmp.db, watchId)?.referencePrice).toBe(10_000);
  });
});

describe('the outlier rule', () => {
  it('with four exact listings, a price under 60% of the others needs a second read within 1%', async () => {
    const watchId = insertWatch(tmp.db, clock, {
      rules: { dropBasisPoints: null, targetPrice: { amountMinor: 6_000, currency: 'CAD' } },
    });
    const ls = [];
    for (let i = 0; i < 4; i++) {
      const id = insertListing(tmp.db, clock, { storeId: insertStore(tmp.db) });
      follow(tmp.db, watchId, id);
      ls.push({ id, url: listingRow(tmp.db, id)?.urlCanonical as string });
    }
    for (const l of ls) await readOnce(l.id, l.url, { price: 10_000 });
    const odd = ls[3] as { id: number; url: string };
    const first = await readOnce(odd.id, odd.url, { price: 5_000 });
    expect(first.outcome.kind === 'read' && first.outcome.evaluations[0]?.price?.silence).toBe(
      'outlier_unconfirmed',
    );
    expect(eventsOf(tmp.db)).toHaveLength(0);
    const second = await readOnce(odd.id, odd.url, { price: 5_020 });
    expect(second.outcome.kind === 'read' && second.outcome.evaluations[0]?.price?.fired).toBe(
      true,
    );
    expect(eventsOf(tmp.db)).toHaveLength(1);
  });
});

describe('end to end through the real reader ladder', () => {
  it('reads a saved JSON-LD page served by a scripted fetcher and records the observation', async () => {
    const url = 'https://www.logitech.com/en-ca/shop/p/mx-master-3s-mac-bluetooth-mouse.910-006570';
    const html = readFileSync(
      new URL(
        '../../../../packages/sources/test/structured/fixtures/logitech-mx-master-3s-mac.html',
        import.meta.url,
      ),
      'utf8',
    );
    const requests: { url: string; rung: string; pageKind: string }[] = [];
    const fetcher: Fetcher = {
      get: async (request): Promise<FetcherResult> => {
        requests.push({ url: request.url, rung: request.rung, pageKind: request.pageKind });
        return {
          outcome: { kind: 'ok', rung: request.rung },
          response: {
            status: 200,
            finalUrl: request.url,
            headers: { 'content-type': 'text/html; charset=utf-8' },
            setCookies: [],
            contentType: 'text/html; charset=utf-8',
            body: new TextEncoder().encode(html),
            text: html,
          },
          robots: null,
          closedUntil: null,
        };
      },
    };
    const storeId = insertStore(tmp.db, { host: 'www.logitech.com', platform: 'unknown' });
    const listingId = insertListing(tmp.db, clock, { storeId, url });
    const watchId = insertWatch(tmp.db, clock);
    follow(tmp.db, watchId, listingId);
    const deps = { ...depsOf(tmp, clock, script.read), fetcher };
    const { readListing: _scripted, endpointReaders: _none, ...real } = deps;
    const result = await checkListing(real, listingId);
    expect(result.outcome.kind).toBe('read');
    expect(requests).toEqual([{ url, rung: 'http', pageKind: 'product' }]);
    const [obs] = observationsOf(tmp.db, listingId);
    expect(obs).toMatchObject({
      currency: 'CAD',
      sticker: 15_999,
      effective: 15_999,
      availability: 'in',
      readPath: 'json_ld',
      rung: 'http',
    });
    expect(obs?.rawCandidates.length).toBeGreaterThan(0);
    expect(listingRow(tmp.db, listingId)?.currency).toBe('CAD');
    expect(storeRow(tmp.db, storeId)?.readRoute).toBe('json_ld');
    expect(watchRow(tmp.db, watchId)).toMatchObject({ currency: 'CAD', referencePrice: 15_999 });
  });
});
