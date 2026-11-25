// The delivery-gating read model (S§2.11; owner's ruling of 2026-11-23, orchestrator's settlement
// of 2026-11-24): what counts as the watch's last accepted alert, in each case.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  alertEventKey,
  type ChannelService,
  createChannelService,
  deliveryStatus,
  gatingDeliveries,
  lastAcceptedAlert,
  recordEvent,
  runOutboxPass,
} from '../../src/notify/index.ts';
import type { SecretBox } from '../../src/secrets/index.ts';
import {
  FakeClock,
  FakeServer,
  PROFILE,
  seedAlertRecords,
  TempDb,
  testSecrets,
} from './harness.ts';

let tmp: TempDb;
let clock: FakeClock;
let secrets: SecretBox;
let channels: ChannelService;
let alert: ReturnType<typeof seedAlertRecords>;
let servers: FakeServer[];

beforeEach(() => {
  tmp = new TempDb();
  clock = new FakeClock();
  secrets = testSecrets();
  servers = [];
  alert = seedAlertRecords(tmp.db, { observations: 2 });
  channels = createChannelService({ db: tmp.db, secrets, now: clock.now });
});

afterEach(async () => {
  await Promise.all(servers.map((s) => s.stop()));
  tmp.dispose();
});

async function ntfyAt(script: ConstructorParameters<typeof FakeServer>[0] = []) {
  const s = await new FakeServer(script).start();
  servers.push(s);
  return channels.create(PROFILE, {
    type: 'ntfy',
    name: 'Phone',
    config: { serverUrl: s.url, topic: 'alerts' },
  });
}

function record(i = 0, kind: 'price_drop' | 'restock' = 'price_drop') {
  const observationId = alert.observationIds[i] ?? 0;
  return recordEvent(tmp.db, {
    profileId: PROFILE,
    now: clock.now,
    event: {
      kind,
      key: alertEventKey({ kind, watchId: alert.watchId, observationId }),
      watchId: alert.watchId,
      listingId: alert.listingId,
      observationId,
    },
  }).event;
}

const pass = () => runOutboxPass({ db: tmp.db, secrets, now: clock.now, sleep: clock.sleep });
const last = (kind: 'price_drop' | 'restock' = 'price_drop') =>
  lastAcceptedAlert(tmp.db, { profileId: PROFILE, watchId: alert.watchId, kind });
const status = (eventId: number) => deliveryStatus(gatingDeliveries(tmp.db, eventId));
const at = (ms: number) => new Date(ms).toISOString();

describe('lastAcceptedAlert', () => {
  it('is null before anything was accepted', () => {
    const e = record();
    expect(last()).toBeNull();
    expect(status(e.id)).toBe('awaiting_delivery');
  });

  it('in-app only install: the in-app acceptance is the delivery', async () => {
    const e = record();
    await pass();
    expect(last()).toEqual({
      eventId: e.id,
      acceptedAt: at(clock.ms),
      observationId: alert.observationIds[0],
      price: { amountMinor: 39999, currency: 'CAD' },
    });
    expect(status(e.id)).toBe('accepted');
  });

  it('push configured and accepted: the push acceptance counts, not the earlier in-app one', async () => {
    await ntfyAt([{ status: 503 }]);
    const e = record();
    const start = clock.ms;
    await pass(); // in-app accepted at start; ntfy after a 2 s wait
    expect(last()).toMatchObject({ eventId: e.id, acceptedAt: at(start + 2000) });
    expect(status(e.id)).toBe('accepted');
  });

  it('push configured and failing: in-app acceptance alone does not count while push is retried', async () => {
    await ntfyAt([{ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }]);
    const e = record();
    await pass();
    expect(last()).toBeNull();
    expect(status(e.id)).toBe('awaiting_delivery');
  });

  it('push failed for good: still not delivered; the in-app acceptance does not stand in', async () => {
    await ntfyAt([{ status: 401 }]);
    const e = record();
    await pass();
    expect(last()).toBeNull();
    expect(status(e.id)).toBe('undelivered');
  });

  it('push channel removed while its delivery was pending: the in-app acceptance counts', async () => {
    const phone = await ntfyAt([
      { status: 503 },
      { status: 503 },
      { status: 503 },
      { status: 503 },
    ]);
    const e = record();
    await pass();
    const inAppAcceptedAt = at(clock.ms - 22_000);
    expect(last()).toBeNull();
    channels.remove(PROFILE, phone.id);
    expect(last()).toEqual(expect.objectContaining({ eventId: e.id, acceptedAt: inAppAcceptedAt }));
    expect(status(e.id)).toBe('accepted');
    expect(gatingDeliveries(tmp.db, e.id).map((d) => d.channelType)).toEqual(['in_app']);
  });

  it('push channel disabled: the same, and switching it on again does not revive the old delivery', async () => {
    const phone = await ntfyAt([
      { status: 503 },
      { status: 503 },
      { status: 503 },
      { status: 503 },
    ]);
    const e = record();
    await pass();
    channels.setEnabled(PROFILE, phone.id, false);
    const before = last();
    expect(before?.eventId).toBe(e.id);
    channels.setEnabled(PROFILE, phone.id, true);
    expect(last()).toEqual(before);
    expect(status(e.id)).toBe('accepted');
  });

  it('a push channel removed after it accepted keeps counting', async () => {
    const phone = await ntfyAt();
    const e = record();
    await pass();
    const accepted = last();
    expect(accepted?.eventId).toBe(e.id);
    channels.remove(PROFILE, phone.id);
    expect(last()).toEqual(accepted);
  });

  it('takes the latest delivered event of the watch and kind only', async () => {
    record(0);
    await pass();
    clock.advance(60_000);
    const second = record(1);
    await pass();
    clock.advance(60_000);
    record(0, 'restock');
    expect(last()).toMatchObject({
      eventId: second.id,
      price: { amountMinor: 38999, currency: 'CAD' },
    });
    expect(last('restock')).toBeNull();
    await pass();
    expect(last('restock')).toMatchObject({ acceptedAt: at(clock.ms) });
  });

  it('is scoped to the profile and the watch', async () => {
    record();
    await pass();
    expect(
      lastAcceptedAlert(tmp.db, { profileId: 2, watchId: alert.watchId, kind: 'price_drop' }),
    ).toBeNull();
    expect(
      lastAcceptedAlert(tmp.db, {
        profileId: PROFILE,
        watchId: alert.watchId + 1,
        kind: 'price_drop',
      }),
    ).toBeNull();
  });
});
