// The short, neutral prompts both scenario matrices send, so the two wire shapes are asked the
// same things. Changing any of these changes recorded request bodies, and replay compares bodies:
// a change here means re-recording.

export const SYSTEM =
  'You are a terse assistant used to test an API client. Follow instructions exactly.';
export const READY = 'Reply with the single word: ready.';
export const COUNT = 'Count from 1 to 200, separated by spaces.';
export const PRICE_QUESTION = 'What does the Kindle Paperwhite cost at Amazon? Use the tool.';
export const PARALLEL_QUESTION =
  'Get the price of the Kindle Paperwhite at Amazon and at Best Buy, in parallel.';
export const PRIME_QUESTION = 'Is 391 a prime number? Answer yes or no.';
export const RECORD_QUESTION = 'Describe the Kindle Paperwhite as a product record.';

// About 2,500 tokens of byte-stable text, above the 1,024-token minimum cacheable prefix that
// OpenAI documents and the 512-token minimum Anthropic documents for Claude Haiku 5.5; other
// servers' thresholds are what the recordings will show.
export const LONG_PREFIX = [
  SYSTEM,
  ...Array.from(
    { length: 100 },
    (_, i) =>
      `Reference note ${String(i + 1).padStart(3, '0')}: a product listing is identified by brand, model, variant, condition and seller; keep these separate.`,
  ),
].join('\n');
