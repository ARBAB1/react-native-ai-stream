/**
 * Core types for the streaming client.
 */

/** A single parsed Server-Sent Event, per the WHATWG event-stream format. */
export interface StreamEvent {
  /** The `event:` field. Defaults to "message" when the server omits it. */
  event: string;
  /** The `data:` field. Multiple `data:` lines are joined with newlines. */
  data: string;
  /** The `id:` field, replayed as `Last-Event-ID` on reconnect. */
  id?: string;
  /** The `retry:` field — the server's requested reconnect delay in ms. */
  retry?: number;
}

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed';

export interface RetryPolicy {
  /** Reconnect attempts before giving up. `Infinity` to retry forever. Default 10. */
  maxAttempts: number;
  /** First backoff delay in ms. Default 500. */
  baseDelayMs: number;
  /** Ceiling for a single backoff delay in ms. Default 30_000. */
  maxDelayMs: number;
  /** Randomisation applied to each delay, 0–1. Default 0.3. */
  jitter: number;
}

/**
 * Turns one provider-specific chunk into a plain text delta.
 *
 * Return `null` to ignore the chunk (keep-alives, role announcements, usage
 * summaries). Return `{ done: true }` for the provider's end-of-stream marker.
 */
export type ChunkAdapter = (
  event: StreamEvent,
) => { text?: string; done?: boolean } | null;

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** True while tokens are still arriving for this message. */
  streaming?: boolean;
}

/** Wire format of the stream. */
export type StreamFormat = 'sse' | 'ndjson';

/**
 * Common shape for the incremental parsers, so the client can swap wire
 * formats without knowing which one it holds.
 */
export interface StreamParser {
  push(chunk: string): StreamEvent[];
  end(): StreamEvent | null;
  readonly lastEventId: string | undefined;
  readonly serverRetry: number | undefined;
}
