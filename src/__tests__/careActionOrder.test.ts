import { describe, expect, it } from "vitest";
import { moveCareAction } from "../data/careActionOrder";

describe("care action ordering", () => {
  it("moves a dragged care action into the hovered position", () => {
    const actions = [{ key: "treats" }, { key: "kibble" }, { key: "water" }];

    expect(moveCareAction(actions, "treats", "kibble").map((action) => action.key)).toEqual(["kibble", "treats", "water"]);
    expect(moveCareAction(actions, "water", "treats").map((action) => action.key)).toEqual(["water", "treats", "kibble"]);
  });

  it("leaves the order untouched if either action is missing or is already in place", () => {
    const actions = [{ key: "treats" }, { key: "kibble" }];

    expect(moveCareAction(actions, "treats", "treats")).toBe(actions);
    expect(moveCareAction(actions, "missing", "kibble")).toBe(actions);
  });
});
