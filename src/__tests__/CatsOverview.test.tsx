import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import CatsOverview from "../components/CatsOverview";

afterEach(() => cleanup());

describe("Cats overview", () => {
  const cats = [{ id: "cat-1", name: "Mochi", color: "#d494b7", initial: "M" }];

  it("keeps cat management compact and offers care and profile actions", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onSelect = vi.fn();
    render(<CatsOverview cats={cats} selectedId="cat-1" onSelect={onSelect} onAdd={vi.fn()} onEdit={onEdit} onRemove={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Your cats" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Mochi cat" })).not.toBeNull();
    expect(screen.queryByText("Today’s care")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Track care for Mochi" }));
    expect(onSelect).toHaveBeenCalledWith("cat-1");
    await user.click(screen.getByRole("link", { name: "Mochi cat" }));
    expect(onSelect).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "Edit cat" }));
    expect(onEdit).toHaveBeenCalledWith("cat-1");
    expect(screen.getByRole("button", { name: "Remove cat" })).not.toBeNull();
  });

  it("makes the add-cat action clear when the family has no cats", () => {
    const onAdd = vi.fn();
    render(<CatsOverview cats={[]} familyName="Lee family" selectedId="" onSelect={vi.fn()} onAdd={onAdd} onEdit={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "No cats yet" })).not.toBeNull();
    expect(screen.getAllByRole("button", { name: /Add a cat/ })).not.toHaveLength(0);
  });

  it("offers family creation or invite refresh when the user has no family", () => {
    const onManageFamily = vi.fn();
    render(<CatsOverview cats={[]} selectedId="" onSelect={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onRemove={vi.fn()} onManageFamily={onManageFamily} />);
    expect(screen.getByRole("heading", { name: "Your cats start with family" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Add a cat/ })).toBeNull();
    screen.getByRole("button", { name: "I was invited to a family" }).click();
    expect(onManageFamily).toHaveBeenCalledOnce();
  });

  it("styles the icon actions vertically centered in each cat card", () => {
    const css = readFileSync("src/components/CatsOverview.css", "utf8");
    expect(css).toMatch(/\.cat-summary-action\s*\{[^}]*align-items:\s*center/s);
    expect(css).toMatch(/\.cat-summary-action svg\s*\{/);
  });
});
