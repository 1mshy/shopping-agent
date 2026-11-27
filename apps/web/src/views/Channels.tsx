import { type FormEvent, useState } from 'react';
import { describeFailure, request } from '../http.ts';
import { t } from '../strings.ts';
import { Message } from '../ui.tsx';

export interface Channel {
  id: number;
  name: string;
  type: string;
  enabled: boolean;
  removedAt: string | null;
  hasSecret: boolean;
  config: {
    url?: string;
    secretHeader?: string;
    serverUrl?: string;
    topic?: string;
    priority?: number;
  };
}
interface Props {
  channel?: Channel;
  changed: (channel: Channel) => void;
}
export function ChannelForm({ channel, changed }: Props) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(channel?.type ?? 'webhook');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clear, setClear] = useState(false);
  const config = channel?.config;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fields = new FormData(e.currentTarget);
    const val = (name: string) => String(fields.get(name) ?? '');
    const payload = {
      name: val('name'),
      ...(!channel ? { type: kind } : {}),
      config:
        kind === 'ntfy'
          ? {
              serverUrl: val('url'),
              topic: val('topic'),
              ...(val('priority') ? { priority: Number(val('priority')) } : {}),
            }
          : { url: val('url'), ...(val('header') ? { secretHeader: val('header') } : {}) },
      ...(clear ? { secret: null } : val('secret') ? { secret: val('secret') } : {}),
    };
    setBusy(true);
    setError(null);
    try {
      const res = await request<{ channel: Channel }>(
        channel ? 'PATCH' : 'POST',
        channel ? `/channels/${channel.id}` : '/channels',
        payload,
      );
      changed(res.channel);
      setOpen(false);
      setClear(false);
    } catch (err) {
      setError(describeFailure(err));
    } finally {
      setBusy(false);
    }
  }
  if (!open)
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setError(null);
          setClear(false);
        }}
      >
        {channel ? t.editChannel : t.addChannel}
      </button>
    );
  return (
    <form className="card" onSubmit={save}>
      <fieldset disabled={busy}>
        <legend>{channel ? t.editChannel : t.addChannel}</legend>
        {!channel && (
          <label>
            {t.channelType}
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="webhook">Webhook</option>
              <option value="ntfy">ntfy</option>
            </select>
          </label>
        )}
        <label>
          {t.channelName}
          <input name="name" defaultValue={channel?.name} required maxLength={80} />
        </label>
        <label>
          {kind === 'ntfy' ? t.ntfyServer : t.webhookUrl}
          <input name="url" type="url" required defaultValue={config?.serverUrl ?? config?.url} />
        </label>
        {kind === 'ntfy' ? (
          <>
            <label>
              {t.ntfyTopic}
              <input name="topic" required defaultValue={config?.topic} />
            </label>
            <label>
              {t.ntfyPriority}
              <input
                name="priority"
                type="number"
                min="1"
                max="5"
                defaultValue={config?.priority}
              />
            </label>
          </>
        ) : (
          <label>
            {t.secretHeader}
            <input name="header" defaultValue={config?.secretHeader ?? 'X-Agentic-Dasher-Secret'} />
          </label>
        )}
        <label>
          {kind === 'ntfy' ? t.ntfyToken : t.webhookSecret}
          <input name="secret" type="password" autoComplete="new-password" disabled={clear} />
        </label>
        {channel?.hasSecret && (
          <>
            <small>{t.keepChannelSecret}</small>
            <label>
              <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} />{' '}
              {t.clearChannelSecret}
            </label>
          </>
        )}
        <div className="actions">
          <button type="submit">{t.save}</button>
          <button type="button" onClick={() => setOpen(false)}>
            {t.cancelChannel}
          </button>
        </div>
        <Message kind="error" text={error} />
      </fieldset>
    </form>
  );
}

export function ChannelRow({ channel, changed }: { channel: Channel; changed: Props['changed'] }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function act(action: 'test' | 'enable' | 'disable' | 'remove') {
    if (action === 'remove' && !window.confirm(t.confirmChannelRemoval(channel.name))) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const base = `/channels/${channel.id}`;
    try {
      if (action === 'test') {
        const { outcome } = await request<{
          outcome: { attempt: { kind: string; status?: number }; errorClass: string | null };
        }>('POST', `${base}/test`, {});
        const attempt = outcome.attempt;
        if (attempt.kind === 'accepted') setResult(t.testResult(attempt.kind));
        else
          setError(
            t.testResult(
              attempt.status ? `HTTP ${attempt.status}` : (outcome.errorClass ?? attempt.kind),
            ),
          );
      } else {
        const res = await request<{ channel: Channel }>(
          action === 'remove' ? 'DELETE' : 'POST',
          action === 'remove' ? base : `${base}/${action}`,
          {},
        );
        changed(res.channel);
      }
    } catch (err) {
      setError(describeFailure(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="card">
      <strong>{channel.name}</strong> <span className="badge">{channel.type}</span>{' '}
      <span className="badge">{channel.enabled ? t.enabled : t.disabled}</span>
      <div className="actions">
        <button type="button" disabled={busy} onClick={() => act('test')}>
          {t.test}
        </button>
        {channel.type !== 'in_app' && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => act(channel.enabled ? 'disable' : 'enable')}
            >
              {channel.enabled ? t.disableChannel : t.enableChannel}
            </button>
            <button type="button" disabled={busy} onClick={() => act('remove')}>
              {t.removeChannel}
            </button>
          </>
        )}
      </div>
      {(channel.type === 'ntfy' || channel.type === 'webhook') && (
        <ChannelForm changed={changed} channel={channel} />
      )}
      <Message kind="ok" text={result} />
      <Message kind="error" text={error} />
    </li>
  );
}
