# react-native-ai-stream

[![npm](https://img.shields.io/npm/v/react-native-ai-stream.svg)](https://www.npmjs.com/package/react-native-ai-stream)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![types](https://img.shields.io/npm/types/react-native-ai-stream.svg)](./src/types.ts)
[![zero deps](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](./package.json)

**Streaming for React Native — AI responses, live updates, progress.**

React Native has no `EventSource`, and its `fetch` buffers the whole response
before handing it to you. So there is no built-in way to receive data as it
arrives. This is that, with reconnection, cancellation and hooks for OpenAI and
Anthropic.

```tsx
const { messages, send, isStreaming, stop } = useChatStream({
  url: 'https://api.openai.com/v1/chat/completions',
  headers: { Authorization: `Bearer ${key}` },
});
// text appears word by word, the stop button works, it reconnects on a blip
```

---

## The problem

Your app needs live updates — an AI answer appearing word by word, an order
moving from *Preparing* to *Out for delivery*, a progress bar.

Most apps solve it by asking, over and over:

```js
setInterval(() => fetch('/order/123'), 5000);   // 720 requests an hour
```

That drains battery, hammers your server, and the update still arrives up to
five seconds late.

**Server-Sent Events invert it:** the client opens one connection and the server
pushes when something actually happens. One connection, instant updates, near
zero traffic while idle.

The catch on React Native:

| | Browser | React Native |
|---|---|---|
| `EventSource` | ✅ built in | ❌ missing |
| Streaming `fetch` body | ✅ | ❌ buffers the whole response |
| **POST with headers + body** | ❌ *EventSource is GET-only* | — |

That last row matters more than it looks. **Every AI completion endpoint is a
POST** with an `Authorization` header and a JSON body. The browser's own
`EventSource` cannot do that either — which is why a plain polyfill is not
enough, and why this library speaks the wire format over `fetch` instead.

## Install

```sh
npm install react-native-ai-stream
```

No runtime dependencies. No native modules — works in Expo Go.

---

## AI chat

```tsx
import { useChatStream } from 'react-native-ai-stream/react';

export function Chat() {
  const { messages, send, isStreaming, stop, error } = useChatStream({
    url: 'https://api.openai.com/v1/chat/completions',
    headers: { Authorization: `Bearer ${process.env.OPENAI_KEY}` },
    model: 'gpt-4o-mini',
  });

  return (
    <View>
      {messages.map((m) => (
        <Text key={m.id}>
          {m.content}
          {m.streaming ? '▋' : ''}
        </Text>
      ))}

      <Button title="Ask" onPress={() => send('Explain SSE simply')} />
      {isStreaming && <Button title="Stop" onPress={stop} />}
      {error ? <Text>{String(error)}</Text> : null}
    </View>
  );
}
```

**Anthropic** — one word changes:

```tsx
useChatStream({
  url: 'https://api.anthropic.com/v1/messages',
  headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  adapter: 'anthropic',
});
```

> ⚠️ Do not ship an API key in your app. Point `url` at your own backend and
> keep the key on the server — the hook does not care what it is talking to.

## Live updates — anything that is not chat

```tsx
import { useEventStream } from 'react-native-ai-stream/react';

function OrderStatus({ orderId }) {
  const { data, connected } = useEventStream(`/api/orders/${orderId}/stream`);

  return (
    <Text>
      {data?.status ?? 'Loading…'}
      {!connected && ' (reconnecting…)'}
    </Text>
  );
}
```

Order tracking, job progress, notifications, live prices, presence, build logs —
same hook.

### What your server sends

Plain HTTP. No special server, no separate protocol, works through nginx and
CDNs:

```js
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');

res.write(`data: ${JSON.stringify({ status: 'Out for delivery' })}\n\n`);
```

`data: `, your payload, then **two** newlines.

## Without React

```ts
import { EventStream } from 'react-native-ai-stream';

const stream = new EventStream('https://api.example.com/events', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: { channel: 'orders' },
  onEvent: (e) => console.log(e.event, e.data),
  onError: (err, willRetry) => console.warn(err, willRetry),
});

await stream.connect();
stream.close();
```

---

## What it handles for you

| | |
|---|---|
| **Chunk boundaries** | An event split across two network reads is buffered and reassembled |
| **Reconnection** | Exponential backoff with jitter, so a fleet of devices does not stampede your server |
| **Resume** | `Last-Event-ID` is replayed so the server can send what you missed |
| **Server pacing** | A `retry:` field from the server overrides the computed delay |
| **Cancellation** | `stop()` aborts the request; partial text is kept |
| **Keep-alives** | `:` comment lines ignored |
| **Multi-line data** | Joined with newlines, per spec |
| **CRLF** | Normalised |

## API

### `useChatStream(options)`

| Option | Default | |
|---|---|---|
| `url` | *required* | Completion endpoint |
| `headers` | — | Auth and provider headers |
| `adapter` | `'openai'` | `'openai'`, `'anthropic'`, `'text'`, or your own |
| `model` | `'gpt-4o-mini'` | Used by the default body builder |
| `buildBody` | OpenAI shape | Build the request body yourself |
| `initialMessages` | `[]` | Seed the conversation |
| `onFinish` / `onError` | — | Callbacks |

Returns `{ messages, send, stop, isStreaming, error, reset }`.

⚠️ A chat completion **does not auto-retry**. A dropped connection mid-answer
would replay the whole prompt and bill you twice, so failures surface instead.

### `useEventStream(url, options)`

`{ enabled, parse, retry, headers, method, body, onEvent }` →
`{ data, events, state, connected, error, close }`

### `new EventStream(url, options)`

`{ method, headers, body, retry, signal, fetchImpl, onEvent, onOpen, onDone, onError, onStateChange }`

`retry` is `{ maxAttempts, baseDelayMs, maxDelayMs, jitter }` — default
`{ 10, 500, 30_000, 0.3 }`.

### Custom adapter

Any provider, in a few lines:

```ts
const gemini: ChunkAdapter = (event) => {
  if (event.data === '[DONE]') return { done: true };
  const t = JSON.parse(event.data)?.candidates?.[0]?.content?.parts?.[0]?.text;
  return t ? { text: t } : null;
};
```

## Compared to the alternatives

| | |
|---|---|
| [`react-native-sse`](https://www.npmjs.com/package/react-native-sse) | A low-level EventSource polyfill. No React hooks, no provider parsing, no AbortController. Last published **March 2024** |
| [`@ai-sdk/react`](https://www.npmjs.com/package/@ai-sdk/react) | Excellent — **if you are on the web.** Use it there |
| Hand-rolling it | ~80 lines of parsing, state and reconnection, in every project |

Use `@ai-sdk/react` on the web. This is the React Native side.

## Examples

```sh
npm run demo        # real local SSE server, no simulator needed
```

Exercises token streaming, an event split across network writes, cancellation,
reconnection with backoff, and non-chat live updates. See
[`example/`](./example) for the React Native chat screen.

## Development

```sh
npm install
npm test
npm run typecheck
npm run build
```

## License

MIT
