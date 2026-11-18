// Contract for refusing a figure a store converted for a foreign visitor (S§2 invariant 3, S§5.2
// "a converted-looking figure is refused"; port map S§7 row 1: web_discovery.converted and the
// adapters' extra.converted_from). The subject is currency resolution: a figure whose written
// currency contradicts what the store declares it bills is refused there, before any amount is
// read. The types are the `currency-resolution` area's; this file names the subset these cases use.
export type {
  CurrencyCase,
  CurrencyEvidence,
  CurrencyExpected,
  CurrencyResolution,
  ResolveCurrency,
} from '../currency-resolution/contract.ts';
export { asExpected, evidence } from '../currency-resolution/contract.ts';
