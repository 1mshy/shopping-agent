// S§4.3 Personalisation: the tables feed v1 (Phase 3) needs, with only the columns the spec
// states. Their other columns, and profile_fact, profile_constraint, topic, owned_item, purchase
// and import_batch, belong to Phases 3 and 4. deal_feed_item is catalogue data (catalogue.ts).
import type { EventKind } from '@agentic-dasher/shared';
import { sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { id, profileId, timestamp } from './profile.ts';

/** In-app behaviour. Append-only: the migration's trigger refuses UPDATE; DELETE is allowed. */
export const event = sqliteTable('event', {
  id: id(),
  profileId: profileId(),
  kind: text('kind').$type<EventKind>().notNull(),
  createdAt: timestamp('created_at').notNull(),
});

/** Generator output (S§4.3); "≤4 per generator" and per-generator acceptance (S§5.10). */
export const candidate = sqliteTable('candidate', {
  id: id(),
  profileId: profileId(),
  generator: text('generator').notNull(),
});

/** An assembled card; "each card stores its evidence for 'because you…'" (S§4.3). */
export const feedCard = sqliteTable(
  'feed_card',
  {
    id: id(),
    profileId: profileId(),
    evidence: text('evidence_json', { mode: 'json' }).notNull(),
  },
  (t) => [unique().on(t.id, t.profileId)],
);
