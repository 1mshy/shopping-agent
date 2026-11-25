// The in-app feed (GET /api/notifications), newest first, paged with `before`.
import type { NotificationItem, NotificationsPage } from '@agentic-dasher/shared';
import { useCallback, useEffect, useState } from 'react';
import { describeFailure, request } from '../http.ts';
import { t } from '../strings.ts';
import { ExternalLink, formatTime, isHttpUrl, Message } from '../ui.tsx';

export function AlertsView() {
  const [items, setItems] = useState<readonly NotificationItem[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (before: number | null) => {
    try {
      const page = await request<NotificationsPage>(
        'GET',
        `/notifications${before === null ? '' : `?before=${before}`}`,
      );
      setItems((prev) => (before === null ? page.items : [...(prev ?? []), ...page.items]));
      setNext(page.next);
    } catch (err) {
      setError(describeFailure(err));
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  return (
    <section>
      <h1>{t.alertsTitle}</h1>
      <Message kind="error" text={error} />
      {items === null && error === null && <p className="muted">{t.loading}</p>}
      {items !== null && items.length === 0 && <p className="muted">{t.noAlerts}</p>}
      {items?.map((n) => (
        <article className="card" key={n.eventId}>
          <h3>{n.title}</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p>
          {n.url !== null && isHttpUrl(n.url) && (
            <p>
              <ExternalLink href={n.url} />
            </p>
          )}
          <p className="muted">
            {formatTime(n.createdAt)} · {n.kind} ·{' '}
            {n.inApp === null ? t.inAppNone : (t.inApp[n.inApp] ?? n.inApp)}
          </p>
        </article>
      ))}
      {next !== null && (
        <button type="button" onClick={() => load(next)}>
          {t.loadMore}
        </button>
      )}
    </section>
  );
}
