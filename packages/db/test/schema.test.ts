// The Drizzle definitions and the SQL migration must describe the same database, and the rules
// S§4 states for every table (profile_id, money, timestamps, no defaults) hold by introspection.
import { getTableName, is, SQL, sql } from 'drizzle-orm';
import { getTableConfig, SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { type Database, TABLES } from '../src/index.ts';
import {
  columnsOf,
  type ForeignKeyInfo,
  foreignKeysOf,
  type IndexInfo,
  indexesOf,
  migratedDb,
  tableNames,
} from './fixtures.ts';

/**
 * Every table, classified. A table missing here fails the first test, so a new table cannot land
 * without a decision on whether it is user-owned.
 */
const OWNERSHIP: Record<string, 'user' | 'catalogue' | 'operational' | 'root' | 'runner'> = {
  // User-owned (S§4): the user's requests, behaviour, feed, runs, messages and channels.
  watch: 'user',
  watch_listing: 'user',
  search_run: 'user',
  event: 'user',
  candidate: 'user',
  feed_card: 'user',
  run: 'user',
  run_step: 'user',
  notification_event: 'user',
  delivery: 'user',
  channel: 'user',
  // The owner's password and login sessions (S§5.13, migration 0002).
  owner_password: 'user',
  session: 'user',
  // Catalogue: what the engine read about stores, products and prices, shared by every profile.
  store: 'catalogue',
  host_access: 'catalogue',
  product: 'catalogue',
  listing: 'catalogue',
  price_observation: 'catalogue',
  match_verdict: 'catalogue',
  fx_rate: 'catalogue',
  deal_feed_item: 'catalogue',
  // Migration 0002: when each listing is read next and how its reads went (S§5.8), and RDAP
  // registration dates by domain (S§5.5).
  listing_check: 'catalogue',
  domain_registration: 'catalogue',
  // Operational: install-wide scheduling and configuration (S§5.8, S§5.13).
  job: 'operational',
  job_run: 'operational',
  llm_endpoint: 'operational',
  setting: 'operational',
  // Per-host pacing, persisted across restarts (S§5.1, migration 0002).
  host_pacing: 'operational',
  // The profile itself, and the migration runner's own bookkeeping.
  profile: 'root',
  schema_migration: 'runner',
};

/**
 * Every amount column and the currency column on the same row (S§2.2). Run cost and spend are
 * nano-units (S§4.4); everything else is minor units.
 */
const AMOUNTS: Record<string, { currency: string; columns: string[] }[]> = {
  price_observation: [
    {
      currency: 'currency',
      columns: [
        'sticker',
        'reference_claimed',
        'coupon',
        'member_price',
        'shipping',
        'tax',
        'duty_estimate',
        'unit_price',
        'effective',
        'landed',
      ],
    },
  ],
  watch: [{ currency: 'currency', columns: ['reference_price'] }],
  run: [
    { currency: 'spend_currency', columns: ['max_spend_nanos'] },
    { currency: 'cost_currency', columns: ['cost_nanos'] },
  ],
  run_step: [{ currency: 'cost_currency', columns: ['cost_nanos'] }],
};

/** Columns whose names look like money but are not amounts, each with the reason. */
const NOT_AMOUNTS: Record<string, string> = {
  'price_observation.shipping_status': 'a status (S§2.10)',
  'price_observation.tax_included': 'a tri-state boolean',
  'run.cost_source': 'where the cost came from',
  'run_step.cost_source': 'where the cost came from',
  'run.budget_hits_json': 'budget kinds hit, no amount',
  // Its spend cap and money cap are JSON contents, validated at the boundary (schema: Phase 2).
  'search_run.budget_json': 'JSON; amounts inside carry their currency',
  // A lead: the figure stays as the feed wrote it until a live read confirms a price (S§5.3).
  'deal_feed_item.price_text': 'text as read, never an amount',
};

const MONEY_NAME =
  /price|amount|cost|spend|nanos|sticker|coupon|shipping|tax|duty|effective|landed|budget/;

describe('table classification', () => {
  let db: Database;
  beforeAll(() => {
    db = migratedDb();
  });

  it('classifies every table in the migrated database', () => {
    expect(tableNames(db)).toEqual(Object.keys(OWNERSHIP).sort());
  });

  it('gives every user-owned table a NOT NULL profile_id referencing profile, and no other table one', () => {
    for (const [table, kind] of Object.entries(OWNERSHIP)) {
      const profileId = columnsOf(db, table).find((c) => c.name === 'profile_id');
      if (kind !== 'user') {
        expect(profileId, table).toBeUndefined();
        continue;
      }
      expect(profileId, table).toMatchObject({ type: 'INTEGER', notnull: 1 });
      expect(foreignKeysOf(db, table), table).toContainEqual({
        table: 'profile',
        from: ['profile_id'],
        to: ['id'],
        onDelete: 'RESTRICT',
      });
    }
  });

  it('makes every table STRICT and gives no column a default', () => {
    const strict = db.orm.all<{ name: string; strict: number }>(
      sql`select name, strict from pragma_table_list where schema = 'main'`,
    );
    for (const table of Object.keys(OWNERSHIP)) {
      expect(strict.find((t) => t.name === table)?.strict, table).toBe(1);
      for (const column of columnsOf(db, table)) {
        expect(column.dflt_value, `${table}.${column.name}`).toBeNull();
      }
    }
  });
});

describe('money columns (S§2.2)', () => {
  let db: Database;
  beforeAll(() => {
    db = migratedDb();
  });

  it('stores every amount as INTEGER beside a currency column on the same row', () => {
    for (const [table, groups] of Object.entries(AMOUNTS)) {
      const columns = columnsOf(db, table);
      for (const { currency, columns: amounts } of groups) {
        expect(
          columns.find((c) => c.name === currency),
          `${table}.${currency}`,
        ).toMatchObject({
          type: 'TEXT',
          dflt_value: null,
        });
        for (const amount of amounts) {
          expect(
            columns.find((c) => c.name === amount),
            `${table}.${amount}`,
          ).toMatchObject({
            type: 'INTEGER',
          });
        }
      }
    }
  });

  it('knows every column whose name looks like money', () => {
    const listed = new Set(
      Object.entries(AMOUNTS).flatMap(([table, groups]) =>
        groups.flatMap((g) => [...g.columns, g.currency].map((c) => `${table}.${c}`)),
      ),
    );
    for (const table of tableNames(db)) {
      for (const { name } of columnsOf(db, table)) {
        const key = `${table}.${name}`;
        if (MONEY_NAME.test(name)) expect(listed.has(key) || key in NOT_AMOUNTS, key).toBe(true);
      }
    }
  });

  it('bounds every amount and token count to what JavaScript reads back exactly (2^53 - 1)', () => {
    const tokens = [
      'max_input_tokens',
      'input_tokens',
      'cache_read_input_tokens',
      'cache_write_input_tokens',
      'output_tokens',
      'reasoning_output_tokens',
    ];
    for (const table of tableNames(db)) {
      const ddl = tableSql(db, table);
      const amounts = (AMOUNTS[table] ?? []).flatMap((g) => g.columns);
      const counted = columnsOf(db, table)
        .map((c) => c.name)
        .filter((c) => tokens.includes(c));
      for (const column of [...amounts, ...counted]) {
        expect(ddl, `${table}.${column}`).toMatch(
          new RegExp(`\\b${column} BETWEEN [01] AND 9007199254740991\\b`),
        );
      }
    }
  });

  it('has no REAL column except the FX rate, which is a ratio', () => {
    const real = tableNames(db).flatMap((table) =>
      columnsOf(db, table)
        .filter((c) => c.type === 'REAL')
        .map((c) => `${table}.${c.name}`),
    );
    expect(real).toEqual(['fx_rate.rate']);
  });
});

// Schema drift: Drizzle's metadata against PRAGMA introspection of the migrated database. CHECK
// constraints and triggers are not declared in Drizzle (it needs neither to type queries); they
// are tested by behaviour in contracts.test.ts.
describe('schema drift', () => {
  let db: Database;
  beforeAll(() => {
    db = migratedDb();
  });

  it('declares exactly the migrated tables', () => {
    expect(TABLES.map((t) => getTableName(t)).sort()).toEqual(
      tableNames(db).filter((t) => t !== 'schema_migration'),
    );
  });

  for (const table of TABLES) {
    const config = getTableConfig(table);

    it(`${config.name}: same columns, types, nullability and primary key`, () => {
      const fromSql = columnsOf(db, config.name).map((c) => ({
        name: c.name,
        type: c.type,
        // An INTEGER PRIMARY KEY is the rowid: never null, though PRAGMA reports notnull 0.
        notNull: c.notnull === 1 || (c.pk > 0 && c.type === 'INTEGER'),
        primaryKey: c.pk > 0,
      }));
      const fromDrizzle = config.columns.map((c) => ({
        name: c.name,
        type: c.getSQLType().toUpperCase(),
        notNull: c.notNull,
        primaryKey: c.primary,
      }));
      expect(fromDrizzle).toEqual(fromSql);
      // Drizzle marks the rowid as defaulted (SQLite assigns it); no other column has a default.
      for (const c of config.columns) {
        const rowid = c.primary && c.getSQLType() === 'integer';
        expect(c.hasDefault, `${config.name}.${c.name}`).toBe(rowid);
      }
    });

    it(`${config.name}: same foreign keys and ON DELETE actions`, () => {
      const fromDrizzle: ForeignKeyInfo[] = config.foreignKeys.map((fk) => {
        const ref = fk.reference();
        return {
          table: getTableName(ref.foreignTable),
          from: ref.columns.map((c) => c.name),
          to: ref.foreignColumns.map((c) => c.name),
          onDelete: (fk.onDelete ?? 'no action').toUpperCase(),
        };
      });
      expect(sortByKey(fromDrizzle)).toEqual(sortByKey(foreignKeysOf(db, config.name)));
    });

    it(`${config.name}: same indexes and unique constraints`, () => {
      const fromSql = indexesOf(db, config.name);
      const created: Omit<IndexInfo, 'origin'>[] = config.indexes.map((i) => ({
        name: i.config.name,
        unique: i.config.unique,
        partial: i.config.where !== undefined,
        columns: i.config.columns.map((c) =>
          is(c, SQLiteColumn) ? c.name : is(c, SQL) ? '<expr>' : '?',
        ),
      }));
      expect(sortByKey(created)).toEqual(
        sortByKey(fromSql.filter((i) => i.origin === 'c').map(({ origin: _, ...rest }) => rest)),
      );
      const uniques = [
        ...config.uniqueConstraints.map((u) => u.columns.map((c) => c.name)),
        ...config.columns.filter((c) => c.isUnique).map((c) => [c.name]),
      ];
      expect(sortByKey(uniques)).toEqual(
        sortByKey(fromSql.filter((i) => i.origin === 'u').map((i) => i.columns)),
      );
    });
  }
});

function sortByKey<T>(items: T[]): T[] {
  return [...items].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
}

function tableSql(db: Database, table: string): string {
  return (
    db.orm.get<{ sql: string }>(
      sql`select sql from sqlite_schema where type = 'table' and name = ${table}`,
    )?.sql ?? ''
  );
}

// What the drift test cannot see: CHECKs, triggers and STRICT live only in the hand-written SQL.
// A migration regenerated from the Drizzle definitions would drop them and fail here.
const NAMED_CHECKS = [
  'delivery_accepted_at',
  'delivery_next_attempt',
  'delivery_outcome',
  'domain_registration_domain_lower',
  'domain_registration_order',
  'fx_rate_pair',
  'host_access_host_lower',
  'host_pacing_host_lower',
  'job_run_ended_when_finished',
  'job_run_order',
  'job_run_reason',
  'job_schedule',
  'listing_check_errors',
  'match_verdict_model_fields',
  'notification_event_rests_on',
  'owner_password_phc',
  'price_observation_effective',
  'price_observation_landed',
  'price_observation_not_a_failed_read',
  'price_observation_shipping_amount',
  'price_observation_sticker_has_candidates',
  'price_observation_unit_pair',
  'price_observation_unknown_currency_has_no_amount',
  'run_cost_in_spend_currency',
  'run_cost_known',
  'run_ended_when_finished',
  'run_input_includes_cached',
  'run_output_includes_reasoning',
  'run_step_cost_known',
  'run_step_input_includes_cached',
  'run_step_model_call',
  'run_step_order',
  'run_step_output_includes_reasoning',
  'run_step_tool_call',
  'run_turns_within_cap',
  'session_order',
  'session_token_hash',
  'setting_one_value',
  'store_health',
  'store_host_lower',
  'watch_lookup',
  'watch_reference_currency',
  'watch_reference_pair',
];

const TRIGGERS = [
  'delivery_identity_fixed',
  'delivery_kept',
  'delivery_no_replace',
  'event_append_only',
  'event_no_replace',
  'notification_event_append_only',
  'notification_event_kept',
  'notification_event_no_replace',
  'price_observation_append_only',
  'price_observation_kept_forever',
  'price_observation_no_replace',
  'watch_intake_complete',
];

/**
 * Every CHECK in the migrated schema, column and table level (the ledger's included): 138 from
 * 0001, 37 from 0002 (11 named, 26 unnamed). A column added by ALTER TABLE carries its CHECKs into
 * its table's CREATE statement, so they are counted with it.
 */
const CHECK_COUNT = 175;

describe('what only the SQL holds', () => {
  let db: Database;
  beforeAll(() => {
    db = migratedDb();
  });
  const all = () =>
    db.orm
      .all<{ sql: string }>(sql`select sql from sqlite_schema where type = 'table'`)
      .map((r) => r.sql)
      .join('\n');

  it('has every named CHECK, every trigger and the expected number of CHECKs', () => {
    const ddl = all();
    expect([...ddl.matchAll(/CONSTRAINT (\w+) CHECK/g)].map((m) => m[1]).sort()).toEqual(
      NAMED_CHECKS,
    );
    expect(
      db.orm
        .all<{ name: string }>(
          sql`select name from sqlite_schema where type = 'trigger' order by name`,
        )
        .map((r) => r.name),
    ).toEqual(TRIGGERS);
    expect(ddl.match(/\bCHECK \(/g)?.length).toBe(CHECK_COUNT);
  });

  it('checks every timestamp with IS, so text strftime cannot parse is refused, not passed', () => {
    for (const table of tableNames(db)) {
      const ddl = tableSql(db, table);
      for (const { name } of columnsOf(db, table)) {
        if (!/(_at|_until)$|^as_of$/.test(name)) continue;
        expect(ddl, `${table}.${name}`).toContain(
          `strftime('%Y-%m-%dT%H:%M:%fZ', ${name}) IS ${name}`,
        );
      }
    }
    expect(all()).not.toMatch(/strftime\([^)]*\)\s*=/);
  });

  it('checks every JSON column with json_valid, which refuses JSON5', () => {
    for (const table of tableNames(db)) {
      const ddl = tableSql(db, table);
      for (const { name } of columnsOf(db, table)) {
        if (!/_json$|^identifiers_offered$/.test(name)) continue;
        expect(ddl, `${table}.${name}`).toContain(`json_valid(${name})`);
      }
    }
  });

  it('indexes the child column of every foreign key except profile_id', () => {
    for (const table of tableNames(db)) {
      const leading = new Set(indexesOf(db, table).map((i) => i.columns[0]));
      // An INTEGER PRIMARY KEY is the rowid, the key of the table's own B-tree: lookups by it need
      // no separate index, and PRAGMA index_list does not list one (listing_check.listing_id).
      for (const c of columnsOf(db, table)) {
        if (c.pk === 1 && c.type === 'INTEGER') leading.add(c.name);
      }
      for (const fk of foreignKeysOf(db, table)) {
        const first = fk.from[0];
        if (first === 'profile_id') continue;
        expect(leading.has(first), `${table}.${first} -> ${fk.table}`).toBe(true);
      }
    }
  });

  it('adds only nullable columns to the tables of 0001, so 0002 needs no table rebuild', () => {
    // Columns that 0002 adds with ALTER TABLE … ADD COLUMN: a NOT NULL column there needs a
    // default, and no column has one (migrations/README.md).
    const added: Record<string, string[]> = {
      store: ['consecutive_errors', 'last_ok_at', 'last_error_at', 'last_error'],
      watch: [
        'paused_at',
        'archived_at',
        'dedupe_key',
        'restock_enabled_at',
        'lookup_state',
        'lookup_queued_at',
        'lookup_due_at',
        'lookup_attempts',
        'lookup_error',
      ],
      job: ['retry_at'],
      job_run: ['reason', 'coalesced_slots', 'detail_json'],
      channel: ['name', 'created_at', 'disabled_at', 'removed_at'],
    };
    for (const [table, columns] of Object.entries(added)) {
      const all = columnsOf(db, table);
      expect(
        all.slice(-columns.length).map((c) => c.name),
        table,
      ).toEqual(columns);
      for (const c of all.slice(-columns.length)) expect(c.notnull, `${table}.${c.name}`).toBe(0);
    }
  });
});
