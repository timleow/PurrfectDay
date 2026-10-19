import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_CACHE_TTL, writeWorkspaceCache } from "../data/workspaceCache";
import App from "../App";

const cloudMocks = vi.hoisted(() => ({
  channelCallback: null as null | (() => void),
  persistedEvents: [] as Array<Record<string, unknown>>,
  returnStaleEvents: false,
  getCatPhotoUrl: vi.fn(),
  getMyFamily: vi.fn(),
  listCats: vi.fn(),
  listFamilyMembers: vi.fn(),
  listTargets: vi.fn(),
  listCareEvents: vi.fn(),
  recordCareEvent: vi.fn(),
}));

vi.mock("../data/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: "person-1", email: "member@example.com" } } }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
    channel: vi.fn(() => {
      const channel = {
        on: vi.fn((_event: unknown, _filter: unknown, callback: () => void) => {
          cloudMocks.channelCallback = callback;
          return channel;
        }),
        subscribe: vi.fn(() => channel),
      };
      return channel;
    }),
    removeChannel: vi.fn(),
  },
}));

vi.mock("../data/familyService", () => ({
  addCat: vi.fn(),
  archiveCat: vi.fn(),
  getCatPhotoUrl: cloudMocks.getCatPhotoUrl,
  getMyFamily: cloudMocks.getMyFamily,
  listCareEvents: cloudMocks.listCareEvents,
  listCats: cloudMocks.listCats,
  listFamilyMembers: cloudMocks.listFamilyMembers,
  listTargets: cloudMocks.listTargets,
  recordCareEvent: cloudMocks.recordCareEvent,
  saveTarget: vi.fn(),
  updateCat: vi.fn(),
  uploadCatPhoto: vi.fn(),
}));

vi.mock("../components/FamilyPortal", () => ({ default: () => null }));

afterEach(() => cleanup());
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.dataset.theme = "";
  cloudMocks.channelCallback = null;
  cloudMocks.getCatPhotoUrl.mockReset();
  cloudMocks.persistedEvents = [];
  cloudMocks.returnStaleEvents = false;
  cloudMocks.getMyFamily.mockResolvedValue({ id: "family-1", name: "My family", timezone: "Asia/Singapore" });
  cloudMocks.listCats.mockResolvedValue([{ id: "cat-1", family_id: "family-1", name: "Mochi", color: "#79B8A9", photo_path: null, archived_at: null }]);
  cloudMocks.listFamilyMembers.mockResolvedValue([{ id: "member-1", family_id: "family-1", user_id: "person-1", email: "member@example.com", display_name: "Member", added_at: "2026-01-01T00:00:00.000Z" }]);
  cloudMocks.listTargets.mockResolvedValue([]);
  cloudMocks.listCareEvents.mockImplementation(async () => cloudMocks.returnStaleEvents ? [] : [...cloudMocks.persistedEvents]);
  cloudMocks.recordCareEvent.mockImplementation(async (event: Record<string, unknown>) => {
    const savedEvent = { ...event, id: event.id ?? `event-${cloudMocks.persistedEvents.length + 1}`, actor_user_id: "person-1" };
    cloudMocks.persistedEvents.push(savedEvent);
    return savedEvent;
  });
});

describe("rapid shared-care updates", () => {
  it("shows only other members' active care actions and stores notification reads per user", async () => {
    const now = Date.now();
    cloudMocks.listFamilyMembers.mockResolvedValue([
      { id: "member-1", family_id: "family-1", user_id: "person-1", email: "member@example.com", display_name: "Member", added_at: "2026-01-01T00:00:00.000Z" },
      { id: "member-2", family_id: "family-1", user_id: "person-2", email: "other@example.com", display_name: "Other", added_at: "2026-01-01T00:00:00.000Z" },
    ]);
    cloudMocks.persistedEvents = [
      { id: "own-action", family_id: "family-1", cat_id: "cat-1", actor_user_id: "person-1", metric: "treats", amount_delta: 1, unit: "treats", detail: "Added 1 treat", occurred_at: new Date(now - 40_000).toISOString() },
      { id: "undone-action", family_id: "family-1", cat_id: "cat-1", actor_user_id: "person-2", metric: "treats", amount_delta: 1, unit: "treats", detail: "Added 1 treat", occurred_at: new Date(now - 30_000).toISOString() },
      { id: "undo-action", family_id: "family-1", cat_id: "cat-1", actor_user_id: "person-2", metric: "treats", amount_delta: -1, unit: "treats", detail: "Removed 1 treat", occurred_at: new Date(now - 20_000).toISOString() },
      { id: "other-active-action", family_id: "family-1", cat_id: "cat-1", actor_user_id: "person-2", metric: "treats", amount_delta: 2, unit: "treats", detail: "Added 2 treats", occurred_at: new Date(now - 10_000).toISOString() },
    ];
    localStorage.setItem("purrfect-notifications-seen-at:person-2", "123");
    localStorage.setItem("purrfect-notifications-seen-at", "456");

    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(cloudMocks.listCareEvents).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Care notifications" }).querySelector(".notification-badge")?.textContent).toBe("1");
    await user.click(await screen.findByRole("button", { name: "Care notifications" }));

    const recentCare = screen.getByRole("dialog", { name: "Recent care activity" });
    expect(within(recentCare).getByText("Other · Mochi")).not.toBeNull();
    expect(within(recentCare).getByText("Added 2 treats")).not.toBeNull();
    expect(within(recentCare).queryByText("Member · Mochi")).toBeNull();
    expect(within(recentCare).queryByText("Added 1 treat")).toBeNull();
    expect(within(recentCare).queryByText("Removed 1 treat")).toBeNull();
    expect(Number(localStorage.getItem("purrfect-notifications-seen-at:person-1"))).toBeGreaterThan(now - 60_000);
    expect(localStorage.getItem("purrfect-notifications-seen-at:person-2")).toBe("123");
    expect(localStorage.getItem("purrfect-notifications-seen-at")).toBe("456");
  });

  it("groups notifications under Today and Yesterday and reuses care menu event colors", async () => {
    const now = Date.now();
    cloudMocks.listFamilyMembers.mockResolvedValue([
      { id: "member-1", family_id: "family-1", user_id: "person-1", email: "member@example.com", display_name: "Member", added_at: "2026-01-01T00:00:00.000Z" },
      { id: "member-2", family_id: "family-1", user_id: "person-2", email: "other@example.com", display_name: "Other", added_at: "2026-01-01T00:00:00.000Z" },
    ]);
    cloudMocks.persistedEvents = [
      { id: "today", family_id: "family-1", cat_id: "cat-1", actor_user_id: "person-2", metric: "treats", amount_delta: 1, unit: "treats", detail: "Added 1 treat", occurred_at: new Date(now - 60_000).toISOString() },
      { id: "yesterday", family_id: "family-1", cat_id: "cat-1", actor_user_id: "person-2", metric: "kibble", amount_delta: 1, unit: "spoons", detail: "Added 1 spoon", occurred_at: new Date(now - 24 * 60 * 60 * 1000).toISOString() },
    ];
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(await screen.findByRole("button", { name: "Care notifications" }));
    const recentCare = screen.getByRole("dialog", { name: "Recent care activity" });
    expect(within(recentCare).getByRole("region", { name: "Today" })).not.toBeNull();
    expect(within(recentCare).getByRole("region", { name: "Yesterday" })).not.toBeNull();
    expect(within(recentCare).getAllByText("Other · Mochi")).toHaveLength(2);
    expect(within(recentCare).getByText("Added 1 treat").closest("li")?.querySelector(".notification-icon")?.classList.contains("treat-green")).toBe(true);
    expect(within(recentCare).getByText("Added 1 spoon").closest("li")?.querySelector(".notification-icon")?.classList.contains("kibble-brown")).toBe(true);

    await user.click(screen.getAllByRole("button", { name: /Care log/ })[0]);
    const logIcons = container.querySelectorAll(".activity-log-list .activity-log-dot");
    expect([...logIcons].some((icon) => icon.classList.contains("treat-green"))).toBe(true);
  });

  it("refreshes shared data when the user pulls down from the top", async () => {
    render(<App />);
    await waitFor(() => expect(cloudMocks.listCareEvents).toHaveBeenCalledTimes(1));

    fireEvent.touchStart(window, { touches: [{ identifier: 1, clientX: 120, clientY: 10 }] });
    fireEvent.touchMove(window, { touches: [{ identifier: 1, clientX: 122, clientY: 100 }] });
    fireEvent.touchEnd(window, { changedTouches: [{ identifier: 1, clientX: 122, clientY: 100 }] });

    await waitFor(() => expect(cloudMocks.listCareEvents).toHaveBeenCalledTimes(2));
  });

  it("hydrates week-old localStorage data immediately while refreshing it from Supabase", async () => {
    const family = { id: "family-1", name: "My family", timezone: "Asia/Singapore" };
    const event = { id: "cached-event", family_id: "family-1", cat_id: "cat-1", actor_user_id: "person-1", metric: "treats", amount_delta: 2, unit: "treats", detail: "Added 2 treats", occurred_at: new Date().toISOString() };
    writeWorkspaceCache("person-1", {
      family,
      cats: [{ id: "cat-1", family_id: "family-1", name: "Mochi", color: "#79B8A9", photo_path: "family-1/cat-1/mochi.jpg", archived_at: null, initial: "M", photo: "https://storage.example/mochi.jpg" }],
      members: [{ id: "member-1", family_id: "family-1", user_id: "person-1", email: "member@example.com", display_name: "Member", added_at: "2026-01-01T00:00:00.000Z" }],
      targets: [],
      events: [event],
    });
    const cacheKey = "purrfect-workspace-v1:person-1";
    const cachedWorkspace = JSON.parse(localStorage.getItem(cacheKey) ?? "{}") as { savedAt: number };
    localStorage.setItem(cacheKey, JSON.stringify({ ...cachedWorkspace, savedAt: Date.now() - WORKSPACE_CACHE_TTL + 1000 }));
    let resolveFamily!: (value: typeof family) => void;
    cloudMocks.listCats.mockResolvedValueOnce([{ id: "cat-1", family_id: "family-1", name: "Fresh Mochi", color: "#79B8A9", photo_path: null, archived_at: null }]);
    cloudMocks.getMyFamily.mockImplementationOnce(() => new Promise((resolve) => { resolveFamily = resolve; }));
    const { container } = render(<App />);

    expect((await screen.findAllByRole("img", { name: "Mochi" }))[0].getAttribute("src")).toBe("https://storage.example/mochi.jpg");
    expect(container.querySelector(".big-tap-card .big-count")?.textContent).toContain("2");
    expect(cloudMocks.getMyFamily).toHaveBeenCalledTimes(1);

    resolveFamily(family);
    await waitFor(() => expect(cloudMocks.listCats).toHaveBeenCalledWith("family-1"));
    expect((await screen.findAllByRole("heading", { name: "Fresh Mochi" })).length).toBeGreaterThan(0);
  });

  it("refreshes family membership and cats when an invited member returns to the app", async () => {
    cloudMocks.getMyFamily.mockResolvedValueOnce(null);
    cloudMocks.listCats.mockResolvedValueOnce([{ id: "cat-1", family_id: "family-1", name: "Mochi", color: "#79B8A9", photo_path: "family-1/cat-1/mochi.jpg", archived_at: null }]);
    cloudMocks.getCatPhotoUrl.mockResolvedValue("https://storage.example/mochi.jpg");
    const { container } = render(<App />);
    expect(await screen.findByRole("heading", { name: "Your cats start with family" })).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    });

    expect((await screen.findAllByText("Mochi")).length).toBeGreaterThan(0);
    expect(cloudMocks.getMyFamily).toHaveBeenCalledTimes(2);
    expect(cloudMocks.listCats).toHaveBeenCalledWith("family-1");
    expect(cloudMocks.getCatPhotoUrl).toHaveBeenCalledWith("family-1/cat-1/mochi.jpg");
    expect((await screen.findAllByRole("img", { name: "Mochi" })).length).toBeGreaterThan(0);
  });

  it("keeps quick taps visible when a stale server snapshot arrives", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const tapButton = await screen.findByRole("button", { name: "Tap to add one" });

    await user.click(tapButton);
    await user.click(tapButton);
    await waitFor(() => expect(cloudMocks.recordCareEvent).toHaveBeenCalledTimes(2));
    expect(container.querySelector(".big-tap-card .big-count")?.textContent).toContain("2");

    cloudMocks.returnStaleEvents = true;
    await waitFor(() => expect(cloudMocks.channelCallback).not.toBeNull());
    act(() => cloudMocks.channelCallback?.());
    await waitFor(() => expect(cloudMocks.listCareEvents).toHaveBeenCalledTimes(2), { timeout: 1500 });
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    expect(container.querySelector(".big-tap-card .big-count")?.textContent).toContain("2");
    expect(screen.getByRole("button", { name: /Who fed\?/ }).querySelector("span")?.textContent).toBe("2");

    cloudMocks.returnStaleEvents = false;
    act(() => cloudMocks.channelCallback?.());
    await waitFor(() => expect(cloudMocks.listCareEvents).toHaveBeenCalledTimes(3), { timeout: 1500 });
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    expect(container.querySelector(".big-tap-card .big-count")?.textContent).toContain("2");
    expect(screen.getByRole("button", { name: /Who fed\?/ }).querySelector("span")?.textContent).toBe("2");
  });

  it("persists an undo as a reversal of the exact care event it undoes", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Tap to add one" }));
    await waitFor(() => expect(cloudMocks.recordCareEvent).toHaveBeenCalledTimes(1));
    const originalEvent = cloudMocks.recordCareEvent.mock.calls[0][0] as Record<string, unknown>;

    await waitFor(() => expect(screen.getAllByRole("button", { name: /Undo recent care action/ })).toHaveLength(2));
    await user.click(screen.getAllByRole("button", { name: /Undo recent care action/ })[0]);
    await waitFor(() => expect(cloudMocks.recordCareEvent).toHaveBeenCalledTimes(2));
    const undoEvent = cloudMocks.recordCareEvent.mock.calls[1][0] as Record<string, unknown>;
    expect(undoEvent.reverses_event_id).toBe(originalEvent.id);
  });
});
