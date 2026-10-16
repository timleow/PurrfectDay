import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import CatsOverview from "../components/CatsOverview";

afterEach(() => cleanup());

describe("Cats overview", () => {
  const cats = [{ id: "cat-1", name: "Mochi", color: "#d494b7", initial: "M" }];
  const summaries = { "cat-1": { treats: 2, treatsGoal: 4, kibble: 1, kibbleGoal: 3, cans: 1, cansGoal: 1, played: 2, ears: true } };

  it("summarizes a cat's care and offers profile actions", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn().mockResolvedValue(undefined);
    const onSelect = vi.fn();
    render(<CatsOverview cats={cats} summaries={summaries} selectedId="cat-1" onSelect={onSelect} onAdd={vi.fn()} onPhoto={vi.fn()} onRename={onRename} onRemove={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Your cats" })).not.toBeNull();
    expect(screen.getByText("2 / 4")).not.toBeNull();
    expect(screen.getByText("Done this week")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Track care for Mochi" }));
    expect(onSelect).toHaveBeenCalledWith("cat-1");
    await user.click(screen.getByRole("button", { name: "Edit name" }));
    const input = screen.getByRole("textbox", { name: "Name for Mochi" });
    await user.clear(input);
    await user.type(input, "Miso");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect(onRename).toHaveBeenCalledWith(cats[0], "Miso");
  });

  it("makes the add-cat action clear when the family has no cats", () => {
    const onAdd = vi.fn();
    render(<CatsOverview cats={[]} summaries={{}} selectedId="" onSelect={vi.fn()} onAdd={onAdd} onPhoto={vi.fn()} onRename={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "No cats yet" })).not.toBeNull();
    expect(screen.getAllByRole("button", { name: /Add a cat/ })).not.toHaveLength(0);
  });
});
