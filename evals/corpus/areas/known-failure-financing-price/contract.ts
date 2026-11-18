// Known failure: a monthly instalment read as the price (plan P0 workstream 3, "financing price").
// The predecessor's money.parse_price reads "$24/mo" as 24 and "4 payments of $30.00" as 4; its
// displayed-price reader, its recipe learning and the Target adapter each had to keep payment
// figures out on their own (reports/2026-10-18-pre-explorer-fixes.md lines 1669-1670: Affirm's
// 19 / 13 / 14 at Rona and SportChek and Walmart's 124.50 financing-options-v2 became learnable).
// In Agentic Dasher the guard is the price text reader itself: a payment is never a price. The
// subject and types are the `price-text-parsing` area's.
export type {
  ParsePriceText,
  PriceTextCase,
  PriceTextExpected,
  PriceTextResult,
} from '../price-text-parsing/contract.ts';
