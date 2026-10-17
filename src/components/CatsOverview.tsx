import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import "./CatsOverview.css";

export type OverviewCat = { id: number | string; name: string; color: string; initial: string; photo?: string };
export type CatCareSummary = { treats: number; treatsGoal: number; kibble: number; kibbleGoal: number; cans: number; cansGoal: number; played: number; ears: boolean };

type Props = {
  cats: OverviewCat[];
  summaries: Record<string, CatCareSummary>;
  familyName?: string;
  onManageFamily?: () => void;
  error?: string;
  selectedId: number | string;
  onSelect: (id: number | string) => void;
  onAdd: () => void;
  onPhoto: (id: number | string, file?: File) => void;
  onRename: (cat: OverviewCat, name: string) => Promise<void>;
  onRemove: (cat: OverviewCat) => Promise<void>;
};

function progress(value: number, goal: number) { return Math.min(100, Math.round((value / Math.max(goal, 1)) * 100)); }

export default function CatsOverview({ cats, summaries, familyName, onManageFamily = () => {}, error, selectedId, onSelect, onAdd, onPhoto, onRename, onRemove }: Props) {
  const [editingId, setEditingId] = useState<number | string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [closingEditor, setClosingEditor] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const [feedback, setFeedback] = useState("");

  useEffect(() => () => { if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current); }, []);

  function closeEditor() {
    if (saving || closingEditor) return;
    setClosingEditor(true);
    closeTimer.current = window.setTimeout(() => {
      setEditingId(null);
      setClosingEditor(false);
    }, 180);
  }

  async function saveName(cat: OverviewCat) {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await onRename(cat, draft.trim());
      setFeedback("");
      setClosingEditor(true);
      closeTimer.current = window.setTimeout(() => { setEditingId(null); setClosingEditor(false); }, 180);
    }
    catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Could not update this cat’s name."); }
    finally { setSaving(false); }
  }

  function photoChanged(cat: OverviewCat, event: ChangeEvent<HTMLInputElement>) {
    onPhoto(cat.id, event.target.files?.[0]);
    event.target.value = "";
  }

  return <main className="cats-page" aria-labelledby="cats-page-title">
    <header className="cats-page-header">
      <div><span className="cats-eyebrow">A home for every whisker</span><h1 id="cats-page-title">{familyName ? `${familyName}’s cats` : "Your cats"}</h1><p>See how each cat is doing and manage their profiles.</p></div>
      {familyName && <button className="cats-add-button" onClick={onAdd} type="button">＋ <span>Add a cat</span></button>}
    </header>
    {(error || feedback) && <p className="cats-feedback" role="status">{error || feedback}</p>}
    {cats.length ? <div className="cats-overview-grid">{cats.map((cat) => {
      const summary = summaries[String(cat.id)];
      const values = summary ? [
        ["Treats", summary.treats, summary.treatsGoal],
        ["Kibble", summary.kibble, summary.kibbleGoal],
        ["Wet food", summary.cans, summary.cansGoal],
      ] as const : [];
      return <article
        aria-label={`${cat.name} cat care summary`}
        className={`cat-summary-card ${selectedId === cat.id ? "is-selected" : ""}`}
        key={cat.id}
        onClick={(event) => { if (!(event.target as HTMLElement).closest("button, input, label")) onSelect(cat.id); }}
        onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) { event.preventDefault(); onSelect(cat.id); } }}
        role="link"
        tabIndex={0}
      >
        <div className="cat-summary-head">
          {cat.photo ? <img className="cat-summary-avatar" src={cat.photo} alt={`${cat.name}`} /> : <span className="cat-summary-avatar cat-summary-initial" style={{ backgroundColor: cat.color }}>{cat.initial}</span>}
          <div className="cat-summary-name"><h2>{cat.name}</h2><span>{selectedId === cat.id ? "Currently selected" : "Tap to see care"}</span></div>
          <button aria-label={`Track care for ${cat.name}`} className="cat-summary-track" onClick={() => onSelect(cat.id)} type="button">Care →</button>
        </div>
        {summary ? <div className="cat-summary-care">
          <h3>Today’s care</h3>
          {values.map(([label, value, goal]) => {
            const icon = label === "Treats" ? "🍪" : label === "Kibble" ? "🥣" : "🍽️";
            return <div className="cat-summary-metric" key={label}><div><span><i aria-hidden="true">{icon}</i>{label}</span><strong>{value} / {goal}</strong></div><span className="cat-summary-progress"><i style={{ width: `${progress(value, goal)}%` }} /></span></div>;
          })}
          <div className="cat-summary-extras"><span><i aria-hidden="true">🧶</i> Play <strong>{summary.played}</strong></span><span><i aria-hidden="true">🧼</i> Ears <strong>{summary.ears ? "Done this week" : "Due this week"}</strong></span></div>
        </div> : <p className="cat-summary-no-data">Care summary will appear here.</p>}
        <div className="cat-summary-actions" onClick={(event) => event.stopPropagation()}>
          <label className="cat-summary-action">{cat.photo ? "Change photo" : "Add photo"}<input accept="image/*,.heic,.heif" onChange={(event) => photoChanged(cat, event)} type="file" /></label>
          <button className="cat-summary-action" onClick={() => { setDraft(cat.name); setEditingId(cat.id); }} type="button">Edit name</button>
          <button className="cat-summary-action is-danger" onClick={() => void onRemove(cat)} type="button">Remove cat</button>
        </div>
      </article>;
    })}</div> : <div className="cats-empty"><span aria-hidden="true">🐾</span>{familyName ? <><h2>No cats yet</h2><p>Add your family’s first cat to start tracking their care.</p><button className="cats-add-button" onClick={onAdd} type="button">＋ Add a cat</button></> : <><h2>Your cats start with family</h2><p>Create a family or ask someone to add your Google account. Then add your cats and share their care with everyone.</p><div className="cats-onboarding-actions"><button className="cats-add-button" onClick={onManageFamily} type="button">Create a family</button><button className="cats-family-link" onClick={onManageFamily} type="button">I was invited to a family</button></div></>}</div>}
    {editingId !== null && (() => {
      const cat = cats.find((entry) => entry.id === editingId);
      if (!cat) return null;
      return <div className={`modal-backdrop${closingEditor ? " is-closing" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}>
        <form aria-labelledby="edit-cat-name-title" className={`modal${closingEditor ? " is-closing" : ""}`} onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); void saveName(cat); }} role="dialog" aria-modal="true">
          <span className="modal-icon">🐾</span>
          <h2 id="edit-cat-name-title">Edit {cat.name}’s name</h2>
          <p>Everyone in your family will see this name.</p>
          <label>Cat name<input aria-label={`Name for ${cat.name}`} autoFocus maxLength={60} onChange={(event) => setDraft(event.target.value)} required value={draft} /></label>
          <div className="modal-actions">
            <button disabled={saving || closingEditor} onClick={closeEditor} type="button">Cancel</button>
            <button disabled={saving || closingEditor || !draft.trim()} type="submit">{saving ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </div>;
    })()}
  </main>;
}
