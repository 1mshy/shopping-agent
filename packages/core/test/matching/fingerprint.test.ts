import { MatchVerdict } from '@agentic-dasher/shared';
import { describe, expect, it } from 'vitest';
import {
  cleanUrl,
  fnv1a64,
  listingFingerprint,
  listingFingerprintParts,
  specFingerprint,
  verdictKey,
} from '../../src/matching/fingerprint.ts';
import { MATCHER_VERSION } from '../../src/matching/match.ts';
import type { MatchAsked } from '../../src/matching/types.ts';

describe('FNV-1a 64', () => {
  it('matches the published test vectors', () => {
    expect(fnv1a64('')).toBe('cbf29ce484222325');
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c');
    expect(fnv1a64('foobar')).toBe('85944171f73967e8');
  });

  it('hashes the UTF-8 bytes, so a non-ASCII title has a stable hash', () => {
    expect(fnv1a64('é')).toBe(fnv1a64('é'));
    expect(fnv1a64('Fön')).not.toBe(fnv1a64('Fon'));
    expect(fnv1a64('😀')).toMatch(/^[0-9a-f]{16}$/);
  });
});

const asked: MatchAsked = {
  name: 'Acme ZX4400 Blender',
  brand: 'Acme',
  model: 'ZX4400',
  mpn: 'ZX4400-BLK',
  gtin: '04006381333931',
  mustHave: [
    { attribute: 'colour', value: 'Black' },
    { attribute: 'capacity', value: '1.5 L' },
  ],
  packQuantity: 1,
};

describe('spec fingerprint', () => {
  it('ignores case, spacing and the order of must-haves', () => {
    const same = specFingerprint({
      ...asked,
      name: '  acme   zx4400 BLENDER ',
      mustHave: [...asked.mustHave].reverse(),
    });
    expect(same).toBe(specFingerprint(asked));
  });

  it('changes with anything the matcher reads', () => {
    const fp = specFingerprint(asked);
    expect(specFingerprint({ ...asked, name: 'Acme ZX4410 Blender' })).not.toBe(fp);
    expect(specFingerprint({ ...asked, mpn: null })).not.toBe(fp);
    expect(specFingerprint({ ...asked, packQuantity: 2 })).not.toBe(fp);
    expect(specFingerprint({ ...asked, mustHave: [] })).not.toBe(fp);
  });

  it('fits the match_verdict contract', () => {
    expect(specFingerprint(asked)).toMatch(/^spec1:[0-9a-f]{16}$/);
  });
});

describe('listing fingerprint: store, SKU or clean URL, title hash, variant', () => {
  const listing = {
    store: 'shop.example',
    sku: null,
    url: 'https://Shop.Example/p/acme-zx4400/?utm_source=x&color=black#reviews',
    title: 'Acme ZX4400 Blender',
    variant: { Color: 'Black' },
  };

  it('cleans the URL: case of the host, tracking parameters, fragment, trailing slash', () => {
    expect(cleanUrl(listing.url)).toBe('https://shop.example/p/acme-zx4400?color=black');
    expect(cleanUrl('not a url')).toBeNull();
  });

  it('uses the SKU when there is one, the clean URL otherwise', () => {
    expect(listingFingerprintParts(listing)[1]).toBe(
      'url:https://shop.example/p/acme-zx4400?color=black',
    );
    expect(listingFingerprintParts({ ...listing, sku: 'ZX-1' })[1]).toBe('sku:zx-1');
  });

  it('a tracking parameter does not change it; a new title or option does', () => {
    const fp = listingFingerprint(listing);
    expect(
      listingFingerprint({ ...listing, url: 'https://shop.example/p/acme-zx4400?color=black' }),
    ).toBe(fp);
    expect(listingFingerprint({ ...listing, title: 'Acme ZX4400 Blender (Renewed)' })).not.toBe(fp);
    expect(listingFingerprint({ ...listing, variant: { Color: 'Red' } })).not.toBe(fp);
    expect(listingFingerprint({ ...listing, store: 'other.example' })).not.toBe(fp);
  });

  it('fits the match_verdict contract, with the matcher version', () => {
    const v = MatchVerdict.safeParse({
      specFp: specFingerprint(asked),
      listingFp: listingFingerprint(listing),
      relation: 'exact',
      differingAttrs: [],
      decidedBy: 'rules',
      matcherVersion: MATCHER_VERSION,
      promptVersion: null,
      modelId: null,
      decidedAt: '2026-11-24T09:30:00.000Z',
    });
    expect(v.success).toBe(true);
  });
});

describe('verdict key', () => {
  it('joins spec, listing, matcher version, prompt version and model id', () => {
    const k = {
      specFp: 'spec1:a',
      listingFp: 'listing1:b',
      matcherVersion: MATCHER_VERSION,
      promptVersion: null,
      modelId: null,
    };
    expect(verdictKey(k)).not.toBe(verdictKey({ ...k, matcherVersion: 'matcher-older' }));
    expect(verdictKey(k)).not.toBe(verdictKey({ ...k, promptVersion: 'judge.v1', modelId: 'm' }));
    expect(verdictKey(k)).toBe(verdictKey({ ...k }));
  });
});
