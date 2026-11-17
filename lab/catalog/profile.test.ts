import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Checks the draft against the rules quoted in SOURCES.md §3 ([UCP-OV] Profile Structure and
// Authority binding, [GC] required catalog capabilities). It does not prove Shopify accepts it.
const profile = JSON.parse(
  readFileSync(new URL('./agent-profile.json', import.meta.url), 'utf8'),
) as { ucp: Record<string, unknown> };

type Entry = { version?: string; schema?: string; extends?: string[] };

describe('draft agent profile', () => {
  it('has the required ucp members', () => {
    expect(profile.ucp.version).toBe('2026-08-25');
    expect(profile.ucp.services).toBeTypeOf('object');
    expect(profile.ucp.payment_handlers).toEqual({});
  });

  it('declares the base catalog capabilities and the Global Catalog extension', () => {
    const caps = profile.ucp.capabilities as Record<string, Entry[]>;
    for (const name of [
      'dev.ucp.shopping.catalog.search',
      'dev.ucp.shopping.catalog.lookup',
      'dev.shopify.catalog.global',
    ]) {
      expect(caps[name]?.[0]?.version).toBe('2026-08-25');
    }
  });

  it('binds every schema URL to its namespace authority over https', () => {
    const groups = [profile.ucp.services, profile.ucp.capabilities] as Record<string, Entry[]>[];
    for (const [name, entries] of groups.flatMap((g) => Object.entries(g))) {
      for (const e of entries) {
        const url = new URL(e.schema ?? '');
        expect(url.protocol).toBe('https:');
        const authority = url.hostname.split('.').reverse().join('.');
        expect(name === authority || name.startsWith(`${authority}.`)).toBe(true);
      }
    }
  });

  it('carries no personal details and no checkout capability', () => {
    const text = JSON.stringify(profile);
    expect(text).not.toMatch(/@|mailto:|github\.io|contact|owner|name"/i);
    expect(text).not.toMatch(/checkout|cart/);
  });
});
