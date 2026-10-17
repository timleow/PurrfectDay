import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

const photoMocks = vi.hoisted(() => ({
  blobToDataUrl: vi.fn(async () => "data:image/jpeg;base64,preview"),
  compressCatPhoto: vi.fn(async () => new Blob(["compressed"], { type: "image/jpeg" })),
  cropCatPhoto: vi.fn(async () => "data:image/jpeg;base64,cropped"),
}));

vi.mock("../data/catPhoto", () => photoMocks);

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
  localStorage.setItem("purrfect-cats", JSON.stringify([
    { id: 1, name: "Mochi", color: "#F2A07B", initial: "M" },
    { id: 2, name: "Bean", color: "#91A8D4", initial: "B" },
  ]));
  document.documentElement.dataset.theme = "";
});

function renderApp() {
  return render(<App />);
}

async function chooseTrackingMode(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(screen.getByRole("button", { name: "Care Menu" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name }));
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

  it("opens tracking choices in a dialog and switches to the selected metric", async () => {
    const user = userEvent.setup();
    renderApp();
    expect(screen.queryByText("Quick update")).toBeNull();
    expect(screen.queryByText("Change what you’re tracking")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Care Menu" }));
    const dialog = screen.getByRole("dialog", { name: "What would you like to track?" });
    expect(within(dialog).getAllByRole("button")).toHaveLength(10);
    await user.click(within(dialog).getByRole("button", { name: /Play/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Add one session" })).not.toBeNull();
  });

  it("switches tracking modes in either direction, wraps around, and never records a swipe as a tap", () => {
    const { container } = renderApp();
    const tapCard = screen.getByRole("button", { name: "Add one treats" });
    const tapArea = container.querySelector(".big-tap-wrap")!;
    const swipe = (fromX: number, toX: number) => {
      fireEvent.pointerDown(tapArea, { pointerType: "touch", clientX: fromX, clientY: 120 });
      fireEvent.pointerUp(tapArea, { pointerType: "touch", clientX: toX, clientY: 124 });
    };
    swipe(220, 130);
    expect(screen.getByRole("button", { name: "Add one spoons" })).not.toBeNull();
    expect(container.querySelector(".big-tap-card")?.classList.contains("mode-swipe-next")).toBe(true);
    swipe(130, 220);
    expect(screen.getByRole("button", { name: "Add one treats" })).not.toBeNull();
    expect(container.querySelector(".big-tap-card")?.classList.contains("mode-swipe-previous")).toBe(true);
    swipe(130, 220);
    expect(screen.getByRole("button", { name: "Add one session" })).not.toBeNull();
    expect(localStorage.getItem("purrfect-care-logs")).toBe("[]");
    expect(tapCard).toBeTruthy();
  });

  it("starts with no demo cats and offers family setup or an invitation path", async () => {
    localStorage.removeItem("purrfect-cats");
    const user = userEvent.setup();
    renderApp();
    const catsTab = screen.getByRole("button", { name: "Cats" });
    await user.click(catsTab);
    expect(await screen.findByRole("heading", { name: "Your cats start with family" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Create a family" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "I was invited to a family" }));
    expect(await screen.findByRole("heading", { name: "Family workspace" })).not.toBeNull();
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
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove cat" }));
    await user.click(screen.getByRole("button", { name: "Remove cat" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove cat" }));
    expect(await screen.findByRole("heading", { name: "Your cats start with family" })).not.toBeNull();
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

  it("previews, zooms, and saves the chosen circular photo crop before adding a cat", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getAllByRole("button", { name: "Add a cat" })[0]);
    await user.type(screen.getByRole("textbox", { name: "Cat’s name" }), "Miso");
    await user.upload(screen.getByLabelText("Choose file!"), new File(["photo"], "miso.png", { type: "image/png" }));
    expect(await screen.findByRole("group", { name: /circular crop preview/i })).not.toBeNull();
    const zoom = screen.getByRole("slider", { name: "Zoom photo" });
    fireEvent.change(zoom, { target: { value: "2" } });
    await user.click(screen.getByRole("button", { name: "Add cat" }));
    expect(photoMocks.cropCatPhoto).toHaveBeenCalledWith("data:image/jpeg;base64,preview", { x: 50, y: 50, zoom: 2 });
    expect(screen.getByRole("button", { name: "Track care for Miso" })).not.toBeNull();
  });

  it("opens the same zoom and crop editor when changing an existing cat photo", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Cats" }));
    const photoInput = screen.getAllByText("Add photo")[0].closest("label")?.querySelector("input")!;
    await user.upload(photoInput, new File(["photo"], "mochi.png", { type: "image/png" }));

    expect(await screen.findByRole("dialog", { name: "Change Mochi’s photo" })).not.toBeNull();
    fireEvent.change(screen.getByRole("slider", { name: "Zoom photo" }), { target: { value: "2" } });
    fireEvent.change(screen.getByRole("slider", { name: "Horizontal photo crop" }), { target: { value: "70" } });
    await user.click(screen.getByRole("button", { name: "Save photo" }));

    expect(photoMocks.cropCatPhoto).toHaveBeenCalledWith("data:image/jpeg;base64,preview", { x: 70, y: 50, zoom: 2 });
    expect(screen.getAllByAltText("Mochi").every((image) => image.getAttribute("src") === "data:image/jpeg;base64,cropped")).toBe(true);
  });

  it("cancels out added care entries that were undone from the visible activity", async () => {
    const now = new Date();
    localStorage.setItem("purrfect-care-logs", JSON.stringify([
      { id: "add-a", catId: 1, metric: "treats", actorUserId: "person-a", who: "Alex", what: "Dental treats", detail: "Added 1 treat", timestamp: now.toISOString(), amountDelta: 1 },
      { id: "undo-a", catId: 1, metric: "treats", actorUserId: "person-a", who: "Alex", what: "Dental treats", detail: "Removed 1 treat", timestamp: new Date(now.getTime() + 1000).toISOString(), amountDelta: -1 },
      { id: "add-b", catId: 1, metric: "treats", actorUserId: "person-b", who: "Sam", what: "Dental treats", detail: "Added 1 treat", timestamp: new Date(now.getTime() + 2000).toISOString(), amountDelta: 1 },
      { id: "undo-b", catId: 1, metric: "treats", actorUserId: "person-b", who: "Sam", what: "Dental treats", detail: "Removed 1 treat", timestamp: new Date(now.getTime() + 3000).toISOString(), amountDelta: -1 },
    ]));
    const user = userEvent.setup();
    renderApp();
    await chooseTrackingMode(user, /Treats/);
    await user.click(screen.getAllByRole("button", { name: /Care log/ })[0]);
    expect((await screen.findAllByText(/No care entries for today/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/by Alex/)).toBeNull();
    expect(screen.queryByText(/by Sam/)).toBeNull();
  });

  it("keeps a later treat separate from a feeding that started within the prior five-minute window", async () => {
    const morning = new Date();
    morning.setHours(8, 0, 0, 0);
    const addLog = (id: string, minutesAfterStart: number) => ({
      id,
      catId: 1,
      metric: "treats",
      actorUserId: "person-a",
      who: "Alex",
      what: "Dental treats",
      detail: "Added 1 treat",
      timestamp: new Date(morning.getTime() + minutesAfterStart * 60_000).toISOString(),
      amountDelta: 1,
    });
    localStorage.setItem("purrfect-care-logs", JSON.stringify([
      addLog("morning-1", 0),
      addLog("morning-2", 1),
      addLog("morning-3", 2),
      addLog("morning-4", 4.5),
      addLog("later", 8.5),
    ]));

    const user = userEvent.setup();
    const { container } = renderApp();
    await chooseTrackingMode(user, /Treats/);
    await user.click(screen.getAllByRole("button", { name: /Care log/ })[0]);

    const activityLog = within(container.querySelector(".activity-log-list")!);
    expect(activityLog.getByText("+4 · by Alex")).not.toBeNull();
    expect(activityLog.getByText("+1 treat · by Alex")).not.toBeNull();
  });

  it("shows today's date picker and changes to By day when another date is chosen", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getAllByRole("button", { name: /Care log/ })[0]);
    expect((screen.getAllByLabelText("Choose a date")[0] as HTMLInputElement).value).toBe(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`);
    await user.click(screen.getAllByRole("button", { name: "Previous day" })[0]);
    expect(screen.getAllByRole("button", { name: "By day" })[0].getAttribute("aria-pressed")).toBe("true");
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
    await chooseTrackingMode(user, /Treats/);
    const tapButton = screen.getByRole("button", { name: "Add one treats" });

    act(() => {
      for (let tap = 0; tap < 10; tap += 1) fireEvent.click(tapButton);
    });

    expect(container.querySelector(".big-tap-card .big-count")?.textContent).toContain("10");
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
    await chooseTrackingMode(user, /Treats/);
    await user.click(screen.getByRole("button", { name: "Add one treats" }));
    expect(counter?.textContent).toContain("1");
    expect(counter?.textContent).toContain("/ 4");
    const undoButton = screen.getByRole("button", { name: "Undo last +1" });
    expect(undoButton.classList.contains("tap-undo-icon")).toBe(true);
    expect(undoButton.closest(".big-tap-wrap")).not.toBeNull();
    expect(undoButton.textContent).toBe("");
    expect(screen.getByRole("button", { name: /Who fed\?/ }).querySelector("span")?.textContent).toBe("1");

    await user.click(screen.getByRole("button", { name: "Undo last +1" }));
    expect(counter?.textContent).toContain("0");
    expect(counter?.textContent).toContain("/ 4");
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
    await chooseTrackingMode(user, /Wet food/);
    await user.click(screen.getByRole("button", { name: "Add one cans" }));
    expect(screen.getByText("10% of the next can")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Undo last wet food tap" }));
    expect(screen.getByText("0% of the next can")).not.toBeNull();
  });

  it("undoes a wet-food tap that completed a can and restores the prior 90%", async () => {
    const user = userEvent.setup();
    const { container } = renderApp();
    await chooseTrackingMode(user, /Wet food/);
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
    await chooseTrackingMode(user, /Wet food/);
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
    const { container } = renderApp();
    await user.click(screen.getAllByRole("button", { name: /Edit goals|Quotas/ })[0]);
    const dialog = screen.getByRole("heading", { name: "Daily food quotas" }).parentElement!;
    const treatsGoal = within(dialog).getAllByRole("spinbutton")[0];

    await user.clear(treatsGoal);
    await user.type(treatsGoal, "6");
    expect(screen.getByRole("heading", { name: "Daily food quotas" })).not.toBeNull();
    expect((treatsGoal as HTMLInputElement).value).toBe("6");
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(container.querySelector(".big-tap-card .big-count")?.textContent).toContain("/ 6");
  });
});
