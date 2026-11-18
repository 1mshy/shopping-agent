// The search progress stream (S§5.6): SSE events carrying typed blocks and JSON-patch updates,
// with a sequence number for the reconnect route.
//
// Every price in a block is Money (integer minor units and a currency) next to the id of the
// observation it was copied from; there is no formatted or float price anywhere. Percentages are
// integer basis points computed by code (S§2.1).
import { z } from 'zod';
import { Id, modelText, Timestamp } from './common.ts';
import { CoverageRecord } from './coverage.ts';
import { SearchIntent } from './intent.ts';
import { Money } from './money.ts';
import {
  Condition,
  DealVerdictLabel,
  DecidedBy,
  Host,
  MatchRelation,
  ReadMethod,
  ResultGroup,
  Rung,
  SearchMode,
  SearchRunStatus,
  StoreReadState,
  TrustTier,
  WallVendor,
} from './vocab.ts';

/** A code-computed share in basis points (0 to 10,000 = 0% to 100%). */
const BasisPoints = z.int().min(0).max(10_000);

const plan = z.strictObject({
  type: z.literal('plan'),
  mode: SearchMode,
  intent: SearchIntent,
  /** Query variants; none on the deterministic path (S§5.6 step 1). */
  queries: z.array(z.string().min(1).max(200)).max(5),
});

/** One store being read. `priced` carries the observation and its sticker; nothing else does. */
const storeRead = z
  .strictObject({
    type: z.literal('store_read'),
    state: StoreReadState,
    host: Host,
    storeId: Id.nullable(),
    url: z.httpUrl().max(2048),
    observationId: Id.nullable(),
    price: Money.nullable(),
    wallVendor: WallVendor.nullable(),
  })
  .superRefine((b, ctx) => {
    const priced = b.state === 'priced';
    const refuse = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (priced !== (b.observationId !== null)) refuse('observationId', 'set exactly when priced');
    if (priced !== (b.price !== null)) refuse('price', 'set exactly when priced');
    if (b.state !== 'walled' && b.wallVendor !== null) refuse('wallVendor', 'only when walled');
  });

/** The observation a result row shows (S§5.12: item price, delivered total, tax label, read path). */
const shownObservation = z
  .strictObject({
    id: Id,
    observedAt: Timestamp,
    itemPrice: Money.nullable(),
    landed: Money.nullable(),
    taxIncluded: z.boolean().nullable(),
    readPath: ReadMethod,
    rung: Rung,
  })
  .superRefine((o, ctx) => {
    const { itemPrice, landed } = o;
    if (
      landed !== null &&
      (itemPrice === null ||
        landed.currency !== itemPrice.currency ||
        landed.amountMinor < itemPrice.amountMinor)
    ) {
      const message =
        'a delivered total needs the item price, in its currency, and is not below it';
      ctx.addIssue({ code: 'custom', path: ['landed'], message });
    }
  });

const candidate = z.strictObject({
  type: z.literal('candidate'),
  listingId: Id,
  storeId: Id.nullable(),
  host: Host,
  url: z.httpUrl().max(2048),
  title: z.string().min(1).max(500),
  condition: Condition,
  trustTier: TrustTier,
  observation: shownObservation.nullable(),
});

/** S§5.5 deal verdicts. "Cheapest of N stores, X% under the median" carries N and X. */
const DealVerdict = z.discriminatedUnion('label', [
  z.strictObject({ label: DealVerdictLabel.exclude(['cheapest_of_n']) }),
  z.strictObject({
    label: z.literal('cheapest_of_n'),
    storeCount: z.int().min(2),
    underMedianBp: BasisPoints,
  }),
]);

const verdict = z
  .strictObject({
    type: z.literal('verdict'),
    listingId: Id,
    relation: MatchRelation,
    decidedBy: DecidedBy,
    /** Null when the listing is shown in no group. */
    group: ResultGroup.nullable(),
    deal: DealVerdict.nullable(),
    /** "The share of the last 90 days at or below today's price" (S§5.5); null without history. */
    shareAtOrBelow90dBp: BasisPoints.nullable(),
  })
  .refine((b) => b.group !== 'exact' || b.relation === 'exact', {
    path: ['group'],
    message: 'a substitute is never shown as an exact match (S§5.4)',
  });

/**
 * One piece of the summary. The model writes only `text` segments; every value is a separate
 * segment filled by code from engine records (S§2.1, S§5.6 step 7, S§5.15). The UI joins them.
 */
const SummarySegment = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), text: modelText(500) }),
  /** A price or total; `observationId` is null only for a figure code computed over several. */
  z.strictObject({ kind: z.literal('money'), observationId: Id.nullable(), amount: Money }),
  z.strictObject({ kind: z.literal('count'), n: z.int().nonnegative() }),
  z.strictObject({ kind: z.literal('store'), host: Host }),
]);
export type SummarySegment = z.infer<typeof SummarySegment>;

const summary = z.strictObject({
  type: z.literal('summary'),
  segments: z.array(SummarySegment).min(1).max(64),
});

const coverage = z.strictObject({ type: z.literal('coverage'), coverage: CoverageRecord });

/** A progress-stream block (S§5.6), discriminated on `type` (the `STREAM_BLOCK_TYPES`). */
export const StreamBlock = z.discriminatedUnion('type', [
  plan,
  storeRead,
  candidate,
  verdict,
  summary,
  coverage,
]);
export type StreamBlock = z.infer<typeof StreamBlock>;

/** A JSON Pointer (RFC 6901) into a block, other than its `type`. */
const BlockPointer = z
  .string()
  .regex(/^(?:\/(?:[^~/]|~[01])*)+$/)
  .refine((p) => p !== '/type' && !p.startsWith('/type/'), 'a patch never changes the block type');

/**
 * The JSON Patch (RFC 6902) subset: `add` and `replace`. Blocks only grow or settle (a read moves
 * from `reading` to a result, counts rise, segments append), so `remove`, `move`, `copy` and
 * `test` are not needed, and without them a replay is a plain left fold.
 */
export const PatchOp = z.strictObject({
  op: z.enum(['add', 'replace']),
  path: BlockPointer,
  value: z.json(),
});
export type PatchOp = z.infer<typeof PatchOp>;

/** The statuses a search stream can end with (S§4.2 search_run.status); `cancelled` included. */
const EndStatus = SearchRunStatus.extract(['completed', 'cancelled', 'failed']);

/**
 * One SSE event. `seq` starts at 1 and rises by 1; it is the SSE `id`, so the reconnect route
 * replays every event after the client's `Last-Event-ID`. `end` is last and carries the final
 * coverage record, so a cancelled run still states what it checked (S§2.8, S§6).
 */
export const StreamEvent = z.discriminatedUnion('event', [
  z.strictObject({
    event: z.literal('block'),
    seq: z.int().positive(),
    blockId: Id,
    block: StreamBlock,
  }),
  z.strictObject({
    event: z.literal('patch'),
    seq: z.int().positive(),
    blockId: Id,
    ops: z.array(PatchOp).min(1).max(64),
  }),
  z.strictObject({
    event: z.literal('end'),
    seq: z.int().positive(),
    status: EndStatus,
    coverage: CoverageRecord,
  }),
]);
export type StreamEvent = z.infer<typeof StreamEvent>;

type Applied = { ok: true; block: StreamBlock } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Applies one op to a JSON value in place; returns an error message or null. */
function applyOp(root: unknown, { op, path, value }: PatchOp): string | null {
  const tokens = path
    .slice(1)
    .split('/')
    .map((t) => t.replaceAll('~1', '/').replaceAll('~0', '~'));
  const last = tokens.pop() as string;
  let parent = root;
  for (const token of tokens) {
    parent = Array.isArray(parent)
      ? parent[Number(token)]
      : isRecord(parent)
        ? parent[token]
        : undefined;
  }
  if (Array.isArray(parent)) {
    const index = last === '-' && op === 'add' ? parent.length : Number(last);
    const bound = op === 'add' ? parent.length : parent.length - 1;
    if (!/^(0|[1-9][0-9]*|-)$/.test(last) || !Number.isInteger(index) || index > bound) {
      return `no such index: ${path}`;
    }
    parent.splice(index, op === 'add' ? 0 : 1, value);
    return null;
  }
  if (!isRecord(parent)) return `no such parent: ${path}`;
  if (op === 'replace' && !Object.hasOwn(parent, last)) return `no such member: ${path}`;
  parent[last] = value;
  return null;
}

/** Applies a patch to a block and re-validates the result: a patch cannot produce a bad block. */
export function applyBlockPatch(block: unknown, ops: unknown): Applied {
  const parsedOps = z.array(PatchOp).safeParse(ops);
  if (!parsedOps.success) return { ok: false, error: 'malformed patch' };
  const copy: unknown = JSON.parse(JSON.stringify(block));
  for (const op of parsedOps.data) {
    const error = applyOp(copy, op);
    if (error !== null) return { ok: false, error };
  }
  const result = StreamBlock.safeParse(copy);
  return result.success
    ? { ok: true, block: result.data }
    : { ok: false, error: 'the patched block is not valid' };
}

export type EndEvent = Extract<StreamEvent, { event: 'end' }>;
export type Folded =
  | { ok: true; blocks: StreamBlock[]; end: EndEvent | null }
  | { ok: false; error: string };

/** Where a resumed stream starts: the last `seq` the client holds and its blocks by id. */
export type StreamResume = { afterSeq: number; blocks: { blockId: number; block: unknown }[] };

/**
 * Folds events into the blocks they describe, as a client does (resuming after `afterSeq` when it
 * reconnects). Refuses a gap or repeat in `seq`, a reused block id, a patch to an unknown block or
 * one that leaves it invalid, and anything after `end`.
 */
export function foldStream(events: readonly unknown[], resume?: StreamResume): Folded {
  const blocks = new Map<number, StreamBlock>();
  for (const held of resume?.blocks ?? []) {
    const block = StreamBlock.safeParse(held.block);
    if (!block.success) return { ok: false, error: `held block ${held.blockId} is not valid` };
    blocks.set(held.blockId, block.data);
  }
  let next = (resume?.afterSeq ?? 0) + 1;
  let end: EndEvent | null = null;
  for (const raw of events) {
    const parsed = StreamEvent.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'malformed event' };
    const e = parsed.data;
    if (end !== null) return { ok: false, error: 'event after the end' };
    if (e.seq !== next) return { ok: false, error: `expected seq ${next}, got ${e.seq}` };
    next += 1;
    if (e.event === 'end') {
      end = e;
    } else if (e.event === 'block') {
      if (blocks.has(e.blockId)) return { ok: false, error: `block ${e.blockId} exists` };
      blocks.set(e.blockId, e.block);
    } else {
      const current = blocks.get(e.blockId);
      if (current === undefined) return { ok: false, error: `no block ${e.blockId}` };
      const applied = applyBlockPatch(current, e.ops);
      if (!applied.ok) return applied;
      blocks.set(e.blockId, applied.block);
    }
  }
  return { ok: true, blocks: [...blocks.values()], end };
}
