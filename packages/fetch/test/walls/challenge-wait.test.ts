// The challenge wait's two decisions, beyond the corpus cases.
import { describe, expect, it } from 'vitest';
import {
  FILL_IN_MIN_VISIBLE_CHARS,
  type PageContent,
  type PageEvidence,
  readHtml,
  statusAfterWait,
  worthWaiting,
} from '../../src/walls/index.ts';
import {
  AKAMAI_ACCESS_DENIED,
  CLOUDFLARE_CHALLENGE,
  datadomePage,
  productPage,
} from './fixtures.ts';

function content(document: string): PageContent {
  return {
    finalUrl: 'https://shop.example/p/1',
    headers: {},
    ...readHtml(document),
    documentBytes: new TextEncoder().encode(document).byteLength,
  };
}

const at = (status: number, page: PageContent): PageEvidence => ({
  ...page,
  rung: 'browser',
  status,
});

const challenge = content(CLOUDFLARE_CHALLENGE);
const store = content(productPage({}));
const captcha = content(datadomePage('c'));
const interstitial = content(datadomePage('i'));

describe('worthWaiting', () => {
  it('waits on a self-clearing challenge, whatever its status', () => {
    expect(worthWaiting(at(403, challenge))).toBe(true);
    expect(worthWaiting(at(200, challenge))).toBe(true);
    expect(worthWaiting(at(503, challenge))).toBe(true);
    expect(worthWaiting(at(403, interstitial))).toBe(true);
  });

  it('judges a captcha, a refusal, a login and a dead link at once', () => {
    expect(worthWaiting(at(403, captcha))).toBe(false);
    expect(worthWaiting(at(403, content(AKAMAI_ACCESS_DENIED)))).toBe(false);
    expect(worthWaiting(at(401, content('<p>Please sign in to continue.</p>')))).toBe(false);
    expect(worthWaiting(at(404, challenge))).toBe(false);
    expect(worthWaiting(at(502, content('')))).toBe(false);
  });

  it('gives a 2xx document still filling in its time, and judges the filled page', () => {
    const filling = content(
      `<div id="root"><p>${'x'.repeat(FILL_IN_MIN_VISIBLE_CHARS - 1)}</p></div>`,
    );
    expect(worthWaiting(at(200, filling))).toBe(true);
    expect(worthWaiting(at(200, store))).toBe(false);
  });

  it('never throws on odd evidence', () => {
    expect(worthWaiting({ ...at(200, store), finalUrl: 'nonsense', status: Number.NaN })).toBe(
      false,
    );
  });
});

describe('statusAfterWait', () => {
  it('a challenge swapped in place for a captcha keeps its status, so it is judged a wall', () => {
    expect(
      statusAfterWait({
        firstStatus: 403,
        first: challenge,
        newDocumentStatus: null,
        current: captcha,
      }),
    ).toBe(403);
  });

  it('a store page with a 200 needs no swap; a status off the challenge list is kept', () => {
    expect(
      statusAfterWait({
        firstStatus: 200,
        first: challenge,
        newDocumentStatus: null,
        current: store,
      }),
    ).toBe(200);
    expect(
      statusAfterWait({
        firstStatus: 404,
        first: challenge,
        newDocumentStatus: null,
        current: store,
      }),
    ).toBe(404);
  });

  it("a new document's status wins, unless it is not a status", () => {
    expect(
      statusAfterWait({
        firstStatus: 403,
        first: challenge,
        newDocumentStatus: 404,
        current: store,
      }),
    ).toBe(404);
    expect(
      statusAfterWait({ firstStatus: 403, first: challenge, newDocumentStatus: 0, current: store }),
    ).toBe(200);
  });

  it("a plain 403 page with content of its own, replaced by the store's page, keeps its 403", () => {
    const forbidden = content(
      `<h1>Forbidden</h1><p>${'You may not see this page. '.repeat(20)}</p>`,
    );
    expect(
      statusAfterWait({
        firstStatus: 403,
        first: forbidden,
        newDocumentStatus: null,
        current: store,
      }),
    ).toBe(403);
  });
});
