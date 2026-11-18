// The clients of the run, in their base order (the probe rotates it per host).
// impers is not here: see docs/spikes/a-http-transport.md, "Packaging".
import type { ClientId, HttpTransport } from '../transport.ts';
import { impitTransport } from './impit.ts';
import { nodeFetchTransport } from './node-fetch.ts';
import { wreqTransport } from './wreq.ts';

export const CLIENT_IDS: readonly ClientId[] = ['fetch', 'impit', 'wreq'];

export function createTransports(): HttpTransport[] {
  return [nodeFetchTransport(), impitTransport(), wreqTransport()];
}
