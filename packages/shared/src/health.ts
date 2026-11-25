import { z } from 'zod';

/** Response of `GET /api/health`. Public: the only API route without auth (S§5.13). */
export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  uptimeS: z.number().nonnegative(),
  db: z.enum(['ok', 'error']),
  /** The highest applied migration (S§5.14 Upgrades). */
  migrationLevel: z.number().int().nonnegative(),
  rssBytes: z.number().int().nonnegative(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
