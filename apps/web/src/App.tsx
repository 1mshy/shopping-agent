import type { HealthResponse } from '@agentic-dasher/shared';
import { useEffect, useState } from 'react';
import { api } from './api.ts';

type State = { kind: 'loading' } | { kind: 'ok'; health: HealthResponse } | { kind: 'error' };

// Placeholder shell until the Phase 1 minimal UI. Shows that the SPA, the API and the
// typed RPC client are wired end to end.
export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    api.health
      .$get()
      .then((res) => res.json())
      .then((health) => !cancelled && setState({ kind: 'ok', health }))
      .catch(() => !cancelled && setState({ kind: 'error' }));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: '40rem' }}>
      <h1>Agentic Dasher</h1>
      <p>Phase 0 scaffold. Nothing to shop with yet.</p>
      <p>
        Server: {state.kind === 'loading' && 'checking…'}
        {state.kind === 'error' && 'unreachable'}
        {state.kind === 'ok' &&
          `${state.health.status} · v${state.health.version} · db ${state.health.db}`}
      </p>
    </main>
  );
}
