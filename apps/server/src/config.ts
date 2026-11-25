import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAllowedHosts } from './auth/host.ts';

// Same relative path from src/config.ts and from the bundled dist/index.mjs.
const DEFAULT_WEB_ROOT = fileURLToPath(new URL('../../web/dist', import.meta.url));

export interface Config {
  port: number;
  host: string | undefined;
  /** Host names the API answers for besides addresses and local names (auth/host.ts). */
  allowedHosts: string[];
  dataDir: string;
  webRoot: string;
  version: string;
}

/** Environment defaults only. Settings proper live in the database (S§5.13), from Phase 1. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got ${env.PORT}`);
  }
  return {
    port,
    host: env.HOST || undefined,
    allowedHosts: parseAllowedHosts(env.ALLOWED_HOSTS),
    dataDir: resolve(env.DATA_DIR ?? 'data'),
    webRoot: env.WEB_ROOT ? resolve(env.WEB_ROOT) : DEFAULT_WEB_ROOT,
    version: env.APP_VERSION ?? '0.0.0-dev',
  };
}
