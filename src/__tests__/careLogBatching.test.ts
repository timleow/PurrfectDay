import { describe, expect, it } from "vitest";
import { batchCareLogs, removeUndoneCareLogs, type CareLog } from "../data/careLogBatching";

function log(id: string, catId: string, minute: number, amountDelta: number, reversesEventId?: string): CareLog {
  return {
    id,
    catId,
    metric: "treats",
    actorUserId: "person-a",
    who: "Alex",
    what: "Dental treats",
    detail: amountDelta < 0
      ? `Removed ${Math.abs(amountDelta)} treats`
      : `Added ${amountDelta} ${Math.abs(amountDelta) === 1 ? "treat" : "treats"}`,
    timestamp: new Date(Date.UTC(2026, 0, 1, 12, 0) + minute * 60_000).toISOString(),
    amountDelta,
    reversesEventId,
  };
}

describe("care log batching", () => {
  it("cancels the latest matching event first and excludes the undo record", () => {
    const visible = removeUndoneCareLogs([
      log("first", "cat-a", 0, 2),
      log("second", "cat-a", 2, 1),
      log("undo-second", "cat-a", 3, -1, "second"),
    ]);

    expect(visible.map((entry) => entry.id)).toEqual(["first"]);
    expect(batchCareLogs(visible)).toHaveLength(1);
    expect(batchCareLogs(visible)[0].detail).toBe("Added 2 treats");
  });

  it("links a later undo to its exact event instead of canceling the earliest matching action", () => {
    const visible = removeUndoneCareLogs([
      log("morning", "cat-a", 0, 1),
      log("later-add", "cat-a", 120, 1),
      log("later-undo", "cat-a", 121, -1, "later-add"),
    ]);

    expect(visible.map((entry) => entry.id)).toEqual(["morning"]);
    expect(batchCareLogs(visible).map((entry) => entry.detail)).toEqual(["Added 1 treat"]);
  });

  it("does not let an old unlinked reversal cancel a care action", () => {
    const visible = removeUndoneCareLogs([
      log("morning", "cat-a", 0, 1),
      log("stale-undo", "cat-a", 120, -1),
    ]);

    expect(visible.map((entry) => entry.id)).toEqual(["morning"]);
  });

  it("anchors each five-minute batch at its earliest event and never crosses cats", () => {
    const visible = removeUndoneCareLogs([
      log("anchor", "cat-a", 0, 1),
      log("inside-window", "cat-a", 4, 1),
      log("outside-window", "cat-a", 5.01, 1),
      log("other-cat", "cat-b", 2, 1),
    ]);
    const batches = batchCareLogs(visible);

    expect(batches).toHaveLength(3);
    expect(batches.find((entry) => entry.id === "anchor")).toMatchObject({ detail: "Added 2 treats", batchCount: 2 });
    expect(batches.find((entry) => entry.id === "outside-window")?.detail).toBe("Added 1 treat");
    expect(batches.find((entry) => entry.id === "other-cat")?.detail).toBe("Added 1 treat");
  });
});
