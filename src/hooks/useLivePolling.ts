import { useEffect, useRef, useState } from "react";

/**
 * Generic polling hook. Calls `fetcher` every `intervalMs`.
 * - Uses setTimeout (not setInterval) to prevent overlap on slow networks.
 * - Pauses when the tab is hidden.
 * - Cancels in-flight on unmount via a cancellation flag.
 */
export function useLivePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  enabled: boolean = true,
): { data: T | null; error: Error | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!enabled) return;
    cancelledRef.current = false;

    const tick = async () => {
      if (cancelledRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        timeoutRef.current = setTimeout(tick, intervalMs);
        return;
      }
      try {
        const result = await fetcherRef.current();
        if (cancelledRef.current) return;
        setData(result);
        setError(null);
      } catch (e: unknown) {
        if (cancelledRef.current) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (cancelledRef.current) return;
        setLoading(false);
        timeoutRef.current = setTimeout(tick, intervalMs);
      }
    };

    tick();

    return () => {
      cancelledRef.current = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [intervalMs, enabled]);

  return { data, error, loading };
}
