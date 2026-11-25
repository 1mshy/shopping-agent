// The walled-session drop, beyond the corpus cases, and its use with the HTTP rung's jars.
import { describe, expect, it } from 'vitest';
import { CookieJars } from '../../src/cookies/index.ts';
import {
  cookieDomainOfSite,
  dropsSession,
  planSessionDrop,
  sessionSite,
} from '../../src/walls/index.ts';

const WALL = { kind: 'wall', rung: 'browser', vendor: 'akamai', mode: 'access_denied' } as const;

describe('sessionSite', () => {
  it("is the page's host without www., lower-cased", () => {
    expect(sessionSite('https://WWW.HomeDepot.ca./en/home.html')).toBe('homedepot.ca');
    expect(sessionSite('https://ca.store.bambulab.com/p')).toBe('ca.store.bambulab.com');
    expect(sessionSite('http://93.184.215.14:8080/p')).toBe('93.184.215.14');
    expect(sessionSite('ftp://shop.example/')).toBeNull();
    expect(sessionSite('not a url')).toBeNull();
  });
});

describe('cookieDomainOfSite', () => {
  it('the site, hosts under it and its parents short of a public suffix', () => {
    const site = 'shop.example.co.uk';
    expect(cookieDomainOfSite('.shop.example.co.uk', site)).toBe(true);
    expect(cookieDomainOfSite('cdn.shop.example.co.uk', site)).toBe(true);
    expect(cookieDomainOfSite('.example.co.uk', site)).toBe(true);
    expect(cookieDomainOfSite('.co.uk', site)).toBe(false);
    expect(cookieDomainOfSite('uk', site)).toBe(false);
    expect(cookieDomainOfSite('other.example.co.uk', site)).toBe(false);
    expect(cookieDomainOfSite('notshop.example.co.uk', site)).toBe(false);
    expect(cookieDomainOfSite('', site)).toBe(false);
  });

  it('a store on a hosting suffix never clears the suffix or its neighbours', () => {
    const site = 'acme.myshopify.com';
    expect(cookieDomainOfSite('.acme.myshopify.com', site)).toBe(true);
    expect(cookieDomainOfSite('.myshopify.com', site)).toBe(false);
    expect(cookieDomainOfSite('other.myshopify.com', site)).toBe(false);
  });

  it('an IP address host has no parents', () => {
    expect(cookieDomainOfSite('93.184.215.14', '93.184.215.14')).toBe(true);
    expect(cookieDomainOfSite('184.215.14', '93.184.215.14')).toBe(false);
  });
});

describe('planSessionDrop', () => {
  it('only a wall drops anything', () => {
    for (const kind of ['ok', 'not_found', 'empty', 'server_error', 'login_required'] as const) {
      expect(dropsSession({ kind, rung: 'browser' })).toBe(false);
    }
    expect(dropsSession(WALL)).toBe(true);
  });

  it('a page URL that is not http(s) clears nothing', () => {
    expect(planSessionDrop({ pageUrl: 'about:blank', outcome: WALL, jar: ['.x.com'] })).toEqual({
      cookieDomains: [],
      origins: [],
    });
  });

  it('keeps the port in the origin it clears', () => {
    expect(
      planSessionDrop({ pageUrl: 'https://shop.example:8443/p', outcome: WALL, jar: [] }).origins,
    ).toEqual(['https://shop.example:8443']);
  });
});

describe('the same drop on the HTTP rung', () => {
  it("CookieJars.forget(sessionSite(url)) clears that site's sessions and its parent-domain cookies only", () => {
    const now = Date.UTC(2026, 10, 24);
    const jars = new CookieJars();
    jars
      .jar('www.homedepot.ca')
      .store(['_abck=A; Domain=homedepot.ca', 'sid=S'], 'https://www.homedepot.ca/', now);
    jars.jar('secure.homedepot.ca').store(['cart=C'], 'https://secure.homedepot.ca/', now);
    jars.jar('www.rona.ca').store(['datadome=D; Domain=rona.ca'], 'https://www.rona.ca/', now);
    const site = sessionSite('https://www.homedepot.ca/en/home.html');
    expect(site).toBe('homedepot.ca');
    jars.forget(site ?? '');
    expect(jars.jar('www.homedepot.ca').size).toBe(0);
    expect(jars.jar('secure.homedepot.ca').size).toBe(0);
    expect(jars.jar('www.rona.ca').header('https://www.rona.ca/', now)).toBe('datadome=D');
  });
});
