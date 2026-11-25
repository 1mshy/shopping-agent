// What each channel type stores in channel.config_json (validated on every write and every read),
// and what its secret is. Secrets never go in config_json: they are encrypted into
// channel.secret_enc (S§5.13).
import { z } from 'zod';

/**
 * An http(s) URL the owner typed. Credentials in the URL are refused (they belong in the secret,
 * where they are encrypted and never returned); so is a fragment. LAN and loopback hosts are
 * allowed on purpose: see adapters/http.ts.
 */
export const TargetUrl = z
  .string()
  .max(2048)
  .refine((text) => {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return false;
    }
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === '' &&
      url.hash === ''
    );
  }, 'an http or https URL without credentials or a fragment');

export const InAppConfig = z.strictObject({});
export type InAppConfig = z.infer<typeof InAppConfig>;

/** ntfy (https://docs.ntfy.sh/publish/): a server and a topic; the access token is the secret. */
export const NtfyConfig = z.strictObject({
  /** The server's base URL, for example `http://192.168.1.20:8090` or `https://ntfy.example.org`. */
  serverUrl: TargetUrl,
  /** ntfy's topic rule: letters, digits, `-` and `_`, at most 64. */
  topic: z.string().regex(/^[-_A-Za-z0-9]{1,64}$/, 'letters, digits, - and _ (at most 64)'),
  /** 1 (min) to 5 (max). When absent, listing alerts go at 4 and everything else at 3. */
  priority: z.int().min(1).max(5).optional(),
});
export type NtfyConfig = z.infer<typeof NtfyConfig>;

/** Headers the webhook request sets itself; the secret header may not replace one. */
const RESERVED_HEADERS = new Set([
  'content-type',
  'content-length',
  'host',
  'connection',
  'transfer-encoding',
  'idempotency-key',
]);

/** An HTTP header name (RFC 9110 token), not one the request sets itself. */
const HeaderName = z
  .string()
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/, 'an HTTP header name')
  .refine((name) => !RESERVED_HEADERS.has(name.toLowerCase()), 'a header the request sets itself');

/** A generic webhook: a URL that receives the versioned JSON body of webhook.ts. */
export const WebhookConfig = z.strictObject({
  url: TargetUrl,
  /** The header that carries the secret, when one is set. */
  secretHeader: HeaderName.default('X-Agentic-Dasher-Secret'),
});
export type WebhookConfig = z.infer<typeof WebhookConfig>;

/**
 * A channel secret as the owner types it: visible ASCII only, so it can travel in a header and
 * cannot inject one (no CR, LF or other control character).
 */
export const ChannelSecret = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^[\x21-\x7e]+$/, 'visible ASCII characters only');

/** The channel types this build can create, with their config schema. */
export const CONFIG_SCHEMAS = {
  in_app: InAppConfig,
  ntfy: NtfyConfig,
  webhook: WebhookConfig,
} as const;

export type CreatableType = keyof typeof CONFIG_SCHEMAS;

export function isBuiltType(type: string): type is CreatableType {
  return Object.hasOwn(CONFIG_SCHEMAS, type);
}
