// The coverage record (S§2.8, S§8): per-source accounting of one search, stored as
// `search_run.coverage_json` and streamed as the `coverage` block. Every field is set by code.
import { z } from 'zod';
import { Id } from './common.ts';
import { Host, SourceId } from './vocab.ts';

/**
 * The S§2.8 fields of one source. `completed`: its work finished; `timedOut`: the deadline or a
 * cancel cut it; `walled`: at least one of its requests met a wall. The counts are listings found
 * without a verified price, and verified listings.
 */
const accounting = {
  enabled: z.boolean(),
  attempted: z.boolean(),
  completed: z.boolean(),
  walled: z.boolean(),
  timedOut: z.boolean(),
  foundUnverified: z.int().nonnegative(),
  verified: z.int().nonnegative(),
};
type Accounting = { [K in keyof typeof accounting]: z.infer<(typeof accounting)[K]> };

function consistent(s: Accounting, ctx: z.RefinementCtx): void {
  const refuse = (path: keyof Accounting, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });
  if (s.attempted && !s.enabled) refuse('attempted', 'a disabled source is never attempted');
  for (const path of ['completed', 'walled', 'timedOut', 'foundUnverified', 'verified'] as const) {
    if (!s.attempted && s[path]) refuse(path, `${path} needs an attempt`);
  }
  if (s.completed && s.timedOut) refuse('timedOut', 'a timed-out source did not complete');
}

/**
 * One source of a search (S§5.6 step 2). A web-search source is one engine, so an unresponsive
 * engine shows as its own entry (attempted, not completed, timed out). A store is keyed by host;
 * `storeId` is null for a host not yet in the directory (a store is added only after a read).
 */
export const CoverageSource = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('catalog'), ...accounting }).superRefine(consistent),
  z
    .strictObject({ kind: z.literal('web_search'), engine: SourceId, ...accounting })
    .superRefine(consistent),
  z
    .strictObject({ kind: z.literal('store'), host: Host, storeId: Id.nullable(), ...accounting })
    .superRefine(consistent),
  z
    .strictObject({ kind: z.literal('marketplace'), adapterId: SourceId, ...accounting })
    .superRefine(consistent),
]);
export type CoverageSource = z.infer<typeof CoverageSource>;

function sourceKey(s: CoverageSource): string {
  switch (s.kind) {
    case 'catalog':
      return 'catalog';
    case 'web_search':
      return `web_search:${s.engine}`;
    case 'store':
      return `store:${s.host}`;
    case 'marketplace':
      return `marketplace:${s.adapterId}`;
  }
}

/** Every source of one search, each once. Totals are derived from the entries, never stored. */
export const CoverageRecord = z.strictObject({
  sources: z
    .array(CoverageSource)
    .max(500)
    .refine((all) => new Set(all.map(sourceKey)).size === all.length, 'each source once'),
});
export type CoverageRecord = z.infer<typeof CoverageRecord>;
