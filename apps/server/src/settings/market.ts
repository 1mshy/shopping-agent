// The user's market (S§2.3) as one value, for the watches, the sweep and the search: all three
// market settings, or null while any is missing (the first-run wizard's locale step is not done).
// There is no default for any of them (S§2.2: no default currency).
import type { MinorUnitCurrency } from '@agentic-dasher/shared';
import type { SettingsReader } from './registry.ts';

export interface UserMarket {
  readonly country: string;
  readonly currency: MinorUnitCurrency;
  readonly language: string;
}

export function userMarket(settings: SettingsReader): UserMarket | null {
  const country = settings.get('market.country');
  const currency = settings.get('market.currency');
  const language = settings.get('market.language');
  if (country === undefined || currency === undefined || language === undefined) return null;
  return { country, currency, language };
}
