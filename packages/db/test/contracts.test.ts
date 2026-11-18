// The database stores exactly what the Zod contracts in @agentic-dasher/shared accept: realistic
// rows round-trip and parse, and every rule SQL can state refuses a row that breaks it.
import {
  Delivery,
  Listing,
  MatchVerdict,
  NotificationEvent,
  PriceObservation,
  RunRecord,
  RunStep,
  SearchIntent,
} from '@agentic-dasher/shared';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Database, schema } from '../src/index.ts';
import { migratedDb, refusal, rows, searchIntent, seed, T0, T1 } from './fixtures.ts';

type RunRow = typeof schema.run.$inferSelect;
type StepRow = typeof schema.runStep.$inferSelect;
type EventRow = typeof schema.notificationEvent.$inferSelect;

// Row → contract shape. Keys already match except where the contract nests (budget, cost) or uses
// OpenTelemetry names, and the verdict, whose cache record has no id in the contract.

function usageOf(r: RunRow | StepRow) {
  return {
    'gen_ai.usage.input_tokens': r.inputTokens,
    'gen_ai.usage.cache_read.input_tokens': r.cacheReadInputTokens,
    'gen_ai.usage.cache_write.input_tokens': r.cacheWriteInputTokens,
    'gen_ai.usage.output_tokens': r.outputTokens,
    'gen_ai.usage.reasoning.output_tokens': r.reasoningOutputTokens,
  };
}

function costOf(r: {
  costSource: string | null;
  costNanos: number | null;
  costCurrency: string | null;
}) {
  return r.costSource === 'none'
    ? { source: 'none' }
    : { source: r.costSource, amountNanos: r.costNanos, currency: r.costCurrency };
}

function toRunRecord(r: RunRow) {
  return {
    id: r.id,
    profileId: r.profileId,
    type: r.type,
    status: r.status,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    budget: {
      maxTurns: r.maxTurns,
      deadlineMs: r.deadlineMs,
      maxInputTokens: r.maxInputTokens,
      maxSpend: { amountNanos: r.maxSpendNanos, currency: r.spendCurrency },
    },
    budgetHits: r.budgetHits,
    turns: r.turns,
    ...usageOf(r),
    cost: costOf(r),
  };
}

function toRunStep(r: StepRow) {
  const common = {
    id: r.id,
    runId: r.runId,
    profileId: r.profileId,
    index: r.index,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    payload: r.payload,
  };
  if (r.operationName === 'execute_tool') {
    return {
      'gen_ai.operation.name': r.operationName,
      ...common,
      'gen_ai.tool.name': r.toolName,
      'gen_ai.tool.call.id': r.toolCallId,
      refusal: r.refusal,
    };
  }
  return {
    'gen_ai.operation.name': r.operationName,
    ...common,
    role: r.role,
    promptVersion: r.promptVersion,
    'gen_ai.provider.name': r.providerName,
    'gen_ai.request.model': r.requestModel,
    'gen_ai.response.model': r.responseModel,
    'gen_ai.response.id': r.responseId,
    'gen_ai.response.finish_reasons': r.finishReasons,
    ...usageOf(r),
    cost: costOf(r),
  };
}

function toNotificationEvent(r: EventRow) {
  const base = {
    kind: r.kind,
    id: r.id,
    profileId: r.profileId,
    key: r.key,
    createdAt: r.createdAt,
  };
  switch (r.kind) {
    case 'price_drop':
    case 'restock':
    case 'new_listing':
      return {
        ...base,
        watchId: r.watchId,
        listingId: r.listingId,
        observationId: r.observationId,
      };
    case 'recommendation':
      return { ...base, feedCardId: r.feedCardId };
    case 'agent':
      return { ...base, runId: r.runId, text: r.text };
    case 'system':
      return { ...base, text: r.text };
  }
}

const none = {
  watchId: null,
  listingId: null,
  observationId: null,
  feedCardId: null,
  runId: null,
  text: null,
};

let db: Database;
beforeEach(() => {
  db = migratedDb();
  seed(db);
});

describe('round trip against the contracts in @agentic-dasher/shared', () => {
  it('Listing, including a listing whose currency is unknown', () => {
    db.orm
      .insert(schema.listing)
      .values({
        ...rows.listing,
        id: 2,
        urlCanonical: 'https://shop.example.ca/p/2',
        currency: 'unknown',
      })
      .run();
    const back = db.orm.select().from(schema.listing).all();
    expect(back).toHaveLength(2);
    for (const row of back) expect(Listing.parse(row)).toEqual(row);
    expect(back[0]).toEqual(rows.listing);
  });

  it('PriceObservation: priced, unknown currency, and out of stock without a price', () => {
    db.orm
      .insert(schema.priceObservation)
      .values([
        {
          ...rows.observation,
          id: 2,
          currency: 'unknown',
          sticker: null,
          referenceClaimed: null,
          shipping: null,
          shippingStatus: 'unknown',
          taxIncluded: null,
          effective: null,
          landed: null,
          missingComponents: ['sticker', 'shipping', 'tax'],
          availability: 'unknown',
          rawCandidates: [{ method: 'json_ld', confidence: 0.4, value: '449,99' }],
        },
        {
          ...rows.observation,
          id: 3,
          sticker: null,
          referenceClaimed: null,
          shipping: null,
          shippingStatus: 'unknown',
          taxIncluded: null,
          effective: null,
          landed: null,
          missingComponents: ['sticker', 'shipping', 'tax'],
          availability: 'out',
          rawCandidates: [],
        },
      ])
      .run();
    const back = db.orm.select().from(schema.priceObservation).all();
    expect(back).toHaveLength(3);
    for (const row of back) expect(PriceObservation.parse(row)).toEqual(row);
    expect(back[0]).toEqual(rows.observation);
  });

  it('MatchVerdict, by the model and by rules', () => {
    db.orm
      .insert(schema.matchVerdict)
      .values([
        rows.verdict,
        {
          ...rows.verdict,
          id: 2,
          listingFp: 'listing:1:other',
          relation: 'exact',
          differingAttrs: [],
          decidedBy: 'rules',
          promptVersion: null,
          modelId: null,
        },
      ])
      .run();
    for (const { id: _, ...verdict } of db.orm.select().from(schema.matchVerdict).all()) {
      expect(MatchVerdict.parse(verdict)).toEqual(verdict);
    }
  });

  it('SearchIntent in watch.spec_json and search_run.intent_json', () => {
    db.orm
      .insert(schema.searchRun)
      .values({
        id: 1,
        profileId: 1,
        intent: searchIntent,
        mode: 'fast',
        budget: { maxSpend: { amountNanos: 30_000_000, currency: 'USD' } },
        status: 'completed',
        coverage: [],
        result: { exact: [] },
        runId: 77,
      })
      .run();
    const [watch] = db.orm.select().from(schema.watch).all();
    const [search] = db.orm.select().from(schema.searchRun).all();
    expect(SearchIntent.parse(watch?.spec)).toEqual(searchIntent);
    expect(SearchIntent.parse(search?.intent)).toEqual(searchIntent);
  });

  it('RunRecord, with known and unknown cost', () => {
    db.orm
      .insert(schema.run)
      .values({
        ...rows.run,
        id: 78,
        status: 'running',
        endedAt: null,
        budgetHits: ['turns'],
        cacheReadInputTokens: null,
        costSource: 'none',
        costNanos: null,
        costCurrency: null,
      })
      .run();
    const back = db.orm.select().from(schema.run).all();
    expect(back).toHaveLength(2);
    for (const row of back) {
      const record = toRunRecord(row);
      expect(RunRecord.parse(record)).toEqual(record);
    }
  });

  it('RunStep, a model call and a tool call', () => {
    db.orm.insert(schema.runStep).values([rows.chatStep, rows.toolStep]).run();
    const back = db.orm.select().from(schema.runStep).all();
    expect(back).toEqual([rows.chatStep, rows.toolStep]);
    for (const row of back) {
      const step = toRunStep(row);
      expect(RunStep.parse(step)).toEqual(step);
    }
  });

  it('NotificationEvent, every kind', () => {
    const at = { profileId: 1, createdAt: T1 };
    db.orm
      .insert(schema.notificationEvent)
      .values([
        rows.priceDrop,
        { ...rows.priceDrop, id: 2, key: 'restock:1:1', kind: 'restock' },
        { ...rows.priceDrop, id: 3, key: 'new_listing:1:1', kind: 'new_listing' },
        { ...none, ...at, id: 4, key: 'card:1', kind: 'recommendation', feedCardId: 1 },
        {
          ...none,
          ...at,
          id: 5,
          key: 'run:77',
          kind: 'agent',
          runId: 77,
          text: 'Found {count} offers.',
        },
        {
          ...none,
          ...at,
          id: 6,
          key: 'llm_down:1',
          kind: 'system',
          text: 'The model is unreachable.',
        },
      ])
      .run();
    const back = db.orm.select().from(schema.notificationEvent).all();
    expect(back.map((r) => r.kind)).toEqual([
      'price_drop',
      'restock',
      'new_listing',
      'recommendation',
      'agent',
      'system',
    ]);
    for (const row of back) {
      const event = toNotificationEvent(row);
      expect(NotificationEvent.parse(event)).toEqual(event);
    }
  });

  it('Delivery, in every state', () => {
    db.orm
      .insert(schema.notificationEvent)
      .values([1, 2, 3, 4].map((id) => ({ ...rows.priceDrop, id, key: `k${id}` })))
      .run();
    const d = rows.pendingDelivery;
    db.orm
      .insert(schema.delivery)
      .values([
        d,
        { ...d, id: 2, eventId: 2, attempts: 1, outcome: 'retry' },
        {
          ...d,
          id: 3,
          eventId: 3,
          state: 'accepted',
          attempts: 1,
          outcome: 'accepted',
          nextAttemptAt: null,
          acceptedAt: T1,
        },
        {
          ...d,
          id: 4,
          eventId: 4,
          state: 'failed',
          attempts: 2,
          outcome: 'failed',
          nextAttemptAt: null,
        },
      ])
      .run();
    const back = db.orm.select().from(schema.delivery).all();
    expect(back.map((r) => r.state)).toEqual(['pending', 'pending', 'accepted', 'failed']);
    for (const row of back) expect(Delivery.parse(row)).toEqual(row);
  });
});

describe('save first (S§2.9) and unknown is a value (S§2.10)', () => {
  it('saves a watch with only what the user typed and the market', () => {
    db.orm
      .insert(schema.watch)
      .values({
        id: 2,
        profileId: 1,
        kind: 'query',
        input: 'noise cancelling headphones',
        spec: null,
        market: 'CA',
        currency: null,
        rules: {},
        referencePrice: null,
        referenceKind: null,
        cooldownS: 43200,
        createdAt: T0,
      })
      .run();
    expect(
      db.orm.select().from(schema.watch).where(eq(schema.watch.id, 2)).get()?.currency,
    ).toBeNull();
  });

  it('saves a queued search before any run, coverage or result exists', () => {
    db.orm
      .insert(schema.searchRun)
      .values({
        id: 2,
        profileId: 1,
        intent: searchIntent,
        mode: 'fast',
        budget: {},
        status: 'queued',
        coverage: null,
        result: null,
        runId: null,
      })
      .run();
    expect(db.orm.select().from(schema.searchRun).get()?.status).toBe('queued');
  });

  it('records a store about which nothing is known yet', () => {
    db.orm
      .insert(schema.store)
      .values({
        ...rows.store,
        id: 2,
        host: 'pasted.example',
        platform: 'unknown',
        platformEvidence: null,
        country: null,
        baseCurrency: 'unknown',
        markets: null,
        shipsTo: null,
        searchRoute: null,
        readRoute: null,
        identifiersOffered: null,
        isShop: 'unknown',
        trustTier: 'unverified',
        trustReasons: [],
        source: 'pasted',
        fingerprintedAt: null,
      })
      .run();
    expect(db.orm.select().from(schema.store).all()).toHaveLength(2);
  });
});

describe('rules SQL enforces', () => {
  const observation = (o: Partial<typeof schema.priceObservation.$inferInsert>) => () =>
    db.orm
      .insert(schema.priceObservation)
      .values({ ...rows.observation, id: 2, ...o })
      .run();
  const run = (r: Partial<typeof schema.run.$inferInsert>) => () =>
    db.orm
      .insert(schema.run)
      .values({ ...rows.run, id: 78, ...r })
      .run();
  const step =
    (
      s: Partial<typeof schema.runStep.$inferInsert>,
      base: typeof schema.runStep.$inferInsert = rows.chatStep,
    ) =>
    () =>
      db.orm
        .insert(schema.runStep)
        .values({ ...base, id: 3, index: 3, ...s })
        .run();
  // Event 1 (and its delivery through channel 1) exists; the row under test is event or delivery 2.
  const outbox = () => {
    db.orm.insert(schema.notificationEvent).values(rows.priceDrop).run();
    db.orm.insert(schema.delivery).values(rows.pendingDelivery).run();
  };
  const event = (e: Partial<typeof schema.notificationEvent.$inferInsert>) => () => {
    outbox();
    db.orm
      .insert(schema.notificationEvent)
      .values({ ...rows.priceDrop, id: 2, key: 'k2', ...e })
      .run();
  };
  const delivery = (d: Partial<typeof schema.delivery.$inferInsert>) => () => {
    outbox();
    db.orm
      .insert(schema.notificationEvent)
      .values({ ...rows.priceDrop, id: 2, key: 'k2' })
      .run();
    db.orm
      .insert(schema.delivery)
      .values({ ...rows.pendingDelivery, id: 2, eventId: 2, ...d })
      .run();
  };
  const verdict = (v: Partial<typeof schema.matchVerdict.$inferInsert>) => () =>
    db.orm
      .insert(schema.matchVerdict)
      .values({ ...rows.verdict, ...v })
      .run();
  const watch = (w: Partial<typeof schema.watch.$inferInsert>) => () =>
    db.orm
      .insert(schema.watch)
      .values({ ...rows.watch, id: 2, ...w })
      .run();

  const refusals: [string, () => unknown, RegExp][] = [
    // Money (S§2.2)
    [
      'an amount when the currency is unknown',
      observation({
        currency: 'unknown',
        shipping: null,
        shippingStatus: 'unknown',
        effective: null,
        landed: null,
      }),
      /price_observation_unknown_currency_has_no_amount/,
    ],
    ['a REAL amount', observation({ sticker: 449.99 }), /cannot store REAL value/],
    ['a negative amount', observation({ coupon: -100 }), /CHECK constraint failed: coupon/],
    [
      'a lower-case currency',
      observation({ currency: 'cad' as 'CAD' }),
      /CHECK constraint failed: currency/,
    ],
    [
      'an effective price above the sticker',
      observation({ effective: 45000, landed: 45000 }),
      /price_observation_effective/,
    ],
    [
      'a landed price below the effective price',
      observation({ landed: 40000 }),
      /price_observation_landed/,
    ],
    [
      'a landed price without known shipping',
      observation({ shipping: 1500, shippingStatus: 'estimated' }),
      /price_observation_landed/,
    ],
    [
      'a shipping amount with conditional shipping',
      observation({ shippingStatus: 'conditional', landed: null }),
      /price_observation_shipping_amount/,
    ],
    [
      'known shipping without an amount',
      observation({ shipping: null, landed: null }),
      /price_observation_shipping_amount/,
    ],
    [
      'a unit price without its unit',
      observation({ unitPrice: 4499 }),
      /price_observation_unit_pair/,
    ],
    [
      'a failed read: no price, in stock, known currency',
      observation({ sticker: null, effective: null, landed: null, referenceClaimed: null }),
      /price_observation_not_a_failed_read/,
    ],
    ['a fourth stock state', observation({ availability: 'maybe' as 'in' }), /availability IN/],
    [
      'a timestamp without milliseconds',
      observation({ observedAt: '2026-11-17T09:30:00Z' }),
      /strftime/,
    ],
    [
      'a timestamp with an offset',
      observation({ observedAt: '2026-11-17T09:30:00.000+01:00' }),
      /strftime/,
    ],
    ['an impossible date', observation({ observedAt: '2026-02-30T09:30:00.000Z' }), /strftime/],
    [
      'a watch reference price without its currency',
      watch({ currency: null }),
      /watch_reference_currency/,
    ],
    [
      'a watch reference price without its kind',
      watch({ referenceKind: null }),
      /watch_reference_pair/,
    ],
    // Run cost (S§4.4)
    [
      'a cost with source none',
      run({ costSource: 'none', costNanos: 0, costCurrency: 'USD' }),
      /run_cost_known/,
    ],
    [
      'a provider cost without an amount',
      run({ costNanos: null, costCurrency: null }),
      /run_cost_known/,
    ],
    [
      'a cost in another currency than the spend cap',
      run({ costCurrency: 'EUR' }),
      /run_cost_in_spend_currency/,
    ],
    ['more turns than the cap', run({ turns: 3 }), /run_turns_within_cap/],
    ['a running run with an end', run({ status: 'running' }), /run_ended_when_finished/],
    [
      'a run ending before it starts',
      run({ endedAt: '2026-11-17T09:59:59.999Z' }),
      /run_ended_when_finished/,
    ],
    [
      'cached tokens above input tokens',
      run({ cacheReadInputTokens: 5000 }),
      /run_input_includes_cached/,
    ],
    [
      'reasoning tokens above output tokens',
      run({ reasoningOutputTokens: 700 }),
      /run_output_includes_reasoning/,
    ],
    ['a step cost with source none', step({ costSource: 'none' }), /run_step_cost_known/],
    ['a model call without a prompt version', step({ promptVersion: null }), /run_step_model_call/],
    ['a tool call with usage', step({ inputTokens: 10 }, rows.toolStep), /run_step_model_call/],
    [
      'a tool call without a tool name',
      step({ toolName: null }, rows.toolStep),
      /run_step_tool_call/,
    ],
    ['a model call with a refusal', step({ refusal: rows.toolStep.refusal }), /run_step_tool_call/],
    ['a step of another profile than its run', step({ profileId: 2 }), /FOREIGN KEY/],
    // Outbox (S§2.11, S§5.11)
    [
      'a duplicate (event, channel) delivery',
      delivery({ eventId: 1 }),
      // The no-replace guard fires before the UNIQUE index; either refusal is the rule.
      /UNIQUE constraint failed: delivery.event_id, delivery.channel_id|delivery is never replaced/,
    ],
    [
      'an accepted delivery without accepted_at',
      delivery({ state: 'accepted', attempts: 1, outcome: 'accepted', nextAttemptAt: null }),
      /delivery_accepted_at/,
    ],
    ['a pending delivery with accepted_at', delivery({ acceptedAt: T1 }), /delivery_accepted_at/],
    [
      'an accepted delivery with no outcome',
      delivery({ state: 'accepted', attempts: 1, nextAttemptAt: null, acceptedAt: T1 }),
      /delivery_outcome/,
    ],
    [
      'a failed delivery never attempted',
      delivery({ state: 'failed', outcome: 'failed', nextAttemptAt: null }),
      /delivery_outcome/,
    ],
    [
      'a pending delivery with an outcome but no attempt',
      delivery({ outcome: 'retry' }),
      /delivery_outcome/,
    ],
    ['a delivery of another profile than its event', delivery({ profileId: 2 }), /FOREIGN KEY/],
    [
      'the same event key twice',
      event({ key: rows.priceDrop.key }),
      /UNIQUE constraint failed: notification_event.profile_id, notification_event.key|notification_event is never replaced/,
    ],
    [
      'a price drop without its observation',
      event({ observationId: null }),
      /notification_event_rests_on/,
    ],
    [
      'a system notice naming a watch',
      event({ kind: 'system', listingId: null, observationId: null, text: 'x' }),
      /notification_event_rests_on/,
    ],
    [
      'an agent message without its run',
      event({ ...none, kind: 'agent', text: 'x' }),
      /notification_event_rests_on/,
    ],
    ['an alert on another profile’s watch', event({ profileId: 2 }), /FOREIGN KEY/],
    // Verdict cache (S§5.4)
    [
      'a model verdict without a model id',
      verdict({ modelId: null }),
      /match_verdict_model_fields/,
    ],
    [
      'a rules verdict with a prompt version',
      verdict({ decidedBy: 'rules', modelId: null }),
      /match_verdict_model_fields/,
    ],
    // Keys and foreign keys
    [
      'a second listing for the same URL in one store',
      () =>
        db.orm
          .insert(schema.listing)
          .values({ ...rows.listing, id: 2 })
          .run(),
      /UNIQUE constraint failed: listing.store_id, listing.url_canonical/,
    ],
    [
      'a listing of a store that does not exist',
      () =>
        db.orm
          .insert(schema.listing)
          .values({ ...rows.listing, id: 2, storeId: 99, urlCanonical: 'https://x.example/' })
          .run(),
      /FOREIGN KEY/,
    ],
    [
      'a watch link to another profile’s watch',
      () =>
        db.orm
          .insert(schema.watchListing)
          .values({
            id: 1,
            profileId: 2,
            watchId: 1,
            listingId: 1,
            role: 'tracked',
            addedBy: 'user',
          })
          .run(),
      /FOREIGN KEY/,
    ],
    [
      'a watch without a profile',
      () =>
        db.orm.run(
          sql`insert into watch (kind, input, market, rules_json, cooldown_s, created_at) values ('query', 'x', 'CA', '{}', 0, ${T0})`,
        ),
      /NOT NULL constraint failed: watch.profile_id/,
    ],
    ['a watch of a profile that does not exist', watch({ profileId: 9 }), /FOREIGN KEY/],
    [
      'a setting with two values',
      () =>
        db.orm
          .insert(schema.setting)
          .values({ key: 'k', value: 1, valueEnc: Buffer.from([1]) })
          .run(),
      /setting_one_value/,
    ],
    [
      'a setting with no value',
      () => db.orm.insert(schema.setting).values({ key: 'k', value: null, valueEnc: null }).run(),
      /setting_one_value/,
    ],
  ];

  it.each(refusals)('refuses %s', (_, act, message) => {
    expect(refusal(act)).toMatch(message);
  });

  it('refuses a duplicate verdict cache key, model and person verdicts side by side', () => {
    verdict({})();
    expect(refusal(verdict({ id: 2 }))).toMatch(
      /UNIQUE constraint failed: index 'match_verdict_cache_key_idx'/,
    );
    const rules = { decidedBy: 'rules', promptVersion: null, modelId: null } as const;
    verdict({ id: 3, ...rules })();
    expect(refusal(verdict({ id: 4, ...rules }))).toMatch(/UNIQUE/);
    verdict({ id: 5, ...rules, decidedBy: 'person' })();
    expect(db.orm.select().from(schema.matchVerdict).all()).toHaveLength(3);
  });

  it('keeps price observations append-only and forever (S§4.1, S§5.14)', () => {
    const where = eq(schema.priceObservation.id, 1);
    expect(
      refusal(() => db.orm.update(schema.priceObservation).set({ sticker: 1 }).where(where).run()),
    ).toMatch(/append-only/);
    expect(refusal(() => db.orm.delete(schema.priceObservation).where(where).run())).toMatch(
      /kept forever/,
    );
  });

  it('keeps events append-only but lets the user delete them (S§4.3, S§5.15)', () => {
    db.orm
      .insert(schema.event)
      .values({ id: 1, profileId: 1, kind: 'dismiss', createdAt: T1 })
      .run();
    const where = eq(schema.event.id, 1);
    expect(
      refusal(() => db.orm.update(schema.event).set({ kind: 'click' }).where(where).run()),
    ).toMatch(/append-only/);
    db.orm.delete(schema.event).where(where).run();
    expect(db.orm.select().from(schema.event).all()).toEqual([]);
  });
});

describe('ON DELETE', () => {
  it('cascades to the parts of a parent: steps, watch links', () => {
    db.orm.insert(schema.runStep).values([rows.chatStep, rows.toolStep]).run();
    db.orm.delete(schema.run).where(eq(schema.run.id, 77)).run();
    expect(db.orm.select().from(schema.runStep).all()).toEqual([]);

    db.orm
      .insert(schema.watch)
      .values({ ...rows.watch, id: 2 })
      .run();
    db.orm
      .insert(schema.watchListing)
      .values({ id: 1, profileId: 1, watchId: 2, listingId: 1, role: 'tracked', addedBy: 'user' })
      .run();
    db.orm.delete(schema.watch).where(eq(schema.watch.id, 2)).run();
    expect(db.orm.select().from(schema.watchListing).all()).toEqual([]);
  });

  it('restricts everything else: history, the records an alert rests on, a profile with data', () => {
    db.orm.insert(schema.notificationEvent).values(rows.priceDrop).run();
    db.orm.insert(schema.delivery).values(rows.pendingDelivery).run();
    const o = db.orm;
    for (const act of [
      // A delivery's accepted_at is the only proof an alert was accepted (S§2.11).
      () => o.delete(schema.channel).where(eq(schema.channel.id, 1)).run(),
      () => o.delete(schema.store).where(eq(schema.store.id, 1)).run(),
      () => o.delete(schema.listing).where(eq(schema.listing.id, 1)).run(),
      () => o.delete(schema.watch).where(eq(schema.watch.id, 1)).run(),
      () => o.delete(schema.profile).where(eq(schema.profile.id, 1)).run(),
    ]) {
      expect(refusal(act)).toMatch(/FOREIGN KEY constraint failed/);
    }
  });
});

describe('timestamps (S§4)', () => {
  it('sort in time order as text when written in the contract format', () => {
    const instants = [
      Date.UTC(2026, 10, 17, 9, 30, 0, 0),
      Date.UTC(2026, 10, 17, 9, 30, 0, 500),
      Date.UTC(2026, 10, 17, 9, 30, 0, 50),
      Date.UTC(2026, 10, 17, 9, 29, 59, 999),
      Date.UTC(2026, 11, 31, 23, 59, 59, 999),
      Date.UTC(2027, 0, 1, 0, 0, 0, 0),
      Date.UTC(2026, 0, 1, 0, 0, 0, 1),
      Date.UTC(2026, 8, 9, 0, 0, 0, 0),
      Date.UTC(2026, 9, 10, 0, 0, 0, 0),
    ];
    db.orm
      .insert(schema.event)
      .values(
        instants.map((t, i) => ({
          id: i + 1,
          profileId: 1,
          kind: 'view' as const,
          createdAt: new Date(t).toISOString(),
        })),
      )
      .run();
    const byText = db.orm
      .select({ createdAt: schema.event.createdAt })
      .from(schema.event)
      .orderBy(schema.event.createdAt)
      .all()
      .map((r) => Date.parse(r.createdAt));
    expect(byText).toEqual([...instants].sort((x, y) => x - y));
  });
});
