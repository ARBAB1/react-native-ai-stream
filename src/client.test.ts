import { describe, expect, it, vi } from 'vitest';
import { EventStream } from './client';
import type { StreamEvent } from './types';

/** Build a Response whose body streams the given chunks. */
function streamingResponse(chunks: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200, ...init });
}

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('EventStream', () => {
  it('emits events parsed from the response body', async () => {
    const events: StreamEvent[] = [];
    const fetchImpl = vi.fn(async () =>
      streamingResponse(['data: one\n\n', 'data: two\n\n']),
    ) as unknown as typeof fetch;

    const stream = new EventStream('https://x.test/s', {
      fetchImpl,
      onEvent: (e) => events.push(e),
    });
    await stream.connect();

    expect(events.map((e) => e.data)).toEqual(['one', 'two']);
  });

  it('defaults to POST when a body is supplied', async () => {
    const fetchImpl = vi.fn(async () => streamingResponse(['data: x\n\n'])) as unknown as typeof fetch;
    const stream = new EventStream('https://x.test/s', { fetchImpl, body: { a: 1 } });
    await stream.connect();

    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('sends Accept: text/event-stream', async () => {
    const fetchImpl = vi.fn(async () => streamingResponse(['data: x\n\n'])) as unknown as typeof fetch;
    await new EventStream('https://x.test/s', { fetchImpl }).connect();
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(init.headers.Accept).toBe('text/event-stream');
  });

  it('replays Last-Event-ID when reconnecting', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) return streamingResponse(['id: 7\ndata: a\n\n']);
      return streamingResponse(['data: b\n\n']);
    }) as unknown as typeof fetch;

    const stream = new EventStream('https://x.test/s', {
      fetchImpl,
      retry: { baseDelayMs: 1, jitter: 0, maxAttempts: 2 },
    });
    await stream.connect();
    // First pass ends cleanly; reconnect explicitly to inspect the header.
    await stream.connect();

    const second = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1];
    expect(second.headers['Last-Event-ID']).toBe('7');
  });

  it('retries a failed connection then succeeds', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call < 3) throw new Error('network down');
      return streamingResponse(['data: ok\n\n']);
    }) as unknown as typeof fetch;

    const events: string[] = [];
    const stream = new EventStream('https://x.test/s', {
      fetchImpl,
      retry: { baseDelayMs: 1, maxDelayMs: 2, jitter: 0, maxAttempts: 5 },
      onEvent: (e) => events.push(e.data),
    });
    await stream.connect();
    await settle(120);

    expect(call).toBe(3);
    expect(events).toEqual(['ok']);
  });

  it('stops retrying after maxAttempts and reports terminal failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('always down');
    }) as unknown as typeof fetch;

    const onError = vi.fn();
    const stream = new EventStream('https://x.test/s', {
      fetchImpl,
      retry: { baseDelayMs: 1, maxDelayMs: 2, jitter: 0, maxAttempts: 2 },
      onError,
    });
    await stream.connect();
    await settle(150);

    expect(onError).toHaveBeenLastCalledWith(expect.any(Error), false);
    expect(stream.getState()).toBe('closed');
  });

  it('treats a non-2xx response as an error', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    const onError = vi.fn();
    const stream = new EventStream('https://x.test/s', {
      fetchImpl,
      retry: { maxAttempts: 0 },
      onError,
    });
    await stream.connect();

    expect(onError).toHaveBeenCalled();
    expect(String(onError.mock.calls[0][0])).toContain('401');
  });

  it('close() is treated as deliberate, not an error', async () => {
    const fetchImpl = vi.fn(async () => streamingResponse(['data: x\n\n'])) as unknown as typeof fetch;
    const onError = vi.fn();
    const stream = new EventStream('https://x.test/s', { fetchImpl, onError });
    stream.close();
    await stream.connect();
    await settle();

    expect(onError).not.toHaveBeenCalled();
    expect(stream.getState()).toBe('closed');
  });

  it('reports connection state transitions', async () => {
    const states: string[] = [];
    const fetchImpl = vi.fn(async () => streamingResponse(['data: x\n\n'])) as unknown as typeof fetch;
    await new EventStream('https://x.test/s', {
      fetchImpl,
      onStateChange: (s) => states.push(s),
    }).connect();

    expect(states).toContain('connecting');
    expect(states).toContain('open');
    expect(states).toContain('closed');
  });

  it('calls onDone when the stream ends cleanly', async () => {
    const onDone = vi.fn();
    const fetchImpl = vi.fn(async () => streamingResponse(['data: x\n\n'])) as unknown as typeof fetch;
    await new EventStream('https://x.test/s', { fetchImpl, onDone }).connect();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('falls back to buffered text when the body is not readable', async () => {
    const events: string[] = [];
    const fetchImpl = vi.fn(async () => new Response('data: buffered\n\n')) as unknown as typeof fetch;
    const stream = new EventStream('https://x.test/s', {
      fetchImpl,
      onEvent: (e) => events.push(e.data),
    });
    await stream.connect();
    expect(events).toEqual(['buffered']);
  });
});
