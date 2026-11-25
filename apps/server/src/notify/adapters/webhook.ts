// The generic webhook (S§5.11): one POST of a versioned JSON body. 2xx is acceptance.
//
// Body, version 1 (a receiver should check `schema` and `version`, and ignore keys it does not
// know; a later version adds keys or bumps `version`):
//
//   {
//     "schema": "agentic-dasher.notification",
//     "version": 1,
//     "test": false,                       // true for a Test button send
//     "event": { "key": "price_drop:watch:1:observation:9", "kind": "price_drop",
//                "createdAt": "2026-11-17T09:30:00.000Z" },
//     "title": "Price drop: Sony WH-1000XM5 …",
//     "text": "…plain text, the same as the push body…",
//     "url": "https://shop.example.ca/products/…" | null,
//     "alert": {                           // null unless kind is price_drop, restock, new_listing
//       "watchId": 1, "listingId": 1, "observationId": 9,
//       "listingTitle": "…", "storeHost": "shop.example.ca",
//       "price": { "amountMinor": 44999, "currency": "CAD" } | null,
//       "sticker": { "amountMinor": 49999, "currency": "CAD" } | null,
//       "labels": ["caution" | "unconfirmed", …]
//     }
//   }
//
// Amounts are integer minor units with their ISO 4217 currency, never converted (S§2.2).
// Headers: `Content-Type: application/json`; `Idempotency-Key: <event key>:<channel id>`, stable
// across retries, because delivery is at least once and a receiver may see a message twice; the
// secret, when one is set, in the configured header (default `X-Agentic-Dasher-Secret`).
import type { WebhookConfig } from '../config.ts';
import { postOnce } from './http.ts';
import type { ChannelAdapter, NotifyMessage } from './types.ts';

export const WEBHOOK_SCHEMA = 'agentic-dasher.notification';
export const WEBHOOK_VERSION = 1;

export function webhookBody(message: NotifyMessage): Record<string, unknown> {
  const a = message.alert;
  return {
    schema: WEBHOOK_SCHEMA,
    version: WEBHOOK_VERSION,
    test: message.kind === 'test',
    event: { key: message.eventKey, kind: message.kind, createdAt: message.createdAt },
    title: message.title,
    text: message.body,
    url: message.url,
    alert:
      a === null
        ? null
        : {
            watchId: a.watchId,
            listingId: a.listingId,
            observationId: a.observationId,
            listingTitle: a.listingTitle,
            storeHost: a.storeHost,
            price: a.price,
            sticker: a.sticker,
            labels: a.labels,
          },
  };
}

export const webhookAdapter: ChannelAdapter<WebhookConfig> = {
  type: 'webhook',
  send(message, target, context) {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'idempotency-key': `${message.eventKey}:${target.id}`,
    };
    if (target.secret !== null) headers[target.config.secretHeader.toLowerCase()] = target.secret;
    // The target is the owner's configured URL (see http.ts), never a URL from the message.
    return postOnce(
      {
        url: target.config.url,
        headers,
        body: JSON.stringify(webhookBody(message)),
        secrets: [target.secret],
      },
      context,
    );
  },
};
