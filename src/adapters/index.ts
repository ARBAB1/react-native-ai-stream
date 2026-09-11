import type { ChunkAdapter, StreamEvent } from '../types';

function parse(event: StreamEvent): Record<string, unknown> | null {
  try {
    return JSON.parse(event.data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * OpenAI chat completions (`stream: true`).
 *
 * Chunks look like:
 *   data: {"choices":[{"delta":{"content":"Hel"}}]}
 *   data: [DONE]
 */
export const openai: ChunkAdapter = (event) => {
  if (event.data === '[DONE]') return { done: true };

  const json = parse(event);
  if (!json) return null;

  const choices = json.choices as Array<{ delta?: { content?: string } }> | undefined;
  const text = choices?.[0]?.delta?.content;
  return typeof text === 'string' && text.length > 0 ? { text } : null;
};

/**
 * Anthropic messages API (`stream: true`).
 *
 * Uses named events; the text lives in `content_block_delta`:
 *   event: content_block_delta
 *   data: {"delta":{"type":"text_delta","text":"Hel"}}
 */
export const anthropic: ChunkAdapter = (event) => {
  if (event.event === 'message_stop') return { done: true };
  if (event.event !== 'content_block_delta') return null;

  const json = parse(event);
  const delta = json?.delta as { type?: string; text?: string } | undefined;
  return delta?.type === 'text_delta' && delta.text ? { text: delta.text } : null;
};

/**
 * Plain text: every `data:` line is the delta, with `[DONE]` ending the
 * stream. Useful for your own endpoints and for local model servers.
 */
export const text: ChunkAdapter = (event) => {
  if (event.data === '[DONE]') return { done: true };
  return event.data ? { text: event.data } : null;
};

/**
 * Ollama and other local model servers, which stream NDJSON:
 *   {"model":"llama3","response":"Hel","done":false}
 *   {"response":"","done":true}
 *
 * Pair with `format: 'ndjson'`.
 */
export const ollama: ChunkAdapter = (event) => {
  const json = parse(event);
  if (!json) return null;
  if (json.done === true) return { done: true };

  // /api/generate uses `response`; /api/chat nests it under `message`.
  const message = json.message as { content?: string } | undefined;
  const chunk = (json.response as string | undefined) ?? message?.content;
  return typeof chunk === 'string' && chunk.length > 0 ? { text: chunk } : null;
};

export const adapters = { openai, anthropic, text, ollama };

export type AdapterName = keyof typeof adapters;

export function resolveAdapter(adapter: AdapterName | ChunkAdapter): ChunkAdapter {
  return typeof adapter === 'function' ? adapter : adapters[adapter];
}
