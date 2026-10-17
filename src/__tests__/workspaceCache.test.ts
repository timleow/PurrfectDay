import { beforeEach, describe, expect, it } from "vitest";
import { clearWorkspaceCache, readWorkspaceCache, WORKSPACE_CACHE_TTL, writeWorkspaceCache } from "../data/workspaceCache";

const snapshot = {
  family: { id: "family-1", name: "Whisker home", timezone: "Asia/Singapore" },
  cats: [{ id: "cat-1", family_id: "family-1", name: "Mochi", color: "#79B8A9", photo_path: null, archived_at: null, initial: "M", photo: "https://storage.example/mochi.jpg" }],
  members: [{ id: "member-1", family_id: "family-1", user_id: "person-1", email: "person@example.com", display_name: "Person", added_at: "2026-01-01T00:00:00Z" }],
  targets: [],
  events: [],
};

beforeEach(() => sessionStorage.clear());

describe("private workspace display cache", () => {
  it("stores family, cats, members, and photo URLs only for the matching signed-in account", () => {
    writeWorkspaceCache("person-1", snapshot);

    expect(readWorkspaceCache("person-1")?.cats[0].photo).toBe("https://storage.example/mochi.jpg");
    expect(readWorkspaceCache("other-person")).toBeNull();
  });

  it("expires cached display data after its short TTL", () => {
    const savedAt = Date.now();
    writeWorkspaceCache("person-1", snapshot);

    expect(readWorkspaceCache("person-1", savedAt + WORKSPACE_CACHE_TTL - 1)).not.toBeNull();
    expect(readWorkspaceCache("person-1", savedAt + WORKSPACE_CACHE_TTL + 1)).toBeNull();
  });

  it("can clear cached family access immediately", () => {
    writeWorkspaceCache("person-1", snapshot);
    clearWorkspaceCache("person-1");
    expect(readWorkspaceCache("person-1")).toBeNull();
  });
});
