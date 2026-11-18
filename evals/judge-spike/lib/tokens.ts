// A token estimate without a tokenizer (no new dependency). It is used for the prompt's size
// check (S§5.7: under 800 tokens), for the plan estimate and for the input-token budget check
// before each call. The real count is the server's `usage.prompt_tokens`, which every call record
// keeps; the README checklist compares the two on the first real call.

/**
 * The pre-tokenizer split of GPT-style byte-pair tokenizers (cl100k), approximated in a JS regex.
 * Such tokenizers never merge across these pieces, so their number is a lower bound for them.
 */
const PRE_TOKEN =
  /'(?:[sdmt]|ll|ve|re)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/giu;

export const TOKEN_ESTIMATE_METHOD =
  'max(pre-token count, ceil(UTF-8 bytes / 4)): the pre-token count is the number of pieces ' +
  'the cl100k pre-tokenizer split gives (a lower bound for GPT-style BPE tokenizers, which never ' +
  'merge across pieces); bytes / 4 is the usual "about 4 characters per token" rule for English. ' +
  'An estimate, not a tokenizer: the real count is usage.prompt_tokens';

export function preTokenCount(text: string): number {
  return text.match(PRE_TOKEN)?.length ?? 0;
}

export function estimateTokens(text: string): number {
  return Math.max(preTokenCount(text), Math.ceil(Buffer.byteLength(text, 'utf8') / 4));
}
