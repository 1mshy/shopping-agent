// The in-app channel (S§5.11, always on). Nothing is sent: the feed reads accepted in-app
// deliveries, so writing the delivery as accepted is the acceptance.
import { ACCEPTED, type ChannelAdapter } from './types.ts';

export const inAppAdapter: ChannelAdapter<Record<string, never>> = {
  type: 'in_app',
  async send() {
    return ACCEPTED;
  },
};
