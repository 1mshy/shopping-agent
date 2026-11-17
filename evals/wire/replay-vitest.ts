// The documented way to replay in a Vitest test. Each helper registers its final assertion with
// the test's teardown (`onTestFinished`), so a mismatch fails the test even when the client under
// test swallowed the rejected fetch (for example by treating it as "feature unsupported"), and
// an exchange that was never requested fails it too.
import { onTestFinished } from 'vitest';
import type { WireFixture } from './format.ts';
import {
  createReplayFetch,
  type ReplayFetch,
  type ReplayOptions,
  type ReplayServer,
  startReplayServer,
} from './replay.ts';

export function useReplayFetch(
  fixtures: WireFixture | readonly WireFixture[],
  options: ReplayOptions = {},
): ReplayFetch {
  const replay = createReplayFetch(fixtures, options);
  onTestFinished(() => replay.assertDone());
  return replay;
}

export function useReplayServer(
  fixtures: WireFixture | readonly WireFixture[],
  options: ReplayOptions & { chunkGapMs?: number } = {},
): Promise<ReplayServer> {
  const started = startReplayServer(fixtures, options);
  // Registered before the first await, while the test is still the current one.
  onTestFinished(async () => {
    await (await started).close();
  });
  return started;
}
