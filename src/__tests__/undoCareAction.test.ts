import { describe, expect, it } from "vitest";
import { canUndoCareAction, undoNumericDelta, undoWetFoodDelta } from "../data/undoCareAction";

describe("care action undo", () => {
  it("subtracts only the original numeric action after another family member adds more", () => {
    expect(undoNumericDelta(2, 1)).toBe(1);
  });

  it("subtracts only the original wet-food amount after a concurrent update", () => {
    expect(undoWetFoodDelta(1, 10, 1)).toEqual({ cans: 0, canProgress: 10 });
  });

  it("reverses one partial wet-food check-in while retaining other progress", () => {
    expect(undoWetFoodDelta(1, 40, 0.1)).toEqual({ cans: 1, canProgress: 30 });
  });

  it("allows only the acting signed-in member to undo a cloud action", () => {
    expect(canUndoCareAction("member-a", "member-a")).toBe(true);
    expect(canUndoCareAction("member-a", "member-b")).toBe(false);
  });
});
