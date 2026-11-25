// The wall classifier as fetchPage's Classify hook, on the api and http rungs, through the real
// guard on a scripted network (no real lookup, no connection).
import { describe, expect, it } from 'vitest';
import { CookieJars } from '../../src/cookies/index.ts';
import {
  type ClassifyInput,
  fetchPage,
  type PageFetcherDeps,
  type PageRequest,
} from '../../src/page/index.ts';
import { bodyKind, classifyResponse } from '../../src/walls/index.ts';
import type { PageReply } from '../page/net.ts';
import { scriptedNetwork } from '../page/net.ts';
import {
  AKAMAI_ACCESS_DENIED,
  AMAZON_CONTINUE_SHOPPING,
  CLOUDFLARE_CHALLENGE,
  CLOUDFLARE_HEADERS,
  DATADOME_HEADERS,
  datadomePage,
  productPage,
} from './fixtures.ts';

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const HOSTS = { 'shop.test': ['93.184.215.14'], 'www.amazon.ca': ['93.184.215.15'] };
const URL_ = 'https://shop.test/p/1';

async function read(
  reply: PageReply,
  rung: 'api' | 'http' = 'http',
  url = URL_,
  extra: Partial<PageFetcherDeps> = {},
) {
  const net = scriptedNetwork({ dns: HOSTS, replies: { [url]: reply } });
  const deps: PageFetcherDeps = {
    network: net.network,
    jars: new CookieJars(),
    now: () => NOW,
    classify: classifyResponse,
    ...extra,
  };
  const request: PageRequest = {
    rung,
    url,
    deadline: NOW + 10_000,
    signal: new AbortController().signal,
  };
  return fetchPage(request, deps);
}

const html = (status: number, body: string, headers: [string, string][] = []): PageReply => ({
  status,
  headers: [['content-type', 'text/html; charset=utf-8'], ...headers],
  body: [body],
});

const json = (status: number, body: unknown, headers: [string, string][] = []): PageReply => ({
  status,
  headers: [['content-type', 'application/json'], ...headers],
  body: [JSON.stringify(body)],
});

describe('classifyResponse through fetchPage', () => {
  it("names Cloudflare's challenge on the http rung", async () => {
    const result = await read({
      status: 403,
      headers: [...CLOUDFLARE_HEADERS],
      body: [CLOUDFLARE_CHALLENGE],
    });
    expect(result.outcome).toEqual({
      kind: 'wall',
      rung: 'http',
      vendor: 'cloudflare',
      mode: 'challenge',
    });
  });

  it("names DataDome's captcha and Akamai's Access Denied", async () => {
    const datadome = await read({
      status: 403,
      headers: [...DATADOME_HEADERS],
      body: [datadomePage('c', 'shop.test')],
    });
    expect(datadome.outcome).toEqual({
      kind: 'wall',
      rung: 'http',
      vendor: 'datadome',
      mode: 'captcha',
    });
    const akamai = await read(html(403, AKAMAI_ACCESS_DENIED));
    expect(akamai.outcome).toEqual({
      kind: 'wall',
      rung: 'http',
      vendor: 'akamai',
      mode: 'access_denied',
    });
  });

  it("calls Amazon's interstitial served with 200 a wall of Amazon's", async () => {
    const result = await read(
      html(200, AMAZON_CONTINUE_SHOPPING),
      'http',
      'https://www.amazon.ca/dp/B0BKVY4WKT',
    );
    expect(result.outcome).toEqual({
      kind: 'wall',
      rung: 'http',
      vendor: 'amazon',
      mode: 'challenge',
    });
  });

  it('reads a store page that mentions every wall word as ok', async () => {
    const mention =
      'Robot or human? Just a moment... Access Denied. Verify you are a human. Enter the characters you see below. Press & Hold.';
    const result = await read(html(200, productPage({ mention })));
    expect(result.outcome).toEqual({ kind: 'ok', rung: 'http' });
  });

  it('a 404 page with wall copy is not found', async () => {
    const result = await read(
      html(404, AMAZON_CONTINUE_SHOPPING),
      'http',
      'https://www.amazon.ca/dp/X',
    );
    expect(result.outcome).toEqual({ kind: 'not_found', rung: 'http' });
  });

  it('a JSON answer is never a wall because of words inside it', async () => {
    const words = {
      title: 'Just a moment...',
      body: 'Access Denied. Robot or human? Enter the characters you see below.',
      html: '<title>Access to this page has been denied</title><div id="px-captcha"></div>',
      captcha: 'https://geo.captcha-delivery.com/captcha/',
    };
    const result = await read(json(200, words), 'api');
    expect(result.outcome).toEqual({ kind: 'ok', rung: 'api' });
    // Served as HTML by mistake, a body that starts like JSON is still read as JSON.
    const mislabelled = await read(html(200, JSON.stringify(words)), 'api');
    expect(mislabelled.outcome).toEqual({ kind: 'ok', rung: 'api' });
  });

  it('an HTML challenge served where JSON was asked for is a wall', async () => {
    const result = await read(
      { status: 403, headers: [...CLOUDFLARE_HEADERS], body: [CLOUDFLARE_CHALLENGE] },
      'api',
    );
    expect(result.outcome).toEqual({
      kind: 'wall',
      rung: 'api',
      vendor: 'cloudflare',
      mode: 'challenge',
    });
    // Even when it claims to be JSON and its status says nothing.
    const claimed = await read(
      { status: 200, headers: [['content-type', 'application/json']], body: [datadomePage('c')] },
      'api',
    );
    expect(claimed.outcome).toEqual({
      kind: 'wall',
      rung: 'api',
      vendor: 'datadome',
      mode: 'captcha',
    });
  });

  it("a bot manager's verdict header makes even a JSON answer a wall", async () => {
    const result = await read(
      json(429, { error: 'checkpoint' }, [['x-vercel-mitigated', 'challenge']]),
      'api',
    );
    expect(result.outcome).toEqual({
      kind: 'wall',
      rung: 'api',
      vendor: 'vercel',
      mode: 'challenge',
    });
  });

  it('a bare 403 stays a wall of unknown vendor, JSON or HTML', async () => {
    const jsonForbidden = await read(json(403, { message: 'GraphQL is disabled.' }), 'api');
    expect(jsonForbidden.outcome).toEqual({
      kind: 'wall',
      rung: 'api',
      vendor: null,
      mode: 'challenge',
    });
    const htmlForbidden = await read(
      html(
        403,
        '<html><head><title>403 Forbidden</title></head><body><h1>403 Forbidden</h1></body></html>',
      ),
    );
    expect(htmlForbidden.outcome).toEqual({
      kind: 'wall',
      rung: 'http',
      vendor: null,
      mode: 'challenge',
    });
  });

  it('leaves the other statuses to fetchPage: Retry-After, login, server error, 451', async () => {
    const limited = await read(html(429, '<p>Slow down</p>', [['retry-after', '120']]));
    expect(limited.outcome).toEqual({ kind: 'rate_limited', rung: 'http', retryAfterMs: 120_000 });
    expect((await read(html(401, '<p>Sign in</p>'))).outcome.kind).toBe('login_required');
    expect((await read(html(503, '<p>Down for maintenance</p>'))).outcome.kind).toBe(
      'server_error',
    );
    const legal = await read({
      status: 451,
      headers: [['content-type', 'text/plain']],
      body: ['This content has been blocked for legal reasons'],
    });
    expect(legal.outcome).toEqual({ kind: 'network_error', rung: 'http', code: 'HTTP_451' });
  });

  it('a 2xx with nothing to read is empty; a small page with a few words is ok', async () => {
    expect((await read({ status: 200, body: [] })).outcome).toEqual({
      kind: 'empty',
      rung: 'http',
    });
    expect((await read(json(200, ''), 'api')).outcome).toEqual({ kind: 'ok', rung: 'api' });
    expect((await read(html(200, '<html><body> </body></html>'))).outcome).toEqual({
      kind: 'empty',
      rung: 'http',
    });
    const words = `<html><body><p>${'A short product page. '.repeat(4)}</p></body></html>`;
    expect((await read(html(200, words))).outcome).toEqual({ kind: 'ok', rung: 'http' });
  });

  it('a client-rendered shell with no visible text but a large document is not empty', async () => {
    const shell = `<html><head><script type="application/ld+json">${JSON.stringify({ offers: { price: 'x'.repeat(6_000) } })}</script></head><body><div id="root"></div></body></html>`;
    expect((await read(html(200, shell))).outcome).toEqual({ kind: 'ok', rung: 'http' });
  });
});

describe('classifyResponse on its own', () => {
  const input = (fields: Partial<ClassifyInput>): ClassifyInput => {
    const text = fields.text ?? '';
    return {
      rung: 'http',
      status: 200,
      finalUrl: URL_,
      headers: {},
      setCookies: [],
      contentType: 'text/html',
      body: new TextEncoder().encode(text),
      text,
      ...fields,
    };
  };

  it('has no opinion on a readable page or a plain error', () => {
    expect(classifyResponse(input({ text: productPage({}) }))).toBeNull();
    expect(classifyResponse(input({ status: 500, text: '<p>Error</p>' }))).toBeNull();
    expect(classifyResponse(input({ status: 404, text: CLOUDFLARE_CHALLENGE }))).toBeNull();
  });

  it('never throws, even on input that breaks the reader', () => {
    const broken = input({ text: '<p>x</p>' });
    Object.defineProperty(broken, 'headers', {
      get() {
        throw new Error('boom');
      },
    });
    expect(classifyResponse(broken)).toBeNull();
  });

  it('tells HTML from JSON and the rest', () => {
    expect(bodyKind('text/html', '<!doctype html>')).toBe('html');
    expect(bodyKind(null, '﻿  <html>')).toBe('html');
    expect(bodyKind('application/json', '<html>')).toBe('html');
    expect(bodyKind('text/html', ' {"a":1}')).toBe('json');
    expect(bodyKind('application/json', '[]')).toBe('json');
    expect(bodyKind('application/xml', '<rss>')).toBe('other');
    expect(bodyKind('image/png', '\u0089PNG')).toBe('other');
    expect(bodyKind('text/html', ' \n ')).toBe('none');
  });
});
