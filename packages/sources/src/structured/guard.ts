// The last line of "readers never throw" (S§2.7): page text is data, and a reader bug on a strange
// page must end as a recorded failed read, not as an exception in a sweep. Every path that a page
// can reach is written not to throw; this only catches what was missed, and says so in `detail`.
import type { ReadMethod } from '@agentic-dasher/shared';
import type { DocumentReading } from './product.ts';

export function guarded(method: ReadMethod, run: () => DocumentReading): DocumentReading {
  try {
    return run();
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : 'unknown error';
    return {
      outcome: {
        kind: 'no_read',
        method,
        reason: 'no_price',
        detail: `the ${method} reader failed on this page: ${message}`,
        candidates: [],
        fetch: null,
      },
      unconfirmed: false,
    };
  }
}
