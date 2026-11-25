// A thin typed fetch wrapper over the same-origin API. The session cookie is HttpOnly and travels
// by itself (credentials: 'same-origin'). Every non-GET request sends a JSON body with
// `Content-Type: application/json`, which the server's CSRF check requires, even when empty (`{}`).
// Refusals arrive as `{ error: { code, message, fields? } }` and are thrown as ApiFailure. A 401
// outside the login call means the session ended: the registered handler sends the app to the gate.

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Readonly<Record<string, string>> | readonly string[] | undefined;
  /** Seconds from the Retry-After header of a 429, when given. */
  readonly retryAfterS: number | null;

  constructor(
    status: number,
    code: string,
    message: string,
    fields: ApiFailure['fields'],
    retryAfterS: number | null,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.retryAfterS = retryAfterS;
  }
}

let onSessionEnded: () => void = () => {};

/** The app registers what a 401 does (back to the gate). */
export function setSessionEndedHandler(handler: () => void): void {
  onSessionEnded = handler;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') {
    init.headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    init.body = JSON.stringify(body ?? {});
  } else {
    init.headers = { Accept: 'application/json' };
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiFailure(0, 'network', 'The server cannot be reached.', undefined, null);
  }
  let data: unknown = null;
  const text = await res.text();
  if (text !== '') {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (res.ok) return data as T;

  const err = (data as { error?: { code?: unknown; message?: unknown; fields?: unknown } } | null)
    ?.error;
  const code = typeof err?.code === 'string' ? err.code : `http_${res.status}`;
  const message = typeof err?.message === 'string' ? err.message : `HTTP ${res.status}`;
  const retry = Number(res.headers.get('Retry-After'));
  const failure = new ApiFailure(
    res.status,
    code,
    message,
    err?.fields as ApiFailure['fields'],
    Number.isFinite(retry) && retry > 0 ? retry : null,
  );
  if (res.status === 401 && path !== '/auth/login') onSessionEnded();
  throw failure;
}

/** A refusal's message with its field messages, for showing to the user as text. */
export function describeFailure(error: unknown): string {
  if (!(error instanceof ApiFailure)) return error instanceof Error ? error.message : String(error);
  const fields = error.fields;
  if (fields === undefined || Array.isArray(fields)) return error.message;
  const parts = Object.entries(fields as Record<string, string>).map(([k, v]) => `${k}: ${v}`);
  return parts.length === 0 ? error.message : `${error.message} (${parts.join('; ')})`;
}
