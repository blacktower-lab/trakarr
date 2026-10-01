import { useCallback, useEffect, useRef, useState } from "react";

interface Poll<T> {
  data: T | undefined;
  // Why the last load failed. The data of the last good one stays.
  error: Error | undefined;
  refresh: () => void;
}

// Loads on mount and, if `every` gives a delay, again that many ms after each
// load ends, so a slow one never overlaps the next. `every` gets the last data,
// since the delay can come from it, and null stops the polling: a one-off load.
export function usePoll<T>(
  load: () => Promise<T>,
  every: number | null | ((last: T | undefined) => number | null),
): Poll<T> {
  const [state, setState] = useState<{ data: T | undefined; error: Error | undefined }>({ data: undefined, error: undefined });
  // Read when a load ends, so they don't restart the loop when they change.
  const loadRef = useRef(load);
  const everyRef = useRef(every);
  loadRef.current = load;
  everyRef.current = every;
  const start = useRef<() => void>(() => {});

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let last: T | undefined;
    let latest = 0;

    async function run() {
      window.clearTimeout(timer);
      // A response that arrives after a newer load began is dropped.
      const mine = ++latest;
      try {
        last = await loadRef.current();
        if (active && mine === latest) setState({ data: last, error: undefined });
      } catch (error) {
        if (active && mine === latest) setState({ data: last, error: error as Error });
      }
      if (!active || mine !== latest) return;
      const next = typeof everyRef.current === "function" ? everyRef.current(last) : everyRef.current;
      if (next !== null) timer = window.setTimeout(run, next);
    }

    start.current = () => void run();
    void run();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  const refresh = useCallback(() => start.current(), []);
  return { ...state, refresh };
}
