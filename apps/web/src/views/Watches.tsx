// The home screen of Phase 1: the paste box and the list of watches (S§5.12 Watches).
import type { CreateWatchResponse, WatchLastAlert, WatchView } from '@agentic-dasher/shared';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiFailure, describeFailure, request } from '../http.ts';
import { t } from '../strings.ts';
import { ExternalLink, formatTime, isHttpUrl, Message, MoneyText } from '../ui.tsx';

export function LookupLine({ watch }: { watch: WatchView }) {
  const lookup = watch.lookup;
  if (lookup === null) return null;
  const nameNeedsDirectory = lookup.state === 'failed' && lookup.error === 'NO_DISCOVERY_SOURCE';
  return (
    <>
      <span className={`badge ${lookup.state === 'failed' ? 'error' : ''}`}>
        {t.lookup}: {lookup.state}
      </span>
      {lookup.state === 'failed' && (
        <p className="msg warn">
          {nameNeedsDirectory
            ? t.noDiscoverySource
            : `${t.lookupError}: ${lookup.error ?? t.unknown}`}
        </p>
      )}
    </>
  );
}

function AlertLine({ label, alert }: { label: string; alert: WatchLastAlert | null }) {
  if (alert === null) return null;
  return (
    <li className="muted">
      {label}: {formatTime(alert.createdAt)} · {t.delivery[alert.delivery] ?? alert.delivery}
      {alert.price !== null && (
        <>
          {' · '}
          <MoneyText value={alert.price} />
        </>
      )}
    </li>
  );
}

export function WatchCard({ watch, onOpen }: { watch: WatchView; onOpen: () => void }) {
  return (
    <article className="card">
      <h3>{isHttpUrl(watch.input) ? <ExternalLink href={watch.input} /> : watch.input}</h3>
      <div className="chips">
        <span className={`badge ${watch.status === 'active' ? '' : 'warn'}`}>
          {t.status[watch.status] ?? watch.status}
        </span>
        <LookupLine watch={watch} />
      </div>
      <p className="muted">
        {t.counts(watch.counts.tracked, watch.counts.candidate, watch.counts.excluded)}
      </p>
      <p>
        {t.reference}: <MoneyText value={watch.reference?.price ?? null} empty={t.referenceNone} />
        {watch.reference !== null && <span className="muted"> ({watch.reference.kind})</span>}
      </p>
      <ul className="plain">
        <AlertLine label={t.lastDropAlert} alert={watch.lastAlerts.price_drop} />
        <AlertLine label={t.lastRestockAlert} alert={watch.lastAlerts.restock} />
      </ul>
      <div className="actions">
        <button type="button" onClick={onOpen}>
          {t.open}
        </button>
      </div>
    </article>
  );
}

export function WatchesView({
  onOpen,
  onMarketNotSet,
}: {
  onOpen: (id: number) => void;
  onMarketNotSet: () => void;
}) {
  const [watches, setWatches] = useState<readonly WatchView[] | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await request<{ watches: WatchView[] }>(
        'GET',
        `/watches${includeArchived ? '?includeArchived=1' : ''}`,
      );
      setWatches(res.watches);
    } catch (err) {
      setError(describeFailure(err));
    }
  }, [includeArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const text = input.trim();
    if (text === '') return;
    setBusy(true);
    try {
      const res = await request<CreateWatchResponse>('POST', '/watches', { input: text });
      setInput('');
      setNotice(res.created ? t.watchCreated : t.watchExists);
      await load();
    } catch (err) {
      if (err instanceof ApiFailure && err.code === 'market_not_set') {
        setError(t.marketNotSet);
        onMarketNotSet();
      } else {
        setError(describeFailure(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>{t.watchesTitle}</h1>
      <form className="row" onSubmit={submit}>
        <input
          aria-label={t.pastePlaceholder}
          placeholder={t.pastePlaceholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={4000}
        />
        <button type="submit" className="primary" disabled={busy}>
          {busy ? t.checking : t.pasteSubmit}
        </button>
      </form>
      <Message kind="error" text={error} />
      <Message kind="ok" text={notice} />
      <label className="inline">
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(e) => setIncludeArchived(e.target.checked)}
        />
        {t.showArchived}
      </label>
      {watches === null && <p className="muted">{t.loading}</p>}
      {watches !== null && watches.length === 0 && <p className="muted">{t.noWatches}</p>}
      {watches?.map((w) => (
        <WatchCard key={w.id} watch={w} onOpen={() => onOpen(w.id)} />
      ))}
    </section>
  );
}
