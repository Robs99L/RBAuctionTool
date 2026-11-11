/** A fixed display window: continuous traffic never resets the deadline. */
export function createLiveEventBatcher<T>(apply: (events: T[]) => void, delay = 16) {
  let events: T[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function cancel() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    events = [];
  }
  function flush() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const pending = events;
    events = [];
    if (!disposed && pending.length) apply(pending);
  }
  return {
    push(event: T) {
      if (disposed) return;
      events.push(event);
      if (timer === null) timer = setTimeout(flush, delay);
    },
    flush, cancel,
    dispose() { disposed = true; cancel(); },
  };
}
