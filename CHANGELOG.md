# Changelog

## [0.1.0] - 2026-09-11

First release.

### Added
- `EventStream` — an SSE client built on `fetch`, so it supports POST with
  headers and a body. The browser's `EventSource` is GET-only, which rules it
  out for AI completion endpoints.
- Incremental wire-format parser handling events split across network chunks,
  multi-line data, comment keep-alives, CRLF, and the `id` and `retry` fields.
- Reconnection with exponential backoff and jitter, `Last-Event-ID` resume, and
  respect for a server-supplied `retry:` value.
- Cancellation through `AbortController`.
- `useEventStream` for live updates, `useChatStream` for AI chat.
- Adapters for OpenAI, Anthropic and plain text; custom adapters supported.
- 37 tests.
