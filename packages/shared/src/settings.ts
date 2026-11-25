// Settings on the wire (S§4.4 `setting`, S§5.12 Settings, S§5.13): the value domains of the
// Phase 1 settings and what `GET /api/settings` answers. A secret setting's value never appears in
// a response: a view says only whether it is set.
import { z } from 'zod';
import { SettingSource } from './vocab.ts';

/** robots.txt handling (S§5.1). The default is `ignore` (owner decision #4, S§9). */
export const ROBOTS_MODES = ['ignore', 'report', 'respect'] as const;
export const RobotsMode = z.enum(ROBOTS_MODES);
export type RobotsMode = z.infer<typeof RobotsMode>;

/**
 * When the session cookie carries `Secure`: `auto` when the request came over HTTPS (as the server
 * or, with `auth.trustProxy`, the proxy's X-Forwarded-Proto says), `always`, or `never`.
 */
export const COOKIE_SECURE_MODES = ['auto', 'always', 'never'] as const;
export const CookieSecureMode = z.enum(COOKIE_SECURE_MODES);
export type CookieSecureMode = z.infer<typeof CookieSecureMode>;

// ISO 3166-1 user-assigned codes (AA, QM-QZ, XA-XZ, ZZ) and the exceptionally reserved codes that
// name no single country (EU, EZ, UN, UK: the United Kingdom is GB).
const NOT_A_COUNTRY = /^(AA|Q[M-Z]|X[A-Z]|ZZ|EU|EZ|UN|UK)$/;

function isRegion(code: string): boolean {
  try {
    return (
      new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' }).of(code) !== undefined
    );
  } catch {
    return false;
  }
}

/** A country, as an assigned ISO 3166-1 alpha-2 code in upper case (`CA`, `DE`). */
export const CountryCode = z
  .string()
  .regex(/^[A-Z]{2}$/, 'an ISO 3166-1 alpha-2 code in upper case')
  .refine((code) => !NOT_A_COUNTRY.test(code) && isRegion(code), 'not an assigned country code');
export type CountryCode = z.infer<typeof CountryCode>;

function canonicalTag(tag: string): string | null {
  try {
    const [canonical] = Intl.getCanonicalLocales(tag);
    return canonical ?? null;
  } catch {
    return null;
  }
}

/**
 * A language, as a well-formed BCP 47 tag (`en`, `fr-CA`), stored in its canonical form
 * (`en-us` becomes `en-US`). `und` (undetermined) is refused: the market needs a language.
 */
export const LanguageTag = z
  .string()
  .max(35)
  .refine((tag) => {
    const canonical = canonicalTag(tag);
    return canonical !== null && canonical !== 'und';
  }, 'a well-formed BCP 47 language tag')
  .transform((tag) => canonicalTag(tag) as string);
export type LanguageTag = z.infer<typeof LanguageTag>;

/** Why a stored or environment value is not in effect; the value itself is never repeated. */
export const SETTING_PROBLEMS = ['env_invalid', 'db_invalid', 'db_unreadable'] as const;
export const SettingProblem = z.enum(SETTING_PROBLEMS);
export type SettingProblem = z.infer<typeof SettingProblem>;

/** One setting as `GET /api/settings` shows it. */
export const SettingView = z.strictObject({
  key: z.string(),
  /** A secret's value is never returned; `isSet` says whether it has one. */
  secret: z.boolean(),
  /** Whether the setting has an effective value from any source. */
  isSet: z.boolean(),
  /** Where the effective value came from; null while it has none (no default, nothing set). */
  source: SettingSource.nullable(),
  /** The effective value; always null for a secret, and null while the setting has none. */
  value: z.json().nullable(),
  /** The environment variable that can supply a default, if any. */
  env: z.string().nullable(),
  /** Set when a database or environment value was found but is not in effect. */
  problem: SettingProblem.nullable(),
});
export type SettingView = z.infer<typeof SettingView>;

/** Response of `GET /api/settings`: every definition, in registry order. */
export const SettingsResponse = z.strictObject({ settings: z.array(SettingView) });
export type SettingsResponse = z.infer<typeof SettingsResponse>;

/** Response of `PUT` and `DELETE /api/settings/:key`. */
export const SettingResponse = z.strictObject({ setting: SettingView });
export type SettingResponse = z.infer<typeof SettingResponse>;

/** Body of `PUT /api/settings/:key`. JSON null is refused (use DELETE to go back to env or default). */
export const PutSettingRequest = z.strictObject({ value: z.json() });
export type PutSettingRequest = z.infer<typeof PutSettingRequest>;
