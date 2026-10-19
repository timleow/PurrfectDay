import type { CareEvent, CloudCat, Family, FamilyMember, TargetRule } from "./familyService";

export type CachedWorkspace = {
  savedAt: number;
  family: Family;
  cats: Array<CloudCat & { initial: string; photo?: string }>;
  members: FamilyMember[];
  targets: TargetRule[];
  events: CareEvent[];
};

const CACHE_PREFIX = "purrfect-workspace-v1:";
// Keep a week of account-scoped data for quick display while the server refreshes it.
export const WORKSPACE_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

function cacheKey(userId: string) {
  return `${CACHE_PREFIX}${userId}`;
}

export function readWorkspaceCache(userId: string, now = Date.now()): CachedWorkspace | null {
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedWorkspace;
    if (!cached.family?.id || !Array.isArray(cached.cats) || !Array.isArray(cached.members) || !Array.isArray(cached.targets) || !Array.isArray(cached.events)) {
      localStorage.removeItem(cacheKey(userId));
      return null;
    }
    if (!Number.isFinite(cached.savedAt) || now - cached.savedAt > WORKSPACE_CACHE_TTL || cached.savedAt > now) {
      localStorage.removeItem(cacheKey(userId));
      return null;
    }
    return cached;
  } catch {
    return null;
  }
}

export function writeWorkspaceCache(userId: string, workspace: Omit<CachedWorkspace, "savedAt">) {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify({ ...workspace, savedAt: Date.now() } satisfies CachedWorkspace));
  } catch {
    // Storage may be disabled or full; network-backed workspace loading still works.
  }
}

export function clearWorkspaceCache(userId: string) {
  try { localStorage.removeItem(cacheKey(userId)); } catch { /* optional cache */ }
}
