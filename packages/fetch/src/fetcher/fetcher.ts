// The composed fetcher (S§5.1): the one way the readers and the watches reach the network. Around
// `fetchPage`, which holds the guard and the transport, it puts what S§5.1 asks of every request,
// in this order:
//   1. robots.txt, unless the setting is `ignore` (fetched through this same paced path);
//   2. the playbook's gate: a rung walled for the host and page kind, still backing off, is not
//      tried (`refused_by_policy{host_limit}`, with when it opens);
//   3. pacing: the host's turn, its next start, a place in the pool (`host_limit` when the deadline
//      comes first);
//   4. the run's request budget (`budget`);
//   5. `fetchPage`: the guard and the request;
//   6. the playbook, from the outcome (only `ok`, `wall` and `empty` change it).
// It adds refusals and never a way around the guard: every request it makes is a `fetchPage` call,
// and it watches the transport only to learn when a request first reaches the network (the
// pacing's "start").
//
// One fetcher per process: its pacer is what keeps one request in flight per host.
import {
  changesPlaybook,
  type FetchOutcome,
  PageKind,
  type PolicyRefusalReason,
} from '@agentic-dasher/shared';
import type { CookieJars } from '../cookies/index.ts';
import { type OwnNetwork, parseTarget } from '../guard/index.ts';
import {
  createPacer,
  hostKey,
  type Pacer,
  type PacingStore,
  RATE_LIMITED_DEFAULT_PAUSE_MS,
  type Sleep,
  timerSleep,
} from '../pacing/index.ts';
import {
  type Classify,
  fetchPage,
  type HttpRung,
  type PageRequest,
  type PageResult,
} from '../page/index.ts';
import { closedUntil, type PlaybookStore, recordOutcome } from '../playbook/index.ts';
import {
  createRobotsCache,
  ROBOTS_MODES,
  ROBOTS_RUNG,
  type RobotsCache,
  type RobotsCheck,
  type RobotsMode,
  robotsUrlOf,
  robotsVerdict,
} from '../robots/index.ts';
import { ABORT_CODE, type HttpNetwork, TIMEOUT_CODE } from '../transport/index.ts';
import type { RequestBudget } from './budget.ts';

export interface FetcherDeps {
  /** The network: `createHttpNetwork()` for real, a scripted one in tests. */
  readonly network: HttpNetwork;
  readonly jars: CookieJars;
  /** The wall classifier (fetchPage's hook). */
  readonly classify?: Classify;
  readonly maxRedirects?: number;
  readonly deniedNetworks?: readonly OwnNetwork[];
  /** `host_pacing`: `sqlitePacingStore(db)`, or `memoryPacingStore()`. */
  readonly pacing: PacingStore;
  /** `host_access`: `sqlitePlaybookStore(db)`, or `memoryPlaybookStore()`. */
  readonly playbook: PlaybookStore;
  /** The robots setting, asked once per request (the settings unit backs it with the database). */
  readonly robotsMode: () => RobotsMode | Promise<RobotsMode>;
  /** Epoch milliseconds; also the clock of deadlines, pacing and the playbook. */
  readonly now?: () => number;
  readonly sleep?: Sleep;
  /** Uniform in [0, 1): the pacing jitter. */
  readonly random?: () => number;
  /** Hosts in flight at once (default `HTTP_HOST_POOL`). */
  readonly maxHosts?: number;
  /** A store write that failed after a request was made; the result is returned regardless. */
  readonly onStoreError?: (error: unknown) => void;
  /** The robots.txt cache (default: a new one per fetcher). */
  readonly robotsCache?: RobotsCache;
}

export interface FetcherRequest {
  readonly url: string;
  readonly rung: HttpRung;
  /** The playbook's page kind: `api` for a platform endpoint, `product` or `search` for a page. */
  readonly pageKind: PageKind;
  /** Epoch milliseconds: waiting and the request itself end by then. */
  readonly deadline: number;
  readonly signal: AbortSignal;
  /** Same-site Referer, `http` rung only (fetchPage drops it elsewhere). */
  readonly referer?: string;
  readonly maxBodyBytes?: number;
  /** The run's request budget, shared by its requests (`createRequestBudget`). */
  readonly budget?: RequestBudget;
  /** Optional hard limit on transport exchanges, including robots, redirects and address retries. */
  readonly wireBudget?: RequestBudget;
}

export interface FetcherResult extends PageResult {
  /** The robots.txt check; null when the setting is `ignore` or no check was made. */
  readonly robots: RobotsCheck | null;
  /**
   * For a `host_limit` refusal, when the host (or the rung, for the playbook) opens again, epoch
   * ms; null when not known (the pool was full until the deadline) or for any other outcome.
   */
  readonly closedUntil: number | null;
}

export interface Fetcher {
  get(request: FetcherRequest): Promise<FetcherResult>;
}

interface Paced {
  readonly result: PageResult;
  /** True when the transport was asked to reach the host. */
  readonly reached: boolean;
  readonly closedUntil: number | null;
}

const warn = (error: unknown) => {
  console.warn('fetch: a playbook or pacing write failed; the result stands', error);
};

/** A network that reaches nothing, for a URL the guard refuses before any connection. */
const NO_NETWORK: HttpNetwork = {
  open: () => {
    const refuse = () =>
      Promise.reject(Object.assign(new Error('not paced'), { code: 'ERR_NOT_PACED' }));
    return { lookup: refuse, exchange: refuse };
  },
};

/** Invoke beforeExchange before each call to the transport, including redirects and address retries. */
function watched(network: HttpNetwork, beforeExchange: () => void): HttpNetwork {
  return {
    open(context) {
      const net = network.open(context);
      return {
        lookup: (host) => net.lookup(host),
        exchange: (address, port, url) => {
          beforeExchange();
          return net.exchange(address, port, url);
        },
      };
    },
  };
}

function pageRequestOf(request: {
  readonly url: string;
  readonly rung: HttpRung;
  readonly deadline: number;
  readonly signal: AbortSignal;
  readonly referer?: string | undefined;
  readonly maxBodyBytes?: number | undefined;
}): PageRequest {
  const base = {
    url: request.url,
    deadline: request.deadline,
    signal: request.signal,
    ...(request.maxBodyBytes !== undefined ? { maxBodyBytes: request.maxBodyBytes } : {}),
  };
  return request.rung === 'api'
    ? { ...base, rung: 'api' }
    : {
        ...base,
        rung: 'http',
        ...(request.referer !== undefined ? { referer: request.referer } : {}),
      };
}

export function createFetcher(deps: FetcherDeps): Fetcher {
  const now = deps.now ?? Date.now;
  const onStoreError = deps.onStoreError ?? warn;
  const pacer: Pacer = createPacer({
    store: deps.pacing,
    now,
    sleep: deps.sleep ?? timerSleep,
    random: deps.random ?? Math.random,
    onStoreError,
    ...(deps.maxHosts !== undefined ? { maxHosts: deps.maxHosts } : {}),
  });
  const robotsCache = deps.robotsCache ?? createRobotsCache({ now });
  const pageDeps = (network: HttpNetwork) => ({
    network,
    jars: deps.jars,
    now,
    ...(deps.classify !== undefined ? { classify: deps.classify } : {}),
    ...(deps.deniedNetworks ? { deniedNetworks: deps.deniedNetworks } : {}),
    ...(deps.maxRedirects !== undefined ? { maxRedirects: deps.maxRedirects } : {}),
  });

  /** Steps 3-5: pacing, the budget, then fetchPage. */
  async function paced(
    host: string,
    request: PageRequest,
    budget: RequestBudget | undefined,
    wireBudget: RequestBudget | undefined,
  ): Promise<Paced> {
    const { rung } = request;
    const admission = await pacer.acquire(host, request);
    if (admission.kind === 'aborted') {
      return {
        result: { outcome: { kind: 'network_error', rung, code: ABORT_CODE }, response: null },
        reached: false,
        closedUntil: null,
      };
    }
    if (admission.kind === 'closed') {
      return {
        result: { outcome: refusal(rung, 'host_limit'), response: null },
        reached: false,
        closedUntil: admission.until,
      };
    }
    const { slot } = admission;
    try {
      if (budget !== undefined && !budget.take()) {
        return {
          result: { outcome: refusal(rung, 'budget'), response: null },
          reached: false,
          closedUntil: null,
        };
      }
      let reached = false;
      let exhausted = false;
      const network = watched(deps.network, () => {
        if (wireBudget !== undefined && !wireBudget.take()) {
          exhausted = true;
          // End the guarded exchange without trying an alternative address or opening a socket.
          throw new Error('transport exchange budget exhausted');
        }
        if (reached) return;
        reached = true;
        slot.started();
      });
      let result: PageResult;
      try {
        result = await fetchPage(request, pageDeps(network));
      } finally {
        if (!reached) budget?.refund();
      }
      if (exhausted) result = { outcome: refusal(rung, 'budget'), response: null };
      if (result.outcome.kind === 'rate_limited') {
        slot.pause(result.outcome.retryAfterMs ?? RATE_LIMITED_DEFAULT_PAUSE_MS);
      }
      return { result, reached, closedUntil: null };
    } finally {
      slot.release();
    }
  }

  return {
    async get(request) {
      const { rung, deadline, signal, budget, wireBudget } = request;
      if (rung !== 'api' && rung !== 'http')
        throw new RangeError(`not an HTTP rung: ${String(rung)}`);
      const pageKind = PageKind.parse(request.pageKind);
      if (!Number.isFinite(deadline))
        throw new RangeError(`deadline must be a number: ${deadline}`);
      const pageRequest = pageRequestOf(request);
      const done = (
        outcome: FetchOutcome,
        extra: Partial<Pick<FetcherResult, 'robots' | 'closedUntil'>> = {},
      ): FetcherResult => ({ outcome, response: null, robots: null, closedUntil: null, ...extra });

      if (signal.aborted) return done({ kind: 'network_error', rung, code: ABORT_CODE });
      if (now() >= deadline) return done({ kind: 'network_error', rung, code: TIMEOUT_CODE });
      if ((budget !== undefined && budget.remaining <= 0) || wireBudget?.remaining === 0)
        return done(refusal(rung, 'budget'));

      const parsed = parseTarget(request.url);
      if (!parsed.ok) {
        // The guard refuses this URL before any lookup or connection; fetchPage says so in the
        // guard's own words. The network handed to it reaches nothing, whatever happens.
        const result = await fetchPage(pageRequest, pageDeps(NO_NETWORK));
        return { ...result, robots: null, closedUntil: null };
      }
      const target = parsed.target;
      const host = hostKey(target);

      // 1. robots.txt
      let robots: RobotsCheck | null = null;
      const mode = await deps.robotsMode();
      if (!(ROBOTS_MODES as readonly string[]).includes(mode)) {
        throw new RangeError(`not a robots mode: ${String(mode)}`);
      }
      if (mode !== 'ignore') {
        const robotsUrl = robotsUrlOf(target.href);
        const robotsRequest = pageRequestOf({
          url: robotsUrl,
          rung: ROBOTS_RUNG,
          deadline,
          signal,
        });
        const { answer, cached } = await robotsCache.answer(robotsUrl, async () => {
          return (await paced(host, robotsRequest, budget, wireBudget)).result;
        });
        robots = {
          mode,
          robotsUrl,
          state: answer.state,
          verdict: robotsVerdict(answer, target.href),
          outcome: answer.outcome,
          cached,
        };
        if (mode === 'respect') {
          if (robots.verdict === 'disallowed') return done(refusal(rung, 'robots'), { robots });
          // Permission could not be established because the network failed: the request ends
          // with that failure and is not made (see robots/policy.ts).
          if (answer.state === 'failed' && answer.outcome.kind === 'network_error') {
            return done({ kind: 'network_error', rung, code: answer.outcome.code }, { robots });
          }
        }
      }

      // A robots fetch can spend the final exchange. Avoid waiting for a host that cannot be contacted.
      if (wireBudget?.remaining === 0) return done(refusal(rung, 'budget'), { robots });

      // 2. The playbook's gate.
      const until = closedUntil(deps.playbook.read(host, pageKind), rung, now());
      if (until !== null) {
        return done(refusal(rung, 'host_limit'), { robots, closedUntil: until });
      }

      // 3-5. Pacing, budget, fetchPage.
      const result = await paced(host, pageRequest, budget, wireBudget);

      // 6. The playbook.
      if (result.reached && changesPlaybook(result.result.outcome)) {
        try {
          const key = { host, pageKind };
          const next = recordOutcome(
            deps.playbook.read(host, pageKind),
            key,
            result.result.outcome,
            now(),
          );
          if (next !== null) deps.playbook.write(next);
        } catch (error) {
          onStoreError(error);
        }
      }
      return { ...result.result, robots, closedUntil: result.closedUntil };
    },
  };
}

function refusal(rung: HttpRung, reason: PolicyRefusalReason): FetchOutcome {
  return { kind: 'refused_by_policy', rung, reason };
}

/** What `ReaderContext.get` asks (packages/sources/src/read/contract.ts). */
export interface ReaderGetRequest {
  readonly url: string;
  readonly rung: HttpRung;
  readonly referer?: string;
}

/** What a read binds once for all its requests. */
export interface ReadBinding {
  /** The page kind of an `http` request (`product` or `search`); an `api` request is `api`. */
  readonly pageKind: Exclude<PageKind, 'api'>;
  readonly deadline: number;
  readonly signal: AbortSignal;
  readonly budget?: RequestBudget;
}

/**
 * The fetcher's `get` bound to one read: usable as `ReaderContext.get`. A platform endpoint
 * (`api` rung) is kept in the playbook as page kind `api`, a page under the bound kind.
 */
export function bindReaderGet(
  fetcher: Fetcher,
  binding: ReadBinding,
): (request: ReaderGetRequest) => Promise<FetcherResult> {
  return (request) =>
    fetcher.get({
      url: request.url,
      rung: request.rung,
      pageKind: request.rung === 'api' ? 'api' : binding.pageKind,
      deadline: binding.deadline,
      signal: binding.signal,
      ...(request.referer !== undefined ? { referer: request.referer } : {}),
      ...(binding.budget !== undefined ? { budget: binding.budget } : {}),
    });
}
