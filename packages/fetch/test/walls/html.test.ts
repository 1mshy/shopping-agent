// The evidence reader: title, visible text and bot-manager signals, with bounded work.
import { describe, expect, it } from 'vitest';
import {
  decodeEntities,
  MAX_SIGNALS,
  readHtml,
  TITLE_MAX_CHARS,
  VISIBLE_TEXT_EXCERPT_CHARS,
} from '../../src/walls/index.ts';
import {
  AMAZON_CONTINUE_SHOPPING,
  CLOUDFLARE_CHALLENGE,
  datadomePage,
  PERIMETERX_ROBOT_OR_HUMAN,
} from './fixtures.ts';

describe('readHtml', () => {
  it('takes the first title, whitespace collapsed, entities decoded, case kept', () => {
    const page = readHtml(
      '<html><head><TITLE dir="ltr">\n  Caf&eacute; &amp;\tTea &#8230; &#x41;\n</TITLE><title>Second</title></head></html>',
    );
    expect(page.title).toBe('Caf&eacute; & Tea … A');
  });

  it("ignores an SVG icon's title", () => {
    const page = readHtml(
      '<body><svg><title>Cart icon</title><path d="M0"/></svg><h1>Shop</h1></body><title>Late</title>',
    );
    expect(page.title).toBe('Late');
    expect(page.visibleText).toBe('Shop');
  });

  it('visible text drops scripts, styles, templates, noscript, comments and the title', () => {
    const page = readHtml(
      `<html><head><title>T</title><style>p{color:red}</style><script>var a = "<p>not text</p>";</script></head>
      <body><!-- a comment <p>hidden</p> --><p>Hello&nbsp;<b>wor</b>ld</p><template><p>inert</p></template>
      <noscript>Enable JavaScript</noscript><div>Price&#58; $9.50</div><textarea>typed</textarea></body></html>`,
    );
    expect(page.visibleText).toBe('Hello world Price: $9.50 typed');
    expect(page.visibleChars).toBe(page.visibleText.length);
  });

  it('keeps an excerpt of long text, marked, and counts all of it', () => {
    const page = readHtml(`<p>${'word '.repeat(10_000)}</p>`);
    expect(page.visibleChars).toBe(10_000 * 5 - 1);
    expect(page.visibleText.length).toBeLessThanOrEqual(VISIBLE_TEXT_EXCERPT_CHARS);
    expect(page.visibleText.endsWith(' …')).toBe(true);
  });

  it('finds the signals of the wall pages the labs met', () => {
    expect(readHtml(CLOUDFLARE_CHALLENGE).markup).toEqual([
      { in: 'inline_script', value: '_cf_chl_opt' },
    ]);
    expect(readHtml(datadomePage('c')).markup).toEqual([
      { in: 'inline_script', value: "dd={'rt':'c'" },
      { in: 'script_src', value: 'https://ct.captcha-delivery.com/c.js' },
    ]);
    expect(readHtml(AMAZON_CONTINUE_SHOPPING).markup).toEqual([
      { in: 'form_action', value: '/errors/validatecaptcha' },
    ]);
    expect(readHtml(PERIMETERX_ROBOT_OR_HUMAN).markup).toEqual([
      { in: 'element_id', value: 'px-captcha' },
    ]);
    expect(
      readHtml(
        '<iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=X&cid=Y" title="DataDome"></iframe><div id=sec-if-cpt-container></div>',
      ).markup,
    ).toEqual([
      { in: 'iframe_src', value: 'https://geo.captcha-delivery.com/captcha/' },
      { in: 'element_id', value: 'sec-if-cpt-container' },
    ]);
  });

  it('keeps no signal for ordinary scripts, ids and forms', () => {
    const page = readHtml(
      '<script src="/app.js"></script><div id="main"></div><form action="/search"></form><script>var x = "px-captcha";</script>',
    );
    expect(page.markup).toEqual([]);
  });
});

describe('readHtml on hostile input', () => {
  const bounded = (html: string) => {
    const start = performance.now();
    const page = readHtml(html);
    const ms = performance.now() - start;
    expect(page.title.length).toBeLessThanOrEqual(TITLE_MAX_CHARS + 1);
    expect(page.visibleText.length).toBeLessThanOrEqual(VISIBLE_TEXT_EXCERPT_CHARS);
    expect(page.markup.length).toBeLessThanOrEqual(MAX_SIGNALS);
    return { page, ms };
  };
  const SIX_MIB = 6 * 1024 * 1024;

  it('a 6 MiB page of tags and text', () => {
    const { page, ms } = bounded('<div class="a"><span>ab</span></div>'.repeat(SIX_MIB / 36));
    expect(page.visibleChars).toBeGreaterThan(100_000);
    expect(ms).toBeLessThan(5_000);
  });

  it('a 1 MB title is cut and marked, so no rule can match it', () => {
    const { page } = bounded(`<title>${'Just a moment '.repeat(80_000)}</title><p>x</p>`);
    expect(page.title.endsWith('…')).toBe(true);
    expect(page.visibleText).toBe('x');
  });

  it('unclosed tags, comments, scripts, attributes and titles end the scan quietly', () => {
    for (const html of [
      `<div class="${'x'.repeat(SIX_MIB)}`,
      `<!-- ${'x'.repeat(SIX_MIB)}`,
      `<script>${'<p>'.repeat(SIX_MIB / 3)}`,
      `<title>${'a'.repeat(SIX_MIB)}`,
      `<p>text</p><div id='${'y'.repeat(100)}`,
      '<',
      '</',
      '<p',
      '<!',
    ]) {
      const { ms } = bounded(html);
      expect(ms).toBeLessThan(5_000);
    }
  });

  it('many signals are capped', () => {
    const html = Array.from(
      { length: 500 },
      (_, i) => `<script src="https://ct.captcha-delivery.com/${i}.js"></script>`,
    ).join('');
    expect(bounded(html).page.markup).toHaveLength(MAX_SIGNALS);
  });

  it('binary bytes decoded as text', () => {
    const bytes = new Uint8Array(SIX_MIB);
    let seed = 42;
    for (let i = 0; i < bytes.length; i++) {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      bytes[i] = seed & 0xff;
    }
    const { ms } = bounded(new TextDecoder().decode(bytes));
    expect(ms).toBeLessThan(5_000);
  });

  it('a page made of entities, and a stray ampersand', () => {
    expect(decodeEntities('&#0; &#xD800; &#1114112; &bogus; &amp &lt;b&gt;')).toBe(
      '� � � &bogus; & <b>',
    );
    const { page } = bounded(`<p>${'&#x41;'.repeat(SIX_MIB / 6)}</p>`);
    expect(page.visibleChars).toBe(SIX_MIB / 6);
  });
});
