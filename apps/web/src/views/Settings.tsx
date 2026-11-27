// Settings (read-mostly in this cut) and Diagnostics.
import {
  ROBOTS_MODES,
  type SettingResponse,
  type SettingsResponse,
  type SettingView,
} from '@agentic-dasher/shared';
import { useEffect, useState } from 'react';
import { describeFailure, request } from '../http.ts';
import { t } from '../strings.ts';
import { formatTime, Message } from '../ui.tsx';

import { ChangePassword } from './ChangePassword.tsx';

import { type Channel, ChannelForm, ChannelRow } from './Channels.tsx';

function settingText(s: SettingView | undefined): string {
  if (s === undefined || !s.isSet || s.value === null) return t.unknown;
  return typeof s.value === 'string' ? s.value : JSON.stringify(s.value);
}

function RobotsSetting({ setting }: { setting: SettingView }) {
  const [current, setCurrent] = useState(setting);
  const [value, setValue] = useState(settingText(setting));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await request<SettingResponse>('PUT', '/settings/fetch.robots', { value });
      setCurrent(result.setting);
      setValue(settingText(result.setting));
    } catch (cause) {
      setError(describeFailure(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <label htmlFor="robots-mode">{t.robotsMode}</label>
      <select
        id="robots-mode"
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
      >
        {ROBOTS_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {mode}
          </option>
        ))}
      </select>
      <button type="button" disabled={busy || value === current.value} onClick={save}>
        {t.save}
      </button>
      <p className="muted" role="status">
        {t.settingSource(settingText(current), current.source ?? t.unknown)}
      </p>
      <Message kind="error" text={error} />
    </div>
  );
}

export function SettingsView({ onChangeMarket }: { onChangeMarket: () => void }) {
  const [settings, setSettings] = useState<readonly SettingView[] | null>(null);
  const [channels, setChannels] = useState<readonly Channel[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      request<SettingsResponse>('GET', '/settings'),
      request<{ channels: Channel[] }>('GET', '/channels'),
    ])
      .then(([s, c]) => {
        if (!live) return;
        setSettings(s.settings);
        setChannels(c.channels);
      })
      .catch((err) => live && setError(describeFailure(err)));
    return () => {
      live = false;
    };
  }, []);

  function changed(channel: Channel) {
    setChannels((rows) => {
      const current = rows ?? [];
      if (channel.removedAt) return current.filter((row) => row.id !== channel.id);
      return current.some((row) => row.id === channel.id)
        ? current.map((row) => (row.id === channel.id ? channel : row))
        : [...current, channel];
    });
  }
  const get = (key: string) => settings?.find((s) => s.key === key);
  const robots = get('fetch.robots');
  return (
    <section>
      <h1>{t.settingsTitle}</h1>
      <Message kind="error" text={error} />
      {settings === null && error === null && <p className="muted">{t.loading}</p>}
      {settings !== null && (
        <div className="card">
          <dl className="facts">
            <dt>{t.market}</dt>
            <dd>
              {settingText(get('market.country'))} · {settingText(get('market.currency'))} ·{' '}
              {settingText(get('market.language'))}
            </dd>
          </dl>
          {robots && <RobotsSetting setting={robots} />}
          <div className="actions">
            <button type="button" onClick={onChangeMarket}>
              {t.localeChange}
            </button>
          </div>
        </div>
      )}
      <ChangePassword />
      <h2>{t.channelsTitle}</h2>
      {channels !== null && <ChannelForm changed={changed} />}
      {channels !== null && channels.length === 0 && <p className="muted">{t.noChannels}</p>}
      <ul className="plain">
        {channels?.map((c) => (
          <ChannelRow key={c.id} channel={c} changed={changed} />
        ))}
      </ul>
    </section>
  );
}

interface JobsResponse {
  readonly jobs: readonly {
    readonly name: string;
    readonly nextRunAt: string | null;
    readonly running: boolean;
    readonly lastRun: { readonly status: string; readonly startedAt: string } | null;
  }[];
  readonly runs: readonly {
    readonly id: number;
    readonly job: string;
    readonly status: string;
    readonly reason: string | null;
    readonly startedAt: string;
    readonly endedAt: string | null;
  }[];
}

export function DiagnosticsView() {
  const [data, setData] = useState<JobsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    request<JobsResponse>('GET', '/diagnostics/jobs')
      .then((d) => live && setData(d))
      .catch((err) => live && setError(describeFailure(err)));
    return () => {
      live = false;
    };
  }, []);

  return (
    <section>
      <h1>{t.diagnosticsTitle}</h1>
      <Message kind="error" text={error} />
      {data === null && error === null && <p className="muted">{t.loading}</p>}
      {data !== null && (
        <>
          <h2>{t.jobsTitle}</h2>
          <table>
            <thead>
              <tr>
                <th scope="col">{t.jobColumn}</th>
                <th scope="col">{t.lastRunColumn}</th>
                <th scope="col">{t.nextRunColumn}</th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.map((j) => (
                <tr key={j.name}>
                  <td>{j.name}</td>
                  <td>{j.running ? 'running' : (j.lastRun?.status ?? t.never)}</td>
                  <td>{formatTime(j.nextRunAt, t.none)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2>{t.runsTitle}</h2>
          {data.runs.length === 0 && <p className="muted">{t.noRuns}</p>}
          <table>
            <thead>
              <tr>
                <th scope="col">{t.jobColumn}</th>
                <th scope="col">{t.outcomeColumn}</th>
                <th scope="col">{t.startedColumn}</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((r) => (
                <tr key={r.id}>
                  <td>{r.job}</td>
                  <td>
                    {r.status}
                    {r.reason !== null && ` (${r.reason})`}
                  </td>
                  <td>{formatTime(r.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
