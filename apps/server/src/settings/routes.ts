// The settings API (S§5.12 Settings, S§5.13, S§5.15 human-only door), mounted at /api/settings
// behind the session middleware:
//
//   GET    /          every definition with its effective value, source and whether it is a secret
//   PUT    /:key      { value } validated against the definition; stored in the database
//   DELETE /:key      deletes the database value: the environment or the default applies again
//
// A secret's value is never in a response (`value: null`, `isSet` says whether it has one). A
// refusal names the failing paths, never the submitted value.
//
// And the first-run status, mounted at /api/setup (readable before a password exists, then only
// with a session: guard.ts OPEN_ROUTES):
//
//   GET    /          { password, locale }: which wizard steps are done (S§5.12)
import { PutSettingRequest } from '@agentic-dasher/shared';
import { type Context, Hono } from 'hono';
import { type AppEnv, apiError, jsonBody } from '../auth/http.ts';
import type { SettingKey } from './registry.ts';
import { SettingError, type SettingsStore } from './service.ts';

function refusal(c: Context, error: unknown) {
  if (error instanceof SettingError) {
    return error.code === 'not_found'
      ? c.json(apiError('not_found', error.message), 404)
      : c.json(apiError('invalid', error.message, error.fields), 400);
  }
  throw error;
}

export function createSettingsRoutes(settings: SettingsStore) {
  return new Hono<AppEnv>()
    .get('/', (c) => c.json({ settings: settings.list() }, 200))
    .put('/:key', async (c) => {
      const body = PutSettingRequest.safeParse(await jsonBody(c));
      if (!body.success) {
        return c.json(apiError('invalid', 'the body is { value }', ['value']), 400);
      }
      try {
        return c.json({ setting: settings.set(c.req.param('key'), body.data.value) }, 200);
      } catch (error) {
        return refusal(c, error);
      }
    })
    .delete('/:key', (c) => {
      try {
        return c.json({ setting: settings.reset(c.req.param('key')) }, 200);
      } catch (error) {
        return refusal(c, error);
      }
    });
}

export type SettingsRoutes = ReturnType<typeof createSettingsRoutes>;

/** The market settings the wizard's locale step sets (S§5.12 step 2). */
export const LOCALE_SETTINGS = [
  'market.country',
  'market.currency',
  'market.language',
] as const satisfies readonly SettingKey[];

export interface SetupRoutesDeps {
  readonly passwordSet: () => boolean;
  readonly isSet: (key: SettingKey) => boolean;
}

export function createSetupRoutes(deps: SetupRoutesDeps) {
  return new Hono<AppEnv>().get('/', (c) =>
    c.json(
      {
        password: deps.passwordSet(),
        locale: LOCALE_SETTINGS.every((key) => deps.isSet(key)),
      },
      200,
    ),
  );
}
