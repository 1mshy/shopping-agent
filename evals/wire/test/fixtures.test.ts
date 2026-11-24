// The committed recordings under evals/wire/fixtures/: each parses, is a real recording
// (`synthetic: false`), ends as its wire shape says a body ends, names its scenario and family
// consistently, and replays through createReplayFetch byte for byte for the request it records.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  bodyBytes,
  NULL_BODY_STATUSES,
  parseFixture,
  type WireFixture,
  wireApiOf,
} from '../format.ts';
import { createReplayFetch } from '../replay.ts';
import { appliesTo, scenarioById } from '../scenarios.ts';

const ROOT = fileURLToPath(new URL('../fixtures/', import.meta.url));

/** The committed sets: <family>/<label>, and the least each must hold. */
const EXPECTED_SETS: Readonly<Record<string, number>> = {
  'anthropic/claude-haiku-5-5': 19,
  'anthropic-compat/claude-haiku-5-5': 19,
};

async function load(): Promise<{ rel: string; fixture: WireFixture }[]> {
  const names = (await readdir(ROOT, { recursive: true })).filter(
    (n) => n.endsWith('.json') && !n.endsWith('biome.json'),
  );
  return Promise.all(
    names.sort().map(async (rel) => ({
      rel,
      fixture: parseFixture(JSON.parse(await readFile(join(ROOT, rel), 'utf8'))),
    })),
  );
}

const fixtures = await load();
const text = (f: WireFixture) => Buffer.from(bodyBytes(f)).toString('utf8');
const isStream = (f: WireFixture) =>
  typeof f.request.body === 'object' &&
  f.request.body !== null &&
  !Array.isArray(f.request.body) &&
  f.request.body.stream === true;
const isEventStream = (f: WireFixture) =>
  (f.response.headers['content-type'] ?? '').startsWith('text/event-stream');

/** The named SSE events of a Messages stream, in order. */
function sseEvents(body: string): { event: string | null; data: string }[] {
  return body
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((l) => l.startsWith('event: '))?.slice(7) ?? null;
      const data = lines
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice(6))
        .join('\n');
      return { event, data };
    });
}

describe('committed wire fixtures', () => {
  it('holds every expected set', () => {
    for (const [set, least] of Object.entries(EXPECTED_SETS)) {
      const count = fixtures.filter((f) => f.rel.startsWith(`${set}/`)).length;
      expect(count, set).toBeGreaterThanOrEqual(least);
    }
  });

  it.each(fixtures.map((f) => [f.rel, f.fixture] as const))(
    '%s is a real recording of the scenario its path names',
    (rel, f) => {
      expect(f.meta.synthetic).toBe(false);
      const [family, , file] = rel.split(/[/\\]/);
      expect(f.meta.serverFamily).toBe(family);
      expect(file).toBe(`${f.meta.scenario}.json`);
      const scenario = scenarioById(f.meta.scenario);
      expect(appliesTo(scenario, f.meta.serverFamily)).toBe(true);
      expect(f.request.method).toBe(scenario.method);
      expect(f.meta.model).toBe('claude-haiku-5-5');
      if (wireApiOf(f.meta.serverFamily) === 'messages') {
        expect(f.request.headers['x-api-key']).toBe('[REDACTED]');
        expect(f.request.headers['anthropic-version']).toBe('2026-10-21');
        expect(f.request.headers.authorization).toBeUndefined();
      } else {
        expect(f.request.headers.authorization).toBe('Bearer [REDACTED]');
      }
      // Server-generated request identifiers and thinking blobs are masked (README, Redaction).
      const body = text(f);
      expect(body).not.toMatch(/\b(?:req|msg)_[A-Za-z0-9]/);
      expect(body).not.toMatch(/"(?:signature|data)"[ \t\r\n]*:[ \t\r\n]*"[^"*]{8}[^"*]/);
    },
  );

  it('keeps a masked thinking signature in the thinking recording', () => {
    const f = fixtures.find((x) => x.rel.endsWith('messages-thinking-summarized.json'))?.fixture;
    expect(text(f as WireFixture)).toMatch(
      /"type":"signature_delta","signature":"[^"*]{8}\*{100,}"/,
    );
  });

  it.each(fixtures.map((f) => [f.rel, f.fixture] as const))(
    '%s ends as its wire shape says',
    (_rel, f) => {
      if (NULL_BODY_STATUSES.has(f.response.status)) return;
      const body = text(f);
      expect(body.length).toBeGreaterThan(0);
      if (!isEventStream(f)) {
        // A JSON body (a non-streamed reply, a list, a count or an error) parses whole.
        expect(() => JSON.parse(body)).not.toThrow();
        return;
      }
      expect(isStream(f)).toBe(true);
      if (wireApiOf(f.meta.serverFamily) === 'messages') {
        // Named events; a complete stream ends with message_stop (an error event ends otherwise).
        const events = sseEvents(body);
        for (const e of events) {
          if (e.event === null) continue;
          expect(JSON.parse(e.data)).toMatchObject({ type: e.event });
        }
        const last = events.at(-1);
        expect(['message_stop', 'error']).toContain(last?.event);
        if (last?.event === 'message_stop') {
          expect(events[0]?.event).toBe('message_start');
          expect(events.some((e) => e.event === 'message_delta')).toBe(true);
        }
      } else {
        // Chat Completions: data-only events ending with data: [DONE].
        expect(body.trimEnd().endsWith('data: [DONE]')).toBe(true);
      }
    },
  );

  it.each(fixtures.map((f) => [f.rel, f.fixture] as const))(
    '%s replays byte for byte for the request it records',
    async (_rel, f) => {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(f.request.headers)) {
        if (['x-api-key', 'authorization'].includes(name)) headers[name] = 'replayed-key';
        else if (['content-type', 'anthropic-version', 'anthropic-beta'].includes(name)) {
          headers[name] = value;
        }
      }
      const replay = createReplayFetch(f);
      const res = await replay(`http://127.0.0.1${f.request.path}`, {
        method: f.request.method,
        headers,
        ...(f.request.body === null ? {} : { body: JSON.stringify(f.request.body) }),
      });
      expect(res.status).toBe(f.response.status);
      expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from(bodyBytes(f)));
      replay.assertDone();
    },
  );
});
