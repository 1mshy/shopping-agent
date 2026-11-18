// The installed version of a dependency, read from its package.json without importing it.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export function installedVersion(name: string): string {
  let dir = dirname(createRequire(import.meta.url).resolve(name));
  for (;;) {
    const file = join(dir, 'package.json');
    if (existsSync(file)) {
      const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version?: string };
      if (pkg.name === name && pkg.version) return pkg.version;
    }
    const up = dirname(dir);
    if (up === dir) return 'unknown';
    dir = up;
  }
}
