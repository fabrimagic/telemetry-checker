/**
 * Tiny client-side cache wrapper around sessionStorage.
 * Used to avoid hammering the OpenF1 API on every mount/navigation
 * (e.g. the landing page session picker and championship summary card).
 *
 * - Storage: sessionStorage (per-tab, cleared on tab close).
 * - Format: JSON envelope `{ v: 1, ts: number, data: T }`.
 * - TTL: caller-supplied, in milliseconds.
 *
 * All operations are defensive: if storage is unavailable (SSR, privacy mode,
 * quota exceeded, JSON corruption) the helpers degrade silently to a miss
 * so the caller falls back to a network fetch.
 */

const VERSION = 1;

interface Envelope<T> {
  v: number;
  ts: number;
  data: T;
}

function getStore(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readCache<T>(key: string, ttlMs: number): T | null {
  const store = getStore();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope<T>;
    if (!env || env.v !== VERSION || typeof env.ts !== "number") return null;
    if (Date.now() - env.ts > ttlMs) {
      store.removeItem(key);
      return null;
    }
    return env.data;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, data: T): void {
  const store = getStore();
  if (!store) return;
  try {
    const env: Envelope<T> = { v: VERSION, ts: Date.now(), data };
    store.setItem(key, JSON.stringify(env));
  } catch {
    /* quota or serialization error: ignore */
  }
}

/** TTLs centralized so they're easy to tune. */
export const CACHE_TTL = {
  /** Session calendar changes only when a new weekend ends → 10 min is safe. */
  SESSIONS: 10 * 60 * 1000,
  /** Championship standings change once per race weekend → 10 min. */
  CHAMPIONSHIP: 10 * 60 * 1000,
  /** Driver roster per session is immutable post-session → 1 hour. */
  DRIVERS: 60 * 60 * 1000,
} as const;

export const CACHE_KEYS = {
  sessionsByYear: (year: number) => `pitwall:sessions:${year}`,
  championshipByYear: (year: number) => `pitwall:championship:${year}`,
  driversBySession: (sessionKey: number) => `pitwall:drivers:${sessionKey}`,
} as const;
