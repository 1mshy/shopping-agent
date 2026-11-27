// The title rules and the tiers together, one rule class per block. Names and titles are invented
// (Acme, Zentro, Nexo) so the tests pin the rule, not a product the corpus or gold set holds.
import type { MatchRelation } from '@agentic-dasher/shared';
import { describe, expect, it } from 'vitest';
import { decideMatch, matchListing } from '../../src/matching/match.ts';
import type { MatchAsked, MatchListing } from '../../src/matching/types.ts';

function ask(name: string, more: Partial<MatchAsked> = {}): MatchAsked {
  return {
    name,
    brand: null,
    model: null,
    mpn: null,
    gtin: null,
    mustHave: [],
    packQuantity: null,
    ...more,
  };
}

function item(title: string, more: Partial<Omit<MatchListing, 'title'>> = {}): MatchListing {
  return { title, brand: null, mpn: null, gtin: null, variant: {}, url: null, ...more };
}

type Row = readonly [string, MatchAsked, MatchListing, MatchRelation];

function table(rows: readonly Row[]): void {
  it.each(rows)('%s', (_, asked, listing, relation) => {
    expect(matchListing({ asked, listing }).relation).toBe(relation);
  });
}

describe('accessory and part rejects', () => {
  table([
    [
      'a part noun heads the name',
      ask('Zentro Q5 Robot Vacuum'),
      item('Zentro Q5 Replacement Filters'),
      'accessory_or_part',
    ],
    [
      'a dock named for the model',
      ask('Zentro Q5 Robot Vacuum'),
      item('Zentro Q5 Charging Dock'),
      'accessory_or_part',
    ],
    [
      'the model only after "for"',
      ask('Zentro Q5'),
      item('Wall Mount for Zentro Q5'),
      'accessory_or_part',
    ],
    [
      '"accessory" anywhere in the name',
      ask('Zentro Q5'),
      item('Zentro Q5 Accessory Pack'),
      'accessory_or_part',
    ],
    ['a part set off by a dash', ask('Zentro Q5'), item('Zentro - Dust Bag'), 'accessory_or_part'],
    [
      '"for" as a purpose keeps the product',
      ask('Zentro Q5 Robot Vacuum'),
      item('Zentro Q5 Robot Vacuum for Pet Hair'),
      'exact',
    ],
    [
      'a count clause lists what is in the box',
      ask('Zentro Q5 Robot Vacuum'),
      item('Zentro Q5 Robot Vacuum, 2 Side Brushes, Black'),
      'exact',
    ],
    [
      'what it comes with is not a part',
      ask('Zentro Q5 Robot Vacuum'),
      item('Zentro Q5 Robot Vacuum with Charging Dock'),
      'exact',
    ],
    [
      'an accessory query matches the accessory',
      ask('dust bag for zentro q5'),
      item('Dust Bag for Zentro Q5'),
      'exact',
    ],
  ]);
});

describe('model-token conflicts', () => {
  table([
    ['another code of the family', ask('Acme ZX4400'), item('Acme ZX4410 Blender'), 'other_model'],
    [
      'another number after the line word',
      ask('Acme Strato 3'),
      item('Acme Strato 4 Speaker'),
      'other_model',
    ],
    [
      'a number written as a word',
      ask('Acme Strato 2'),
      item('Acme Strato One Speaker'),
      'other_model',
    ],
    [
      'a number after another line word',
      ask('Acme Vibe 700'),
      item('Acme Pulse 700 Headphones'),
      'other_model',
    ],
    [
      'an asked qualifier missing',
      ask('Acme Strato Mini'),
      item('Acme Strato Speaker'),
      'other_model',
    ],
    [
      'an extra qualifier after an asked word',
      ask('Acme Strato'),
      item('Acme Strato Max Speaker'),
      'other_model',
    ],
    [
      'a qualifier after a measurement is a platform',
      ask('Acme ZX4400 18V'),
      item('Acme ZX4400 18V Max Drill'),
      'exact',
    ],
    [
      'a name word put inside the asked name',
      ask('Acme Strato Speaker'),
      item('Acme Strato Rugged Speaker'),
      'other_model',
    ],
    ['another material', ask('Acme Basic PETG 1kg'), item('Acme Basic PLA 1kg'), 'other_model'],
    ['another feature count', ask('Acme Cooker 7-in-1'), item('Acme Cooker 9-in-1'), 'other_model'],
    ['a sibling configuration code', ask('Acme ZX440D1'), item('Acme ZX440B Drill'), 'variant'],
    ['a code written another way', ask('Acme QM-2000XR5'), item('QM2000XR5 Headphones'), 'exact'],
  ]);
});

describe('variants', () => {
  table([
    [
      'the Combo asked, the printer alone listed',
      ask('Acme R5 Combo'),
      item('Acme R5 3D Printer'),
      'variant',
    ],
    ['the Combo listed, the printer asked', ask('Acme R5'), item('Acme R5 Combo'), 'variant'],
    [
      'the variant options say Combo',
      ask('Acme R5 Combo'),
      item('Acme R5 3D Printer', { variant: { Version: 'R5 Combo' } }),
      'exact',
    ],
    [
      'the variant options say without the unit',
      ask('Acme R5 Combo'),
      item('Acme R5 Combo', { variant: { Version: 'R5 (without hub)' } }),
      'variant',
    ],
    [
      'an edition the name does not mention',
      ask('Acme Glide 3'),
      item('Acme Glide 3 for Business'),
      'variant',
    ],
    [
      'a heatsink the name does not mention',
      ask('Acme NV9 2TB'),
      item('Acme NV9 2TB with Heatsink'),
      'variant',
    ],
    [
      'without a heatsink is the bare drive',
      ask('Acme NV9 2TB'),
      item('Acme NV9 2TB, without heatsink'),
      'exact',
    ],
    ['the plus mark missing', ask('Acme PLA+ 1kg'), item('Acme PLA 1kg Filament'), 'variant'],
    ['the plus mark added', ask('Acme PLA 1kg'), item('Acme PLA+ 1kg Filament'), 'variant'],
    ['"PLA Plus" is "PLA+"', ask('Acme PLA Plus 1kg'), item('Acme PLA+ 1kg'), 'exact'],
    ['another material line', ask('Acme PLA 1kg'), item('Acme Marble PLA 1kg'), 'variant'],
    ['a version after the material', ask('Acme PLA+ 1kg'), item('Acme PLA+ 2.0 1kg'), 'variant'],
    ['a pack of several', ask('Acme Filter Jug'), item('Acme Filter Jug, Pack of 2'), 'variant'],
    ['another capacity', ask('Acme NV9 2TB'), item('Acme NV9 1TB SSD'), 'variant'],
    [
      'a capacity in another unit system is left to the judge',
      ask('Acme Kettle 1.7 L'),
      item('Acme Kettle 7 Cup'),
      'unknown',
    ],
    [
      'a thousand-count is part of the model name',
      ask('Acme Volt 20K'),
      item('Acme Volt 10K Power Bank'),
      'other_model',
    ],
    [
      'a thousand-count not stated is not confirmed',
      ask('Acme Volt 20K'),
      item('Acme Volt Power Bank'),
      'unknown',
    ],
    [
      'a thousand-count stated as a charge',
      ask('Acme Volt 20K'),
      item('Acme Volt Power Bank, 20000mAh'),
      'exact',
    ],
  ]);
});

describe('bundles', () => {
  table([
    ['a bundle word', ask('Acme R5'), item('Acme R5 Bundle'), 'bundle'],
    [
      '"+" and another product',
      ask('Acme Glide 3'),
      item('Acme Glide 3 + Acme Desk Pad'),
      'bundle',
    ],
    [
      'a starter kit built around the product',
      ask('Acme Board 4'),
      item('Starter Kit for Acme Board 4'),
      'bundle',
    ],
    [
      '"+" naming the Combo\'s own unit',
      ask('Acme R5 Combo'),
      item('Acme R5 + Hub Combo'),
      'exact',
    ],
  ]);
});

describe('brands and lines', () => {
  table([
    [
      'another brand opens the title',
      ask('Acme Strato 3'),
      item('Nexo Strato 3 Speaker'),
      'other_line',
    ],
    [
      'another brand in the store field',
      ask('Acme Strato 3'),
      item('Strato 3 Speaker', { brand: 'Nexo' }),
      'other_line',
    ],
    [
      'the brand left out, the model kept',
      ask('Acme Strato 3'),
      item('Strato 3 Portable Speaker'),
      'exact',
    ],
    [
      'another line of the brand',
      ask('Acme Terra PLA 1kg'),
      item('Acme Lumen PLA 1kg'),
      'other_line',
    ],
    ['nothing names the model', ask('Acme ZX4400'), item('Acme Cordless Blender'), 'unknown'],
  ]);
});

describe('the URL is supporting evidence only', () => {
  table([
    [
      'a model number in the URL alone',
      ask('Acme ZX4400'),
      item('Acme Blender', { url: 'https://shop.example/p/acme-zx4400' }),
      'unknown',
    ],
    [
      'a variant word after the model in the URL',
      ask('Acme ZX4400'),
      item('Acme Blender', { url: 'https://shop.example/p/acme-zx4400-combo' }),
      'variant',
    ],
    [
      'the title beats the URL',
      ask('Acme ZX4400'),
      item('Acme ZX4410 Blender', { url: 'https://shop.example/p/acme-zx4400' }),
      'other_model',
    ],
  ]);
});

describe('tier 1 with the title rules', () => {
  const asked = ask('Acme ZX4400', { brand: 'Acme', gtin: '04006381333931', mpn: 'ZX4400-BLK' });

  it('an equal GTIN confirms a title that names no model', () => {
    const d = decideMatch({ asked, listing: item('Acme Blender', { gtin: '4006381333931' }) });
    expect(d).toMatchObject({ relation: 'exact', decidedBy: 'identifier' });
  });

  it('an equal brand + MPN confirms it too', () => {
    const d = decideMatch({ asked, listing: item('Acme Blender', { mpn: 'zx4400blk' }) });
    expect(d).toMatchObject({ relation: 'exact', decidedBy: 'identifier' });
  });

  it.each([
    ['Ace', 'Palace'],
    ['Palace', 'Ace'],
  ])('a shared MPN does not identify %s as %s', (brand, otherBrand) => {
    const d = decideMatch({
      asked: ask(`${brand} ZX100`, { brand, mpn: 'ZX100' }),
      listing: item(`${otherBrand} ZX100`, { brand: otherBrand, mpn: 'ZX100' }),
    });
    expect(d).toMatchObject({ relation: 'other_line', rule: 'other_brand' });
  });

  it('an equal GTIN against a title that says part: neither decides', () => {
    const listing = item('Replacement Jar for Acme ZX4400', { gtin: '4006381333931' });
    expect(matchListing({ asked, listing }).relation).toBe('unknown');
  });

  it('a title match with another valid GTIN stays unconfirmed', () => {
    const listing = item('Acme ZX4400 Blender', { gtin: '012345678905' });
    expect(decideMatch({ asked, listing })).toMatchObject({
      relation: 'unknown',
      rule: 'gtin_differs',
    });
  });

  it('a title match with another part number stays unconfirmed', () => {
    const listing = item('Acme ZX4400 Blender', { mpn: 'ZX4400-RED' });
    expect(decideMatch({ asked, listing }).relation).toBe('unknown');
  });

  it('an exact answer has no differing attribute, any other names one or more', () => {
    expect(matchListing({ asked, listing: item('Acme ZX4400 Blender') })).toEqual({
      relation: 'exact',
      differingAttrs: [],
    });
    const other = matchListing({ asked, listing: item('Acme ZX4410 Blender') });
    expect(other).toEqual({ relation: 'other_model', differingAttrs: ['model'] });
  });
});

describe('the must-have check after the label', () => {
  const must = (attribute: string, value: string) => ({ attribute, value });

  table([
    [
      'another colour in the variant options',
      ask('Acme Glide 3', { mustHave: [must('colour', 'Black')] }),
      item('Acme Glide 3 Mouse', { variant: { Color: 'White' } }),
      'variant',
    ],
    [
      'the asked colour',
      ask('Acme Glide 3', { mustHave: [must('colour', 'Graphite (black)')] }),
      item('Acme Glide 3 Mouse - Black'),
      'exact',
    ],
    [
      'no colour stated is no conflict',
      ask('Acme Glide 3', { mustHave: [must('colour', 'Black')] }),
      item('Acme Glide 3 Mouse'),
      'exact',
    ],
    [
      'another shade of the same colour',
      ask('Acme Fryer 6', { mustHave: [must('colour', 'Dark Grey')] }),
      item('Acme Fryer 6 - Light Grey'),
      'variant',
    ],
    [
      'a German compound colour',
      ask('Acme Fön 2', { mustHave: [must('colour', 'Schwarz')] }),
      item('Acme Fön 2', { variant: { Farbe: 'Himmelblau' } }),
      'variant',
    ],
    [
      'another capacity than the must-have',
      ask('Acme Cooker 7-in-1', { mustHave: [must('capacity', '6 quart')] }),
      item('Acme Cooker 7-in-1 - 8QT'),
      'variant',
    ],
    [
      'a kit where the tool alone is asked',
      ask('Acme ZX440D1', { mustHave: [must('kit', 'tool only')] }),
      item('Acme ZX440D1 Drill Kit with 2 Batteries'),
      'variant',
    ],
    [
      'the tool alone',
      ask('Acme ZX440D1', { mustHave: [must('kit', 'tool only')] }),
      item('Acme ZX440D1 Drill (Tool Only)'),
      'exact',
    ],
    [
      'another connector',
      ask('Acme Buds 2', { mustHave: [must('charging_case', 'USB-C case')] }),
      item('Acme Buds 2 with Lightning Case'),
      'variant',
    ],
  ]);

  it('names the attribute that differs', () => {
    const asked = ask('Acme Glide 3', { mustHave: [must('colour', 'Black')] });
    const listing = item('Acme Glide 3 Mouse', { variant: { Color: 'White' } });
    expect(matchListing({ asked, listing }).differingAttrs).toEqual(['colour']);
  });
});
