// The pages below are hand-written test inputs shaped like the cases they name. They are not
// evidence about any real shop.
import { describe, expect, it } from 'vitest';
import { classify, detectWall, type HttpResponse } from './classify.ts';
import type { Validation } from './outcome.ts';

const res = (
  status: number,
  body: string,
  headers: Record<string, string> = {},
  finalUrl = 'https://shop.example/wp-json/wc/store/v1/products',
): HttpResponse => ({
  status,
  headers: new Headers({ 'content-type': 'text/html; charset=utf-8', ...headers }),
  finalUrl,
  body,
  bytes: body.length,
});
const page = (title: string, text = '') =>
  `<!doctype html><html><head><title>${title}</title></head><body>${text}</body></html>`;
const invalid: Validation = { valid: false, reason: 'not_json' };

describe('detectWall', () => {
  it('flags a Cloudflare challenge served with 200 by its title, not by status', () => {
    const r = res(200, page('Just a moment...'), { server: 'cloudflare', 'cf-ray': 'x' });
    expect(detectWall(r)).toMatchObject({ vendor: 'cloudflare', mode: 'challenge' });
  });

  it('trusts an explicit mitigation header on its own', () => {
    expect(detectWall(res(403, '', { 'cf-mitigated': 'challenge' }))).toMatchObject({
      vendor: 'cloudflare',
      mode: 'challenge',
    });
  });

  it('flags a wall shown only in the final URL', () => {
    const r = res(200, page('Shop'), {}, 'https://shop.example/.well-known/sgcaptcha/?r=%2F');
    expect(detectWall(r)).toMatchObject({ vendor: 'siteground', mode: 'challenge' });
  });

  it('flags a small 403 from a bot-manager vendor as a block', () => {
    const r = res(403, page('Forbidden'), { 'x-datadome': 'protected' });
    expect(detectWall(r)).toMatchObject({ vendor: 'datadome', mode: 'block' });
  });

  it('does not call a 404 page a wall even when it mentions a captcha', () => {
    const r = res(404, page('Page not found', 'Enter the characters you see below (captcha)'));
    expect(detectWall(r)).toBeUndefined();
  });

  it('does not match "Just a moment" in body text, only the title', () => {
    const r = res(200, page('Acme Outdoor', '<div class="loader">Just a moment...</div>'));
    expect(detectWall(r)).toBeUndefined();
  });

  it('does not call a plain Cloudflare-proxied 403 a wall without other evidence', () => {
    expect(detectWall(res(403, page('403 Forbidden'), { server: 'cloudflare' }))).toBeUndefined();
  });
});

describe('classify', () => {
  it('a valid payload is ok, and a valid empty one is empty', () => {
    const r = res(200, '[]', { 'content-type': 'application/json' });
    expect(classify(r, { valid: true, items: 3 }, 'woocommerce').outcome).toEqual({ kind: 'ok' });
    expect(classify(r, { valid: true, items: 0 }, 'woocommerce').outcome).toEqual({
      kind: 'empty',
    });
  });

  it('a 200 HTML challenge page is a wall, not a success', () => {
    const r = res(200, page('Attention Required! | Cloudflare'), { 'cf-ray': 'x' });
    expect(classify(r, invalid, 'woocommerce').outcome).toEqual({
      kind: 'wall',
      vendor: 'cloudflare',
      mode: 'block',
    });
  });

  it('separates rate limiting, auth, payment and forbidden', () => {
    const json = { 'content-type': 'application/json' };
    expect(classify(res(429, '{"message":"Throttled"}', json), invalid, 'shopify').outcome).toEqual(
      { kind: 'rate_limited' },
    );
    expect(classify(res(401, ''), invalid, 'magento').outcome.kind).toBe('login_required');
    expect(classify(res(402, page('Unavailable')), invalid, 'shopify').outcome.kind).toBe(
      'payment_required',
    );
    expect(classify(res(403, page('Forbidden')), invalid, 'woocommerce').outcome.kind).toBe(
      'forbidden',
    );
  });

  it('a Shopify password page is login_required', () => {
    const r = res(200, page('Opening soon'), { 'x-shopid': '1' }, 'https://shop.example/password');
    expect(classify(r, invalid, 'shopify').outcome.kind).toBe('login_required');
  });

  it('a 404 is not_found when the platform shows, not_platform when nothing does', () => {
    const wp = res(404, '{"code":"rest_no_route","message":"No route","data":{"status":404}}', {
      'content-type': 'application/json',
    });
    expect(classify(wp, invalid, 'woocommerce')).toMatchObject({
      outcome: { kind: 'not_found' },
      signals: expect.arrayContaining(['platform:wordpress']),
    });
    expect(classify(res(404, page('Not found')), invalid, 'woocommerce').outcome.kind).toBe(
      'not_platform',
    );
    const shop = res(404, page('404'), { 'x-shopid': '123' });
    expect(classify(shop, invalid, 'shopify').outcome.kind).toBe('not_found');
  });

  it('reads platform evidence from asset paths and script types on an HTML 404 page', () => {
    const m2 = res(
      404,
      page('404 Not Found', '<script type="text/x-magento-init">{"*":{}}</script>'),
    );
    expect(classify(m2, invalid, 'magento')).toMatchObject({
      outcome: { kind: 'not_found' },
      signals: ['platform:magento'],
    });
    const wp = res(404, page('Not found', '<link href="/wp-content/themes/x/style.css">'));
    expect(classify(wp, invalid, 'magento')).toMatchObject({
      outcome: { kind: 'not_platform' },
      signals: ['platform:wordpress'],
    });
    const json = res(404, '{"x":"/wp-content/themes/"}', { 'content-type': 'application/json' });
    expect(classify(json, invalid, 'woocommerce').outcome.kind).toBe('not_platform');
  });

  it('maps a GraphQL authorization error to login_required and other errors to invalid_payload', () => {
    const r = res(200, '{}', { 'content-type': 'application/json' });
    expect(
      classify(r, { valid: false, reason: 'graphql_error:graphql-authorization' }, 'magento')
        .outcome.kind,
    ).toBe('login_required');
    expect(
      classify(r, { valid: false, reason: 'graphql_error:graphql-input' }, 'magento').outcome.kind,
    ).toBe('invalid_payload');
  });

  it('an absent discovery target on a fetched page is not_found', () => {
    const r = res(200, page('Home'), {}, 'https://shop.example/');
    expect(classify(r, { valid: false, reason: 'absent' }, 'any').outcome.kind).toBe('not_found');
  });

  it('server errors and other 200s with the wrong shape', () => {
    expect(classify(res(502, page('Bad gateway')), invalid, 'magento').outcome.kind).toBe(
      'server_error',
    );
    expect(classify(res(200, page('Home')), invalid, 'woocommerce').outcome.kind).toBe(
      'invalid_payload',
    );
  });
});
