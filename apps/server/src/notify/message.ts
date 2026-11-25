// What a message says (S§5.11, S§2.1): built by code from the engine's records the event names.
// Every figure is an observation's amount in integer minor units with its currency, written as a
// decimal by code (no conversion, S§2.2); the store is the listing's store host; the link is the
// listing's canonical URL. Plain text only. No model text, except the stored text of an `agent`
// event, which is passed through as plain text (its placeholder contract is Phase 2's, S§2.1).
import { moneyToDecimal } from '@agentic-dasher/core';
import { type Database, schema } from '@agentic-dasher/db';
import type { Money, NotificationEvent, TrustTier } from '@agentic-dasher/shared';
import { eq } from 'drizzle-orm';
import type { AlertFacts, MessageLabel, NotifyMessage } from './adapters/types.ts';

/** Minor units and currency as text: `449.99 CAD`, `1500 JPY`. Display only; never converted. */
export function formatMoney(money: Money): string {
  const decimal = moneyToDecimal(money);
  return decimal.ok
    ? `${decimal.value} ${money.currency}`
    : `${money.amountMinor} minor units of ${money.currency}`;
}

/** The listing link as a tap target: http(s) only, so a stored URL can never be a script link. */
function httpLink(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

const LABEL_TEXT: Record<MessageLabel, (host: string) => string> = {
  caution: (host) => `Caution: ${host} has a low trust rating. Check the store before buying.`,
  unconfirmed: () => 'Unconfirmed: this listing may not be the exact product you watch.',
};

/** The records a listing alert rests on, read by `loadAlertRecords`. */
export interface AlertRecords {
  readonly listingTitle: string;
  readonly listingUrl: string;
  readonly storeHost: string;
  readonly trustTier: TrustTier;
  readonly currency: string;
  readonly effective: number | null;
  readonly sticker: number | null;
  /** The observation's time. */
  readonly observedAt: string;
}

function money(amount: number | null, currency: string): Money | null {
  if (amount === null || currency === 'unknown') return null;
  return { amountMinor: amount, currency: currency as Money['currency'] };
}

/** Builds the facts of a listing alert; `caution` is added when the store's trust tier is caution. */
export function alertFacts(
  event: Extract<NotificationEvent, { watchId: number }>,
  records: AlertRecords,
  labels: readonly MessageLabel[],
): AlertFacts {
  const price = money(records.effective, records.currency);
  const stickerMoney = money(records.sticker, records.currency);
  const sticker =
    stickerMoney !== null && price !== null && stickerMoney.amountMinor > price.amountMinor
      ? stickerMoney
      : null;
  const all = new Set<MessageLabel>(labels);
  if (records.trustTier === 'caution') all.add('caution');
  return {
    watchId: event.watchId,
    listingId: event.listingId,
    observationId: event.observationId,
    listingTitle: records.listingTitle,
    listingUrl: records.listingUrl,
    storeHost: records.storeHost,
    price,
    sticker,
    observedAt: records.observedAt,
    labels: (['caution', 'unconfirmed'] as const).filter((l) => all.has(l)),
  };
}

/**
 * Past this age at send time, a message no longer words the observation's price as current (finding
 * 7 of the review of 2026-11-25): a push retried for days must not say "Now 90.00" for a price read
 * days ago. The alert is still sent (S§2.11: every recorded alert is delivered); only its wording
 * changes, and every message states when the price was read.
 */
export const STALE_READ_AFTER_MS = 60 * 60 * 1000;

/** `2026-11-17 09:29 UTC`: the observation's time, to the minute, in UTC. */
function readTime(observedAt: string): string {
  return `${observedAt.slice(0, 10)} ${observedAt.slice(11, 16)} UTC`;
}

/** `5 hours`, `3 days`: whole hours below two days, whole days from there. */
function ageText(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 48) return hours === 1 ? '1 hour' : `${hours} hours`;
  return `${Math.floor(ms / 86_400_000)} days`;
}

const HEADLINE = {
  price_drop: 'Price drop',
  restock: 'Back in stock',
  new_listing: 'New listing',
} as const;

/**
 * The message for an event. `records` is required for a listing alert and ignored otherwise. `now`
 * (epoch ms, the injected clock) is when the message is sent: a listing alert whose observation is
 * older than STALE_READ_AFTER_MS then is worded as a past read, never as the current price. Without
 * `now` (a feed listing, read beside the event's own time) the price is worded as before, with the
 * read time beside it.
 */
export function buildMessage(
  event: NotificationEvent,
  records: AlertRecords | null,
  labels: readonly MessageLabel[] = [],
  now?: number,
): NotifyMessage {
  const base = { eventKey: event.key, kind: event.kind, createdAt: event.createdAt };
  switch (event.kind) {
    case 'price_drop':
    case 'restock':
    case 'new_listing': {
      if (records === null)
        throw new Error(`event ${event.id}: the records of a listing alert are required`);
      const facts = alertFacts(event, records, labels);
      const lines: string[] = [];
      const where = facts.storeHost;
      const when = readTime(facts.observedAt);
      const ageMs = now === undefined ? null : now - Date.parse(facts.observedAt);
      const stale = ageMs !== null && ageMs > STALE_READ_AFTER_MS;
      const past =
        ageMs === null
          ? ''
          : ` when read at ${when}, ${ageText(ageMs)} before this message was sent`;
      if (facts.price === null) {
        if (stale) {
          lines.push(
            event.kind === 'restock'
              ? `In stock at ${where}${past}; no price was read, and stock may have changed since.`
              : `At ${where}${past}; no price was read.`,
          );
        } else {
          lines.push(
            event.kind === 'restock'
              ? `In stock at ${where}; no price was read.`
              : `At ${where}; no price was read.`,
          );
          lines.push(`Read at ${when}`);
        }
      } else if (stale) {
        const price = formatMoney(facts.price);
        lines.push(
          event.kind === 'restock'
            ? `In stock at ${where} for ${price}${past}; stock and price may have changed since.`
            : `${price} at ${where}${past}; the price may have changed since.`,
        );
        if (facts.sticker !== null) lines.push(`Sticker price ${formatMoney(facts.sticker)}`);
      } else {
        const verb = event.kind === 'restock' ? 'In stock at' : 'Now';
        lines.push(
          event.kind === 'restock'
            ? `${verb} ${where} for ${formatMoney(facts.price)}`
            : `${verb} ${formatMoney(facts.price)} at ${where}`,
        );
        if (facts.sticker !== null) lines.push(`Sticker price ${formatMoney(facts.sticker)}`);
        lines.push(`Read at ${when}`);
      }
      for (const label of facts.labels) lines.push(LABEL_TEXT[label](where));
      const link = httpLink(facts.listingUrl);
      if (link !== null) lines.push(link);
      return {
        ...base,
        title: `${HEADLINE[event.kind]}: ${clip(facts.listingTitle, 100)}`,
        body: lines.join('\n'),
        url: link,
        urgent: true,
        alert: facts,
      };
    }
    case 'recommendation':
      return {
        ...base,
        title: 'A new suggestion',
        body: 'A new card is waiting in your feed.',
        url: null,
        urgent: false,
        alert: null,
      };
    case 'agent':
      return {
        ...base,
        title: 'Message from your assistant',
        body: event.text,
        url: null,
        urgent: false,
        alert: null,
      };
    case 'system':
      return {
        ...base,
        title: 'Agentic Dasher',
        body: event.text,
        url: null,
        urgent: false,
        alert: null,
      };
  }
}

/** The clearly-labelled message a channel's Test button sends. No figure, no event. */
export function testMessage(channelName: string, at: string): NotifyMessage {
  return {
    eventKey: `test:${at}`,
    kind: 'test',
    createdAt: at,
    title: 'Agentic Dasher test',
    body: `This is a test message from Agentic Dasher for the channel "${clip(channelName, 60)}". If you can read it, the channel works. Nothing was bought or changed.`,
    url: null,
    urgent: false,
    alert: null,
  };
}

/** Reads the listing, its store and the observation a listing alert names. */
export function loadAlertRecords(
  db: Database,
  event: Extract<NotificationEvent, { watchId: number }>,
): AlertRecords {
  const { listing, store, priceObservation } = schema;
  const row = db.orm
    .select({
      listingTitle: listing.title,
      listingUrl: listing.urlCanonical,
      storeHost: store.host,
      trustTier: store.trustTier,
      currency: priceObservation.currency,
      effective: priceObservation.effective,
      sticker: priceObservation.sticker,
      observedAt: priceObservation.observedAt,
    })
    .from(priceObservation)
    .innerJoin(listing, eq(listing.id, priceObservation.listingId))
    .innerJoin(store, eq(store.id, listing.storeId))
    .where(eq(priceObservation.id, event.observationId))
    .get();
  if (row === undefined) throw new Error(`event ${event.id}: its observation is missing`);
  return row;
}
