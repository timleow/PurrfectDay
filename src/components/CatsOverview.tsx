import { useState } from "react";
import type { ChangeEvent } from "react";
import "./CatsOverview.css";

export type OverviewCat = { id: number | string; name: string; color: string; initial: string; photo?: string };
export type CatCareSummary = { treats: number; treatsGoal: number; kibble: number; kibbleGoal: number; cans: number; cansGoal: number; played: number; ears: boolean };

type Props = {
  cats: OverviewCat[];
  summaries: Record<string, CatCareSummary>;
  familyName?: string;
  error?: string;
  selectedId: number | string;
  onSelect: (id: number | string) => void;
  onAdd: () => void;
  onPhoto: (id: number | string, file?: File) => void;
  onRename: (cat: OverviewCat, name: string) => Promise<void>;
  onRemove: (cat: OverviewCat) => Promise<void>;
};

function progress(value: number, goal: number) { return Math.min(100, Math.round((value / Math.max(goal, 1)) * 100)); }

export default function CatsOverview({ cats, summaries, familyName, error, selectedId, onSelect, onAdd, onPhoto, onRename, onRemove }: Props) {
  const [editingId, setEditingId] = useState<number | string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function saveName(cat: OverviewCat) {
    if (!draft.trim()) return;
    setSaving(true);
    try { await onRename(cat, draft.trim()); setEditingId(null); setFeedback(""); }
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
      <button className="cats-add-button" onClick={onAdd} type="button">＋ <span>Add a cat</span></button>
    </header>
    {(error || feedback) && <p className="cats-feedback" role="status">{error || feedback}</p>}
    {cats.length ? <div className="cats-overview-grid">{cats.map((cat) => {
      const summary = summaries[String(cat.id)];
      const values = summary ? [
        ["Treats", summary.treats, summary.treatsGoal],
        ["Kibble", summary.kibble, summary.kibbleGoal],
        ["Wet food", summary.cans, summary.cansGoal],
      ] as const : [];
      return <article className={`cat-summary-card ${selectedId === cat.id ? "is-selected" : ""}`} key={cat.id}>
        <div className="cat-summary-head">
          {cat.photo ? <img className="cat-summary-avatar" src={cat.photo} alt={`${cat.name}`} /> : <span className="cat-summary-avatar cat-summary-initial" style={{ backgroundColor: cat.color }}>{cat.initial}</span>}
          <div className="cat-summary-name">{editingId === cat.id ? <input aria-label={`Name for ${cat.name}`} autoFocus maxLength={60} onChange={(event) => setDraft(event.target.value)} value={draft} /> : <h2>{cat.name}</h2>}<span>{selectedId === cat.id ? "Currently selected" : "Family cat"}</span></div>
          <button aria-label={`Track care for ${cat.name}`} className="cat-summary-track" onClick={() => onSelect(cat.id)} type="button">Care →</button>
        </div>
        {summary ? <div className="cat-summary-care">
          <h3>Today’s care</h3>
          {values.map(([label, value, goal]) => <div className="cat-summary-metric" key={label}><div><span>{label}</span><strong>{value} / {goal}</strong></div><span className="cat-summary-progress"><i style={{ width: `${progress(value, goal)}%` }} /></span></div>)}
          <div className="cat-summary-extras"><span>Play <strong>{summary.played}</strong></span><span>Ears <strong>{summary.ears ? "Done this week" : "Due this week"}</strong></span></div>
        </div> : <p className="cat-summary-no-data">Care summary will appear here.</p>}
        <div className="cat-summary-actions">
          <label className="cat-summary-action">{cat.photo ? "Change photo" : "Add photo"}<input accept="image/*,.heic,.heif" onChange={(event) => photoChanged(cat, event)} type="file" /></label>
          {editingId === cat.id ? <><button className="cat-summary-action" disabled={saving || !draft.trim()} onClick={() => void saveName(cat)} type="button">Save name</button><button className="cat-summary-action is-muted" onClick={() => setEditingId(null)} type="button">Cancel</button></> : <button className="cat-summary-action" onClick={() => { setDraft(cat.name); setEditingId(cat.id); }} type="button">Edit name</button>}
          <button className="cat-summary-action is-danger" onClick={() => void onRemove(cat)} type="button">Remove cat</button>
        </div>
      </article>;
    })}</div> : <div className="cats-empty"><span>🐾</span><h2>No cats yet</h2><p>Add your family’s first cat to start tracking their care.</p><button className="cats-add-button" onClick={onAdd} type="button">＋ Add a cat</button></div>}
  </main>;
}
