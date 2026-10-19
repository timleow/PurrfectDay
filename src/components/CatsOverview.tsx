import { useState } from "react";
import CareIcon from "./CareIcon";
import "./CatsOverview.css";

export type OverviewCat = { id: number | string; name: string; color: string; initial: string; photo?: string };
export type CatFoodProgress = { treats: number; treatsGoal: number; kibble: number; kibbleGoal: number; wetFood: number; wetFoodGoal: number };
type Props = {
  cats: OverviewCat[];
  foodProgress?: Record<string, CatFoodProgress>;
  familyName?: string;
  onManageFamily?: () => void;
  error?: string;
  selectedId: number | string;
  onSelect: (id: number | string) => void;
  onAdd: () => void;
  onEdit: (id: number | string) => void;
  onRemove: (cat: OverviewCat) => Promise<void>;
};

export default function CatsOverview({ cats, foodProgress = {}, familyName, onManageFamily = () => {}, error, selectedId, onSelect, onAdd, onEdit, onRemove }: Props) {
  const [feedback, setFeedback] = useState("");

  return <main className="cats-page" aria-labelledby="cats-page-title">
    <header className="cats-page-header">
      <div><span className="cats-eyebrow">A home for every whisker</span><h1 id="cats-page-title">{familyName ? `${familyName}’s cats` : "Your cats"}</h1><p>Choose a cat to care for, or manage their profile.</p></div>
      {familyName && <button className="cats-add-button" onClick={onAdd} type="button">＋ <span>Add a cat</span></button>}
    </header>
    {(error || feedback) && <p className="cats-feedback" role="status">{error || feedback}</p>}
    {cats.length ? <div className="cats-overview-grid">{cats.map((cat) => {
      const food = foodProgress[String(cat.id)] ?? { treats: 0, treatsGoal: 4, kibble: 0, kibbleGoal: 3, wetFood: 0, wetFoodGoal: 1 };
      const amount = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
      return <article
        aria-label={`${cat.name} cat`}
        className={`cat-summary-card ${selectedId === cat.id ? "is-selected" : ""}`}
        key={cat.id}
        onClick={(event) => { if (!(event.target as HTMLElement).closest("button, input, label")) onSelect(cat.id); }}
        onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) { event.preventDefault(); onSelect(cat.id); } }}
        role="link"
        tabIndex={0}
      >
        <div className="cat-summary-head">
          {cat.photo ? <img className="cat-summary-avatar" src={cat.photo} alt={`${cat.name}`} /> : <span className="cat-summary-avatar cat-summary-initial" style={{ backgroundColor: cat.color }}>{cat.initial}</span>}
          <div className="cat-summary-name"><h2>{cat.name}</h2><span>{selectedId === cat.id ? "Currently selected" : "Ready for care"}</span></div>
          <button aria-label={`Track care for ${cat.name}`} className="cat-summary-track" onClick={() => onSelect(cat.id)} type="button">Care →</button>
        </div>
        <div aria-label={`${cat.name} food today`} className="cat-summary-food">
          <span aria-label={`Dental treats: ${amount(food.treats)} of ${amount(food.treatsGoal)}`} className="cat-summary-food-item treats" title="Dental treats"><CareIcon name="treat" size={15} /><strong>{amount(food.treats)} / {amount(food.treatsGoal)}</strong></span>
          <span aria-label={`Kibble: ${amount(food.kibble)} of ${amount(food.kibbleGoal)}`} className="cat-summary-food-item kibble" title="Kibble"><CareIcon name="bowl" size={15} /><strong>{amount(food.kibble)} / {amount(food.kibbleGoal)}</strong></span>
          <span aria-label={`Wet food: ${amount(food.wetFood)} of ${amount(food.wetFoodGoal)}`} className="cat-summary-food-item wet-food" title="Wet food"><CareIcon name="medical" size={15} /><strong>{amount(food.wetFood)} / {amount(food.wetFoodGoal)}</strong></span>
        </div>
        <div className="cat-summary-actions" onClick={(event) => event.stopPropagation()}>
          <button aria-label="Edit cat" className="cat-summary-action" onClick={() => onEdit(cat.id)} type="button"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m14.5 5.5 4 4M4 20l4.2-.9L19 7.3 16.7 5 5.9 15.8 4 20Z" /></svg><span>Edit cat</span></button>
          <button aria-label="Remove cat" className="cat-summary-action is-danger" onClick={() => void onRemove(cat)} type="button"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></svg><span>Remove cat</span></button>
        </div>
      </article>;
    })}</div> : <div className="cats-empty"><CareIcon name="paw" size={34} />{familyName ? <><h2>No cats yet</h2><p>Add your family’s first cat to start tracking their care.</p><button className="cats-add-button" onClick={onAdd} type="button">＋ Add a cat</button></> : <><h2>Your cats start with family</h2><p>Create a family or ask someone to add your Google account. Then add your cats and share their care with everyone.</p><div className="cats-onboarding-actions"><button className="cats-add-button" onClick={onManageFamily} type="button">Create a family</button><button className="cats-family-link" onClick={onManageFamily} type="button">I was invited to a family</button></div></>}</div>}
  </main>;
}
