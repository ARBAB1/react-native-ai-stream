import type { StreamEvent, StreamParser } from './types';

/**
 * Incremental parser for newline-delimited JSON.
 *
 * Some streaming endpoints — Ollama and several local model servers among them
 * — emit one JSON object per line with no `data:` prefix and no blank-line
 * terminator:
 *
 *   {"response":"Hel","done":false}
 *   {"response":"lo","done":false}
 *   {"done":true}
 *
 * Each complete line becomes a `StreamEvent` whose `data` is the raw line, so
 * the same adapters that handle SSE work here unchanged.
 */
export class NDJSONParser implements StreamParser {
  private buffer = '';

  push(chunk: string): StreamEvent[] {
    this.buffer += chunk.replace(/\r\n|\r/g, '\n');
    const out: StreamEvent[] = [];

    let index: number;
    while ((index = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      // Blank lines are padding, not events.
      if (line !== '') out.push({ event: 'message', data: line });
    }

    return out;
  }

  /** Flush a final line that arrived without a trailing newline. */
  end(): StreamEvent | null {
    const line = this.buffer.trim();
    this.buffer = '';
    return line === '' ? null : { event: 'message', data: line };
  }

  // NDJSON has no equivalent of the SSE id/retry fields.
  get lastEventId(): undefined {
    return undefined;
  }

  get serverRetry(): undefined {
    return undefined;
  }
}
