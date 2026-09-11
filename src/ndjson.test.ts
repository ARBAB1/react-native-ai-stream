import { describe, expect, it, vi } from 'vitest';
import { NDJSONParser } from './ndjson';
import { ollama } from './adapters';
import { EventStream } from './client';

describe('NDJSONParser', () => {
  it('emits one event per line', () => {
    const p = new NDJSONParser();
    const out = p.push('{"a":1}\n{"a":2}\n');
    expect(out.map((e) => e.data)).toEqual(['{"a":1}', '{"a":2}']);
  });

  it('waits for the newline before emitting', () => {
    const p = new NDJSONParser();
    expect(p.push('{"a":1}')).toEqual([]);
    expect(p.push('\n')).toHaveLength(1);
  });

  it('reassembles a line split across chunks', () => {
    const p = new NDJSONParser();
    expect(p.push('{"resp')).toEqual([]);
    expect(p.push('onse":"hi"')).toEqual([]);
    const [e] = p.push('}\n');
    expect(JSON.parse(e.data).response).toBe('hi');
  });

  it('skips blank lines', () => {
    const p = new NDJSONParser();
    expect(p.push('\n\n{"a":1}\n\n')).toHaveLength(1);
  });

  it('normalises CRLF', () => {
    const p = new NDJSONParser();
    expect(p.push('{"a":1}\r\n')).toHaveLength(1);
  });

  it('end() flushes a final line with no newline', () => {
    const p = new NDJSONParser();
    p.push('{"a":1}');
    expect(p.end()?.data).toBe('{"a":1}');
  });

  it('end() returns null when nothing is buffered', () => {
    expect(new NDJSONParser().end()).toBeNull();
  });

  it('has no id or retry, unlike SSE', () => {
    const p = new NDJSONParser();
    p.push('{"a":1}\n');
    expect(p.lastEventId).toBeUndefined();
    expect(p.serverRetry).toBeUndefined();
  });
});

describe('ollama adapter', () => {
  const ev = (data: string) => ({ event: 'message', data });

  it('extracts the response field from /api/generate', () => {
    expect(ollama(ev('{"response":"Hel","done":false}'))).toEqual({ text: 'Hel' });
  });

  it('extracts message.content from /api/chat', () => {
    expect(ollama(ev('{"message":{"content":"Hi"},"done":false}'))).toEqual({ text: 'Hi' });
  });

  it('ends on done', () => {
    expect(ollama(ev('{"response":"","done":true}'))).toEqual({ done: true });
  });

  it('ignores an empty response chunk', () => {
    expect(ollama(ev('{"response":"","done":false}'))).toBeNull();
  });

  it('survives malformed JSON', () => {
    expect(ollama(ev('{broken'))).toBeNull();
  });
});

describe('EventStream with format: ndjson', () => {
  function ndjsonResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          for (const chunk of chunks) c.enqueue(encoder.encode(chunk));
          c.close();
        },
      }),
      { status: 200 },
    );
  }

  it('streams NDJSON end to end through the ollama adapter', async () => {
    const fetchImpl = vi.fn(async () =>
      ndjsonResponse([
        '{"response":"Hel","done":false}\n',
        '{"response":"lo","done":false}\n',
        '{"response":"","done":true}\n',
      ]),
    ) as unknown as typeof fetch;

    let text = '';
    let finished = false;

    const stream = new EventStream('http://x.test/api/generate', {
      format: 'ndjson',
      fetchImpl,
      onEvent: (e) => {
        const chunk = ollama(e);
        if (chunk?.done) finished = true;
        else if (chunk?.text) text += chunk.text;
      },
    });
    await stream.connect();

    expect(text).toBe('Hello');
    expect(finished).toBe(true);
  });

  it('sends the NDJSON Accept header', async () => {
    const fetchImpl = vi.fn(async () => ndjsonResponse(['{"done":true}\n'])) as unknown as typeof fetch;
    await new EventStream('http://x.test/s', { format: 'ndjson', fetchImpl }).connect();

    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(init.headers.Accept).toBe('application/x-ndjson');
  });

  it('still sends the SSE Accept header by default', async () => {
    const fetchImpl = vi.fn(async () => ndjsonResponse(['data: x\n\n'])) as unknown as typeof fetch;
    await new EventStream('http://x.test/s', { fetchImpl }).connect();

    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(init.headers.Accept).toBe('text/event-stream');
  });
});
