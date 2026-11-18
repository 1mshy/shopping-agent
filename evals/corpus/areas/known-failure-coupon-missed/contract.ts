// Known failure: a clip coupon missed (plan P0 workstream 3, "coupon missed"). A watch that read
// only the sticker sat through a CA$167.73 → CA$49.99 clip coupon on a tracked amazon.ca listing
// (2026-09-02) without an alert (stores/bigbox.py lines 60-63; fixed in commit 9678053,
// 2026-09-06; tests/test_amazon.py from line 327). The function reads the coupon a product page
// shows beside its buy box into the S§4.1 observation fields: `coupon` is an amount off, and a
// percentage coupon becomes an amount only because its base, the sticker, is known. Phase 1
// workstream 2 (the Amazon adapter) and workstream 5 (effective price) use it.
import type { Money } from '@agentic-dasher/shared';

/** How a case's expected value was established. */
export type How =
  | 'test assertion'
  | 'reading the function'
  | 'running the function offline'
  | 'spec';

export interface Provenance {
  readonly file: string;
  readonly at: string;
  readonly how: How;
  readonly note?: string;
}

export interface CaseMeta {
  readonly id: string;
  readonly what: string;
  readonly from: readonly Provenance[];
  readonly divergence?: string;
  readonly specSilent?: true;
}

export interface CouponInput {
  /** The buy-box price the coupon comes off. Its currency is the coupon's. */
  readonly sticker: Money;
  /**
   * The visible text of the coupon widgets beside the buy box, or of a search card, fragments
   * joined by single spaces. Scripts, styles and templates are not visible text: the page
   * bundle's own strings ("{number} off coupon") are never in it.
   */
  readonly text: string;
}

/**
 * The figure nearest a word "coupon" is the coupon: a percentage ("Save 20% with coupon") or an
 * amount ("Apply $117.74 coupon", "coupon de 40 $"). A figure with subscription words beside it
 * ("Save 5% with Subscribe & Save") is not a coupon, wherever it sits. An amount not below the
 * sticker, or a percentage outside (0, 100), is a misread and ignored. A percentage's amount off
 * is the sticker less the effective price, which is the sticker × (1 − percentage) rounded half
 * up to the minor unit. `effective` is sticker − amountOff.
 */
export type CouponReading =
  | { readonly kind: 'none' }
  | { readonly kind: 'amount_off'; readonly amountOff: Money; readonly effective: Money }
  | {
      readonly kind: 'percent_off';
      /** The percentage in basis points (20% is 2000). */
      readonly basisPoints: number;
      readonly amountOff: Money;
      readonly effective: Money;
    };

/** The future function. */
export type ReadCoupon = (input: CouponInput) => CouponReading;

export interface CouponCase extends CaseMeta {
  readonly input: CouponInput;
  readonly expected: CouponReading;
}
