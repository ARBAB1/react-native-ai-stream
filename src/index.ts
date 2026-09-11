export { EventStream, createEventStream } from './client';
export type { EventStreamOptions } from './client';

export { SSEParser } from './parser';
export { NDJSONParser } from './ndjson';
export { computeBackoff, DEFAULT_RETRY } from './backoff';

export {
  adapters,
  openai,
  anthropic,
  text,
  ollama,
  resolveAdapter,
} from './adapters';
export type { AdapterName } from './adapters';

export type {
  ChunkAdapter,
  ConnectionState,
  Message,
  RetryPolicy,
  StreamEvent,
  StreamFormat,
  StreamParser,
} from './types';
