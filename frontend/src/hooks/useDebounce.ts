import { useCallback, useEffect, useRef, useState } from "react";
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants";

/**
 * Returns `value` after it has stopped changing for `delay` ms. Used for search
 * boxes so the query key (and therefore the request) only changes once the user
 * pauses typing.
 */
export function useDebounce<T>(value: T, delay: number = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

/**
 * Debounces a callback. The returned function keeps a stable identity, so it is
 * safe in dependency arrays and as an event handler prop.
 */
export function useDebouncedCallback<A extends unknown[]>(
  callback: (...args: A) => void,
  delay: number = SEARCH_DEBOUNCE_MS,
): ((...args: A) => void) & { cancel: () => void } {
  const timerRef = useRef<number | null>(null);
  // Latest-callback ref keeps the debounced function stable without going stale.
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  const debounced = useCallback(
    (...args: A) => {
      cancel();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        callbackRef.current(...args);
      }, delay);
    },
    [cancel, delay],
  );

  return Object.assign(debounced, { cancel });
}
