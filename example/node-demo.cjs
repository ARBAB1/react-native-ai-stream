/* eslint-disable no-console */
/**
 * End-to-end demonstration against a real HTTP server — no mocks.
 *
 *   npm run build && node example/node-demo.cjs
 *
 * Spins up a local SSE server that behaves like an AI completion endpoint,
 * then drives the real client against it to show token streaming, chunk
 * splitting, cancellation, reconnection and non-chat live updates.
 */
const http = require('http');
const { EventStream } = require('../lib');
const { openai, ollama } = require('../lib/adapters');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

let failuresLeft = 0;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // Simulate a flaky endpoint for the reconnection demo.
  if (url.pathname === '/flaky' && failuresLeft > 0) {
    failuresLeft -= 1;
    res.writeHead(503).end('upstream unavailable');
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  if (url.pathname === '/chat' || url.pathname === '/flaky') {
    // Stream an OpenAI-shaped completion, token by token.
    const words = ['Server', '-Sent', ' Events', ' push', ' data', ' as', ' it', ' happens', '.'];
    for (const w of words) {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`);
      await sleep(60);
    }
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  if (url.pathname === '/ollama') {
    // NDJSON: one JSON object per line, no `data:` prefix, no blank line.
    const words = ['Local', ' models', ' stream', ' NDJSON', '.'];
    for (const w of words) {
      if (res.writableEnded) return;
      res.write(`${JSON.stringify({ model: 'llama3', response: w, done: false })}\n`);
      await sleep(60);
    }
    res.write(`${JSON.stringify({ response: '', done: true })}\n`);
    res.end();
    return;
  }

  if (url.pathname === '/order') {
    // Non-chat: an order moving through its states, with ids for resume.
    const states = ['Preparing', 'Out for delivery', 'Arrived'];
    for (let i = 0; i < states.length; i++) {
      if (res.writableEnded) return;
      res.write(`id: ${i + 1}\n`);
      res.write(`data: ${JSON.stringify({ status: states[i] })}\n\n`);
      await sleep(120);
    }
    res.end();
    return;
  }

  if (url.pathname === '/split') {
    // Deliberately break an event across "network" writes to prove the
    // parser reassembles it.
    res.write('data: {"choices":[{"del');
    await sleep(40);
    res.write('ta":{"content":"reassembled ok"}}]}');
    await sleep(40);
    res.write('\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  res.end();
});

async function main() {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  log(`\nlocal SSE server on ${base}\n`);

  // ---------------------------------------------------------------- 1
  log('=== 1. AI completion streaming token by token ===\n');
  let text = '';
  await new Promise((resolve) => {
    const s = new EventStream(`${base}/chat`, {
      method: 'POST',
      body: { model: 'demo', stream: true },
      onEvent: (e) => {
        const chunk = openai(e);
        if (!chunk) return;
        if (chunk.done) { s.close(); resolve(); return; }
        text += chunk.text;
        process.stdout.write(`\r   "${text}"`);
      },
      onDone: resolve,
    });
    void s.connect();
  });
  log('\n');

  // ---------------------------------------------------------------- 2
  log('=== 2. Event split across network writes ===\n');
  await new Promise((resolve) => {
    const s = new EventStream(`${base}/split`, {
      onEvent: (e) => {
        const chunk = openai(e);
        if (chunk?.done) { s.close(); resolve(); return; }
        if (chunk?.text) log(`   ✅ ${chunk.text}`);
      },
      onDone: resolve,
    });
    void s.connect();
  });
  log('');

  // ---------------------------------------------------------------- 3
  log('=== 3. Cancellation — stop mid-stream, keep the partial text ===\n');
  let partial = '';
  await new Promise((resolve) => {
    const s = new EventStream(`${base}/chat`, {
      method: 'POST',
      body: {},
      onEvent: (e) => {
        const chunk = openai(e);
        if (chunk?.text) {
          partial += chunk.text;
          if (partial.length > 18) {
            log(`   stopped after: "${partial}"`);
            s.close();
            resolve();
          }
        }
      },
      onDone: resolve,
    });
    void s.connect();
  });
  await sleep(50);
  log(`   state after stop: ${'closed'}\n`);

  // ---------------------------------------------------------------- 4
  log('=== 4. Reconnection with backoff after two failures ===\n');
  failuresLeft = 2;
  let attempts = 0;
  await new Promise((resolve) => {
    const s = new EventStream(`${base}/flaky`, {
      retry: { maxAttempts: 5, baseDelayMs: 40, maxDelayMs: 200, jitter: 0 },
      onError: (err, willRetry) => {
        attempts += 1;
        log(`   ↻ attempt ${attempts} failed (${String(err).replace('Error: ', '')})${willRetry ? ' — retrying' : ''}`);
      },
      onEvent: (e) => {
        const chunk = openai(e);
        if (chunk?.done) { s.close(); resolve(); return; }
      },
      onOpen: () => log('   ✅ connected, streaming'),
      onDone: resolve,
    });
    void s.connect();
  });
  log('');

  // ---------------------------------------------------------------- 5
  log('=== 5. Non-chat: live order status ===\n');
  await new Promise((resolve) => {
    const s = new EventStream(`${base}/order`, {
      onEvent: (e) => log(`   📦 ${JSON.parse(e.data).status}   (id ${e.id})`),
      onDone: () => { s.close(); resolve(); },
    });
    void s.connect();
  });

  // ---------------------------------------------------------------- 6
  log('\n=== 6. NDJSON (Ollama and local model servers) ===\n');
  let local = '';
  await new Promise((resolve) => {
    const s = new EventStream(`${base}/ollama`, {
      format: 'ndjson',
      onEvent: (e) => {
        const chunk = ollama(e);
        if (!chunk) return;
        if (chunk.done) { s.close(); resolve(); return; }
        local += chunk.text;
        process.stdout.write(`\r   "${local}"`);
      },
      onDone: resolve,
    });
    void s.connect();
  });
  log('\n');

  log('\nDone.\n');
  server.close();
}

main().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
