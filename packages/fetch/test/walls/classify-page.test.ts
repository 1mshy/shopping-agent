// The wall classifier on page evidence: what is a wall and, above all, what is not.
import { FetchOutcome } from '@agentic-dasher/shared';
import { describe, expect, it } from 'vitest';
import {
  BLOCK_PAGE_MAX_VISIBLE_CHARS,
  CHALLENGE_COPY_MAX_VISIBLE_CHARS,
  classifyPage,
  EMPTY_MAX_DOCUMENT_BYTES,
  EMPTY_MAX_VISIBLE_CHARS,
  findWall,
  judgePage,
  type PageEvidence,
  readHtml,
} from '../../src/walls/index.ts';
import {
  AKAMAI_ACCESS_DENIED,
  AMAZON_CONTINUE_SHOPPING,
  AMAZON_TEXT_CAPTCHA,
  CLOUDFLARE_CHALLENGE,
  datadomePage,
  PERIMETERX_ROBOT_OR_HUMAN,
  productPage,
} from './fixtures.ts';

function page(fields: Partial<PageEvidence> = {}): PageEvidence {
  const visibleText = fields.visibleText ?? '';
  return {
    rung: 'http',
    status: 200,
    finalUrl: 'https://shop.example/p/1',
    headers: {},
    title: '',
    visibleText,
    visibleChars: visibleText.length,
    markup: [],
    documentBytes: 1_000,
    ...fields,
  };
}

/** Evidence the way the HTTP rungs build it, from an HTML document. */
function html(
  document: string,
  fields: Partial<Omit<PageEvidence, 'title' | 'visibleText' | 'visibleChars' | 'markup'>> = {},
): PageEvidence {
  return page({
    ...readHtml(document),
    documentBytes: new TextEncoder().encode(document).byteLength,
    ...fields,
  });
}

const OK = { kind: 'ok', rung: 'http' } as const;

describe('a store page that mentions wall words is readable', () => {
  const mentions = [
    'Worked fine, though the site made me verify you are a human first. Access Denied? Not here.',
    'Bought it for my son, a robot or human? He is both. Enter the characters you see below, said the box.',
    'The captcha on checkout was annoying. Press & Hold to confirm you are a human, it said.',
    'Just a moment... the battery lasts forever. Powered and protected by a tough plastic case.',
    'Sorry, you have been blocked from returning it, Cloudflare-fast shipping though.',
    "You don't have permission to access the warranty on this server, Reference #12 in the manual.",
  ];

  it.each(mentions)('a review saying %j', (mention) => {
    const evidence = html(productPage({ mention }));
    expect(evidence.visibleChars).toBeGreaterThan(BLOCK_PAGE_MAX_VISIBLE_CHARS);
    expect(classifyPage(evidence)).toEqual(OK);
  });

  it('even on a short product page (under the block-page size, over the copy limit)', () => {
    const mention =
      'Had to verify you are a human and press and hold a button, are you a robot was the title.';
    const evidence = html(productPage({ mention, paragraphs: 10 }));
    expect(evidence.visibleChars).toBeGreaterThan(CHALLENGE_COPY_MAX_VISIBLE_CHARS);
    expect(evidence.visibleChars).toBeLessThanOrEqual(BLOCK_PAGE_MAX_VISIBLE_CHARS);
    expect(classifyPage(evidence)).toEqual(OK);
  });

  it('a short product page that says "verify you are human" or "access denied" in passing', () => {
    for (const mention of ['Verify you are human-sized before buying.', 'Access denied? No.']) {
      const evidence = html(productPage({ mention, paragraphs: 2 }));
      expect(evidence.visibleChars).toBeLessThan(CHALLENGE_COPY_MAX_VISIBLE_CHARS);
      expect(classifyPage(evidence)).toEqual(OK);
    }
  });

  it('a product titled with a wall word, at any size', () => {
    for (const title of [
      'Robot or Human? Party Game | Example Toys',
      'Captcha | Board Game',
      'Access Denied (Blu-ray)',
      'Just a Moment Wall Clock',
    ]) {
      expect(classifyPage(html(productPage({ title })))).toEqual(OK);
      expect(classifyPage(html(productPage({ title, paragraphs: 3 })))).toEqual(OK);
    }
  });

  it('bot-manager scripts deployed on a store page, in source or inline', () => {
    const evidence = html(productPage({}));
    expect(evidence.markup).toEqual([
      { in: 'script_src', value: 'https://js.captcha-delivery.com/tags.js' },
    ]);
    expect(classifyPage(evidence)).toEqual(OK);
    const markup = [
      { in: 'script_src', value: 'https://js.captcha-delivery.com/tags.js' },
      { in: 'inline_script', value: "var px='px-captcha';" },
      { in: 'iframe_src', value: 'https://www.google.com/recaptcha/api2/anchor' },
    ] as const;
    // On a large page and on a page short enough to be a block page.
    expect(classifyPage(page({ visibleText: 'x'.repeat(5_000), markup }))).toEqual(OK);
    expect(classifyPage(page({ visibleText: 'x'.repeat(500), markup }))).toEqual(OK);
  });

  it('a captcha iframe on a large page is a widget, not a wall', () => {
    expect(
      classifyPage(
        page({
          visibleText: 'x'.repeat(5_000),
          markup: [{ in: 'iframe_src', value: 'https://geo.captcha-delivery.com/captcha/' }],
          documentBytes: 60_000,
        }),
      ),
    ).toEqual(OK);
  });

  it('"captcha" or "blocked" in a URL path is not a wall', () => {
    for (const finalUrl of [
      'https://shop.example/products/captcha-party-game',
      'https://shop.example/blocked/p/1',
      'https://shop.example/c/blocked-drains',
      'https://shop.example/p/1?url=blocked',
      'https://shop.example/splashui/challenge',
      'https://shop.example/errors/validateCaptcha',
    ]) {
      expect(classifyPage(page({ finalUrl, visibleText: 'x'.repeat(500) }))).toEqual(OK);
    }
  });

  it('wall words in headers that are not a bot manager verdict', () => {
    expect(
      classifyPage(
        page({
          headers: { 'cf-mitigated': 'none', server: 'cloudflare', 'x-datadome': 'protected' },
          visibleText: 'x'.repeat(500),
        }),
      ),
    ).toEqual(OK);
  });
});

describe('walls, by the evidence each vendor leaves', () => {
  it("Cloudflare's challenge: its header, its title, its inline options", () => {
    const evidence = html(CLOUDFLARE_CHALLENGE, { status: 403 });
    expect(findWall(evidence)).toEqual({ kind: 'wall', vendor: 'cloudflare', mode: 'challenge' });
    expect(
      findWall({ ...evidence, headers: { 'cf-mitigated': 'challenge' }, title: '', markup: [] }),
    ).toEqual({ kind: 'wall', vendor: 'cloudflare', mode: 'challenge' });
    // The title alone on a 503, as Cloudflare used to answer.
    expect(classifyPage(page({ status: 503, title: 'Just a moment...' }))).toEqual({
      kind: 'wall',
      rung: 'http',
      vendor: 'cloudflare',
      mode: 'challenge',
    });
  });

  it("Cloudflare's block page names access denied", () => {
    expect(findWall(page({ status: 403, title: 'Attention Required! | Cloudflare' }))).toEqual({
      kind: 'wall',
      vendor: 'cloudflare',
      mode: 'access_denied',
    });
    expect(
      findWall(
        page({
          status: 403,
          title: 'Access denied | shop.example used Cloudflare to restrict access',
        }),
      ),
    ).toEqual({ kind: 'wall', vendor: 'cloudflare', mode: 'access_denied' });
  });

  it("DataDome's interstitial is a challenge and its captcha a captcha, even behind Cloudflare", () => {
    const headers = { 'x-datadome': 'protected', 'cf-ray': 'RAY', server: 'cloudflare' };
    expect(findWall(html(datadomePage('i'), { status: 403, headers }))).toEqual({
      kind: 'wall',
      vendor: 'datadome',
      mode: 'challenge',
    });
    expect(findWall(html(datadomePage('c'), { status: 403, headers }))).toEqual({
      kind: 'wall',
      vendor: 'datadome',
      mode: 'captcha',
    });
  });

  it("Akamai's Access Denied, with and without its server header", () => {
    const wall = { kind: 'wall', vendor: 'akamai', mode: 'access_denied' };
    expect(findWall(html(AKAMAI_ACCESS_DENIED, { status: 403 }))).toEqual(wall);
    expect(
      findWall(html(AKAMAI_ACCESS_DENIED, { status: 403, headers: { server: 'AkamaiGHost' } })),
    ).toEqual(wall);
  });

  it('a page titled Access Denied names the bot manager whose header it carries', () => {
    expect(
      findWall(page({ status: 403, title: 'Access Denied', headers: { 'x-iinfo': '1-2-3' } })),
    ).toEqual({ kind: 'wall', vendor: 'imperva', mode: 'access_denied' });
  });

  it("Amazon's interstitial and text captcha are Amazon's own walls, on Amazon's hosts only", () => {
    const amazon = 'https://www.amazon.ca/dp/B0BKVY4WKT';
    expect(findWall(html(AMAZON_CONTINUE_SHOPPING, { finalUrl: amazon }))).toEqual({
      kind: 'wall',
      vendor: 'amazon',
      mode: 'challenge',
    });
    expect(findWall(html(AMAZON_TEXT_CAPTCHA, { finalUrl: amazon }))).toEqual({
      kind: 'wall',
      vendor: 'amazon',
      mode: 'captcha',
    });
    expect(
      findWall(html(AMAZON_TEXT_CAPTCHA, { finalUrl: 'https://www.amazon.co.uk/dp/X' })),
    ).toEqual({
      kind: 'wall',
      vendor: 'amazon',
      mode: 'captcha',
    });
    // The same page elsewhere is a captcha nothing names.
    expect(findWall(html(AMAZON_TEXT_CAPTCHA))).toEqual({
      kind: 'wall',
      vendor: null,
      mode: 'captcha',
    });
    expect(
      findWall(html(AMAZON_TEXT_CAPTCHA, { finalUrl: 'https://amazon.shop.example/p' })),
    ).toEqual({
      kind: 'wall',
      vendor: null,
      mode: 'captcha',
    });
  });

  it("PerimeterX's robot-or-human page at the end of the /blocked redirect is a captcha", () => {
    const finalUrl = 'https://www.walmart.com/blocked?url=L2lw&uuid=U&vid=&g=b';
    expect(findWall(html(PERIMETERX_ROBOT_OR_HUMAN, { finalUrl }))).toEqual({
      kind: 'wall',
      vendor: 'perimeterx',
      mode: 'captcha',
    });
  });

  it('headers that are a verdict: Vercel, AWS WAF, Kasada', () => {
    expect(
      classifyPage(page({ status: 429, headers: { 'x-vercel-mitigated': 'challenge' } })),
    ).toEqual({ kind: 'wall', rung: 'http', vendor: 'vercel', mode: 'challenge' });
    expect(findWall(page({ status: 405, headers: { 'x-amzn-waf-action': 'captcha' } }))).toEqual({
      kind: 'wall',
      vendor: 'aws_waf',
      mode: 'captcha',
    });
    expect(findWall(page({ status: 429, headers: { 'x-kpsdk-ct': 'T' } }))).toEqual({
      kind: 'wall',
      vendor: 'kasada',
      mode: 'challenge',
    });
  });

  it('a 403 is a wall: unnamed when bare, named by a bot manager header, a captcha by its widget', () => {
    expect(findWall(page({ status: 403, visibleText: '403 Forbidden' }))).toEqual({
      kind: 'wall',
      vendor: null,
      mode: 'challenge',
    });
    // Cloudflare's own headers are on every page it proxies: they name nothing.
    expect(
      findWall(page({ status: 403, headers: { 'cf-ray': 'R', server: 'cloudflare' } })),
    ).toEqual({
      kind: 'wall',
      vendor: null,
      mode: 'challenge',
    });
    expect(findWall(page({ status: 403, headers: { server: 'AkamaiGHost' } }))).toEqual({
      kind: 'wall',
      vendor: 'akamai',
      mode: 'challenge',
    });
    expect(
      findWall(
        page({
          status: 403,
          markup: [
            { in: 'iframe_src', value: 'https://newassets.hcaptcha.com/captcha/v1/x/static' },
          ],
        }),
      ),
    ).toEqual({ kind: 'wall', vendor: null, mode: 'captcha' });
  });

  it('challenge copy counts on a short page only', () => {
    const copy = 'Please verify you are a human to continue. ';
    expect(findWall(page({ visibleText: copy }))).toEqual({
      kind: 'wall',
      vendor: null,
      mode: 'challenge',
    });
    const long = `${copy}${'x'.repeat(CHALLENGE_COPY_MAX_VISIBLE_CHARS)}`;
    expect(findWall(page({ visibleText: long }))).toBeNull();
  });
});

describe('what the status decides', () => {
  it('a 404 or 410 is not found, whatever wall marks the page carries', () => {
    for (const status of [404, 410]) {
      const evidence = html(CLOUDFLARE_CHALLENGE, { status });
      expect(classifyPage(evidence)).toEqual({ kind: 'not_found', rung: 'http' });
      expect(classifyPage({ ...evidence, headers: { 'cf-mitigated': 'challenge' } })).toEqual({
        kind: 'not_found',
        rung: 'http',
      });
    }
  });

  it('a 401 with no wall on it asks for a login; with a captcha on it, it is a wall', () => {
    expect(classifyPage(page({ status: 401 }))).toEqual({ kind: 'login_required', rung: 'http' });
    expect(classifyPage(html(datadomePage('c'), { status: 401 }))).toEqual({
      kind: 'wall',
      rung: 'http',
      vendor: 'datadome',
      mode: 'captcha',
    });
  });

  it('a 429 carries its Retry-After; a date needs the clock', () => {
    expect(classifyPage(page({ status: 429, headers: { 'retry-after': '30' } }))).toEqual({
      kind: 'rate_limited',
      rung: 'http',
      retryAfterMs: 30_000,
    });
    const date = { 'retry-after': 'Tue, 24 Nov 2026 12:01:00 GMT' };
    expect(classifyPage(page({ status: 429, headers: date }))).toEqual({
      kind: 'rate_limited',
      rung: 'http',
      retryAfterMs: null,
    });
    expect(
      classifyPage(page({ status: 429, headers: date }), Date.UTC(2026, 10, 24, 12, 0, 0)),
    ).toEqual({
      kind: 'rate_limited',
      rung: 'http',
      retryAfterMs: 60_000,
    });
  });

  it('402, 5xx, and a status with no kind of its own', () => {
    expect(classifyPage(page({ status: 402 })).kind).toBe('payment_required');
    expect(classifyPage(page({ status: 500 })).kind).toBe('server_error');
    expect(classifyPage(page({ status: 451 })).kind).toBe('server_error');
    expect(judgePage(page({ status: 451 }))).toBeNull();
  });
});

describe('empty', () => {
  it('a 2xx page with almost no text in a small document is empty', () => {
    expect(judgePage(page({ visibleText: '', documentBytes: 39 }))).toEqual({ kind: 'empty' });
    expect(
      judgePage(page({ visibleText: 'x'.repeat(EMPTY_MAX_VISIBLE_CHARS - 1), documentBytes: 200 })),
    ).toEqual({ kind: 'empty' });
  });

  it('is not empty with enough text, in a larger document (a shell a reader may read), or off 2xx', () => {
    expect(judgePage(page({ visibleText: 'x'.repeat(EMPTY_MAX_VISIBLE_CHARS) }))).toBeNull();
    expect(judgePage(page({ documentBytes: EMPTY_MAX_DOCUMENT_BYTES }))).toBeNull();
    expect(judgePage(page({ status: 500, documentBytes: 10 }))).toBeNull();
  });

  it('a blank page at a wall path is a wall, not empty', () => {
    expect(
      judgePage(page({ finalUrl: 'https://shop.example/blocked/', documentBytes: 20 })),
    ).toEqual({
      kind: 'wall',
      vendor: null,
      mode: 'challenge',
    });
  });
});

describe('hostile evidence', () => {
  it('never throws and always answers a valid outcome', () => {
    const odd: PageEvidence[] = [
      page({ finalUrl: 'not a url' }),
      page({ finalUrl: '', status: 403 }),
      page({ status: Number.NaN }),
      page({ status: 999 }),
      page({ title: 'x'.repeat(1_000_000) }),
      page({ visibleText: '\u0000￿'.repeat(100), visibleChars: -5 }),
      page({
        markup: [
          { in: 'script_src', value: 'http://[::1' },
          { in: 'form_action', value: '%%%' },
        ],
      }),
      page({
        markup: Array.from({ length: 10_000 }, () => ({
          in: 'inline_script' as const,
          value: 'dd={',
        })),
      }),
      page({ headers: { 'cf-mitigated': undefined as unknown as string } }),
    ];
    for (const evidence of odd) {
      const outcome = classifyPage(evidence);
      expect(FetchOutcome.safeParse(outcome).success).toBe(true);
    }
  });
});
