// One small interface for every channel (S§5.11): send one message, get a typed per-channel
// outcome back. Phase 3's Telegram, Discord and Web Push adapters implement the same interface;
// nothing here assumes HTTP (in-app sends nothing), a JSON body or a single secret shape beyond
// "an optional string the adapter alone sees".
import type { AttemptResult } from '@agentic-dasher/core';
import type { ChannelType, Money, NotificationKind, Timestamp } from '@agentic-dasher/shared';

/** A label code puts beside an alert when the caller supplies it (S§5.5 trust, S§2.4). */
export type MessageLabel = 'caution' | 'unconfirmed';

/** What the alert rests on, as engine records (S§2.1): every figure comes from here. */
export interface AlertFacts {
  readonly watchId: number;
  readonly listingId: number;
  readonly observationId: number;
  readonly listingTitle: string;
  readonly listingUrl: string;
  readonly storeHost: string;
  /** The observation's effective price; null when it has none (no price read, currency unknown). */
  readonly price: Money | null;
  /** The observation's sticker price when it is above the effective price. */
  readonly sticker: Money | null;
  readonly labels: readonly MessageLabel[];
}

/** One message, plain text, built by code (message.ts). */
export interface NotifyMessage {
  /** The event's stable key (`test:…` for a Test send, which has no event). */
  readonly eventKey: string;
  readonly kind: NotificationKind | 'test';
  readonly createdAt: Timestamp;
  readonly title: string;
  readonly body: string;
  /** Where a tap leads: the listing for a listing alert; null otherwise. */
  readonly url: string | null;
  /** Listing alerts are urgent; everything else is not. */
  readonly urgent: boolean;
  readonly alert: AlertFacts | null;
}

/** What failed, in words a settings page and Diagnostics can show. */
export type ErrorClass =
  | 'transport'
  | 'rate_limited'
  | 'server'
  | 'auth'
  | 'payload'
  | 'redirect'
  | 'unclassified';

/** The per-channel outcome of one send. `attempt` feeds the pure retry decision (core). */
export interface ChannelOutcome {
  readonly attempt: AttemptResult;
  /** Null when accepted. */
  readonly errorClass: ErrorClass | null;
  /** A short description for Diagnostics, already redacted (never a secret). */
  readonly detail: string | null;
}

/** A channel as the adapter sees it: its type, validated config and decrypted secret. */
export interface ChannelTarget<C = unknown> {
  readonly id: number;
  readonly type: ChannelType;
  readonly config: C;
  /** The decrypted token, in memory only for this send; null when the channel has none. */
  readonly secret: string | null;
}

export interface SendContext {
  /** Aborts the send (the pass's deadline or a shutdown). */
  readonly signal: AbortSignal;
  /** How long one request may take. */
  readonly timeoutMs: number;
  readonly fetch: typeof fetch;
}

export interface ChannelAdapter<C = unknown> {
  readonly type: ChannelType;
  send(
    message: NotifyMessage,
    target: ChannelTarget<C>,
    context: SendContext,
  ): Promise<ChannelOutcome>;
}

export const ACCEPTED: ChannelOutcome = {
  attempt: { kind: 'accepted' },
  errorClass: null,
  detail: null,
};
