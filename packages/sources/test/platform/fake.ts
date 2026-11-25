// A scripted ReaderContext: answers by exact URL, records every request, and makes no network
// request of any kind. An unscripted URL answers 404, as a real host does for an unknown path.
import { readFileSync } from 'node:fs';
import type { PageResult } from '@agentic-dasher/fetch';
import type { FetchOutcome } from '@agentic-dasher/shared';
import { expect } from 'vitest';
import type { ReaderContext, ReaderOutcome, ReadRequest } from '../../src/read/contract.ts';

export interface Reply {
  readonly status?: number;
  readonly body?: string;
  readonly setCookies?: readonly string[];
  readonly contentType?: string;
  /** Overrides the outcome the status would give (a wall, a policy refusal, a network error). */
  readonly outcome?: FetchOutcome;
}

export interface Sent {
  readonly url: string;
  readonly rung: 'api' | 'http';
}

export function fixture(path: string): string {
  return readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf8');
}

function outcomeFor(status: number): FetchOutcome {
  if (status >= 200 && status <= 299) return { kind: 'ok', rung: 'api' };
  if (status === 404 || status === 410) return { kind: 'not_found', rung: 'api' };
  if (status === 401) return { kind: 'login_required', rung: 'api' };
  if (status === 429) return { kind: 'rate_limited', rung: 'api', retryAfterMs: 30_000 };
  if (status >= 500) return { kind: 'server_error', rung: 'api' };
  return { kind: 'network_error', rung: 'api', code: `HTTP_${status}` };
}

export function fakeContext(routes: Readonly<Record<string, Reply>>): {
  context: ReaderContext;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  const context: ReaderContext = {
    async get(request): Promise<PageResult> {
      sent.push({ url: request.url, rung: request.rung });
      const reply: Reply = Object.hasOwn(routes, request.url)
        ? (routes[request.url] as Reply)
        : { status: 404, body: '<html><title>404 Not Found</title></html>' };
      const status = reply.status ?? 200;
      const outcome = reply.outcome ?? outcomeFor(status);
      if (outcome.kind === 'network_error' && reply.status === undefined) {
        return { outcome, response: null };
      }
      const text = reply.body ?? '';
      const contentType = reply.contentType ?? 'application/json; charset=utf-8';
      return {
        outcome,
        response: {
          status,
          finalUrl: request.url,
          headers: { 'content-type': contentType },
          setCookies: reply.setCookies ?? [],
          contentType,
          body: new TextEncoder().encode(text),
          text,
        },
      };
    },
    now: () => Date.UTC(2026, 10, 24, 12, 0, 0),
  };
  return { context, sent };
}

export const MARKET_CA = { country: 'CA', currency: 'CAD', language: 'en-CA' } as const;

export function request(url: string, extra: Partial<ReadRequest> = {}): ReadRequest {
  return { url, market: MARKET_CA, store: null, variant: null, ...extra };
}

/** The S§4.1 rules every read must keep, checked on any outcome. */
export function expectValidOutcome(outcome: ReaderOutcome): void {
  const candidates =
    outcome.kind === 'read'
      ? outcome.read.candidates
      : outcome.kind === 'no_read'
        ? outcome.candidates
        : [];
  expect(candidates.length).toBeLessThanOrEqual(20);
  for (const c of candidates) {
    expect(c.method).toBe('platform_json');
    expect(c.confidence).toBeGreaterThanOrEqual(0);
    expect(c.confidence).toBeLessThanOrEqual(1);
    expect(c.value.length).toBeGreaterThanOrEqual(1);
    expect(c.value.length).toBeLessThanOrEqual(256);
  }
  if (outcome.kind !== 'read') return;
  const r = outcome.read;
  const amounts = [r.sticker, r.referenceClaimed, r.coupon, r.memberPrice, r.shipping, r.unitPrice];
  if (r.currency === 'unknown') {
    for (const amount of amounts) expect(amount).toBeNull();
    // A row with no price needs the figures as text, or an out-of-stock signal (S§4.1).
    if (r.availability !== 'out') expect(r.candidates.length).toBeGreaterThan(0);
  }
  for (const amount of amounts) {
    if (amount !== null) expect(Number.isSafeInteger(amount) && amount >= 0).toBe(true);
  }
  if (r.sticker !== null) expect(r.candidates.length).toBeGreaterThan(0);
  if (r.sticker === null && r.currency !== 'unknown') expect(r.availability).toBe('out');
  expect(r.rung).toBe('api');
  expect(r.method).toBe('platform_json');
  expect(r.shippingStatus).toBe('unknown');
  expect(r.shipping).toBeNull();
  expect(r.condition).toBe('unknown');
  expect(r.taxIncluded).toBeNull();
}

export function expectRead(outcome: ReaderOutcome) {
  expectValidOutcome(outcome);
  if (outcome.kind !== 'read') throw new Error(`expected a read, got ${JSON.stringify(outcome)}`);
  return outcome.read;
}

export function expectNoRead(outcome: ReaderOutcome) {
  expectValidOutcome(outcome);
  if (outcome.kind !== 'no_read') {
    throw new Error(`expected no_read, got ${JSON.stringify(outcome)}`);
  }
  return outcome;
}
