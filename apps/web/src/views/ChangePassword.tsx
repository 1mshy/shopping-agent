import { type FormEvent, useState } from 'react';
import { describeFailure, request } from '../http.ts';
import { t } from '../strings.ts';
import { Message } from '../ui.tsx';

export function ChangePassword() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setSaved(false);
    setError(null);
    if (values.get('new') !== values.get('confirm')) {
      setError(t.passwordMismatch);
      return;
    }
    setBusy(true);
    try {
      await request('POST', '/auth/password', {
        currentPassword: values.get('current'),
        newPassword: values.get('new'),
      });
      form.reset();
      setSaved(true);
    } catch (cause) {
      setError(describeFailure(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="card">
      <summary>{t.changePassword}</summary>
      <form onSubmit={submit}>
        <label htmlFor="current-password">{t.currentPassword}</label>
        <input
          id="current-password"
          name="current"
          type="password"
          autoComplete="current-password"
          required
        />
        <label htmlFor="new-password">{t.newPassword}</label>
        <input id="new-password" name="new" type="password" autoComplete="new-password" required />
        <label htmlFor="confirm-password">{t.repeatNewPassword}</label>
        <input
          id="confirm-password"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
        />
        <button type="submit" disabled={busy}>
          {t.changePassword}
        </button>
        <Message kind="error" text={error} />
        <Message kind="ok" text={saved ? t.passwordChanged : null} />
      </form>
    </details>
  );
}
