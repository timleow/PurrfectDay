import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  addFamilyMember,
  createFamily,
  deleteFamily,
  getMyFamily,
  listFamilyMembers,
  removeFamilyMember,
  updateFamilyMemberName,
  updateFamily,
  type Family,
  type FamilyMember,
} from "../data/familyService";
import { clearWorkspaceCache, readWorkspaceCache, writeWorkspaceCache } from "../data/workspaceCache";
import { isSupabaseConfigured, supabase } from "../data/supabase";
import GoogleSignInButton from "./GoogleSignInButton";
import ConfirmDialog from "./ConfirmDialog";
import "./FamilyPortal.css";

function deviceTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

type FamilyPortalCat = { id: number | string; name: string; color: string; initial: string; photo?: string };
type PendingConfirmation = { title: string; description: string; confirmLabel: string; action: () => Promise<void> };

function withWorkspaceTimeout<T>(request: Promise<T>): Promise<T> {
  let timeout: number | undefined;
  return Promise.race([
    request,
    new Promise<T>((_, reject) => {
      timeout = window.setTimeout(() => reject(new Error("Family data is taking too long to load. Check your connection and try again.")), 15000);
    }),
  ]).finally(() => { if (timeout !== undefined) window.clearTimeout(timeout); });
}

function googleProfilePhoto(user: User) {
  const identityData = user.identities?.find((identity) => identity.provider === "google")?.identity_data;
  const candidates = [
    user.user_metadata?.avatar_url,
    user.user_metadata?.picture,
    identityData?.avatar_url,
    identityData?.picture,
  ];
  return candidates.find((candidate): candidate is string => typeof candidate === "string" && candidate.startsWith("https://"));
}

function FamilyMemberAvatar({ name, photoUrl }: { name: string; photoUrl?: string | null }) {
  const [loadedUrl, setLoadedUrl] = useState("");
  const [failedUrl, setFailedUrl] = useState("");
  const loaded = Boolean(photoUrl && loadedUrl === photoUrl);
  const failed = Boolean(photoUrl && failedUrl === photoUrl);

  return (
    <span aria-hidden="true" className={`family-person-avatar ${photoUrl && !loaded && !failed ? "is-loading" : ""}`}>
      <span className={`family-person-avatar-fallback ${loaded ? "is-hidden" : ""}`}>{name[0]?.toUpperCase()}</span>
      {photoUrl && !failed && (
        <img
          alt=""
          className={`family-person-avatar-image ${loaded ? "is-loaded" : ""}`}
          decoding="async"
          key={photoUrl}
          loading="lazy"
          onError={() => setFailedUrl(photoUrl)}
          onLoad={() => setLoadedUrl(photoUrl)}
          src={photoUrl}
        />
      )}
    </span>
  );
}

export default function FamilyPortal({ onClose, cats = [], onManageCats = () => {}, onSelectCat = () => {}, onRegisterExitGuard, initialSession, initialFamily, initialMembers, workspaceReady }: {
  onClose: () => void;
  cats?: FamilyPortalCat[];
  onManageCats?: () => void;
  onSelectCat?: (catId: number | string) => void;
  onRegisterExitGuard?: (guard: ((action: () => void) => void) | null) => void;
  initialSession?: Session | null;
  initialFamily?: Family;
  initialMembers?: FamilyMember[];
  /** True once the app shell has hydrated its shared workspace from cache/server. */
  workspaceReady?: boolean;
}) {
  const [cachedWorkspace] = useState(() => initialSession?.user.id ? readWorkspaceCache(initialSession.user.id) : null);
  const seededFamily = initialFamily ?? cachedWorkspace?.family ?? null;
  const seededMembers = initialFamily ? initialMembers ?? [] : cachedWorkspace?.members ?? [];
  const [session, setSession] = useState<Session | null>(initialSession ?? null);
  const [family, setFamily] = useState<Family | null>(seededFamily);
  const [members, setMembers] = useState<FamilyMember[]>(seededMembers);
  const [familyName, setFamilyName] = useState(seededFamily?.name ?? "");
  const [familyNameDraft, setFamilyNameDraft] = useState(seededFamily?.name ?? "");
  const [editingFamilyName, setEditingFamilyName] = useState(false);
  const [closingEditDialog, setClosingEditDialog] = useState(false);
  const editCloseTimer = useRef<number | undefined>(undefined);
  const [memberName, setMemberName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [loading, setLoading] = useState(isSupabaseConfigured && !seededFamily);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [memberNameDraft, setMemberNameDraft] = useState("");
  const [workspaceLoadTick, setWorkspaceLoadTick] = useState(0);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [discardChanges, setDiscardChanges] = useState<{ action: () => void } | null>(null);

  useEffect(() => () => { if (editCloseTimer.current !== undefined) window.clearTimeout(editCloseTimer.current); }, []);

  useEffect(() => {
    const refreshOnPull = () => setWorkspaceLoadTick((tick) => tick + 1);
    window.addEventListener("purrfect:pull-to-refresh", refreshOnPull);
    return () => window.removeEventListener("purrfect:pull-to-refresh", refreshOnPull);
  }, []);

  function closeEditDialog(close: () => void) {
    if (closingEditDialog) return;
    setClosingEditDialog(true);
    editCloseTimer.current = window.setTimeout(() => {
      close();
      setClosingEditDialog(false);
    }, 220);
  }

  function requestFamilyExit(action: () => void) {
    const familyNameChanged = Boolean(family && editingFamilyName && familyNameDraft.trim() !== family.name);
    const member = members.find((entry) => entry.id === editingMemberId);
    const memberBaseName = member ? member.display_name || member.email.split("@")[0] : "";
    const memberNameChanged = Boolean(member && memberNameDraft.trim() !== memberBaseName);
    const hasNewFamilyDraft = !family && Boolean(familyName.trim());
    const hasNewPersonDraft = Boolean(memberName.trim() || memberEmail.trim());
    if (!familyNameChanged && !memberNameChanged && !hasNewFamilyDraft && !hasNewPersonDraft) {
      action();
      return;
    }
    setDiscardChanges({ action: () => {
      setFamilyNameDraft(family?.name ?? "");
      setMemberNameDraft("");
      setMemberName("");
      setMemberEmail("");
      action();
    } });
  }

  useEffect(() => {
    onRegisterExitGuard?.(requestFamilyExit);
    return () => onRegisterExitGuard?.(null);
  });

  function requestEditDialogClose(isDirty: boolean, close: () => void, resetDraft: () => void) {
    if (!isDirty) {
      closeEditDialog(close);
      return;
    }
    setDiscardChanges({ action: () => { resetDraft(); closeEditDialog(close); } });
  }

  function persistCachedWorkspace(userId: string | undefined, nextFamily: Family | null, nextMembers: FamilyMember[]) {
    if (!userId || !nextFamily) return;
    const cached = readWorkspaceCache(userId);
    if (!cached) return;
    writeWorkspaceCache(userId, {
      family: nextFamily,
      cats: cached.cats,
      members: nextMembers,
      targets: cached.targets,
      events: cached.events,
    });
  }

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setError(sessionError.message);
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === "SIGNED_IN") setLoading(true);
      if (event === "SIGNED_OUT") setLoading(false);
      setError("");
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setFamily(null);
      setMembers([]);
      return;
    }
    // App owns the initial workspace request. Wait for its cache/server hydration,
    // then render those props directly instead of repeating the same requests here.
    if (workspaceReady === false) {
      setLoading(true);
      return;
    }
    if (workspaceReady === true && workspaceLoadTick === 0) {
      setFamily(initialFamily ?? null);
      setMembers(initialFamily ? initialMembers ?? [] : []);
      setFamilyName(initialFamily?.name ?? "");
      setFamilyNameDraft(initialFamily?.name ?? "");
      setLoading(false);
      return;
    }
    let active = true;
    const cached = readWorkspaceCache(session.user.id);
    if (cached) {
      setFamily(cached.family);
      setMembers(cached.members);
      setFamilyName(cached.family.name);
      setFamilyNameDraft(cached.family.name);
      setLoading(false);
    } else {
      setLoading(true);
    }
    void loadWorkspace(session.user).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [session?.user.id, workspaceLoadTick, workspaceReady, initialFamily, initialMembers]);

  useEffect(() => {
    if (!session?.user) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      setLoading(true);
      setWorkspaceLoadTick((tick) => tick + 1);
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [session?.user.id]);

  async function loadWorkspace(user: User) {
    setError("");
    try {
      const currentFamily = await withWorkspaceTimeout(getMyFamily(user.id));
      if (!currentFamily) {
        clearWorkspaceCache(user.id);
        setFamily(null);
        setMembers([]);
        return;
      }
      const currentMembers = await withWorkspaceTimeout(listFamilyMembers(currentFamily.id));
      setFamily(currentFamily);
      setMembers(currentMembers);
      setFamilyName(currentFamily.name);
      setFamilyNameDraft(currentFamily.name);
      persistCachedWorkspace(user.id, currentFamily, currentMembers);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the family workspace.");
    }
  }

  async function signIn() {
    if (!supabase) return;
    setBusy(true);
    setError("");
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (signInError) {
      setError(signInError.message);
      setBusy(false);
    }
  }

  async function submitFamily(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setLoading(true);
    setError("");
    try {
      const created = await createFamily(familyName, deviceTimezone());
      if (session?.user) await loadWorkspace(session.user);
      else setFamily(created);
      setNotice("Family created. Add family members here, and manage cats from the Cats tab.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the family.");
    } finally {
      setLoading(false);
      setBusy(false);
    }
  }

  async function saveFamilyName(event?: FormEvent) {
    event?.preventDefault();
    const name = familyNameDraft.trim();
    if (!family || !name) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await updateFamily(family.id, { name });
      const updatedFamily = { ...family, name };
      setFamily(updatedFamily);
      setFamilyName(name);
      closeEditDialog(() => setEditingFamilyName(false));
      persistCachedWorkspace(session?.user.id, updatedFamily, members);
      setNotice("Family name updated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the family name.");
    } finally {
      setBusy(false);
    }
  }

  async function submitMember(event: FormEvent) {
    event.preventDefault();
    if (!family) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await addFamilyMember(family.id, memberEmail, memberName);
      setMemberEmail("");
      setMemberName("");
      const updatedMembers = await listFamilyMembers(family.id);
      setMembers(updatedMembers);
      persistCachedWorkspace(session?.user.id, family, updatedMembers);
      setNotice("Added to the family. They can sign in with this email to access it.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add that person.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemovePerson(member: FamilyMember) {
    if (member.user_id === session?.user.id) return;
    const displayName = member.display_name || member.email;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await removeFamilyMember(member.id);
      const updatedMembers = members.filter((entry) => entry.id !== member.id);
      setMembers(updatedMembers);
      persistCachedWorkspace(session?.user.id, family, updatedMembers);
      setNotice(`${displayName} was removed from the family.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove that person.");
    } finally {
      setBusy(false);
    }
  }

  function removePerson(member: FamilyMember) {
    if (member.user_id === session?.user.id) return;
    const displayName = member.display_name || member.email;
    setConfirmation({
      title: `Remove ${displayName}?`,
      description: `${displayName} will lose access to this family and its cats. Their Google account will remain unchanged.`,
      confirmLabel: "Remove person",
      action: () => confirmRemovePerson(member),
    });
  }

  async function confirmRemoveFamily() {
    if (!family || !session) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await deleteFamily(family.id);
      clearWorkspaceCache(session.user.id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the family.");
    } finally {
      setBusy(false);
    }
  }

  function removeFamily() {
    if (!family || !session) return;
    setConfirmation({
      title: `Delete ${family.name}?`,
      description: "This permanently removes all cat profiles and photos, care history, and goals. Every person will lose access and be removed from the family. Their Google accounts will remain, but you will no longer belong to a family. This cannot be undone.",
      confirmLabel: "Delete family",
      action: confirmRemoveFamily,
    });
  }

  async function saveMemberName(member: FamilyMember) {
    const displayName = memberNameDraft.trim();
    if (!displayName) return;
    setBusy(true);
    setError("");
    try {
      await updateFamilyMemberName(member.id, displayName);
      const updatedMembers = members.map((entry) => entry.id === member.id ? { ...entry, display_name: displayName } : entry);
      setMembers(updatedMembers);
      closeEditDialog(() => setEditingMemberId(null));
      persistCachedWorkspace(session?.user.id, family, updatedMembers);
      setNotice(`${displayName}’s name was updated for the family.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this name.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="family-portal-page">
      <section aria-labelledby="family-portal-title" className="family-portal" role="region">
        <header className="family-portal-header">
          <div><span className="family-portal-eyebrow">Shared care</span><h2 id="family-portal-title">Family &amp; people</h2></div>
          <button aria-label="Back to care" className="family-portal-close" onClick={() => requestFamilyExit(onClose)} type="button">×</button>
        </header>

        {!isSupabaseConfigured ? (
          <div className="family-portal-empty">
            <span className="family-portal-icon">✦</span>
            <h3>Connect your Supabase project</h3>
            <p>Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> to <code>.env.local</code>, then enable Google sign-in in Supabase.</p>
            <p>The migration and family setup UI are ready in this repo; project credentials are needed to create shared data.</p>
          </div>
        ) : loading ? (
          <div aria-live="polite" aria-busy="true" className="family-portal-loading"><span className="family-loading-spinner" />Loading your family workspace…</div>
        ) : !session ? (
          <div className="family-portal-empty">
            <span className="family-portal-icon">⌂</span>
            <h3>Sign in to get started</h3>
            <p>Create a family and give everyone their own account so the care log shows who did what. Add and manage cats from the Cats tab.</p>
            <div className="family-sign-in-actions">
              <GoogleSignInButton busy={busy} onClick={() => void signIn()} />
            </div>
          </div>
        ) : error && !family ? (
          <div className="family-portal-empty">
            <span className="family-portal-icon">↻</span>
            <h3>Couldn’t load your family yet</h3>
            <p>Check your connection, then refresh your family access.</p>
            <button className="family-primary-button" onClick={() => { setError(""); setLoading(true); setWorkspaceLoadTick((tick) => tick + 1); }} type="button">Try again</button>
          </div>
        ) : !family ? (
          <form className="family-create-form" onSubmit={(event) => void submitFamily(event)}>
            <div className="family-portal-user">Signed in as <strong>{session.user.email}</strong></div>
            <h3>Welcome to your family</h3>
            <p>If you were invited, your family may still be syncing. Refresh to check. Otherwise, create a family and invite your people.</p>
            <label>Family name<input maxLength={80} onChange={(event) => setFamilyName(event.target.value)} placeholder="The Lee family" required value={familyName} /></label>
            <div className="family-create-actions"><button className="family-secondary-button" onClick={() => { setLoading(true); setWorkspaceLoadTick((tick) => tick + 1); }} type="button">I was invited · Refresh</button><button className="family-primary-button" disabled={busy} type="submit">{busy ? "Creating…" : "Create family"}</button></div>
          </form>
        ) : (
          <div className="family-portal-content">
            <div className="family-portal-user">Signed in as <strong>{session.user.email}</strong><button onClick={() => void supabase?.auth.signOut()} type="button">Sign out</button></div>
            <div className="family-house">
            <div className="family-portal-columns">
              <section className="family-management-card">
                <div className="family-name-heading">
                  <div><span className="family-portal-eyebrow">Your family</span><strong>{family.name}</strong></div>
                  <button aria-label="Edit family name" className="family-edit-name-button" disabled={busy} onClick={() => { setFamilyNameDraft(family.name); setEditingFamilyName(true); }} type="button">
                    <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m10.9 2.1 3 3L6 13H3v-3l7.9-7.9Z" /><path d="m9.7 3.3 3 3" /></svg>
                  </button>
                </div>
                <div className="family-people-heading"><h3>People in this family</h3><span className="family-member-count">{members.length} {members.length === 1 ? "person" : "people"}</span></div>
                <ul className="family-member-list">
                  {members.map((member) => {
                    const memberName = member.display_name || member.email.split("@")[0];
                    const ownPhoto = member.user_id === session.user.id ? googleProfilePhoto(session.user) : undefined;
                    return (
                      <li key={member.id}>
                        <FamilyMemberAvatar name={memberName || member.email} photoUrl={member.avatar_url || ownPhoto} />
                        <span className="family-member-identity"><strong>{memberName}</strong><small>{member.email}</small><small className="family-member-status">{member.user_id ? "Joined" : "Added"}</small></span>
                        <button aria-label={`Edit name for ${memberName}`} className="family-edit-name-button" disabled={busy} onClick={() => { setEditingMemberId(member.id); setMemberNameDraft(memberName); }} type="button"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="m10.9 2.1 3 3L6 13H3v-3l7.9-7.9Z" /><path d="m9.7 3.3 3 3" /></svg></button>
                        {member.user_id !== session.user.id && <button aria-label={`Remove ${memberName} from family`} className="family-remove-button" disabled={busy} onClick={() => void removePerson(member)} title="Remove from family" type="button"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></svg></button>}
                      </li>
                    );
                  })}
                </ul>
                <form className="family-inline-form" onSubmit={(event) => void submitMember(event)}>
                  <input aria-label="Person name" onChange={(event) => setMemberName(event.target.value)} placeholder="Name" value={memberName} />
                  <input aria-label="Person email" onChange={(event) => setMemberEmail(event.target.value)} placeholder="Email address" required type="email" value={memberEmail} />
                  <button className="family-primary-button" disabled={busy} type="submit">Add person</button>
                </form>
              </section>

            </div>
            <section aria-label={`Cats in ${family.name}`} className="family-cats-section">
            <div className="family-cats-heading"><div><h3>Cats in {family.name}</h3><p>Every cat here is part of your family’s shared care.</p></div><button className="family-cats-manage" onClick={() => requestFamilyExit(onManageCats)} type="button">Manage cats</button></div>
            {cats.length ? <ul className="family-cats-list">{cats.map((cat) => <li key={cat.id}><button aria-label={`Care for ${cat.name}`} className="family-cat-link" onClick={() => requestFamilyExit(() => onSelectCat(cat.id))} type="button">{cat.photo ? <img alt="" src={cat.photo} /> : <span className="family-cat-summary-avatar" style={{ backgroundColor: cat.color }}>{cat.initial}</span>}<strong>{cat.name}</strong><span aria-hidden="true" className="family-cat-link-arrow">→</span></button></li>)}</ul> : <p className="family-cats-empty">No cats added yet.</p>}
            </section>
            {notice && <p className="family-feedback" role="status">{notice}</p>}
            </div>
          </div>
        )}
        {error && <p className="family-feedback is-error" role="status">{error}</p>}
        <footer className="family-portal-footer">
          <div className="family-portal-footer-actions">
            <button onClick={() => requestFamilyExit(onClose)} type="button">Back to care</button>
            {family && session && <button className="family-delete-button" disabled={busy} onClick={() => void removeFamily()} type="button">Delete family</button>}
          </div>
        </footer>
        {editingFamilyName && family && <div className={`modal-backdrop${closingEditDialog ? " is-closing" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) requestEditDialogClose(familyNameDraft.trim() !== family.name, () => setEditingFamilyName(false), () => setFamilyNameDraft(family.name)); }}>
          <form aria-labelledby="edit-family-name-title" aria-modal="true" className={`modal${closingEditDialog ? " is-closing" : ""}`} onSubmit={(event) => void saveFamilyName(event)} role="dialog">
            <span className="modal-icon">⌂</span>
            <h2 id="edit-family-name-title">Edit family name</h2>
            <p>This name is shared with everyone in your family.</p>
            <label>Family name<input maxLength={80} onChange={(event) => setFamilyNameDraft(event.target.value)} required value={familyNameDraft} /></label>
            <div className="modal-actions">
              <button disabled={busy || closingEditDialog} onClick={() => requestEditDialogClose(familyNameDraft.trim() !== family.name, () => setEditingFamilyName(false), () => setFamilyNameDraft(family.name))} type="button">Cancel</button>
              <button disabled={busy || closingEditDialog || !familyNameDraft.trim()} type="submit">{busy ? "Saving…" : "Save"}</button>
            </div>
          </form>
        </div>}
        {editingMemberId && <div className={`modal-backdrop${closingEditDialog ? " is-closing" : ""}`} onMouseDown={(event) => { const member = members.find((entry) => entry.id === editingMemberId); const baseName = member ? member.display_name || member.email.split("@")[0] : ""; if (event.target === event.currentTarget && !busy) requestEditDialogClose(memberNameDraft.trim() !== baseName, () => setEditingMemberId(null), () => setMemberNameDraft(baseName)); }}>
          <form aria-labelledby="edit-member-name-title" aria-modal="true" className={`modal${closingEditDialog ? " is-closing" : ""}`} onSubmit={(event) => { event.preventDefault(); const member = members.find((entry) => entry.id === editingMemberId); if (member) void saveMemberName(member); }} role="dialog">
            <span className="modal-icon">✎</span>
            <h2 id="edit-member-name-title">Edit family member name</h2>
            <p>This name appears to everyone in your family.</p>
            <label>Name<input maxLength={60} onChange={(event) => setMemberNameDraft(event.target.value)} required value={memberNameDraft} /></label>
            <div className="modal-actions">
              <button disabled={busy || closingEditDialog} onClick={() => { const member = members.find((entry) => entry.id === editingMemberId); const baseName = member ? member.display_name || member.email.split("@")[0] : ""; requestEditDialogClose(memberNameDraft.trim() !== baseName, () => setEditingMemberId(null), () => setMemberNameDraft(baseName)); }} type="button">Cancel</button>
              <button disabled={busy || closingEditDialog || !memberNameDraft.trim()} type="submit">{busy ? "Saving…" : "Save"}</button>
            </div>
          </form>
        </div>}
        {confirmation && <ConfirmDialog
          title={confirmation.title}
          description={confirmation.description}
          confirmLabel={confirmation.confirmLabel}
          busy={busy}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => { void confirmation.action().finally(() => setConfirmation(null)); }}
        />}
        {discardChanges && <ConfirmDialog
          title="Discard unsaved changes?"
          description="Your changes haven’t been saved. Leaving now will discard them."
          confirmLabel="Discard changes"
          onCancel={() => setDiscardChanges(null)}
          onConfirm={() => { const discard = discardChanges.action; setDiscardChanges(null); discard(); }}
        />}
      </section>
    </div>
  );
}
