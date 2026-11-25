// Delivery gating beyond the corpus: in-app-only installs that are pending or failed, the earliest
// of several push acceptances, and the refusals.
import { describe, expect, it } from 'vitest';
import {
  type DeliveryGatingInput,
  type GatingDelivery,
  gateOnDelivery,
} from '../../src/alerts/delivery-gating.ts';

const price = {
  kind: 'price_drop',
  observationId: 1,
  price: { amountMinor: 9900, currency: 'CAD' },
} as const;
const d = (
  channelId: number,
  channelType: GatingDelivery['channelType'],
  state: GatingDelivery['state'],
  acceptedAt: string | null = null,
): GatingDelivery => ({ channelId, channelType, state, acceptedAt });

describe('gateOnDelivery', () => {
  it('an in-app-only install judges the in-app delivery: pending waits, failed is undelivered', () => {
    expect(gateOnDelivery({ alert: price, deliveries: [d(9, 'in_app', 'pending')] })).toEqual({
      stamp: null,
      status: 'awaiting_delivery',
    });
    expect(gateOnDelivery({ alert: price, deliveries: [d(9, 'in_app', 'failed')] })).toEqual({
      stamp: null,
      status: 'undelivered',
    });
  });

  it('stamps at the earliest push acceptance, whatever the order', () => {
    const deliveries = [
      d(1, 'ntfy', 'accepted', '2026-11-17T09:31:12.000Z'),
      d(2, 'telegram', 'accepted', '2026-11-17T09:30:59.999Z'),
      d(9, 'in_app', 'accepted', '2026-11-17T09:30:00.000Z'),
    ];
    expect(gateOnDelivery({ alert: price, deliveries })).toEqual({
      stamp: { kind: 'price_cooldown', at: '2026-11-17T09:30:59.999Z', price: price.price },
      status: 'accepted',
    });
  });

  it('one push pending and one failed is still awaiting delivery', () => {
    const deliveries = [d(1, 'ntfy', 'failed'), d(2, 'web_push', 'pending')];
    expect(gateOnDelivery({ alert: price, deliveries }).status).toBe('awaiting_delivery');
  });

  it('refuses an acceptedAt not set exactly when accepted, and a malformed one', () => {
    const bad: DeliveryGatingInput[] = [
      { alert: price, deliveries: [d(1, 'ntfy', 'accepted')] },
      { alert: price, deliveries: [d(1, 'ntfy', 'pending', '2026-11-17T09:31:12.000Z')] },
      { alert: price, deliveries: [d(1, 'ntfy', 'accepted', '2026-11-17T09:31:12Z')] },
    ];
    for (const input of bad) expect(() => gateOnDelivery(input)).toThrow(RangeError);
  });

  it('refuses an alert kind that stamps no watch state', () => {
    const alert = { ...price, kind: 'new_listing' } as unknown as DeliveryGatingInput['alert'];
    expect(() => gateOnDelivery({ alert, deliveries: [] })).toThrow(TypeError);
  });
});
