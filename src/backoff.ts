import type { RetryPolicy } from './types';

export const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 10,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  jitter: 0.3,
};

/**
 * Exponential backoff with jitter.
 *
 * Jitter matters more here than in most retry loops: when a server restarts it
 * drops every open stream at once, so without randomisation the entire client
 * fleet reconnects on the same schedule and knocks it over again.
 *
 * @param attempt 1-based attempt number that just failed.
 * @param serverRetryMs A `retry:` value from the server, which takes priority
 *   over the computed delay as the spec intends.
 */
export function computeBackoff(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY,
  serverRetryMs?: number,
  random: () => number = Math.random,
): number {
  const base =
    serverRetryMs !== undefined && serverRetryMs >= 0
      ? serverRetryMs
      : policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);

  const clamped = Math.min(base, policy.maxDelayMs);
  if (policy.jitter <= 0) return Math.round(clamped);

  const spread = clamped * policy.jitter;
  return Math.max(0, Math.round(clamped + (random() * 2 - 1) * spread));
}
