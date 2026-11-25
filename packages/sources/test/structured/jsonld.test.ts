import { describe, expect, it } from 'vitest';
import type { VariantSelector } from '../../src/read/contract.ts';
import { jsonLdReader, readJsonLd } from '../../src/structured/index.ts';
import { expectNoRead, expectRead, fixture, ldPage, page, request, values } from './helpers.ts';

const BAMBU = 'https://ca.store.bambulab.com/products/a1-mini';
const LEE =
  'https://www.leevalley.com/en-ca/shop/tools/hand-tools/planes/block/47881-veritas-low-angle-block-plane';
const LOGI = 'https://www.logitech.com/en-ca/shop/p/mx-master-3s-mac-bluetooth-mouse.910-006570';
const WALMART =
  'https://www.walmart.ca/en/ip/Sony-WH-1000XM5-Wireless-headphones-with-top-noise-canceling-clear-calls-Auto-NC-Optimizer-and-Alexa-voice-control/2P9FP9H47OOW';
const SAIL =
  'https://www.sail.ca/en-ca/products/the-north-face-wawona-6-tent-6-person-1493003?variant=56879252373664';
const CC =
  'https://www.canadacomputers.com/en/desktop-laptop-internal-ssds/233286/samsung-990-pro-2tb-m-2-nvme-pcie-4-0-solid-state-drive-mz-v9p2t0b-am.html';
const ANKER_BASE = 'https://www.anker.com/ca/products/a1695-anker-power-bank-25000mah-165w';
const ANKER = `${ANKER_BASE}?variant=8323451584662`;

function readFixture(
  name: string,
  url: string,
  finalUrl = url,
  variant: VariantSelector | null = null,
) {
  return jsonLdReader.read(request(url, variant), page(fixture(name), finalUrl));
}

function readHtml(html: string, url = 'https://shop.example.ca/p/widget') {
  return jsonLdReader.read(request(url), page(html, url));
}

describe('JSON-LD: real pages', () => {
  it('a ProductGroup whose URL selects no variant is variant_not_found, every figure kept', () => {
    const outcome = expectNoRead(readFixture('bambulab-a1-mini.html', BAMBU));
    expect(outcome.method).toBe('json_ld');
    expect(outcome.reason).toBe('variant_not_found');
    expect(outcome.fetch).toBeNull();
    expect(values(outcome.candidates)).toEqual(
      expect.arrayContaining(['249', '269', '399', '419']),
    );
    for (const c of outcome.candidates) expect(c.method).toBe('json_ld');
  });

  it('the variant whose offer URL is the page URL is priced, its struck price a claim', () => {
    const url = `${BAMBU}?id=578488018390032388`;
    const read = expectRead(readFixture('bambulab-a1-mini.html', url));
    expect(read).toMatchObject({
      method: 'json_ld',
      rung: 'http',
      currency: 'CAD',
      sticker: 24900,
      referenceClaimed: 26900,
      availability: 'in',
      condition: 'new',
      title: 'Bambu Lab A1 mini 3D Printer - A1 mini',
      coupon: null,
      memberPrice: null,
      shippingStatus: 'unknown',
      shipping: null,
      taxIncluded: null,
      unitPrice: null,
      unit: null,
    });
    expect(read.identifiers).toMatchObject({ brand: 'Bambu Lab', sku: '578488018390032388' });
    expect(read.candidates[0]).toEqual({ method: 'json_ld', confidence: 0.9, value: '249' });
    expect(values(read.candidates)).toEqual(expect.arrayContaining(['269', '399', '419']));
  });

  it('a selector by sku prices that variant and no other', () => {
    const read = expectRead(
      readFixture('bambulab-a1-mini.html', BAMBU, BAMBU, { sku: '578488018390032384' }),
    );
    expect(read.sticker).toBe(39900);
    expect(read.referenceClaimed).toBe(41900);
    expect(read.title).toBe('Bambu Lab A1 mini 3D Printer - A1 mini Combo');
  });

  it("a selector by variant id matches the id in the variant's own offer URL", () => {
    const read = expectRead(
      readFixture('bambulab-a1-mini.html', BAMBU, BAMBU, {
        variantId: '578488018390032384',
      }),
    );
    expect(read.sticker).toBe(39900);
    expect(read.identifiers.externalId).toBe('578488018390032384');
  });

  it('a selector naming no variant here is variant_not_found', () => {
    for (const selector of [
      { sku: 'A1-MINI-COMBO-EU' },
      { variantId: '42' },
      { options: { Capacity: '2TB' } },
    ]) {
      const outcome = expectNoRead(readFixture('bambulab-a1-mini.html', BAMBU, BAMBU, selector));
      expect(outcome.reason).toBe('variant_not_found');
    }
  });

  it('an AggregateOffer range over three steels is never the answer (Lee Valley)', () => {
    const outcome = expectNoRead(readFixture('leevalley-block-plane.html', LEE));
    expect(outcome.reason).toBe('variant_not_found');
    expect(values(outcome.candidates)).toEqual(
      expect.arrayContaining(['204.00', '225.00', '204', '225']),
    );
  });

  it('an AggregateOffer whose low and high are one figure for one offer is that price', () => {
    const read = expectRead(readFixture('logitech-mx-master-3s-mac.html', LOGI));
    expect(read).toMatchObject({
      currency: 'CAD',
      sticker: 15999,
      availability: 'in',
      condition: 'new',
      title: 'MX Master 3S For Mac',
    });
    expect(read.identifiers.brand).toBe('Logitech');
  });

  it('the ProductGroup member whose offer URL is the page is priced; stubs are other variants', () => {
    const read = expectRead(readFixture('walmartca-wh1000xm5.html', WALMART));
    expect(read).toMatchObject({ currency: 'CAD', sticker: 34895, availability: 'in' });
    expect(read.identifiers).toMatchObject({
      brand: 'Sony',
      sku: '2P9FP9H47OOW',
      gtin: '027242923232',
    });
    expect(read.variant).toEqual({ color: 'Black', size: '1' });
  });

  it('a selected variant that carries no offer has no price, whatever its siblings cost', () => {
    const stub =
      'https://www.walmart.ca/en/ip/WH-1000XM5-Wireless-Industry-Leading-Noise-Cancelling-Headphones/6000206790320';
    const outcome = expectNoRead(readFixture('walmartca-wh1000xm5.html', stub));
    expect(outcome.reason).toBe('no_price');
    expect(values(outcome.candidates)).toContain('348.95');
  });

  it("Shopify's escaped slashes and the offer's own identifiers (SAIL)", () => {
    const read = expectRead(readFixture('sail-wawona-6.html', SAIL));
    expect(read).toMatchObject({ currency: 'CAD', sticker: 77500, shippingStatus: 'unknown' });
    expect(read.identifiers).toMatchObject({
      brand: 'The North Face',
      sku: '24-066010002',
      gtin: '197642979594',
      externalId: '56879252373664',
    });
  });

  it("a URL or selector naming another variant than the offer's own is variant_not_found (SAIL)", () => {
    const other = SAIL.replace('56879252373664', '999');
    expect(expectNoRead(readFixture('sail-wawona-6.html', other)).reason).toBe('variant_not_found');
    const reading = readJsonLd(
      request(SAIL, { variantId: '999' }),
      page(fixture('sail-wawona-6.html'), SAIL),
    );
    expect(reading.outcome.kind === 'no_read' && reading.outcome.reason).toBe('variant_not_found');
    expect(reading.unconfirmed).toBe(false);
    expect(
      expectRead(readFixture('sail-wawona-6.html', SAIL, SAIL, { sku: '24-066010002' })).sticker,
    ).toBe(77500);
  });

  it('a selector the page has no variant data to check is flagged unconfirmed (Anker)', () => {
    const reading = readJsonLd(
      request(ANKER, { options: { Capacity: '25K' } }),
      page(fixture('anker-a1695.html'), ANKER),
    );
    expect(reading.outcome.kind === 'no_read' && reading.outcome.reason).toBe('variant_not_found');
    expect(reading.unconfirmed).toBe(true);
  });

  it('a Product with one Offer and its identifiers (Canada Computers)', () => {
    const read = expectRead(readFixture('canadacomputers-990-pro.html', CC));
    expect(read).toMatchObject({ currency: 'CAD', sticker: 87499, condition: 'new' });
    expect(read.identifiers).toMatchObject({
      brand: 'Samsung',
      mpn: 'MZ-V9P2T0B/AM',
      gtin: '887276657011',
      sku: 'SSSAS00121',
    });
  });

  it('raw line breaks inside a JSON-LD string are read; no itemCondition is unknown (Visions)', () => {
    const url = 'https://www.visions.ca/sony-top-end-headphones-in-black-openbox';
    const read = expectRead(readFixture('visions-sony-openbox.html', url));
    expect(read).toMatchObject({ currency: 'CAD', sticker: 64800, condition: 'unknown' });
    expect(read.identifiers.sku).toBe('WH1000XX/B-OPENBOX');
  });

  it('the declared currency is kept, never converted, even on a .ca host (Costco same-day)', () => {
    const url =
      'https://sameday.costco.ca/store/costco-canada/products/88338598-keurig-k-mini-single-serve-k-cup-pod-coffee-maker-1-each';
    const read = expectRead(readFixture('costco-sameday-keurig.html', url));
    expect(read).toMatchObject({ currency: 'USD', sticker: 4539 });
  });

  it('one Offer with no variant identity is the variant the URL names (Anker)', () => {
    const read = expectRead(readFixture('anker-a1695.html', ANKER));
    expect(read).toMatchObject({ currency: 'CAD', sticker: 16999 });
  });

  it('…but not once a redirect dropped the variant from the URL the page came from', () => {
    const outcome = expectNoRead(readFixture('anker-a1695.html', ANKER, ANKER_BASE));
    expect(outcome.reason).toBe('variant_not_found');
  });

  it('…and a selector the URL contradicts is variant_not_found', () => {
    expect(
      expectRead(readFixture('anker-a1695.html', ANKER, ANKER, { variantId: '8323451584662' }))
        .sticker,
    ).toBe(16999);
    const outcome = expectNoRead(
      readFixture('anker-a1695.html', ANKER, ANKER, { variantId: '999' }),
    );
    expect(outcome.reason).toBe('variant_not_found');
    const options = expectNoRead(
      readFixture('anker-a1695.html', ANKER, ANKER, { options: { Capacity: '25K' } }),
    );
    expect(options.reason).toBe('variant_not_found');
  });

  it('zero decimals beyond the exponent are read; a bare InStock is in stock (Prusa)', () => {
    const url =
      'https://www.prusa3d.com/product/original-prusa-xl-assembled-single-toolhead-3d-printer/';
    const read = expectRead(readFixture('prusa-xl.html', url));
    expect(read).toMatchObject({ currency: 'CAD', sticker: 340900, availability: 'in' });
  });
});

describe('JSON-LD: the known variant-coupling failures', () => {
  it('a multi-capacity listing with only a range is variant_not_found, with or without a selector', () => {
    const url = 'https://www.aliexpress.com/item/1005006.html';
    for (const selector of [null, { options: { Capacity: '4TB' } }]) {
      const outcome = expectNoRead(
        readFixture('synthetic-multi-capacity-range.html', url, url, selector),
      );
      expect(outcome.reason).toBe('variant_not_found');
      expect(values(outcome.candidates)).toEqual(expect.arrayContaining(['39.99', '129.99']));
    }
  });

  it('one Offer per capacity: only the selected capacity is priced, never the cheapest', () => {
    const url = 'https://www.aliexpress.com/item/1005007.html';
    const none = expectNoRead(readFixture('synthetic-multi-capacity-offers.html', url));
    expect(none.reason).toBe('variant_not_found');
    const fourTb = expectRead(
      readFixture('synthetic-multi-capacity-offers.html', url, url, {
        options: { capacity: '4tb' },
      }),
    );
    expect(fourTb).toMatchObject({
      sticker: 12999,
      availability: 'out',
      title: 'Portable SSD 4TB',
    });
    expect(fourTb.variant).toEqual({ Capacity: '4TB' });
    expect(fourTb.identifiers).toMatchObject({ sku: 'SSD-4TB', gtin: '0614141000036' });
    const bySku = expectRead(
      readFixture('synthetic-multi-capacity-offers.html', url, url, { sku: 'SSD-2TB' }),
    );
    expect(bySku.sticker).toBe(6999);
    const contradicted = expectNoRead(
      readFixture('synthetic-multi-capacity-offers.html', url, url, {
        sku: 'SSD-2TB',
        options: { Capacity: '4TB' },
      }),
    );
    expect(contradicted.reason).toBe('variant_not_found');
  });

  it('a ProductGroup range is never a variant price; a selected variant without an offer has none', () => {
    const base = 'https://filament.example.ca/products/pla-plus';
    const outcome = expectNoRead(readFixture('synthetic-product-group-range.html', base));
    expect(outcome.reason).toBe('variant_not_found');
    expect(values(outcome.candidates)).toEqual(expect.arrayContaining(['19.99', '24.99']));
    const black = expectNoRead(
      readFixture('synthetic-product-group-range.html', `${base}?variant=101`),
    );
    expect(black.reason).toBe('no_price');
  });

  it('the cheaper out-of-stock offer and the in-stock one: no pick (predecessor took the in-stock one)', () => {
    // pricewatch tests/test_extract.py::test_jsonld_prefers_in_stock_over_cheaper_out_of_stock
    const html = ldPage(
      '{"@type": "Product", "name": "Widget", "offers": [{"@type": "Offer", "price": "10.00", "priceCurrency": "USD", "availability": "OutOfStock"}, {"@type": "Offer", "price": "12.00", "priceCurrency": "USD", "availability": "InStock"}]}',
    );
    const outcome = expectNoRead(readHtml(html, 'https://shop.example.com/widget'));
    expect(outcome.reason).toBe('variant_not_found');
    expect(values(outcome.candidates)).toEqual(expect.arrayContaining(['10.00', '12.00']));
  });
});

describe('JSON-LD: the predecessor test inputs', () => {
  it('a Product with one Offer (test_jsonld_product)', () => {
    const html = ldPage(
      '{"@type": "Product", "name": "Test Printer", "sku": "TP-1", "offers": {"@type": "Offer", "price": "299.00", "priceCurrency": "USD", "availability": "https://schema.org/InStock"}}',
    );
    const read = expectRead(readHtml(html, 'https://shop.example.com/p/tp-1'));
    expect(read).toMatchObject({ currency: 'USD', sticker: 29900, title: 'Test Printer' });
    expect(read.availability).toBe('in');
    expect(read.identifiers.sku).toBe('TP-1');
  });

  it('a ProductGroup with one variant whose price is a JSON number (test_jsonld_product_group_variants)', () => {
    const html = ldPage(
      '{"@type": "ProductGroup", "name": "Filament", "hasVariant": [{"@type": "Product", "offers": {"@type": "Offer", "price": 18.99, "priceCurrency": "USD", "availability": "InStock"}}]}',
    );
    expect(expectRead(readHtml(html, 'https://shop.example.com/filament')).sticker).toBe(1899);
  });

  it('trailing commas are tolerated (test_jsonld_trailing_comma_tolerated)', () => {
    const html = ldPage(
      '{"@type": "Product", "name": "X",\n "offers": {"price": "42.00", "priceCurrency": "USD",},}',
    );
    expect(expectRead(readHtml(html, 'https://shop.example.com/x')).sticker).toBe(4200);
  });

  it('no structured data at all is not_applicable (test_no_price_anywhere)', () => {
    expect(readHtml('<html><body><p>hello</p></body></html>').kind).toBe('not_applicable');
  });
});

const offer = (extra: object = {}) => ({
  '@type': 'Product',
  name: 'Widget',
  offers: { '@type': 'Offer', price: '249.00', priceCurrency: 'CAD', ...extra },
});

describe('JSON-LD: money and currency', () => {
  it('a JSON number is read from its digits, never through a float', () => {
    const html = ldPage(
      '{"@type":"Product","name":"W","offers":{"@type":"Offer","price":1234567.89,"priceCurrency":"CAD"}}',
    );
    expect(expectRead(readHtml(html)).sticker).toBe(123456789);
    expect(expectRead(readHtml(html)).candidates[0]?.value).toBe('1234567.89');
  });

  it('a JSON number that is not a plain decimal is refused', () => {
    for (const price of ['2.49e2', '-249', '1E3']) {
      const html = ldPage(
        `{"@type":"Product","name":"W","offers":{"@type":"Offer","price":${price},"priceCurrency":"CAD"}}`,
      );
      expect(expectNoRead(readHtml(html)).reason).toBe('unreadable_price');
    }
  });

  it('a price that is an object, a list, true or empty is no price; nothing throws', () => {
    const cases: [unknown, string][] = [
      [{ value: 1 }, 'unreadable_price'],
      [true, 'unreadable_price'],
      [[249, 299], 'multiple_prices'],
      ['', 'no_price'],
      ['   ', 'no_price'],
    ];
    for (const [price, reason] of cases) {
      expect(expectNoRead(readHtml(ldPage(offer({ price })))).reason).toBe(reason);
    }
    expect(expectRead(readHtml(ldPage(offer({ price: ['249.00'] })))).sticker).toBe(24900);
  });

  it('a zero price, an ambiguous separator and a range are refused, each with its reason', () => {
    expect(expectNoRead(readHtml(ldPage(offer({ price: '0.00' })))).reason).toBe(
      'unreadable_price',
    );
    expect(expectNoRead(readHtml(ldPage(offer({ price: '1.299' })))).reason).toBe(
      'unreadable_price',
    );
    expect(expectNoRead(readHtml(ldPage(offer({ price: '10.00 - 20.00' })))).reason).toBe(
      'multiple_prices',
    );
    expect(expectNoRead(readHtml(ldPage(offer({ price: 'From $10.00' })))).reason).toBe(
      'multiple_prices',
    );
  });

  it('display text with thousands separators is read with the page locale', () => {
    expect(expectRead(readHtml(ldPage(offer({ price: '1,299.00' })))).sticker).toBe(129900);
    expect(expectRead(readHtml(ldPage(offer({ price: '$1,299.00' })))).sticker).toBe(129900);
  });

  it('a figure marked in another currency than the declared one is converted_currency', () => {
    const outcome = expectNoRead(readHtml(ldPage(offer({ price: 'US$249.00' }))));
    expect(outcome.reason).toBe('converted_currency');
    expect(values(outcome.candidates)).toEqual(['US$249.00']);
  });

  it('no currency evidence at all: currency unknown, null amounts, the figure kept as text', () => {
    const html = ldPage({
      '@type': 'Product',
      name: 'W',
      offers: { '@type': 'Offer', price: '249', availability: 'https://schema.org/InStock' },
    });
    const read = expectRead(readHtml(html, 'https://shop.example.com/w'));
    expect(read).toMatchObject({ currency: 'unknown', sticker: null, referenceClaimed: null });
    expect(values(read.candidates)).toEqual(['249']);
  });

  it('without priceCurrency the host names the market (.ca) and the price is CAD', () => {
    const html = ldPage({ '@type': 'Product', name: 'W', offers: { price: '249' } });
    expect(expectRead(readHtml(html, 'https://shop.example.ca/w'))).toMatchObject({
      currency: 'CAD',
      sticker: 24900,
    });
  });

  it('a priceCurrency that is no listing currency leaves the currency unknown', () => {
    const read = expectRead(
      readHtml(ldPage(offer({ priceCurrency: 'C$' })), 'https://s.example.ca/w'),
    );
    expect(read).toMatchObject({ currency: 'unknown', sticker: null });
  });

  it('a price in priceSpecification is read when the Offer has none; a ListPrice is a claim', () => {
    const html = ldPage(
      offer({
        price: undefined,
        priceSpecification: [
          { '@type': 'UnitPriceSpecification', price: 199.99, priceCurrency: 'CAD' },
          {
            '@type': 'UnitPriceSpecification',
            priceType: 'https://schema.org/ListPrice',
            price: 249.99,
            priceCurrency: 'CAD',
          },
        ],
      }),
    );
    expect(expectRead(readHtml(html))).toMatchObject({ sticker: 19999, referenceClaimed: 24999 });
  });

  it('an Offer price and a different sale priceSpecification are multiple_prices', () => {
    const html = ldPage(
      offer({
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          priceType: 'https://schema.org/SalePrice',
          price: '199.00',
          priceCurrency: 'CAD',
        },
      }),
    );
    expect(expectNoRead(readHtml(html)).reason).toBe('multiple_prices');
  });

  it('valueAddedTaxIncluded states tax inclusion; nothing else does', () => {
    const included = ldPage(
      offer({
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: '249.00',
          priceCurrency: 'CAD',
          valueAddedTaxIncluded: true,
        },
      }),
    );
    expect(expectRead(readHtml(included)).taxIncluded).toBe(true);
    expect(expectRead(readHtml(ldPage(offer()))).taxIncluded).toBeNull();
  });
});

describe('JSON-LD: availability, condition, shipping', () => {
  it('maps availability to in, out or unknown', () => {
    const cases: [string, string][] = [
      ['https://schema.org/InStock', 'in'],
      ['http://schema.org/LimitedAvailability', 'in'],
      ['OutOfStock', 'out'],
      ['https://schema.org/SoldOut', 'out'],
      ['https://schema.org/Discontinued', 'out'],
      ['https://schema.org/PreOrder', 'unknown'],
      ['https://schema.org/BackOrder', 'unknown'],
      ['in stock', 'unknown'],
    ];
    for (const [availability, expected] of cases) {
      expect(expectRead(readHtml(ldPage(offer({ availability })))).availability).toBe(expected);
    }
    expect(expectRead(readHtml(ldPage(offer()))).availability).toBe('unknown');
  });

  it('out of stock with no price is a read with no sticker', () => {
    const html = ldPage(offer({ price: undefined, availability: 'https://schema.org/OutOfStock' }));
    expect(expectRead(readHtml(html))).toMatchObject({
      sticker: null,
      availability: 'out',
      currency: 'CAD',
    });
  });

  it('maps itemCondition; absent or ungraded used is unknown, never new', () => {
    const cases: [string | undefined, string][] = [
      ['https://schema.org/NewCondition', 'new'],
      ['https://schema.org/RefurbishedCondition', 'refurbished'],
      ['https://schema.org/UsedCondition', 'unknown'],
      ['https://schema.org/DamagedCondition', 'unknown'],
      [undefined, 'unknown'],
    ];
    for (const [itemCondition, expected] of cases) {
      expect(expectRead(readHtml(ldPage(offer({ itemCondition })))).condition).toBe(expected);
    }
  });

  const shipping = (details: unknown) =>
    expectRead(readHtml(ldPage(offer({ shippingDetails: details }))));
  const toCountry = (country: unknown, rate?: unknown, extra: object = {}) => ({
    '@type': 'OfferShippingDetails',
    shippingDestination: { '@type': 'DefinedRegion', addressCountry: country, ...extra },
    ...(rate === undefined ? {} : { shippingRate: rate }),
  });

  it("states shipping only for the user's country, with an amount in the listing's currency", () => {
    expect(shipping(toCountry('CA', { value: 0, currency: 'CAD' }))).toMatchObject({
      shipping: 0,
      shippingStatus: 'known',
    });
    expect(shipping(toCountry(['US', 'CA'], { value: '9.99', currency: 'CAD' }))).toMatchObject({
      shipping: 999,
      shippingStatus: 'known',
    });
    expect(shipping(toCountry('US', { value: 0, currency: 'CAD' }))).toMatchObject({
      shipping: null,
      shippingStatus: 'unknown',
    });
    expect(shipping(toCountry('CA'))).toMatchObject({ shipping: null, shippingStatus: 'unknown' });
    expect(shipping(toCountry('CA', { value: 5, currency: 'USD' }))).toMatchObject({
      shipping: null,
      shippingStatus: 'unknown',
    });
    expect(
      shipping([
        toCountry('CA', { value: 0, currency: 'CAD' }),
        toCountry('CA', { value: 15, currency: 'CAD' }),
      ]),
    ).toMatchObject({ shipping: null, shippingStatus: 'unknown' });
    expect(
      shipping(toCountry('CA', { value: 0, currency: 'CAD' }, { addressRegion: ['ON', 'QC'] })),
    ).toMatchObject({ shipping: null, shippingStatus: 'conditional' });
  });
});

describe('JSON-LD: graphs, links and several products', () => {
  it('follows @id links from the page to the product and from the product to its offer', () => {
    const html = ldPage({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebPage',
          '@id': 'https://shop.example.ca/w#webpage',
          mainEntity: { '@id': 'https://shop.example.ca/w#product' },
        },
        {
          '@type': 'Product',
          '@id': 'https://shop.example.ca/w#product',
          name: 'Linked widget',
          gtin14: 10614141000033,
          offers: { '@id': 'https://shop.example.ca/w#offer' },
        },
        {
          '@type': 'Offer',
          '@id': 'https://shop.example.ca/w#offer',
          price: '59.95',
          priceCurrency: 'CAD',
        },
      ],
    });
    const read = expectRead(readHtml(html, 'https://shop.example.ca/w'));
    expect(read).toMatchObject({ sticker: 5995, title: 'Linked widget' });
    expect(read.identifiers.gtin).toBe('10614141000033');
  });

  it('the same product emitted twice at the same price is one read', () => {
    const html = ldPage(offer(), offer());
    expect(expectRead(readHtml(html)).sticker).toBe(24900);
  });

  it('two products none of which is the page, at different prices, are multiple_prices', () => {
    const other = { ...offer({ price: '19.00' }), name: 'Cable' };
    const outcome = expectNoRead(readHtml(ldPage(offer(), other)));
    expect(outcome.reason).toBe('multiple_prices');
  });

  it('of several products, the one whose url is the page is read', () => {
    const page1 = { ...offer(), url: 'https://shop.example.ca/w' };
    const related = {
      ...offer({ price: '19.00' }),
      name: 'Cable',
      url: 'https://shop.example.ca/c',
    };
    expect(expectRead(readHtml(ldPage(related, page1), 'https://shop.example.ca/w')).sticker).toBe(
      24900,
    );
  });

  it('a top-level variant Product with isVariantOf is read by its own offer', () => {
    const html = ldPage({
      '@type': 'Product',
      name: 'Tee Blue M',
      sku: 'TEE-B-M',
      color: 'Blue',
      offers: { '@type': 'Offer', price: '25.00', priceCurrency: 'CAD' },
      isVariantOf: {
        '@type': 'ProductGroup',
        name: 'Tee',
        hasVariant: [
          { '@type': 'Product', sku: 'TEE-R-M', offers: { price: '19.00', priceCurrency: 'CAD' } },
        ],
      },
    });
    expect(expectRead(readHtml(html))).toMatchObject({ sticker: 2500, title: 'Tee Blue M' });
  });

  it('a Product without offers or price is no_price; an Organization alone is not_applicable', () => {
    expect(expectNoRead(readHtml(ldPage({ '@type': 'Product', name: 'W' }))).reason).toBe(
      'no_price',
    );
    expect(readHtml(ldPage({ '@type': 'Organization', name: 'Shop' })).kind).toBe('not_applicable');
  });

  it('@type as a full IRI, a list or with a prefix is recognised', () => {
    for (const type of ['https://schema.org/Product', ['Thing', 'Product'], 'schema:Product']) {
      expect(expectRead(readHtml(ldPage({ ...offer(), '@type': type }))).sticker).toBe(24900);
    }
  });
});
