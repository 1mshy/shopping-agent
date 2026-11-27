import { useEffect, useState } from 'react';
import { describeFailure, request } from '../http.ts';
import { t } from '../strings.ts';
import { formatTime, Message } from '../ui.tsx';

interface FetchStatus {
  rungs: string[];
  hosts: {
    id: number;
    host: string;
    pageKind: string;
    rung: string;
    lastOutcome: string;
    wallVendor: string | null;
    backoffUntil: string | null;
    attempts: number;
  }[];
}
export function FetchDiagnostics() {
  const [data, setData] = useState<FetchStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    request<FetchStatus>('GET', '/diagnostics/fetch')
      .then((value) => {
        if (active) setData(value);
      })
      .catch((cause) => {
        if (active) setError(describeFailure(cause));
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section>
      <h2>{t.fetchDiagnostics}</h2>
      <Message kind="error" text={error} />
      {!data && !error && <p>{t.loading}</p>}
      {data && (
        <>
          <p>
            {t.availableRungs}: {data.rungs.join(', ')}
          </p>
          {data.hosts.length === 0 ? (
            <p className="muted">{t.noFetches}</p>
          ) : (
            <div className="scroll-table">
              <table>
                <thead>
                  <tr>
                    {[
                      t.storeHost,
                      t.pageKind,
                      t.rung,
                      t.outcomeColumn,
                      t.attempts,
                      t.backoffUntil,
                    ].map((label) => (
                      <th scope="col" key={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.hosts.map((h) => (
                    <tr key={h.id}>
                      <td>{h.host}</td>
                      <td>{h.pageKind}</td>
                      <td>{h.rung}</td>
                      <td>
                        {h.lastOutcome}
                        {h.wallVendor && ` (${h.wallVendor})`}
                      </td>
                      <td>{h.attempts}</td>
                      <td>{formatTime(h.backoffUntil, t.none)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
