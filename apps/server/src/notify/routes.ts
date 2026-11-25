// The channel settings API (S§5.11, S§5.15 human-only door). A Hono sub-app, not mounted here: the
// integration unit mounts it behind the session middleware (S§5.13 "every API route except
// /api/health … needs a session"), for example `app.route('/api/notify', createNotifyRoutes(…))`.
//
//   GET    /channels               list (?includeRemoved=1 adds removed ones)
//   POST   /channels               create   { type, name, config, secret? }
//   GET    /channels/:id           get
//   PATCH  /channels/:id           update   { name?, config?, secret?: string | null }
//   POST   /channels/:id/disable   switch off (parks its pending deliveries)
//   POST   /channels/:id/enable    switch on
//   DELETE /channels/:id           remove (soft: removed_at; deliveries are kept)
//   POST   /channels/:id/test      send one test message; answers the typed outcome
//
// Bodies are JSON validated with zod. A refusal answers `{ error: { code, message, fields } }`;
// no answer ever carries a secret: channel views say only `hasSecret`.
import { DEFAULT_PROFILE_ID } from '@agentic-dasher/db';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { ChannelError, type ChannelService } from './channels.ts';

export interface NotifyRoutesDeps {
  readonly channels: ChannelService;
  /** The profile of the request's session; v1 has one (S§1.2). */
  readonly profileId?: (c: Context) => number;
}

const STATUS = {
  invalid: 400,
  not_found: 404,
  not_available: 409,
  in_app_fixed: 409,
  removed: 409,
} as const;

const IdParam = z.coerce.number().int().positive();

function refusal(c: Context, error: unknown) {
  if (error instanceof ChannelError) {
    return c.json(
      { error: { code: error.code, message: error.message, fields: error.fields } },
      STATUS[error.code],
    );
  }
  throw error;
}

async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ChannelError('invalid', 'the body is not JSON');
  }
}

function idOf(c: Context): number {
  const parsed = IdParam.safeParse(c.req.param('id'));
  if (!parsed.success) throw new ChannelError('not_found', 'no such channel');
  return parsed.data;
}

export function createNotifyRoutes(deps: NotifyRoutesDeps) {
  const { channels } = deps;
  const profileOf = deps.profileId ?? (() => DEFAULT_PROFILE_ID);

  return new Hono()
    .get('/channels', (c) => {
      const includeRemoved = c.req.query('includeRemoved') === '1';
      return c.json({ channels: channels.list(profileOf(c), { includeRemoved }) });
    })
    .post('/channels', async (c) => {
      try {
        const body = await jsonBody(c);
        return c.json({ channel: channels.create(profileOf(c), body as never) }, 201);
      } catch (error) {
        return refusal(c, error);
      }
    })
    .get('/channels/:id', (c) => {
      try {
        return c.json({ channel: channels.get(profileOf(c), idOf(c)) });
      } catch (error) {
        return refusal(c, error);
      }
    })
    .patch('/channels/:id', async (c) => {
      try {
        const id = idOf(c);
        const body = await jsonBody(c);
        return c.json({ channel: channels.update(profileOf(c), id, body as never) });
      } catch (error) {
        return refusal(c, error);
      }
    })
    .post('/channels/:id/disable', (c) => {
      try {
        return c.json({ channel: channels.setEnabled(profileOf(c), idOf(c), false) });
      } catch (error) {
        return refusal(c, error);
      }
    })
    .post('/channels/:id/enable', (c) => {
      try {
        return c.json({ channel: channels.setEnabled(profileOf(c), idOf(c), true) });
      } catch (error) {
        return refusal(c, error);
      }
    })
    .delete('/channels/:id', (c) => {
      try {
        return c.json({ channel: channels.remove(profileOf(c), idOf(c)) });
      } catch (error) {
        return refusal(c, error);
      }
    })
    .post('/channels/:id/test', async (c) => {
      try {
        const outcome = await channels.test(profileOf(c), idOf(c), { signal: c.req.raw.signal });
        return c.json({ outcome });
      } catch (error) {
        return refusal(c, error);
      }
    });
}

export type NotifyRoutes = ReturnType<typeof createNotifyRoutes>;
