import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Database,
  MIGRATIONS,
  type Migration,
  MigrationError,
  migrate,
  migrationLevel,
  openDatabase,
} from '../src/index.ts';
import { refusal, tableNames } from './fixtures.ts';

const latest = MIGRATIONS.at(-1)?.version ?? 0;

const a: Migration = {
  version: 1,
  name: '0001_a',
  sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY) STRICT;',
};
const b: Migration = {
  version: 2,
  name: '0002_b',
  sql: 'CREATE TABLE b (id INTEGER PRIMARY KEY, a_id INTEGER NOT NULL REFERENCES a (id)) STRICT;',
};
const c: Migration = {
  version: 3,
  name: '0003_c',
  sql: 'CREATE TABLE c (id INTEGER PRIMARY KEY) STRICT;',
};

function recorded(db: Database) {
  return db.orm.all<{ version: number; name: string }>(
    sql`select version, name from schema_migration order by version`,
  );
}

function schemaText(db: Database): string {
  return db.orm
    .all<{ sql: string | null }>(sql`select sql from sqlite_schema order by type, name`)
    .map((r) => r.sql)
    .join('\n');
}

function expectRefused(act: () => unknown, code: MigrationError['code']) {
  try {
    act();
  } catch (error) {
    expect(error).toBeInstanceOf(MigrationError);
    expect((error as MigrationError).code).toBe(code);
    return;
  }
  expect.fail(`expected a MigrationError with code ${code}`);
}

describe('migrate', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('migrates a fresh database and reports the level', () => {
    const db = openDatabase(':memory:');
    expect(migrationLevel(db)).toBe(0);
    expect(migrate(db)).toEqual({ level: latest, applied: MIGRATIONS.map((m) => m.version) });
    expect(migrationLevel(db)).toBe(latest);
    expect(tableNames(db)).toContain('price_observation');
    expect(recorded(db).map((r) => r.name)).toEqual(MIGRATIONS.map((m) => m.name));
  });

  it('does nothing on a second run', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const before = { schema: schemaText(db), recorded: recorded(db) };
    expect(migrate(db)).toEqual({ level: latest, applied: [] });
    expect({ schema: schemaText(db), recorded: recorded(db) }).toEqual(before);
  });

  it('applies only the pending migrations, in order', () => {
    const db = openDatabase(':memory:');
    expect(migrate(db, [a])).toEqual({ level: 1, applied: [1] });
    expect(migrate(db, [a, b, c])).toEqual({ level: 3, applied: [2, 3] });
    expect(recorded(db)).toEqual([
      { version: 1, name: '0001_a' },
      { version: 2, name: '0002_b' },
      { version: 3, name: '0003_c' },
    ]);
  });

  it('applies the pending migrations in one transaction', () => {
    const db = openDatabase(':memory:');
    const broken: Migration = { version: 3, name: '0003_broken', sql: 'CREATE TABLE oops (' };
    expect(() => migrate(db, [a, b, broken])).toThrow();
    expect(migrationLevel(db)).toBe(0);
    expect(tableNames(db)).not.toContain('a');
  });

  it('refuses a database that is ahead of the code', () => {
    const db = openDatabase(':memory:');
    migrate(db, [a, b]);
    const before = schemaText(db);
    expectRefused(() => migrate(db, [a]), 'ahead');
    expect(schemaText(db)).toBe(before);
    expect(migrationLevel(db)).toBe(2);
  });

  it('refuses a recorded migration whose SQL or name has changed', () => {
    const db = openDatabase(':memory:');
    migrate(db, [a]);
    expectRefused(() => migrate(db, [{ ...a, sql: `${a.sql}\n` }]), 'changed');
    expectRefused(() => migrate(db, [{ ...a, name: '0001_renamed' }]), 'changed');
  });

  it('refuses a pending migration older than the level', () => {
    const db = openDatabase(':memory:');
    migrate(db, [a, c]);
    expectRefused(() => migrate(db, [a, b, c]), 'out_of_order');
  });

  it('refuses a list that is not strictly increasing', () => {
    const db = openDatabase(':memory:');
    expectRefused(() => migrate(db, [b, a]), 'invalid_list');
    expectRefused(() => migrate(db, [a, { ...a, name: '0001_again' }]), 'invalid_list');
    expectRefused(() => migrate(db, [{ ...a, version: 0 }]), 'invalid_list');
  });

  it('checks foreign keys before committing and leaves enforcement on', () => {
    const db = openDatabase(':memory:');
    const orphan: Migration = {
      version: 3,
      name: '0003_orphan',
      sql: 'INSERT INTO b (a_id) VALUES (42);',
    };
    expectRefused(() => migrate(db, [a, b, orphan]), 'foreign_key');
    expect(migrationLevel(db)).toBe(0);
    migrate(db, [a, b]);
    expect(db.orm.get<{ foreign_keys: number }>(sql`pragma foreign_keys`)).toEqual({
      foreign_keys: 1,
    });
    expect(refusal(() => db.orm.run(sql`insert into b (a_id) values (42)`))).toMatch(
      /FOREIGN KEY constraint failed/,
    );
  });

  it('is safe at every start-up of a file database', () => {
    dir = mkdtempSync(join(tmpdir(), 'sa-db-'));
    const file = join(dir, 'agentic-dasher.db');
    const first = openDatabase(file);
    expect(migrate(first).applied).toEqual(MIGRATIONS.map((m) => m.version));
    first.close();
    const second = openDatabase(file);
    try {
      expect(migrate(second)).toEqual({ level: latest, applied: [] });
      expect(migrationLevel(second)).toBe(latest);
    } finally {
      second.close();
    }
  });
});

// Rows a level-1 database could hold, written with the SQL of 0001 (the Drizzle definitions
// describe level 2). One row of each table 0002 changes, and the rows they point at.
const LEVEL_1_ROWS = `
INSERT INTO profile (id) VALUES (1);
INSERT INTO store (id, host, market_prefix, platform, base_currency, is_shop, trust_tier,
  trust_reasons_json, source)
  VALUES (1, 'shop.example.ca', '', 'shopify', 'CAD', 'yes', 'known', '[]', 'read');
INSERT INTO listing (id, store_id, channel, url_canonical, seller_kind, condition, currency, title,
  variant_json, trackable, first_seen_at, last_seen_at, consecutive_errors)
  VALUES (1, 1, 'retail', 'https://shop.example.ca/products/a', 'first_party', 'new', 'CAD', 'A',
  '{}', 1, '2026-11-17T09:00:00.000Z', '2026-11-17T09:00:00.000Z', 0);
INSERT INTO price_observation (id, listing_id, observed_at, currency, sticker, shipping_status,
  missing_components_json, availability, read_path, rung, raw_candidates_json)
  VALUES (1, 1, '2026-11-17T09:00:00.000Z', 'CAD', 44999, 'unknown', '["shipping","tax"]', 'in',
  'json_ld', 'http', '[{"method":"json_ld","confidence":0.9,"value":"449.99"}]');
INSERT INTO watch (id, profile_id, kind, input, market, rules_json, cooldown_s, created_at)
  VALUES (1, 1, 'product', 'https://shop.example.ca/products/a', 'CA', '{}', 43200,
  '2026-11-17T08:59:00.000Z');
INSERT INTO watch_listing (id, profile_id, watch_id, listing_id, role, added_by)
  VALUES (1, 1, 1, 1, 'tracked', 'user');
INSERT INTO channel (id, profile_id, type, config_json) VALUES (1, 1, 'in_app', '{}');
INSERT INTO notification_event (id, profile_id, key, kind, created_at, watch_id, listing_id,
  observation_id)
  VALUES (1, 1, 'price_drop:1:1', 'price_drop', '2026-11-17T09:00:01.000Z', 1, 1, 1);
INSERT INTO delivery (id, profile_id, event_id, channel_id, state, attempts, outcome, accepted_at)
  VALUES (1, 1, 1, 1, 'accepted', 1, 'accepted', '2026-11-17T09:00:02.000Z');
INSERT INTO job (id, name, cron, next_run_at, deadline_ms, network_gate)
  VALUES (1, 'sweep', '*/30 * * * *', '2026-11-17T09:30:00.000Z', 600000, 1);
INSERT INTO job_run (id, job_id, status, started_at, ended_at)
  VALUES (1, 1, 'completed', '2026-11-17T09:00:00.000Z', '2026-11-17T09:00:40.000Z'),
  (2, 1, 'running', '2026-11-17T09:30:00.000Z', NULL);
`;

describe('migration 0002', () => {
  const level1 = () => {
    const db = openDatabase(':memory:');
    migrate(db, MIGRATIONS.slice(0, 1));
    expect(migrationLevel(db)).toBe(1);
    db.exec(LEVEL_1_ROWS);
    return db;
  };
  const snapshot = (db: Database, table: string, columns: string) =>
    db.orm.all(sql.raw(`SELECT ${columns} FROM ${table} ORDER BY 1`));

  it('takes a fresh database from level 0 to level 2', () => {
    const db = openDatabase(':memory:');
    expect(migrate(db, MIGRATIONS.slice(0, 2))).toEqual({ level: 2, applied: [1, 2] });
    expect(MIGRATIONS.slice(0, 2).map((m) => m.name)).toEqual([
      '0001_initial',
      '0002_phase1_state',
    ]);
  });

  it('upgrades a level-1 database with rows in it to level 2, keeping every row', () => {
    const db = level1();
    const tables = ['store', 'listing', 'watch', 'channel', 'delivery', 'job', 'job_run'];
    const before = tables.map((t) => snapshot(db, t, '*'));

    expect(migrate(db, MIGRATIONS.slice(0, 2))).toEqual({ level: 2, applied: [2] });

    // The rows of 0001 keep every value they had; the columns 0002 adds read as not recorded.
    for (const [i, table] of tables.entries()) {
      const width = Object.keys((before[i] as Record<string, unknown>[])[0] ?? {}).length;
      const after = snapshot(db, table, '*') as Record<string, unknown>[];
      expect(after.map((r) => Object.fromEntries(Object.entries(r).slice(0, width)))).toEqual(
        before[i],
      );
      for (const r of after) {
        for (const value of Object.values(r).slice(width)) expect(value, table).toBeNull();
      }
    }
    expect(tableNames(db)).toEqual(
      expect.arrayContaining([
        'domain_registration',
        'host_pacing',
        'listing_check',
        'owner_password',
        'session',
      ]),
    );
    expect(db.orm.all(sql`pragma foreign_key_check`)).toEqual([]);

    // The watch written before 0002 has no dedupe key, so it holds none; a new watch states its
    // key and lookup, and the rules of 0002 hold from here on.
    db.exec(`INSERT INTO watch (id, profile_id, kind, input, market, rules_json, cooldown_s,
      created_at, dedupe_key, lookup_state, lookup_queued_at, lookup_due_at, lookup_attempts)
      VALUES (2, 1, 'product', 'https://shop.example.ca/products/a', 'CA', '{}', 43200,
      '2026-11-18T08:00:00.000Z', 'url:https://shop.example.ca/products/a', 'queued',
      '2026-11-18T08:00:00.000Z', '2026-11-18T08:00:00.000Z', 0)`);
    expect(
      refusal(() =>
        db.exec(
          "INSERT INTO job_run (job_id, status, started_at) VALUES (1, 'running', '2026-11-17T10:00:00.000Z')",
        ),
      ),
    ).toMatch(/UNIQUE constraint failed: job_run.job_id/);
  });

  it('refuses a level-1 job run whose status and end disagree, and stays at level 1', () => {
    const db = level1();
    db.exec(
      "INSERT INTO job_run (id, job_id, status, started_at) VALUES (3, 1, 'completed', '2026-11-17T09:00:00.000Z')",
    );
    // ALTER TABLE tests the added CHECK against every row; SQLite names no constraint then.
    expect(() => migrate(db)).toThrow(/CHECK constraint failed/);
    expect(migrationLevel(db)).toBe(1);
    expect(tableNames(db)).not.toContain('session');
  });
});

describe('migration 0003', () => {
  it('bounds legacy restock decisions to existing observations at their cutoff', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db, MIGRATIONS.slice(0, 1));
      db.exec(LEVEL_1_ROWS);
      migrate(db, MIGRATIONS.slice(0, 2));
      db.exec(`INSERT INTO notification_event (profile_id, key, kind, created_at, watch_id, listing_id, observation_id)
        VALUES (1, 'old-restock', 'restock', '2026-11-17T09:01:00.000Z', 1, 1, 1)`);
      const append = (at: string) =>
        db.orm.run(sql`
        insert into price_observation (listing_id, observed_at, currency, sticker, shipping_status,
          missing_components_json, availability, read_path, rung, raw_candidates_json)
        select listing_id, ${at}, currency, sticker, shipping_status,
          missing_components_json, availability, read_path, rung, raw_candidates_json
        from price_observation where id = 1`);
      append('2026-11-17T09:00:30.000Z');
      append('2026-11-17T09:02:00.000Z');
      expect(migrate(db, MIGRATIONS.slice(0, 3))).toEqual({ level: 3, applied: [3] });
      append('2026-11-17T09:01:00.000Z');
      const covered = db.orm.all(
        sql`select event_id, listing_id, through_observation_id, source from restock_coverage`,
      );
      expect(covered).toEqual([
        { event_id: 2, listing_id: 1, through_observation_id: 2, source: 'legacy' },
      ]);
      expect(migrate(db, MIGRATIONS.slice(0, 3)).applied).toEqual([]);
      expect(() => db.exec('DELETE FROM restock_coverage')).toThrow(/immutable/);
      expect(() => db.exec("UPDATE restock_coverage SET source = 'decision'")).toThrow(/immutable/);
      expect(() =>
        db.exec('INSERT OR REPLACE INTO restock_coverage SELECT * FROM restock_coverage'),
      ).toThrow(/never replaced/);
    } finally {
      db.close();
    }
  });
});

describe('migration 0004', () => {
  it('preserves a level-three storefront and leaves its fingerprint uncached', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db, MIGRATIONS.slice(0, 1));
      db.exec(LEVEL_1_ROWS);
      migrate(db, MIGRATIONS.slice(0, 3));
      const stores = () => db.orm.all(sql`select id,host,is_shop,trust_tier,source from store`);
      const before = stores();
      expect(migrate(db, MIGRATIONS.slice(0, 4))).toEqual({ level: 4, applied: [4] });
      expect(stores()).toEqual(before);
      expect(db.orm.get(sql`select fingerprint_json from store`)).toEqual({
        fingerprint_json: null,
      });
      expect(() => db.exec("update store set fingerprint_json = '[]'")).toThrow();
    } finally {
      db.close();
    }
  });
});

describe('migration 0005', () => {
  it('seeks by listing, availability and time for both stock transition observations', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db, MIGRATIONS.slice(0, 1));
      db.exec(LEVEL_1_ROWS);
      migrate(db, MIGRATIONS.slice(0, 4));
      const count = db.orm.get(sql`select count(*) as n from price_observation`);
      migrate(db);
      for (const query of [
        sql`select * from price_observation indexed by price_observation_stock_time_idx where listing_id = 1 and availability = 'out'
          and (observed_at,id) < ('2026-12-01',2) order by observed_at desc,id desc limit 1`,
        sql`select * from price_observation indexed by price_observation_stock_time_idx where listing_id = 1 and availability = 'in'
          and (observed_at,id) > ('2026-11-01',1) and (observed_at,id) < ('2026-12-01',2)
          order by observed_at,id limit 1`,
      ]) {
        const plan = db.orm.all<{ detail: string }>(sql`explain query plan ${query}`);
        expect(plan.map((p) => p.detail).join(' ')).toMatch(
          /SEARCH .*listing_id=\? AND availability=\? AND observed_at/,
        );
      }
      expect(db.orm.get(sql`select count(*) as n from price_observation`)).toEqual(count);
    } finally {
      db.close();
    }
  });
});

describe('MIGRATIONS', () => {
  // The SQL files are the versioned source (S§4); src/migrations.ts embeds them so the bundled
  // server needs no file beside it. Regenerate with `pnpm --filter @agentic-dasher/db migrations:embed`.
  it('embeds every file in migrations/ verbatim, numbered from 1', () => {
    const folder = join(import.meta.dirname, '..', 'migrations');
    const files = readdirSync(folder)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect(MIGRATIONS.map((m) => `${m.name}.sql`)).toEqual(files);
    MIGRATIONS.forEach((m, i) => {
      expect(m.version).toBe(i + 1);
      expect(m.name.startsWith(String(i + 1).padStart(4, '0'))).toBe(true);
      expect(m.sql).toBe(readFileSync(join(folder, `${m.name}.sql`), 'utf8'));
    });
  });
});
