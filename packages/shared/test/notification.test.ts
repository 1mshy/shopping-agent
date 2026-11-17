import { describe, it } from 'vitest';
import { Delivery, NotificationEvent } from '../src/index.ts';
import { expectRefused, expectValid } from './check.ts';

const drop = {
  kind: 'price_drop',
  id: 501,
  profileId: 1,
  key: 'price_drop:watch-12:obs-9081',
  createdAt: '2026-11-17T10:00:00Z',
  watchId: 12,
  listingId: 33,
  observationId: 9081,
};

describe('NotificationEvent', () => {
  it('accepts each kind with the records it rests on', () => {
    expectValid(NotificationEvent, drop);
    expectValid(NotificationEvent, { ...drop, kind: 'restock', key: 'restock:watch-12:obs-9082' });
    const { observationId: _, ...newListing } = drop;
    expectValid(NotificationEvent, { ...newListing, kind: 'new_listing' });
    const base = { id: 502, profileId: 1, key: 'k-502', createdAt: '2026-11-17T10:00:00Z' };
    expectValid(NotificationEvent, { ...base, kind: 'recommendation', feedCardId: 4 });
    expectValid(NotificationEvent, {
      ...base,
      kind: 'agent',
      runId: 77,
      text: 'Your search is done.',
    });
    expectValid(NotificationEvent, {
      ...base,
      kind: 'system',
      text: 'The model endpoint is down.',
    });
  });

  it('refuses an alert without the observation that proves it, and unknown kinds', () => {
    const { observationId: _, ...noObservation } = drop;
    expectRefused(NotificationEvent, noObservation, 'observationId');
    expectRefused(NotificationEvent, { ...drop, kind: 'promo' }, 'kind');
    expectRefused(NotificationEvent, { ...drop, price: 199.99 }, '');
    const { profileId: __, ...noProfile } = drop;
    expectRefused(NotificationEvent, noProfile, 'profileId');
  });
});

const base = { id: 9, profileId: 1, eventId: 501, channelId: 3 };
const fresh = {
  ...base,
  state: 'pending',
  attempts: 0,
  outcome: null,
  nextAttemptAt: '2026-11-17T10:00:00Z',
  acceptedAt: null,
};
const retrying = { ...fresh, attempts: 2, outcome: 'retry', nextAttemptAt: '2026-11-17T10:00:20Z' };
const accepted = {
  ...base,
  state: 'accepted',
  attempts: 1,
  outcome: 'accepted',
  nextAttemptAt: null,
  acceptedAt: '2026-11-17T10:00:01Z',
};
const failed = {
  ...base,
  state: 'failed',
  attempts: 1,
  outcome: 'failed',
  nextAttemptAt: null,
  acceptedAt: null,
};

describe('Delivery (S§2.11, S§5.11)', () => {
  it('accepts each state', () => {
    for (const d of [fresh, retrying, accepted, failed]) expectValid(Delivery, d);
  });

  it('says "accepted by the channel" only with the acceptance', () => {
    expectRefused(Delivery, { ...accepted, acceptedAt: null }, 'acceptedAt');
    expectRefused(Delivery, { ...accepted, outcome: 'retry' }, 'outcome');
    expectRefused(Delivery, { ...accepted, attempts: 0 }, 'attempts');
    // Attempted or sent is not accepted: a pending delivery cannot carry an acceptance stamp.
    expectRefused(Delivery, { ...retrying, acceptedAt: '2026-11-17T10:00:01Z' }, 'acceptedAt');
    expectRefused(Delivery, { ...retrying, outcome: 'accepted' }, 'outcome');
    expectRefused(Delivery, { ...failed, acceptedAt: '2026-11-17T10:00:01Z' }, 'acceptedAt');
    expectRefused(Delivery, { ...accepted, state: 'notified' }, 'state');
  });

  it('keeps attempts, outcome and the next attempt consistent', () => {
    expectRefused(Delivery, { ...fresh, outcome: 'retry' }, 'outcome');
    expectRefused(Delivery, { ...retrying, outcome: null }, 'outcome');
    expectRefused(Delivery, { ...retrying, nextAttemptAt: null }, 'nextAttemptAt');
    expectRefused(Delivery, { ...failed, nextAttemptAt: '2026-11-17T10:05:00Z' }, 'nextAttemptAt');
    expectRefused(Delivery, { ...failed, attempts: 0 }, 'attempts');
  });
});
