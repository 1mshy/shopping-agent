// Channel management (S§5.11, S§5.13, S§5.15): a human-only door. These functions are called only
// from the owner's session (routes.ts) and never from a run or a tool, so no text read from the web
// can create a channel or change its target (S§2.7).
//
// Secrets: a channel's token is encrypted into channel.secret_enc, bound to the channel's id, and
// never written to config_json. No function here returns it: a view says only whether one is set.
// Errors name the field that failed, never its value.
//
// Removing a channel sets removed_at (a channel with deliveries cannot be deleted: they keep
// accepted_at, S§2.11). Disabling sets disabled_at. Either way the channel's still-pending
// deliveries are parked (store.ts PARKED_AT): never sent later, left out of the gating status.
// Enabling a channel again does not revive them; it gets the events recorded from then on.
import { type Database, schema } from '@agentic-dasher/db';
import { CHANNEL_TYPES, type ChannelType } from '@agentic-dasher/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { SecretBox } from '../secrets/index.ts';
import type { ChannelOutcome } from './adapters/index.ts';
import { ChannelSecret, CONFIG_SCHEMAS, isBuiltType } from './config.ts';
import { testMessage } from './message.ts';
import { DEFAULT_REQUEST_TIMEOUT_MS } from './outbox.ts';
import { type ChannelRow, ensureInAppChannel, immediate, iso, PARKED_AT } from './store.ts';
import { resolveTarget, secretContext } from './target.ts';

/** A channel as list and get return it. Never the secret. */
export interface ChannelView {
  readonly id: number;
  readonly type: ChannelType;
  readonly name: string;
  readonly config: Record<string, unknown>;
  /** Whether a secret is stored; the secret itself is never returned. */
  readonly hasSecret: boolean;
  readonly enabled: boolean;
  readonly createdAt: string | null;
  readonly disabledAt: string | null;
  readonly removedAt: string | null;
}

export type ChannelErrorCode =
  | 'invalid'
  | 'not_found'
  | 'not_available'
  | 'in_app_fixed'
  | 'removed';

/** A refusal of the channel service. Its message and fields never carry a submitted value. */
export class ChannelError extends Error {
  override name = 'ChannelError';
  readonly code: ChannelErrorCode;
  /** The fields that failed validation (paths only). */
  readonly fields: readonly string[];
  constructor(code: ChannelErrorCode, message: string, fields: readonly string[] = []) {
    super(message);
    this.code = code;
    this.fields = fields;
  }
}

export interface ChannelServiceDeps {
  readonly db: Database;
  readonly secrets: SecretBox;
  /** Epoch milliseconds. */
  readonly now: () => number;
  /** For Test sends; the platform fetch by default. */
  readonly fetch?: typeof fetch;
  readonly requestTimeoutMs?: number;
}

const Name = z.string().trim().min(1).max(80);

/** What create takes. `secret` is the ntfy access token or the webhook secret. */
export const CreateChannelInput = z.strictObject({
  type: z.enum(CHANNEL_TYPES),
  name: Name,
  config: z.record(z.string(), z.unknown()).default({}),
  secret: ChannelSecret.optional(),
});
export type CreateChannelInput = z.input<typeof CreateChannelInput>;

/** What update takes: a field left out is kept; `secret: null` clears the secret. */
export const UpdateChannelInput = z.strictObject({
  name: Name.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  secret: ChannelSecret.nullable().optional(),
});
export type UpdateChannelInput = z.input<typeof UpdateChannelInput>;

function invalid(error: z.ZodError, prefix = ''): ChannelError {
  const fields = [...new Set(error.issues.map((i) => prefix + i.path.join('.')))];
  return new ChannelError(
    'invalid',
    `invalid channel fields: ${fields.join(', ') || '(input)'}`,
    fields,
  );
}

function view(row: ChannelRow): ChannelView {
  return {
    id: row.id,
    type: row.type,
    name: row.name ?? row.type,
    config: (row.config ?? {}) as Record<string, unknown>,
    hasSecret: row.secretEnc !== null,
    enabled: row.disabledAt === null && row.removedAt === null,
    createdAt: row.createdAt,
    disabledAt: row.disabledAt,
    removedAt: row.removedAt,
  };
}

function validConfig(type: ChannelType, config: unknown): Record<string, unknown> {
  if (!isBuiltType(type)) {
    throw new ChannelError('not_available', `channel type ${type} is not available yet`);
  }
  const parsed = CONFIG_SCHEMAS[type].safeParse(config);
  if (!parsed.success) throw invalid(parsed.error, 'config.');
  return parsed.data;
}

/** The channel service over one database. */
export function createChannelService(deps: ChannelServiceDeps) {
  const { db, secrets } = deps;
  const { channel, delivery } = schema;

  function row(profileId: number, id: number): ChannelRow {
    const found = db.orm
      .select()
      .from(channel)
      .where(and(eq(channel.id, id), eq(channel.profileId, profileId)))
      .get();
    if (found === undefined) throw new ChannelError('not_found', `channel ${id} not found`);
    return found;
  }

  function live(profileId: number, id: number): ChannelRow {
    const found = row(profileId, id);
    if (found.removedAt !== null) throw new ChannelError('removed', `channel ${id} was removed`);
    return found;
  }

  /** Parks the channel's pending deliveries: never attempted again (store.ts PARKED_AT). */
  function park(channelId: number): void {
    db.orm
      .update(delivery)
      .set({ nextAttemptAt: PARKED_AT })
      .where(and(eq(delivery.channelId, channelId), eq(delivery.state, 'pending')))
      .run();
  }

  return {
    /** Every channel of the profile, the in-app one created when missing; removed ones on request. */
    list(profileId: number, options: { includeRemoved?: boolean } = {}): ChannelView[] {
      immediate(db, () => ensureInAppChannel(db, profileId, iso(deps.now())));
      const rows = db.orm
        .select()
        .from(channel)
        .where(
          options.includeRemoved
            ? eq(channel.profileId, profileId)
            : and(eq(channel.profileId, profileId), isNull(channel.removedAt)),
        )
        .orderBy(asc(channel.id))
        .all();
      return rows.map(view);
    },

    get(profileId: number, id: number): ChannelView {
      return view(row(profileId, id));
    },

    create(profileId: number, input: CreateChannelInput): ChannelView {
      const parsed = CreateChannelInput.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error);
      const { type, name, secret } = parsed.data;
      if (type === 'in_app') {
        throw new ChannelError(
          'in_app_fixed',
          'the in-app channel always exists and is not created',
        );
      }
      const config = validConfig(type, parsed.data.config);
      return immediate(db, () => {
        const created = db.orm
          .insert(channel)
          .values({
            profileId,
            type,
            config,
            secretEnc: null,
            name,
            createdAt: iso(deps.now()),
            disabledAt: null,
            removedAt: null,
          })
          .returning()
          .get();
        if (secret === undefined) return view(created);
        const withSecret = db.orm
          .update(channel)
          .set({ secretEnc: secrets.encrypt(secret, secretContext(created.id)) })
          .where(eq(channel.id, created.id))
          .returning()
          .get();
        return view(withSecret ?? created);
      });
    },

    update(profileId: number, id: number, input: UpdateChannelInput): ChannelView {
      const parsed = UpdateChannelInput.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error);
      const current = live(profileId, id);
      const patch: Partial<typeof channel.$inferInsert> = {};
      if (parsed.data.name !== undefined) patch.name = parsed.data.name;
      if (parsed.data.config !== undefined) {
        if (current.type === 'in_app') {
          throw new ChannelError('in_app_fixed', 'the in-app channel has no configuration');
        }
        patch.config = validConfig(current.type, parsed.data.config);
      }
      if (parsed.data.secret !== undefined) {
        if (current.type === 'in_app') {
          throw new ChannelError('in_app_fixed', 'the in-app channel has no secret');
        }
        patch.secretEnc =
          parsed.data.secret === null
            ? null
            : secrets.encrypt(parsed.data.secret, secretContext(id));
      }
      if (Object.keys(patch).length === 0) return view(current);
      const updated = db.orm.update(channel).set(patch).where(eq(channel.id, id)).returning().get();
      return view(updated ?? current);
    },

    /** Switches a channel off or on. Off parks its pending deliveries; on does not revive them. */
    setEnabled(profileId: number, id: number, enabled: boolean): ChannelView {
      return immediate(db, () => {
        const current = live(profileId, id);
        if (current.type === 'in_app') {
          throw new ChannelError('in_app_fixed', 'the in-app channel is always on');
        }
        if (enabled === (current.disabledAt === null)) return view(current);
        if (!enabled) park(id);
        const updated = db.orm
          .update(channel)
          .set({ disabledAt: enabled ? null : iso(deps.now()) })
          .where(eq(channel.id, id))
          .returning()
          .get();
        return view(updated ?? current);
      });
    },

    /** Soft removal (removed_at). Its deliveries are kept; the pending ones are parked. */
    remove(profileId: number, id: number): ChannelView {
      return immediate(db, () => {
        const current = row(profileId, id);
        if (current.type === 'in_app') {
          throw new ChannelError('in_app_fixed', 'the in-app channel cannot be removed');
        }
        if (current.removedAt !== null) return view(current);
        park(id);
        const updated = db.orm
          .update(channel)
          .set({ removedAt: iso(deps.now()) })
          .where(eq(channel.id, id))
          .returning()
          .get();
        return view(updated ?? current);
      });
    },

    /**
     * The Test button (S§5.11): one clearly-labelled message straight through the adapter, one
     * attempt, no retry, nothing written. Works on a disabled channel too (to check it before
     * switching it on), not on a removed one.
     */
    async test(
      profileId: number,
      id: number,
      options: { signal?: AbortSignal } = {},
    ): Promise<ChannelOutcome> {
      const current = live(profileId, id);
      const resolved = resolveTarget(current, secrets);
      if (!resolved.ok) throw new ChannelError('not_available', resolved.reason);
      return resolved.adapter.send(
        testMessage(current.name ?? current.type, iso(deps.now())),
        resolved.target,
        {
          signal: options.signal ?? new AbortController().signal,
          timeoutMs: deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
          fetch: deps.fetch ?? globalThis.fetch,
        },
      );
    },
  };
}

export type ChannelService = ReturnType<typeof createChannelService>;
