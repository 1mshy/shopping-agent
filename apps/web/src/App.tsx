// The minimal Phase 1 UI (S§5.12): the gate (setup or sign-in), the locale step, then the app:
// watches, a watch's detail with history, alerts, settings and diagnostics. No router library: the
// view lives in `location.hash` so back and forward work.
import type { AuthStatusResponse, SetupStatusResponse } from '@agentic-dasher/shared';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { describeFailure, request, setSessionEndedHandler } from './http.ts';
import { t } from './strings.ts';
import { Message } from './ui.tsx';
import { AlertsView } from './views/Alerts.tsx';
import { Login, Setup } from './views/Gate.tsx';
import { LocaleStep } from './views/Locale.tsx';
import { DiagnosticsView, SettingsView } from './views/Settings.tsx';
import { WatchDetailView } from './views/WatchDetail.tsx';
import { WatchesView } from './views/Watches.tsx';

type Phase =
  | { kind: 'loading' }
  | { kind: 'unreachable'; message: string }
  | { kind: 'setup' }
  | { kind: 'login'; notice: string | null }
  | { kind: 'locale' }
  | { kind: 'app' };

type View =
  | { name: 'watches' }
  | { name: 'watch'; id: number }
  | { name: 'alerts' }
  | { name: 'settings' }
  | { name: 'diagnostics' }
  | { name: 'market' };

function viewFromHash(hash: string): View {
  const parts = hash.replace(/^#\/?/, '').split('/');
  switch (parts[0]) {
    case 'watch': {
      const id = Number(parts[1]);
      return Number.isSafeInteger(id) && id > 0 ? { name: 'watch', id } : { name: 'watches' };
    }
    case 'alerts':
    case 'settings':
    case 'diagnostics':
    case 'market':
      return { name: parts[0] };
    default:
      return { name: 'watches' };
  }
}

function hashOf(view: View): string {
  return view.name === 'watch' ? `#/watch/${view.id}` : `#/${view.name}`;
}

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [view, setView] = useState<View>(() => viewFromHash(window.location.hash));

  const go = useCallback((next: View) => {
    window.location.hash = hashOf(next);
  }, []);

  useEffect(() => {
    const onHash = () => setView(viewFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const check = useCallback(async () => {
    try {
      const status = await request<AuthStatusResponse>('GET', '/auth/status');
      if (!status.passwordSet) return setPhase({ kind: 'setup' });
      if (!status.signedIn) return setPhase({ kind: 'login', notice: null });
      const setup = await request<SetupStatusResponse>('GET', '/setup');
      setPhase(setup.locale ? { kind: 'app' } : { kind: 'locale' });
    } catch (err) {
      setPhase((p) =>
        p.kind === 'login' ? p : { kind: 'unreachable', message: describeFailure(err) },
      );
    }
  }, []);

  useEffect(() => {
    setSessionEndedHandler(() => setPhase({ kind: 'login', notice: t.sessionEnded }));
    void check();
  }, [check]);

  async function logout() {
    try {
      await request('POST', '/auth/logout', {});
    } catch {
      // A failed logout still leaves the gate: the status call below says where we stand.
    }
    await check();
  }

  let body: ReactNode;
  switch (phase.kind) {
    case 'loading':
      body = <p className="muted">{t.loading}</p>;
      break;
    case 'unreachable':
      body = (
        <>
          <Message kind="error" text={`${t.serverUnreachable} ${phase.message}`} />
          <button type="button" onClick={() => check()}>
            {t.retry}
          </button>
        </>
      );
      break;
    case 'setup':
      body = <Setup onDone={check} />;
      break;
    case 'login':
      body = <Login onDone={check} notice={phase.notice} />;
      break;
    case 'locale':
      body = <LocaleStep onDone={check} />;
      break;
    case 'app':
      body = renderView();
      break;
  }

  function renderView() {
    switch (view.name) {
      case 'watch':
        return (
          <WatchDetailView key={view.id} id={view.id} onBack={() => go({ name: 'watches' })} />
        );
      case 'alerts':
        return <AlertsView />;
      case 'settings':
        return <SettingsView onChangeMarket={() => go({ name: 'market' })} />;
      case 'diagnostics':
        return <DiagnosticsView />;
      case 'market':
        return <LocaleStep onDone={() => go({ name: 'watches' })} />;
      default:
        return (
          <WatchesView
            onOpen={(id) => go({ name: 'watch', id })}
            onMarketNotSet={() => go({ name: 'market' })}
          />
        );
    }
  }

  const signedIn = phase.kind === 'app' || phase.kind === 'locale';
  const tabs: { view: View; label: string }[] = [
    { view: { name: 'watches' }, label: t.navWatches },
    { view: { name: 'alerts' }, label: t.navAlerts },
    { view: { name: 'settings' }, label: t.navSettings },
    { view: { name: 'diagnostics' }, label: t.navDiagnostics },
  ];
  const current = view.name === 'watch' ? 'watches' : view.name;

  return (
    <main>
      <header className="bar">
        <strong>{t.appName}</strong>
        {signedIn && (
          <button type="button" onClick={logout}>
            {t.logout}
          </button>
        )}
        {phase.kind === 'app' && (
          <nav>
            {tabs.map((tab) => (
              <button
                key={tab.view.name}
                type="button"
                aria-current={current === tab.view.name ? 'page' : undefined}
                onClick={() => go(tab.view)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        )}
      </header>
      {body}
    </main>
  );
}
