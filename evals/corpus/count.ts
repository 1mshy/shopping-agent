// Prints the corpus gate numbers (plan P0 exit: "the fixture corpus exists and fails for the
// right reason"): cases per area and how many areas are still pending. Run from the repo root:
//   node evals/corpus/count.ts
// The pending count is honest only together with a green `pnpm test`, which is what proves that
// every pending case throws NotImplementedError and nothing else.
import { existsSync, readdirSync } from 'node:fs';
import type { Area } from './harness.ts';

export async function loadAreas(): Promise<Area<{ id: string }>[]> {
  const root = new URL('./areas/', import.meta.url);
  if (!existsSync(root)) return [];
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const areas: Area<{ id: string }>[] = [];
  for (const dir of dirs) {
    const mod = (await import(new URL(`./${dir}/area.ts`, root).href)) as {
      area?: Area<{ id: string }>;
    };
    if (!mod.area) throw new Error(`areas/${dir}/area.ts must export \`area\``);
    if (mod.area.id !== dir) throw new Error(`areas/${dir} exports area id "${mod.area.id}"`);
    areas.push(mod.area);
  }
  return areas;
}

export function formatCounts(areas: readonly Area<{ id: string }>[]): string {
  const lines = ['| Area | Cases | Status |', '|---|--:|---|'];
  for (const a of areas) lines.push(`| ${a.id} | ${a.cases.length} | ${a.status} |`);
  const total = areas.reduce((n, a) => n + a.cases.length, 0);
  const pending = areas
    .filter((a) => a.status === 'pending')
    .reduce((n, a) => n + a.cases.length, 0);
  lines.push(`| **Total** | **${total}** | ${pending} pending, ${total - pending} implemented |`);
  return lines.join('\n');
}

if (import.meta.main) console.info(formatCounts(await loadAreas()));
