// The outbox pass as a scheduler job, for the integration unit to register.
//
// No DNS gate: in-app deliveries need no network and must not wait for it, and a push channel's
// transport errors are already retried by the pass's own policy (S§5.11). A run that reaches its
// deadline aborts the pass, which leaves what it had not finished pending (outbox.ts).
import type { JobDefinition } from '../scheduler/index.ts';
import { type OutboxPassOptions, runOutboxPass } from './outbox.ts';

export interface OutboxJobOptions extends Omit<OutboxPassOptions, 'signal' | 'report'> {
  /** croner syntax, UTC. Every minute by default. */
  readonly cron?: string;
  /** Under the pass's lease (10 min by default), so a timed-out run's deliveries are not re-sent early. */
  readonly deadlineMs?: number;
}

export const OUTBOX_JOB_NAME = 'notify-outbox';

export function outboxJob(options: OutboxJobOptions): JobDefinition {
  const { cron = '* * * * *', deadlineMs = 5 * 60_000, ...pass } = options;
  return {
    name: OUTBOX_JOB_NAME,
    cron,
    deadlineMs,
    networkGate: false,
    handler: async (context) => {
      const result = await runOutboxPass({
        ...pass,
        signal: context.signal,
        report: context.report,
      });
      const { deliveries: _list, ...counts } = result;
      return {
        ...counts,
        problems: result.deliveries
          .filter((d) => d.result !== 'accepted')
          .slice(0, 20)
          .map((d) => ({
            deliveryId: d.deliveryId,
            channelId: d.channelId,
            result: d.result,
            errorClass: d.errorClass,
            detail: d.detail,
          })),
      };
    },
  };
}
