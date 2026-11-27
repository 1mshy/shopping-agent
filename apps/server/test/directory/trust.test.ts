import { schema } from '@agentic-dasher/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createWatchRoutes, createWatchService } from '../../src/watches/index.ts';
import { CA, Clock, insertStore, TempDb } from '../sweep/harness.ts';

let tmp: TempDb;
beforeEach(() => {
  tmp = new TempDb();
});
afterEach(() => tmp.dispose());

function intake() {
  const clock = new Clock();
  const deps = { db: tmp.db, now: clock.now, market: () => CA };
  const app = createWatchRoutes({
    ...deps,
    watches: createWatchService(deps),
    refresh: () => ({ runId: 1, joined: false }),
  });
  return (host: string, product: string) =>
    app.request('/watches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: `https://${host}/products/${product}` }),
    });
}
it('persists caution and the specific known host on pasted storefront intake, preserving subsequent owner decisions', async () => {
  const save = intake();
  insertStore(tmp.db, { host: 'northshop.ca', trustTier: 'known' });
  expect((await save('n0rthshop.ca', 'one')).status).toBe(201);
  const s = schema.store;
  const stored = () => tmp.db.orm.select().from(s).where(eq(s.host, 'n0rthshop.ca')).get();
  expect(stored()).toMatchObject({
    trustTier: 'caution',
    trustReasons: ['Hostname resembles known storefront northshop.ca'],
    source: 'pasted',
    isShop: 'unknown',
  });
  for (const trustTier of ['known', 'blocked', 'caution', 'unverified'] as const) {
    tmp.db.orm
      .update(s)
      .set({ trustTier, trustReasons: ['owner decision'] })
      .where(eq(s.host, 'n0rthshop.ca'))
      .run();
    expect((await save('n0rthshop.ca', trustTier)).status).toBe(201);
    expect(stored()).toMatchObject({ trustTier, trustReasons: ['owner decision'] });
  }
});

it('requires a locally known reference, leaves ordinary differences and other suffixes unverified', async () => {
  const save = intake();
  insertStore(tmp.db, { host: 'northshop.ca', trustTier: 'caution' });
  insertStore(tmp.db, { host: 'northshop.org', trustTier: 'known' });
  for (const host of ['n0rthshop.ca', 'northshopp.org', 'northshop.example']) {
    expect((await save(host, 'item')).status).toBe(201);
    expect(
      tmp.db.orm.select().from(schema.store).where(eq(schema.store.host, host)).get(),
    ).toMatchObject({ trustTier: 'unverified', trustReasons: [] });
  }
});

it.each(['www.n0rthshop.ca', 'www.n0rthshop.ca.'])(
  'recognises an exact known alias %s before assigning a look-alike signal',
  async (host) => {
    const save = intake();
    insertStore(tmp.db, { host, trustTier: 'known' });
    insertStore(tmp.db, { host: 'northshop.ca', trustTier: 'known' });
    expect((await save('n0rthshop.ca', 'item')).status).toBe(201);
    expect(
      tmp.db.orm.select().from(schema.store).where(eq(schema.store.host, 'n0rthshop.ca')).get(),
    ).toMatchObject({ trustTier: 'unverified', trustReasons: [] });
  },
);

it('retains the spelling of a fully qualified known host in its reason', async () => {
  const save = intake();
  insertStore(tmp.db, { host: 'www.northshop.ca.', trustTier: 'known' });
  expect((await save('n0rthshop.ca', 'item')).status).toBe(201);
  expect(
    tmp.db.orm.select().from(schema.store).where(eq(schema.store.host, 'n0rthshop.ca')).get(),
  ).toMatchObject({
    trustTier: 'caution',
    trustReasons: ['Hostname resembles known storefront www.northshop.ca.'],
  });
});
