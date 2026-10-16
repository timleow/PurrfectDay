import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

vi.mock("../data/supabase", () => ({ supabase: null, isSupabaseConfigured: false }));
vi.mock("../data/familyService", () => ({
  addCat: vi.fn(),
  getCatPhotoUrl: vi.fn(),
  getMyFamily: vi.fn(),
  listCareEvents: vi.fn(),
  listCats: vi.fn(),
  listFamilyMembers: vi.fn(),
  listTargets: vi.fn(),
  recordCareEvent: vi.fn(),
  saveTarget: vi.fn(),
  uploadCatPhoto: vi.fn(),
  updateCat: vi.fn(),
  archiveCat: vi.fn(),
}));
vi.mock("../components/FamilyPortal", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <section aria-label="Family workspace mock">
      <h2>Family workspace</h2>
      <button onClick={onClose}>Back to tracking</button>
    </section>
  ),
}));

afterEach(() => cleanup());
beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset.theme = "";
});

function renderApp() {
  return render(<App />);
}

describe("tracking and family navigation", () => {
  it("provides Care, Cats, and Family tabs and opens each view", async () => {
    const user = userEvent.setup();
    renderApp();

    const navigation = screen.getByRole("navigation", { name: "Primary navigation" });
    const careTab = within(navigation).getByRole("button", { name: "Care" });
    const catsTab = within(navigation).getByRole("button", { name: "Cats" });
    const familyTab = within(navigation).getByRole("button", { name: "Family" });
    expect(careTab.getAttribute("aria-current")).toBe("page");

    await user.click(catsTab);
    expect(catsTab.getAttribute("aria-current")).toBe("page");
    expect(await screen.findByRole("heading", { name: "Your cats" })).not.toBeNull();

    await user.click(familyTab);
    expect(familyTab.getAttribute("aria-current")).toBe("page");
    expect(await screen.findByRole("heading", { name: "Family workspace" })).not.toBeNull();
    expect(navigation.closest(".app-shell")).toBeNull();
    expect(screen.getByRole("region", { name: "Family workspace mock" }).closest(".app-shell")).toBeNull();

    await user.click(within(navigation).getByRole("button", { name: "Care" }));
    expect(careTab.getAttribute("aria-current")).toBe("page");
  });

  it("keeps the theme toggle available from the main tracker", () => {
    renderApp();
    expect(screen.getAllByRole("button", { name: "Switch to dark mode" })).not.toHaveLength(0);
  });

  it("keeps the Cats view available after removing the last cat", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Cats" }));
    await user.click(screen.getAllByRole("button", { name: "Remove cat" })[0]);
    await user.click(screen.getByRole("button", { name: "Remove cat" }));
    expect(await screen.findByRole("heading", { name: "No cats yet" })).not.toBeNull();
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).not.toBeNull();
  });

  it("labels the new-cat photo picker simply", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getAllByRole("button", { name: "Add a cat" })[0]);
    expect(screen.getByText("Choose file!")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Add cat/ })).not.toBeNull();
    const css = readFileSync("src/index.css", "utf8");
    expect(css).toMatch(/\.cat-photo-upload-control input\s*\{[^}]*opacity:\s*0/s);
  });
});

describe("care tracking corrections", () => {
  it("keeps the Now tap to track number in a stable slot when its digit count changes", async () => {
    localStorage.setItem("purrfect-trackers", JSON.stringify({ "1": { treats: 9, treatsGoal: 10 } }));
    const user = userEvent.setup();
    const { container } = renderApp();
    const counter = container.querySelector(".big-tap-card .big-count");
    expect(counter?.textContent).toContain("9");

    await user.click(screen.getByRole("button", { name: "Add one treats" }));
    expect(container.querySelector(".big-tap-card .big-count")?.textContent).toContain("10");
    expect(container.querySelector(".big-tap-card .big-count")).toBe(counter);

    const css = readFileSync("src/index.css", "utf8");
    const counterStyles = css.match(/\.big-tap-card \.big-count\s*\{([^}]+)\}/)?.[1] ?? "";
    expect(counterStyles).toMatch(/height:\s*53px/);
    expect(counterStyles).toMatch(/width:\s*100%/);
    expect(counterStyles).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(counterStyles).toMatch(/white-space:\s*nowrap/);
  });

  it("keeps every count when taps arrive before React can repaint", async () => {
    const user = userEvent.setup();
    const { container } = renderApp();
    await user.click(within(container.querySelector(".mobile-item-grid")!).getByRole("button", { name: /Treats/ }));
    const tapButton = screen.getByRole("button", { name: "Add one treats" });

    act(() => {
      for (let tap = 0; tap < 10; tap += 1) fireEvent.click(tapButton);
    });

    expect(screen.getByText("10 / 4")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Who fed\?/ }).querySelector("span")?.textContent).toBe("10");
  });

  it("uses a prominent selected cat avatar", () => {
    const css = readFileSync("src/index.css", "utf8");
    expect(css).toMatch(/\.cat-avatar-large\s*\{\s*width:\s*96px;\s*height:\s*96px;/);
    expect(css).toMatch(/\.mobile-cat-picker button\.active \.cat-avatar\s*\{\s*width:\s*66px;\s*height:\s*66px;/);
  });

  it("undoes a +1 treat check-in", async () => {
    const user = userEvent.setup();
    const { container } = renderApp();
    const counter = container.querySelector(".big-tap-card .big-count");
    const mobileTiles = within(container.querySelector(".mobile-item-grid")!);
    await user.click(mobileTiles.getByRole("button", { name: /Treats/ }));
    await user.click(screen.getByRole("button", { name: "Add one treats" }));
    expect(screen.getByText("1 / 4")).not.toBeNull();
    const undoButton = screen.getByRole("button", { name: "Undo last +1" });
    expect(undoButton.classList.contains("tap-undo-icon")).toBe(true);
    expect(undoButton.closest(".big-tap-wrap")).not.toBeNull();
    expect(undoButton.textContent).toBe("");
    expect(screen.getByRole("button", { name: /Who fed\?/ }).querySelector("span")?.textContent).toBe("1");

    await user.click(screen.getByRole("button", { name: "Undo last +1" }));
    expect(screen.getByText("0 / 4")).not.toBeNull();
    expect(container.querySelector(".big-tap-card .big-count")).toBe(counter);
    expect(screen.getByRole("button", { name: /Who fed\?/ }).querySelector("span")?.textContent).toBe("0");
    await waitFor(() => {
      const savedLogs = JSON.parse(localStorage.getItem("purrfect-care-logs") ?? "[]") as Array<{ detail: string }>;
      expect(savedLogs.some((entry) => entry.detail === "Removed 1 treat")).toBe(true);
    });
  });

  it("undoes a wet-food 10% check-in and restores partial progress", async () => {
    const user = userEvent.setup();
    const { container } = renderApp();
    const mobileTiles = within(container.querySelector(".mobile-item-grid")!);
    await user.click(mobileTiles.getByRole("button", { name: /Wet food/ }));
    await user.click(screen.getByRole("button", { name: "Add one cans" }));
    expect(screen.getByText("10% of the next can")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Undo last wet food tap" }));
    expect(screen.getByText("0% of the next can")).not.toBeNull();
  });

  it("undoes a wet-food tap that completed a can and restores the prior 90%", async () => {
    const user = userEvent.setup();
    const { container } = renderApp();
    const mobileTiles = within(container.querySelector(".mobile-item-grid")!);
    await user.click(mobileTiles.getByRole("button", { name: /Wet food/ }));
    for (let tap = 0; tap < 9; tap += 1) {
      await user.click(screen.getByRole("button", { name: "Add one cans" }));
    }
    expect(screen.getByText("90% of the next can")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Add one cans" }));
    expect(container.querySelector(".wet-food-count strong")?.textContent).toContain("1 can");
    await user.click(screen.getByRole("button", { name: "Undo last wet food tap" }));
    expect(container.querySelector(".wet-food-count strong")?.textContent).toContain("0 cans");
    expect(screen.getByText("90% of the next can")).not.toBeNull();
  });

  it("shows the tracked wet-food amount in the Who fed count, not tap-entry count", async () => {
    const user = userEvent.setup();
    const { container } = renderApp();
    const mobileTiles = within(container.querySelector(".mobile-item-grid")!);
    await user.click(mobileTiles.getByRole("button", { name: /Wet food/ }));
    for (let tap = 0; tap < 5; tap += 1) await user.click(screen.getByRole("button", { name: "Add one cans" }));

    const whoFedButton = screen.getByRole("button", { name: /Who fed\?/ });
    expect(whoFedButton.querySelector("span")?.textContent).toBe("0.5");

    for (let tap = 0; tap < 5; tap += 1) await user.click(screen.getByRole("button", { name: "Add one cans" }));
    expect(whoFedButton.querySelector("span")?.textContent).toBe("1");
    await user.click(whoFedButton);
    expect(container.querySelector(".record-card-heading > span")?.textContent).toBe("1");
    expect(container.querySelectorAll(".record-card-list li")).toHaveLength(1);
    expect(container.querySelector(".record-card-list")?.textContent).toContain("Added 100% of a can");
  });

  it("keeps the goal editor open while typing and saves the chosen quantity", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getAllByRole("button", { name: /Edit goals|Quotas/ })[0]);
    const dialog = screen.getByRole("heading", { name: "Daily food quotas" }).parentElement!;
    const treatsGoal = within(dialog).getAllByRole("spinbutton")[0];

    await user.clear(treatsGoal);
    await user.type(treatsGoal, "6");
    expect(screen.getByRole("heading", { name: "Daily food quotas" })).not.toBeNull();
    expect((treatsGoal as HTMLInputElement).value).toBe("6");
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.getByText("0 / 6")).not.toBeNull();
  });
});
