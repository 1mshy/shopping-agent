// The price-alert decision beyond the corpus: boundaries at ±1 minor unit, exactness near 2^53,
// other currency exponents, degenerate histories, the threshold's range, the cooldown's edges and
// the refusals.
import type { MinorUnitCurrency, Money } from '@agentic-dasher/shared';
import { describe, expect, it } from 'vitest';
import {
  type AlertListingRead,
  type AlertObservedRead,
  evaluatePriceAlert,
  type PriceAlertInput,
  type PriceAlertWatch,
} from '../../src/alerts/price-rules.ts';

const MAX = Number.MAX_SAFE_INTEGER;
const NOW = '2026-11-17T09:05:00.000Z';

function obs(
  id: number,
  minute: number,
  price: number | null,
  more: Partial<AlertObservedRead> = {},
): AlertObservedRead {
  return {
    kind: 'observation',
    observationId: id,
    observedAt: `2026-11-17T08:${String(minute).padStart(2, '0')}:00.000Z`,
    currency: 'CAD',
    price,
    availability: 'in',
    readPath: 'platform_json',
    rung: 'api',
    ...more,
  };
}

const money = (amountMinor: number, currency: MinorUnitCurrency = 'CAD'): Money => ({
  amountMinor,
  currency,
});

function watch(more: Partial<PriceAlertWatch> = {}): PriceAlertWatch {
  return {
    currency: 'CAD',
    referencePrice: null,
    targetPrice: null,
    dropBasisPoints: null,
    cooldownSeconds: 43200,
    ...more,
  };
}

/** A drop rule on reference `b` and a confirmed pair at `p` after `flat` reads at `b`. */
function drop(
  b: number,
  p: number,
  bp: number,
  currency: MinorUnitCurrency = 'CAD',
  flat = 3,
): PriceAlertInput {
  const history = Array.from({ length: flat }, (_, i) => obs(101 + i, i, b, { currency }));
  return {
    now: NOW,
    watch: watch({ currency, referencePrice: money(b, currency), dropBasisPoints: bp }),
    reads: [...history, obs(201, 30, p, { currency }), obs(202, 31, p, { currency })],
    lastAcceptedPriceAlert: null,
  };
}

const fired = (input: PriceAlertInput) => evaluatePriceAlert(input).fire;
const silence = (input: PriceAlertInput) => {
  const d = evaluatePriceAlert(input);
  return d.fire ? null : d.silence;
};

describe('drop rule arithmetic', () => {
  it('the user threshold is inclusive, exact without rounding (B = 10001, 5% = 500.05)', () => {
    expect(silence(drop(10001, 10001 - 500, 500))).toBe('below_threshold');
    expect(fired(drop(10001, 10001 - 501, 500))).toBe(true);
  });

  it('the 1% floor is strict and never rounded (B = 10150, 1% = 101.5)', () => {
    // 50 bp keeps the user threshold below the floor.
    expect(silence(drop(10150, 10150 - 101, 50))).toBe('within_noise');
    // 102 > 101.5: rounding B / 100 half up to 102 would wrongly stay silent.
    expect(fired(drop(10150, 10150 - 102, 50))).toBe(true);
  });

  it('the floor at a round reference: 1% is silent, 1% + 1 minor unit fires', () => {
    expect(silence(drop(10000, 9900, 50))).toBe('within_noise');
    expect(fired(drop(10000, 9899, 50))).toBe(true);
  });

  it('a reference of one minor unit: a drop to zero fires, no drop does not', () => {
    expect(fired(drop(1, 0, 1))).toBe(true);
    expect(silence(drop(1, 1, 1))).toBe('below_threshold');
  });

  it('a price above the reference is below the threshold', () => {
    expect(silence(drop(10000, 10001, 1))).toBe('below_threshold');
  });

  it('a threshold of 1 bp leaves the 1% floor to decide', () => {
    expect(silence(drop(10000, 9999, 1))).toBe('within_noise');
    expect(silence(drop(10000, 9900, 1))).toBe('within_noise');
    expect(fired(drop(10000, 9899, 1))).toBe(true);
  });

  it('a threshold of 9999 bp needs a 99.99% drop', () => {
    expect(fired(drop(10000, 1, 9999))).toBe(true);
    expect(silence(drop(10000, 2, 9999))).toBe('below_threshold');
  });

  it('stays exact for a reference near 2^53', () => {
    const b = MAX;
    // 5% of MAX is 450359962737049.55; the smallest drop that meets it is 450359962737050.
    const need = Number((BigInt(b) * 500n + 9999n) / 10000n);
    expect(need).toBe(450359962737050);
    expect(fired(drop(b, b - need, 500))).toBe(true);
    expect(silence(drop(b, b - need + 1, 500))).toBe('below_threshold');
  });

  it('works the same in a zero-decimal and a three-decimal currency', () => {
    // JPY: ¥10,000 reference, 1% floor = ¥100.
    expect(silence(drop(10000, 9900, 50, 'JPY'))).toBe('within_noise');
    expect(fired(drop(10000, 9899, 50, 'JPY'))).toBe(true);
    // KWD: 10.000 KWD = 10000 minor units, threshold 5% = 0.500 KWD.
    expect(silence(drop(10000, 9501, 500, 'KWD'))).toBe('below_threshold');
    expect(fired(drop(10000, 9500, 500, 'KWD'))).toBe(true);
  });

  it('a drop of exactly 3 MAD is silent, one minor unit more fires', () => {
    // History 10000 ± 600 (MAD 600 with the pair included as long as it stays in the upper half).
    const noisy = [10000, 10600, 9400, 10000, 10700, 9300, 10000].map((p, i) => obs(101 + i, i, p));
    const at = (p: number): PriceAlertInput => ({
      now: NOW,
      watch: watch({ referencePrice: money(10000), dropBasisPoints: 500 }),
      reads: [...noisy, obs(201, 30, p), obs(202, 31, p)],
      lastAcceptedPriceAlert: null,
    });
    expect(silence(at(8200))).toBe('within_noise');
    expect(fired(at(8199))).toBe(true);
  });
});

describe('confirmation and the read history', () => {
  const base = { now: NOW, lastAcceptedPriceAlert: null } as const;
  const w = watch({ referencePrice: money(10000), dropBasisPoints: 500 });

  it('a history of one read cannot confirm', () => {
    expect(silence({ ...base, watch: w, reads: [obs(201, 30, 9000)] })).toBe(
      'awaiting_confirmation',
    );
  });

  it('a confirmed pair with no other history fires (MAD of the pair is zero)', () => {
    expect(fired({ ...base, watch: w, reads: [obs(201, 30, 9000), obs(202, 31, 9000)] })).toBe(
      true,
    );
  });

  it('a failed read between the pair breaks the confirmation', () => {
    const failed: AlertListingRead = {
      kind: 'failed',
      at: '2026-11-17T08:30:30.000Z',
      rung: 'api',
    };
    expect(
      silence({ ...base, watch: w, reads: [obs(201, 30, 9000), failed, obs(202, 31, 9000)] }),
    ).toBe('awaiting_confirmation');
  });

  it('an out-of-stock or foreign read before does not confirm', () => {
    const out = obs(201, 30, 9000, { availability: 'out' });
    const usd = obs(201, 30, 9000, { currency: 'USD' });
    for (const before of [out, usd]) {
      expect(silence({ ...base, watch: w, reads: [before, obs(202, 31, 9000)] })).toBe(
        'awaiting_confirmation',
      );
    }
  });

  it('only comparable reads enter the noise window', () => {
    // Sold-out and foreign reads on the same path at wild prices do not widen the noise band.
    const wild = [
      obs(101, 0, 20000, { availability: 'out' }),
      obs(102, 1, 1, { currency: 'USD' }),
      obs(103, 2, 30000, { availability: 'unknown' }),
      obs(104, 3, null, { availability: 'out' }),
    ];
    expect(
      fired({ ...base, watch: w, reads: [...wild, obs(201, 30, 9000), obs(202, 31, 9000)] }),
    ).toBe(true);
  });

  it('accepts reads at the same instant, the array order deciding the last', () => {
    const t = '2026-11-17T08:30:00.000Z';
    const pair = [obs(201, 30, 9000, { observedAt: t }), obs(202, 30, 9000, { observedAt: t })];
    expect(evaluatePriceAlert({ ...base, watch: w, reads: pair })).toMatchObject({
      fire: true,
      observationId: 202,
    });
  });

  it('refuses reads out of order and a read after now', () => {
    expect(() =>
      evaluatePriceAlert({ ...base, watch: w, reads: [obs(202, 31, 9000), obs(201, 30, 9000)] }),
    ).toThrow(RangeError);
    expect(() =>
      evaluatePriceAlert({
        ...base,
        now: '2026-11-17T08:00:00.000Z',
        watch: w,
        reads: [obs(1, 30, 9000)],
      }),
    ).toThrow(RangeError);
  });

  it('a failed read evaluated is silent before anything else', () => {
    const failed: AlertListingRead = {
      kind: 'failed',
      at: '2026-11-17T08:31:00.000Z',
      rung: 'api',
    };
    expect(silence({ ...base, watch: watch({ targetPrice: money(1) }), reads: [failed] })).toBe(
      'failed_read',
    );
  });

  it('an in-stock read without a price, or on a watch with no currency, is not compared', () => {
    expect(
      silence({ ...base, watch: watch({ targetPrice: money(5000) }), reads: [obs(1, 1, null)] }),
    ).toBe('currency_mismatch');
    expect(
      silence({
        ...base,
        watch: watch({ currency: null, targetPrice: money(5000) }),
        reads: [obs(1, 1, 10)],
      }),
    ).toBe('currency_mismatch');
  });

  it('a target or reference in another currency is never compared', () => {
    expect(
      silence({
        ...base,
        watch: watch({ targetPrice: money(5000, 'USD') }),
        reads: [obs(1, 1, 10)],
      }),
    ).toBe('below_threshold');
    const foreignRef = watch({ referencePrice: money(10000, 'USD'), dropBasisPoints: 500 });
    expect(silence({ ...base, watch: foreignRef, reads: [obs(1, 1, 10), obs(2, 2, 10)] })).toBe(
      'no_reference',
    );
  });

  it('with no rule at all nothing fires', () => {
    expect(silence({ ...base, watch: watch(), reads: [obs(1, 1, 10)] })).toBe('below_threshold');
  });

  it('a target met with a drop rule failing fires the target alone', () => {
    const both = watch({
      targetPrice: money(9500),
      referencePrice: money(10000),
      dropBasisPoints: 500,
    });
    expect(evaluatePriceAlert({ ...base, watch: both, reads: [obs(1, 1, 9000)] })).toEqual({
      fire: true,
      rules: ['target_reached'],
      observationId: 1,
      price: money(9000),
      repeat: 'first',
    });
  });
});

describe('repeats and the cooldown', () => {
  const target = (cooldownSeconds: number) => watch({ targetPrice: money(5000), cooldownSeconds });
  const after = (
    acceptedAt: string,
    price: number,
    cooldownSeconds = 43200,
    last: Money = money(4500),
  ): PriceAlertInput => ({
    now: NOW,
    watch: target(cooldownSeconds),
    reads: [obs(401, 4, price)],
    lastAcceptedPriceAlert: { price: last, acceptedAt },
  });
  const repeat = (input: PriceAlertInput) => {
    const d = evaluatePriceAlert(input);
    return d.fire ? d.repeat : d.silence;
  };

  it('a cooldown of 0 is over at once: the same price is unchanged, a moved one fires', () => {
    expect(repeat(after(NOW, 4500, 0))).toBe('unchanged_price');
    expect(repeat(after(NOW, 4600, 0))).toBe('moved_after_cooldown');
    expect(repeat(after(NOW, 4499, 0))).toBe('further_drop');
  });

  it('a further drop of one minor unit bypasses the cooldown', () => {
    expect(repeat(after(NOW, 4499))).toBe('further_drop');
    expect(repeat(after(NOW, 4500))).toBe('cooldown');
  });

  it('an acceptance stamped after now is still inside the cooldown', () => {
    expect(repeat(after('2026-11-17T10:00:00.000Z', 4600))).toBe('cooldown');
  });

  it('a cooldown as long as the safe-integer range does not overflow', () => {
    expect(repeat(after('2000-01-01T00:00:00.000Z', 4600, MAX))).toBe('cooldown');
  });

  it('a last alert in another currency is neither undercut nor equalled', () => {
    expect(repeat(after(NOW, 1, 43200, money(4500, 'USD')))).toBe('cooldown');
    expect(repeat(after('2026-11-01T00:00:00.000Z', 4500, 43200, money(4500, 'USD')))).toBe(
      'moved_after_cooldown',
    );
  });
});

describe('refusals', () => {
  const ok: PriceAlertInput = {
    now: NOW,
    watch: watch({ targetPrice: money(5000) }),
    reads: [obs(1, 1, 4000)],
    lastAcceptedPriceAlert: null,
  };

  it('refuses no read', () => {
    expect(() => evaluatePriceAlert({ ...ok, reads: [] })).toThrow(RangeError);
  });

  it('refuses a drop threshold outside 0 < bp < 10000 and a fractional one', () => {
    for (const bp of [0, -1, 10000, 12.5]) {
      expect(() => evaluatePriceAlert({ ...ok, watch: watch({ dropBasisPoints: bp }) })).toThrow(
        RangeError,
      );
    }
  });

  it('refuses a negative or fractional cooldown', () => {
    expect(() => evaluatePriceAlert({ ...ok, watch: watch({ cooldownSeconds: -1 }) })).toThrow(
      RangeError,
    );
    expect(() => evaluatePriceAlert({ ...ok, watch: watch({ cooldownSeconds: 1.5 }) })).toThrow(
      RangeError,
    );
  });

  it('refuses a negative, fractional or unsafe price', () => {
    for (const price of [-1, 0.5, MAX + 1]) {
      expect(() => evaluatePriceAlert({ ...ok, reads: [obs(1, 1, price)] })).toThrow(RangeError);
    }
  });

  it('refuses a malformed timestamp', () => {
    expect(() => evaluatePriceAlert({ ...ok, now: '2026-11-17 09:05' })).toThrow(RangeError);
    expect(() =>
      evaluatePriceAlert({
        ...ok,
        lastAcceptedPriceAlert: { price: money(4500), acceptedAt: 'yesterday' },
      }),
    ).toThrow(RangeError);
  });
});
