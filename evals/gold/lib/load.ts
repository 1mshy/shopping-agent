// Reading and writing a gold set directory. Layout (see README):
//   products.json             array of products
//   snapshots/<product>.json  array of that product's listing snapshots
//   labels/<labeller>.json    array of that labeller's relation labels
//   split.json                split manifest (written by split.ts)
//   double-label.json         second-label worklist (written by double-label.ts)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import {
  DoubleLabelWorklist,
  GoldProduct,
  type GoldSet,
  ListingSnapshot,
  RelationLabel,
  SplitManifest,
} from './formats.ts';

export const SPLIT_FILE = 'split.json';
export const WORKLIST_FILE = 'double-label.json';

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function parse<T>(raw: unknown, schema: z.ZodType<T>, where: string, v: string[]): T | undefined {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) {
    v.push(`${where}: ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  return undefined;
}

function read<T>(dir: string, rel: string, schema: z.ZodType<T>, v: string[]): T | undefined {
  try {
    return parse(JSON.parse(readFileSync(join(dir, rel), 'utf8')), schema, rel, v);
  } catch (e) {
    v.push(`${rel}: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

/** An array file, checked entry by entry, so one bad entry does not drop the whole file. */
function readEach<T>(dir: string, rel: string, schema: z.ZodType<T>, v: string[]): T[] {
  const raw = read(dir, rel, z.array(z.unknown()), v) ?? [];
  return raw.flatMap((x, i) => parse(x, schema, `${rel} [${i}]`, v) ?? []);
}

const jsonFiles = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
    : [];

/** Loads a set; unreadable or invalid files become violations naming the file, not exceptions. */
export function loadSet(dir: string): { set: GoldSet; violations: string[] } {
  const v: string[] = [];
  const set: GoldSet = {
    products: readEach(dir, 'products.json', GoldProduct, v),
    snapshots: [],
    labels: [],
  };
  for (const f of jsonFiles(join(dir, 'snapshots'))) {
    const rel = `snapshots/${f}`;
    for (const s of readEach(dir, rel, ListingSnapshot, v)) {
      if (s.productId !== basename(f, '.json'))
        v.push(`${rel}: snapshot ${s.id} is for ${s.productId}`);
      set.snapshots.push(s);
    }
  }
  for (const f of jsonFiles(join(dir, 'labels'))) {
    const rel = `labels/${f}`;
    for (const l of readEach(dir, rel, RelationLabel, v)) {
      if (l.labellerId !== basename(f, '.json'))
        v.push(`${rel}: label by ${l.labellerId} filed here`);
      set.labels.push(l);
    }
  }
  if (existsSync(join(dir, SPLIT_FILE))) set.split = read(dir, SPLIT_FILE, SplitManifest, v);
  if (existsSync(join(dir, WORKLIST_FILE))) {
    set.worklist = read(dir, WORKLIST_FILE, DoubleLabelWorklist, v);
  }
  return { set, violations: v };
}

/** Writes a set in the layout above (used by tests and to lay out a new set). */
export function writeSet(dir: string, set: GoldSet): void {
  const group = <T>(xs: readonly T[], key: (x: T) => string) => {
    const m = new Map<string, T[]>();
    for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
    return m;
  };
  mkdirSync(join(dir, 'snapshots'), { recursive: true });
  mkdirSync(join(dir, 'labels'), { recursive: true });
  writeJson(join(dir, 'products.json'), set.products);
  for (const [id, xs] of group(set.snapshots, (s) => s.productId)) {
    writeJson(join(dir, 'snapshots', `${id}.json`), xs);
  }
  for (const [id, xs] of group(set.labels, (l) => l.labellerId)) {
    writeJson(join(dir, 'labels', `${id}.json`), xs);
  }
  if (set.split) writeJson(join(dir, SPLIT_FILE), set.split);
  if (set.worklist) writeJson(join(dir, WORKLIST_FILE), set.worklist);
}
