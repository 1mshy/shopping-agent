// The locale step (S§5.12 wizard step 2): country, currency, language. There is no default
// currency (S§2 invariant 2): nothing is pre-selected; common codes are offered as shortcuts.
import type { SettingsResponse } from '@agentic-dasher/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { describeFailure, request } from '../http.ts';
import { t } from '../strings.ts';
import { Message } from '../ui.tsx';

const COMMON_CURRENCIES = ['EUR', 'USD', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY', 'SEK'];

const KEYS = {
  country: 'market.country',
  currency: 'market.currency',
  language: 'market.language',
} as const;

export function LocaleStep({ onDone }: { onDone: () => void }) {
  const [country, setCountry] = useState('');
  const [currency, setCurrency] = useState('');
  const [language, setLanguage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Show values already in effect (from the database or the environment), never invent one.
  useEffect(() => {
    let live = true;
    request<SettingsResponse>('GET', '/settings')
      .then((res) => {
        if (!live) return;
        const value = (key: string) => {
          const v = res.settings.find((s) => s.key === key)?.value;
          return typeof v === 'string' ? v : '';
        };
        setCountry((c) => c || value(KEYS.country));
        setCurrency((c) => c || value(KEYS.currency));
        setLanguage((c) => c || value(KEYS.language));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const entries: [string, string, string][] = [
      [KEYS.country, country.trim().toUpperCase(), t.countryLabel],
      [KEYS.currency, currency.trim().toUpperCase(), t.currencyLabel],
      [KEYS.language, language.trim(), t.languageLabel],
    ];
    try {
      for (const [key, value, label] of entries) {
        try {
          await request('PUT', `/settings/${key}`, { value });
        } catch (err) {
          setError(t.localeRefused(label, describeFailure(err)));
          return;
        }
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card">
      <h1>{t.localeTitle}</h1>
      <p>{t.localeIntro}</p>
      <label htmlFor="country">{t.countryLabel}</label>
      <input
        id="country"
        value={country}
        maxLength={2}
        autoCapitalize="characters"
        onChange={(e) => setCountry(e.target.value)}
        required
      />
      <label htmlFor="currency">{t.currencyLabel}</label>
      <div className="chips">
        {COMMON_CURRENCIES.map((code) => (
          <button
            key={code}
            type="button"
            aria-pressed={currency.toUpperCase() === code}
            className={currency.toUpperCase() === code ? 'primary' : ''}
            onClick={() => setCurrency(code)}
          >
            {code}
          </button>
        ))}
      </div>
      <input
        id="currency"
        value={currency}
        maxLength={3}
        autoCapitalize="characters"
        onChange={(e) => setCurrency(e.target.value)}
        required
      />
      <p className="muted">{t.currencyNoDefault}</p>
      <label htmlFor="language">{t.languageLabel}</label>
      <input
        id="language"
        value={language}
        maxLength={35}
        onChange={(e) => setLanguage(e.target.value)}
        required
      />
      <Message kind="error" text={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? t.saving : t.localeSubmit}
        </button>
      </div>
    </form>
  );
}
