// Compile-time checks for the domain contracts (checked by `tsc` only, not a Vitest file).
import type {
  CostSource,
  Delivery,
  DeliveryOutcome,
  DeliveryState,
  Listing,
  ListingCurrency,
  LlmEndpointRole,
  MinorUnitCurrency,
  NotificationEvent,
  NotificationKind,
  PlannerIntent,
  PriceObservation,
  RunBudget,
  RunCost,
  RunRecord,
  RunStep,
  RunType,
  SearchIntent,
} from '../src/index.ts';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// Each discriminated union covers its vocabulary exactly.
export type _EventKinds = Expect<Equal<NotificationEvent['kind'], NotificationKind>>;
export type _DeliveryStates = Expect<Equal<Delivery['state'], DeliveryState>>;
export type _DeliveryOutcomes = Expect<Equal<Delivery['outcome'], DeliveryOutcome | null>>;
export type _CostSources = Expect<Equal<RunCost['source'], CostSource>>;
export type _StepOps = Expect<Equal<RunStep['gen_ai.operation.name'], 'chat' | 'execute_tool'>>;

// Amounts are numbers (integer minor units, checked at run time) with one required currency.
export type _Sticker = Expect<Equal<PriceObservation['sticker'], number | null>>;
export type _ObservationCurrency = Expect<Equal<PriceObservation['currency'], ListingCurrency>>;
export type _ListingCurrency = Expect<Equal<Listing['currency'], ListingCurrency>>;
export type _IntentCurrency = Expect<Equal<SearchIntent['currency'], MinorUnitCurrency>>;

// The four budgets are required, none optional (S§2.6).
export type _Budgets = Expect<
  Equal<keyof RunBudget, 'maxTurns' | 'deadlineMs' | 'maxInputTokens' | 'maxSpend'>
>;
export type _BudgetsRequired = Expect<Equal<Required<RunBudget>, RunBudget>>;

// The model's intent has no budget, currency, location or identifier field (S§2.1, S§5.4).
export type _PlannerKeys = Expect<
  Equal<Extract<keyof PlannerIntent, 'budget' | 'currency' | 'location' | 'gtin' | 'mpn'>, never>
>;
export type _IntentIdentifiers = Expect<Equal<SearchIntent['mpn'], string | null>>;

// A run has one type; the role and the model belong to its model-call steps.
export type _RunType = Expect<Equal<RunRecord['type'], RunType>>;
export type _RunHasNoRole = Expect<Equal<Extract<keyof RunRecord, 'role'>, never>>;
export type _StepRole = Expect<Equal<Extract<RunStep, { role: unknown }>['role'], LlmEndpointRole>>;

// @ts-expect-error an unknown cost has no amount: it is never zero
export const zeroUnknown: RunCost = { source: 'none', amountNanos: 0 };
// @ts-expect-error a known cost needs its currency
export const bareCost: RunCost = { source: 'provider', amountNanos: 1 };

const delivery = { id: 1, profileId: 1, eventId: 1, channelId: 1, attempts: 1 };
// @ts-expect-error "accepted" needs the acceptance time
export const unstamped: Delivery = {
  ...delivery,
  state: 'accepted',
  outcome: 'accepted',
  nextAttemptAt: null,
  acceptedAt: null,
};
// @ts-expect-error a pending delivery has no acceptance time
export const early: Delivery = {
  ...delivery,
  state: 'pending',
  outcome: 'retry',
  nextAttemptAt: '2026-11-17T10:00:00.000Z',
  acceptedAt: '2026-11-17T10:00:00.000Z',
};
