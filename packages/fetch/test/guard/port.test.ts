// From the fetch review's finding 7: port 0 passed the form clauses and then failed in the
// transport as a network error. No server listens on port 0; a URL that names it is not
// acceptable as written (S§5.1), and a redirect to it is refused the same way.
import { describe, expect, it } from 'vitest';
import { parseTarget, resolveLocation } from '../../src/guard/target.ts';

describe('port 0', () => {
  it('is refused as url_form, in any spelling', () => {
    for (const url of [
      'http://shop.example.test:0/p',
      'https://shop.example.test:0/',
      'https://shop.example.test:00000/p',
      'http://203.0.113.9:0/',
      'https://[2001:db8::1]:0/',
    ]) {
      expect(parseTarget(url), url).toEqual({ ok: false, reason: 'url_form' });
    }
  });

  it('is refused in a redirect', () => {
    const from = parseTarget('https://shop.example.test/a');
    if (!from.ok) throw new Error('the hop must parse');
    expect(resolveLocation('//shop.example.test:0/b', from.target)).toEqual({
      ok: false,
      reason: 'url_form',
    });
  });

  it('leaves real ports alone', () => {
    const parsed = parseTarget('https://shop.example.test:8443/p');
    expect(parsed.ok && parsed.target.port).toBe(8443);
    const plain = parseTarget('http://shop.example.test/p');
    expect(plain.ok && plain.target.port).toBe(80);
  });
});
