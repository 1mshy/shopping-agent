// The outbox (S§5.11, S§2.11, S§2.12) on a real SQLite file, with local fake ntfy and webhook
// servers: recording events, the pass, retries, and the scripted exit gates this unit owns.
import { schema } from '@agentic-dasher/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  alertEventKey,
  type ChannelService,
  createChannelService,
  InvalidEventError,
  type OutboxPassOptions,
  outboxJob,
  PARKED_AT,
  recordEvent,
  runOutboxPass,
} from '../../src/notify/index.ts';
import type { SecretBox } from '../../src/secrets/index.ts';
import {
  deliveriesOf,
  deliveryById,
  eventsOf,
  FakeClock,
  FakeServer,
  PROFILE,
  refusedUrl,
  seedAlertRecords,
  TempDb,
  testSecrets,
} from './harness.ts';

const TOKEN = 'tk_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c';

let tmp: TempDb;
let clock: FakeClock;
let secrets: SecretBox;
let channels: ChannelService;
let servers: FakeServer[];
let alert: ReturnType<typeof seedAlertRecords>;

beforeEach(() => {
  tmp = new TempDb();
  clock = new FakeClock();
  secrets = testSecrets();
  servers = [];
  alert = seedAlertRecords(tmp.db, { observations: 3 });
  channels = createChannelService({ db: tmp.db, secrets, now: clock.now });
});

afterEach(async () => {
  await Promise.all(servers.map((s) => s.stop()));
  tmp.dispose();
});

async function server(script: ConstructorParameters<typeof FakeServer>[0] = []) {
  const s = await new FakeServer(script).start();
  servers.push(s);
  return s;
}

function ntfy(url: string, secret?: string) {
  return channels.create(PROFILE, {
    type: 'ntfy',
    name: 'Phone',
    config: { serverUrl: url, topic: 'dasher-alerts' },
    ...(secret === undefined ? {} : { secret }),
  });
}

function webhook(url: string, secret?: string) {
  return channels.create(PROFILE, {
    type: 'webhook',
    name: 'Home Assistant',
    config: { url },
    ...(secret === undefined ? {} : { secret }),
  });
}

function priceDrop(i = 0) {
  const observationId = alert.observationIds[i] ?? 0;
  return recordEvent(tmp.db, {
    profileId: PROFILE,
    now: clock.now,
    event: {
      kind: 'price_drop',
      key: alertEventKey({ kind: 'price_drop', watchId: alert.watchId, observationId }),
      watchId: alert.watchId,
      listingId: alert.listingId,
      observationId,
    },
  });
}

function pass(extra: Partial<OutboxPassOptions> = {}) {
  return runOutboxPass({ db: tmp.db, secrets, now: clock.now, sleep: clock.sleep, ...extra });
}

function channelTypeOf(channelId: number) {
  return tmp.db.orm.select().from(schema.channel).where(eq(schema.channel.id, channelId)).get()
    ?.type;
}

describe('recordEvent', () => {
  it('writes the event and one pending delivery per enabled channel, the in-app one created', async () => {
    const s = await server();
    const phone = ntfy(s.url);
    const off = webhook(s.url);
    channels.setEnabled(PROFILE, off.id, false);
    const gone = webhook(s.url);
    channels.remove(PROFILE, gone.id);

    const recorded = priceDrop();
    expect(recorded.created).toBe(true);
    expect(recorded.event).toMatchObject({ kind: 'price_drop', watchId: alert.watchId });
    const ds = deliveriesOf(tmp.db);
    expect(ds.map((d) => channelTypeOf(d.channelId))).toEqual(['in_app', 'ntfy']);
    expect(ds.map((d) => d.channelId)).toContain(phone.id);
    for (const d of ds) {
      expect(d).toMatchObject({ state: 'pending', attempts: 0, outcome: null, acceptedAt: null });
      expect(d.nextAttemptAt).toBe(new Date(clock.ms).toISOString());
    }
  });

  it('is a no-op for a key already recorded: the existing event comes back, nothing is added', async () => {
    const s = await server();
    const first = priceDrop();
    ntfy(s.url); // a channel added since does not get a delivery of the old event
    const again = priceDrop();
    expect(again.created).toBe(false);
    expect(again.event).toEqual(first.event);
    expect(eventsOf(tmp.db)).toHaveLength(1);
    expect(deliveriesOf(tmp.db)).toHaveLength(1);
  });

  it('refuses an event that breaks the shared contract, writing nothing', () => {
    expect(() =>
      recordEvent(tmp.db, {
        profileId: PROFILE,
        now: clock.now,
        // A price alert must name its watch, listing and observation.
        event: { kind: 'price_drop', key: 'k' } as never,
      }),
    ).toThrow(InvalidEventError);
    expect(eventsOf(tmp.db)).toHaveLength(0);
    expect(deliveriesOf(tmp.db)).toHaveLength(0);
  });

  it('records a system notice, delivered in-app', async () => {
    const r = recordEvent(tmp.db, {
      profileId: PROFILE,
      now: clock.now,
      event: { kind: 'system', key: 'system:backup:2026-11-17', text: 'Backup finished.' },
    });
    expect(r.created).toBe(true);
    const result = await pass();
    expect(result.accepted).toBe(1);
  });
});

describe('the outbox pass', () => {
  it('accepts the in-app delivery at once: the delivery row is the acceptance', async () => {
    priceDrop();
    const result = await pass();
    expect(result).toMatchObject({ claimed: 1, accepted: 1, failed: 0, retry: 0 });
    expect(deliveriesOf(tmp.db)[0]).toMatchObject({
      state: 'accepted',
      outcome: 'accepted',
      attempts: 1,
      nextAttemptAt: null,
      acceptedAt: new Date(clock.ms).toISOString(),
    });
  });

  it('GATE: a channel answering 503 then 200 gets exactly one accepted message', async () => {
    const s = await server([{ status: 503 }]);
    const phone = ntfy(s.url, TOKEN);
    priceDrop();
    const result = await pass();
    const d = deliveriesOf(tmp.db).find((x) => x.channelId === phone.id);
    expect(d).toMatchObject({ state: 'accepted', outcome: 'accepted', attempts: 2 });
    expect(clock.waits).toEqual([2000]);
    expect(s.received.map((r) => r.status)).toEqual([503, 200]);
    expect(s.accepted()).toHaveLength(1);
    expect(result.accepted).toBe(2); // in-app and ntfy
    // A second pass sends nothing more.
    await pass();
    expect(s.received).toHaveLength(2);
    expect(s.accepted()).toHaveLength(1);
  });

  it('GATE: 429 with Retry-After then 200 waits as asked and gets exactly one accepted message', async () => {
    const s = await server([{ status: 429, headers: { 'retry-after': '7' } }]);
    const hook = webhook(s.url);
    priceDrop();
    await pass();
    expect(clock.waits).toEqual([7000]);
    expect(s.received.map((r) => r.status)).toEqual([429, 200]);
    expect(s.accepted()).toHaveLength(1);
    expect(deliveriesOf(tmp.db).find((x) => x.channelId === hook.id)).toMatchObject({
      state: 'accepted',
      attempts: 2,
    });
  });

  it('GATE: an auth error fails at once and is never retried', async () => {
    const s = await server([{ status: 401, headers: { 'retry-after': '5' } }]);
    const phone = ntfy(s.url, TOKEN);
    priceDrop();
    const result = await pass();
    expect(s.received).toHaveLength(1);
    expect(clock.waits).toEqual([]);
    expect(deliveriesOf(tmp.db).find((x) => x.channelId === phone.id)).toMatchObject({
      state: 'failed',
      outcome: 'failed',
      attempts: 1,
      nextAttemptAt: null,
      acceptedAt: null,
    });
    expect(result.deliveries.find((x) => x.channelId === phone.id)).toMatchObject({
      result: 'failed',
      errorClass: 'auth',
    });
    clock.advance(3_600_000);
    await pass();
    expect(s.received).toHaveLength(1);
  });

  it('defers a long Retry-After to a later pass, not before the deadline', async () => {
    const s = await server([{ status: 429, headers: { 'retry-after': '3600' } }]);
    const phone = ntfy(s.url);
    priceDrop();
    const start = clock.ms;
    await pass();
    const d = () => deliveriesOf(tmp.db).find((x) => x.channelId === phone.id);
    expect(d()).toMatchObject({
      state: 'pending',
      outcome: 'retry',
      attempts: 1,
      nextAttemptAt: new Date(start + 3_600_000).toISOString(),
    });
    clock.ms = start + 3_599_000;
    await pass();
    expect(s.received).toHaveLength(1);
    clock.ms = start + 3_600_000;
    await pass();
    expect(s.received).toHaveLength(2);
    expect(d()).toMatchObject({ state: 'accepted', attempts: 2 });
  });

  it('keeps a delivery pending after four transport failures, releasing the rest of that channel', async () => {
    const url = await refusedUrl();
    const phone = ntfy(url);
    priceDrop(0);
    priceDrop(1);
    const result = await pass();
    expect(clock.waits).toEqual([2000, 5000, 15000]);
    const phoneDeliveries = deliveriesOf(tmp.db).filter((x) => x.channelId === phone.id);
    expect(phoneDeliveries[0]).toMatchObject({ state: 'pending', outcome: 'retry', attempts: 4 });
    expect(result.deliveries.find((x) => x.deliveryId === phoneDeliveries[0]?.id)).toMatchObject({
      result: 'retry',
      errorClass: 'transport',
    });
    // The second was not attempted: the channel is down, it waits for the next pass untouched.
    expect(phoneDeliveries[1]).toMatchObject({ state: 'pending', outcome: null, attempts: 0 });
    expect(result.released).toBe(1);
    // Both in-app deliveries were accepted meanwhile.
    expect(result.accepted).toBe(2);
  });

  it("does not let one channel's failures block another or fail the pass", async () => {
    const down = await server([{ status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }]);
    const up = await server();
    ntfy(down.url);
    const hook = webhook(up.url);
    // A channel whose secret no longer decrypts (the key changed): unavailable, not an error.
    const broken = webhook(up.url, 'whsec_abcdef');
    tmp.db.orm
      .update(schema.channel)
      .set({ secretEnc: testSecrets().encrypt('x') })
      .where(eq(schema.channel.id, broken.id))
      .run();
    priceDrop();
    const result = await pass();
    expect(result.deliveries.find((x) => x.channelId === hook.id)?.result).toBe('accepted');
    expect(result.deliveries.find((x) => x.channelId === broken.id)).toMatchObject({
      result: 'unavailable',
    });
    expect(result).toMatchObject({ accepted: 2, retry: 1, unavailable: 1, errors: 0 });
    expect(up.accepted()).toHaveLength(1);
    // The unavailable delivery is still pending, for a later pass.
    expect(deliveriesOf(tmp.db).find((x) => x.channelId === broken.id)).toMatchObject({
      state: 'pending',
      attempts: 0,
    });
  });

  it('GATE: no duplicate when the same key is recorded twice and the pass runs twice', async () => {
    const s = await server();
    ntfy(s.url);
    priceDrop();
    priceDrop();
    await pass();
    await pass();
    priceDrop();
    await pass();
    expect(eventsOf(tmp.db)).toHaveLength(1);
    const ds = deliveriesOf(tmp.db);
    expect(ds).toHaveLength(2);
    expect(ds.every((d) => d.state === 'accepted' && d.attempts === 1)).toBe(true);
    expect(s.received).toHaveLength(1);
  });

  it('GATE: two concurrent passes on one database send each delivery once', async () => {
    const s = await server();
    ntfy(s.url);
    for (let i = 0; i < 3; i++) priceDrop(i);
    const other = tmp.another();
    try {
      const [a, b, c] = await Promise.all([
        pass(),
        pass(),
        runOutboxPass({ db: other, secrets, now: clock.now, sleep: clock.sleep }),
      ]);
      expect((a?.claimed ?? 0) + (b?.claimed ?? 0) + (c?.claimed ?? 0)).toBe(6);
    } finally {
      other.close();
    }
    expect(s.received).toHaveLength(3);
    expect(new Set(s.received.map((r) => JSON.parse(r.body).message)).size).toBe(3);
    expect(deliveriesOf(tmp.db).every((d) => d.state === 'accepted' && d.attempts === 1)).toBe(
      true,
    );
  });

  it('GATE: pending deliveries survive a restart and the next pass delivers once', async () => {
    const s = await server([{ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }]);
    const phone = ntfy(s.url);
    priceDrop();
    await pass();
    expect(deliveriesOf(tmp.db).find((x) => x.channelId === phone.id)?.state).toBe('pending');
    const db = tmp.restart();
    channels = createChannelService({ db, secrets, now: clock.now });
    clock.advance(60_000);
    await pass();
    expect(deliveriesOf(db).find((x) => x.channelId === phone.id)).toMatchObject({
      state: 'accepted',
      attempts: 5,
    });
    expect(s.accepted()).toHaveLength(1);
  });

  it('GATE: a crash between an accepted send and its UPDATE sends again: at least once', async () => {
    let crash = () => {};
    const s = await server([{ status: 200, before: () => crash() }]);
    const phone = ntfy(s.url);
    priceDrop();
    const errors: string[] = [];
    // The process "dies" while the channel accepts: the database is gone before the UPDATE.
    crash = () => tmp.db.close();
    const result = await pass({ onError: (_e, where) => errors.push(where) });
    expect(result.errors).toBeGreaterThan(0);
    expect(s.accepted()).toHaveLength(1);

    const db = tmp.restart();
    const d = () => deliveriesOf(db).find((x) => x.channelId === phone.id);
    // Never accepted without a recorded acceptance: still pending, under the dead pass's lease.
    expect(d()).toMatchObject({ state: 'pending', attempts: 0, acceptedAt: null });
    await pass();
    expect(s.received).toHaveLength(1); // the lease still holds
    clock.advance(10 * 60_000);
    await pass();
    expect(d()).toMatchObject({ state: 'accepted', attempts: 1 });
    // The channel accepted the same message twice: at least once, not exactly once.
    expect(s.accepted()).toHaveLength(2);
    expect(s.accepted()[0]?.body).toBe(s.accepted()[1]?.body);
  });

  it('leaves everything pending when stopped before it starts', async () => {
    const s = await server();
    ntfy(s.url);
    priceDrop();
    const controller = new AbortController();
    controller.abort();
    const result = await pass({ signal: controller.signal });
    expect(result.released).toBe(2);
    expect(s.received).toHaveLength(0);
    expect(deliveriesOf(tmp.db).every((d) => d.state === 'pending' && d.attempts === 0)).toBe(true);
    await pass();
    expect(deliveriesOf(tmp.db).every((d) => d.state === 'accepted')).toBe(true);
  });

  it('never sends a delivery whose channel was disabled or removed while it was pending', async () => {
    const s = await server([{ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }]);
    const phone = ntfy(s.url);
    priceDrop();
    await pass();
    expect(s.received).toHaveLength(4);
    channels.setEnabled(PROFILE, phone.id, false);
    const parked = deliveriesOf(tmp.db).find((x) => x.channelId === phone.id);
    expect(parked).toMatchObject({ state: 'pending', attempts: 4, nextAttemptAt: PARKED_AT });
    channels.setEnabled(PROFILE, phone.id, true);
    clock.advance(86_400_000);
    await pass();
    expect(s.received).toHaveLength(4);
    // A new event after re-enabling is delivered.
    priceDrop(1);
    await pass();
    expect(s.accepted()).toHaveLength(1);
    expect(deliveryById(tmp.db, parked?.id ?? 0)?.nextAttemptAt).toBe(PARKED_AT);
  });
});

describe('what a message says', () => {
  it('ntfy: JSON publish with the topic, a title, the price from the observation, the link and the token', async () => {
    const s = await server();
    ntfy(s.url, TOKEN);
    priceDrop(2);
    await pass();
    const [req] = s.received;
    expect(req?.method).toBe('POST');
    expect(req?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(req?.body ?? '')).toEqual({
      topic: 'dasher-alerts',
      title: 'Price drop: Sony WH-1000XM5 Wireless Noise Cancelling Headphones, Black',
      message: [
        'Now 379.99 CAD at shop.example.ca',
        'Sticker price 449.99 CAD',
        'https://shop.example.ca/products/wh-1000xm5',
      ].join('\n'),
      priority: 4,
      click: 'https://shop.example.ca/products/wh-1000xm5',
    });
  });

  it('webhook: the versioned body, with amounts in minor units, labels and an idempotency key', async () => {
    const s = await server();
    const hook = webhook(s.url, 'whsec_0123456789');
    const recorded = priceDrop();
    await pass({ labelsFor: () => ['unconfirmed'] });
    const [req] = s.received;
    expect(req?.headers['x-agentic-dasher-secret']).toBe('whsec_0123456789');
    expect(req?.headers['idempotency-key']).toBe(`${recorded.event.key}:${hook.id}`);
    const body = JSON.parse(req?.body ?? '');
    expect(body).toEqual({
      schema: 'agentic-dasher.notification',
      version: 1,
      test: false,
      event: {
        key: recorded.event.key,
        kind: 'price_drop',
        createdAt: recorded.event.createdAt,
      },
      title: 'Price drop: Sony WH-1000XM5 Wireless Noise Cancelling Headphones, Black',
      text: [
        'Now 399.99 CAD at shop.example.ca',
        'Sticker price 449.99 CAD',
        'Unconfirmed: this listing may not be the exact product you watch.',
        'https://shop.example.ca/products/wh-1000xm5',
      ].join('\n'),
      url: 'https://shop.example.ca/products/wh-1000xm5',
      alert: {
        watchId: alert.watchId,
        listingId: alert.listingId,
        observationId: alert.observationIds[0],
        listingTitle: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones, Black',
        storeHost: 'shop.example.ca',
        price: { amountMinor: 39999, currency: 'CAD' },
        sticker: { amountMinor: 44999, currency: 'CAD' },
        labels: ['unconfirmed'],
      },
    });
  });

  it('adds the caution label from the store record on its own', async () => {
    tmp.db.orm.update(schema.store).set({ trustTier: 'caution' }).run();
    const s = await server();
    webhook(s.url);
    priceDrop();
    await pass();
    const body = JSON.parse(s.received[0]?.body ?? '');
    expect(body.alert.labels).toEqual(['caution']);
    expect(body.text).toContain('Caution: shop.example.ca has a low trust rating.');
  });
});

describe('the outbox job', () => {
  it('runs a pass with the run’s signal, reports partial counts and returns a detail object', async () => {
    const s = await server([{ status: 400 }]);
    ntfy(s.url);
    priceDrop();
    const job = outboxJob({ db: tmp.db, secrets, now: clock.now, sleep: clock.sleep });
    expect(job).toMatchObject({ name: 'notify-outbox', networkGate: false, cron: '* * * * *' });
    const reports: Record<string, unknown>[] = [];
    const detail = await job.handler({
      signal: new AbortController().signal,
      runId: 1,
      reason: 'slot',
      coalescedSlots: 1,
      startedAt: new Date(clock.ms).toISOString(),
      report: (p) => reports.push(p),
    });
    expect(reports.at(-1)).toMatchObject({ claimed: 2, accepted: 1, failed: 1 });
    expect(detail).toMatchObject({
      claimed: 2,
      accepted: 1,
      failed: 1,
      problems: [{ result: 'failed', errorClass: 'payload', detail: 'HTTP 400' }],
    });
  });
});
