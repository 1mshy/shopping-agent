import type { ChannelType } from '@agentic-dasher/shared';
import { inAppAdapter } from './in-app.ts';
import { ntfyAdapter } from './ntfy.ts';
import type { ChannelAdapter } from './types.ts';
import { webhookAdapter } from './webhook.ts';

export * from './types.ts';
export { WEBHOOK_SCHEMA, WEBHOOK_VERSION, webhookBody } from './webhook.ts';

/**
 * The adapters this build has. Web Push, Telegram and Discord are Phase 3: a channel of a type
 * with no adapter cannot be created, and a delivery to one is never attempted.
 */
// biome-ignore lint/suspicious/noExplicitAny: each adapter is called with its own validated config.
export const ADAPTERS: Partial<Record<ChannelType, ChannelAdapter<any>>> = {
  in_app: inAppAdapter,
  ntfy: ntfyAdapter,
  webhook: webhookAdapter,
};
