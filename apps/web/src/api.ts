import type { AppType } from '@agentic-dasher/server';
import { hc } from 'hono/client';

export const api = hc<AppType>('/').api;
