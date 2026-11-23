// A scripted OpenAI-compatible judge for the tests: no model, no network beyond 127.0.0.1.
// Replies are built from the listing ids in the request, so they fit any batch. Everything here is
// synthetic and describes no real server.
import { startScriptedServer } from '../../wire/test/scripted-server.ts';

export interface SeenCall {
  readonly url: string;
  readonly authorization: string | null;
  readonly body: {
    model: string;
    messages: { role: string; content: string }[];
    [k: string]: unknown;
  };
}

export interface ScriptedReply {
  readonly status?: number;
  /** The response body as text (used as is) or as a value (serialised). */
  readonly body: unknown;
}

export type Script = (ids: readonly string[], callNumber: number, seen: SeenCall) => ScriptedReply;

/** The listing ids of the first user message, in order (`{"id":"L1",...}` lines). */
export function idsInBody(body: SeenCall['body']): string[] {
  const user = body.messages.find((m) => m.role === 'user');
  return [...(user?.content ?? '').matchAll(/^\{"id":"(L[0-9]+)"/gm)].map((m) => m[1] as string);
}

/** A Chat Completions response carrying `content`, with usage unless told otherwise. */
export function completion(
  content: string | null,
  more: { usage?: unknown; finishReason?: string; refusal?: string | null } = {},
): unknown {
  return {
    id: 'chatcmpl-scripted',
    object: 'chat.completion',
    model: 'scripted-judge',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content, refusal: more.refusal ?? null },
        finish_reason: more.finishReason ?? 'stop',
      },
    ],
    ...(more.usage === undefined
      ? { usage: { prompt_tokens: 800, completion_tokens: 120 } }
      : more.usage === null
        ? {}
        : { usage: more.usage }),
  };
}

/** An Anthropic Messages response carrying `text`, with usage unless told otherwise. */
export function anthropicMessage(
  text: string | null,
  more: {
    usage?: unknown;
    stopReason?: string;
    stopDetails?: unknown;
    thinking?: boolean;
  } = {},
): unknown {
  return {
    id: 'msg_scripted',
    type: 'message',
    role: 'assistant',
    model: 'scripted-judge',
    content: [
      ...(more.thinking === false ? [] : [{ type: 'thinking', thinking: '', signature: 'sig' }]),
      ...(text === null ? [] : [{ type: 'text', text, citations: null }]),
    ],
    stop_reason: more.stopReason ?? 'end_turn',
    stop_sequence: null,
    stop_details: more.stopDetails ?? null,
    usage:
      more.usage === undefined
        ? {
            input_tokens: 700,
            cache_read_input_tokens: 100,
            cache_creation_input_tokens: 0,
            output_tokens: 120,
            output_tokens_details: { thinking_tokens: 40 },
          }
        : more.usage,
  };
}

/** A valid verdict list: odd positions `exact`, even positions `other_model`. */
export function verdicts(ids: readonly string[]): string {
  return JSON.stringify({
    verdicts: ids.map((id) => {
      const odd = Number(id.slice(1)) % 2 === 1;
      return {
        id,
        relation: odd ? 'exact' : 'other_model',
        differingAttrs: odd ? [] : ['model'],
        reason: odd ? 'scripted: names the product' : 'scripted: another model',
      };
    }),
  });
}

/** A fetch that answers from the script, in process. */
export function scriptedFetch(script: Script): { fetch: typeof fetch; calls: SeenCall[] } {
  const calls: SeenCall[] = [];
  const f = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body)) as SeenCall['body'];
    const seen = { url: String(input), authorization: headers.get('authorization'), body };
    calls.push(seen);
    const r = script(idsInBody(body), calls.length, seen);
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return new Response(text, {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: f as typeof fetch, calls };
}

/** The same script served over HTTP on 127.0.0.1. */
export async function startScriptedJudge(script: Script) {
  const calls: SeenCall[] = [];
  const server = await startScriptedServer((req) => {
    const body = JSON.parse(req.body) as SeenCall['body'];
    const auth = req.headers.authorization;
    const seen = { url: req.url, authorization: typeof auth === 'string' ? auth : null, body };
    calls.push(seen);
    const r = script(idsInBody(body), calls.length, seen);
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json' },
      chunks: [text],
    };
  }, 0);
  return { origin: server.origin, calls, close: server.close };
}
