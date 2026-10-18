import { useState } from "react";
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
  onEdit: (id: number | string) => void;
  onRemove: (cat: OverviewCat) => Promise<void>;
};

function progress(value: number, goal: number) { return Math.min(100, Math.round((value / Math.max(goal, 1)) * 100)); }

export default function CatsOverview({ cats, summaries, familyName, onManageFamily = () => {}, error, selectedId, onSelect, onAdd, onEdit, onRemove }: Props) {
  const [feedback, setFeedback] = useState("");

  return <main className="cats-page" aria-labelledby="cats-page-title">
    <header className="cats-page-header">
      <div><span className="cats-eyebrow">A home for every whisker</span><h1 id="cats-page-title">{familyName ? `${familyName}’s cats` : "Your cats"}</h1><p>See how each cat is doing and manage their profiles.</p></div>
      {familyName && <button className="cats-add-button" onClick={onAdd} type="button">＋ <span>Add a cat</span></button>}
    </header>
    {(error || feedback) && <p className="cats-feedback" role="status">{error || feedback}</p>}
    {cats.length ? <div className="cats-overview-grid">{cats.map((cat) => {
      const summary = summaries[String(cat.id)];
      const values = summary ? [
        ["Treats", summary.treats, summary.treatsGoal, "treats"],
        ["Kibble", summary.kibble, summary.kibbleGoal, "kibble"],
        ["Wet food", summary.cans, summary.cansGoal, "wet"],
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
          {values.map(([label, value, goal, food]) => {
            const icon = label === "Treats" ? "🍪" : label === "Kibble" ? "🥣" : "🍽️";
            return <div className={`cat-summary-metric food-${food}`} key={label}><div><span><i aria-hidden="true">{icon}</i>{label}</span><strong>{value} / {goal}</strong></div><span className="cat-summary-progress"><i style={{ width: `${progress(value, goal)}%` }} /></span></div>;
          })}
          <div className="cat-summary-extras"><span><i aria-hidden="true">🧶</i> Play <strong>{summary.played}</strong></span><span><i aria-hidden="true">🧼</i> Ears <strong>{summary.ears ? "Done this week" : "Due this week"}</strong></span></div>
        </div> : <p className="cat-summary-no-data">Care summary will appear here.</p>}
        <div className="cat-summary-actions" onClick={(event) => event.stopPropagation()}>
          <button aria-label="Edit cat" className="cat-summary-action" onClick={() => onEdit(cat.id)} type="button"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m14.5 5.5 4 4M4 20l4.2-.9L19 7.3 16.7 5 5.9 15.8 4 20Z" /></svg><span>Edit cat</span></button>
          <button aria-label="Remove cat" className="cat-summary-action is-danger" onClick={() => void onRemove(cat)} type="button"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></svg><span>Remove cat</span></button>
        </div>
      </article>;
    })}</div> : <div className="cats-empty"><span aria-hidden="true">🐾</span>{familyName ? <><h2>No cats yet</h2><p>Add your family’s first cat to start tracking their care.</p><button className="cats-add-button" onClick={onAdd} type="button">＋ Add a cat</button></> : <><h2>Your cats start with family</h2><p>Create a family or ask someone to add your Google account. Then add your cats and share their care with everyone.</p><div className="cats-onboarding-actions"><button className="cats-add-button" onClick={onManageFamily} type="button">Create a family</button><button className="cats-family-link" onClick={onManageFamily} type="button">I was invited to a family</button></div></>}</div>}
  </main>;
}
