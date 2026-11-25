// Migration 0002: the state the Phase 1 units persist (per-host pacing, the scheduler, watches and
// sweeps, the store directory and trust, owner auth, channels). Realistic rows round-trip and parse
// with the vocabularies in @agentic-dasher/shared, every rule the SQL states refuses a row that
// breaks it, and the access paths the units rely on use their indexes.
import {
  Host,
  JobRunReason,
  JobRunStatus,
  ReadFailureCause,
  WatchLookupState,
} from '@agentic-dasher/shared';
import { eq, type SQL, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Database, schema } from '../src/index.ts';
import { migratedDb, refusal, rows, seed, T0, T1 } from './fixtures.ts';

const T2 = '2026-11-17T09:45:00.000Z';

let db: Database;
beforeEach(() => {
  db = migratedDb();
  seed(db);
});

const text = (value: string): SQL => sql`${value}`;

describe('round trip (0002)', () => {
  it('host_pacing, domain_registration and listing_check', () => {
    db.orm.insert(schema.hostPacing).values(rows.hostPacing).run();
    db.orm
      .insert(schema.domainRegistration)
      .values([
        rows.domainRegistration,
        // RDAP answered, with no registration date: kept, so it is not asked again.
        { domain: 'pasted.example', registeredAt: null, fetchedAt: T1 },
      ])
      .run();
    db.orm.insert(schema.listingCheck).values(rows.listingCheck).run();

    const [pacing] = db.orm.select().from(schema.hostPacing).all();
    expect(pacing).toEqual(rows.hostPacing);
    expect(Host.parse(pacing?.host)).toBe('shop.example.ca');
    expect(db.orm.select().from(schema.domainRegistration).all()).toEqual([
      rows.domainRegistration,
      { domain: 'pasted.example', registeredAt: null, fetchedAt: T1 },
    ]);
    expect(db.orm.select().from(schema.listingCheck).all()).toEqual([rows.listingCheck]);
  });

  it('listing_check during a run of failed reads, and for a listing no watch tracks', () => {
    db.orm
      .insert(schema.listingCheck)
      .values({ ...rows.listingCheck, firstErrorAt: T0, lastReadAt: T1, lastError: 'wall' })
      .run();
    db.orm
      .update(schema.listing)
      .set({ consecutiveErrors: 3 })
      .where(eq(schema.listing.id, 1))
      .run();
    const [check] = db.orm.select().from(schema.listingCheck).all();
    expect(ReadFailureCause.parse(check?.lastError)).toBe('wall');
    db.orm
      .update(schema.listingCheck)
      .set({ nextCheckAt: null })
      .where(eq(schema.listingCheck.listingId, 1))
      .run();
    expect(db.orm.select().from(schema.listingCheck).get()?.nextCheckAt).toBeNull();
  });

  it('job and job_run: the pending retry, what started the run and its detail', () => {
    db.orm
      .insert(schema.job)
      .values({ ...rows.job, retryAt: '2026-11-17T09:01:41.120Z' })
      .run();
    db.orm
      .insert(schema.jobRun)
      .values([
        rows.jobRun,
        {
          id: 2,
          jobId: 1,
          status: 'skipped',
          startedAt: '2026-11-17T09:30:00.000Z',
          endedAt: '2026-11-17T09:31:08.000Z',
          reason: 'slot',
          coalescedSlots: 3,
          detail: { gate: 'dns_unresolved' },
        },
        {
          id: 3,
          jobId: 1,
          status: 'running',
          startedAt: '2026-11-17T09:32:08.000Z',
          endedAt: null,
          reason: 'retry',
          coalescedSlots: 0,
          detail: null,
        },
      ])
      .run();
    const back = db.orm.select().from(schema.jobRun).all();
    expect(back[0]).toEqual(rows.jobRun);
    for (const run of back) {
      expect(JobRunReason.parse(run.reason)).toBe(run.reason);
      expect(JobRunStatus.parse(run.status)).toBe(run.status);
    }
    expect(db.orm.select().from(schema.job).get()?.retryAt).toBe('2026-11-17T09:01:41.120Z');
  });

  it('owner_password and session', () => {
    db.orm.insert(schema.ownerPassword).values(rows.ownerPassword).run();
    db.orm.insert(schema.session).values(rows.session).run();
    expect(db.orm.select().from(schema.ownerPassword).all()).toEqual([rows.ownerPassword]);
    expect(db.orm.select().from(schema.session).all()).toEqual([rows.session]);
    // Logging out deletes the session: it is not history.
    db.orm.delete(schema.session).where(eq(schema.session.id, 1)).run();
    expect(db.orm.select().from(schema.session).all()).toEqual([]);
  });

  it('the columns 0002 adds to store, watch and channel', () => {
    const [store] = db.orm.select().from(schema.store).all();
    expect(store).toEqual(rows.store);
    const [watch] = db.orm.select().from(schema.watch).all();
    expect(watch).toEqual(rows.watch);
    expect(WatchLookupState.parse(watch?.lookupState)).toBe('done');
    const [channel] = db.orm.select().from(schema.channel).all();
    expect(channel).toEqual(rows.channel);
  });
});

describe('rules SQL enforces (0002)', () => {
  const pacing = (p: Partial<typeof schema.hostPacing.$inferInsert>) => () =>
    db.orm
      .insert(schema.hostPacing)
      .values({ ...rows.hostPacing, ...p })
      .run();
  const registration = (r: Partial<typeof schema.domainRegistration.$inferInsert>) => () =>
    db.orm
      .insert(schema.domainRegistration)
      .values({ ...rows.domainRegistration, ...r })
      .run();
  const check = (c: Partial<typeof schema.listingCheck.$inferInsert>) => () =>
    db.orm
      .insert(schema.listingCheck)
      .values({ ...rows.listingCheck, ...c })
      .run();
  const store = (s: Partial<typeof schema.store.$inferInsert>) => () =>
    db.orm
      .insert(schema.store)
      .values({ ...rows.store, id: 2, host: 'other.example.ca', ...s })
      .run();
  const watch = (w: Partial<typeof schema.watch.$inferInsert>) => () =>
    db.orm
      .insert(schema.watch)
      .values({ ...rows.watch, id: 2, dedupeKey: 'query:second watch', ...w })
      .run();
  const queued = {
    lookupState: 'queued',
    lookupQueuedAt: T1,
    lookupDueAt: T1,
    lookupAttempts: 0,
  } as const;
  const job = (j: Partial<typeof schema.job.$inferInsert>) => () =>
    db.orm
      .insert(schema.job)
      .values({ ...rows.job, ...j })
      .run();
  const jobRun = (r: Record<string, unknown>) => () => {
    job({})();
    db.orm
      .insert(schema.jobRun)
      .values({ ...rows.jobRun, ...r } as typeof schema.jobRun.$inferInsert)
      .run();
  };
  const channel = (c: Partial<typeof schema.channel.$inferInsert>) => () =>
    db.orm
      .insert(schema.channel)
      .values({ ...rows.channel, id: 2, type: 'ntfy', ...c })
      .run();
  const password = (p: Partial<typeof schema.ownerPassword.$inferInsert>) => () =>
    db.orm
      .insert(schema.ownerPassword)
      .values({ ...rows.ownerPassword, ...p })
      .run();
  const session = (s: Partial<typeof schema.session.$inferInsert>) => () =>
    db.orm
      .insert(schema.session)
      .values({ ...rows.session, ...s })
      .run();

  const refusals: [string, () => unknown, RegExp][] = [
    // Per-host pacing (S§5.1)
    ['an upper-case pacing host', pacing({ host: 'Shop.example.ca' }), /host_pacing_host_lower/],
    ['an empty pacing host', pacing({ host: '' }), /host_pacing_host_lower/],
    [
      'a pacing time without milliseconds',
      pacing({ nextStartAt: '2026-11-17T09:30:02Z' }),
      /CHECK constraint failed: strftime/,
    ],
    [
      'a second pacing row for one host',
      () => {
        pacing({})();
        pacing({})();
      },
      /UNIQUE constraint failed: host_pacing.host/,
    ],
    // RDAP cache (S§5.5)
    [
      'an upper-case domain',
      registration({ domain: 'Example.ca' }),
      /domain_registration_domain_lower/,
    ],
    ['an empty domain', registration({ domain: '' }), /domain_registration_domain_lower/],
    [
      'a registration after it was fetched',
      registration({ registeredAt: '2026-11-18T00:00:00.000Z' }),
      /domain_registration_order/,
    ],
    [
      'a registration date SQLite cannot parse',
      registration({ registeredAt: '2004-03-11' }),
      /CHECK constraint failed: strftime/,
    ],
    // Per-listing scheduling and failed reads (S§5.8, S§2.10)
    ['a run of errors without its cause', check({ firstErrorAt: T0 }), /listing_check_errors/],
    ['a cause without a run of errors', check({ lastError: 'wall' }), /listing_check_errors/],
    [
      'a run of errors that began after the last read',
      check({ firstErrorAt: T2, lastError: 'wall' }),
      /listing_check_errors/,
    ],
    [
      'a run of errors with no read',
      check({ lastReadAt: null, firstErrorAt: T0, lastError: 'wall' }),
      /listing_check_errors/,
    ],
    [
      'an empty cause',
      check({ firstErrorAt: T0, lastError: '' as 'wall' }),
      /listing_check_errors/,
    ],
    [
      'a next check SQLite cannot parse',
      check({ nextCheckAt: 'in 30 minutes' }),
      /CHECK constraint failed: strftime/,
    ],
    ['a check of a listing that does not exist', check({ listingId: 99 }), /FOREIGN KEY/],
    // Store health (S§4.1)
    [
      'negative consecutive errors',
      store({ consecutiveErrors: -1 }),
      /CHECK constraint failed: consecutive_errors/,
    ],
    ['consecutive errors without a last error', store({ consecutiveErrors: 2 }), /store_health/],
    ['a last error without its time', store({ lastError: 'wall' }), /store_health/],
    ['a last error time without its cause', store({ lastErrorAt: T1 }), /store_health/],
    // Watch lifecycle and save-first intake (S§2.9, S§5.8)
    ['a queued lookup with no due time', watch({ ...queued, lookupDueAt: null }), /watch_lookup/],
    ['a due time on a lookup that is done', watch({ lookupDueAt: T1 }), /watch_lookup/],
    ['a failed lookup without its error', watch({ lookupState: 'failed' }), /watch_lookup/],
    ['a lookup state without its queue time', watch({ lookupQueuedAt: null }), /watch_lookup/],
    ['a lookup state without its attempts', watch({ lookupAttempts: null }), /watch_lookup/],
    ['an empty lookup error', watch({ lookupError: '' }), /watch_lookup/],
    [
      'negative lookup attempts',
      watch({ lookupAttempts: -1 }),
      /CHECK constraint failed: lookup_attempts/,
    ],
    ['an empty dedupe key', watch({ dedupeKey: '' }), /CHECK constraint failed: dedupe_key/],
    [
      'a pause time SQLite cannot parse',
      watch({ pausedAt: 'yesterday' }),
      /CHECK constraint failed: strftime/,
    ],
    [
      'a restock rule time SQLite cannot parse',
      watch({ restockEnabledAt: '' }),
      /CHECK constraint failed: strftime/,
    ],
    [
      'a new watch without its dedupe key',
      watch({ dedupeKey: null }),
      /a new watch has its dedupe key and lookup state/,
    ],
    [
      'a new watch without its lookup state',
      watch({ lookupState: null, lookupQueuedAt: null, lookupAttempts: null }),
      /a new watch has its dedupe key and lookup state/,
    ],
    // Scheduler (S§5.8)
    [
      'a retry time SQLite cannot parse',
      job({ retryAt: 'in 60 s' }),
      /CHECK constraint failed: strftime/,
    ],
    ['a running job run with an end', jobRun({ status: 'running' }), /job_run_ended_when_finished/],
    ['a finished job run without an end', jobRun({ endedAt: null }), /job_run_ended_when_finished/],
    ['a reason without coalesced slots', jobRun({ coalescedSlots: null }), /job_run_reason/],
    ['coalesced slots without a reason', jobRun({ reason: null }), /job_run_reason/],
    ['negative coalesced slots', jobRun({ coalescedSlots: -1 }), /job_run_reason/],
    [
      'a job run detail that is not an object',
      jobRun({ detail: ['wall'] }),
      /CHECK constraint failed: detail_json/,
    ],
    [
      'JSON5 in a job run detail',
      jobRun({ detail: text('{failed: 1}') }),
      /CHECK constraint failed: detail_json|malformed JSON/,
    ],
    // Channels (S§5.11)
    ['an empty channel name', channel({ name: '' }), /CHECK constraint failed: name/],
    [
      'a removal time SQLite cannot parse',
      channel({ removedAt: '2026-11-17' }),
      /CHECK constraint failed: strftime/,
    ],
    // Owner auth (S§5.13)
    [
      'a password that is not an argon2 PHC string',
      password({ passwordHash: 'hunter2' }),
      /owner_password_phc/,
    ],
    [
      'a second password for one profile',
      () => {
        password({})();
        password({})();
      },
      /UNIQUE constraint failed: owner_password.profile_id/,
    ],
    ['a password of a profile that does not exist', password({ profileId: 9 }), /FOREIGN KEY/],
    [
      'a session token stored in clear',
      session({ tokenHash: 'kq2b-7Zx_session-cookie-value' }),
      /session_token_hash/,
    ],
    [
      'a token hash in upper case',
      session({ tokenHash: rows.session.tokenHash.toUpperCase() }),
      /session_token_hash/,
    ],
    [
      'a token hash of the wrong length',
      session({ tokenHash: rows.session.tokenHash.slice(2) }),
      /session_token_hash/,
    ],
    ['a session expiring when it starts', session({ expiresAt: T0 }), /session_order/],
    [
      'a session seen before it started',
      session({ lastSeenAt: '2026-11-17T08:59:59.999Z' }),
      /session_order/,
    ],
    [
      'two sessions with one token',
      () => {
        session({})();
        session({ id: 2 })();
      },
      /UNIQUE constraint failed: session.token_hash/,
    ],
    ['a session of a profile that does not exist', session({ profileId: 9 }), /FOREIGN KEY/],
  ];

  it.each(refusals)('refuses %s', (_, act, message) => {
    expect(refusal(act)).toMatch(message);
  });

  it('accepts the lookup states a watch moves through', () => {
    watch(queued)();
    const where = eq(schema.watch.id, 2);
    db.orm
      .update(schema.watch)
      .set({ lookupAttempts: 1, lookupDueAt: T2, lookupError: 'network_error' })
      .where(where)
      .run();
    db.orm
      .update(schema.watch)
      .set({ lookupState: 'failed', lookupDueAt: null, lookupError: 'not_a_shop' })
      .where(where)
      .run();
    db.orm
      .update(schema.watch)
      .set({ ...queued, lookupQueuedAt: T2, lookupDueAt: T2, lookupError: null })
      .where(where)
      .run();
    db.orm
      .update(schema.watch)
      .set({ lookupState: 'done', lookupDueAt: null, lookupAttempts: 1 })
      .where(where)
      .run();
    expect(db.orm.select().from(schema.watch).where(where).get()?.lookupState).toBe('done');
  });
});

describe('the overlap lock: at most one open run per job (S§5.8)', () => {
  const open = (id: number, jobId = 1) =>
    db.orm
      .insert(schema.jobRun)
      .values({
        ...rows.jobRun,
        id,
        jobId,
        status: 'running',
        startedAt: T1,
        endedAt: null,
      })
      .run();

  beforeEach(() => {
    db.orm.insert(schema.job).values(rows.job).run();
    db.orm
      .insert(schema.job)
      .values({ ...rows.job, id: 2, name: 'outbox' })
      .run();
  });

  it('refuses a second open run of a job, so a second caller joins the first', () => {
    open(1);
    expect(refusal(() => open(2))).toMatch(/UNIQUE constraint failed: job_run.job_id/);
    const holder = db.orm.get<{ id: number }>(
      sql`select id from job_run where job_id = 1 and ended_at is null`,
    );
    expect(holder).toEqual({ id: 1 });
  });

  it('lets another job run meanwhile, and the next run start once the first has ended', () => {
    open(1);
    open(2, 2);
    db.orm
      .update(schema.jobRun)
      .set({ status: 'timed_out', endedAt: T2 })
      .where(eq(schema.jobRun.id, 1))
      .run();
    open(3);
    expect(
      db.orm.all<{ id: number }>(sql`select id from job_run where ended_at is null order by id`),
    ).toEqual([{ id: 2 }, { id: 3 }]);
  });
});

describe('watch dedupe key and lifecycle (S§5.8 intake)', () => {
  const second = (w: Partial<typeof schema.watch.$inferInsert> = {}) =>
    db.orm
      .insert(schema.watch)
      .values({ ...rows.watch, id: 2, ...w })
      .run();
  const where = eq(schema.watch.id, 1);

  it('refuses a second watch with the same key in a profile, also while the first is paused', () => {
    expect(refusal(() => second())).toMatch(
      /UNIQUE constraint failed: watch.profile_id, watch.dedupe_key/,
    );
    db.orm.update(schema.watch).set({ pausedAt: T1 }).where(where).run();
    expect(refusal(() => second())).toMatch(/UNIQUE constraint failed/);
  });

  it('accepts the key again once the first watch is archived, and in another profile', () => {
    second({ id: 3, profileId: 2 });
    db.orm.update(schema.watch).set({ archivedAt: T1 }).where(where).run();
    second();
    expect(db.orm.select().from(schema.watch).all()).toHaveLength(3);
  });

  it('archives a watch that alerted, which RESTRICT keeps from being deleted', () => {
    db.orm.insert(schema.notificationEvent).values(rows.priceDrop).run();
    expect(refusal(() => db.orm.delete(schema.watch).where(where).run())).toMatch(
      /FOREIGN KEY constraint failed/,
    );
    db.orm.update(schema.watch).set({ archivedAt: T2 }).where(where).run();
    expect(db.orm.select().from(schema.watch).get()?.archivedAt).toBe(T2);
  });
});

describe('channel removal (S§5.11)', () => {
  it('removes a channel with deliveries by removed_at; its deliveries keep accepted_at', () => {
    db.orm.insert(schema.notificationEvent).values(rows.priceDrop).run();
    db.orm
      .insert(schema.delivery)
      .values({
        ...rows.pendingDelivery,
        state: 'accepted',
        attempts: 1,
        outcome: 'accepted',
        nextAttemptAt: null,
        acceptedAt: T1,
      })
      .run();
    const where = eq(schema.channel.id, 1);
    expect(refusal(() => db.orm.delete(schema.channel).where(where).run())).toMatch(
      /FOREIGN KEY constraint failed/,
    );
    db.orm.update(schema.channel).set({ disabledAt: T1, removedAt: T2 }).where(where).run();
    expect(db.orm.select().from(schema.channel).get()?.removedAt).toBe(T2);
    expect(db.orm.select().from(schema.delivery).get()?.acceptedAt).toBe(T1);
  });
});

// The last accepted alert of a watch is read from the outbox, never stamped on the watch (S§2.11):
// the earliest push acceptance of each of the watch's events of a kind, or the in-app acceptance of
// an event that has no push delivery (alert-delivery-gating), and the price from the observation
// the event names. Query helpers are the units'; this query shows the schema answers it.
const LAST_ACCEPTED = sql`
  select e.id as eventId, o.effective as price, o.currency as currency,
    min(d.accepted_at) as acceptedAt
  from notification_event e
  join delivery d on d.event_id = e.id and d.state = 'accepted'
  join channel c on c.id = d.channel_id
  join price_observation o on o.id = e.observation_id
  where e.watch_id = ${1} and e.kind = ${'price_drop'}
    and (c.type <> 'in_app' or not exists (
      select 1 from delivery p join channel pc on pc.id = p.channel_id
      where p.event_id = e.id and pc.type <> 'in_app'))
  group by e.id
  order by acceptedAt desc
  limit 1`;

describe('the last accepted alert, read from the outbox (S§2.11)', () => {
  const accept = (id: number, at: string) =>
    db.orm
      .update(schema.delivery)
      .set({
        state: 'accepted',
        attempts: 1,
        outcome: 'accepted',
        nextAttemptAt: null,
        acceptedAt: at,
      })
      .where(eq(schema.delivery.id, id))
      .run();

  beforeEach(() => {
    db.orm
      .insert(schema.channel)
      .values({ ...rows.channel, id: 2, type: 'ntfy', name: 'Phone' })
      .run();
    db.orm.insert(schema.notificationEvent).values(rows.priceDrop).run();
    db.orm
      .insert(schema.delivery)
      .values([rows.pendingDelivery, { ...rows.pendingDelivery, id: 2, channelId: 2 }])
      .run();
  });

  it('is none while only the in-app channel accepted and a push channel is pending', () => {
    accept(1, T1);
    expect(db.orm.all(LAST_ACCEPTED)).toEqual([]);
  });

  it('is the push acceptance, with the price of the observation the alert names', () => {
    accept(1, T1);
    accept(2, T2);
    expect(db.orm.all(LAST_ACCEPTED)).toEqual([
      { eventId: 1, price: 44999, currency: 'CAD', acceptedAt: T2 },
    ]);
  });

  it('is the in-app acceptance of an event with no push delivery', () => {
    db.orm
      .insert(schema.notificationEvent)
      .values({ ...rows.priceDrop, id: 2, key: 'price_drop:watch:1:observation:1:again' })
      .run();
    db.orm
      .insert(schema.delivery)
      .values({ ...rows.pendingDelivery, id: 3, eventId: 2 })
      .run();
    accept(3, T2);
    expect(db.orm.all(LAST_ACCEPTED)).toEqual([
      { eventId: 2, price: 44999, currency: 'CAD', acceptedAt: T2 },
    ]);
  });
});

describe('access paths use their indexes', () => {
  const plan = (query: SQL) =>
    db.orm
      .all<{ detail: string }>(sql`explain query plan ${query}`)
      .map((r) => r.detail)
      .join('\n');

  it.each([
    [
      'listings due now',
      sql`select listing_id from listing_check where next_check_at <= ${T1} order by next_check_at`,
      /USING (COVERING )?INDEX listing_check_due_idx/,
    ],
    [
      'watch lookups due now',
      sql`select id from watch where lookup_due_at <= ${T1}`,
      /USING (COVERING )?INDEX watch_lookup_due_idx/,
    ],
    [
      'the open run of a job (the lock holder)',
      sql`select id from job_run where job_id = ${1} and ended_at is null`,
      /USING (COVERING )?INDEX job_run_open_idx/,
    ],
    [
      'a session by its token hash',
      sql`select profile_id from session where token_hash = ${rows.session.tokenHash}`,
      /USING (COVERING )?INDEX sqlite_autoindex_session_1/,
    ],
    [
      'a watch by its dedupe key',
      sql`select id from watch where profile_id = ${1} and dedupe_key = ${'query:x'} and archived_at is null`,
      /USING (COVERING )?INDEX watch_dedupe_key_idx/,
    ],
    [
      "a watch's alerts of one kind, newest first",
      sql`select id from notification_event where watch_id = ${1} and kind = ${'price_drop'} order by created_at desc`,
      /USING (COVERING )?INDEX notification_event_watch_kind_idx/,
    ],
  ])('%s', (_, query, index) => {
    expect(plan(query)).toMatch(index);
  });

  it("walks a watch's events by index and their deliveries by the outbox key", () => {
    const detail = plan(LAST_ACCEPTED);
    expect(detail).toMatch(/notification_event_watch_kind_idx/);
    expect(detail).toMatch(/sqlite_autoindex_delivery_1/);
    expect(detail).not.toMatch(/SCAN e\b|SCAN notification_event/);
  });
});
