"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Booléen mémorisé dans le navigateur (confort personnel uniquement, jamais de donnée métier). */
const listeners = new Set<() => void>();

function read(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function usePersistedFlag(key: string) {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => read(key),
    () => false,
  );
  const set = useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        /* stockage indisponible : on ignore */
      }
      listeners.forEach((l) => l());
    },
    [key],
  );
  return [value, set] as const;
}
