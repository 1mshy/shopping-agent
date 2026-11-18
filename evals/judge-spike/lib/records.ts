// The result files of a judge-spike run (under evals/out/judge-spike/, git-ignored):
//   run.json      RunMeta, written before the first call
//   calls.jsonl   one CallRecord per model call, the repair retries included
//   items.jsonl   one ItemRecord per item per judged batch
//   summary.json  RunSummary, written when the run ends, however it ends
// None of them may contain the key: every write is leak-checked first and the run fails closed.
import type { JudgeVerdict, MatchRelation, RunCost } from '@agentic-dasher/shared';
import type { BudgetHit, Budgets, Prices } from './budget.ts';
import type { HttpExchange, InvalidReason, Rung, Usage } from './chat.ts';

export const FORMAT_VERSION = 1;

export interface RunMeta {
  readonly formatVersion: 1;
  readonly runId: string;
  /** True for runs against a scripted server. A synthetic run is never quoted as a result. */
  readonly synthetic: boolean;
  /** The endpoint label given with --label. */
  readonly label: string;
  readonly model: string;
  readonly baseUrl: string;
  /** A local model: batches of at most 10, and the report adds the veto-only reading (S§5.4). */
  readonly local: boolean;
  readonly rung: Rung;
  readonly temperature: number | null;
  readonly reasoningEffort: string | null;
  readonly maxTokensField: 'max_completion_tokens' | 'max_tokens';
  readonly maxOutputTokens: number;
  readonly batchSizes: readonly number[];
  readonly trials: number;
  readonly seed: number;
  readonly prices: Prices | null;
  readonly currency: string;
  readonly providerCostCurrency: string | null;
  readonly acceptUnknownCost: boolean;
  readonly budgets: Budgets;
  readonly promptVersion: string;
  readonly promptSha256: string;
  readonly datasetFingerprint: string;
  readonly plannedBatches: number;
  readonly plannedJudgements: number;
  readonly startedAt: string;
}

export interface CallRecord {
  readonly kind: 'call';
  readonly runId: string;
  readonly callIndex: number;
  readonly batchId: string;
  readonly trial: number;
  readonly nominalSize: number;
  readonly batchLength: number;
  /** 0 for the first attempt, 1 for the repair retry. */
  readonly attempt: 0 | 1;
  readonly startedAt: string;
  readonly latencyMs: number;
  readonly estimatedInputTokens: number;
  /** The worst-case spend reserved before the call; null without prices. */
  readonly reserveNanos: number | null;
  /** The request minus credentials: the authorization header is shown as `Bearer [REDACTED]`. */
  readonly request: {
    readonly method: 'POST';
    readonly path: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: unknown;
  };
  /** Status, the raw reply text and the kept headers; null when no response arrived. */
  readonly response: HttpExchange | null;
  /** The error's name when no response arrived (never its message). */
  readonly transportError: string | null;
  readonly valid: boolean;
  readonly invalidReason: InvalidReason | null;
  readonly invalidDetail: string | null;
  readonly verdicts: readonly JudgeVerdict[] | null;
  readonly usage: Usage;
  readonly cost: RunCost;
  /** The provider's cost as reported, as text, whatever currency it is in; null if none. */
  readonly providerCostText: string | null;
  readonly promptVersion: string;
  readonly model: string;
  readonly endpointLabel: string;
}

export interface ItemRecord {
  readonly kind: 'item';
  readonly runId: string;
  readonly trial: number;
  readonly nominalSize: number;
  readonly batchId: string;
  /** The number of listings actually in the batch (at most the nominal size). */
  readonly batchLength: number;
  /** 1-based position in the batch; the listing id is `L<position>`. */
  readonly position: number;
  /** The batch's composition: its item keys in listing order. */
  readonly batchItemKeys: readonly string[];
  readonly itemKey: string;
  readonly listingId: string;
  /** The judge's relation; `unknown` for every item of an invalid batch. */
  readonly relation: MatchRelation;
  readonly batchValid: boolean;
  readonly invalidReason: InvalidReason | null;
  /** Calls made for the batch: 1, or 2 with the repair retry. */
  readonly attempts: number;
  readonly promptVersion: string;
}

export type StopReason = BudgetHit | 'consecutive_failures';

export interface RunSummary {
  readonly runId: string;
  readonly endedAt: string;
  /** Every planned batch was judged. */
  readonly completed: boolean;
  readonly stoppedBy: StopReason | null;
  readonly callsMade: number;
  readonly batchesJudged: number;
  readonly judgements: number;
  /** Input tokens charged to the budget: reported counts, or estimates where none was reported. */
  readonly inputTokensCharged: number;
  /** Spend charged to the budget: known costs, plus reserves for unknown costs when priced. */
  readonly spendNanosCharged: number;
  readonly unknownCostCalls: number;
  readonly costGuarantee: 'reserved_from_prices' | 'not_guaranteed';
  readonly elapsedMs: number;
}
