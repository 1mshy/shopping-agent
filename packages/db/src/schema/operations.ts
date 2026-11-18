// S§4.4 Operations: scheduling, harness runs, the outbox, channels, endpoints and settings.
import type {
  BudgetKind,
  ChannelType,
  CostSource,
  DeliveryOutcome,
  DeliveryState,
  JobRunStatus,
  LlmEndpointRole,
  MinorUnitCurrency,
  NotificationKind,
  Refusal,
  RunStatus,
  RunType,
} from '@agentic-dasher/shared';
import { sql } from 'drizzle-orm';
import {
  blob,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core';
import { listing, priceObservation } from './catalogue.ts';
import { watch } from './intent.ts';
import { feedCard } from './personalisation.ts';
import { id, profileId, timestamp } from './profile.ts';

export const job = sqliteTable(
  'job',
  {
    id: id(),
    name: text('name').notNull().unique(),
    cron: text('cron'),
    nextRunAt: timestamp('next_run_at'),
    deadlineMs: integer('deadline_ms').notNull(),
    /** Waits on the DNS gate before running (S§5.8). */
    networkGate: integer('network_gate', { mode: 'boolean' }).notNull(),
  },
  (t) => [index('job_next_run_idx').on(t.nextRunAt)],
);

export const jobRun = sqliteTable(
  'job_run',
  {
    id: id(),
    jobId: integer('job_id')
      .notNull()
      .references(() => job.id, { onDelete: 'cascade' }),
    status: text('status').$type<JobRunStatus>().notNull(),
    startedAt: timestamp('started_at').notNull(),
    endedAt: timestamp('ended_at'),
  },
  (t) => [index('job_run_job_started_idx').on(t.jobId, t.startedAt)],
);

/** Token usage columns; null is "not reported", never zero (S§4.4). */
const usage = () => ({
  inputTokens: integer('input_tokens'),
  cacheReadInputTokens: integer('cache_read_input_tokens'),
  cacheWriteInputTokens: integer('cache_write_input_tokens'),
  outputTokens: integer('output_tokens'),
  reasoningOutputTokens: integer('reasoning_output_tokens'),
});

/** RunRecord with its budget flattened: the spend cap is an INTEGER beside its currency. */
export const run = sqliteTable(
  'run',
  {
    id: id(),
    profileId: profileId(),
    type: text('type').$type<RunType>().notNull(),
    status: text('status').$type<RunStatus>().notNull(),
    startedAt: timestamp('started_at').notNull(),
    endedAt: timestamp('ended_at'),
    maxTurns: integer('max_turns').notNull(),
    deadlineMs: integer('deadline_ms').notNull(),
    maxInputTokens: integer('max_input_tokens').notNull(),
    maxSpendNanos: integer('max_spend_nanos').notNull(),
    spendCurrency: text('spend_currency').$type<MinorUnitCurrency>().notNull(),
    budgetHits: text('budget_hits_json', { mode: 'json' }).$type<BudgetKind[]>().notNull(),
    turns: integer('turns').notNull(),
    ...usage(),
    costSource: text('cost_source').$type<CostSource>().notNull(),
    /** Integer nano-units; null exactly when the source is `none`. */
    costNanos: integer('cost_nanos'),
    costCurrency: text('cost_currency').$type<MinorUnitCurrency>(),
  },
  (t) => [unique().on(t.id, t.profileId)],
);

/** RunStep: model-call columns are set exactly for `chat`, tool columns for `execute_tool`. */
export const runStep = sqliteTable(
  'run_step',
  {
    id: id(),
    runId: integer('run_id').notNull(),
    profileId: profileId(),
    index: integer('step_index').notNull(),
    operationName: text('operation_name').$type<'chat' | 'execute_tool'>().notNull(),
    startedAt: timestamp('started_at').notNull(),
    endedAt: timestamp('ended_at').notNull(),
    /** Trimmed to null after 14 days (S§5.14). */
    payload: text('payload_json', { mode: 'json' }),
    role: text('role').$type<LlmEndpointRole>(),
    promptVersion: text('prompt_version'),
    providerName: text('provider_name'),
    requestModel: text('request_model'),
    responseModel: text('response_model'),
    responseId: text('response_id'),
    finishReasons: text('finish_reasons_json', { mode: 'json' }).$type<string[]>(),
    ...usage(),
    costSource: text('cost_source').$type<CostSource>(),
    costNanos: integer('cost_nanos'),
    costCurrency: text('cost_currency').$type<MinorUnitCurrency>(),
    toolName: text('tool_name'),
    toolCallId: text('tool_call_id'),
    refusal: text('refusal_json', { mode: 'json' }).$type<Refusal>(),
  },
  (t) => [
    unique().on(t.runId, t.index),
    foreignKey({
      columns: [t.runId, t.profileId],
      foreignColumns: [run.id, run.profileId],
    }).onDelete('cascade'),
    index('run_step_payload_retention_idx').on(t.startedAt).where(sql`${t.payload} is not null`),
  ],
);

/** The outbox and audit trail (S§2.11): the migration's triggers refuse UPDATE, DELETE, REPLACE. */
export const notificationEvent = sqliteTable(
  'notification_event',
  {
    id: id(),
    profileId: profileId(),
    /** The stable event key (S§5.11). */
    key: text('key').notNull(),
    kind: text('kind').$type<NotificationKind>().notNull(),
    createdAt: timestamp('created_at').notNull(),
    watchId: integer('watch_id'),
    listingId: integer('listing_id').references(() => listing.id, { onDelete: 'restrict' }),
    observationId: integer('observation_id'),
    feedCardId: integer('feed_card_id'),
    runId: integer('run_id'),
    text: text('text'),
  },
  (t) => [
    unique().on(t.profileId, t.key),
    unique().on(t.id, t.profileId),
    foreignKey({
      columns: [t.watchId, t.profileId],
      foreignColumns: [watch.id, watch.profileId],
    }).onDelete('restrict'),
    /** An alert's observation is an observation of the alert's listing. */
    foreignKey({
      columns: [t.observationId, t.listingId],
      foreignColumns: [priceObservation.id, priceObservation.listingId],
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.feedCardId, t.profileId],
      foreignColumns: [feedCard.id, feedCard.profileId],
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.runId, t.profileId],
      foreignColumns: [run.id, run.profileId],
    }).onDelete('restrict'),
    index('notification_event_watch_idx').on(t.watchId),
    index('notification_event_listing_idx').on(t.listingId),
    index('notification_event_observation_idx').on(t.observationId),
    index('notification_event_feed_card_idx').on(t.feedCardId),
    index('notification_event_run_idx').on(t.runId),
  ],
);

/** Configuration as JSON; secrets (channel tokens) encrypted at rest (S§5.13). */
export const channel = sqliteTable(
  'channel',
  {
    id: id(),
    profileId: profileId(),
    type: text('type').$type<ChannelType>().notNull(),
    config: text('config_json', { mode: 'json' }).notNull(),
    secretEnc: blob('secret_enc', { mode: 'buffer' }),
  },
  (t) => [unique().on(t.id, t.profileId)],
);

/**
 * One event through one channel; only `accepted` carries `acceptedAt` (S§2.11). Its state changes
 * by UPDATE; the migration's triggers refuse DELETE, REPLACE and a change of its identity.
 */
export const delivery = sqliteTable(
  'delivery',
  {
    id: id(),
    profileId: profileId(),
    eventId: integer('event_id').notNull(),
    channelId: integer('channel_id').notNull(),
    state: text('state').$type<DeliveryState>().notNull(),
    attempts: integer('attempts').notNull(),
    outcome: text('outcome').$type<DeliveryOutcome>(),
    nextAttemptAt: timestamp('next_attempt_at'),
    acceptedAt: timestamp('accepted_at'),
  },
  (t) => [
    unique().on(t.eventId, t.channelId),
    foreignKey({
      columns: [t.eventId, t.profileId],
      foreignColumns: [notificationEvent.id, notificationEvent.profileId],
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.channelId, t.profileId],
      foreignColumns: [channel.id, channel.profileId],
    }).onDelete('restrict'),
    index('delivery_pending_idx').on(t.nextAttemptAt).where(sql`${t.state} = 'pending'`),
    index('delivery_channel_idx').on(t.channelId),
  ],
);

export const llmEndpoint = sqliteTable('llm_endpoint', {
  id: id(),
  baseUrl: text('base_url').notNull(),
  /** Encrypted at rest (S§5.13). */
  authEnc: blob('auth_enc', { mode: 'buffer' }),
  modelId: text('model_id').notNull(),
  role: text('role').$type<LlmEndpointRole>().notNull(),
  capabilities: text('capabilities_json', { mode: 'json' }),
});

/** A DB-held value: JSON, or encrypted when it is a secret; exactly one of the two. */
export const setting = sqliteTable('setting', {
  key: text('key').primaryKey(),
  value: text('value_json', { mode: 'json' }),
  valueEnc: blob('value_enc', { mode: 'buffer' }),
});
