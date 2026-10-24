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
    expect(await screen.findByRole("heading", { name: "Cats" })).not.toBeNull();

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
    const dialog = screen.getByRole("dialog", { name: "Care tracker" });
    expect(within(dialog).getAllByRole("button")).toHaveLength(12);
    await user.click(within(dialog).getByRole("button", { name: /Play/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Tap to add one" })).not.toBeNull();
    expect(screen.getByRole("group", { name: "Playtime tracker" })).not.toBeNull();
  });

  it("places poop and pee at the lower-right of the menu and tracks them as unmetered counters", async () => {
    localStorage.setItem("purrfect-trackers", JSON.stringify({ "1": { pooped: true, peed: false } }));
    const user = userEvent.setup();
    const { container } = renderApp();
    await user.click(screen.getByRole("button", { name: "Care Menu" }));
    const menu = screen.getByRole("dialog", { name: "Care tracker" });
    const tiles = Array.from(menu.querySelectorAll(".care-action-tile-wrap"));
    expect(tiles.slice(-2).map((tile) => tile.textContent?.trim())).toEqual(["Poop", "Pee"]);

    await user.click(screen.getByRole("button", { name: "Poop" }));
    expect(screen.getByRole("group", { name: "Pooped today tracker" })).not.toBeNull();
    expect(container.querySelector(".big-tap-card .big-count")?.textContent).toContain("1");
    expect(container.querySelector(".big-tap-card .big-goal-progress")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Tap to add one" }));
    expect(container.querySelector(".big-tap-card .big-count")?.textContent).toContain("2");
    expect(screen.getByRole("button", { name: /Who saw\?/ }).querySelector("span")?.textContent).toBe("2");
  });

  it("switches tracking modes in either direction, wraps around, and never records a swipe as a tap", async () => {
    const { container } = renderApp();
    const tapCard = screen.getByRole("group", { name: "Dental treats tracker" });
    const tapArea = container.querySelector(".big-tap-wrap")!;
    const swipe = (fromX: number, toX: number) => {
      fireEvent.pointerDown(tapArea, { pointerType: "touch", clientX: fromX, clientY: 120 });
      fireEvent.pointerUp(tapArea, { pointerType: "touch", clientX: toX, clientY: 124 });
    };
    swipe(220, 130);
    expect(screen.getByRole("group", { name: "Spoons of kibble tracker" })).not.toBeNull();
    expect(container.querySelector(".big-tap-card")?.classList.contains("mode-swipe-next")).toBe(true);
    swipe(130, 220);
    expect(screen.getByRole("group", { name: "Dental treats tracker" })).not.toBeNull();
    expect(container.querySelector(".big-tap-card")?.classList.contains("mode-swipe-previous")).toBe(true);
    swipe(130, 220);
    expect(screen.getByRole("group", { name: "Peed today tracker" })).not.toBeNull();
    expect(localStorage.getItem("purrfect-care-logs")).toBe("[]");
    expect(tapCard).toBeTruthy();
    const peeCard = screen.getByRole("group", { name: "Peed today tracker" });
    fireEvent.click(peeCard);
    expect(localStorage.getItem("purrfect-care-logs")).toBe("[]");
    await new Promise((resolve) => window.setTimeout(resolve, 380));
    fireEvent.click(screen.getByRole("button", { name: "Tap to add one" }));
    expect(JSON.parse(localStorage.getItem("purrfect-care-logs") ?? "[]")).toHaveLength(1);
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
    localStorage.setItem("purrfect-cats", JSON.stringify([{ id: 1, name: "Mochi", color: "#F2A07B", initial: "M" }]));
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Cats" }));
    await user.click(screen.getByRole("button", { name: "Edit or remove Mochi" }));
    await user.click(screen.getByRole("button", { name: "Remove Mochi" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove cat" }));
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

  it("locks the add-cat form while the photo crop request is running", async () => {
    const user = userEvent.setup();
    let finishCrop: ((value: string) => void) | undefined;
    photoMocks.cropCatPhoto.mockClear();
    photoMocks.cropCatPhoto.mockImplementationOnce(() => new Promise((resolve) => { finishCrop = resolve; }));
    renderApp();
    await user.click(screen.getAllByRole("button", { name: "Add a cat" })[0]);
    await user.type(screen.getByRole("textbox", { name: "Cat’s name" }), "Miso");
    await user.upload(screen.getByLabelText("Choose file!"), new File(["photo"], "miso.png", { type: "image/png" }));
    const addCatDialog = screen.getByRole("dialog", { name: "Add a new cat" });
    act(() => {
      fireEvent.submit(addCatDialog);
      fireEvent.submit(addCatDialog);
    });

    const busyButton = await screen.findByRole("button", { name: /Adding/ });
    expect(busyButton.hasAttribute("disabled")).toBe(true);
    expect(photoMocks.cropCatPhoto).toHaveBeenCalledTimes(1);
    fireEvent.click(busyButton);
    expect(screen.queryByRole("button", { name: "Track care for Miso" })).toBeNull();

    finishCrop?.("data:image/jpeg;base64,cropped");
    expect(await screen.findByRole("button", { name: "Track care for Miso" })).not.toBeNull();
  });

  it("closes a cat profile modal when switching pages", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Cats" }));
    await user.click(screen.getByRole("button", { name: "Edit or remove Mochi" }));
    expect(screen.getByRole("dialog", { name: "Edit Mochi" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Care" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit Mochi" })).toBeNull());
  });

  it("opens the cat profile editor with zoom and crop when changing an existing photo", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Cats" }));
    await user.click(screen.getByRole("button", { name: "Edit or remove Mochi" }));
    const photoInput = screen.getByLabelText("Choose profile photo");
    await user.upload(photoInput, new File(["photo"], "mochi.png", { type: "image/png" }));

    expect(await screen.findByRole("dialog", { name: "Edit Mochi" })).not.toBeNull();
    fireEvent.change(screen.getByRole("slider", { name: "Zoom photo" }), { target: { value: "2" } });
    fireEvent.change(screen.getByRole("slider", { name: "Horizontal photo crop" }), { target: { value: "70" } });
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect(photoMocks.cropCatPhoto).toHaveBeenCalledWith("data:image/jpeg;base64,preview", { x: 70, y: 50, zoom: 2 });
    expect(screen.getAllByAltText("Mochi").every((image) => image.getAttribute("src") === "data:image/jpeg;base64,cropped")).toBe(true);
  });

  it("saves the cat name and food goals from the cat profile dialog", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Cats" }));
    await user.click(screen.getByRole("button", { name: "Edit or remove Mochi" }));
    await user.clear(screen.getByRole("textbox", { name: "Cat’s name" }));
    await user.type(screen.getByRole("textbox", { name: "Cat’s name" }), "Miso");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect((await screen.findAllByRole("heading", { name: "Miso" })).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Care Menu" }));
    const careMenu = screen.getByRole("dialog", { name: "Care tracker" });
    await user.click(within(careMenu).getByRole("button", { name: "Reorder care actions" }));
    await user.click(within(careMenu).getByRole("button", { name: "Drag Treats to reorder, or tap to edit" }));
    const editDialog = screen.getByRole("heading", { name: "Edit care action" }).closest("form")!;
    await user.clear(within(editDialog).getByRole("spinbutton"));
    await user.type(within(editDialog).getByRole("spinbutton"), "6");
    await user.click(within(editDialog).getByRole("button", { name: "Save action" }));
    expect(JSON.parse(localStorage.getItem("purrfect-trackers") ?? "{}")["1"].treatsGoal).toBe(6);
  });

  it("warns when food goals are met and play becomes excessive", async () => {
    localStorage.setItem("purrfect-trackers", JSON.stringify({ "1": { treats: 4, treatsGoal: 4, played: 5 } }));
    const user = userEvent.setup();
    renderApp();
    expect(screen.getByRole("status").textContent).toMatch(/reached.*treats goal/i);
    await chooseTrackingMode(user, /Play/);
    expect(screen.getByRole("status").textContent).toMatch(/lot of play sessions/i);
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
  it("keeps Analytics and Family navigation routes and selected highlights aligned", async () => {
    const user = userEvent.setup();
    renderApp();
    const navigation = screen.getByRole("navigation", { name: "Primary navigation" });
    const links = within(navigation).getAllByRole("button");
    expect(links.map((button) => button.textContent?.trim())).toEqual(["Care", "Cats", "Family"]);
    await user.click(within(navigation).getByRole("button", { name: "Cats" }));
    expect(await screen.findByRole("heading", { name: "Cats" })).not.toBeNull();
    expect(navigation.classList.contains("page-cats")).toBe(true);
    expect(within(navigation).getByRole("button", { name: "Cats" }).getAttribute("aria-current")).toBe("page");

    await user.click(within(navigation).getByRole("button", { name: "Family" }));
    expect(await screen.findByRole("heading", { name: "Family workspace" })).not.toBeNull();
    expect(navigation.classList.contains("page-family")).toBe(true);
    expect(within(navigation).getByRole("button", { name: "Family" }).getAttribute("aria-current")).toBe("page");

    const css = readFileSync("src/index.css", "utf8");
    expect(css).toMatch(/\.primary-nav\.page-cats::before\s*\{\s*transform:\s*translateX\(calc\(100% \+ 3px\)\);/);
    expect(css).toMatch(/\.primary-nav\.page-family::before\s*\{\s*transform:\s*translateX\(calc\(200% \+ 6px\)\);/);
    expect(css).not.toContain("route-enter");
    expect(css).not.toContain("nav-icon-settle");
    expect(css.match(/\.primary-nav::before\s*\{([^}]+)\}/)?.[1]).not.toMatch(/transition:/);
  });

  it("opens the chosen cat's daily analytics from the Cats page", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Cats" }));
    await user.click(screen.getByRole("button", { name: "Show analytics for Mochi" }));

    expect(await screen.findByText("Mochi · Activity each day this week")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Show analytics for Mochi" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Per week" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("opens the care menu from the progress heart", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("button", { name: "Open care menu" }));

    expect(screen.getByRole("dialog", { name: "Care tracker" })).not.toBeNull();
  });

  it("keeps the Now tap to track number in a stable slot when its digit count changes", async () => {
    localStorage.setItem("purrfect-trackers", JSON.stringify({ "1": { treats: 9, treatsGoal: 10 } }));
    const user = userEvent.setup();
    const { container } = renderApp();
    const counter = container.querySelector(".big-tap-card .big-count");
    expect(counter?.textContent).toContain("9");

    await user.click(screen.getByRole("button", { name: "Tap to add one" }));
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
    const tapButton = screen.getByRole("button", { name: "Tap to add one" });

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
    await user.click(screen.getByRole("button", { name: "Tap to add one" }));
    expect(counter?.textContent).toContain("1");
    expect(counter?.textContent).toContain("/ 4");
    const undoButton = within(container.querySelector(".big-tap-wrap")!).getByRole("button", { name: /Undo recent care action/ });
    expect(undoButton.classList.contains("tap-undo-icon")).toBe(true);
    expect(undoButton.closest(".big-tap-wrap")).not.toBeNull();
    expect(undoButton.textContent).toBe("1");
    expect(screen.getByRole("button", { name: /Who fed\?/ }).querySelector("span")?.textContent).toBe("1");

    await user.click(within(container.querySelector(".big-tap-wrap")!).getByRole("button", { name: /Undo recent care action/ }));
    expect(counter?.textContent).toContain("0");
    expect(counter?.textContent).toContain("/ 4");
    expect(container.querySelector(".big-tap-card .big-count")).toBe(counter);
    expect(screen.getByRole("button", { name: /Who fed\?/ }).querySelector("span")?.textContent).toBe("0");
    await waitFor(() => {
      const savedLogs = JSON.parse(localStorage.getItem("purrfect-care-logs") ?? "[]") as Array<{ detail: string }>;
      expect(savedLogs.some((entry) => entry.detail === "Removed 1 treat")).toBe(true);
    });
  });

  it("keeps multiple actions undoable in reverse order after the latest tap", async () => {
    const user = userEvent.setup();
    const { container } = renderApp();
    await chooseTrackingMode(user, /Treats/);
    const tapButton = screen.getByRole("button", { name: "Tap to add one" });
    await user.click(tapButton);
    await user.click(tapButton);
    expect(container.querySelector(".big-tap-card .big-count")?.textContent).toContain("2");
    expect(within(container.querySelector(".big-tap-wrap")!).getByRole("button", { name: /Undo recent care action, 2 available/ })).not.toBeNull();

    await user.click(within(container.querySelector(".big-tap-wrap")!).getByRole("button", { name: /Undo recent care action/ }));
    expect(container.querySelector(".big-tap-card .big-count")?.textContent).toContain("1");
    expect(within(container.querySelector(".big-tap-wrap")!).getByRole("button", { name: /Undo recent care action, 1 available/ })).not.toBeNull();
    await user.click(within(container.querySelector(".big-tap-wrap")!).getByRole("button", { name: /Undo recent care action/ }));
    expect(container.querySelector(".big-tap-card .big-count")?.textContent).toContain("0");
  });

  it("undoes a wet-food 10% check-in and restores partial progress", async () => {
    const user = userEvent.setup();
    const { container } = renderApp();
    await chooseTrackingMode(user, /Wet food/);
    await user.click(screen.getByRole("button", { name: "Tap to add 10%" }));
    expect(screen.getByText("10% of the next can")).not.toBeNull();

    await user.click(within(container.querySelector(".big-tap-wrap")!).getByRole("button", { name: /Undo recent care action/ }));
    expect(screen.getByText("0% of the next can")).not.toBeNull();
  });

  it("undoes a wet-food tap that completed a can and restores the prior 90%", async () => {
    const user = userEvent.setup();
    const { container } = renderApp();
    await chooseTrackingMode(user, /Wet food/);
    for (let tap = 0; tap < 9; tap += 1) {
      await user.click(screen.getByRole("button", { name: "Tap to add 10%" }));
    }
    expect(screen.getByText("90% of the next can")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Tap to add 10%" }));
    expect(container.querySelector(".wet-food-count strong")?.textContent).toContain("1 can");
    await user.click(within(container.querySelector(".big-tap-wrap")!).getByRole("button", { name: /Undo recent care action/ }));
    expect(container.querySelector(".wet-food-count strong")?.textContent).toContain("0 cans");
    expect(screen.getByText("90% of the next can")).not.toBeNull();
  });

  it("shows the tracked wet-food amount in the Who fed count, not tap-entry count", async () => {
    const user = userEvent.setup();
    const { container } = renderApp();
    await chooseTrackingMode(user, /Wet food/);
    for (let tap = 0; tap < 5; tap += 1) await user.click(screen.getByRole("button", { name: "Tap to add 10%" }));

    const whoFedButton = screen.getByRole("button", { name: /Who fed\?/ });
    expect(whoFedButton.querySelector("span")?.textContent).toBe("0.5");

    for (let tap = 0; tap < 5; tap += 1) await user.click(screen.getByRole("button", { name: "Tap to add 10%" }));
    expect(whoFedButton.querySelector("span")?.textContent).toBe("1");
    await user.click(whoFedButton);
    expect(container.querySelector(".record-card-heading > span")?.textContent).toBe("1");
    expect(container.querySelectorAll(".record-card-list li")).toHaveLength(1);
    expect(container.querySelector(".record-card-list")?.textContent).toContain("Added 100% of a can");
  });

  it("edits a care target from the care menu and saves the chosen quantity", async () => {
    const user = userEvent.setup();
    const { container } = renderApp();
    await user.click(screen.getByRole("button", { name: "Care Menu" }));
    const menu = screen.getByRole("dialog", { name: "Care tracker" });
    await user.click(within(menu).getByRole("button", { name: "Reorder care actions" }));
    await user.click(within(menu).getByRole("button", { name: "Drag Treats to reorder, or tap to edit" }));
    const actionDialog = await screen.findByRole("dialog", { name: "Edit care action" });
    expect(actionDialog.parentElement?.parentElement).toBe(document.body);
    const modalCss = readFileSync("src/index.css", "utf8");
    expect(modalCss).toMatch(/\.track-picker-backdrop\s*\{[^}]*z-index:\s*1300;/s);
    expect(modalCss).toMatch(/\.modal-backdrop\.action-editor-backdrop\s*\{\s*z-index:\s*1400;/);
    const dialog = (await screen.findByRole("heading", { name: "Edit care action" })).parentElement!;
    const treatsGoal = within(dialog).getByRole("spinbutton");

    await user.clear(treatsGoal);
    await user.type(treatsGoal, "6");
    expect(screen.getByRole("heading", { name: "Edit care action" })).not.toBeNull();
    expect((treatsGoal as HTMLInputElement).value).toBe("6");
    await user.click(within(dialog).getByRole("button", { name: "Save action" }));
    expect(container.querySelector(".big-tap-card .big-count")?.textContent).toContain("/ 6");
  });

  it("offers custom care actions from the last menu tile and shows direct drag handles in edit mode", async () => {
    const user = userEvent.setup();
    const { container } = renderApp();
    await user.click(screen.getByRole("button", { name: "Care Menu" }));
    let menu = screen.getByRole("dialog", { name: "Care tracker" });
    const menuCss = readFileSync("src/index.css", "utf8");
    expect(menuCss).toMatch(/\.track-picker-backdrop\s*\{[^}]*z-index:\s*1300;/s);
    expect(menuCss).toMatch(/\.care-action-drag-preview\s*\{[^}]*z-index:\s*1350;/s);
    expect(menuCss).toMatch(/\.modal-backdrop\.action-editor-backdrop\s*\{\s*z-index:\s*1400;/);
    const tiles = Array.from(menu.querySelectorAll(".care-action-tile-wrap .care-action-tile-content > button:not(.care-action-remove)"));
    expect(tiles.at(-1)?.textContent).toContain("Pee");
    await user.click(within(menu).getByRole("button", { name: "Add care action" }));
    expect(await screen.findByRole("heading", { name: "Add a care action" })).not.toBeNull();
    const addActionDialog = screen.getByRole("dialog", { name: "Add a care action" });
    expect(addActionDialog.parentElement?.parentElement).toBe(document.body);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Add a care action" })).toBeNull());
    await user.click(screen.getByRole("button", { name: "Care Menu" }));
    menu = screen.getByRole("dialog", { name: "Care tracker" });
    await user.click(within(menu).getByRole("button", { name: "Reorder care actions" }));
    expect(within(menu).getByRole("button", { name: "Drag Kibble to reorder, or tap to edit" })).not.toBeNull();
    expect(menu.querySelector(".care-action-tile-wrap.is-editing")).not.toBeNull();
  });
});
