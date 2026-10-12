"use client";
import { useSyncExternalStore } from "react";

/**
 * A shared, ticking clock for "is this still fresh?" style render logic.
 * Reading `Date.now()` during render is impure; this exposes the current time
 * as an external store that re-renders subscribers every `TICK_MS`.
 */
const TICK_MS = 15_000;
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const snapshot = () => now;

/** Current epoch ms, refreshed every 15 s. Pass `bucketMs` to coarsen it (stable query keys). */
export function useNow(bucketMs = 1): number {
  const t = useSyncExternalStore(subscribe, snapshot, snapshot);
  return bucketMs > 1 ? Math.floor(t / bucketMs) * bucketMs : t;
}
