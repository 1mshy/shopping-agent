// Typed transport outcomes: FetchOutcome (S§5.1) and the MarketplaceAdapter Outcome (S§5.9).
// Response bodies are not part of the contract; they stay inside packages/fetch and the readers.
import { z } from 'zod';
import { distinct } from './common.ts';
import {
  AdapterRequirement,
  PLAYBOOK_OUTCOME_KINDS,
  type PlaybookOutcomeKind,
  PolicyRefusalReason,
  Rung,
  WallMode,
  WallVendor,
} from './vocab.ts';

/** Milliseconds to wait before the next request, from Retry-After; null when none was given. */
const retryAfterMs = z.int().nonnegative().nullable();

/** Every outcome names the rung that produced it: the playbook is kept per rung (S§5.1, S§4.1). */
const at = { rung: Rung };

/** What every fetch returns (S§5.1), discriminated on `kind` (the `FETCH_OUTCOME_KINDS`). */
export const FetchOutcome = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ok'), ...at }),
  z.strictObject({ kind: z.literal('not_found'), ...at }),
  /** `vendor` is null when the classifier saw a wall but cannot name its vendor. */
  z.strictObject({ kind: z.literal('wall'), ...at, vendor: WallVendor.nullable(), mode: WallMode }),
  z.strictObject({ kind: z.literal('rate_limited'), ...at, retryAfterMs }),
  z.strictObject({ kind: z.literal('payment_required'), ...at }),
  z.strictObject({ kind: z.literal('login_required'), ...at }),
  z.strictObject({ kind: z.literal('empty'), ...at }),
  z.strictObject({ kind: z.literal('server_error'), ...at }),
  /** `code` is the transport's error code ("ECONNRESET", "UND_ERR_CONNECT_TIMEOUT"). */
  z.strictObject({
    kind: z.literal('network_error'),
    ...at,
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
  }),
  z.strictObject({ kind: z.literal('refused_by_policy'), ...at, reason: PolicyRefusalReason }),
]);
export type FetchOutcome = z.infer<typeof FetchOutcome>;

/** The outcomes that may change the playbook: "Only ok, wall and empty" (S§5.1). */
export type PlaybookOutcome = Extract<FetchOutcome, { kind: PlaybookOutcomeKind }>;

/** True when the outcome may change the playbook; a 404 never moves a rung (S§5.1). */
export function changesPlaybook(outcome: FetchOutcome): outcome is PlaybookOutcome {
  return (PLAYBOOK_OUTCOME_KINDS as readonly string[]).includes(outcome.kind);
}

/** What a marketplace adapter's search returns (S§5.9), discriminated on `kind`. */
export const MarketplaceOutcome = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ok') }),
  z.strictObject({ kind: z.literal('blocked') }),
  z.strictObject({ kind: z.literal('rate_limited'), retryAfterMs }),
  z.strictObject({ kind: z.literal('needs_person') }),
  /** The adapter's unmet requirements (S§5.9 `requires {browser, userKey, session}`). */
  z.strictObject({
    kind: z.literal('not_configured'),
    missing: distinct(AdapterRequirement, 3).min(1),
  }),
  z.strictObject({ kind: z.literal('parse_error') }),
]);
export type MarketplaceOutcome = z.infer<typeof MarketplaceOutcome>;

/** True for the only outcome that counts against adapter health: `parse_error` (S§5.9). */
export function countsAgainstHealth(
  outcome: MarketplaceOutcome,
): outcome is Extract<MarketplaceOutcome, { kind: 'parse_error' }> {
  return outcome.kind === 'parse_error';
}
