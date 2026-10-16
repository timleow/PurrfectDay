export type DebouncedCallback = (() => void) & { cancel: () => void };

export function debounce(callback: () => void, delayMs: number): DebouncedCallback {
  let timer: number | undefined;
  const schedule = (() => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      callback();
    }, delayMs);
  }) as DebouncedCallback;
  schedule.cancel = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
  };
  return schedule;
}
