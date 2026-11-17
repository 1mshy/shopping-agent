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
  // Catalogue: what the engine read about stores, products and prices, shared by every profile.
  store: 'catalogue',
  host_access: 'catalogue',
  product: 'catalogue',
  listing: 'catalogue',
  price_observation: 'catalogue',
  match_verdict: 'catalogue',
  fx_rate: 'catalogue',
  deal_feed_item: 'catalogue',
  // Operational: install-wide scheduling and configuration (S§5.8, S§5.13).
  job: 'operational',
  job_run: 'operational',
  llm_endpoint: 'operational',
  setting: 'operational',
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
