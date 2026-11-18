// The spike A classifier (spike C's rules + the readable criterion + one body rule) on
// hand-written fixtures (fixtures/README.md); none is evidence about a shop.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyAnswer } from './result.ts';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const answer = (status: number, body: string, headers: Record<string, string> = {}) => ({
  status,
  headers: new Headers({ 'content-type': 'text/html; charset=utf-8', ...headers }),
  finalUrl: 'https://fixture-shop.example/p/1',
  body,
  bytes: Buffer.byteLength(body),
});

describe('classifyAnswer', () => {
  it('calls a page with price markup readable, whatever its status', () => {
    expect(classifyAnswer(answer(200, fixture('product-jsonld.html')), 0, 1).outcome).toEqual({
      kind: 'ok',
    });
    expect(classifyAnswer(answer(203, fixture('product-jsonld.html')), 0, 1).outcome.kind).toBe(
      'ok',
    );
  });
  it('calls a served page without price markup invalid_payload ("served, no price markup")', () => {
    const c = classifyAnswer(answer(200, fixture('no-price.html')), 0, 1);
    expect(c.outcome).toEqual({ kind: 'invalid_payload' });
    expect(c.evidence.validation).toBe('no_price_markup');
  });
  it("keeps spike C's wall rule: a header-signalled challenge", () => {
    const c = classifyAnswer(
      answer(403, fixture('challenge.html'), { 'cf-mitigated': 'challenge' }),
      0,
      1,
    );
    expect(c.outcome).toEqual({ kind: 'wall', vendor: 'cloudflare', mode: 'challenge' });
  });
  it('calls a small page whose form posts to the captcha validation path a wall', () => {
    const c = classifyAnswer(answer(200, fixture('captcha-form.html')), 0, 1);
    expect(c.outcome).toEqual({ kind: 'wall', vendor: 'unknown', mode: 'challenge' });
    expect(c.evidence.signals).toContain('form:amazon_captcha');
  });
  it('does not apply the captcha rule to a large page or to text that only mentions the path', () => {
    const big = `${fixture('captcha-form.html')}${' '.repeat(70 * 1024)}`;
    expect(classifyAnswer(answer(200, big), 0, 1).outcome.kind).toBe('invalid_payload');
    const text = '<html><body><p>See /errors/validateCaptcha in the docs</p></body></html>';
    expect(classifyAnswer(answer(200, text), 0, 1).outcome.kind).toBe('invalid_payload');
  });
});
