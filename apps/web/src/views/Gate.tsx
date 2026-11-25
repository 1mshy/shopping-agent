// The gate: first-run password setup, or sign-in (S§5.12 step 1, S§5.13).
import { type FormEvent, useState } from 'react';
import { ApiFailure, describeFailure, request } from '../http.ts';
import { t } from '../strings.ts';
import { Message } from '../ui.tsx';

/** PASSWORD_MIN_LENGTH of packages/shared auth.ts, repeated so the bundle does not pull in zod. */
export const PASSWORD_MIN_LENGTH = 15;

/** Code points after NFKC, as the server counts them. */
function length(password: string): number {
  return [...password.normalize('NFKC')].length;
}

export function Setup({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (length(password) < PASSWORD_MIN_LENGTH) {
      setError(t.passwordTooShort(PASSWORD_MIN_LENGTH));
      return;
    }
    if (password !== confirm) {
      setError(t.passwordMismatch);
      return;
    }
    setBusy(true);
    try {
      await request('POST', '/auth/setup', { password });
      onDone();
    } catch (err) {
      setError(describeFailure(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card">
      <h1>{t.setupTitle}</h1>
      <p>{t.setupIntro}</p>
      <label htmlFor="pw">{t.passwordLabel}</label>
      <input
        id="pw"
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <label htmlFor="pw2">{t.passwordConfirmLabel}</label>
      <input
        id="pw2"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        required
      />
      <p className="muted">{t.passwordTooShort(PASSWORD_MIN_LENGTH)}</p>
      <Message kind="error" text={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? t.saving : t.setupSubmit}
        </button>
      </div>
    </form>
  );
}

export function Login({ onDone, notice }: { onDone: () => void; notice: string | null }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await request('POST', '/auth/login', { password });
      setPassword('');
      onDone();
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 401) setError(t.loginFailed);
      else if (err instanceof ApiFailure && err.status === 429)
        setError(t.throttled(err.retryAfterS));
      else setError(describeFailure(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card">
      <h1>{t.loginTitle}</h1>
      <Message kind="warn" text={notice} />
      <label htmlFor="pw">{t.passwordLabel}</label>
      <input
        id="pw"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <Message kind="error" text={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>
          {t.loginSubmit}
        </button>
      </div>
    </form>
  );
}
