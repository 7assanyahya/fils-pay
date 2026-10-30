import { TooManyRequestsError } from "../lib/errors.js";

/**
 * Per-account login throttle. Without it a password could be guessed
 * without limit, and once known each login minted a fresh 5-guess OTP
 * challenge, so the OTP cap bounded nothing across logins.
 *
 * In-memory and per process: the API runs as a single replica. A restart
 * resets the counters, which only ever errs towards letting a user in.
 */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILED_LOGINS = 10;
export const MAX_CHALLENGES = 20;
const MAX_TRACKED_KEYS = 50_000;

interface Window {
  failures: number[];
  challenges: number[];
}

export interface LoginThrottle {
  /** Throws 429 while the account has too many recent failed passwords. */
  assertCanAttempt(key: string): void;
  recordFailure(key: string): void;
  /** Throws 429 when the account has been issued too many challenges recently; otherwise records one. */
  recordChallenge(key: string): void;
}

export function createLoginThrottle(now: () => number = Date.now): LoginThrottle {
  const windows = new Map<string, Window>();

  function get(key: string): Window {
    const cutoff = now() - LOGIN_WINDOW_MS;
    let w = windows.get(key);
    if (!w) {
      if (windows.size >= MAX_TRACKED_KEYS) {
        // Drop the oldest-inserted keys; Map iterates in insertion order.
        for (const k of windows.keys()) {
          windows.delete(k);
          if (windows.size < MAX_TRACKED_KEYS / 2) break;
        }
      }
      w = { failures: [], challenges: [] };
      windows.set(key, w);
    }
    w.failures = w.failures.filter((t) => t > cutoff);
    w.challenges = w.challenges.filter((t) => t > cutoff);
    return w;
  }

  return {
    assertCanAttempt(key) {
      if (get(key).failures.length >= MAX_FAILED_LOGINS) {
        throw new TooManyRequestsError("too_many_login_attempts");
      }
    },
    recordFailure(key) {
      get(key).failures.push(now());
    },
    recordChallenge(key) {
      const w = get(key);
      if (w.challenges.length >= MAX_CHALLENGES) {
        throw new TooManyRequestsError("too_many_login_attempts");
      }
      w.challenges.push(now());
    },
  };
}
