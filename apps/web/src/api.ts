import type { AppType } from '@shopping-agent/server';
import { hc } from 'hono/client';

export const api = hc<AppType>('/').api;
