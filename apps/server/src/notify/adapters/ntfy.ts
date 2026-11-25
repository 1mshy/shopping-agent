// ntfy (S§5.11): one JSON publish to the server's base URL (https://docs.ntfy.sh/publish/#publish-as-json),
// which carries a UTF-8 title without header encoding. The access token, when set, is a Bearer
// token. 2xx is acceptance by the ntfy server.
import type { NtfyConfig } from '../config.ts';
import { postOnce } from './http.ts';
import type { ChannelAdapter } from './types.ts';

const MAX_MESSAGE = 4000;

export const ntfyAdapter: ChannelAdapter<NtfyConfig> = {
  type: 'ntfy',
  send(message, target, context) {
    const { serverUrl, topic, priority } = target.config;
    const body: Record<string, unknown> = {
      topic,
      title: message.title,
      message: message.body.slice(0, MAX_MESSAGE),
      priority: priority ?? (message.urgent ? 4 : 3),
    };
    if (message.url !== null) body.click = message.url;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (target.secret !== null) headers.authorization = `Bearer ${target.secret}`;
    // The target is the owner's configured server (see http.ts), never a URL from the message.
    return postOnce(
      { url: serverUrl, headers, body: JSON.stringify(body), secrets: [target.secret] },
      context,
    );
  },
};
