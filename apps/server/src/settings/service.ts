// The settings service over the `setting` table (S§4.4, S§5.13): effective values with their
// source, and the write path the session-protected routes use. Exactly one of value_json and
// value_enc is set on a row, and JSON null is refused (migration 0001 `setting_one_value`).
//
// Secrets: a secret setting's value is JSON text encrypted through the SecretBox with the context
// `setting:<key>`, so a value copied under another key fails to decrypt. No view, error or log line
// carries a secret value; views of a secret say only whether it is set. Errors name the paths that
// failed, never a submitted value.
import { type Database, schema } from '@agentic-dasher/db';
import type { SettingProblem, SettingSource, SettingView } from '@agentic-dasher/shared';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { SecretBox } from '../secrets/index.ts';
import {
  type AnySettingDefinition,
  type EffectiveValue,
  SETTING_DEFINITIONS,
  type SettingDefinitions,
  type SettingKeyOf,
  type SettingsReader,
} from './registry.ts';

export type SettingErrorCode = 'invalid' | 'not_found';

/** A refusal of the settings service. Its message and fields never carry a submitted value. */
export class SettingError extends Error {
  override name = 'SettingError';
  readonly code: SettingErrorCode;
  readonly fields: readonly string[];
  constructor(code: SettingErrorCode, message: string, fields: readonly string[] = []) {
    super(message);
    this.code = code;
    this.fields = fields;
  }
}

/** The write side, used by the routes only. */
export interface SettingsStore {
  /** Every definition with its effective value, in registry order. */
  list(): SettingView[];
  /** One setting's view; throws `not_found` for an unknown key. */
  view(key: string): SettingView;
  /** Validates and stores a value in the database; throws `not_found` or `invalid`. */
  set(key: string, value: unknown): SettingView;
  /** Deletes the database value, so the environment or the default applies again. */
  reset(key: string): SettingView;
}

export interface SettingsService<Defs extends SettingDefinitions = typeof SETTING_DEFINITIONS>
  extends SettingsReader<Defs>,
    SettingsStore {
  /** True when the setting has an effective value from any source. */
  isSet(key: SettingKeyOf<Defs>): boolean;
}

export interface SettingsServiceDeps<Defs extends SettingDefinitions> {
  readonly db: Database;
  readonly secrets: SecretBox;
  /** The process environment (only the variables the definitions name are read). */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly definitions?: Defs;
}

interface Resolved {
  readonly value: unknown;
  readonly source: SettingSource | null;
  readonly problem: SettingProblem | null;
}

function contextOf(key: string): string {
  return `setting:${key}`;
}

function fieldsOf(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((i) => ['value', ...i.path.map(String)].join('.')))];
}

export function createSettingsService<Defs extends SettingDefinitions = typeof SETTING_DEFINITIONS>(
  deps: SettingsServiceDeps<Defs>,
): SettingsService<Defs> {
  const { db, secrets, env } = deps;
  const definitions = (deps.definitions ?? SETTING_DEFINITIONS) as SettingDefinitions;
  const byKey = new Map<string, AnySettingDefinition>();
  for (const definition of definitions) {
    if (byKey.has(definition.key)) throw new Error(`setting ${definition.key} is defined twice`);
    byKey.set(definition.key, definition);
  }
  const { setting } = schema;

  function definitionOf(key: string): AnySettingDefinition {
    const definition = byKey.get(key);
    if (definition === undefined) throw new SettingError('not_found', 'no such setting');
    return definition;
  }

  function fromDb(definition: AnySettingDefinition): Resolved | SettingProblem | null {
    const row = db.orm.select().from(setting).where(eq(setting.key, definition.key)).get();
    if (row === undefined) return null;
    let raw: unknown;
    if (definition.secret) {
      // A plaintext row under a secret key is never used (nor shown).
      if (row.valueEnc === null) return 'db_invalid';
      try {
        raw = JSON.parse(secrets.decryptString(row.valueEnc, contextOf(definition.key)));
      } catch {
        return 'db_unreadable';
      }
    } else {
      if (row.valueEnc !== null) return 'db_invalid';
      raw = row.value;
    }
    const parsed = definition.schema.safeParse(raw);
    if (!parsed.success) return 'db_invalid';
    return { value: parsed.data, source: 'db', problem: null };
  }

  function fromEnv(definition: AnySettingDefinition): Resolved | SettingProblem | null {
    if (definition.env === null) return null;
    const text = env[definition.env];
    if (text === undefined || text === '') return null;
    const direct = definition.schema.safeParse(text);
    if (direct.success) return { value: direct.data, source: 'env', problem: null };
    try {
      const parsed = definition.schema.safeParse(JSON.parse(text));
      if (parsed.success) return { value: parsed.data, source: 'env', problem: null };
    } catch {
      // not JSON either
    }
    return 'env_invalid';
  }

  function resolve(definition: AnySettingDefinition): Resolved {
    let problem: SettingProblem | null = null;
    for (const source of [fromDb, fromEnv]) {
      const found = source(definition);
      if (found === null) continue;
      if (typeof found === 'string') {
        problem ??= found;
        continue;
      }
      return { ...found, problem };
    }
    if (definition.default !== undefined) {
      return { value: definition.default, source: 'default', problem };
    }
    return { value: undefined, source: null, problem };
  }

  function viewOf(definition: AnySettingDefinition): SettingView {
    const resolved = resolve(definition);
    const isSet = resolved.source !== null;
    return {
      key: definition.key,
      secret: definition.secret,
      isSet,
      source: resolved.source,
      value: definition.secret || !isSet ? null : (resolved.value as SettingView['value']),
      env: definition.env,
      problem: resolved.problem,
    };
  }

  return {
    get<K extends SettingKeyOf<Defs>>(key: K): EffectiveValue<Defs, K> {
      return resolve(definitionOf(key)).value as EffectiveValue<Defs, K>;
    },

    isSet(key) {
      return resolve(definitionOf(key)).source !== null;
    },

    list() {
      return definitions.map(viewOf);
    },

    view(key) {
      return viewOf(definitionOf(key));
    },

    set(key, value) {
      const definition = definitionOf(key);
      if (value === null || value === undefined) {
        throw new SettingError(
          'invalid',
          'a value is required; DELETE the setting to fall back to the environment or the default',
          ['value'],
        );
      }
      const parsed = definition.schema.safeParse(value);
      if (!parsed.success || parsed.data === null || parsed.data === undefined) {
        const fields = parsed.success ? ['value'] : fieldsOf(parsed.error);
        throw new SettingError('invalid', `invalid value for ${definition.key}`, fields);
      }
      const row = definition.secret
        ? {
            value: null,
            valueEnc: secrets.encrypt(JSON.stringify(parsed.data), contextOf(definition.key)),
          }
        : { value: parsed.data, valueEnc: null };
      db.orm
        .insert(setting)
        .values({ key: definition.key, ...row })
        .onConflictDoUpdate({ target: setting.key, set: row })
        .run();
      return viewOf(definition);
    },

    reset(key) {
      const definition = definitionOf(key);
      db.orm.delete(setting).where(eq(setting.key, definition.key)).run();
      return viewOf(definition);
    },
  };
}
