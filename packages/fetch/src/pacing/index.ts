// Per-host pacing (S§5.1 Pacing) and how hosts and instants are stored (S§4).
export { Gate, type GateEntry, type Sleep, timerSleep } from './gate.ts';
export {
  type Admission,
  createPacer,
  HTTP_HOST_POOL,
  jitteredGap,
  MAX_HOST_PAUSE_MS,
  PACING_INTERVAL_MS,
  PACING_JITTER,
  type Pacer,
  type PacerDeps,
  type PacingSlot,
  RATE_LIMITED_DEFAULT_PAUSE_MS,
} from './pacer.ts';
export { sqlitePacingStore } from './sqlite-store.ts';
export { memoryPacingStore, type PacingStore } from './store.ts';
export { assertStorableHost, fromStoredInstant, hostKey, toStoredInstant } from './stored.ts';
