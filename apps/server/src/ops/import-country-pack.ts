// Offline CLI. Pipe a WDC pack into the running container using Compose exec -T.
import { createReadStream, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { openDatabase, schema } from '@agentic-dasher/db';
import { CountryCode } from '@agentic-dasher/shared';
import { z } from 'zod';

const packSchema = z.strictObject({
  version: z.literal(1),
  country: CountryCode,
  corpus: z.literal('WDC Product 2023'),
  hosts: z
    .array(
      z
        .string()
        .max(253)
        .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
    )
    .max(2_000_000),
});
export async function importCountryPack(input: Readable, dbFile: string) {
  const chunks: Buffer[] = [];
  let size = 0;
  const decoder = createGunzip();
  input.on('error', (err) => decoder.destroy(err));
  for await (const part of input.pipe(decoder)) {
    const buf = Buffer.from(part);
    size += buf.length;
    if (size > 64 * 1024 * 1024) throw new Error('Country pack exceeds 64 MiB decompressed');
    chunks.push(buf);
  }
  const pack = packSchema.parse(JSON.parse(Buffer.concat(chunks, size).toString('utf8')));
  const suffix = '.' + (pack.country === 'GB' ? 'uk' : pack.country.toLowerCase());
  if (!pack.hosts.every((h) => h.endsWith(suffix)))
    throw new Error('Pack contains a hostname outside its country suffix');
  const db = openDatabase(realpathSync(dbFile));
  try {
    const count = db.orm.transaction(
      (tx) => {
        let added = 0;
        for (const host of new Set(pack.hosts)) {
          added += tx
            .insert(schema.store)
            .values({
              host,
              marketPrefix: '',
              platform: 'unknown',
              country: pack.country,
              baseCurrency: 'unknown',
              isShop: 'unknown',
              trustTier: 'unverified',
              trustReasons: [],
              source: 'country_pack',
              consecutiveErrors: 0,
            })
            .onConflictDoNothing({ target: [schema.store.host, schema.store.marketPrefix] })
            .run().changes;
        }
        return added;
      },
      { behavior: 'immediate' },
    );
    return { country: pack.country, hosts: pack.hosts.length, added: count };
  } finally {
    db.close();
  }
}
if (import.meta.main) {
  const [file, ...extra] = process.argv.slice(2);
  if (!file || extra.length)
    throw new Error('Usage: node dist/import-country-pack.mjs <pack.json.gz | ->');
  const dbFile = join(process.env.DATA_DIR ?? 'data', 'agentic-dasher.db');
  console.info(
    JSON.stringify(
      await importCountryPack(file === '-' ? process.stdin : createReadStream(file), dbFile),
    ),
  );
}
