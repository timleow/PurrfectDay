import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

const authMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithOAuth: vi.fn(),
}));

vi.mock("../data/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { auth: authMock },
}));

vi.mock("../data/familyService", () => ({
  addCat: vi.fn(),
  archiveCat: vi.fn(),
  getCatPhotoUrl: vi.fn(),
  getMyFamily: vi.fn(),
  listCareEvents: vi.fn(),
  listCats: vi.fn(),
  listFamilyMembers: vi.fn(),
  listTargets: vi.fn(),
  recordCareEvent: vi.fn(),
  saveTarget: vi.fn(),
  updateCat: vi.fn(),
  uploadCatPhoto: vi.fn(),
}));

vi.mock("../components/FamilyPortal", () => ({ default: () => null }));

afterEach(() => cleanup());
beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset.theme = "";
  authMock.getSession.mockResolvedValue({ data: { session: null }, error: null });
  authMock.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  authMock.signInWithOAuth.mockResolvedValue({ error: null });
});

describe("signed-out app flow", () => {
  it("blocks the tracker and offers Google sign-in with its logo", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Welcome to Purrfectday" })).not.toBeNull();
    expect(screen.queryByRole("navigation", { name: "Primary navigation" })).toBeNull();
    const signIn = screen.getByRole("button", { name: "Continue with Google" });
    expect(signIn.querySelector("svg")).not.toBeNull();

    await user.click(signIn);
    expect(authMock.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  });
});
