import { describe, it } from 'vitest';
import { PlannerOutput, SearchIntent } from '../src/index.ts';
import { expectRefused, expectValid } from './check.ts';

const planned = {
  kind: 'exact',
  name: 'Sony WH-1000XM5 headphones',
  brand: 'Sony',
  model: 'WH-1000XM5',
  mustHave: [{ attribute: 'colour', value: 'black' }],
  substitutes: ['Sony WH-1000XM6'],
  conditions: ['new', 'open_box'],
  packQuantity: null,
  fulfilment: ['delivery', 'pickup'],
};
const plannerOutput = {
  intent: planned,
  queries: ['Sony WH-1000XM5', 'WH-1000XM5 black', 'Sony WH1000XM5 headphones Canada'],
};

// Code adds what the model may not write: the identifiers, the user's market and the user's budget.
const intent = {
  ...planned,
  gtin: '04548736132610',
  mpn: 'WH1000XM5/B',
  currency: 'CAD',
  location: { country: 'CA', postalCode: null },
  budget: { amountMinor: 40000, currency: 'CAD' },
};

describe('PlannerOutput (model output, S§5.6 step 1)', () => {
  it('accepts an intent with 3-5 query variants', () => {
    expectValid(PlannerOutput, plannerOutput);
    expectValid(PlannerOutput, {
      ...plannerOutput,
      intent: { ...planned, kind: 'needs', brand: null, model: null },
    });
  });

  it('has no field for a budget, a currency, a location or an identifier (S§2.1, S§5.4)', () => {
    for (const extra of [
      { budget: { amountMinor: 40000, currency: 'CAD' } },
      { maxPrice: 400 },
      { currency: 'CAD' },
      { location: { country: 'CA', postalCode: null } },
      { gtin: '04548736132610' },
      { mpn: 'WH1000XM5/B' },
    ]) {
      expectRefused(
        PlannerOutput,
        { ...plannerOutput, intent: { ...planned, ...extra } },
        'intent',
      );
    }
  });

  it('refuses currency and percent symbols in its text (a second line, not the guarantee)', () => {
    const intentWith = (o: object) => ({ ...plannerOutput, intent: { ...planned, ...o } });
    expectRefused(PlannerOutput, intentWith({ name: 'headphones under $400' }), 'intent.name');
    expectRefused(PlannerOutput, intentWith({ name: 'headphones under 400 €' }), 'intent.name');
    expectRefused(
      PlannerOutput,
      intentWith({ mustHave: [{ attribute: 'discount', value: '20%' }] }),
      'intent.mustHave.0.value',
    );
    expectRefused(
      PlannerOutput,
      intentWith({ mustHave: [{ attribute: 'max_price_400', value: 'yes' }] }),
      'intent.mustHave.0.attribute',
    );
    expectRefused(
      PlannerOutput,
      intentWith({ substitutes: ['Bose QC Ultra (¥39,000)'] }),
      'intent.substitutes.0',
    );
    for (const sign of ['％', '٪', '﹪', '‰']) {
      expectRefused(PlannerOutput, intentWith({ name: `headphones 20${sign} off` }), 'intent.name');
    }
    const queries = [...plannerOutput.queries.slice(0, 2), 'Sony WH-1000XM5 under $300'];
    expectRefused(PlannerOutput, { ...plannerOutput, queries }, 'queries.2');
    // Plain words and digits still pass: planner text is search input, matched as text only.
    expectValid(PlannerOutput, intentWith({ name: 'Samsung 990 Pro 2TB SSD' }));
  });

  it('refuses attribute names that denote a price or a budget', () => {
    const intentWith = (o: object) => ({ ...plannerOutput, intent: { ...planned, ...o } });
    for (const attribute of ['max_price', 'price', 'budget', 'cost', 'discount', 'deal', 'sale']) {
      expectRefused(
        PlannerOutput,
        intentWith({ mustHave: [{ attribute, value: 'yes' }] }),
        'intent.mustHave.0.attribute',
      );
    }
  });

  it('refuses repeated attributes and substitutes', () => {
    const intentWith = (o: object) => ({ ...plannerOutput, intent: { ...planned, ...o } });
    const colour = { attribute: 'colour', value: 'black' };
    expectRefused(
      PlannerOutput,
      intentWith({ mustHave: [colour, { ...colour, value: 'white' }] }),
      'intent.mustHave',
    );
    expectRefused(
      PlannerOutput,
      intentWith({ substitutes: ['Bose QC', 'Bose QC'] }),
      'intent.substitutes',
    );
  });

  it('refuses a kind or condition outside the vocabulary and a wrong number of queries', () => {
    expectRefused(
      PlannerOutput,
      { ...plannerOutput, intent: { ...planned, kind: 'browse' } },
      'intent.kind',
    );
    expectRefused(
      PlannerOutput,
      { ...plannerOutput, intent: { ...planned, conditions: [] } },
      'intent.conditions',
    );
    expectRefused(
      PlannerOutput,
      { ...plannerOutput, intent: { ...planned, fulfilment: ['drone'] } },
      'intent.fulfilment.0',
    );
    expectRefused(PlannerOutput, { ...plannerOutput, queries: ['a', 'b'] }, 'queries');
  });
});

describe('SearchIntent (stored as watch.spec_json and search_run.intent_json)', () => {
  it('accepts an intent with and without a budget', () => {
    expectValid(SearchIntent, intent);
    expectValid(SearchIntent, { ...intent, budget: null, gtin: null });
  });

  it('holds the budget as Money in the user currency, never converted or defaulted', () => {
    expectRefused(
      SearchIntent,
      { ...intent, budget: { amountMinor: 30000, currency: 'USD' } },
      'budget',
    );
    expectRefused(
      SearchIntent,
      { ...intent, budget: { amountMinor: 399.99, currency: 'CAD' } },
      'budget.amountMinor',
    );
    expectRefused(
      SearchIntent,
      { ...intent, budget: { amountMinor: 0, currency: 'CAD' } },
      'budget',
    );
    expectRefused(SearchIntent, { ...intent, budget: 400 }, 'budget');
    // Money is strict: an extra key is refused, not silently stripped.
    expectRefused(
      SearchIntent,
      { ...intent, budget: { amountMinor: 40000, currency: 'CAD', amount: 400 } },
      'budget',
    );
    expectRefused(SearchIntent, { ...intent, currency: 'unknown', budget: null }, 'currency');
    const { currency: _, ...noCurrency } = intent;
    expectRefused(SearchIntent, noCurrency, 'currency');
  });

  it('validates the GTIN check digit and the country code', () => {
    expectRefused(SearchIntent, { ...intent, gtin: '04548736132611' }, 'gtin');
    expectRefused(SearchIntent, { ...intent, gtin: '4548736132610' }, 'gtin');
    expectRefused(SearchIntent, { ...intent, gtin: '00000000000000' }, 'gtin');
    expectValid(SearchIntent, { ...intent, mpn: null });
    expectRefused(
      SearchIntent,
      { ...intent, location: { country: 'Canada', postalCode: null } },
      'location.country',
    );
  });
});
