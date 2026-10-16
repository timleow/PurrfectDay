import { useEffect, useState, type FormEvent } from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  addFamilyMember,
  createFamily,
  getMyFamily,
  listFamilyMembers,
  removeFamilyMember,
  updateFamily,
  type Family,
  type FamilyMember,
} from "../data/familyService";
import { isSupabaseConfigured, supabase } from "../data/supabase";
import GoogleSignInButton from "./GoogleSignInButton";
import "./FamilyPortal.css";

function deviceTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

type FamilyPortalCat = { id: number | string; name: string; color: string; initial: string; photo?: string };

export default function FamilyPortal({ onClose, cats = [], onManageCats = () => {} }: { onClose: () => void; cats?: FamilyPortalCat[]; onManageCats?: () => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [family, setFamily] = useState<Family | null>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [familyName, setFamilyName] = useState("");
  const [memberName, setMemberName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
    let active = true;
    setLoading(true);
    void loadWorkspace(session.user).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [session?.user.id]);

  async function loadWorkspace(user: User) {
    try {
      const currentFamily = await getMyFamily(user.id);
      if (!currentFamily) {
        setFamily(null);
        setMembers([]);
        return;
      }
      const currentMembers = await listFamilyMembers(currentFamily.id);
      setFamily(currentFamily);
      setMembers(currentMembers);
      setFamilyName(currentFamily.name);
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

  async function saveFamilySettings(event: FormEvent) {
    event.preventDefault();
    if (!family) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await updateFamily(family.id, { name: familyName });
      setFamily({ ...family, name: familyName.trim() });
      setNotice("Family settings saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save family settings.");
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
      setMembers(await listFamilyMembers(family.id));
      setNotice("Added to the family. They can sign in with this email to access it.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add that person.");
    } finally {
      setBusy(false);
    }
  }

  async function removePerson(member: FamilyMember) {
    if (member.user_id === session?.user.id) return;
    const displayName = member.display_name || member.email;
    if (!window.confirm(`Remove ${displayName} from the family?`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await removeFamilyMember(member.id);
      setMembers((current) => current.filter((entry) => entry.id !== member.id));
      setNotice(`${displayName} was removed from the family.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove that person.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="family-portal-page">
      <section aria-labelledby="family-portal-title" className="family-portal" role="region">
        <header className="family-portal-header">
          <div><span className="family-portal-eyebrow">Shared care</span><h2 id="family-portal-title">Family &amp; people</h2></div>
          <button aria-label="Back to care" className="family-portal-close" onClick={onClose} type="button">×</button>
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
        ) : !family ? (
          <form className="family-create-form" onSubmit={(event) => void submitFamily(event)}>
            <div className="family-portal-user">Signed in as <strong>{session.user.email}</strong></div>
            <h3>Create your family</h3>
            <p>This account can belong to one family. Your device timezone is set automatically. You can add people by email right after setup.</p>
            <label>Family name<input autoFocus maxLength={80} onChange={(event) => setFamilyName(event.target.value)} placeholder="The Lee family" required value={familyName} /></label>
            <button className="family-primary-button" disabled={busy} type="submit">{busy ? "Creating…" : "Create family"}</button>
          </form>
        ) : (
          <div className="family-portal-content">
            <div className="family-portal-user">Signed in as <strong>{session.user.email}</strong><button onClick={() => void supabase?.auth.signOut()} type="button">Sign out</button></div>
            <form className="family-settings-row" onSubmit={(event) => void saveFamilySettings(event)}>
              <div className="family-settings-fields">
                <span className="family-portal-eyebrow">Your family</span>
                <label>Family name<input maxLength={80} onChange={(event) => setFamilyName(event.target.value)} required value={familyName} /></label>
              </div>
              <div className="family-settings-actions">
                <span className="family-member-count">{members.length} {members.length === 1 ? "person" : "people"}</span>
                <button className="family-primary-button" disabled={busy} type="submit">Save settings</button>
              </div>
            </form>

            <div className="family-portal-columns">
              <section className="family-management-card">
                <h3>People in this family</h3>
                <p>Add them directly. They can sign in with this email to join.</p>
                <form className="family-inline-form" onSubmit={(event) => void submitMember(event)}>
                  <input aria-label="Person name" onChange={(event) => setMemberName(event.target.value)} placeholder="Name" value={memberName} />
                  <input aria-label="Person email" onChange={(event) => setMemberEmail(event.target.value)} placeholder="Email address" required type="email" value={memberEmail} />
                  <button className="family-primary-button" disabled={busy} type="submit">Add person</button>
                </form>
                <ul className="family-member-list">
                  {members.map((member) => (
                    <li key={member.id}>
                      <span className="family-person-avatar">{(member.display_name || member.email)[0]?.toUpperCase()}</span>
                      <span className="family-member-identity"><strong>{member.display_name || member.email.split("@")[0]}</strong><small>{member.email}</small><small className="family-member-status">{member.user_id ? "Joined" : "Added"}</small></span>
                      {member.user_id !== session.user.id && <button aria-label={`Remove ${member.display_name || member.email} from family`} className="family-remove-button" disabled={busy} onClick={() => void removePerson(member)} type="button">Remove</button>}
                    </li>
                  ))}
                </ul>
              </section>

            </div>
            <section aria-label={`Cats in ${family.name}`} className="family-cats-section">
              <div className="family-cats-heading"><div><h3>Cats in {family.name}</h3><p>Every cat here is part of your family’s shared care.</p></div><button className="family-cats-manage" onClick={onManageCats} type="button">Manage cats</button></div>
              {cats.length ? <ul className="family-cats-list">{cats.map((cat) => <li key={cat.id}>{cat.photo ? <img alt="" src={cat.photo} /> : <span className="family-cat-summary-avatar" style={{ backgroundColor: cat.color }}>{cat.initial}</span>}<strong>{cat.name}</strong></li>)}</ul> : <p className="family-cats-empty">No cats added yet.</p>}
            </section>
            {notice && <p className="family-feedback" role="status">{notice}</p>}
          </div>
        )}
        {error && <p className="family-feedback is-error" role="status">{error}</p>}
        <footer className="family-portal-footer"><span>All family members can edit family settings, people, and cats.</span><button onClick={onClose} type="button">Back to care</button></footer>
      </section>
    </div>
  );
}
