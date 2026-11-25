// schema.org and OpenGraph terms mapped to the data model's vocabularies (S§2.10: unknown is a
// value). Anything not listed is unknown: a term this table does not vouch for never becomes
// "in stock" or "new".
import type { Availability, Condition } from '@agentic-dasher/shared';
import { term } from './nodes.ts';

const AVAILABILITY: Readonly<Record<string, Availability>> = {
  instock: 'in',
  limitedavailability: 'in',
  onlineonly: 'in',
  outofstock: 'out',
  soldout: 'out',
  discontinued: 'out',
  // PreOrder, PreSale, BackOrder, MadeToOrder, InStoreOnly, Reserved: not buyable now online,
  // or not known to be; they stay unknown.
};

/** schema.org ItemAvailability → in | out | unknown. */
export function availabilityOf(value: string | null): Availability {
  if (value === null) return 'unknown';
  return AVAILABILITY[term(value)] ?? 'unknown';
}

const OG_AVAILABILITY: Readonly<Record<string, Availability>> = {
  'in stock': 'in',
  instock: 'in',
  'out of stock': 'out',
  outofstock: 'out',
  oos: 'out',
  discontinued: 'out',
};

/** OpenGraph / Facebook catalog `product:availability` → in | out | unknown. */
export function ogAvailabilityOf(value: string | null): Availability {
  if (value === null) return 'unknown';
  const key = value.trim().toLowerCase().replace(/_/g, ' ');
  return OG_AVAILABILITY[key] ?? availabilityOf(value);
}

const CONDITION: Readonly<Record<string, Condition>> = {
  newcondition: 'new',
  refurbishedcondition: 'refurbished',
  // UsedCondition carries no grade and DamagedCondition is not "for parts": both stay unknown,
  // which keeps them out of the reference price and away from new-item alerts (owner's ruling).
};

/** schema.org OfferItemCondition → the listing condition vocabulary. Absent is unknown, not new. */
export function conditionOf(value: string | null): Condition {
  if (value === null) return 'unknown';
  return CONDITION[term(value)] ?? 'unknown';
}

/** OpenGraph `product:condition` ("new", "refurbished", "used"). */
export function ogConditionOf(value: string | null): Condition {
  if (value === null) return 'unknown';
  const key = value.trim().toLowerCase();
  if (key === 'new') return 'new';
  if (key === 'refurbished') return 'refurbished';
  return conditionOf(value);
}
