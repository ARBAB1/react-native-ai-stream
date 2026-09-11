/* eslint-disable no-console */
/**
 * Verification against real endpoints — nothing mocked, nothing local.
 *
 *   npm run build
 *   node example/live-test.cjs
 *
 * Part 1 needs no credentials and always runs: Wikimedia EventStreams is a
 * public production SSE service, so it exercises the parser against real
 * network chunking at volume.
 *
 * Part 2 runs only if a provider key is present in the environment. The key is
 * read from the environment and never printed:
 *
 *   OPENROUTER_API_KEY=sk-or-... node example/live-test.cjs
 *   ZHIPU_API_KEY=...           node example/live-test.cjs
 *   OPENAI_API_KEY=sk-...       node example/live-test.cjs
 *   GROQ_API_KEY=gsk_...        node example/live-test.cjs
 *
 * With Ollama running locally it is picked up automatically.
 */
const { EventStream } = require('../lib');
const { openai, ollama } = require('../lib/adapters');

const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => console.log(`  ❌ ${m}`);

// ---------------------------------------------------------------------------
// Part 1 — public production SSE, no credentials
// ---------------------------------------------------------------------------

function wikimedia() {
  console.log('\n=== 1. Wikimedia EventStreams (public, no auth) ===\n');

  return new Promise((resolve) => {
    let count = 0;
    let bytes = 0;
    let withId = 0;
    let parseErrors = 0;
    const started = Date.now();

    const stream = new EventStream(
      'https://stream.wikimedia.org/v2/stream/recentchange',
      {
        onOpen: () => ok('connected'),
        onEvent: (e) => {
          count += 1;
          bytes += e.data.length;
          if (e.id) withId += 1;
          try {
            const j = JSON.parse(e.data);
            if (count <= 3) console.log(`     [${j.wiki}] ${String(j.title).slice(0, 44)}`);
          } catch {
            parseErrors += 1;
          }

          if (count === 40) {
            const secs = ((Date.now() - started) / 1000).toFixed(1);
            console.log(`\n     ${count} events in ${secs}s, ${(bytes / 1024).toFixed(1)} kB`);
            if (parseErrors === 0) ok('0 JSON errors — events reassembled correctly');
            else bad(`${parseErrors} JSON errors`);
            if (withId === count) ok('every event carried an id: field (resume works)');
            stream.close();
            resolve(parseErrors === 0);
          }
        },
        onError: (err, willRetry) => console.log(`  ↻ ${String(err)} (retry ${willRetry})`),
      },
    );

    void stream.connect();
    setTimeout(() => {
      stream.close();
      bad('timed out');
      resolve(false);
    }, 45_000);
  });
}

// ---------------------------------------------------------------------------
// Part 2 — a real AI provider, if a key is available
// ---------------------------------------------------------------------------

function pickProvider() {
  const e = process.env;

  if (e.OPENROUTER_API_KEY) {
    return {
      name: 'OpenRouter',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      headers: { Authorization: `Bearer ${e.OPENROUTER_API_KEY}` },
      // OpenRouter exposes free models under the :free suffix.
      model: e.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
      adapter: openai,
      format: 'sse',
    };
  }
  if (e.ZHIPU_API_KEY) {
    return {
      name: 'Zhipu (GLM)',
      url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      headers: { Authorization: `Bearer ${e.ZHIPU_API_KEY}` },
      model: e.ZHIPU_MODEL || 'glm-4-flash',
      adapter: openai, // OpenAI-compatible wire format
      format: 'sse',
    };
  }
  if (e.GROQ_API_KEY) {
    return {
      name: 'Groq',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      headers: { Authorization: `Bearer ${e.GROQ_API_KEY}` },
      model: e.GROQ_MODEL || 'llama-3.1-8b-instant',
      adapter: openai,
      format: 'sse',
    };
  }
  if (e.OPENAI_API_KEY || e.OPENAI_KEY) {
    return {
      name: 'OpenAI',
      url: 'https://api.openai.com/v1/chat/completions',
      headers: { Authorization: `Bearer ${e.OPENAI_API_KEY || e.OPENAI_KEY}` },
      model: e.OPENAI_MODEL || 'gpt-4o-mini',
      adapter: openai,
      format: 'sse',
    };
  }
  return null;
}

async function ollamaAvailable() {
  try {
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function streamCompletion(p) {
  console.log(`\n=== 2. ${p.name} — live completion ===\n`);
  console.log(`     model: ${p.model}\n`);

  return new Promise((resolve) => {
    let text = '';
    let chunks = 0;
    const started = Date.now();

    const stream = new EventStream(p.url, {
      method: 'POST',
      headers: p.headers,
      format: p.format,
      body: p.body || {
        model: p.model,
        stream: true,
        messages: [
          { role: 'user', content: 'Say "streaming works" and nothing else.' },
        ],
      },
      retry: { maxAttempts: 0 },
      onEvent: (e) => {
        const chunk = p.adapter(e);
        if (!chunk) return;
        if (chunk.done) {
          stream.close();
          finish();
          return;
        }
        if (chunk.text) {
          chunks += 1;
          text += chunk.text;
          process.stdout.write(`\r     "${text.replace(/\n/g, ' ')}"`);
        }
      },
      onDone: finish,
      onError: (err) => {
        bad(`${String(err)}`);
        resolve(false);
      },
    });

    function finish() {
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`\n`);
      if (chunks > 1) {
        ok(`streamed in ${chunks} chunks over ${secs}s — genuinely incremental`);
        resolve(true);
      } else if (chunks === 1) {
        bad('arrived as a single chunk — the response was buffered, not streamed');
        resolve(false);
      } else {
        bad('no text received — check the model name and the adapter');
        resolve(false);
      }
    }

    void stream.connect();
  });
}

async function main() {
  const results = [];
  results.push(await wikimedia());

  const provider = pickProvider();
  if (provider) {
    results.push(await streamCompletion(provider));
  } else if (await ollamaAvailable()) {
    results.push(
      await streamCompletion({
        name: 'Ollama (local)',
        url: 'http://localhost:11434/api/chat',
        headers: {},
        model: process.env.OLLAMA_MODEL || 'llama3',
        adapter: ollama,
        format: 'ndjson',
        body: {
          model: process.env.OLLAMA_MODEL || 'llama3',
          stream: true,
          messages: [{ role: 'user', content: 'Say "streaming works".' }],
        },
      }),
    );
  } else {
    console.log('\n=== 2. AI provider — skipped ===\n');
    console.log('     No provider key found. Set one and re-run:\n');
    console.log('       OPENROUTER_API_KEY=... node example/live-test.cjs');
    console.log('       ZHIPU_API_KEY=...      node example/live-test.cjs');
    console.log('       GROQ_API_KEY=...       node example/live-test.cjs\n');
    console.log('     Or start Ollama locally and it is detected automatically.');
  }

  const passed = results.every(Boolean);
  console.log(`\n${passed ? '✅ all checks passed' : '❌ some checks failed'}\n`);
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
