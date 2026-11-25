// A listing's price history as a small inline SVG line (no chart library; the spec's uPlot chart
// is a later unit), with the latest price and the deal verdict from GET /api/listings/:id.
// Only points in one currency are drawn: amounts in different currencies are never on one scale.
import type { ListingHistory } from '@agentic-dasher/shared';
import { useEffect, useState } from 'react';
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

const W = 300;
const H = 100;
const PAD = 6;

function Spark({ values }: { values: readonly number[] }) {
  // Pixel positions only: the amounts themselves are never shown from this arithmetic.
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? (W - 2 * PAD) / (values.length - 1) : 0;
  const pts = values.map((v, i) => {
    const x = PAD + i * step;
    const y = max === min ? H / 2 : PAD + (H - 2 * PAD) * (1 - (v - min) / span);
    return [x, y] as const;
  });
  const last = pts.at(-1);
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} />
      {last && <circle cx={last[0]} cy={last[1]} r={3} />}
    </svg>
  );
}

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
  const values = line.map((p) => p.effective as number);
  const verdict = detail?.verdict ?? null;

  return (
    <div>
      {values.length === 0 && <p className="muted">{t.historyEmpty}</p>}
      {values.length === 1 && <p className="muted">{t.historyOnePoint}</p>}
      {values.length > 1 && <Spark values={values} />}
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
