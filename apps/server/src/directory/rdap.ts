// S§5.5, RFC 9083 §§4.5 and 5.3. Retain the registration event only. RDAP records
// may also contain contact details, notices and text supplied by the domain holder.
import { type Database, schema } from '@agentic-dasher/db';
import { createRequestBudget, type Fetcher, type RequestBudget } from '@agentic-dasher/fetch';
import { and, eq, ne } from 'drizzle-orm';
import { parse } from 'tldts';
import { z } from 'zod';

const EVENT_TIME = z.iso.datetime({ offset: true });
const RATE_WINDOW = 10_000;
const MAX_STARTS = 10;

function registrationDomain(host: string): string | null {
  const name = host.toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9.-]+$/.test(name)) return null;
  const parsed = parse(name, {
    allowPrivateDomains: true,
    extractHostname: false,
    validateHostname: true,
  });
  return parsed.isIcann && !parsed.isPrivate && !parsed.isIp ? parsed.domain : null;
}

function wireAllowance(db: Database, now: () => number): RequestBudget {
  const local = createRequestBudget(4);
  const ledger = schema.rdapRequestStart;
  return {
    maxRequests: local.maxRequests,
    get used() {
      return local.used;
    },
    get remaining() {
      return local.remaining;
    },
    take() {
      if (!local.remaining) return false;
      return db.orm.transaction(
        (tx) => {
          const timestamp = now();
          const recent = tx
            .select()
            .from(ledger)
            .all()
            .filter((r) => Date.parse(r.startedAt) > timestamp - RATE_WINDOW);
          const occupied = new Set(recent.map((r) => r.slot));
          let slot = 0;
          while (occupied.has(slot)) slot++;
          if (slot === MAX_STARTS) return false;
          const startedAt = new Date(timestamp).toISOString();
          tx.insert(ledger)
            .values({ slot, startedAt })
            .onConflictDoUpdate({ target: ledger.slot, set: { startedAt } })
            .run();
          return local.take();
        },
        { behavior: 'immediate' },
      );
    },
    // The fetcher takes this allowance immediately before the transport exchange.
    // A connection failure is still a start and never refunds a rate-window slot.
    refund() {},
  };
}

const domainRecord = z.object({
  objectClassName: z.literal('domain'),
  ldhName: z.string(),
  events: z
    .array(z.object({ eventAction: z.string(), eventDate: z.string().optional() }))
    .optional(),
});
type Registration = { registeredAt: string | null };
async function lookup(
  domain: string,
  db: Database,
  fetcher: Fetcher,
  now: () => number,
  deadline: number,
  signal: AbortSignal,
): Promise<Registration | null> {
  let url = new URL(`https://rdap.org/domain/${domain}`);
  const wireBudget = wireAllowance(db, now);
  // The loop is bounded independently of whether an injected fetcher spends wire budget.
  for (let hop = 0; hop < 4; hop++) {
    const { outcome, response } = await fetcher.get({
      url: url.href,
      rung: 'api',
      pageKind: 'api',
      redirect: 'manual',
      credentials: 'omit',
      maxBodyBytes: 256 * 1024,
      deadline,
      signal,
      wireBudget,
    });
    if (!response) return null;
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.location;
      const next = location ? URL.parse(location, url) : null;
      if (next?.protocol !== 'https:' || next.username || next.password) return null;
      url = next;
      continue;
    }
    if (outcome.kind !== 'ok' && outcome.kind !== 'not_found') return null;
    let json: unknown;
    try {
      json = JSON.parse(response.text);
    } catch {
      return null;
    }
    // The bootstrap server's 404 can mean that no registry service is known.
    if (outcome.kind === 'not_found')
      return url.hostname !== 'rdap.org' &&
        z.object({ errorCode: z.literal(404) }).safeParse(json).success
        ? { registeredAt: null }
        : null;
    const parsed = domainRecord.safeParse(json);
    if (!parsed.success || parsed.data.ldhName.toLowerCase().replace(/\.$/, '') !== domain)
      return null;
    const dates = new Set<string>();
    for (const event of parsed.data.events ?? []) {
      if (event.eventAction !== 'registration') continue;
      if (!event.eventDate || !EVENT_TIME.safeParse(event.eventDate).success) return null;
      const epoch = Date.parse(event.eventDate);
      if (!Number.isFinite(epoch) || epoch > now()) return null;
      dates.add(new Date(epoch).toISOString());
    }
    return dates.size > 1 ? null : { registeredAt: dates.values().next().value ?? null };
  }
  return null;
}

export function createRdapTrust({
  db,
  fetcher,
  now = Date.now,
}: {
  db: Database;
  fetcher: Fetcher;
  now?: () => number;
}) {
  const stores = schema.store;
  const cache = schema.domainRegistration;
  const pending = new WeakMap<AbortSignal, Map<string, Promise<Registration | null>>>();
  async function enrich(
    storeId: number,
    options: { deadline: number; signal: AbortSignal },
  ): Promise<void> {
    const row = db.orm
      .select({ host: stores.host, tier: stores.trustTier })
      .from(stores)
      .where(eq(stores.id, storeId))
      .get();
    if (!row || row.tier === 'blocked' || options.signal.aborted) return;
    const domain = registrationDomain(row.host);
    if (!domain) return;
    let result: Registration | null | undefined = db.orm
      .select()
      .from(cache)
      .where(eq(cache.domain, domain))
      .get();
    if (!result) {
      if (now() >= options.deadline) return;
      // A later call retries a transient failure. Multiple independent store rows can
      // share one registrable domain, including different marketplace regions.
      let related = pending.get(options.signal);
      if (!related) {
        related = new Map();
        pending.set(options.signal, related);
      }
      const key = JSON.stringify([domain, options.deadline]);
      let task = related.get(key);
      if (!task) {
        task = lookup(
          domain,
          db,
          fetcher,
          now,
          Math.min(options.deadline, now() + 10_000),
          options.signal,
        ).finally(() => related.delete(key));
        related.set(key, task);
      }
      result = await task;
    }
    if (!result || options.signal.aborted) return;
    const fetchedAt = new Date(now()).toISOString();
    db.orm.transaction(
      (tx) => {
        const current = tx
          .select()
          .from(stores)
          .where(
            and(eq(stores.id, storeId), eq(stores.host, row.host), ne(stores.trustTier, 'blocked')),
          )
          .get();
        if (!current) return;
        tx.insert(cache)
          .values({ domain, registeredAt: result.registeredAt, fetchedAt })
          .onConflictDoNothing()
          .run();
        const stored = tx.select().from(cache).where(eq(cache.domain, domain)).get();
        if (!stored || !Array.isArray(current.trustReasons)) return;
        const reason = stored.registeredAt
          ? `RDAP lists ${domain} as registered on ${stored.registeredAt.slice(0, 10)} (UTC)`
          : `RDAP provides no registration date for ${domain}`;
        if (!current.trustReasons.includes(reason))
          tx.update(stores)
            .set({ trustReasons: [...current.trustReasons, reason] })
            .where(eq(stores.id, storeId))
            .run();
      },
      { behavior: 'immediate' },
    );
  }
  return { enrich };
}
