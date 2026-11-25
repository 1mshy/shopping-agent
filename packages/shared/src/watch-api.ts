// The watch API (S§5.8 Intake, S§5.12 Watches) and the stored `watch.rules_json`. The server's
// routes validate every body and query with these schemas, and the web client imports the same
// schemas and types. Money is always Money: an amount and its currency together (S§2.2).
import { z } from 'zod';
import { Id, type Timestamp } from './common.ts';
import type { MinorUnitCurrency } from './currency.ts';
import { Money } from './money.ts';
import type {
  Availability,
  Condition,
  NotificationKind,
  ReadFailureCause,
  ReferenceKind,
  TrustTier,
  WatchKind,
  WatchListingAddedBy,
  WatchListingRole,
  WatchLookupState,
} from './vocab.ts';

/** A drop threshold in basis points: 0 < bp < 10000 (500 = 5%). */
export const DropBasisPoints = z.int().gt(0).lt(10_000);

/**
 * `watch.rules_json`. The target price carries its own currency (it is Money); it is compared only
 * with prices in that same currency, never converted (S§2.2). The cooldown is the `cooldown_s`
 * column and the restock switch's time is `restock_enabled_at`, so neither is repeated here.
 */
export const WatchRules = z.strictObject({
  targetPrice: Money.nullable(),
  dropBasisPoints: DropBasisPoints.nullable(),
  restock: z.boolean(),
});
export type WatchRules = z.infer<typeof WatchRules>;

/**
 * POST /watches: one link or one name, and optional rules. Range checks (a positive target, the
 * drop band, a cooldown of at least an hour) are the intake decision's, so they answer its refusal
 * codes; this schema checks only the shapes.
 */
export const CreateWatchBody = z.strictObject({
  input: z.string().max(4000),
  targetPrice: Money.nullable().optional(),
  dropBasisPoints: z.int().nullable().optional(),
  restock: z.boolean().optional(),
  cooldownSeconds: z.int().nullable().optional(),
});
export type CreateWatchBody = z.infer<typeof CreateWatchBody>;

/**
 * PATCH /watches/:id. Every field is optional; a field left out keeps its value. `paused` pauses or
 * resumes. `referencePrice` sets a user-confirmed reference in the watch's currency, or null hands
 * the reference back to the median of verified listings (the sweep recomputes it).
 */
export const UpdateWatchBody = z.strictObject({
  targetPrice: Money.nullable().optional(),
  dropBasisPoints: z.int().nullable().optional(),
  restock: z.boolean().optional(),
  cooldownSeconds: z.int().optional(),
  paused: z.boolean().optional(),
  referencePrice: Money.nullable().optional(),
});
export type UpdateWatchBody = z.infer<typeof UpdateWatchBody>;

/** GET /notifications: newest first, `before` an event id from the previous page. */
export const NotificationsQuery = z.strictObject({
  before: z.coerce.number().pipe(Id).optional(),
  limit: z.coerce.number().pipe(z.int().min(1).max(100)).optional(),
});
export type NotificationsQuery = z.infer<typeof NotificationsQuery>;

/** Every refusal of these routes (400, 404 or 409). */
export interface ApiError {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly fields?: Readonly<Record<string, string>>;
  };
}

export type WatchStatus = 'active' | 'paused' | 'archived';
export type AlertDeliveryState = 'accepted' | 'awaiting_delivery' | 'undelivered';

/** The last alert of one kind and how its delivery stands (S§2.11). */
export interface WatchLastAlert {
  readonly eventId: number;
  readonly createdAt: Timestamp;
  readonly delivery: AlertDeliveryState;
  /** When it counts as delivered; null while it does not. */
  readonly acceptedAt: Timestamp | null;
  readonly price: Money | null;
}

export interface WatchView {
  readonly id: number;
  readonly kind: WatchKind;
  readonly input: string;
  readonly market: string;
  /** Adopted from the first real read; null until then. */
  readonly currency: MinorUnitCurrency | null;
  readonly rules: WatchRules;
  /** True when the target's currency is not the adopted one: it is never compared (S§2.2). */
  readonly targetCurrencyMismatch: boolean;
  readonly cooldownSeconds: number;
  readonly status: WatchStatus;
  readonly createdAt: Timestamp;
  readonly pausedAt: Timestamp | null;
  readonly archivedAt: Timestamp | null;
  readonly restockEnabledAt: Timestamp | null;
  readonly reference: { readonly price: Money; readonly kind: ReferenceKind } | null;
  readonly lookup: {
    readonly state: WatchLookupState;
    readonly queuedAt: Timestamp;
    readonly dueAt: Timestamp | null;
    readonly attempts: number;
    readonly error: string | null;
  } | null;
  readonly counts: {
    readonly tracked: number;
    readonly candidate: number;
    readonly excluded: number;
  };
  readonly lastAlerts: {
    readonly price_drop: WatchLastAlert | null;
    readonly restock: WatchLastAlert | null;
  };
}

/** `current`: the latest read produced it; `stale`: a later read failed or had no price. */
export type PriceFreshness = 'current' | 'stale' | 'none';

export interface WatchListingView {
  readonly listingId: number;
  readonly role: WatchListingRole;
  readonly addedBy: WatchListingAddedBy;
  readonly url: string;
  readonly title: string;
  readonly storeHost: string;
  readonly trustTier: TrustTier;
  readonly condition: Condition;
  /** Shown with a flag; left out of the reference and of new-item alerts (S§5.8). */
  readonly conditionUnknown: boolean;
  /** The latest observation's effective price, with the sticker beside it; never a model figure. */
  readonly price: {
    readonly effective: Money | null;
    readonly sticker: Money | null;
    readonly observedAt: Timestamp;
    readonly observationId: number;
  } | null;
  readonly freshness: PriceFreshness;
  readonly availability: Availability;
  readonly lastReadAt: Timestamp | null;
  readonly consecutiveErrors: number;
  readonly lastError: ReadFailureCause | null;
  readonly nextCheckAt: Timestamp | null;
}

export interface WatchDetail {
  readonly watch: WatchView;
  readonly listings: readonly WatchListingView[];
}

/** POST /watches answers the watch, and whether it was created (201) or already there (200). */
export interface CreateWatchResponse {
  readonly created: boolean;
  readonly watch: WatchView;
}

export interface HistoryPoint {
  readonly observationId: number;
  readonly observedAt: Timestamp;
  readonly currency: string;
  readonly effective: number | null;
  readonly sticker: number | null;
  readonly availability: Availability;
}

export interface ListingHistory {
  readonly listingId: number;
  readonly points: readonly HistoryPoint[];
}

export interface NotificationItem {
  readonly eventId: number;
  readonly kind: NotificationKind;
  readonly createdAt: Timestamp;
  readonly watchId: number | null;
  readonly listingId: number | null;
  readonly title: string;
  readonly body: string;
  readonly url: string | null;
  /** The in-app delivery's state; null when the event has no in-app delivery. */
  readonly inApp: 'pending' | 'accepted' | 'failed' | null;
}

export interface NotificationsPage {
  readonly items: readonly NotificationItem[];
  /** Pass as `before` for the next page; null on the last page. */
  readonly next: number | null;
}
