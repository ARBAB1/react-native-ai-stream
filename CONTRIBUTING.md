# Contributing

Contributions are welcome — bug reports, documentation fixes and pull requests
alike. You do not need to ask permission before opening an issue or a PR.

## Getting set up

```sh
git clone https://github.com/ARBAB1/react-native-ai-stream.git
cd react-native-ai-stream
npm install
npm test
```

That should give you 53 passing tests. If it does not, open an issue — a broken
setup is a bug in its own right.

## Checks to run before opening a PR

```sh
npm test          # unit tests
npm run typecheck # no type errors
npm run build     # emits lib/ and the .d.ts files
npm run demo      # end-to-end against a local SSE server
```

CI runs all four on Node 18, 20 and 22.

If you are changing the client or a parser, also run the live test — it streams
from a real public endpoint and catches things a mock cannot:

```sh
npm run test:live
```

## What is most useful

**More provider adapters.** Gemini, Cohere, Bedrock, or whatever you use. An
adapter is a few lines — see [`src/adapters/index.ts`](./src/adapters/index.ts).
Please include a test with a real chunk from that provider.

**Parser edge cases.** If you have hit a stream this library mishandles, a
failing test is the most valuable thing you can send. Two of the existing tests
were written before the fix and caught real bugs.

**Platform reports.** "This works / does not work on RN 0.xx with the New
Architecture" is genuinely useful — the fetch streaming behaviour varies.

**Documentation.** If something in the [guide](./docs/GUIDE.md) did not make
sense, that is a bug. Say so, or fix it.

## Project layout

```
src/
  client.ts        EventStream — transport, reconnection, cancellation
  parser.ts        SSE wire-format parser
  ndjson.ts        NDJSON parser
  backoff.ts       exponential backoff with jitter
  react.ts         useEventStream, useChatStream
  adapters/        provider chunk formats
example/
  node-demo.cjs    end-to-end against a local server
  live-test.cjs    against real endpoints
  App.tsx          Expo chat screen
```

## Conventions

- **TypeScript, strict mode.** No `any` without a comment explaining why.
- **No runtime dependencies.** This is deliberate — the package installs into
  mobile apps where every kilobyte and every transitive dependency is a cost.
  A PR adding one needs a strong argument.
- **Tests for behaviour, not implementation.** Test what a caller observes.
- **Comments explain why, not what.** The code says what it does.

## Adding an adapter

```ts
export const yourProvider: ChunkAdapter = (event) => {
  if (event.data === '[DONE]') return { done: true };   // end marker
  const json = parse(event);
  const text = json?.your?.path?.to?.text;
  return text ? { text } : null;                        // null = ignore chunk
};
```

Register it in `adapters`, add it to the `AdapterName` union, and write a test
using a genuine chunk from that provider's docs.

## Reporting a bug

The fastest fix comes from a report that includes:

- The endpoint's `Content-Type` (`text/event-stream` or `application/x-ndjson`)
- A few raw lines from the stream — `curl -N <url>` — with any key redacted
- React Native and library versions
- What you expected, and what happened

⚠️ **Redact API keys** before pasting anything from a request.

## Releases

Maintainer only:

```sh
npm version patch|minor|patch
npm publish --access public
git push origin main --tags
```

## Licence

By contributing you agree your work is licensed under the
[MIT Licence](./LICENSE).
