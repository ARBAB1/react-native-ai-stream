import { describe, expect, it } from 'vitest';
import { SSEParser } from './parser';
import { computeBackoff } from './backoff';
import { anthropic, openai, text } from './adapters';

describe('SSEParser', () => {
  it('parses a basic event', () => {
    const p = new SSEParser();
    expect(p.push('data: hello\n\n')).toEqual([
      { event: 'message', data: 'hello', id: undefined, retry: undefined },
    ]);
  });

  it('waits for the blank line before emitting', () => {
    const p = new SSEParser();
    expect(p.push('data: hello\n')).toEqual([]);
    expect(p.push('\n')).toHaveLength(1);
  });

  it('handles an event split across network chunks', () => {
    const p = new SSEParser();
    // This is the case that breaks naive implementations: a chunk boundary
    // landing mid-token.
    expect(p.push('data: {"cho')).toEqual([]);
    expect(p.push('ices":[{"delta"')).toEqual([]);
    const out = p.push(':{"content":"Hi"}}]}\n\n');
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0].data).choices[0].delta.content).toBe('Hi');
  });

  it('joins multi-line data with newlines', () => {
    const p = new SSEParser();
    const [e] = p.push('data: line one\ndata: line two\n\n');
    expect(e.data).toBe('line one\nline two');
  });

  it('reads named events', () => {
    const p = new SSEParser();
    const [e] = p.push('event: content_block_delta\ndata: {}\n\n');
    expect(e.event).toBe('content_block_delta');
  });

  it('ignores comment keep-alive lines', () => {
    const p = new SSEParser();
    expect(p.push(': ping\n\n')).toEqual([]);
    expect(p.push('data: real\n\n')).toHaveLength(1);
  });

  it('tracks the last event id for resume', () => {
    const p = new SSEParser();
    p.push('id: 42\ndata: x\n\n');
    expect(p.lastEventId).toBe('42');
  });

  it('records the server retry hint', () => {
    const p = new SSEParser();
    p.push('retry: 5000\ndata: x\n\n');
    expect(p.serverRetry).toBe(5000);
  });

  it('ignores a non-integer retry value', () => {
    const p = new SSEParser();
    p.push('retry: soon\ndata: x\n\n');
    expect(p.serverRetry).toBeUndefined();
  });

  it('strips only one leading space after the colon', () => {
    const p = new SSEParser();
    const [e] = p.push('data:  two spaces\n\n');
    expect(e.data).toBe(' two spaces');
  });

  it('handles a field with no colon', () => {
    const p = new SSEParser();
    expect(p.push('data\n\n')).toEqual([]);
  });

  it('normalises CRLF line endings', () => {
    const p = new SSEParser();
    expect(p.push('data: hi\r\n\r\n')).toHaveLength(1);
  });

  it('emits several events from one chunk', () => {
    const p = new SSEParser();
    expect(p.push('data: a\n\ndata: b\n\ndata: c\n\n')).toHaveLength(3);
  });

  it('end() flushes a stream that lacked a trailing blank line', () => {
    const p = new SSEParser();
    p.push('data: tail');
    expect(p.end()?.data).toBe('tail');
  });
});

describe('computeBackoff', () => {
  const policy = { maxAttempts: 10, baseDelayMs: 500, maxDelayMs: 30_000, jitter: 0 };

  it('grows exponentially', () => {
    expect(computeBackoff(1, policy)).toBe(500);
    expect(computeBackoff(2, policy)).toBe(1000);
    expect(computeBackoff(3, policy)).toBe(2000);
  });

  it('clamps to maxDelayMs', () => {
    expect(computeBackoff(20, policy)).toBe(30_000);
  });

  it('prefers the server retry hint over the computed delay', () => {
    expect(computeBackoff(5, policy, 1234)).toBe(1234);
  });

  it('never returns a negative delay at full jitter', () => {
    const jittery = { ...policy, jitter: 1 };
    expect(computeBackoff(1, jittery, undefined, () => 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('adapters', () => {
  const ev = (data: string, event = 'message') => ({ event, data });

  it('openai extracts the content delta', () => {
    expect(openai(ev('{"choices":[{"delta":{"content":"Hel"}}]}'))).toEqual({ text: 'Hel' });
  });

  it('openai recognises [DONE]', () => {
    expect(openai(ev('[DONE]'))).toEqual({ done: true });
  });

  it('openai ignores the role-announcement chunk', () => {
    expect(openai(ev('{"choices":[{"delta":{"role":"assistant"}}]}'))).toBeNull();
  });

  it('openai survives malformed JSON', () => {
    expect(openai(ev('{not json'))).toBeNull();
  });

  it('anthropic extracts a text_delta', () => {
    const e = ev('{"delta":{"type":"text_delta","text":"Hi"}}', 'content_block_delta');
    expect(anthropic(e)).toEqual({ text: 'Hi' });
  });

  it('anthropic ignores other event types', () => {
    expect(anthropic(ev('{}', 'ping'))).toBeNull();
  });

  it('anthropic ends on message_stop', () => {
    expect(anthropic(ev('{}', 'message_stop'))).toEqual({ done: true });
  });

  it('text passes data straight through', () => {
    expect(text(ev('raw'))).toEqual({ text: 'raw' });
  });
});
