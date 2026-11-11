/** Coalesce a burst without postponing it indefinitely or overlapping requests. */
export function createRefreshScheduler(refresh: () => Promise<void>, delay = 250) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let dirty = false;
  let disposed = false;

  function request(immediate = false) {
    if (disposed) return;
    dirty = true;
    if (running) return;
    if (timer !== null) {
      if (!immediate) return;
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      dirty = false;
      running = true;
      void refresh().catch(() => undefined).finally(() => {
        running = false;
        if (dirty) request();
      });
    }, immediate ? 0 : delay);
  }

  function cancel() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    dirty = false;
  }

  return { request, cancel, dispose() { disposed = true; cancel(); } };
}
