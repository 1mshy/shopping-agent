import type { ListingHistory } from '@agentic-dasher/shared';
import { lazy, Suspense, useEffect, useState } from 'react';
import { describeFailure, request } from '../http.ts';
import { t } from '../strings.ts';
import { formatTime, Message, type MoneyLike, MoneyText } from '../ui.tsx';

/** The part of the deal judgement (packages/core prices/verdict.ts) this view shows. */
interface Verdict {
  readonly label: string | null;
  readonly today: { readonly observedAt: string; readonly price: MoneyLike } | null;
  readonly daysOfHistory: number;
  readonly lowestRecorded: { readonly price: MoneyLike } | null;
  readonly median90d: MoneyLike | null;
  readonly unjudged: readonly { readonly tier: string; readonly reason: string }[];
}

interface ListingDetail {
  readonly verdict: Verdict | null;
  readonly verdictRefusal: unknown;
}

function refusalText(refusal: unknown): string {
  if (typeof refusal === 'string') return refusal;
  if (refusal !== null && typeof refusal === 'object') {
    const r = refusal as { reason?: unknown; code?: unknown; message?: unknown };
    for (const v of [r.message, r.reason, r.code]) if (typeof v === 'string') return v;
  }
  return t.unknown;
}

const PriceChart = lazy(() => import('./PriceChart.tsx'));

export function HistoryPanel({ listingId }: { listingId: number }) {
  const [history, setHistory] = useState<ListingHistory | null>(null);
  const [detail, setDetail] = useState<ListingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      request<ListingHistory>('GET', `/listings/${listingId}/history`),
      request<ListingDetail>('GET', `/listings/${listingId}`),
    ])
      .then(([h, d]) => {
        if (!live) return;
        setHistory(h);
        setDetail(d);
      })
      .catch((err) => live && setError(describeFailure(err)));
    return () => {
      live = false;
    };
  }, [listingId]);

  if (error !== null) return <Message kind="error" text={error} />;
  if (history === null) return <p className="muted">{t.loading}</p>;

  const priced = history.points.filter((p) => p.effective !== null && p.currency !== 'unknown');
  const latest = priced.at(-1);
  const currency = latest?.currency ?? null;
  const line = priced.filter((p) => p.currency === currency);
  const otherCurrency = priced.length - line.length;
  const chartPoints = history.points.filter((p) => p.currency === currency);
  const verdict = detail?.verdict ?? null;

  return (
    <div>
      {line.length === 0 && <p className="muted">{t.historyEmpty}</p>}
      {line.length === 1 && <p className="muted">{t.historyOnePoint}</p>}
      {line.length > 1 && currency && (
        <Suspense fallback={<p>{t.loading}</p>}>
          <PriceChart points={chartPoints} currency={currency} />
        </Suspense>
      )}
      {otherCurrency > 0 && <p className="muted">{t.otherCurrencyPoints(otherCurrency)}</p>}
      <dl className="facts">
        <dt>{t.latestPrice}</dt>
        <dd>
          {latest && currency !== null ? (
            <>
              <MoneyText value={{ amountMinor: latest.effective as number, currency }} />{' '}
              <span className="muted">({formatTime(latest.observedAt)})</span>
            </>
          ) : (
            <span className="muted">{t.unknown}</span>
          )}
        </dd>
        <dt>{t.verdict}</dt>
        <dd>
          {verdict === null && detail?.verdictRefusal
            ? t.verdictRefused(refusalText(detail.verdictRefusal))
            : verdict?.label
              ? (t.verdictLabel[verdict.label] ?? verdict.label)
              : t.verdictNone}
          {verdict !== null && (
            <span className="muted"> · {t.daysOfHistory(verdict.daysOfHistory)}</span>
          )}
        </dd>
        {verdict?.median90d && (
          <>
            <dt>{t.median90d}</dt>
            <dd>
              <MoneyText value={verdict.median90d} />
            </dd>
          </>
        )}
        {verdict?.lowestRecorded && (
          <>
            <dt>{t.lowestRecorded}</dt>
            <dd>
              <MoneyText value={verdict.lowestRecorded.price} />
            </dd>
          </>
        )}
      </dl>
      {verdict !== null && verdict.label === null && verdict.unjudged.length > 0 && (
        <p className="muted">
          {[...new Set(verdict.unjudged.map((u) => t.unjudgedReason[u.reason] ?? u.reason))].join(
            ' · ',
          )}
        </p>
      )}
    </div>
  );
}
