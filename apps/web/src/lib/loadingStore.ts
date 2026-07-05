/**
 * Tiny external store tracking the number of in-flight user-initiated requests.
 * The API client increments/decrements this at the fetch boundary; the global
 * LoadingOverlay subscribes via useSyncExternalStore. Kept outside React so the
 * plain client module can report loading without prop drilling.
 */
let activeCount = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function beginLoad(): void {
  activeCount += 1;
  emit();
}

export function endLoad(): void {
  activeCount = Math.max(0, activeCount - 1);
  emit();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while at least one tracked request is in flight. */
export function getSnapshot(): boolean {
  return activeCount > 0;
}
