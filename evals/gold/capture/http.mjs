// Paced plain HTTP: one request in flight per host, >=1.2 s between starts to a host.
import { appendFileSync } from 'node:fs';
export const UA = 'agentic-dasher-lab/0.1 (gold-set snapshot capture)';
const next = new Map();
const tails = new Map();
export const LOG = process.env.GOLD_LOG ?? './requests.log';
// Hosts that rate-limited (429) during this capture: never contacted again.
const walled = new Set(['www.alternate.de', 'www.kmstools.com']);
let n = 0;
export async function get(
  url,
  {
    headers = {},
    method = 'GET',
    body,
    gap = 1200,
    timeout = 25000,
    accept = 'application/json, text/html;q=0.9, */*;q=0.5',
    lang = 'en-CA,en;q=0.9',
  } = {},
) {
  const host = new URL(url).host;
  if (walled.has(host))
    return { status: -1, url, text: '', error: 'host stopped (walled or rate-limited earlier)' };
  const prev = tails.get(host) ?? Promise.resolve();
  let release;
  const tail = prev.then(() => new Promise((r) => (release = r)));
  tails.set(host, tail);
  await prev;
  try {
    const wait = (next.get(host) ?? 0) - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    next.set(host, Date.now() + gap + Math.floor(Math.random() * 300));
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method,
        body,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
        headers: { 'user-agent': UA, accept, 'accept-language': lang, ...headers },
      });
      const text = await res.text();
      n++;
      if (res.status === 429 || res.status === 403 || res.status === 503) walled.add(host);
      appendFileSync(
        LOG,
        `${new Date().toISOString()}\t${method}\t${res.status}\t${text.length}\t${Date.now() - t0}ms\t${url}\t${res.url !== url ? `final=${res.url}` : ''}\n`,
      );
      return { status: res.status, url: res.url, text, headers: Object.fromEntries(res.headers) };
    } catch (e) {
      appendFileSync(
        LOG,
        `${new Date().toISOString()}\t${method}\tERR\t0\t${Date.now() - t0}ms\t${url}\t${e?.cause?.code ?? e?.name}\n`,
      );
      return { status: 0, url, text: '', error: String(e?.cause?.code ?? e?.name ?? e) };
    }
  } finally {
    release();
  }
}
export function json(r) {
  try {
    return JSON.parse(r.text);
  } catch {
    return null;
  }
}
export const requests = () => n;
export const stoppedHosts = () => [...walled];
