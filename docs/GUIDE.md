# Guide

Everything you need to use this library, starting from what the problem
actually is.

## Contents

- [What this solves, in plain terms](#what-this-solves-in-plain-terms)
- [Do you need it?](#do-you-need-it)
- [Quick start](#quick-start)
- [Recipe: AI chat](#recipe-ai-chat)
- [Recipe: order tracking](#recipe-order-tracking)
- [Recipe: progress bar](#recipe-progress-bar)
- [Recipe: notifications](#recipe-notifications)
- [Recipe: local models with Ollama](#recipe-local-models-with-ollama)
- [Writing the server side](#writing-the-server-side)
- [Keeping your API key safe](#keeping-your-api-key-safe)
- [How reconnection works](#how-reconnection-works)
- [Platform notes](#platform-notes)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)

---

## What this solves, in plain terms

Imagine waiting for a friend to arrive.

**Option one — you phone them every five minutes:**

> "Are you here yet?" — "No."
> "Are you here yet?" — "No."

Annoying, wastes everyone's time, and you can still miss them by four minutes.

**Option two — you say "ring the doorbell when you get here," and get on with
your day.**

That is the whole idea.

### What your app does today

A screen showing a delivery status usually looks like this:

```js
setInterval(() => fetch('/order/123'), 5000);
```

Over a 30-minute delivery that is **360 requests**, and roughly **357 of the
answers are "nothing changed."** The battery drains, your server handles 360
pointless requests per customer, and the status still arrives up to five
seconds late.

### What it does instead

The app opens **one** connection and waits. The server stays quiet until
something actually happens, then pushes it. The moment the restaurant taps
"Out for delivery," it is on the customer's screen.

**One connection instead of 360 requests. Instant instead of five seconds late.**

### Why AI chat is the same thing

Ask an AI a question. Two ways to show the answer:

- Wait ten seconds, then show the whole paragraph. Users think it has frozen.
- Show each word as it is written. Feels fast, even though it takes the same
  ten seconds.

The second needs exactly the same "server pushes, app listens" connection.
That is why one library covers both.

---

## Do you need it?

**Yes, if your screen shows something that changes on its own:** an AI
response, a delivery status, a progress bar, a notification badge, a live
price, a queue position.

**No, if you just fetch data once.** A profile screen, a settings page, a
product list — use plain `fetch`. Adding a stream there is complexity for
nothing.

**Quick test:** if you have written `setInterval` around a `fetch`, that screen
is a candidate.

### Is your endpoint compatible?

Run this against it:

```sh
curl -N -H "Accept: text/event-stream" https://your-api.com/endpoint
```

| You see | Meaning |
|---|---|
| `data: {...}` repeating | ✅ SSE — use the default |
| `{"a":1}` one JSON object per line | ✅ NDJSON — use `format: 'ndjson'` |
| One large JSON blob at the end | ❌ ordinary REST — use `fetch` |
| Connection upgrade / `ws://` | ❌ WebSocket — different protocol |

---

## Quick start

```sh
npm install react-native-ai-stream
```

No native modules, so it works in Expo Go. No runtime dependencies.

```tsx
import { useEventStream } from 'react-native-ai-stream/react';

function Status() {
  const { data, connected } = useEventStream('https://api.example.com/stream');
  return <Text>{connected ? JSON.stringify(data) : 'connecting…'}</Text>;
}
```

---

## Recipe: AI chat

The typing effect people expect from ChatGPT.

```tsx
import { useChatStream } from 'react-native-ai-stream/react';

export function Chat() {
  const [input, setInput] = useState('');
  const { messages, send, stop, isStreaming, error } = useChatStream({
    url: 'https://your-backend.com/api/chat',   // your proxy, not OpenAI directly
    model: 'gpt-4o-mini',
  });

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => (
          <Text style={item.role === 'user' ? styles.you : styles.ai}>
            {item.content}
            {item.streaming ? ' ▋' : ''}
          </Text>
        )}
      />

      <TextInput value={input} onChangeText={setInput} editable={!isStreaming} />

      {isStreaming ? (
        <Button title="Stop" onPress={stop} />
      ) : (
        <Button title="Send" onPress={() => { send(input); setInput(''); }} />
      )}

      {error ? <Text style={styles.error}>{String(error)}</Text> : null}
    </View>
  );
}
```

**What you get:** words appear as they arrive, `item.streaming` drives the
caret, the stop button genuinely aborts the request, and the partial answer
stays on screen.

**Switching provider** is one line:

```tsx
useChatStream({ url, adapter: 'anthropic' });                  // Anthropic
useChatStream({ url, adapter: 'ollama', format: 'ndjson' });   // local model
```

---

## Recipe: order tracking

```tsx
function OrderStatus({ orderId }) {
  const { data, connected, error } = useEventStream(
    `https://api.example.com/orders/${orderId}/stream`
  );

  if (error) return <Text>Could not connect</Text>;

  return (
    <View>
      <Text style={styles.status}>{data?.status ?? 'Loading…'}</Text>
      {!connected && <Text style={styles.muted}>Reconnecting…</Text>}
    </View>
  );
}
```

Server side, push whenever the status changes:

```js
res.write(`data: ${JSON.stringify({ status: 'Out for delivery' })}\n\n`);
```

**Rider location** is the same pattern with coordinates:

```tsx
const { data } = useEventStream(`/orders/${id}/rider`);
<MapView region={{ latitude: data?.lat, longitude: data?.lng, ...delta }} />
```

---

## Recipe: progress bar

For anything slow: a report, a video render, a bulk import.

```tsx
function ExportProgress({ jobId }) {
  const { data } = useEventStream(`/jobs/${jobId}/progress`);
  const percent = data?.percent ?? 0;

  return (
    <View>
      <View style={[styles.bar, { width: `${percent}%` }]} />
      <Text>{data?.stage ?? 'Starting…'} — {percent}%</Text>
    </View>
  );
}
```

```js
// server
res.write(`data: ${JSON.stringify({ percent: 40, stage: 'Rendering' })}\n\n`);
```

---

## Recipe: notifications

One stream, several event types — that is what the `event:` field is for.

```tsx
function NotificationListener() {
  const [count, setCount] = useState(0);

  useEventStream('/notifications', {
    onEvent: (e) => {
      if (e.event === 'new_message') setCount((c) => c + 1);
      if (e.event === 'order_update') refreshOrders();
    },
  });

  return <Badge count={count} />;
}
```

```js
// server
res.write('event: new_message\n');
res.write(`data: ${JSON.stringify({ from: 'Ali' })}\n\n`);
```

---

## Recipe: local models with Ollama

Ollama streams NDJSON rather than SSE, so set the format and adapter:

```tsx
const { messages, send } = useChatStream({
  url: 'http://localhost:11434/api/chat',
  format: 'ndjson',
  adapter: 'ollama',
  model: 'llama3',
});
```

⚠️ On a physical device `localhost` is the phone, not your computer. Use your
machine's LAN address — `http://192.168.1.x:11434` — and start Ollama with
`OLLAMA_HOST=0.0.0.0 ollama serve` so it accepts connections from the network.

---

## Writing the server side

Plain HTTP. No special server, no extra protocol, and it passes through nginx
and CDNs.

**Node / Express**

```js
app.get('/orders/:id/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const unsubscribe = orders.subscribe(req.params.id, send);

  // A comment line every 15s keeps proxies from closing an idle connection.
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);

  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
});
```

**The format**

```
data: {"status":"Preparing"}⏎
⏎
```

`data: `, your payload, then **two** newlines. That is the entire protocol.

Optional fields:

```
id: 42            ← replayed as Last-Event-ID on reconnect
event: order_update   ← lets one stream carry several kinds
retry: 5000       ← tells the client how long to wait before reconnecting
: ping            ← a comment; ignored, useful as a keep-alive
```

⚠️ **Nginx buffers by default**, which holds your events until the connection
closes. Add:

```nginx
location /stream {
  proxy_pass http://backend;
  proxy_buffering off;
  proxy_cache off;
  proxy_read_timeout 24h;
}
```

---

## Keeping your API key safe

**Never put an API key in a mobile app.** The bundle can be extracted and the
key read out of it, and someone else spends your credits.

Put a thin endpoint in front instead:

```js
app.post('/api/chat', async (req, res) => {
  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_KEY}`,   // stays server-side
    },
    body: JSON.stringify({ ...req.body, stream: true }),
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  for await (const chunk of upstream.body) res.write(chunk);
  res.end();
});
```

The app then points at your own URL. The hook does not care what is behind it.

This is also where you add rate limiting and per-user auth — things you cannot
do when the app talks to OpenAI directly.

---

## How reconnection works

When a connection drops, the client waits, then tries again — with the delay
doubling each time and a little randomness added:

```
attempt 1 → ~500ms
attempt 2 → ~1s
attempt 3 → ~2s
attempt 4 → ~4s      … capped at 30s
```

**Why the randomness matters:** when a server restarts it drops every
connection at once. Without jitter, every device in the world retries on the
same schedule and knocks it straight over again.

**Resume:** if your server sends `id:` with each event, the client replays the
last one as a `Last-Event-ID` header on reconnect, so you can send only what
was missed.

**Server pacing:** a `retry: 5000` from your server overrides the computed
delay. Useful when you know you need a minute.

```ts
retry: { maxAttempts: 10, baseDelayMs: 500, maxDelayMs: 30_000, jitter: 0.3 }
```

⚠️ **Chat completions do not auto-retry.** A dropped connection mid-answer
would resend the whole prompt and bill you twice, so failures surface through
`error` instead. Live-update streams retry aggressively; completions do not.

---

## Platform notes

**Expo** — works in Expo Go. No config plugin, no prebuild.

**iOS** — HTTPS works out of the box. For a plain-HTTP dev server you need an
App Transport Security exception in `app.json`.

**Android** — cleartext HTTP is blocked by default on API 28+. For local
development add `usesCleartextTraffic` or use HTTPS.

**Background** — streams are paused when the app is backgrounded, which is
correct: a socket held open in the background drains battery and the OS will
kill it anyway. Reconnect on foreground and use push notifications for
anything that must arrive while the app is closed.

---

## Troubleshooting

**Nothing arrives, but the request succeeds**
Your server is probably buffering. Check `proxy_buffering off` in nginx, and
that you call `res.flushHeaders()` and are not sitting behind a CDN that
buffers.

**Everything arrives at once, at the end**
The response body was not streamed, so the client fell back to a buffered read.
Confirm the server sets `Content-Type: text/event-stream` and flushes after
each write.

**`JSON.parse` errors on some chunks**
You are parsing raw network chunks somewhere instead of letting the library
reassemble them. A single event is routinely split across two TCP reads.

**Chat streams, then stops silently**
Your provider probably signals completion differently. Check the adapter — for
a custom endpoint use a custom adapter returning `{ done: true }` on your own
end marker.

**Reconnects in a loop**
Your server is closing the connection immediately. A stream is meant to stay
open; if it ends, the client treats that as a drop and reconnects.

**Works in the simulator, not on device**
`localhost` on a device means the device. Use your machine's LAN IP.

---

## FAQ

**Is this only for AI?**
No. AI chat is the loudest use, but order tracking, progress, notifications,
live prices and presence all use the same mechanism. The AI part is one adapter.

**SSE or WebSocket?**
If the client only needs to *receive*, SSE is simpler: plain HTTP, reconnection
in the spec, no proxy configuration. Choose WebSocket when the client also
needs to send continuously — a multiplayer game, a collaborative editor.

**Does it work with `@ai-sdk/react`?**
They solve the same problem on different platforms. Use Vercel's on the web,
this on React Native.

**What about React or Next.js?**
The browser has `EventSource` built in, and Vercel's SDK is excellent. This
library exists because React Native has neither.

**Can I use my own AI provider?**
Yes — write an adapter in a few lines:

```ts
const custom: ChunkAdapter = (event) => {
  if (event.data === 'END') return { done: true };
  const t = JSON.parse(event.data).text;
  return t ? { text: t } : null;
};
```

**Does it cost anything to keep a connection open?**
Very little on the client. On the server each open stream holds a connection,
so for thousands of concurrent users size your server accordingly — though it
is still far cheaper than those users polling every five seconds.
