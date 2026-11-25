// The settings registry (S§4.4 `setting`, S§5.12 Settings, S§5.13). A setting is one typed
// definition: its key, a zod schema for its value, an optional built-in default, an optional
// environment variable that supplies a default, and whether it is a secret. A later unit adds a
// setting by adding a definition to SETTING_DEFINITIONS; the service, the API and the UI follow.
//
// The effective value is the database's (the owner set it in the UI), else the environment's, else
// the built-in default, else none. A setting with no default has no value until the owner or the
// environment gives one: the market currency in particular (S§2.2, there is no default currency).
//
// Settings are a human-only door (S§5.15, S§2.7): they change only through the session-protected
// /api/settings routes; the rest of the server reads them through `SettingsReader.get`.
// Node-free: zod and the shared vocabularies only.
import {
  CookieSecureMode,
  CountryCode,
  LanguageTag,
  MinorUnitCurrency,
  RobotsMode,
} from '@agentic-dasher/shared';
import { z } from 'zod';

export interface SettingDefinition<
  K extends string = string,
  S extends z.ZodType = z.ZodType,
  D extends z.output<S> | undefined = z.output<S> | undefined,
> {
  /** Dotted, lower camel case: `area.name`. Also the URL segment of /api/settings/:key. */
  readonly key: K;
  readonly schema: S;
  /** The built-in default; undefined when the setting has none. */
  readonly default: D;
  /** The environment variable whose text supplies a default (tried as is, then as JSON). */
  readonly env: string | null;
  /**
   * A secret is stored encrypted (`setting.value_enc`, SecretBox context `setting:<key>`) and the
   * API only ever says whether it is set.
   */
  readonly secret: boolean;
  /** What the setting does, for code readers and the generated Settings UI. */
  readonly description: string;
}

/** Any definition, for code that walks the registry. */
// biome-ignore lint/suspicious/noExplicitAny: the registry holds definitions of every value type.
export type AnySettingDefinition = SettingDefinition<string, z.ZodType, any>;

const KEY_FORM = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

/** Builds one definition, checking its key's form and its default against its schema. */
export function defineSetting<
  const K extends string,
  S extends z.ZodType,
  const D extends z.output<S> | undefined = undefined,
>(definition: {
  key: K;
  schema: S;
  default?: D;
  env?: string;
  secret?: boolean;
  description: string;
}): SettingDefinition<K, S, D> {
  if (!KEY_FORM.test(definition.key)) {
    throw new Error(`setting key ${definition.key} is not of the form area.name`);
  }
  if (
    definition.default !== undefined &&
    !definition.schema.safeParse(definition.default).success
  ) {
    throw new Error(`the default of setting ${definition.key} does not pass its schema`);
  }
  return {
    key: definition.key,
    schema: definition.schema,
    default: definition.default as D,
    env: definition.env ?? null,
    secret: definition.secret ?? false,
    description: definition.description,
  };
}

/** The Phase 1 settings, in the order the API lists them. */
export const SETTING_DEFINITIONS = [
  defineSetting({
    key: 'market.country',
    schema: CountryCode,
    env: 'MARKET_COUNTRY',
    description:
      'The country the search is steered to (S§2.3): ISO 3166-1 alpha-2. First-run wizard step 2.',
  }),
  defineSetting({
    key: 'market.currency',
    schema: MinorUnitCurrency,
    env: 'MARKET_CURRENCY',
    description:
      'The currency of the market (S§2.3), an ISO 4217 code with a minor unit. No default: there is no default currency (S§2.2). First-run wizard step 2.',
  }),
  defineSetting({
    key: 'market.language',
    schema: LanguageTag,
    env: 'MARKET_LANGUAGE',
    description:
      'The language of the market (S§2.3), a BCP 47 tag stored in canonical form. First-run wizard step 2.',
  }),
  defineSetting({
    key: 'fetch.robots',
    schema: RobotsMode,
    default: 'ignore',
    env: 'FETCH_ROBOTS',
    description: 'robots.txt handling (S§5.1): ignore, report or respect. Default ignore (S§9 #4).',
  }),
  defineSetting({
    key: 'auth.cookieSecure',
    schema: CookieSecureMode,
    default: 'auto',
    env: 'AUTH_COOKIE_SECURE',
    description:
      'When the session cookie is Secure: auto (when the request came over HTTPS), always, or never.',
  }),
  defineSetting({
    key: 'auth.trustProxy',
    schema: z.boolean(),
    default: false,
    env: 'AUTH_TRUST_PROXY',
    description:
      'Trust X-Forwarded-For, -Proto and -Host from a reverse proxy in front of the app. Off by default: the client address is the socket peer.',
  }),
] as const;

export type SettingDefinitions = readonly AnySettingDefinition[];

/** The keys of a registry. */
export type SettingKeyOf<Defs extends SettingDefinitions> = Defs[number]['key'];

/** The definition of one key. */
export type DefinitionOf<Defs extends SettingDefinitions, K extends string> = Extract<
  Defs[number],
  { key: K }
>;

/** What `get` returns: the value, or undefined when the setting has no built-in default. */
export type EffectiveValue<Defs extends SettingDefinitions, K extends string> =
  DefinitionOf<Defs, K> extends SettingDefinition<string, infer S, infer D>
    ? undefined extends D
      ? z.output<S> | undefined
      : z.output<S>
    : never;

export type SettingKey = SettingKeyOf<typeof SETTING_DEFINITIONS>;

/** The read-only accessor the rest of the server gets (S§5.15: no write path outside the routes). */
export interface SettingsReader<Defs extends SettingDefinitions = typeof SETTING_DEFINITIONS> {
  get<K extends SettingKeyOf<Defs>>(key: K): EffectiveValue<Defs, K>;
}
