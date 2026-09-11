import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveAdapter, type AdapterName } from './adapters';
import { EventStream, type EventStreamOptions } from './client';
import type {
  ChunkAdapter,
  ConnectionState,
  Message,
  StreamEvent,
  StreamFormat,
} from './types';

let counter = 0;
const nextId = () => `m${(counter = (counter + 1) % 1e6)}-${Date.now().toString(36)}`;

// ---------------------------------------------------------------------------
// useEventStream — the generic case: order tracking, progress, notifications
// ---------------------------------------------------------------------------

export interface UseEventStreamOptions
  extends Omit<EventStreamOptions, 'onEvent' | 'onStateChange'> {
  /** Set false to hold off connecting until some condition is met. */
  enabled?: boolean;
  /** Parse each event's data. Defaults to JSON.parse with a raw-string fallback. */
  parse?: (event: StreamEvent) => unknown;
  onEvent?: (event: StreamEvent) => void;
}

export interface UseEventStreamResult<T> {
  /** Most recent parsed payload. */
  data: T | null;
  /** Every payload received, in order. */
  events: T[];
  state: ConnectionState;
  connected: boolean;
  error: unknown;
  close: () => void;
}

const defaultParse = (event: StreamEvent): unknown => {
  try {
    return JSON.parse(event.data);
  } catch {
    return event.data;
  }
};

/**
 * Subscribe to a server-sent event stream.
 *
 * ```tsx
 * const { data, connected } = useEventStream(`/orders/${id}/stream`);
 * ```
 */
export function useEventStream<T = unknown>(
  url: string,
  options: UseEventStreamOptions = {},
): UseEventStreamResult<T> {
  const { enabled = true, parse = defaultParse, onEvent, ...rest } = options;

  const [data, setData] = useState<T | null>(null);
  const [events, setEvents] = useState<T[]>([]);
  const [state, setState] = useState<ConnectionState>('idle');
  const [error, setError] = useState<unknown>(null);

  const streamRef = useRef<EventStream | null>(null);
  // Keep callbacks in a ref so changing them does not tear down the connection.
  const handlers = useRef({ parse, onEvent, rest });
  handlers.current = { parse, onEvent, rest };

  useEffect(() => {
    if (!enabled) return;

    const stream = new EventStream(url, {
      ...handlers.current.rest,
      onEvent: (event) => {
        handlers.current.onEvent?.(event);
        const payload = handlers.current.parse(event) as T;
        setData(payload);
        setEvents((prev) => [...prev, payload]);
      },
      onStateChange: setState,
      onError: (err, willRetry) => {
        if (!willRetry) setError(err);
      },
    });

    streamRef.current = stream;
    void stream.connect();

    return () => {
      stream.close();
      streamRef.current = null;
    };
    // Reconnect only when the target or enabled flag changes.
  }, [url, enabled]);

  const close = useCallback(() => streamRef.current?.close(), []);

  return { data, events, state, connected: state === 'open', error, close };
}

// ---------------------------------------------------------------------------
// useChatStream — AI chat with a typing effect
// ---------------------------------------------------------------------------

export interface UseChatStreamOptions {
  url: string;
  headers?: Record<string, string>;
  /** Wire format. Use "ndjson" for Ollama and similar local servers. */
  format?: StreamFormat;
  /** Provider chunk format. Defaults to "openai". */
  adapter?: AdapterName | ChunkAdapter;
  /**
   * Build the request body from the conversation. Defaults to an
   * OpenAI-shaped `{ model, messages, stream: true }`.
   */
  buildBody?: (messages: Message[]) => unknown;
  model?: string;
  initialMessages?: Message[];
  onFinish?: (message: Message) => void;
  onError?: (error: unknown) => void;
}

export interface UseChatStreamResult {
  messages: Message[];
  /** Send a user message and stream the reply. */
  send: (content: string) => void;
  /** Cancel the in-flight response. The partial text is kept. */
  stop: () => void;
  isStreaming: boolean;
  error: unknown;
  reset: () => void;
}

/**
 * Chat with a streaming completion endpoint.
 *
 * ```tsx
 * const { messages, send, isStreaming, stop } = useChatStream({
 *   url: 'https://api.openai.com/v1/chat/completions',
 *   headers: { Authorization: `Bearer ${key}` },
 * });
 * ```
 */
export function useChatStream(options: UseChatStreamOptions): UseChatStreamResult {
  const {
    url,
    headers,
    format = 'sse',
    adapter = 'openai',
    buildBody,
    model = 'gpt-4o-mini',
    initialMessages = [],
    onFinish,
    onError,
  } = options;

  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const streamRef = useRef<EventStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.close();
    streamRef.current = null;
    setIsStreaming(false);
    setMessages((prev) =>
      prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
    );
  }, []);

  useEffect(() => () => streamRef.current?.close(), []);

  const send = useCallback(
    (content: string) => {
      if (!content.trim() || isStreaming) return;
      setError(null);

      const userMessage: Message = { id: nextId(), role: 'user', content };
      const replyId = nextId();
      const history = [...messages, userMessage];

      setMessages([
        ...history,
        { id: replyId, role: 'assistant', content: '', streaming: true },
      ]);
      setIsStreaming(true);

      const parseChunk = resolveAdapter(adapter);
      const body = buildBody
        ? buildBody(history)
        : {
            model,
            stream: true,
            messages: history.map(({ role, content: c }) => ({ role, content: c })),
          };

      let finalText = '';

      const finish = () => {
        streamRef.current = null;
        setIsStreaming(false);
        setMessages((prev) =>
          prev.map((m) => (m.id === replyId ? { ...m, streaming: false } : m)),
        );
        onFinish?.({ id: replyId, role: 'assistant', content: finalText });
      };

      const stream = new EventStream(url, {
        method: 'POST',
        headers,
        format,
        body,
        // A completion is one-shot: a dropped connection mid-answer should not
        // silently replay the whole prompt and bill the user twice.
        retry: { maxAttempts: 0 },
        onEvent: (event) => {
          const chunk = parseChunk(event);
          if (!chunk) return;
          if (chunk.done) {
            stream.close();
            finish();
            return;
          }
          if (chunk.text) {
            finalText += chunk.text;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === replyId ? { ...m, content: m.content + chunk.text } : m,
              ),
            );
          }
        },
        onDone: finish,
        onError: (err) => {
          setError(err);
          onError?.(err);
          streamRef.current = null;
          setIsStreaming(false);
          setMessages((prev) =>
            prev.map((m) => (m.id === replyId ? { ...m, streaming: false } : m)),
          );
        },
      });

      streamRef.current = stream;
      void stream.connect();
    },
    [url, headers, format, adapter, buildBody, model, messages, isStreaming, onFinish, onError],
  );

  const reset = useCallback(() => {
    stop();
    setMessages(initialMessages);
    setError(null);
  }, [stop, initialMessages]);

  return { messages, send, stop, isStreaming, error, reset };
}
