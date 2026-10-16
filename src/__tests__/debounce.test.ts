import { afterEach, describe, expect, it, vi } from "vitest";
import { debounce } from "../data/debounce";

afterEach(() => vi.useRealTimers());

describe("Realtime refresh debounce", () => {
  it("coalesces bursts into one refresh after changes settle", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const scheduleRefresh = debounce(refresh, 400);

    scheduleRefresh();
    vi.advanceTimersByTime(250);
    scheduleRefresh();
    vi.advanceTimersByTime(399);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending refresh when its subscription is removed", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const scheduleRefresh = debounce(refresh, 400);

    scheduleRefresh();
    scheduleRefresh.cancel();
    vi.advanceTimersByTime(400);
    expect(refresh).not.toHaveBeenCalled();
  });
});
