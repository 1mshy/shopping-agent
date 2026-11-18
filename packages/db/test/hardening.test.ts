// Inputs the first review got past migration 0001: text SQLite cannot parse as a time, JSON5,
// REPLACE routes around the append-only triggers, integers JavaScript cannot read back, and the
// outbox audit trail. Each rule here is enforced by the schema itself, whatever the connection.
import { eq, type SQL, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Database, openDatabase, schema } from '../src/index.ts';
import { migratedDb, refusal, rows, seed, T1 } from './fixtures.ts';

let db: Database;
beforeEach(() => {
  db = migratedDb();
  seed(db);
});

const MAX_SAFE = '9007199254740991';
const TOO_BIG = '9007199254740992';

const observation = (o: Partial<Record<keyof typeof rows.observation, unknown>>) => () =>
  db.orm
    .insert(schema.priceObservation)
    .values({ ...rows.observation, id: 2, ...o } as typeof schema.priceObservation.$inferInsert)
    .run();

const text = (value: string): SQL => sql`${value}`;

describe('timestamps SQLite cannot parse (item 1)', () => {
  // strftime() returns NULL for each of these; `strftime(...) = x` was then NULL, and a NULL
  // CHECK passes. String(new Date()) is the realistic writer bug.
  const unparseable = [
    'yesterday',
    '',
    'not a date',
    '9/11/2026',
    '2026-11-17T23:59:60.000Z',
    '2026-11-17t09:30:00.000Z',
    '2026-11-17T09:30:00.000z',
    'Tue Nov 17 2026 09:30:00 GMT+0000 (Coordinated Universal Time)',
  ];

  it.each(unparseable)('refuses %j in a NOT NULL timestamp', (value) => {
    expect(refusal(observation({ observedAt: value }))).toMatch(
      /CHECK constraint failed: strftime/,
    );
  });

  it.each(unparseable)('refuses %j in a nullable timestamp', (value) => {
    const act = () =>
      db.orm
        .insert(schema.listing)
        .values({
          ...rows.listing,
          id: 2,
          urlCanonical: 'https://shop.example.ca/p/2',
          goneAt: value,
        })
        .run();
    expect(refusal(act)).toMatch(/CHECK constraint failed: strftime/);
  });

  it('refuses one in the migration ledger', () => {
    const act = () =>
      db.exec(
        "INSERT INTO schema_migration (version, name, checksum, applied_at) VALUES (99, 'x', 'x', 'yesterday')",
      );
    expect(refusal(act)).toMatch(/CHECK constraint failed: strftime/);
  });
});

describe('JSON5 and other non-RFC JSON (item 2)', () => {
  // json_type() accepts JSON5 and json_valid() does not; Drizzle's JSON.parse would then throw on
  // every read of the row.
  const cases: [string, () => unknown][] = [
    ['a trailing comma in an array', observation({ missingComponents: text('["tax",]') })],
    [
      'a trailing comma in raw candidates',
      observation({ rawCandidates: text('[{"method":"json_ld","confidence":1,"value":"1"},]') }),
    ],
    [
      'an unquoted key in an object',
      () =>
        db.orm
          .insert(schema.listing)
          .values({
            ...rows.listing,
            id: 2,
            urlCanonical: 'https://x.example/',
            variant: text("{Colour: 'Black'}"),
          })
          .run(),
    ],
    [
      'JSON5 in a nullable object column',
      () =>
        db.orm
          .insert(schema.watch)
          .values({ ...rows.watch, id: 2, spec: text('{"a":1,}') })
          .run(),
    ],
    [
      'JSON5 in an untyped JSON column',
      () =>
        db.orm
          .insert(schema.setting)
          .values({ key: 'k', value: text('{a:1}'), valueEnc: null })
          .run(),
    ],
    [
      'JSON5 in a run step payload',
      () =>
        db.orm
          .insert(schema.runStep)
          .values({ ...rows.chatStep, payload: text('[1,]') })
          .run(),
    ],
  ];

  it.each(cases)('refuses %s', (_, act) => {
    expect(refusal(act)).toMatch(/CHECK constraint failed: [^<]*json_valid|malformed JSON/);
  });

  it('still accepts NULL in a nullable JSON column, deliberately', () => {
    db.orm
      .insert(schema.watch)
      .values({
        ...rows.watch,
        id: 2,
        spec: null,
        currency: null,
        referencePrice: null,
        referenceKind: null,
      })
      .run();
    expect(db.orm.select().from(schema.watch).where(eq(schema.watch.id, 2)).get()?.spec).toBeNull();
  });
});

describe('price_observation rules that are column logic (item 3)', () => {
  it('refuses currency unknown with no raw candidate: a failed read', () => {
    const act = observation({
      currency: 'unknown',
      sticker: null,
      referenceClaimed: null,
      shipping: null,
      shippingStatus: 'unknown',
      taxIncluded: null,
      effective: null,
      landed: null,
      missingComponents: ['sticker', 'shipping', 'tax'],
      availability: 'unknown',
      rawCandidates: [],
    });
    expect(refusal(act)).toMatch(/price_observation_not_a_failed_read/);
  });

  it('refuses a sticker with no raw candidate', () => {
    expect(refusal(observation({ rawCandidates: [] }))).toMatch(
      /price_observation_sticker_has_candidates/,
    );
  });

  it('refuses a landed price while a component is missing', () => {
    expect(refusal(observation({ missingComponents: ['tax'] }))).toMatch(
      /price_observation_landed/,
    );
  });
});

/** Rows whose history no statement may rewrite, and the one change each route tries to make. */
const GUARDED = [
  {
    table: 'price_observation',
    change: "observed_at = '2026-11-18T00:00:00.000Z'",
    otherKey: null,
    mayUpdate: false,
    mayDelete: false,
  },
  { table: 'event', change: "kind = 'click'", otherKey: null, mayUpdate: false, mayDelete: true },
  {
    table: 'notification_event',
    change: "created_at = '2026-11-18T00:00:00.000Z'",
    otherKey: 'id = 99',
    mayUpdate: false,
    mayDelete: false,
  },
  {
    table: 'delivery',
    change: "next_attempt_at = '2026-11-18T00:00:00.000Z'",
    otherKey: 'id = 99',
    mayUpdate: true,
    mayDelete: false,
  },
] as const;

function routes(table: string, change: string, otherKey: string | null) {
  const all: [string, string, string | null][] = [
    ['UPDATE', `UPDATE ${table} SET ${change} WHERE id = 1`, null],
    ['UPDATE OR REPLACE', `UPDATE OR REPLACE ${table} SET ${change} WHERE id = 1`, null],
    ['INSERT OR REPLACE', `INSERT OR REPLACE INTO ${table} SELECT * FROM changed`, null],
    ['REPLACE INTO', `REPLACE INTO ${table} SELECT * FROM changed`, null],
    [
      'upsert DO UPDATE',
      `INSERT INTO ${table} SELECT * FROM changed WHERE true ON CONFLICT (id) DO UPDATE SET ${change}`,
      null,
    ],
    [
      'INSERT OR IGNORE of an existing id',
      `INSERT OR IGNORE INTO ${table} SELECT * FROM changed`,
      null,
    ],
    ['DELETE', `DELETE FROM ${table} WHERE id = 1`, null],
  ];
  if (otherKey !== null) {
    // A new id whose other unique key clashes: REPLACE would delete row 1 to make room.
    all.push([
      'INSERT OR REPLACE on another unique key',
      `INSERT OR REPLACE INTO ${table} SELECT * FROM changed`,
      otherKey,
    ]);
  }
  return all;
}

describe('append-only and audit tables refuse every rewrite route (items 4 and 7)', () => {
  beforeEach(() => {
    db.orm
      .insert(schema.event)
      .values({ id: 1, profileId: 1, kind: 'dismiss', createdAt: T1 })
      .run();
    db.orm.insert(schema.notificationEvent).values(rows.priceDrop).run();
    db.orm.insert(schema.delivery).values(rows.pendingDelivery).run();
    // The guard must not depend on a per-connection setting.
    db.exec('PRAGMA recursive_triggers = OFF');
  });

  const snapshot = (table: string) => db.orm.all(sql.raw(`SELECT * FROM ${table} ORDER BY id`));

  const cases = GUARDED.flatMap((g) =>
    routes(g.table, g.change, g.otherKey)
      .filter(([route]) => !(route === 'DELETE' && g.mayDelete))
      .filter(([route]) => !(route.startsWith('UPDATE') && g.mayUpdate))
      .map(([route, statement, rekey]) => ({ ...g, route, statement, rekey })),
  );

  it.each(cases)('$table: refuses $route', ({ table, change, statement, rekey }) => {
    db.exec(`CREATE TEMP TABLE changed AS SELECT * FROM ${table} WHERE id = 1`);
    db.exec(`UPDATE changed SET ${rekey ?? change}`);
    const before = snapshot(table);
    expect(refusal(() => db.exec(statement))).toMatch(
      /is append-only|kept|never replaced|never deleted/,
    );
    expect(snapshot(table)).toEqual(before);
  });

  it('delivery: state changes by UPDATE, as the outbox needs', () => {
    db.exec(
      `UPDATE delivery SET state = 'accepted', attempts = 1, outcome = 'accepted', next_attempt_at = NULL, accepted_at = '${T1}' WHERE id = 1`,
    );
    expect(db.orm.select().from(schema.delivery).get()?.state).toBe('accepted');
  });

  it('delivery: cannot be moved onto another (event, channel) by UPDATE OR REPLACE', () => {
    db.orm
      .insert(schema.notificationEvent)
      .values({ ...rows.priceDrop, id: 2, key: 'k2' })
      .run();
    db.orm
      .insert(schema.delivery)
      .values({ ...rows.pendingDelivery, id: 2, eventId: 2 })
      .run();
    const before = snapshot('delivery');
    expect(
      refusal(() => db.exec('UPDATE OR REPLACE delivery SET event_id = 1 WHERE id = 2')),
    ).toMatch(/identity never changes/);
    expect(snapshot('delivery')).toEqual(before);
  });

  it('event: the user may delete one', () => {
    db.exec('DELETE FROM event WHERE id = 1');
    expect(db.orm.select().from(schema.event).all()).toEqual([]);
  });

  it('notification_event: a price drop cannot become a system message', () => {
    expect(
      refusal(() =>
        db.exec(
          "UPDATE notification_event SET kind = 'system', watch_id = NULL, listing_id = NULL, observation_id = NULL, text = 'x' WHERE id = 1",
        ),
      ),
    ).toMatch(/append-only/);
  });
});

describe('connection settings (item 4 second line, item 11)', () => {
  it('turns recursive triggers on, so a REPLACE deletion fires DELETE triggers too', () => {
    const fresh = openDatabase(':memory:');
    expect(fresh.orm.get(sql`pragma recursive_triggers`)).toEqual({ recursive_triggers: 1 });
    expect(fresh.orm.get(sql`pragma busy_timeout`)).toEqual({ timeout: 5000 });
  });
});

describe('integers JavaScript cannot read back (item 5)', () => {
  const raw = (n: string) => sql.raw(n);

  it('accepts amounts up to 2^53 - 1', () => {
    observation({ sticker: raw(MAX_SAFE), effective: null, landed: null })();
    const back = db.orm
      .select()
      .from(schema.priceObservation)
      .where(eq(schema.priceObservation.id, 2))
      .get();
    expect(back?.sticker).toBe(Number.MAX_SAFE_INTEGER);
  });

  const run = (r: Record<string, unknown>) => () =>
    db.orm
      .insert(schema.run)
      .values({ ...rows.run, id: 78, ...r } as typeof schema.run.$inferInsert)
      .run();

  const cases: [string, () => unknown, RegExp][] = [
    ['a sticker', observation({ sticker: raw(TOO_BIG), effective: null, landed: null }), /sticker/],
    ['a coupon', observation({ coupon: raw(TOO_BIG) }), /coupon/],
    ['a landed price', observation({ landed: raw(TOO_BIG) }), /landed/],
    [
      'a watch reference price',
      () =>
        db.orm
          .insert(schema.watch)
          .values({ ...rows.watch, id: 2, referencePrice: raw(TOO_BIG) as never })
          .run(),
      /reference_price/,
    ],
    ['a spend cap', run({ maxSpendNanos: raw(TOO_BIG) }), /max_spend_nanos/],
    ['a run cost', run({ costNanos: raw(TOO_BIG) }), /cost_nanos/],
    ['a token count', run({ inputTokens: raw(TOO_BIG) }), /input_tokens/],
    [
      'a step cost',
      () =>
        db.orm
          .insert(schema.runStep)
          .values({ ...rows.chatStep, costNanos: raw(TOO_BIG) as never })
          .run(),
      /cost_nanos/,
    ],
  ];

  it.each(cases)('refuses 2^53 in %s', (_, act, column) => {
    const why = refusal(act);
    expect(why).toMatch(/CHECK constraint failed/);
    expect(why).toMatch(column);
  });
});

describe('outbox references (items 6, 7, 8)', () => {
  it('refuses an alert whose observation belongs to another listing', () => {
    db.orm
      .insert(schema.listing)
      .values({ ...rows.listing, id: 2, urlCanonical: 'https://shop.example.ca/p/2' })
      .run();
    db.orm
      .insert(schema.priceObservation)
      .values({ ...rows.observation, id: 2, listingId: 2 })
      .run();
    const act = () =>
      db.orm
        .insert(schema.notificationEvent)
        .values({ ...rows.priceDrop, observationId: 2 })
        .run();
    expect(refusal(act)).toMatch(/FOREIGN KEY constraint failed/);
  });

  it('accepts an alert whose observation is of its listing', () => {
    db.orm.insert(schema.notificationEvent).values(rows.priceDrop).run();
    expect(db.orm.select().from(schema.notificationEvent).all()).toHaveLength(1);
  });

  it('refuses deleting a delivery while its event exists', () => {
    db.orm.insert(schema.notificationEvent).values(rows.priceDrop).run();
    db.orm.insert(schema.delivery).values(rows.pendingDelivery).run();
    expect(refusal(() => db.orm.delete(schema.delivery).run())).toMatch(/never deleted/);
  });
});

describe('save first: a search before its interpretation (item 9)', () => {
  it('saves a search run with no intent yet', () => {
    db.orm
      .insert(schema.searchRun)
      .values({
        id: 1,
        profileId: 1,
        intent: null,
        mode: 'fast',
        budget: {},
        status: 'queued',
        coverage: null,
        result: null,
        runId: null,
      })
      .run();
    expect(db.orm.select().from(schema.searchRun).get()?.intent).toBeNull();
  });
});

describe('smaller rules (items 12, 13, 14)', () => {
  const store = (host: string) => () =>
    db.orm
      .insert(schema.store)
      .values({ ...rows.store, id: 2, host })
      .run();
  const hostAccess = (host: string) => () =>
    db.orm
      .insert(schema.hostAccess)
      .values({
        id: 1,
        host,
        pageKind: 'product',
        rung: 'http',
        lastOutcome: 'ok',
        wallVendor: null,
        expiresAt: null,
        backoffUntil: null,
        attempts: 0,
      })
      .run();
  const event = (e: Record<string, unknown>) => () =>
    db.orm
      .insert(schema.notificationEvent)
      .values({ ...rows.priceDrop, ...e } as typeof schema.notificationEvent.$inferInsert)
      .run();
  const fx = (f: Record<string, unknown>) => () =>
    db.orm
      .insert(schema.fxRate)
      .values({
        base: 'USD',
        quote: 'CAD',
        rate: 1.38,
        source: 'ecb',
        asOf: T1,
        ...f,
      } as typeof schema.fxRate.$inferInsert)
      .run();

  const cases: [string, () => unknown, RegExp][] = [
    ['an upper-case store host', store('SHOP.example.ca'), /store_host/],
    ['an empty store host', store(''), /store_host/],
    ['an upper-case host_access host', hostAccess('Shop.example.ca'), /host_access_host/],
    ['an empty host_access host', hostAccess(''), /host_access_host/],
    ['an empty event key', event({ key: '' }), /CHECK constraint failed: key/],
    [
      'an empty notice text',
      event({ kind: 'system', watchId: null, listingId: null, observationId: null, text: '' }),
      /CHECK constraint failed: text/,
    ],
    [
      'an infinite FX rate',
      fx({ rate: Number.POSITIVE_INFINITY }),
      /CHECK constraint failed: rate/,
    ],
    [
      'JSON null as a setting value',
      () =>
        db.orm
          .insert(schema.setting)
          .values({ key: 'k', value: text('null'), valueEnc: null })
          .run(),
      /setting_one_value/,
    ],
  ];

  it.each(cases)('refuses %s', (_, act, message) => {
    expect(refusal(act)).toMatch(message);
  });

  it('accepts a lower-case host and the same pair from two FX sources, once each', () => {
    store('other.example.ca')();
    hostAccess('shop.example.ca')();
    fx({})();
    fx({ source: 'boc' })();
    expect(refusal(fx({}))).toMatch(
      /UNIQUE constraint failed: fx_rate.base, fx_rate.quote, fx_rate.source, fx_rate.as_of/,
    );
  });
});
