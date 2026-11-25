// From a channel row to what its adapter needs: the validated config and the decrypted secret.
import type { SecretBox } from '../secrets/index.ts';
import { ADAPTERS, type ChannelAdapter, type ChannelTarget } from './adapters/index.ts';
import { CONFIG_SCHEMAS, isBuiltType } from './config.ts';
import type { ChannelRow } from './store.ts';

/** The associated data a channel's secret is bound to: it decrypts in this row only. */
export function secretContext(channelId: number): string {
  return `channel:${channelId}:secret`;
}

export type ResolvedTarget =
  | { readonly ok: true; readonly adapter: ChannelAdapter; readonly target: ChannelTarget }
  /** The channel cannot be sent through now; `reason` never carries a secret. */
  | { readonly ok: false; readonly reason: string };

export function resolveTarget(row: ChannelRow, secrets: SecretBox): ResolvedTarget {
  const adapter = ADAPTERS[row.type];
  if (adapter === undefined || !isBuiltType(row.type)) {
    return { ok: false, reason: `channel type ${row.type} is not available in this build` };
  }
  const config = CONFIG_SCHEMAS[row.type].safeParse(row.config);
  if (!config.success) return { ok: false, reason: 'the channel configuration is not valid' };
  let secret: string | null = null;
  if (row.secretEnc !== null) {
    try {
      secret = secrets.decryptString(row.secretEnc, secretContext(row.id));
    } catch {
      return {
        ok: false,
        reason:
          'the channel secret could not be decrypted (was the secret key changed?); enter it again',
      };
    }
  }
  return {
    ok: true,
    adapter,
    target: { id: row.id, type: row.type, config: config.data, secret },
  };
}
