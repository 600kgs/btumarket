import { useEffect, useRef } from "react";

// Runs `callback` immediately and then every `ms` while the tab is visible.
// Pauses while the tab is hidden and catches up immediately on refocus,
// instead of ticking in the background - a background tab polling on a
// fixed interval never lets Neon's compute instance auto-suspend, so it
// bills as if it were under constant load even with nobody looking at it.
export function usePolling(callback: () => void, ms: number, enabled = true) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;

    let id: number | null = null;
    function start() {
      if (id !== null) return;
      callbackRef.current();
      id = window.setInterval(() => callbackRef.current(), ms);
    }
    function stop() {
      if (id === null) return;
      window.clearInterval(id);
      id = null;
    }
    function onVisibility() {
      if (document.hidden) stop();
      else start();
    }

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ms, enabled]);
}
