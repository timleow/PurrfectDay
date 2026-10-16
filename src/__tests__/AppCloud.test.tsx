import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

const cloudMocks = vi.hoisted(() => ({
  channelCallback: null as null | (() => void),
  persistedEvents: [] as Array<Record<string, unknown>>,
  returnStaleEvents: false,
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
  getCatPhotoUrl: vi.fn(),
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
  document.documentElement.dataset.theme = "";
  cloudMocks.channelCallback = null;
  cloudMocks.persistedEvents = [];
  cloudMocks.returnStaleEvents = false;
  cloudMocks.getMyFamily.mockResolvedValue({ id: "family-1", name: "My family", timezone: "Asia/Singapore" });
  cloudMocks.listCats.mockResolvedValue([{ id: "cat-1", family_id: "family-1", name: "Mochi", color: "#79B8A9", photo_path: null, archived_at: null }]);
  cloudMocks.listFamilyMembers.mockResolvedValue([{ id: "member-1", family_id: "family-1", user_id: "person-1", email: "member@example.com", display_name: "Member", added_at: "2026-01-01T00:00:00.000Z" }]);
  cloudMocks.listTargets.mockResolvedValue([]);
  cloudMocks.listCareEvents.mockImplementation(async () => cloudMocks.returnStaleEvents ? [] : [...cloudMocks.persistedEvents]);
  cloudMocks.recordCareEvent.mockImplementation(async (event: Record<string, unknown>) => {
    const savedEvent = { ...event, id: `event-${cloudMocks.persistedEvents.length + 1}`, actor_user_id: "person-1" };
    cloudMocks.persistedEvents.push(savedEvent);
    return savedEvent;
  });
});

describe("rapid shared-care updates", () => {
  it("keeps quick taps visible when a stale server snapshot arrives", async () => {
    const user = userEvent.setup();
    render(<App />);
    const tapButton = await screen.findByRole("button", { name: "Add one treats" });

    await user.click(tapButton);
    await user.click(tapButton);
    await waitFor(() => expect(cloudMocks.recordCareEvent).toHaveBeenCalledTimes(2));
    expect(screen.getByText("2 / 4")).not.toBeNull();

    cloudMocks.returnStaleEvents = true;
    await waitFor(() => expect(cloudMocks.channelCallback).not.toBeNull());
    act(() => cloudMocks.channelCallback?.());
    await waitFor(() => expect(cloudMocks.listCareEvents).toHaveBeenCalledTimes(2), { timeout: 1500 });
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    expect(screen.getByText("2 / 4")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Who fed\?/ }).querySelector("span")?.textContent).toBe("2");

    cloudMocks.returnStaleEvents = false;
    act(() => cloudMocks.channelCallback?.());
    await waitFor(() => expect(cloudMocks.listCareEvents).toHaveBeenCalledTimes(3), { timeout: 1500 });
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    expect(screen.getByText("2 / 4")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Who fed\?/ }).querySelector("span")?.textContent).toBe("2");
  });
});
