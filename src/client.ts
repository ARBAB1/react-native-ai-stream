import { computeBackoff, DEFAULT_RETRY } from './backoff';
import { SSEParser } from './parser';
import type { ConnectionState, RetryPolicy, StreamEvent } from './types';

export interface EventStreamOptions {
  /** HTTP method. Defaults to GET; AI completion endpoints need POST. */
  method?: string;
  headers?: Record<string, string>;
  /** Request body. Objects are JSON-encoded and the content type set. */
  body?: unknown;

  retry?: Partial<RetryPolicy>;

  /** Called for every parsed event. */
  onEvent?: (event: StreamEvent) => void;
  onOpen?: () => void;
  onStateChange?: (state: ConnectionState) => void;
  /** Called when the stream ends normally, without error. */
  onDone?: () => void;
  /**
   * Called on a failure. `willRetry` says whether a reconnect is scheduled —
   * when false this is terminal.
   */
  onError?: (error: unknown, willRetry: boolean) => void;

  /**
   * Abort signal from the caller. Aborting is treated as a deliberate stop,
   * never as an error, and never triggers a reconnect.
   */
  signal?: AbortSignal;

  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * A Server-Sent Events client that works in React Native.
 *
 * The browser's own `EventSource` is GET-only and cannot send headers or a
 * body, which rules it out for AI completion endpoints — those are POST with an
 * Authorization header and a JSON payload. This client speaks the same wire
 * format over `fetch`, so the same code covers both cases.
 */
export class EventStream {
  private readonly url: string;
  private readonly options: EventStreamOptions;
  private readonly retryPolicy: RetryPolicy;
  private readonly fetchImpl: typeof fetch;

  private parser = new SSEParser();
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private stopped = false;
  private state: ConnectionState = 'idle';

  constructor(url: string, options: EventStreamOptions = {}) {
    this.url = url;
    this.options = options;
    this.retryPolicy = { ...DEFAULT_RETRY, ...options.retry };
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;

    if (options.signal) {
      if (options.signal.aborted) this.stopped = true;
      else options.signal.addEventListener('abort', () => this.close());
    }
  }

  getState(): ConnectionState {
    return this.state;
  }

  /** Open the stream. Safe to call once; use a new instance to restart. */
  async connect(): Promise<void> {
    if (this.stopped) return;
    this.setState(this.attempt === 0 ? 'connecting' : 'reconnecting');

    this.controller = new AbortController();

    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
      ...this.options.headers,
    };

    // Resume where we left off, so the server can replay what we missed.
    const lastId = this.parser.lastEventId;
    if (lastId) headers['Last-Event-ID'] = lastId;

    let body = this.options.body as BodyInit | undefined;
    if (body !== undefined && typeof body === 'object' && !(body instanceof FormData)) {
      body = JSON.stringify(body);
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    }

    try {
      const res = await this.fetchImpl(this.url, {
        method: this.options.method ?? (body !== undefined ? 'POST' : 'GET'),
        headers,
        body,
        signal: this.controller.signal,
        // @ts-expect-error — React Native honours this to stream the response
        // body instead of buffering it. Harmless elsewhere.
        reactNative: { textStreaming: true },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
      }

      this.attempt = 0;
      this.setState('open');
      this.options.onOpen?.();

      await this.read(res);

      if (!this.stopped) {
        // A clean end-of-stream. Servers that intend a persistent connection
        // will be reconnected to; one-shot completions call onDone first.
        this.options.onDone?.();
        this.setState('closed');
      }
    } catch (error) {
      if (this.stopped || this.isAbort(error)) {
        this.setState('closed');
        return;
      }
      this.handleFailure(error);
    }
  }

  /** Stop the stream. Idempotent, and never triggers a reconnect. */
  close(): void {
    this.stopped = true;
    this.clearTimer();
    this.controller?.abort();
    this.controller = null;
    this.setState('closed');
  }

  // ---------------------------------------------------------------- internals

  private async read(res: Response): Promise<void> {
    const body = res.body as ReadableStream<Uint8Array> | null | undefined;

    if (body && typeof body.getReader === 'function') {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.emit(decoder.decode(value, { stream: true }));
      }
      return;
    }

    // Fallback for environments without a readable body. The response is
    // buffered rather than streamed, so events arrive together at the end —
    // correct, just not incremental.
    const text = await res.text();
    this.emit(text);
    const tail = this.parser.end();
    if (tail) this.options.onEvent?.(tail);
  }

  private emit(chunk: string): void {
    for (const event of this.parser.push(chunk)) {
      this.options.onEvent?.(event);
    }
  }

  private handleFailure(error: unknown): void {
    this.attempt += 1;
    const willRetry = this.attempt <= this.retryPolicy.maxAttempts;
    this.options.onError?.(error, willRetry);

    if (!willRetry) {
      this.setState('closed');
      return;
    }

    const delay = computeBackoff(
      this.attempt,
      this.retryPolicy,
      this.parser.serverRetry,
    );
    this.setState('reconnecting');
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connect();
    }, delay);
  }

  private isAbort(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { name?: string }).name === 'AbortError'
    );
  }

  private setState(next: ConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    this.options.onStateChange?.(next);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/** Convenience wrapper: construct and connect in one call. */
export function createEventStream(
  url: string,
  options: EventStreamOptions = {},
): EventStream {
  const stream = new EventStream(url, options);
  void stream.connect();
  return stream;
}
