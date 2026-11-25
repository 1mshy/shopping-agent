// One watch with its listings (GET /api/watches/:id): controls, rules, per-listing actions, history.
import type {
  SettingsResponse,
  WatchDetail,
  WatchListingView,
  WatchView,
} from '@agentic-dasher/shared';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { describeFailure, request } from '../http.ts';
import {
  basisPointsToPercent,
  exponentOf,
  minorToDecimal,
  parseAmount,
  percentToBasisPoints,
} from '../money.ts';
import { t } from '../strings.ts';
import { ExternalLink, formatTime, isHttpUrl, Message, MoneyText } from '../ui.tsx';
import { HistoryPanel } from './History.tsx';
import { LookupLine } from './Watches.tsx';

const REFETCH_AFTER_MS = 4000;

function Rules({
  watch,
  marketCurrency,
  onSaved,
}: {
  watch: WatchView;
  marketCurrency: string | null;
  onSaved: () => void;
}) {
  const target = watch.rules.targetPrice;
  // The watch's currency is adopted from its first real read; a target is typed in that currency.
  // Before that read, the user's market currency is the one a target is written in (the server
  // flags a mismatch later: `targetCurrencyMismatch`). Nothing is ever converted.
  const currency = watch.currency ?? target?.currency ?? marketCurrency;
  const exponent = currency === null ? null : exponentOf(currency);
  const [drop, setDrop] = useState(
    watch.rules.dropBasisPoints === null ? '' : basisPointsToPercent(watch.rules.dropBasisPoints),
  );
  const [targetText, setTargetText] = useState(
    target === null ? '' : minorToDecimal(target.amountMinor, exponentOf(target.currency) ?? 0),
  );
  const [restock, setRestock] = useState(watch.rules.restock);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const body: Record<string, unknown> = { restock };
    if (drop.trim() === '') body.dropBasisPoints = null;
    else {
      const bp = percentToBasisPoints(drop);
      if (bp === null || bp <= 0 || bp >= 10_000) {
        setError(t.dropInvalid);
        return;
      }
      body.dropBasisPoints = bp;
    }
    if (currency !== null && exponent !== null) {
      if (targetText.trim() === '') body.targetPrice = null;
      else {
        const minor = parseAmount(targetText, exponent);
        if (minor === null || minor <= 0) {
          setError(t.targetInvalid(currency, exponent));
          return;
        }
        body.targetPrice = { amountMinor: minor, currency };
      }
    }
    setBusy(true);
    try {
      await request('PATCH', `/watches/${watch.id}`, body);
      onSaved();
    } catch (err) {
      setError(describeFailure(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>{t.rulesTitle}</h2>
      <label htmlFor="drop">{t.dropLabel}</label>
      <input id="drop" inputMode="decimal" value={drop} onChange={(e) => setDrop(e.target.value)} />
      <label htmlFor="target">{t.targetLabel(currency)}</label>
      <input
        id="target"
        inputMode="decimal"
        value={targetText}
        disabled={currency === null || exponent === null}
        onChange={(e) => setTargetText(e.target.value)}
      />
      {watch.targetCurrencyMismatch && <p className="msg warn">{t.targetMismatch}</p>}
      <label className="inline">
        <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
        {t.restockLabel}
      </label>
      <Message kind="error" text={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={busy || watch.status === 'archived'}>
          {busy ? t.saving : t.save}
        </button>
      </div>
    </form>
  );
}

function PriceLine({ listing }: { listing: WatchListingView }) {
  const price = listing.price;
  if (price === null || listing.freshness === 'none') {
    return <span className="muted">{t.freshNone}</span>;
  }
  const stale = listing.freshness === 'stale';
  const showSticker =
    price.sticker !== null &&
    (price.effective === null ||
      price.sticker.amountMinor !== price.effective.amountMinor ||
      price.sticker.currency !== price.effective.currency);
  return (
    <span>
      <span className={stale ? 'price stale' : 'price'}>
        <MoneyText value={price.effective} />
      </span>
      {showSticker && (
        <span className="muted">
          {' '}
          ({t.sticker} <MoneyText value={price.sticker} />)
        </span>
      )}{' '}
      {stale ? (
        <span className="badge warn">{t.freshStale(formatTime(price.observedAt))}</span>
      ) : (
        <span className="badge">{t.freshCurrent}</span>
      )}
    </span>
  );
}

function ListingCard({
  watchId,
  listing,
  onChanged,
  archived,
}: {
  watchId: number;
  listing: WatchListingView;
  onChanged: () => void;
  archived: boolean;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(action: 'exclude' | 'track' | 'wrong-match') {
    setError(null);
    setBusy(true);
    try {
      await request('POST', `/watches/${watchId}/listings/${listing.listingId}/${action}`, {});
      onChanged();
    } catch (err) {
      setError(describeFailure(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card">
      <h3>{listing.title || t.unknown}</h3>
      <div className="chips">
        <span className="badge">{listing.storeHost}</span>
        <span className="badge">
          {t.trust}: {listing.trustTier}
        </span>
        <span className="badge">
          {t.role}: {listing.role}
        </span>
        {listing.conditionUnknown && <span className="badge warn">{t.conditionUnknownFlag}</span>}
      </div>
      <p>
        <PriceLine listing={listing} />
      </p>
      <dl className="facts">
        <dt>{t.availability}</dt>
        <dd>{listing.availability}</dd>
        <dt>{t.condition}</dt>
        <dd>{listing.condition}</dd>
        <dt>{t.lastRead}</dt>
        <dd>{formatTime(listing.lastReadAt, t.notReadYet)}</dd>
        <dt>{t.nextCheck}</dt>
        <dd>{formatTime(listing.nextCheckAt, t.unknown)}</dd>
        <dt>{t.errors}</dt>
        <dd>{listing.consecutiveErrors}</dd>
        <dt>{t.lastError}</dt>
        <dd>{listing.lastError ?? t.none}</dd>
      </dl>
      {isHttpUrl(listing.url) && (
        <p>
          <ExternalLink href={listing.url} />
        </p>
      )}
      <Message kind="error" text={error} />
      <div className="actions">
        {listing.role !== 'excluded' && (
          <button type="button" disabled={busy || archived} onClick={() => act('exclude')}>
            {t.exclude}
          </button>
        )}
        {listing.role !== 'tracked' && (
          <button type="button" disabled={busy || archived} onClick={() => act('track')}>
            {t.track}
          </button>
        )}
        <button type="button" disabled={busy || archived} onClick={() => act('wrong-match')}>
          {t.wrongMatch}
        </button>
        <button type="button" onClick={() => setShowHistory((s) => !s)}>
          {showHistory ? t.hideHistory : t.history}
        </button>
      </div>
      {showHistory && <HistoryPanel listingId={listing.listingId} />}
    </article>
  );
}

export function WatchDetailView({ id, onBack }: { id: number; onBack: () => void }) {
  const [detail, setDetail] = useState<WatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    try {
      setDetail(await request<WatchDetail>('GET', `/watches/${id}`));
      setVersion((v) => v + 1);
    } catch (err) {
      setError(describeFailure(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const [marketCurrency, setMarketCurrency] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    request<SettingsResponse>('GET', '/settings')
      .then((res) => {
        const v = res.settings.find((s) => s.key === 'market.currency')?.value;
        if (live && typeof v === 'string') setMarketCurrency(v);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(describeFailure(err));
    } finally {
      setBusy(false);
    }
  }

  async function checkNow() {
    setError(null);
    setBusy(true);
    try {
      await request('POST', '/refresh', {});
      setNotice(t.checkQueued);
      setTimeout(() => {
        void load();
        setBusy(false);
      }, REFETCH_AFTER_MS);
    } catch (err) {
      setError(describeFailure(err));
      setBusy(false);
    }
  }

  if (detail === null) {
    return (
      <section>
        <button type="button" onClick={onBack}>
          {t.back}
        </button>
        <Message kind="error" text={error} />
        {error === null && <p className="muted">{t.loading}</p>}
      </section>
    );
  }

  const { watch, listings } = detail;
  const archived = watch.status === 'archived';
  return (
    <section>
      <button type="button" onClick={onBack}>
        {t.back}
      </button>
      <h1>{isHttpUrl(watch.input) ? <ExternalLink href={watch.input} /> : watch.input}</h1>
      <div className="chips">
        <span className={`badge ${watch.status === 'active' ? '' : 'warn'}`}>
          {t.status[watch.status] ?? watch.status}
        </span>
        <LookupLine watch={watch} />
      </div>
      <p>
        {t.reference}: <MoneyText value={watch.reference?.price ?? null} empty={t.referenceNone} />
      </p>
      <p className="muted">
        {t.counts(watch.counts.tracked, watch.counts.candidate, watch.counts.excluded)}
      </p>
      <div className="actions">
        <button type="button" className="primary" disabled={busy || archived} onClick={checkNow}>
          {busy ? t.checking : t.checkNow}
        </button>
        {watch.status === 'active' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => request('PATCH', `/watches/${id}`, { paused: true }))}
          >
            {t.pause}
          </button>
        )}
        {watch.status === 'paused' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => request('PATCH', `/watches/${id}`, { paused: false }))}
          >
            {t.resume}
          </button>
        )}
        {!archived && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(t.archiveConfirm)) {
                void run(() => request('DELETE', `/watches/${id}`, {}));
              }
            }}
          >
            {t.archive}
          </button>
        )}
      </div>
      <Message kind="error" text={error} />
      <Message kind="ok" text={notice} />
      <Rules
        key={version}
        watch={watch}
        marketCurrency={marketCurrency}
        onSaved={() => {
          setNotice(t.rulesSaved);
          void load();
        }}
      />
      <h2>{t.listingsTitle}</h2>
      {listings.length === 0 && <p className="muted">{t.noListings}</p>}
      {listings.map((l) => (
        <ListingCard
          key={l.listingId}
          watchId={watch.id}
          listing={l}
          onChanged={load}
          archived={archived}
        />
      ))}
    </section>
  );
}
