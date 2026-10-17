import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FamilyPortal from "../components/FamilyPortal";
import { writeWorkspaceCache } from "../data/workspaceCache";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  getMyFamily: vi.fn(),
  createFamily: vi.fn(),
  deleteFamily: vi.fn(),
  listFamilyMembers: vi.fn(),
  removeFamilyMember: vi.fn(),
  updateFamily: vi.fn(),
  addFamilyMember: vi.fn(),
  updateFamilyMemberName: vi.fn(),
}));

vi.mock("../data/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
    },
    storage: { from: () => ({ upload: vi.fn() }) },
    from: () => ({ update: () => ({ eq: vi.fn() }) }),
  },
}));
vi.mock("../data/familyService", () => ({
  getMyFamily: mocks.getMyFamily,
  createFamily: mocks.createFamily,
  deleteFamily: mocks.deleteFamily,
  listFamilyMembers: mocks.listFamilyMembers,
  removeFamilyMember: mocks.removeFamilyMember,
  updateFamily: mocks.updateFamily,
  addFamilyMember: mocks.addFamilyMember,
  updateFamilyMemberName: mocks.updateFamilyMemberName,
}));

afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
  mocks.getMyFamily.mockResolvedValue({ id: "family-1", name: "Lee family", timezone: "Asia/Singapore" });
  mocks.createFamily.mockResolvedValue({ id: "family-1", name: "Lee family", timezone: "Asia/Singapore" });
  mocks.deleteFamily.mockResolvedValue(undefined);
  mocks.listFamilyMembers.mockResolvedValue([
    { id: "member-self", family_id: "family-1", user_id: "user-1", email: "mom@example.com", display_name: "Mom", added_at: "2026-10-01" },
    { id: "member-2", family_id: "family-1", user_id: "user-2", email: "dad@example.com", display_name: "Dad", added_at: "2026-10-02" },
  ]);
  mocks.removeFamilyMember.mockResolvedValue(undefined);
  mocks.updateFamilyMemberName.mockResolvedValue(undefined);
  vi.stubGlobal("confirm", vi.fn(() => true));
});

function signedInSession() {
  mocks.getSession.mockResolvedValue({
    data: { session: { user: { id: "user-1", email: "mom@example.com" } } },
    error: null,
  });
}

describe("family release scope and workspace", () => {
  it("keeps person emails below names and remove actions at the right edge", () => {
    const css = readFileSync("src/components/FamilyPortal.css", "utf8");
    expect(css).toMatch(/\.family-member-list \.family-member-identity\s*\{[^}]*flex:\s*1/s);
    expect(css).toMatch(/\.family-remove-button\s*\{\s*margin-left:\s*auto/s);
    expect(css).toMatch(/\.family-member-list small\s*\{\s*display:\s*block/s);
  });

  it("offers Google sign-in and leaves Apple sign-in out of scope", async () => {
    render(<FamilyPortal onClose={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Sign in to get started" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Continue with Google" }).querySelector("svg")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Apple/ })).toBeNull();
  });

  it("shows a loader until the shared family workspace has loaded", async () => {
    signedInSession();
    let finishLoad!: (family: unknown) => void;
    mocks.getMyFamily.mockReturnValue(new Promise((resolve) => { finishLoad = resolve; }));
    const onManageCats = vi.fn();
    render(<FamilyPortal cats={[{ id: "cat-1", name: "Mochi", color: "#d494b7", initial: "M" }]} onClose={vi.fn()} onManageCats={onManageCats} />);

    expect((await screen.findByText("Loading your family workspace…")).closest(".family-portal-loading")?.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("heading", { name: "Create your family" })).toBeNull();
    finishLoad({ id: "family-1", name: "Lee family", timezone: "Asia/Singapore" });
    expect(await screen.findByRole("heading", { name: "Family & people" })).not.toBeNull();
    expect(await screen.findByText("People in this family")).not.toBeNull();
    expect(screen.getByRole("region", { name: "Cats in Lee family" })).not.toBeNull();
    expect(screen.getByText("Mochi")).not.toBeNull();
    const dadEmail = screen.getByText("dad@example.com");
    expect(dadEmail.tagName).toBe("SMALL");
    expect(dadEmail.parentElement?.querySelector("strong")?.textContent).toBe("Dad");
    await userEvent.setup().click(screen.getByRole("button", { name: "Manage cats" }));
    expect(onManageCats).toHaveBeenCalledOnce();
  });

  it("shows cached family details immediately while refreshing in the background", async () => {
    signedInSession();
    writeWorkspaceCache("user-1", {
      family: { id: "family-1", name: "Lee family", timezone: "Asia/Singapore" },
      cats: [],
      members: [{ id: "member-self", family_id: "family-1", user_id: "user-1", email: "mom@example.com", display_name: "Mom", added_at: "2026-10-01" }],
      targets: [],
      events: [],
    });
    let finishRefresh!: (family: unknown) => void;
    mocks.getMyFamily.mockReturnValue(new Promise((resolve) => { finishRefresh = resolve; }));
    const initialSession = { user: { id: "user-1", email: "mom@example.com" } } as never;
    render(<FamilyPortal initialSession={initialSession} onClose={vi.fn()} />);

    expect(screen.getByText("People in this family")).not.toBeNull();
    expect(screen.getByText("Lee family")).not.toBeNull();
    expect(screen.queryByText("Loading your family workspace…")).toBeNull();
    await act(async () => {
      finishRefresh({ id: "family-1", name: "Lee family", timezone: "Asia/Singapore" });
    });
  });

  it("allows removing another family member but not the signed-in member", async () => {
    signedInSession();
    const user = userEvent.setup();
    render(<FamilyPortal onClose={vi.fn()} />);
    await screen.findByText("People in this family");
    await user.click(screen.getByRole("button", { name: "Remove Dad from family" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Dad will lose access to this family and its cats. Their Google account will remain unchanged.")).not.toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Remove person" }));
    expect(mocks.removeFamilyMember).toHaveBeenCalledWith("member-2");
    await waitFor(() => expect(screen.queryByText("Dad")).toBeNull());
    expect(screen.queryByRole("button", { name: "Remove Mom from family" })).toBeNull();
  });

  it("warns about removing cats and people before deleting the family", async () => {
    signedInSession();
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<FamilyPortal onClose={onClose} />);
    await screen.findByText("People in this family");

    await user.click(screen.getByRole("button", { name: "Delete family" }));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/all cat profiles and photos, care history, and goals/)).not.toBeNull();
    expect(within(dialog).getByText(/Every person will lose access and be removed from the family/)).not.toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Delete family" }));
    await waitFor(() => expect(mocks.deleteFamily).toHaveBeenCalledWith("family-1"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("lets any family member update a member's display name", async () => {
    signedInSession();
    const user = userEvent.setup();
    render(<FamilyPortal onClose={vi.fn()} />);
    await screen.findByText("People in this family");
    await user.click(screen.getByRole("button", { name: "Edit name for Dad" }));
    const input = screen.getByRole("textbox", { name: "Name" });
    await user.clear(input);
    await user.type(input, "Papa");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.updateFamilyMemberName).toHaveBeenCalledWith("member-2", "Papa");
    expect(await screen.findByText("Papa")).not.toBeNull();
  });

  it("refreshes membership when returning to the app after an invite", async () => {
    signedInSession();
    mocks.getMyFamily.mockResolvedValueOnce(null).mockResolvedValue({ id: "family-1", name: "Lee family", timezone: "Asia/Singapore" });
    render(<FamilyPortal onClose={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "I was invited · Refresh" })).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(await screen.findByText("People in this family")).not.toBeNull();
    expect(mocks.getMyFamily).toHaveBeenCalledTimes(2);
  });

  it("does not expose family timezone as an editable field", async () => {
    signedInSession();
    render(<FamilyPortal onClose={vi.fn()} />);
    await screen.findByRole("heading", { name: "Family & people" });
    expect(screen.queryByLabelText(/timezone/i)).toBeNull();
  });

  it("keeps the family name read-only until edit is chosen and saves it explicitly", async () => {
    signedInSession();
    const user = userEvent.setup();
    render(<FamilyPortal onClose={vi.fn()} />);
    await screen.findByText("People in this family");

    expect(screen.getByText("Lee family")).not.toBeNull();
    expect(screen.queryByRole("textbox", { name: "Family name" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save settings" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Edit family name" }));
    const familyName = screen.getByRole("textbox", { name: "Family name" });
    await user.clear(familyName);
    await user.type(familyName, "Lee household");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.updateFamily).toHaveBeenCalledWith("family-1", { name: "Lee household" }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Family name" })).toBeNull());
    expect(screen.getByText("Lee household")).not.toBeNull();
  });

  it("sets the family timezone from the device when creating a family", async () => {
    signedInSession();
    mocks.getMyFamily.mockResolvedValueOnce(null);
    const user = userEvent.setup();
    render(<FamilyPortal onClose={vi.fn()} />);
    const familyName = await screen.findByRole("textbox", { name: "Family name" });
    await user.type(familyName, "Lee family");
    await user.click(screen.getByRole("button", { name: "Create family" }));

    await waitFor(() => expect(mocks.createFamily).toHaveBeenCalledWith("Lee family", Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"));
  });
});
