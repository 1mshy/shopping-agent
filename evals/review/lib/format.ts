// Hand-review files (S§5.16): the predecessor's format, read as it is, and this project's version.
// See ../README.md for every field, who writes it, and how a review file relates to the gold set.
import { MONEY_REFUSAL_CODES, moneyFromDecimal } from '@agentic-dasher/core';
import {
  ListingCurrency,
  type MatchRelation,
  MinorUnitCurrency,
  Timestamp,
} from '@agentic-dasher/shared';
import { z } from 'zod';
import { CountryCode, GoldId, LabellerId } from '../../gold/lib/formats.ts';

export const REVIEW_FORMAT_VERSION = 1;
/** Written into every converted file. Bump on a change of the converter's output. */
export const CONVERTER_VERSION = 'review-convert/1';

// ---------------------------------------------------------------------------------------------
// The predecessor's review file (hermes-shopping `scripts/eval/*-review.json`), as
// `scripts/web-discovery-eval.py` reads it: `{product id: {store: reason}}` plus an `about` note.
// A rejection is a reason (every setup) or `{"reason": ..., "setups": [...]}` (`apply_review`).
// ---------------------------------------------------------------------------------------------

/** The predecessor's three setups (`_SETUPS` in the script), kept under its names. */
export const SETUPS = ['before', 'after', 'with_learned'] as const;
export const Setup = z.enum(SETUPS);
export type Setup = z.infer<typeof Setup>;

export const PredecessorRejection = z.union([
  z.string(),
  // The script reads only `reason` and `setups`; anything else would be ignored by it, and is
  // refused here so that nothing a reviewer wrote is silently dropped.
  z.strictObject({ reason: z.string(), setups: z.array(z.string()).optional() }),
]);
export type PredecessorRejection = z.infer<typeof PredecessorRejection>;

export const PredecessorReview = z.record(
  z.string(),
  z.union([z.string(), z.record(z.string(), PredecessorRejection)]),
);
export type PredecessorReview = z.infer<typeof PredecessorReview>;

// ---------------------------------------------------------------------------------------------
// This project's review file.
// ---------------------------------------------------------------------------------------------

/** Where a listing came from in the run (the predecessor's `catalog_results`, `web_results`, `learned_results`). */
export const LISTING_SOURCES = ['catalog', 'web', 'learned'] as const;
export const ListingSource = z.enum(LISTING_SOURCES);
export type ListingSource = z.infer<typeof ListingSource>;

/** The listings each setup is built from (`run_one` in the predecessor's script). */
export const SETUP_SOURCES: Readonly<Record<Setup, readonly ListingSource[]>> = {
  before: ['catalog'],
  after: ['catalog', 'web'],
  with_learned: ['catalog', 'web', 'learned'],
};

/**
 * The engine's store key, as the predecessor wrote it: a catalogue key ("amazon", "bestbuyca") or a
 * host for a store outside the catalogue ("rona.ca"). Not a `Host`: a catalogue key has no dot.
 */
export const StoreKey = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,252}$/, 'a lower-case store key');

/** A canonical machine decimal, the form `moneyFromDecimal` reads ("1299", "129.99", "28.0"). */
export const DecimalText = z.string().regex(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/, 'a decimal');

/**
 * A price as recorded: the exact decimal text plus its currency, and the integer minor units that
 * text converts to through `moneyFromDecimal`, or the refusal code when it does not convert. No
 * number with a fraction appears anywhere: the amount is an integer or null, never rounded.
 */
export const ReviewPrice = z
  .strictObject({
    decimal: DecimalText,
    currency: ListingCurrency,
    amountMinor: z.int().nullable(),
    refusal: z.enum(MONEY_REFUSAL_CODES).nullable(),
  })
  .superRefine((p, ctx) => {
    const money = moneyFromDecimal(p.decimal, p.currency);
    const want = money.ok
      ? { amountMinor: money.value.amountMinor, refusal: null }
      : { amountMinor: null, refusal: money.refusal.code };
    if (p.amountMinor !== want.amountMinor || p.refusal !== want.refusal) {
      ctx.addIssue({
        code: 'custom',
        message: `amountMinor/refusal must be what moneyFromDecimal gives: ${JSON.stringify(want)}`,
      });
    }
  });
export type ReviewPrice = z.infer<typeof ReviewPrice>;

/** One row the engine read a price for (the predecessor's `verified()` rows). Written by the tool. */
export const ReviewListing = z.strictObject({
  source: ListingSource,
  store: StoreKey,
  url: z.string().min(1),
  title: z.string(),
  price: ReviewPrice,
  /** The reader that read it (`method`); the predecessor's catalogue rows carry none. */
  readMethod: z.string().min(1).nullable(),
});
export type ReviewListing = z.infer<typeof ReviewListing>;

/** A page open-web discovery could not read (`web_unreadable`). Written by the tool. */
export const UnreadablePage = z.strictObject({
  host: z.string().min(1),
  url: z.string().min(1),
  reason: z.string().min(1),
});

/**
 * A person's verdict on one store for one product, under the review rule (`review.rule`):
 * - `rejected`: no listing the engine read at this store, in the named setups, is the product;
 * - `accepted`: at least one is (the predecessor never writes this: an unlisted store is accepted,
 *   see `unlistedStores`).
 * Neither determines a MatchRelation; see STORE_VERDICT_POSSIBLE_RELATIONS.
 */
export const STORE_VERDICTS = ['rejected', 'accepted'] as const;
export const StoreVerdictValue = z.enum(STORE_VERDICTS);
export type StoreVerdictValue = z.infer<typeof StoreVerdictValue>;

/**
 * The relations a listing at the store can have under each coarse verdict. The predecessor's rule:
 * "a store counts for a product when at least one row the engine read there is that product
 * itself: any colour or finish, new, open box or renewed. Rejected: accessories and parts, another
 * model or generation, another capacity or size, a bundle, kit or multi-pack when no row is the
 * product, a multi-capacity listing whose price is another capacity's, and a look-alike."
 * - accepted: one unnamed listing is `exact`, or `variant` by colour or finish only; the others at
 *   the store are not judged at all.
 * - rejected: every listing is `variant` (capacity, size), `bundle`, `accessory_or_part`,
 *   `other_model` or `other_line` (a look-alike), or, for "a multi-capacity listing whose price is
 *   another capacity's", even `exact` or `variant` with the wrong price. The reason is free text.
 */
export const STORE_VERDICT_POSSIBLE_RELATIONS: Readonly<
  Record<StoreVerdictValue, readonly MatchRelation[]>
> = {
  accepted: ['exact', 'variant'],
  rejected: ['exact', 'variant', 'bundle', 'accessory_or_part', 'other_model', 'other_line'],
};

export const StoreVerdict = z
  .strictObject({
    store: StoreKey,
    verdict: StoreVerdictValue,
    /** `all`, or the setups the verdict applies to (the catalogue's rows may be a part while the web read the product). */
    setups: z.union([z.literal('all'), z.array(Setup).min(1)]),
    reason: z.string(),
  })
  .superRefine((v, ctx) => {
    if (Array.isArray(v.setups) && new Set(v.setups).size !== v.setups.length) {
      ctx.addIssue({ code: 'custom', path: ['setups'], message: 'each setup once' });
    }
    if (v.verdict === 'rejected' && v.reason.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'a rejection gives its reason' });
    }
  });
export type StoreVerdict = z.infer<typeof StoreVerdict>;

export const setupsOf = (v: StoreVerdict): readonly Setup[] =>
  v.setups === 'all' ? SETUPS : v.setups;

export const ReviewProduct = z
  .strictObject({
    id: GoldId,
    category: GoldId,
    /** The search as a shopper typed it. */
    query: z.string().min(1),
    listings: z.array(ReviewListing),
    unreadable: z.array(UnreadablePage),
    verdicts: z.array(StoreVerdict),
  })
  .superRefine((p, ctx) => {
    // One verdict per store and setup: a store both accepted and rejected for one setup is a
    // contradiction, and two rejections of one store are a merge error.
    const seen = new Set<string>();
    p.verdicts.forEach((v, i) => {
      for (const s of setupsOf(v)) {
        const key = `${v.store}\u0000${s}`;
        if (seen.has(key)) {
          ctx.addIssue({
            code: 'custom',
            path: ['verdicts', i],
            message: `two verdicts on ${v.store} for ${s}`,
          });
        }
        seen.add(key);
      }
    });
  });
export type ReviewProduct = z.infer<typeof ReviewProduct>;

/** Provenance of a file converted from the predecessor. Written by the converter. */
export const PredecessorConversion = z.strictObject({
  converter: z.string().min(1),
  repository: z.string().min(1),
  branch: z.string().min(1),
  commit: z.string().regex(/^[0-9a-f]{7,40}$/),
  reviewFile: z.string().min(1),
  reviewFileSha256: z.string().regex(/^[0-9a-f]{64}$/),
  runFile: z.string().min(1),
  runFileSha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** What the conversion did not carry or changed in form, one line each. */
  lossy: z.array(z.string().min(1)),
});

export const ReviewFile = z
  .strictObject({
    formatVersion: z.literal(REVIEW_FORMAT_VERSION),
    id: GoldId,
    /** The run that produced the listings. Written by the tool. */
    run: z.strictObject({
      startedAt: Timestamp.nullable(),
      finishedAt: Timestamp.nullable(),
      /** The shopper's currency; a store billing in it counts in the `…InPreferred` figures. */
      preferredCurrency: MinorUnitCurrency.nullable(),
      preferredRegion: CountryCode.nullable(),
      productList: z.string().min(1).nullable(),
    }),
    /** The review. Written by a person. */
    review: z.strictObject({
      /** An opaque handle, never a name or an email (as the gold set's labeller id). */
      reviewerId: LabellerId,
      reviewedAt: Timestamp.nullable(),
      /** The rule the reviewer applied, in their words. */
      rule: z.string().min(1),
      /**
       * What a store with no verdict is. `accepted` is the predecessor's semantics: every store not
       * rejected counts, so an unreviewed store cannot be told from an accepted one.
       */
      unlistedStores: z.literal('accepted'),
    }),
    products: z.array(ReviewProduct),
    conversion: PredecessorConversion.optional(),
  })
  .superRefine((f, ctx) => {
    const ids = new Set<string>();
    f.products.forEach((p, i) => {
      if (ids.has(p.id)) {
        ctx.addIssue({ code: 'custom', path: ['products', i, 'id'], message: 'duplicate product' });
      }
      ids.add(p.id);
    });
  });
export type ReviewFile = z.infer<typeof ReviewFile>;
