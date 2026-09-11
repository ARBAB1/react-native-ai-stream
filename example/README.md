# Examples

## 1. Node demo — no simulator needed

Runs a real local SSE server and drives the real client against it. Nothing is
mocked.

```sh
npm install
npm run build
node example/node-demo.cjs
```

It exercises the five things that matter:

```
=== 1. AI completion streaming token by token ===
   "Server-Sent Events push data as it happens."

=== 2. Event split across network writes ===
   ✅ reassembled ok

=== 3. Cancellation — stop mid-stream, keep the partial text ===
   stopped after: "Server-Sent Events push"

=== 4. Reconnection with backoff after two failures ===
   ↻ attempt 1 failed (HTTP 503 Service Unavailable) — retrying
   ↻ attempt 2 failed (HTTP 503 Service Unavailable) — retrying
   ✅ connected, streaming

=== 5. Non-chat: live order status ===
   📦 Preparing          (id 1)
   📦 Out for delivery   (id 2)
   📦 Arrived            (id 3)
```

Case 2 is the one worth understanding. The server deliberately splits a single
JSON event across three writes:

```js
res.write('data: {"choices":[{"del');
res.write('ta":{"content":"reassembled ok"}}]}');
res.write('\n\n');
```

Network chunks never align with event boundaries in reality either. A parser
that assumes one chunk equals one event drops tokens and produces JSON errors
under load.

## 2. Live test against real endpoints

```sh
npm run build
npm run test:live
```

**Part 1 needs no credentials.** It streams from Wikimedia EventStreams, a
public production SSE service, which exercises the parser against real network
chunking at volume:

```
✅ connected
   40 events in 2.3s, 50.5 kB
✅ 0 JSON errors — events reassembled correctly
✅ every event carried an id: field (resume works)
```

Zero JSON errors is the result that matters. Real TCP reads split events at
arbitrary points; a parser that assumes one chunk is one event fails here.

**Part 2 runs if a provider key is in the environment.** The key is read from
the environment and never printed:

```sh
OPENROUTER_API_KEY=sk-or-... npm run test:live    # free models available
ZHIPU_API_KEY=...            npm run test:live
GROQ_API_KEY=gsk_...         npm run test:live
OPENAI_API_KEY=sk-...        npm run test:live
```

Ollama running locally is detected automatically and tested over NDJSON.

It asserts the response arrives in **more than one chunk** — a single chunk
means the endpoint buffered rather than streamed, which is a real failure worth
catching.

## 3. React Native app

`App.tsx` is a chat screen with a typing effect and a working stop button.

```sh
npx create-expo-app ai-stream-example
cd ai-stream-example
npm install react-native-ai-stream
# replace App.tsx with the one from this folder
npx expo start
```

### ⚠️ Point it at your own backend

```ts
const OPENAI_PROXY = 'https://your-backend.example.com/api/chat';
```

**Never ship an API key inside a mobile app.** Anyone can extract it from the
bundle and spend your credits. Put a thin endpoint in front of it:

```js
// Express
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
  res.setHeader('Connection', 'keep-alive');

  // Pipe the upstream stream straight through.
  for await (const chunk of upstream.body) res.write(chunk);
  res.end();
});
```

The hook does not care what it is talking to, as long as the endpoint responds
with `text/event-stream`.
