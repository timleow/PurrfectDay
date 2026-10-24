import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Session } from "@supabase/supabase-js";
import CareIcon, { type IconName } from "./components/CareIcon";
import AnalyticsPage from "./components/AnalyticsPage";
import FamilyPortal from "./components/FamilyPortal";
import ConfirmDialog from "./components/ConfirmDialog";
import SignInScreen from "./components/SignInScreen";
import { blobToDataUrl, compressCatPhoto, cropCatPhoto } from "./data/catPhoto";
import { addDateKeyDays, dateKeyInZone, getFamilyCareWindow, startOfDayInZone } from "./data/dateWindows";
import { batchCareLogs, getCareLogDelta, getLogMetric, metricLabels, metricUnits, removeUndoneCareLogs } from "./data/careLogBatching";
import type { CareLog, TrackableKey } from "./data/careLogBatching";
import { debounce } from "./data/debounce";
import { clearWorkspaceCache, readWorkspaceCache, writeWorkspaceCache } from "./data/workspaceCache";
import { canUndoCareAction, undoNumericDelta, undoWetFoodDelta } from "./data/undoCareAction";
import { moveCareAction } from "./data/careActionOrder";
import {
  addCat as addCloudCat,
  getCatPhotoUrl,
  getMyFamily,
  listCareEvents,
  listCats as listCloudCats,
  listFamilyMembers,
  listTargets,
  recordCareEvent,
  saveTarget,
  saveFamilyCareActions,
  archiveCat as archiveCloudCat,
  updateCat as updateCloudCat,
  uploadCatPhoto,
  type CareEvent,
  type CloudCat,
  type Family,
  type FamilyMember,
  type TargetRule,
  type CareActionConfig,
} from "./data/familyService";
import { isSupabaseConfigured, supabase } from "./data/supabase";



type Cat = {
  id: number | string;
  name: string;
  color: string;
  initial: string;
  photo?: string;
};

type Tracker = {
  [key: string]: number | boolean | string;
  treats: number;
  kibble: number;
  cans: number;
  canProgress: number;
  treatsGoal: number;
  kibbleGoal: number;
  cansGoal: number;
  teethPawing: number;
  fountain: number;
  pooped: number;
  peed: number;
  ears: boolean;
  played: number;
  earsWeek: string;
};

type PendingCareAction = {
  id: string;
  catId: string;
  metric: string;
  amountDelta: number;
  timestamp: string;
  eventId?: string;
};

type UndoAction = { id: string; eventId: string; catId: number | string; metric: string; amountDelta: number; actorUserId?: string; timestamp: number };

type PickerOption = { value: string; label: string; icon: IconName };
const actionIconOptions: Array<PickerOption & { animation: CareActionConfig["animation"] }> = [
  { value: "paw", label: "Paw", icon: "paw", animation: "paw" },
  { value: "heart", label: "Heart", icon: "heart", animation: "subtle" },
  { value: "bowl", label: "Food bowl", icon: "bowl", animation: "chomp" },
  { value: "treat", label: "Dental treat", icon: "treat", animation: "chomp" },
  { value: "medical", label: "Wet food", icon: "medical", animation: "chomp" },
  { value: "drop", label: "Water drop", icon: "drop", animation: "water" },
  { value: "ear", label: "Ear", icon: "ear", animation: "ears" },
  { value: "yarn", label: "Yarn toy", icon: "yarn", animation: "play" },
  { value: "poop", label: "Poop", icon: "poop", animation: "poop" },
  { value: "pee", label: "Pee", icon: "pee", animation: "pee" },
  { value: "sparkle", label: "Sparkle", icon: "sparkle", animation: "playful" },
  { value: "play", label: "Playtime", icon: "play", animation: "play" },
  { value: "check", label: "Done", icon: "check", animation: "subtle" },
  { value: "outside", label: "Outside time", icon: "outside", animation: "outside" },
  { value: "chewToy", label: "Chew toy", icon: "chewToy", animation: "chomp" },
];
const actionColors = [
  { value: "treat-green", label: "Garden green", icon: "sparkle" as IconName },
  { value: "kibble-brown", label: "Biscuit brown", icon: "bowl" as IconName },
  { value: "wet-beige", label: "Cream", icon: "heart" as IconName },
  { value: "aqua", label: "Water blue", icon: "drop" as IconName },
  { value: "berry", label: "Berry pink", icon: "heart" as IconName },
  { value: "lilac", label: "Lilac", icon: "sparkle" as IconName },
  { value: "blueberry", label: "Blueberry", icon: "drop" as IconName },
  { value: "peachy", label: "Peach", icon: "sun" as IconName },
  { value: "purple", label: "Lavender", icon: "yarn" as IconName },
];
const behaviorOptions: PickerOption[] = [{ value: "numeric", label: "Number counter", icon: "chart" }, { value: "percentage", label: "Percentage", icon: "chart" }, { value: "toggle", label: "Done / undone", icon: "check" }];
const targetOptions: PickerOption[] = [{ value: "none", label: "No target", icon: "minus" }, { value: "daily", label: "Daily", icon: "calendar" }, { value: "weekly", label: "Weekly", icon: "calendar" }, { value: "monthly", label: "Monthly", icon: "calendar" }];

function ChoicePicker({ label, value, options, onChange }: { label: string; value: string; options: PickerOption[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", onKeyDown); };
  }, [open]);

  return <div className="choice-picker" ref={rootRef}>
    <span className="choice-picker-label">{label}</span>
    <button aria-expanded={open} aria-haspopup="listbox" className="choice-picker-trigger" onClick={() => setOpen((isOpen) => !isOpen)} type="button">
      <span className="choice-picker-selection"><Icon name={selected.icon} size={19} />{selected.label}</span><span className="choice-picker-chevron"><Icon name="chevron" size={16} /></span>
    </button>
    {open && <div aria-label={label} className="choice-picker-options" role="listbox">
      {options.map((option) => <button aria-selected={option.value === value} className="choice-picker-option" key={option.value} onClick={() => { onChange(option.value); setOpen(false); }} role="option" type="button">
        <Icon name={option.icon} size={19} /><span>{option.label}</span>{option.value === value && <span className="choice-picker-check"><Icon name="check" size={16} /></span>}
      </button>)}
    </div>}
  </div>;
}

const tileLabels: Partial<Record<TrackableKey, string>> = {
  treats: "Treats",
  kibble: "Kibble",
  cans: "Wet food",
  teethPawing: "Teeth",
  fountain: "Water",
  pooped: "Poop",
  peed: "Pee",
  ears: "Ears",
  played: "Play",
};

const metricIcons: Partial<Record<TrackableKey, IconName>> = {
  treats: "treat",
  kibble: "bowl",
  cans: "medical",
  teethPawing: "paw",
  fountain: "drop",
  pooped: "poop",
  peed: "pee",
  ears: "ear",
  played: "yarn",
};

const metricColorClasses: Partial<Record<TrackableKey, string>> = {
  treats: "treat-green",
  kibble: "kibble-brown",
  cans: "wet-beige",
  teethPawing: "berry",
  fountain: "aqua",
  pooped: "lilac",
  peed: "blueberry",
  ears: "peachy",
  played: "purple",
};

const databaseMetrics: Partial<Record<TrackableKey, string>> = {
  treats: "treats",
  kibble: "kibble",
  cans: "wet_food",
  teethPawing: "teeth_pawing",
  fountain: "fountain",
  pooped: "poop",
  peed: "pee",
  ears: "ear_cleaning",
  played: "play",
};

const appMetrics = Object.fromEntries(Object.entries(databaseMetrics).map(([appKey, dbKey]) => [dbKey, appKey])) as Record<string, TrackableKey>;
const defaultCareActions: CareActionConfig[] = [
  { key: "treats", name: "Dental treats", shortName: "Treats", icon: "treat", color: "treat-green", unit: "treats", behavior: "numeric", targetCadence: "daily", targetAmount: 4, animation: "playful" },
  { key: "kibble", name: "Spoons of kibble", shortName: "Kibble", icon: "bowl", color: "kibble-brown", unit: "spoons", behavior: "numeric", targetCadence: "daily", targetAmount: 3, animation: "playful" },
  { key: "cans", name: "Cans of wet food", shortName: "Wet food", icon: "medical", color: "wet-beige", unit: "cans", behavior: "numeric", targetCadence: "daily", targetAmount: 1, animation: "playful" },
  { key: "fountain", name: "Fountain top-up", shortName: "Water", icon: "drop", color: "aqua", unit: "times", behavior: "numeric", targetCadence: "none", targetAmount: null, animation: "playful" },
  { key: "teethPawing", name: "Pawing at teeth", shortName: "Teeth", icon: "paw", color: "berry", unit: "times", behavior: "numeric", targetCadence: "none", targetAmount: null, animation: "playful" },
  { key: "ears", name: "Ears cleaned", shortName: "Ears", icon: "ear", color: "peachy", unit: "times", behavior: "toggle", targetCadence: "weekly", targetAmount: 1, animation: "playful" },
  { key: "played", name: "Playtime", shortName: "Play", icon: "play", color: "purple", unit: "sessions", behavior: "numeric", targetCadence: "none", targetAmount: null, animation: "play" },
  { key: "pooped", name: "Pooped today", shortName: "Poop", icon: "poop", color: "lilac", unit: "times", behavior: "numeric", targetCadence: "none", targetAmount: null, animation: "playful" },
  { key: "peed", name: "Peed today", shortName: "Pee", icon: "pee", color: "blueberry", unit: "times", behavior: "numeric", targetCadence: "none", targetAmount: null, animation: "playful" },
];
const legacyAnimationByAction: Record<string, CareActionConfig["animation"]> = {
  treats: "chomp", kibble: "chomp", cans: "chomp", played: "play", fountain: "water",
  peed: "pee", pooped: "poop", teethPawing: "paw", ears: "ears",
};

function actionTapAnimation(action: CareActionConfig): CareActionConfig["animation"] {
  return action.animation === "playful"
    ? action.key === "cans" && action.targetCadence !== "daily" ? "playful" : legacyAnimationByAction[action.key] ?? "playful"
    : action.animation;
}

function CareActionPreview({ action, onEditAppearance }: { action: CareActionConfig; onEditAppearance: () => void }) {
  const [amount, setAmount] = useState(0);
  const [toggleDone, setToggleDone] = useState(false);
  const [burst, setBurst] = useState(0);
  const animation = actionTapAnimation(action);
  const goal = action.targetCadence === "none" ? undefined : Number(action.targetAmount ?? 1);
  const currentAmount = action.behavior === "toggle" ? Number(toggleDone) : amount;
  const isWetFoodPercentage = action.key === "cans" && action.targetCadence === "daily";
  const displayAmount = isWetFoodPercentage
    ? `${Math.floor(amount)}${Math.round((amount % 1) * 100) ? ` · ${Math.round((amount % 1) * 100)}%` : ""}`
    : action.behavior === "percentage" ? `${Math.round(currentAmount)}%`
      : Number.isInteger(currentAmount) ? String(currentAmount) : currentAmount.toFixed(1);
  const tap = () => {
    if (action.behavior === "toggle") setToggleDone((value) => !value);
    else setAmount((value) => value + (isWetFoodPercentage ? 0.1 : action.behavior === "percentage" ? 10 : 1));
    setBurst((value) => value + 1);
  };

  return <div aria-label="Interactive care action preview" className={`care-action-preview-box ${action.color} metric-${action.key}`}>
    <button aria-label="Change care action icon and colour" className="care-action-preview-icon is-editable" onClick={onEditAppearance} title="Change icon and colour" type="button"><Icon name={action.icon as IconName} size={32} /></button>
    <strong className="care-action-preview-name">{action.shortName.trim() || action.name.trim() || "Care action"}</strong>
    {action.behavior === "toggle" ? <span className="care-action-preview-count">{toggleDone ? "Done" : "Not yet"}{goal ? ` · ${action.targetCadence}` : ""}</span> : <span className="care-action-preview-count">{displayAmount}{goal ? ` / ${goal}${action.behavior === "percentage" && !isWetFoodPercentage ? "%" : ""}` : !isWetFoodPercentage && action.behavior !== "percentage" && action.unit ? ` ${action.unit}` : ""}</span>}
    {goal && <GoalProgress className="care-action-preview-progress" value={currentAmount} goal={goal} />}
    <button className="tap-prompt" onClick={tap} type="button"><Icon name={action.behavior === "toggle" && toggleDone ? "check" : "plus"} size={16} />{action.behavior === "toggle" ? toggleDone ? "Tap to undo" : "Tap when done" : isWetFoodPercentage || action.behavior === "percentage" ? "Tap to add 10%" : "Tap to add one"}</button>
    {burst > 0 && animation !== "none" && <div aria-hidden="true" className={`metric-scene tap-animation-${animation} variant-${burst % 3}`} key={burst}>
      {animation === "chomp" && <div className="chomp-cat"><span className="chomp-ear left" /><span className="chomp-ear right" /><i className="chomp-eye left" /><i className="chomp-eye right" /><b className="chomp-mouth"><i /></b><em className="food-bit" /></div>}
      {animation === "play" && <div className="play-scene"><i className="string" /><b className="toy" /><span className="swipe-paw"><i /><i /><i /></span></div>}
      {animation === "outside" && <div className="outside-scene"><Icon name="catLounging" size={72} /><i /></div>}
      {animation === "pee" && <div className="pee-scene"><Icon name="pee" size={58} /></div>}
      {animation === "water" && <div className="droplet-scene"><i /><i /><i /><i /><i /></div>}
      {animation === "poop" && <div className="poop-scene"><span className="poop"><i /><i /><i /></span><b className="fly fly-one"><i /></b><b className="fly fly-two"><i /></b></div>}
      {animation === "paw" && <div className="paw-scene"><Icon name="paw" size={54} /><i /><i /></div>}
      {animation === "ears" && <div className="ear-scene"><Icon name="ear" size={60} /><i className="ear-drop ear-drop-left" /><i className="ear-drop ear-drop-right" /></div>}
      <div className="tap-burst"><b>{action.behavior === "toggle" ? toggleDone ? "Done!" : "Undo" : isWetFoodPercentage || action.behavior === "percentage" ? "+10%" : "+1"}</b><i /><i /><i /><i /><i /></div>
    </div>}
  </div>;
}

function metricToDatabase(key: string) { return databaseMetrics[key as TrackableKey] ?? key; }
function metricFromDatabase(metric: string): string { return appMetrics[metric] ?? metric; }
function careActionFor(actions: CareActionConfig[], key: string) { return actions.find((action) => action.key === key); }
function usesPercentageQuantifier(action: CareActionConfig) { return action.behavior === "percentage"; }
function readHiddenCareActionKeys() {
  try { return JSON.parse(localStorage.getItem("purrfect-hidden-care-actions") ?? "[]") as string[]; }
  catch { return []; }
}
function mergeCareActions(saved?: CareActionConfig[] | null, deletedKeys: string[] = []): CareActionConfig[] {
  const hiddenKeys = new Set([ ...deletedKeys, ...(saved ?? []).filter((action) => action.deleted).map((action) => action.key) ]);
  const merged = defaultCareActions.filter((action) => !hiddenKeys.has(action.key)).map((action) => ({ ...action }));
  for (const action of saved ?? []) {
    if (action.deleted) continue;
    const index = merged.findIndex((item) => item.key === action.key);
    if (index >= 0) merged[index] = { ...merged[index], ...action, animation: action.animation ?? "playful" };
    else if (action.key && action.key.startsWith("custom:")) merged.push({ ...action, animation: action.animation ?? "playful" });
  }
  if (saved?.length) {
    const savedOrder = new Map(saved.map((action, index) => [action.key, index]));
    return merged.map((action, index) => ({ action, index })).sort((left, right) => {
      const leftOrder = savedOrder.get(left.action.key);
      const rightOrder = savedOrder.get(right.action.key);
      if (leftOrder === undefined) return rightOrder === undefined ? left.index - right.index : 1;
      if (rightOrder === undefined) return -1;
      return leftOrder - rightOrder;
    }).map(({ action }) => action);
  }
  return merged;
}

function trackerFromCloud(catId: string, events: CareEvent[], targets: TargetRule[], timezone: string, actions: CareActionConfig[] = defaultCareActions): Tracker {
  const window = getFamilyCareWindow(timezone);
  const dayStart = new Date(window.todayFrom).getTime();
  const tomorrow = new Date(window.tomorrowFrom).getTime();
  const weekStart = new Date(window.weekFrom).getTime();
  const catEvents = events.filter((event) => event.cat_id === catId);
  const sum = (metric: string, from: number, until: number) => catEvents
    .filter((event) => event.metric === metric && new Date(event.occurred_at).getTime() >= from && new Date(event.occurred_at).getTime() < until)
    .reduce((total, event) => total + Number(event.amount_delta), 0);
  const goal = (metric: string, cadence: "daily" | "weekly" | "monthly", fallback: number) => {
    const rule = targets
      .filter((item) => item.cat_id === catId && item.metric === metric && item.cadence === cadence && item.effective_from <= window.today && (!item.effective_until || item.effective_until >= window.today))
      .sort((left, right) => right.effective_from.localeCompare(left.effective_from))[0];
    return Number(rule?.target_amount ?? fallback);
  };
  const wetAmount = Math.max(0, sum("wet_food", dayStart, tomorrow));
  const wholeCans = Math.floor(wetAmount + 0.000001);
  const dynamicEntries = actions.flatMap((action) => {
    let from = dayStart;
    if (action.targetCadence === "weekly") from = weekStart;
    if (action.targetCadence === "monthly") from = new Date(startOfDayInZone(`${window.today.slice(0, 7)}-01`, timezone)).getTime();
    const total = sum(metricToDatabase(action.key), from, tomorrow);
    const value = action.behavior === "toggle"
      ? total > 0
      : action.key === "cans" && action.targetCadence === "daily"
        ? wholeCans
        : Math.max(0, total);
    const entry: Array<[string, number | boolean]> = [[action.key, value]];
    if (action.key === "cans") entry.push(["canProgress", action.targetCadence === "daily" ? Math.round((wetAmount - wholeCans) * 100) : 0]);
    if (action.targetCadence !== "none" && action.targetAmount) {
      const cadence = action.targetCadence === "weekly" ? "weekly" : action.targetCadence === "monthly" ? "monthly" : "daily";
      const targetMetric = metricToDatabase(action.key);
      entry.push([`${action.key}Goal`, goal(targetMetric, cadence, action.targetAmount)]);
    }
    return entry;
  });
  const dynamicValues = Object.fromEntries(dynamicEntries);
  return {
    ...emptyTracker,
    treats: Math.max(0, sum("treats", dayStart, tomorrow)),
    kibble: Math.max(0, sum("kibble", dayStart, tomorrow)),
    cans: wholeCans,
    canProgress: Math.round((wetAmount - wholeCans) * 100),
    treatsGoal: goal("treats", "daily", 4),
    kibbleGoal: goal("kibble", "daily", 3),
    cansGoal: goal("wet_food", "daily", 1),
    teethPawing: Math.max(0, sum("teeth_pawing", dayStart, tomorrow)),
    fountain: Math.max(0, sum("fountain", dayStart, tomorrow)),
    pooped: Math.max(0, sum("poop", dayStart, tomorrow)),
    peed: Math.max(0, sum("pee", dayStart, tomorrow)),
    ears: sum("ear_cleaning", weekStart, tomorrow) > 0,
    earsWeek: sum("ear_cleaning", weekStart, tomorrow) > 0 ? window.weekStart : "",
    played: Math.max(0, sum("play", dayStart, tomorrow)),
    ...dynamicValues,
  };
}

function careLogsFromCloud(events: CareEvent[], members: FamilyMember[], userId: string, fallbackName: string, timezone: string): CareLog[] {
  const endOfToday = new Date(getFamilyCareWindow(timezone).tomorrowFrom);
  const actorNames = new Map(members.map((member) => [member.user_id, member.display_name || member.email.split("@")[0]]));
  return events.filter((event) => new Date(event.occurred_at) < endOfToday).flatMap((event) => {
    const metric = metricFromDatabase(event.metric);
    return [{
      id: event.id,
      catId: event.cat_id,
      metric,
      icon: event.action_icon_snapshot ?? undefined,
      unit: event.action_unit_snapshot ?? event.unit,
      actorUserId: event.actor_user_id,
      who: actorNames.get(event.actor_user_id) ?? (event.actor_user_id === userId ? fallbackName : "Family member"),
      what: event.action_name_snapshot ?? metricLabels[metric] ?? careActionFor(defaultCareActions, metric)?.name ?? metric,
      detail: event.detail,
      timestamp: event.occurred_at,
      amountDelta: Number(event.amount_delta),
      reversesEventId: event.reverses_event_id,
    } satisfies CareLog];
  });
}

function applyCareAction(tracker: Tracker, metric: string, amountDelta: number): Tracker {
  if (metric === "cans") {
    const amount = Math.max(0, tracker.cans + tracker.canProgress / 100 + amountDelta);
    const cans = Math.floor(amount + 0.000001);
    return { ...tracker, cans, canProgress: Math.round((amount - cans) * 100) };
  }
  if (metric === "ears") {
    return { ...tracker, [metric]: amountDelta > 0 };
  }
  return { ...tracker, [metric]: Math.max(0, Number(tracker[metric]) + amountDelta) };
}

function conciseLogAction(detail: string) {
  if (detail === "Marked done") return "Done";
  if (detail === "Undid this check-in") return "Undone";
  const added = detail.match(/^Added (.+)$/);
  if (added) return `+${added[1].replace(/ (treats|spoons|cans|sessions|times)$/, "")}`;
  const removed = detail.match(/^Removed (.+)$/);
  if (removed) return `−${removed[1].replace(/ (treats|spoons|cans|sessions|times)$/, "")}`;
  const completed = detail.match(/^Completed (.+)$/);
  if (completed) return `+${completed[1]}`;
  return detail;
}

const breakdownQuestions: Partial<Record<TrackableKey, string>> = {
  treats: "Who fed?",
  kibble: "Who fed?",
  cans: "Who fed?",
  teethPawing: "Who noticed?",
  fountain: "Who refilled?",
  pooped: "Who saw?",
  peed: "Who saw?",
  ears: "Who cleaned?",
  played: "Who played?",
};

const emptyTracker: Tracker = {
  treats: 0,
  kibble: 0,
  cans: 0,
  canProgress: 0,
  treatsGoal: 4,
  kibbleGoal: 3,
  cansGoal: 1,
  teethPawing: 0,
  fountain: 0,
  pooped: 0,
  peed: 0,
  ears: false,
  played: 0,
  earsWeek: "",
};

function getLocalWeekKey(date = new Date()) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return toLocalDateInput(monday);
}

function loadTrackers(saved: string | null): Record<string, Tracker> {
  if (!saved) return { 1: { ...emptyTracker } };
  const parsed = JSON.parse(saved) as Record<string, Partial<Tracker> & { played?: number | boolean; pooped?: number | boolean; peed?: number | boolean }>;
  return Object.fromEntries(
    Object.entries(parsed).map(([id, tracker]) => [
      Number(id),
      {
        ...emptyTracker,
        ...tracker,
        fountain: typeof tracker.fountain === "number" ? tracker.fountain : tracker.fountain ? 1 : 0,
        played: typeof tracker.played === "number" ? tracker.played : tracker.played ? 1 : 0,
        pooped: typeof tracker.pooped === "number" ? tracker.pooped : tracker.pooped ? 1 : 0,
        peed: typeof tracker.peed === "number" ? tracker.peed : tracker.peed ? 1 : 0,
        earsWeek: tracker.earsWeek ?? (tracker.ears ? getLocalWeekKey() : ""),
      },
    ]),
  );
}

const Icon = CareIcon;

function CatAvatar({
  cat,
  size = "normal",
}: {
  cat: Cat;
  size?: "normal" | "large";
}) {
  const [loadedUrl, setLoadedUrl] = useState("");
  const [failedUrl, setFailedUrl] = useState("");
  const loaded = Boolean(cat.photo && loadedUrl === cat.photo);
  const failed = Boolean(cat.photo && failedUrl === cat.photo);

  return (
    <div
      className={`cat-avatar ${size === "large" ? "cat-avatar-large" : ""}${cat.photo && !loaded && !failed ? " is-loading" : ""}`}
      style={{ "--cat-color": cat.color } as React.CSSProperties}
    >
      <span className={`cat-avatar-fallback${loaded ? " is-hidden" : ""}`}>
          <span className="cat-ear cat-ear-left" />
          <span className="cat-ear cat-ear-right" />
          <span className="cat-face">
            <i />
            <b>{cat.initial}</b>
            <i />
          </span>
      </span>
      {cat.photo && !failed && <img
        alt={cat.name}
        className={`cat-photo${loaded ? " is-loaded" : ""}`}
        decoding="async"
        key={cat.photo}
        loading="lazy"
        onError={() => setFailedUrl(cat.photo ?? "")}
        onLoad={() => setLoadedUrl(cat.photo ?? "")}
        src={cat.photo}
      />}
    </div>
  );
}

function readCatPhoto(file: File): Promise<string> {
  return compressCatPhoto(file).then(blobToDataUrl);
}

type PhotoPosition = { x: number; y: number };

function CatPhotoCropEditor({
  photo,
  position,
  onPositionChange,
  zoom,
  onZoomChange,
}: {
  photo: string;
  position: PhotoPosition;
  onPositionChange: (position: PhotoPosition) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
}) {
  const [previewPosition, setPreviewPosition] = useState(position);
  const [previewZoom, setPreviewZoom] = useState(zoom);
  const positionRef = useRef(position);
  const zoomRef = useRef(zoom);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; width: number; height: number; current: PhotoPosition } | null>(null);
  const clamp = (value: number) => Math.min(100, Math.max(0, value));
  const updatePosition = (next: PhotoPosition) => {
    positionRef.current = next;
    setPreviewPosition(next);
  };
  const updateZoom = (next: number) => {
    zoomRef.current = next;
    setPreviewZoom(next);
  };
  const commitPosition = () => onPositionChange(positionRef.current);
  const commitZoom = () => onZoomChange(zoomRef.current);

  useEffect(() => {
    positionRef.current = position;
    zoomRef.current = zoom;
    setPreviewPosition(position);
    setPreviewZoom(zoom);
  }, [position.x, position.y, zoom]);

  return <div className="cat-photo-crop-section">
    <div
      aria-label="Cat photo circular crop preview. Drag the photo to adjust the crop."
      className="cat-photo-crop-preview"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        const bounds = event.currentTarget.getBoundingClientRect();
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: positionRef.current.x, originY: positionRef.current.y, width: bounds.width, height: bounds.height, current: positionRef.current };
      }}
      onPointerMove={(event) => {
        const currentDrag = drag.current;
        if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;
        currentDrag.current = {
          x: clamp(currentDrag.originX - ((event.clientX - currentDrag.startX) / currentDrag.width) * 100),
          y: clamp(currentDrag.originY - ((event.clientY - currentDrag.startY) / currentDrag.height) * 100),
        };
        updatePosition(currentDrag.current);
      }}
      onPointerUp={() => { if (drag.current) updatePosition(drag.current.current); drag.current = null; commitPosition(); }}
      onPointerCancel={() => { if (drag.current) updatePosition(drag.current.current); drag.current = null; commitPosition(); }}
      role="group"
      style={{ touchAction: "none" }}
    >
      <img alt="" draggable={false} src={photo} style={{ objectPosition: `${previewPosition.x}% ${previewPosition.y}%`, transform: `translateZ(0) scale(${previewZoom})`, transformOrigin: `${previewPosition.x}% ${previewPosition.y}%`, willChange: "object-position, transform" }} />
      <span aria-hidden="true" className="cat-photo-crop-frame" />
    </div>
    <p>Drag the photo to choose what appears in the circle.</p>
    <div className="cat-photo-crop-controls">
      <label className="cat-photo-zoom-control">
        Zoom · {zoom.toFixed(1)}×
        <input aria-label="Zoom photo" max="3" min="1" onBlur={commitZoom} onChange={(event) => { const next = Number(event.target.value); updateZoom(next); onZoomChange(next); }} onKeyUp={commitZoom} onPointerUp={commitZoom} step="0.1" type="range" value={previewZoom} />
      </label>
      <label>
        Horizontal crop
        <input aria-label="Horizontal photo crop" max="100" min="0" onBlur={commitPosition} onChange={(event) => { const next = { ...positionRef.current, x: Number(event.target.value) }; updatePosition(next); onPositionChange(next); }} onKeyUp={commitPosition} onPointerUp={commitPosition} type="range" value={previewPosition.x} />
      </label>
      <label>
        Vertical crop
        <input aria-label="Vertical photo crop" max="100" min="0" onBlur={commitPosition} onChange={(event) => { const next = { ...positionRef.current, y: Number(event.target.value) }; updatePosition(next); onPositionChange(next); }} onKeyUp={commitPosition} onPointerUp={commitPosition} type="range" value={previewPosition.y} />
      </label>
    </div>
  </div>;
}

function errorMessage(cause: unknown, fallback: string) {
  if (cause instanceof Error && cause.message) return cause.message;
  if (cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string") return cause.message;
  return fallback;
}

function toLocalDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromLocalDateInput(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function withWorkspaceTimeout<T>(request: Promise<T>): Promise<T> {
  let timeout: number | undefined;
  return Promise.race([
    request,
    new Promise<T>((_, reject) => {
      timeout = window.setTimeout(() => reject(new Error("Family data is taking too long to load. Check your connection and try again.")), 15000);
    }),
  ]).finally(() => { if (timeout !== undefined) window.clearTimeout(timeout); });
}

function CareLogPanel({
  cat,
  logs,
  memberName,
  onMemberNameChange,
  timezone,
  cloudMode,
  expanded,
  onToggle,
}: {
  cat: Cat;
  logs: CareLog[];
  memberName: string;
  onMemberNameChange: (name: string) => void;
  timezone?: string;
  cloudMode?: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const catLogs = logs.filter((entry) => String(entry.catId) === String(cat.id));
  const [period, setPeriod] = useState<"today" | "day" | "week">("today");
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const activeTimezone = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const selectedKey = period === "today" ? dateKeyInZone(new Date(), activeTimezone) : toLocalDateInput(selectedDate);
  const dateParts = selectedKey.split("-").map(Number);
  const selectedWeekday = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2])).getUTCDay();
  const rangeStartKey = period === "week" ? addDateKeyDays(selectedKey, -((selectedWeekday + 6) % 7)) : selectedKey;
  const rangeEndKey = addDateKeyDays(rangeStartKey, period === "week" ? 7 : 1);
  const start = new Date(startOfDayInZone(rangeStartKey, activeTimezone));
  const end = new Date(startOfDayInZone(rangeEndKey, activeTimezone));
  const periodLogs = catLogs.filter((entry) => {
    const timestamp = new Date(entry.timestamp);
    return timestamp >= start && timestamp < end;
  });
  const visibleLogs = batchCareLogs(removeUndoneCareLogs(periodLogs));
  const periodLabel = period === "today"
    ? `Today · ${new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: activeTimezone }).format(start)}`
    : period === "day"
    ? new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: activeTimezone }).format(start)
    : `${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: activeTimezone }).format(start)} – ${new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: activeTimezone }).format(new Date(end.getTime() - 1))}`;
  const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: activeTimezone,
  });

  const movePeriod = (direction: -1 | 1) => {
    const currentKey = period === "today" ? selectedKey : toLocalDateInput(selectedDate);
    const nextDate = fromLocalDateInput(currentKey);
    nextDate.setDate(nextDate.getDate() + direction * (period === "week" ? 7 : 1));
    setSelectedDate(() => {
      return nextDate;
    });
    if (period === "today") setPeriod("day");
  };

  return (
    <section className={`activity-log ${expanded ? "is-expanded" : ""}`} aria-label={`${cat.name} activity log`}>
      <button className="activity-log-toggle" aria-expanded={expanded} onClick={onToggle} type="button">
        <span className="activity-log-heading">
          <span className="activity-log-title">
            <span className="activity-log-title-icon"><Icon name="calendar" size={16} /></span>
            <strong>Care log</strong>
          </span>
          <span className="activity-log-summary">
            <span className="activity-log-count">{visibleLogs.length} {visibleLogs.length === 1 ? "activity" : "activities"}</span>
            <span className="activity-log-chevron" aria-hidden="true">⌄</span>
          </span>
        </span>
      </button>
      <div aria-hidden={!expanded} className={`activity-log-content-shell ${expanded ? "is-open" : ""}`} inert={!expanded}>
      <div className="activity-log-content">
      {!cloudMode && <>
        <label className="member-name-field">
          Your name on this device
          <input maxLength={32} onChange={(event) => onMemberNameChange(event.target.value)} placeholder="e.g. Alex" value={memberName} />
        </label>
        <p className="activity-log-note">Names and logs are saved in this browser for now.</p>
      </>}
      <div className="log-period-controls">
        <div className="log-period-tabs" aria-label="Choose log period">
          <button aria-pressed={period === "today"} onClick={() => { setSelectedDate(new Date()); setPeriod("today"); }} type="button">Today</button>
          <button aria-pressed={period === "day"} onClick={() => setPeriod("day")} type="button">By day</button>
          <button aria-pressed={period === "week"} onClick={() => setPeriod("week")} type="button">By week</button>
        </div>
        <div className="log-date-nav">
          <button aria-label={`Previous ${period === "today" ? "day" : period}`} onClick={() => movePeriod(-1)} type="button">‹</button>
          <input aria-label="Choose a date" onChange={(event) => { if (!event.target.value) return; setSelectedDate(fromLocalDateInput(event.target.value)); setPeriod("day"); }} type="date" value={selectedKey} />
          <button aria-label={`Next ${period === "today" ? "day" : period}`} onClick={() => movePeriod(1)} type="button">›</button>
        </div>
        <strong className="log-period-label">{periodLabel}</strong>
      </div>
      {visibleLogs.length ? (
        <ol className="activity-log-list">
          {visibleLogs.map((entry) => (
            <li key={entry.id}>
              <span className={`activity-log-dot ${metricColorClasses[getLogMetric(entry)] ?? "aqua"} metric-${getLogMetric(entry)}`}><Icon name={(entry.icon as IconName) ?? metricIcons[getLogMetric(entry)] ?? "paw"} size={13} /></span>
              <div><strong>{entry.what || tileLabels[getLogMetric(entry)] || getLogMetric(entry)}</strong><small>{conciseLogAction(entry.detail)} · by {entry.who}</small></div>
              <time dateTime={entry.timestamp}>{dateTimeFormat.format(new Date(entry.timestamp))}</time>
            </li>
          ))}
        </ol>
      ) : (
        <p className="activity-log-empty">No care entries {period === "today" ? "for today" : `for this ${period}`}. Choose another date or track a care action to start the log.</p>
      )}
      </div>
      </div>
    </section>
  );
}

function Stepper({
  value,
  onChange,
  accent,
  goal,
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  accent: string;
  goal?: number;
  label?: string;
}) {
  return (
    <div className="stepper" style={{ "--accent": accent } as React.CSSProperties}>
      <button
        aria-label={label ? `Decrease ${label}` : "Decrease"}
        disabled={value === 0}
        onClick={() => onChange(Math.max(0, value - 1))}
      >
        <Icon name="minus" size={16} />
      </button>
      <strong aria-label={label ? `${label}: ${value}` : undefined}>{goal ? <>{value}<small>/{goal}</small></> : value}</strong>
      <button aria-label={label ? `Increase ${label}` : "Increase"} onClick={() => onChange(value + 1)}>
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}

function GoalProgress({ value, goal, className = "", color }: { value: number; goal: number; className?: string; color?: string }) {
  const percent = Math.min(100, Math.max(0, (value / goal) * 100));
  return (
    <div className={`goal-progress ${className}`} style={color ? { "--progress-color": color } as React.CSSProperties : undefined} role="progressbar" aria-label="Daily goal progress" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(value, goal)}>
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}

function Toggle({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: React.ReactNode;
}) {
  return (
    <button
      aria-pressed={active}
      className={`toggle ${active ? "is-active" : ""}`}
      onClick={onClick}
      type="button"
    >
      <span>{active && <Icon name="check" size={13} />}</span>
      {label}
    </button>
  );
}

function playCareSound(kind: "peed" | "pooped") {
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const master = context.createGain();
  master.gain.setValueAtTime(0.0001, context.currentTime);
  master.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.015);
  master.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.48);
  master.connect(context.destination);

  const notes = kind === "peed"
    ? [{ frequency: 760, delay: 0 }, { frequency: 980, delay: 0.13 }, { frequency: 1180, delay: 0.25 }]
    : [{ frequency: 240, delay: 0 }, { frequency: 170, delay: 0.11 }, { frequency: 110, delay: 0.22 }];

  notes.forEach(({ frequency, delay }, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = kind === "peed" ? "sine" : index === 2 ? "square" : "triangle";
    oscillator.frequency.setValueAtTime(frequency, context.currentTime + delay);
    if (kind === "peed") {
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.72, context.currentTime + delay + 0.1);
    }
    gain.gain.setValueAtTime(0.0001, context.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + delay + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + delay + 0.13);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(context.currentTime + delay);
    oscillator.stop(context.currentTime + delay + 0.14);
  });

  window.setTimeout(() => void context.close(), 700);
}

function useExitAnimation(open: boolean, onClose: () => void) {
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) setClosing(false);
  }, [open]);
  useEffect(() => () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
  }, []);

  const dismiss = (afterClose?: () => void) => {
    if (!open || closing || timer.current !== undefined) return;
    setClosing(true);
    timer.current = window.setTimeout(() => {
      onCloseRef.current();
      afterClose?.();
      timer.current = undefined;
    }, 220);
  };
  return { closing, dismiss };
}

export default function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("purrfect-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [cats, setCats] = useState<Cat[]>(() => {
    const saved = localStorage.getItem("purrfect-cats");
    return saved ? JSON.parse(saved) : [];
  });
  const [selectedId, setSelectedId] = useState<number | string>(cats[0]?.id ?? "");
  const [trackers, setTrackers] = useState<Record<string, Tracker>>(() => loadTrackers(localStorage.getItem("purrfect-trackers")));
  const [showAddCat, setShowAddCat] = useState(false);
  const [addCatBusy, setAddCatBusy] = useState(false);
  const addCatBusyRef = useRef(false);
  const [activeTab, setActiveTab] = useState<"care" | "cats" | "family">("care");
  const [editingCareActions, setEditingCareActions] = useState(false);
  const [careActionOrderBaseline, setCareActionOrderBaseline] = useState<CareActionConfig[] | null>(null);
  const [careActionDeletionBaseline, setCareActionDeletionBaseline] = useState<string[] | null>(null);
  const [showDiscardCareActionOrder, setShowDiscardCareActionOrder] = useState(false);
  const pendingCareMenuExit = useRef<(() => void) | null>(null);
  const familyExitGuard = useRef<((action: () => void) => void) | null>(null);
  const [careActionOrderSaving, setCareActionOrderSaving] = useState(false);
  const [profileEditCatId, setProfileEditCatId] = useState<number | string | null>(null);
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [profilePhotoDraft, setProfilePhotoDraft] = useState<string | undefined>();
  const [profilePhotoPosition, setProfilePhotoPosition] = useState({ x: 50, y: 50 });
  const [profilePhotoZoom, setProfilePhotoZoom] = useState(1);
  const [profilePhotoLoading, setProfilePhotoLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatPhoto, setNewCatPhoto] = useState<string | undefined>();
  const [newCatPhotoPosition, setNewCatPhotoPosition] = useState({ x: 50, y: 50 });
  const [newCatPhotoZoom, setNewCatPhotoZoom] = useState(1);
  const [pendingCatRemoval, setPendingCatRemoval] = useState<Cat | null>(null);
  const [catRemovalBusy, setCatRemovalBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [memberName, setMemberName] = useState(() => localStorage.getItem("purrfect-member-name") ?? "");
  const [careLogs, setCareLogs] = useState<CareLog[]>(() => {
    const saved = localStorage.getItem("purrfect-care-logs");
    return saved ? JSON.parse(saved) : [];
  });
  const [cloudSession, setCloudSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured);
  const [authBusy, setAuthBusy] = useState(false);
  const [cloudFamily, setCloudFamily] = useState<Family | null>(null);
  const [cloudMembers, setCloudMembers] = useState<FamilyMember[]>([]);
  const [cloudEvents, setCloudEvents] = useState<CareEvent[]>([]);
  const pendingCareActions = useRef(new Map<string, PendingCareAction>());
  const pendingCareEventWrites = useRef(new Map<string, Promise<void>>());
  const cachedUserId = useRef<string | null>(null);
  const [cloudTargets, setCloudTargets] = useState<TargetRule[]>([]);
  const [careActions, setCareActions] = useState<CareActionConfig[]>(() => {
    try { return mergeCareActions(JSON.parse(localStorage.getItem("purrfect-care-actions") ?? "[]") as CareActionConfig[], readHiddenCareActionKeys()); }
    catch { return mergeCareActions(); }
  });
  const [careActionDeletions, setCareActionDeletions] = useState<string[]>(readHiddenCareActionKeys);
  const [pendingCareActionRemoval, setPendingCareActionRemoval] = useState<CareActionConfig | null>(null);
  const [editingActionKey, setEditingActionKey] = useState<string | null>(null);
  const [actionDraft, setActionDraft] = useState<CareActionConfig>(defaultCareActions[0]);
  const [showActionAppearance, setShowActionAppearance] = useState(false);
  const actionDraftBaseline = useRef("");
  const profileDraftBaseline = useRef("");
  const [discardDraft, setDiscardDraft] = useState<{ description: string; discard: () => void } | null>(null);
  const [actionSaving, setActionSaving] = useState(false);
  const [draggedActionKey, setDraggedActionKey] = useState<string | null>(null);
  const careActionLayoutBefore = useRef<Map<string, DOMRect> | null>(null);
  const careActionDragPreview = useRef<HTMLButtonElement | null>(null);
  const careActionDrag = useRef<{ key: string; pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number; moved: boolean; lastTargetKey: string | null } | null>(null);
  const careActionHold = useRef<{ pointerId: number; startX: number; startY: number; timer: number } | null>(null);
  const longPressActionKey = useRef<{ key: string; expiresAt: number } | null>(null);
  const suppressActionClick = useRef(false);
  const clearCareActionDrag = () => {
    const drag = careActionDrag.current;
    if (careActionHold.current) window.clearTimeout(careActionHold.current.timer);
    careActionHold.current = null;
    careActionDragPreview.current?.remove();
    careActionDragPreview.current = null;
    careActionDrag.current = null;
    if (drag) setDraggedActionKey(null);
  };
  const [cloudError, setCloudError] = useState("");
  const [cloudRefreshTick, setCloudRefreshTick] = useState(0);
  const [cloudWorkspaceLoading, setCloudWorkspaceLoading] = useState(isSupabaseConfigured);
  const [careLogExpanded, setCareLogExpanded] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showTrackPicker, setShowTrackPicker] = useState(false);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const ignoreNextTap = useRef(false);
  const [modeSwipeTransition, setModeSwipeTransition] = useState<{ direction: "next" | "previous"; key: number } | null>(null);
  const [activeMetric, setActiveMetric] = useState<TrackableKey>(() => {
    const savedMetric = localStorage.getItem("purrfect-active-metric");
    const trackableKeys: TrackableKey[] = ["treats", "kibble", "cans", "teethPawing", "fountain", "pooped", "peed", "ears", "played"];
    return trackableKeys.includes(savedMetric as TrackableKey) ? savedMetric as TrackableKey : "treats";
  });
  const [tapBurst, setTapBurst] = useState(0);
  const [undoActions, setUndoActions] = useState<UndoAction[]>([]);
  const [undoRevealUntil, setUndoRevealUntil] = useState(0);
  const [undoNow, setUndoNow] = useState(() => Date.now());
  const [showNotifications, setShowNotifications] = useState(false);
  const [pullGestureActive, setPullGestureActive] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const pullStart = useRef<{ x: number; y: number } | null>(null);
  const pullArmed = useRef(false);
  const catSwipeStart = useRef<{ x: number; y: number } | null>(null);
  const ignoreNextCatTap = useRef(false);
  const addCatExit = useExitAnimation(showAddCat, () => setShowAddCat(false));
  const actionEditorExit = useExitAnimation(editingActionKey !== null, () => setEditingActionKey(null));
  const profileExit = useExitAnimation(profileEditCatId !== null, () => setProfileEditCatId(null));
  const notificationsExit = useExitAnimation(showNotifications, () => setShowNotifications(false));
  const trackPickerExit = useExitAnimation(showTrackPicker, () => setShowTrackPicker(false));

  const requestDiscardableClose = (dirty: boolean, close: () => void, reset: () => void, description: string) => {
    if (!dirty) { close(); return; }
    setDiscardDraft({ description, discard: () => { reset(); close(); } });
  };

  useLayoutEffect(() => {
    const before = careActionLayoutBefore.current;
    careActionLayoutBefore.current = null;
    if (!before) return;
    document.querySelectorAll<HTMLElement>(".care-action-tile-wrap[data-action-key]").forEach((element) => {
      const key = element.dataset.actionKey;
      if (!key || key === draggedActionKey) return;
      const previous = before.get(key);
      if (!previous) return;
      const current = element.getBoundingClientRect();
      const deltaX = previous.left - current.left;
      const deltaY = previous.top - current.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
      element.animate(
        [{ transform: `translate(${deltaX}px, ${deltaY}px)` }, { transform: "translate(0, 0)" }],
        { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" },
      );
    });
  }, [careActions, draggedActionKey]);

  useEffect(() => {
    const cleanupPointerDrag = () => {
      if (careActionHold.current) window.clearTimeout(careActionHold.current.timer);
      careActionHold.current = null;
      if (!careActionDrag.current && !careActionDragPreview.current) return;
      clearCareActionDrag();
    };
    document.addEventListener("pointerup", cleanupPointerDrag);
    document.addEventListener("pointercancel", cleanupPointerDrag);
    window.addEventListener("blur", cleanupPointerDrag);
    return () => {
      document.removeEventListener("pointerup", cleanupPointerDrag);
      document.removeEventListener("pointercancel", cleanupPointerDrag);
      window.removeEventListener("blur", cleanupPointerDrag);
      careActionDragPreview.current?.remove();
      careActionDragPreview.current = null;
      careActionDrag.current = null;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("purrfect-theme", theme);
  }, [theme]);

  useEffect(() => {
    addCatExit.dismiss();
    clearCareActionDrag();
    setEditingCareActions(false);
    actionEditorExit.dismiss();
    profileExit.dismiss();
    notificationsExit.dismiss();
    trackPickerExit.dismiss();
    setShowBreakdown(false);
    setPendingCatRemoval(null);
  }, [activeTab]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const updateViewport = () => {
      const root = document.documentElement;
      root.style.setProperty("--visual-viewport-height", `${viewport?.height ?? window.innerHeight}px`);
      root.style.setProperty("--visual-viewport-top", `${viewport?.offsetTop ?? 0}px`);
    };
    const keepFocusedFieldVisible = (event: FocusEvent) => {
      const field = event.target instanceof HTMLElement ? event.target : null;
      const modal = field?.closest<HTMLElement>(".modal");
      if (!field || !modal) return;
      window.setTimeout(() => {
        if (!field.isConnected || !modal.isConnected) return;
        const viewportTop = viewport?.offsetTop ?? 0;
        const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
        const modalBounds = modal.getBoundingClientRect();
        const fieldBounds = field.getBoundingClientRect();
        const visibleTop = Math.max(modalBounds.top, viewportTop) + 16;
        const visibleBottom = Math.min(modalBounds.bottom, viewportBottom) - 16;
        const scrollDelta = fieldBounds.bottom > visibleBottom
          ? fieldBounds.bottom - visibleBottom
          : fieldBounds.top < visibleTop
            ? fieldBounds.top - visibleTop
            : 0;
        if (scrollDelta) modal.scrollTop += scrollDelta;
      }, 220);
    };
    updateViewport();
    viewport?.addEventListener("resize", updateViewport);
    viewport?.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", updateViewport);
    document.addEventListener("focusin", keepFocusedFieldVisible);
    return () => {
      viewport?.removeEventListener("resize", updateViewport);
      viewport?.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
      document.removeEventListener("focusin", keepFocusedFieldVisible);
      document.documentElement.style.removeProperty("--visual-viewport-height");
      document.documentElement.style.removeProperty("--visual-viewport-top");
    };
  }, []);

  useEffect(() => {
    const onTouchStart = (event: TouchEvent) => {
      if (window.scrollY > 1 || event.touches.length !== 1) {
        pullStart.current = null;
        pullArmed.current = false;
        return;
      }
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, button, a, [role='dialog'], .notification-popover, .activity-log-list, .track-picker-dialog")) {
        pullStart.current = null;
        return;
      }
      const touch = event.touches[0];
      pullStart.current = { x: touch.clientX, y: touch.clientY };
      pullArmed.current = false;
    };
    const onTouchMove = (event: TouchEvent) => {
      const start = pullStart.current;
      const touch = event.touches[0];
      if (!start || !touch) return;
      const deltaY = touch.clientY - start.y;
      const deltaX = touch.clientX - start.x;
      if (deltaY > 72 && deltaY > Math.abs(deltaX) * 1.25) {
        pullArmed.current = true;
        setPullGestureActive(true);
        event.preventDefault();
      }
    };
    const onTouchEnd = () => {
      const shouldRefresh = pullArmed.current;
      pullStart.current = null;
      pullArmed.current = false;
      setPullGestureActive(false);
      if (!shouldRefresh) return;
      setPullRefreshing(true);
      if (cloudSession?.user.id) setCloudRefreshTick((tick) => tick + 1);
      else {
        const localLogs = localStorage.getItem("purrfect-care-logs");
        const savedCats = localStorage.getItem("purrfect-cats");
        const localCats = savedCats ? JSON.parse(savedCats) as Cat[] : [];
        setCats(localCats);
        setSelectedId(localCats[0]?.id ?? "");
        setCareLogs(localLogs ? JSON.parse(localLogs) as CareLog[] : []);
        setPullRefreshing(false);
      }
      window.dispatchEvent(new Event("purrfect:pull-to-refresh"));
    };
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [cloudSession?.user.id]);

  useEffect(() => {
    if (!undoActions.length) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setUndoNow(now);
      setUndoActions((current) => current.filter((entry) => now - entry.timestamp <= 15000));
    }, 300);
    return () => window.clearInterval(timer);
  }, [undoActions.length]);

  const themeToggle = (
    <button
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      className="theme-toggle"
      onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
      type="button"
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
      <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
    </button>
  );

  const notificationReadKey = `purrfect-notifications-seen-at:${cloudSession?.user.id ?? "local"}`;
  const notificationsSeenAt = Number(localStorage.getItem(notificationReadKey) ?? 0);
  const currentMemberName = cloudFamily && cloudSession
    ? cloudMembers.find((member) => member.user_id === cloudSession.user.id)?.display_name || cloudSession.user.email?.split("@")[0] || "Family member"
    : memberName.trim() || "Family member";
  const notificationEntries = batchCareLogs(removeUndoneCareLogs(careLogs)
    .filter((entry) => {
      const delta = getCareLogDelta(entry);
      const isOwnAction = entry.actorUserId
        ? entry.actorUserId === cloudSession?.user.id
        : Boolean(currentMemberName && entry.who === currentMemberName);
      return !isOwnAction && (delta === undefined || delta > 0);
    }))
    .slice(0, 30);
  const unreadNotificationCount = notificationEntries.filter((entry) => new Date(entry.latestTimestamp ?? entry.timestamp).getTime() > notificationsSeenAt).length;
  const notificationTimezone = cloudFamily?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const todayNotificationKey = dateKeyInZone(new Date(), notificationTimezone);
  const yesterdayNotificationKey = addDateKeyDays(todayNotificationKey, -1);
  const notificationSections = notificationEntries.slice(0, 12).reduce<Array<{ key: string; label: string; entries: CareLog[] }>>((sections, entry) => {
    const key = dateKeyInZone(new Date(entry.timestamp), notificationTimezone);
    let section = sections.find((candidate) => candidate.key === key);
    if (!section) {
      const label = key === todayNotificationKey
        ? "Today"
        : key === yesterdayNotificationKey
          ? "Yesterday"
          : new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: notificationTimezone }).format(new Date(entry.timestamp));
      section = { key, label, entries: [] };
      sections.push(section);
    }
    section.entries.push(entry);
    return sections;
  }, []);
  const notificationCenter = (
    <div className="notification-center">
      <button aria-expanded={showNotifications} aria-label="Care notifications" className="notification-trigger" onClick={() => {
        if (showNotifications) notificationsExit.dismiss();
        else {
          setShowNotifications(true);
          localStorage.setItem(notificationReadKey, String(Date.now()));
        }
      }} type="button">
        <Icon name="bell" size={16} />
        {unreadNotificationCount > 0 && <span className="notification-badge">{unreadNotificationCount > 9 ? "9+" : unreadNotificationCount}</span>}
      </button>
      {(showNotifications || notificationsExit.closing) && <section aria-label="Recent care activity" className={`notification-popover${notificationsExit.closing ? " is-closing" : ""}`} role="dialog">
        <header><div><small>Family updates</small><h2>Recent care</h2></div><button aria-label="Close notifications" onClick={() => notificationsExit.dismiss()} type="button">×</button></header>
        {notificationEntries.length ? notificationSections.map((section) => <section className="notification-day" key={section.key} aria-label={section.label}>
          <h3>{section.label}</h3>
          <ol>{section.entries.map((entry) => {
            const metric = getLogMetric(entry);
            const catName = cats.find((cat) => String(cat.id) === String(entry.catId))?.name ?? "Cat";
            return <li key={entry.id}><button onClick={() => { setSelectedId(entry.catId); navigateTo("care"); notificationsExit.dismiss(); }} type="button"><span className={`notification-icon ${metricColorClasses[metric] ?? "aqua"}`}><Icon name={(entry.icon as IconName) ?? metricIcons[metric] ?? "paw"} size={15} /></span><span className="notification-copy"><strong>{entry.who} · {catName}</strong><small>{entry.what} · {entry.detail}</small></span><time dateTime={entry.timestamp}>{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: notificationTimezone }).format(new Date(entry.timestamp))}</time></button></li>;
          })}</ol>
        </section>) : <p className="notification-empty">Care check-ins from your family will show here.</p>}
        {unreadNotificationCount > 0 && <footer>{unreadNotificationCount} new {unreadNotificationCount === 1 ? "update" : "updates"}</footer>}
      </section>}
    </div>
  );

  useEffect(() => {
    localStorage.setItem("purrfect-active-metric", activeMetric);
  }, [activeMetric]);

  useEffect(() => {
    localStorage.setItem("purrfect-care-actions", JSON.stringify(careActions));
  }, [careActions]);
  useEffect(() => {
    localStorage.setItem("purrfect-hidden-care-actions", JSON.stringify(careActionDeletions));
  }, [careActionDeletions]);

  const requestCareMenuExit = (after?: () => void) => {
    const hasOrderChanges = Boolean(careActionOrderBaseline && (
      careActionOrderBaseline.length !== careActions.length ||
      careActionOrderBaseline.some((action, index) => action.key !== careActions[index]?.key) ||
      (careActionDeletionBaseline ?? []).join("|") !== careActionDeletions.join("|")
    ));
    const exit = after ?? (() => trackPickerExit.dismiss());
    if (editingCareActions && hasOrderChanges) {
      pendingCareMenuExit.current = exit;
      setShowDiscardCareActionOrder(true);
      return;
    }
    clearCareActionDrag();
    setEditingCareActions(false);
    setCareActionOrderBaseline(null);
    setCareActionDeletionBaseline(null);
    exit();
  };

  const discardCareActionOrder = () => {
    clearCareActionDrag();
    if (careActionOrderBaseline) setCareActions(careActionOrderBaseline);
    if (careActionDeletionBaseline) setCareActionDeletions(careActionDeletionBaseline);
    setEditingCareActions(false);
    setCareActionOrderBaseline(null);
    setCareActionDeletionBaseline(null);
    setShowDiscardCareActionOrder(false);
    const exit = pendingCareMenuExit.current;
    pendingCareMenuExit.current = null;
    exit?.();
  };

  useEffect(() => {
    if (!careActions.some((action) => action.key === activeMetric)) setActiveMetric((careActions[0]?.key ?? "treats") as TrackableKey);
  }, [careActions, activeMetric]);

  useEffect(() => {
    if (showTrackPicker) return;
    careActionDragPreview.current?.remove();
    careActionDragPreview.current = null;
    if (careActionDrag.current) setDraggedActionKey(null);
    careActionDrag.current = null;
  }, [showTrackPicker]);

  useEffect(() => {
    if (!showTrackPicker || trackPickerExit.closing) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestCareMenuExit();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [showTrackPicker, trackPickerExit.closing]);

  const navigateToRaw = (nextTab: "care" | "cats" | "family") => {
    if (nextTab === activeTab) return;
    if (showTrackPicker) requestCareMenuExit(() => setActiveTab(nextTab));
    else setActiveTab(nextTab);
  };
  const navigateTo = (nextTab: "care" | "cats" | "family") => {
    if (activeTab === "family" && nextTab !== "family" && familyExitGuard.current) {
      familyExitGuard.current(() => navigateToRaw(nextTab));
      return;
    }
    navigateToRaw(nextTab);
  };

  const returnToCare = () => navigateTo("care");

  const selectedCat = cats.find((cat) => cat.id === selectedId) ?? cats[0] ?? { id: "", name: "Your cat", color: "#79B8A9", initial: "?" };
  const analyticsGoals = useMemo(() => Object.fromEntries(cats.map((cat) => {
    const current = { ...emptyTracker, ...(trackers[String(cat.id)] ?? {}) };
    return [String(cat.id), { treatsGoal: current.treatsGoal, kibbleGoal: current.kibbleGoal, cansGoal: current.cansGoal }];
  })), [cats, trackers]);
  const savedTracker = { ...emptyTracker, ...(trackers[selectedId] ?? {}) };
  const tracker: Tracker = {
    ...savedTracker,
    ears: savedTracker.earsWeek === (cloudFamily ? getFamilyCareWindow(cloudFamily.timezone).weekStart : getLocalWeekKey()) && savedTracker.ears,
  };

  useEffect(() => {
    if (!cloudFamily) localStorage.setItem("purrfect-cats", JSON.stringify(cats));
  }, [cats, cloudFamily]);

  useEffect(() => {
    if (!cloudFamily) localStorage.setItem("purrfect-trackers", JSON.stringify(trackers));
  }, [trackers, cloudFamily]);

  useEffect(() => {
    localStorage.setItem("purrfect-member-name", memberName);
  }, [memberName]);

  useEffect(() => {
    if (!cloudFamily) localStorage.setItem("purrfect-care-logs", JSON.stringify(careLogs));
  }, [careLogs, cloudFamily]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      setCloudSession(data.session);
      setAuthLoading(false);
      if (error) setCloudError(error.message);
    }).catch((cause: unknown) => {
      if (!active) return;
      setAuthLoading(false);
      setCloudError(cause instanceof Error ? cause.message : "Could not check your sign-in.");
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setCloudSession(session);
      setAuthLoading(false);
      setCloudError("");
    });
    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const startGoogleSignIn = async () => {
    if (!supabase) return;
    setAuthBusy(true);
    setCloudError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setCloudError(error.message);
      setAuthBusy(false);
    }
  };

  useEffect(() => {
    if (!isSupabaseConfigured || !cloudSession?.user.id) {
      pendingCareActions.current.clear();
      cachedUserId.current = null;
      setCloudFamily(null);
      setCloudMembers([]);
      setCloudEvents([]);
      setCloudTargets([]);
      setCloudError("");
      setCloudWorkspaceLoading(false);
      if (!cloudSession) {
        const localLogs = localStorage.getItem("purrfect-care-logs");
        const savedCats = localStorage.getItem("purrfect-cats");
        const localCats = savedCats ? JSON.parse(savedCats) as Cat[] : [];
        setCats(localCats);
        setSelectedId(localCats[0]?.id ?? "");
        if (localCats.length === 0) setActiveTab("cats");
        setTrackers(loadTrackers(localStorage.getItem("purrfect-trackers")));
        setCareLogs(localLogs ? JSON.parse(localLogs) as CareLog[] : []);
        const hiddenActions = readHiddenCareActionKeys();
        setCareActionDeletions(hiddenActions);
        setCareActions(mergeCareActions(JSON.parse(localStorage.getItem("purrfect-care-actions") ?? "[]") as CareActionConfig[], hiddenActions));
      }
      return;
    }

    let active = true;
    setCloudError("");
    setCloudWorkspaceLoading(true);
    const userId = cloudSession.user.id;
    if (cachedUserId.current !== userId) {
      cachedUserId.current = userId;
      const cached = readWorkspaceCache(userId);
      if (cached) {
        const cachedCats: Cat[] = cached.cats.map((cat) => ({ id: cat.id, name: cat.name, color: cat.color, initial: cat.initial, photo: cat.photo }));
        const fallbackName = cloudSession.user.email?.split("@")[0] ?? "Family member";
        setCloudFamily(cached.family);
        const hiddenActions = cached.family.care_actions?.filter((action) => action.deleted).map((action) => action.key) ?? [];
        setCareActionDeletions(hiddenActions);
        setCareActions(mergeCareActions(cached.family.care_actions));
        setCloudMembers(cached.members);
        setCloudEvents(cached.events);
        setCloudTargets(cached.targets);
        setCats(cachedCats);
        setCareLogs(careLogsFromCloud(cached.events, cached.members, userId, fallbackName, cached.family.timezone));
        setTrackers(Object.fromEntries(cached.cats.map((cat) => [cat.id, trackerFromCloud(cat.id, cached.events, cached.targets, cached.family.timezone, mergeCareActions(cached.family.care_actions))])));
        setSelectedId((selected) => cachedCats.some((cat) => cat.id === selected) ? selected : cachedCats[0]?.id ?? "");
        if (!cachedCats.length) setActiveTab("cats");
        setCloudWorkspaceLoading(false);
      }
    }
    void (async () => {
      try {
        const family = await withWorkspaceTimeout(getMyFamily(cloudSession.user.id));
        if (!active) return;
        if (!family) {
          clearWorkspaceCache(userId);
          setCloudFamily(null);
          setCareActionDeletions([]);
          setCareActions(mergeCareActions());
          setCloudMembers([]);
          setCloudEvents([]);
          setCloudTargets([]);
          setCats([]);
          setSelectedId("");
          setActiveTab("cats");
          setTrackers({});
          setCareLogs([]);
          return;
        }
        const [remoteCats, members, targets, events] = await withWorkspaceTimeout(Promise.all([
          listCloudCats(family.id),
          listFamilyMembers(family.id),
          listTargets(family.id),
          listCareEvents(family.id, "1970-01-01T00:00:00.000Z", new Date(Date.now() + 86400000).toISOString()),
        ]));
        if (!active) return;
        const catsWithPhotos = await Promise.all(remoteCats.map(async (cat) => ({
          ...cat,
          photoUrl: cat.photo_path ? await getCatPhotoUrl(cat.photo_path).catch(() => undefined) : undefined,
        })));
        const appCats: Cat[] = catsWithPhotos.map((cat) => ({
          id: cat.id,
          name: cat.name,
          color: cat.color,
          initial: cat.name[0]?.toUpperCase() ?? "?",
          photo: cat.photoUrl,
        }));
        const actorNames = new Map(members.map((member) => [member.user_id, member.display_name || member.email.split("@")[0]]));
        const appLogs = careLogsFromCloud(events, members, userId, cloudSession.user.email?.split("@")[0] ?? "Family member", family.timezone);
        setCloudFamily(family);
        const hiddenActions = family.care_actions?.filter((action) => action.deleted).map((action) => action.key) ?? [];
        setCareActionDeletions(hiddenActions);
        setCareActions(mergeCareActions(family.care_actions));
        setCloudMembers(members);
        setCloudEvents(events);
        setCloudTargets(targets);
        setCats(appCats);
        writeWorkspaceCache(userId, {
          family,
          cats: catsWithPhotos.map((cat) => ({ ...cat, initial: cat.name[0]?.toUpperCase() ?? "?", photo: cat.photoUrl })),
          members,
          targets,
          events,
        });
        if (!appCats.length) {
          setActiveTab("cats");
          setShowAddCat(true);
        }
        setCareLogs(appLogs);
        setMemberName(actorNames.get(cloudSession.user.id) ?? cloudSession.user.email?.split("@")[0] ?? "Family member");
        const unmatchedEventIds = new Set(events.map((event) => event.id));
        for (const [actionId, action] of pendingCareActions.current) {
          const matchingEvent = events.find((event) => {
            if (!unmatchedEventIds.has(event.id)) return false;
            if (event.cat_id !== action.catId || event.actor_user_id !== cloudSession.user.id) return false;
            if (event.metric !== metricToDatabase(action.metric) || Math.abs(Number(event.amount_delta) - action.amountDelta) > 0.000001) return false;
            return action.eventId ? event.id === action.eventId : Math.abs(new Date(event.occurred_at).getTime() - new Date(action.timestamp).getTime()) <= 5;
          });
          if (matchingEvent) {
            unmatchedEventIds.delete(matchingEvent.id);
            pendingCareActions.current.delete(actionId);
          }
        }
        const pendingByCat = new Map<string, PendingCareAction[]>();
        for (const action of pendingCareActions.current.values()) {
          pendingByCat.set(action.catId, [...(pendingByCat.get(action.catId) ?? []), action]);
        }
        setTrackers(Object.fromEntries(remoteCats.map((cat) => {
          const baseTracker = trackerFromCloud(cat.id, events, targets, family.timezone, mergeCareActions(family.care_actions));
          const trackerWithPending = (pendingByCat.get(cat.id) ?? []).reduce(
            (current, action) => applyCareAction(current, action.metric, action.amountDelta),
            baseTracker,
          );
          return [cat.id, trackerWithPending];
        })));
        setSelectedId((selected) => appCats.some((cat) => cat.id === selected) ? selected : appCats[0]?.id ?? "");
      } catch (cause) {
        if (active) setCloudError(cause instanceof Error ? cause.message : "Could not load shared family data.");
      } finally {
        if (active) {
          setCloudWorkspaceLoading(false);
          setPullRefreshing(false);
        }
      }
    })();
    return () => { active = false; };
  }, [cloudSession?.user.id, cloudRefreshTick]);

  useEffect(() => {
    const client = supabase;
    const userId = cloudSession?.user.id;
    if (!client || !userId || cloudFamily) return;

    const refreshMembership = debounce(() => setCloudRefreshTick((tick) => tick + 1), 250);
    const channel = client.channel(`pending-family-${userId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "family_members",
        filter: `user_id=eq.${userId}`,
      }, refreshMembership)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refreshMembership();
      });
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshMembership();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      refreshMembership.cancel();
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      void client.removeChannel(channel);
    };
  }, [cloudSession?.user.id, cloudFamily?.id]);

  useEffect(() => {
    const client = supabase;
    if (!cloudFamily || !client) return;
    const refresh = debounce(() => setCloudRefreshTick((tick) => tick + 1), 400);
    const channel = client.channel(`family-${cloudFamily.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "care_events", filter: `family_id=eq.${cloudFamily.id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "cats", filter: `family_id=eq.${cloudFamily.id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "target_rules", filter: `family_id=eq.${cloudFamily.id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "family_members", filter: `family_id=eq.${cloudFamily.id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "families", filter: `id=eq.${cloudFamily.id}` }, refresh)
      .subscribe();
    return () => {
      refresh.cancel();
      void client.removeChannel(channel);
    };
  }, [cloudFamily?.id]);

  const addCareLog = (key: string, detail: string, amountDelta?: number, reversesEventId?: string) => {
    const action = careActionFor(careActions, key) ?? defaultCareActions[0];
    const who = cloudFamily && cloudSession
      ? cloudMembers.find((member) => member.user_id === cloudSession.user.id)?.display_name || cloudSession.user.email?.split("@")[0] || "Family member"
      : memberName.trim() || "Family member";
    const timestamp = new Date().toISOString();
    const eventId = crypto.randomUUID();
    if (cloudFamily && selectedCat && typeof selectedCat.id === "string") {
      if (cloudSession) clearWorkspaceCache(cloudSession.user.id);
      const inferredDelta = amountDelta ?? (detail === "Marked done" ? 1 : detail === "Undid this check-in" ? -1 : 1);
      const pendingAction: PendingCareAction = {
        id: crypto.randomUUID(),
        catId: selectedCat.id,
        metric: key,
        amountDelta: inferredDelta,
        timestamp,
      };
      pendingCareActions.current.set(pendingAction.id, pendingAction);
      const pendingWrite = (async () => {
        const originalWrite = reversesEventId ? pendingCareEventWrites.current.get(reversesEventId) : undefined;
        if (originalWrite) await originalWrite;
        const event = await recordCareEvent({
          id: eventId,
          family_id: cloudFamily.id,
          cat_id: selectedCat.id as string,
          metric: metricToDatabase(key),
          amount_delta: inferredDelta,
          unit: action.unit || metricUnits[key as TrackableKey] || "times",
          detail,
          occurred_at: timestamp,
          reverses_event_id: reversesEventId ?? null,
          action_name_snapshot: action.name,
          action_icon_snapshot: action.icon,
          action_unit_snapshot: action.unit,
        });
        const savedAction = pendingCareActions.current.get(pendingAction.id);
        if (savedAction) savedAction.eventId = event.id;
        const entry: CareLog = {
          id: event.id,
          catId: event.cat_id,
          metric: key,
          icon: action.icon,
          unit: action.unit,
          actorUserId: event.actor_user_id,
          who,
          what: action.name,
          detail: event.detail,
          timestamp: event.occurred_at,
          amountDelta: Number(event.amount_delta),
          reversesEventId: event.reverses_event_id,
        };
        setCloudEvents((current) => [event, ...current].slice(0, 500));
        setCareLogs((current) => [entry, ...current].slice(0, 500));
      })();
      pendingCareEventWrites.current.set(eventId, pendingWrite);
      void pendingWrite.catch((cause: unknown) => {
        pendingCareActions.current.delete(pendingAction.id);
        setTrackers((current) => {
          const latest = { ...emptyTracker, ...(current[pendingAction.catId] ?? {}) };
          return { ...current, [pendingAction.catId]: applyCareAction(latest, pendingAction.metric, -pendingAction.amountDelta) };
        });
        setCloudError(cause instanceof Error ? cause.message : "Could not save that care entry.");
        setCloudRefreshTick((tick) => tick + 1);
      });
      void pendingWrite.then(() => {
        if (pendingCareEventWrites.current.get(eventId) === pendingWrite) pendingCareEventWrites.current.delete(eventId);
      }, () => undefined);
      return eventId;
    }
    setCareLogs((current) => [
      {
        id: eventId,
        catId: selectedId,
        metric: key,
        icon: action.icon,
        unit: action.unit,
        who,
        what: action.name,
        detail,
        timestamp,
        amountDelta: amountDelta ?? (detail === "Marked done" ? 1 : detail === "Undid this check-in" ? -1 : undefined),
        reversesEventId,
      },
      ...current,
    ].slice(0, 500));
    return eventId;
  };

  const queueUndoAction = (catId: number | string, metric: string, amountDelta: number, eventId: string) => {
    const timestamp = Date.now();
    const action: UndoAction = { id: crypto.randomUUID(), eventId, catId, metric, amountDelta, actorUserId: cloudSession?.user.id, timestamp };
    setUndoActions((current) => [...current.filter((entry) => timestamp - entry.timestamp < 15000), action]);
    setUndoRevealUntil(timestamp + 10000);
    setUndoNow(timestamp);
  };

  const update = (key: keyof Tracker, value: number | boolean) => {
    const targetMetric: Partial<Record<keyof Tracker, { metric: string; unit: string }>> = {
      treatsGoal: { metric: "treats", unit: "treats" },
      kibbleGoal: { metric: "kibble", unit: "spoons" },
      cansGoal: { metric: "wet_food", unit: "cans" },
    };
    if (cloudFamily && selectedCat && typeof selectedCat.id === "string" && typeof value === "number" && targetMetric[key]) {
      if (cloudSession) clearWorkspaceCache(cloudSession.user.id);
      const target = targetMetric[key]!;
      const date = getFamilyCareWindow(cloudFamily.timezone).today;
      void saveTarget(cloudFamily.id, selectedCat.id, target.metric, "daily", value, target.unit, date)
        .catch((cause: unknown) => {
          setCloudError(cause instanceof Error ? cause.message : "Could not save the food goal.");
          setCloudRefreshTick((tick) => tick + 1);
        });
    }
    if (careActionFor(careActions, String(key))) {
      const metricKey = String(key);
      const action = careActionFor(careActions, metricKey)!;
      const previous = { ...emptyTracker, ...(trackers[selectedId] ?? {}) }[metricKey];
      let amountDelta = 0;
      if (typeof previous === "number" && typeof value === "number" && previous !== value) {
        amountDelta = value - previous;
        const difference = Math.abs(amountDelta);
        const unit = action.unit || "";
        const displayUnit = difference === 1 ? unit.replace(/s$/, "") : unit;
        const eventId = addCareLog(metricKey, `${amountDelta > 0 ? "Added" : "Removed"} ${difference}${displayUnit ? ` ${displayUnit}` : ""}`, amountDelta);
        queueUndoAction(selectedId, metricKey, amountDelta, eventId);
      } else if (typeof previous === "boolean" && typeof value === "boolean" && previous !== value) {
        amountDelta = value ? 1 : -1;
        const eventId = addCareLog(metricKey, value ? "Marked done" : "Undid this check-in", amountDelta);
        queueUndoAction(selectedId, metricKey, amountDelta, eventId);
      }
    }
    setTrackers((current) => ({
      ...current,
      [selectedId]: {
        ...emptyTracker,
        ...(current[selectedId] ?? {}),
        [key]: value,
        ...(key === "ears" ? { earsWeek: cloudFamily ? getFamilyCareWindow(cloudFamily.timezone).weekStart : getLocalWeekKey() } : {}),
      },
    }));
  };

  const openCareActionManager = () => {
    setEditingCareActions(false);
    setCareActionOrderBaseline(null);
    setCareActionDeletionBaseline(null);
    setShowTrackPicker(true);
  };

  const openActionEditor = (key?: string) => {
    const open = () => {
      const current = key ? careActionFor(careActions, key) : undefined;
      const draft = current ?? {
        key: `custom:${crypto.randomUUID()}`,
        name: "",
        shortName: "",
        icon: "play",
        color: "purple",
        unit: "times",
        behavior: "numeric" as const,
        targetCadence: "none" as const,
        targetAmount: null,
        animation: "play" as const,
      };
      const currentGoalKey = draft.key === "treats" ? "treatsGoal" : draft.key === "kibble" ? "kibbleGoal" : draft.key === "cans" ? "cansGoal" : draft.key + "Goal";
      const savedGoal = tracker[currentGoalKey];
      setActionDraft({ ...draft, targetAmount: draft.targetCadence === "none" ? null : Number(savedGoal ?? draft.targetAmount ?? 1) });
      setShowActionAppearance(false);
      actionDraftBaseline.current = JSON.stringify({ ...draft, targetAmount: draft.targetCadence === "none" ? null : Number(savedGoal ?? draft.targetAmount ?? 1) });
      setEditingActionKey(draft.key);
    };
    if (showTrackPicker) { requestCareMenuExit(open); return; }
    open();
  };

  const persistCareActions = async (next: CareActionConfig[], deletedKeys = careActionDeletions) => {
    const hiddenKeys = [...new Set(deletedKeys)];
    const tombstones = hiddenKeys.flatMap((key) => {
      const action = careActions.find((entry) => entry.key === key) ?? defaultCareActions.find((entry) => entry.key === key);
      return action ? [{ ...action, deleted: true }] : [];
    });
    const savedActions = [...next, ...tombstones];
    if (cloudFamily) {
      if (cloudSession) clearWorkspaceCache(cloudSession.user.id);
      await saveFamilyCareActions(cloudFamily.id, savedActions);
      setCloudFamily({ ...cloudFamily, care_actions: savedActions });
    }
    setCareActionDeletions(hiddenKeys);
    setCareActions(mergeCareActions(savedActions, hiddenKeys));
  };

  const finishCareActionEditing = async () => {
    if (careActionOrderSaving) return;
    const hasOrderChanges = Boolean(careActionOrderBaseline && (
      careActionOrderBaseline.length !== careActions.length ||
      careActionOrderBaseline.some((action, index) => action.key !== careActions[index]?.key) ||
      (careActionDeletionBaseline ?? []).join("|") !== careActionDeletions.join("|")
    ));
    if (hasOrderChanges) {
      setCareActionOrderSaving(true);
      try {
        await persistCareActions(careActions);
      } catch (cause) {
        setCloudError(errorMessage(cause, "Could not save the care menu order."));
        return;
      } finally {
        setCareActionOrderSaving(false);
      }
    }
    setEditingCareActions(false);
    setCareActionOrderBaseline(null);
    setCareActionDeletionBaseline(null);
  };

  const saveActionDraft = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = actionDraft.name.trim();
    if (!name || actionSaving) return;
    if (actionDraft.behavior !== "toggle" && actionDraft.targetCadence !== "none" && (!actionDraft.targetAmount || actionDraft.targetAmount < 1 || (actionDraft.behavior === "percentage" && actionDraft.key !== "cans" && actionDraft.targetAmount > 100))) return;
    const nextAction = {
      ...actionDraft,
      name,
      shortName: name,
      unit: actionDraft.behavior === "percentage" && actionDraft.key !== "cans" ? "%" : actionDraft.unit,
      animation: actionDraft.animation ?? "play",
      targetAmount: actionDraft.targetCadence === "none" ? null : actionDraft.behavior === "toggle" ? 1 : actionDraft.behavior === "percentage" ? 100 : Number(actionDraft.targetAmount),
    };
    const next = [...careActions.filter((action) => action.key !== nextAction.key), nextAction];
    setActionSaving(true);
    try {
      if (nextAction.targetCadence !== "none" && nextAction.targetAmount && cloudFamily && typeof selectedCat.id === "string") {
        const date = getFamilyCareWindow(cloudFamily.timezone).today;
        await saveTarget(cloudFamily.id, selectedCat.id, metricToDatabase(nextAction.key), nextAction.targetCadence, nextAction.targetAmount, nextAction.unit, date);
      }
      if (nextAction.targetCadence !== "none" && nextAction.targetAmount) {
        const goalKey = nextAction.key === "treats" ? "treatsGoal" : nextAction.key === "kibble" ? "kibbleGoal" : nextAction.key === "cans" ? "cansGoal" : nextAction.key + "Goal";
        setTrackers((current) => ({ ...current, [selectedId]: { ...emptyTracker, ...(current[String(selectedId)] ?? {}), [goalKey]: nextAction.targetAmount! } }));
      }
      await persistCareActions(next);
      setActiveMetric(nextAction.key);
      actionDraftBaseline.current = JSON.stringify(nextAction);
      setShowActionAppearance(false);
      actionEditorExit.dismiss();
    } catch (cause) {
      setCloudError(errorMessage(cause, "Could not save this care action."));
    } finally {
      setActionSaving(false);
    }
  };

  const removeCareAction = async (action: CareActionConfig) => {
    if (actionSaving || careActions.length <= 1) return;
    const next = careActions.filter((entry) => entry.key !== action.key);
    const deletedKeys = action.key.startsWith("custom:") ? careActionDeletions : [...careActionDeletions, action.key];
    if (editingCareActions && editingActionKey === null) {
      setCareActions(next);
      setCareActionDeletions(deletedKeys);
      if (activeMetric === action.key) setActiveMetric((next[0]?.key ?? "treats") as TrackableKey);
      setPendingCareActionRemoval(null);
      return;
    }
    setActionSaving(true);
    try {
      await persistCareActions(next, deletedKeys);
      if (activeMetric === action.key) setActiveMetric((next[0]?.key ?? "treats") as TrackableKey);
      setShowActionAppearance(false);
      setPendingCareActionRemoval(null);
      if (editingActionKey === action.key) actionEditorExit.dismiss();
    } catch (cause) {
      setCloudError(errorMessage(cause, "Could not remove this care action."));
    } finally {
      setActionSaving(false);
    }
  };

  const completed = useMemo(() => {
    return careActions.filter((action) => {
      const value = tracker[action.key] ?? (action.behavior === "toggle" ? false : 0);
      const goal = action.targetCadence !== "none" ? Number(tracker[action.key + "Goal"] ?? action.targetAmount ?? 0) : 0;
      return goal > 0 ? Number(value) >= goal : typeof value === "boolean" ? value : Number(value) > 0;
    }).length;
  }, [tracker, careActions]);
  const careActionCount = careActions.length;

  const addCat = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = newCatName.trim();
    if (!name || addCatBusyRef.current) return;
    addCatBusyRef.current = true;
    setAddCatBusy(true);
    try {
    const colors = ["#D494B7", "#79B8A9", "#E2AA55", "#9D90CB", "#EE8D75"];
    let croppedPhoto: string | undefined;
    if (newCatPhoto) {
      try {
        croppedPhoto = await cropCatPhoto(newCatPhoto, { ...newCatPhotoPosition, zoom: newCatPhotoZoom });
      } catch (cause) {
        setPhotoError(errorMessage(cause, "Could not prepare the cat photo crop."));
        return;
      }
    }
    if (cloudFamily) {
      try {
        if (cloudSession) clearWorkspaceCache(cloudSession.user.id);
        const created = await addCloudCat(cloudFamily.id, name, colors[cats.length % colors.length]);
        let photo: string | undefined;
        if (croppedPhoto) {
          const blob = await fetch(croppedPhoto).then((response) => response.blob());
          const file = new File([blob], `${name}-photo.jpg`, { type: blob.type || "image/jpeg" });
          const path = await uploadCatPhoto(cloudFamily.id, created.id, file);
          photo = await getCatPhotoUrl(path);
        }
        const cat: Cat = { id: created.id, name: created.name, color: created.color, initial: created.name[0].toUpperCase(), photo };
        setCats((current) => [...current, cat]);
        setTrackers((current) => ({ ...current, [created.id]: trackerFromCloud(created.id, cloudEvents, cloudTargets, cloudFamily.timezone, careActions) }));
        setSelectedId(created.id);
        setNewCatName("");
        setNewCatPhoto(undefined);
        setNewCatPhotoPosition({ x: 50, y: 50 });
        setNewCatPhotoZoom(1);
        setPhotoError("");
        addCatExit.dismiss();
      } catch (cause) {
        setCloudError(cause instanceof Error ? cause.message : "Could not add that cat to the family.");
      }
      return;
    }
    const cat: Cat = {
      id: Date.now(),
      name,
      color: colors[cats.length % colors.length],
      initial: name[0].toUpperCase(),
      photo: croppedPhoto,
    };
    setCats((current) => [...current, cat]);
    setSelectedId(cat.id);
    setNewCatName("");
    setNewCatPhoto(undefined);
    setNewCatPhotoPosition({ x: 50, y: 50 });
    setNewCatPhotoZoom(1);
    setPhotoError("");
    addCatExit.dismiss();
    } finally {
      addCatBusyRef.current = false;
      setAddCatBusy(false);
    }
  };

  const renameCat = async (cat: Cat, name: string) => {
    try {
      if (cloudFamily && cloudSession) clearWorkspaceCache(cloudSession.user.id);
      if (cloudFamily && typeof cat.id === "string") await updateCloudCat(cat.id, { name });
      setCats((current) => current.map((entry) => entry.id === cat.id ? { ...entry, name, initial: name[0]?.toUpperCase() ?? "?" } : entry));
      setCloudError("");
    } catch (cause) {
      setCloudError(errorMessage(cause, "Could not update the cat’s name."));
      throw cause;
    }
  };

  const openCatProfile = (catId: number | string) => {
    const cat = cats.find((entry) => String(entry.id) === String(catId));
    if (!cat) return;
    setSelectedId(cat.id);
    setProfileNameDraft(cat.name);
    setProfilePhotoDraft(cat.photo);
    setProfilePhotoPosition({ x: 50, y: 50 });
    setProfilePhotoZoom(1);
    profileDraftBaseline.current = JSON.stringify({ name: cat.name, photo: cat.photo, position: { x: 50, y: 50 }, zoom: 1 });
    setPhotoError("");
    setProfileEditCatId(cat.id);
  };

  const saveCatProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    const cat = cats.find((entry) => String(entry.id) === String(profileEditCatId));
    const name = profileNameDraft.trim();
    if (!cat || !name || profileSaving) return;
    setProfileSaving(true);
    setPhotoError("");
    try {
      if (name !== cat.name) await renameCat(cat, name);
      let nextPhoto = profilePhotoDraft;
      if (profilePhotoDraft && profilePhotoDraft !== cat.photo) {
        const croppedPhoto = await cropCatPhoto(profilePhotoDraft, { ...profilePhotoPosition, zoom: profilePhotoZoom });
        if (cloudFamily && typeof cat.id === "string") {
          if (cloudSession) clearWorkspaceCache(cloudSession.user.id);
          const blob = await fetch(croppedPhoto).then((response) => response.blob());
          const file = new File([blob], `${name}-photo.jpg`, { type: blob.type || "image/jpeg" });
          const path = await uploadCatPhoto(cloudFamily.id, cat.id, file);
          nextPhoto = await getCatPhotoUrl(path);
        } else {
          nextPhoto = croppedPhoto;
        }
      } else if (!profilePhotoDraft && cat.photo && cloudFamily && typeof cat.id === "string") {
        if (cloudSession) clearWorkspaceCache(cloudSession.user.id);
        await updateCloudCat(cat.id, { photo_path: null });
        nextPhoto = undefined;
      }

      setCats((current) => current.map((entry) => entry.id === cat.id ? { ...entry, name, initial: name[0]?.toUpperCase() ?? "?", photo: nextPhoto } : entry));
      setCloudError("");
      profileDraftBaseline.current = JSON.stringify({ name, photo: nextPhoto, position: profilePhotoPosition, zoom: profilePhotoZoom });
      profileExit.dismiss();
    } catch (cause) {
      const message = errorMessage(cause, "Could not save this cat profile.");
      setPhotoError(message);
      if (cloudFamily) setCloudError(message);
    } finally {
      setProfileSaving(false);
    }
  };

  const requestCloseAddCat = () => requestDiscardableClose(
    Boolean(newCatName.trim() || newCatPhoto),
    () => addCatExit.dismiss(),
    () => { setNewCatName(""); setNewCatPhoto(undefined); setNewCatPhotoPosition({ x: 50, y: 50 }); setNewCatPhotoZoom(1); setPhotoError(""); },
    "Your new cat hasn’t been added. Leaving now will discard the cat details and photo.",
  );
  const requestCloseCatProfile = () => {
    const currentDraft = JSON.stringify({ name: profileNameDraft, photo: profilePhotoDraft, position: profilePhotoPosition, zoom: profilePhotoZoom });
    requestDiscardableClose(
      currentDraft !== profileDraftBaseline.current,
      () => profileExit.dismiss(),
      () => { setPhotoError(""); },
      "Your cat profile changes haven’t been saved. Leaving now will discard them.",
    );
  };
  const requestCloseActionEditor = () => requestDiscardableClose(
    JSON.stringify(actionDraft) !== actionDraftBaseline.current,
    () => { setShowActionAppearance(false); actionEditorExit.dismiss(); },
    () => {},
    "Your care action changes haven’t been saved. Leaving now will discard them.",
  );

  const removeCat = async (cat: Cat) => {
    setPendingCatRemoval(cat);
  };

  const confirmRemoveCat = async () => {
    const cat = pendingCatRemoval;
    if (!cat || catRemovalBusy) return;
    setCatRemovalBusy(true);
    try {
      if (cloudFamily && cloudSession) clearWorkspaceCache(cloudSession.user.id);
      if (cloudFamily && typeof cat.id === "string") await archiveCloudCat(cat.id);
      const nextCats = cats.filter((entry) => entry.id !== cat.id);
      setCats(nextCats);
      setTrackers((current) => { const next = { ...current }; delete next[String(cat.id)]; return next; });
      if (selectedId === cat.id && nextCats[0]) setSelectedId(nextCats[0].id);
      if (String(profileEditCatId) === String(cat.id)) profileExit.dismiss();
      if (!nextCats.length) setActiveTab("cats");
      setCloudError("");
    } catch (cause) {
      setCloudError(errorMessage(cause, "Could not remove that cat."));
    } finally {
      setCatRemovalBusy(false);
      setPendingCatRemoval(null);
    }
  };

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());

  const mobileMetrics: Array<{
    key: string;
    label: string;
    shortLabel: string;
    icon: IconName;
    color: string;
    goal?: keyof Tracker;
    unit?: string;
    targetAmount?: number | null;
    targetCadence?: CareActionConfig["targetCadence"];
  }> = careActions.map((action) => ({
    key: action.key,
    label: action.name,
    shortLabel: action.shortName,
    icon: action.icon as IconName,
    color: action.color,
    goal: ({ treats: "treatsGoal", kibble: "kibbleGoal", cans: "cansGoal" } as Partial<Record<string, keyof Tracker>>)[action.key],
    unit: action.unit,
    targetAmount: action.targetAmount,
    targetCadence: action.targetCadence,
  }));
  const activeItem = mobileMetrics.find((item) => item.key === activeMetric)!;
  const activeAction = careActionFor(careActions, activeMetric) ?? defaultCareActions[0];
  const tapAnimation = actionTapAnimation(activeAction);
  const breakdownQuestion = breakdownQuestions[activeMetric] ?? "Who did this?";
  const switchTrackingMode = (direction: -1 | 1) => {
    setActiveMetric((current) => {
      const index = mobileMetrics.findIndex((item) => item.key === current);
      return mobileMetrics[(index + direction + mobileMetrics.length) % mobileMetrics.length].key;
    });
    setTapBurst(0);
    setShowBreakdown(false);
  };
  const handleTrackerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" || showBreakdown) return;
    swipeStart.current = { x: event.clientX, y: event.clientY };
  };
  const handleTrackerPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || showBreakdown) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    ignoreNextTap.current = true;
    window.setTimeout(() => { ignoreNextTap.current = false; }, 350);
    const direction = deltaX < 0 ? 1 : -1;
    setModeSwipeTransition((current) => ({ direction: direction > 0 ? "next" : "previous", key: (current?.key ?? 0) + 1 }));
    switchTrackingMode(direction);
  };
  const handleCatPickerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") return;
    catSwipeStart.current = { x: event.clientX, y: event.clientY };
  };
  const handleCatPickerPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = catSwipeStart.current;
    catSwipeStart.current = null;
    if (!start || cats.length < 2) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 42 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return;
    ignoreNextCatTap.current = true;
    window.setTimeout(() => { ignoreNextCatTap.current = false; }, 300);
    const currentIndex = Math.max(0, cats.findIndex((cat) => String(cat.id) === String(selectedId)));
    const nextIndex = (currentIndex + (deltaX < 0 ? 1 : -1) + cats.length) % cats.length;
    setSelectedId(cats[nextIndex].id);
    setShowBreakdown(false);
  };
  const activeValue = (tracker[activeMetric] ?? (activeAction.behavior === "toggle" ? false : 0)) as number | boolean;
  const isToggle = activeAction.behavior === "toggle";
  const activeGoal = activeAction.targetCadence !== "none"
    ? Number(tracker[activeMetric + "Goal"] ?? (activeItem.goal ? tracker[activeItem.goal] : undefined) ?? activeItem.targetAmount ?? 0)
    : undefined;
  const activeUsesPercentage = usesPercentageQuantifier(activeAction);
  const breakdownAmount = activeMetric === "cans" && activeAction.targetCadence === "daily" && !isToggle
    ? tracker.cans + tracker.canProgress / 100
    : typeof activeValue === "boolean" ? Number(activeValue) : activeValue;
  const breakdownAmountLabel = `${Number(breakdownAmount.toFixed(1))}${activeUsesPercentage ? "%" : ""}`;
  const isComplete = isToggle ? Boolean(activeValue) : activeGoal ? Number(activeValue) >= activeGoal : false;
  const availableUndoActions = undoActions
    .filter((entry) => String(entry.catId) === String(selectedId) && undoNow - entry.timestamp >= 0 && undoNow - entry.timestamp <= 15000 && canUndoCareAction(entry.actorUserId, cloudSession?.user.id))
    .sort((left, right) => right.timestamp - left.timestamp);
  const undoAvailable = undoNow <= undoRevealUntil && availableUndoActions.length > 0;
  const careWarning = activeMetric === "played" && Number(activeValue) >= 5
    ? "That’s a lot of play sessions today. Check the care log before adding more."
    : activeGoal && Number(activeValue) >= activeGoal
      ? `You’ve reached ${selectedCat.name}’s ${activeItem.shortLabel.toLowerCase()} goal. Check before adding more.`
      : "";
  const now = new Date();
  const activityEntries = careLogs.filter((entry) => {
    const timestamp = new Date(entry.timestamp);
    const todayWindow = cloudFamily ? getFamilyCareWindow(cloudFamily.timezone, now) : undefined;
    const isToday = todayWindow
      ? timestamp >= new Date(todayWindow.todayFrom) && timestamp < new Date(todayWindow.tomorrowFrom)
      : timestamp.getFullYear() === now.getFullYear() && timestamp.getMonth() === now.getMonth() && timestamp.getDate() === now.getDate();
    const isInPeriod = activeAction.targetCadence === "weekly"
      ? todayWindow
        ? timestamp >= new Date(todayWindow.weekFrom) && timestamp < new Date(todayWindow.tomorrowFrom)
        : getLocalWeekKey(timestamp) === getLocalWeekKey(now)
      : activeAction.targetCadence === "monthly"
        ? todayWindow ? timestamp >= new Date(startOfDayInZone(`${todayWindow.today.slice(0, 7)}-01`, cloudFamily?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)) && timestamp < new Date(todayWindow.tomorrowFrom)
          : timestamp.getFullYear() === now.getFullYear() && timestamp.getMonth() === now.getMonth()
        : isToday;
    const isCareAction = getCareLogDelta(entry) !== undefined
      || entry.detail.startsWith("Completed")
      || entry.detail === "Marked done";
    return String(entry.catId) === String(selectedId) && (entry.metric ? entry.metric === activeMetric : entry.what === metricLabels[activeMetric]) && isInPeriod && isCareAction;
  });
  const visibleActivityEntries = batchCareLogs(removeUndoneCareLogs(activityEntries));
  const contributionTimeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  const contributionPeriod = activeAction.targetCadence === "weekly" ? "This week" : activeAction.targetCadence === "monthly" ? "This month" : "Today";

  const handleBigTap = () => {
    if (isToggle) {
      if (!activeValue && (activeMetric === "peed" || activeMetric === "pooped")) playCareSound(activeMetric === "peed" ? "peed" : "pooped");
      update(activeMetric, !activeValue);
    } else if (activeMetric === "cans" && activeAction.targetCadence === "daily") {
      const amountDelta = 0.1;
      const eventId = addCareLog("cans", "Added 10% of a can", amountDelta);
      queueUndoAction(selectedId, "cans", amountDelta, eventId);
      setTrackers((current) => ({
        ...current,
        [selectedId]: (() => {
          const latest = { ...emptyTracker, ...(current[selectedId] ?? {}) };
          const nextProgress = latest.canProgress + 10;
          return {
            ...latest,
            cans: latest.cans + (nextProgress >= 100 ? 1 : 0),
            canProgress: nextProgress >= 100 ? 0 : nextProgress,
          };
        })(),
      }));
    } else if (activeUsesPercentage) {
      const amountDelta = 10;
      const eventId = addCareLog(activeMetric, "Added 10%", amountDelta);
      queueUndoAction(selectedId, activeMetric, amountDelta, eventId);
      setTrackers((current) => {
        const latest = { ...emptyTracker, ...(current[selectedId] ?? {}) };
        return { ...current, [selectedId]: { ...latest, [activeMetric]: Number(latest[activeMetric]) + amountDelta } };
      });
    } else {
      const unit = activeAction.unit || "";
      const displayUnit = unit.replace(/s$/, "");
      const eventId = addCareLog(activeMetric, `Added 1${displayUnit ? ` ${displayUnit}` : ""}`, 1);
      queueUndoAction(selectedId, activeMetric, 1, eventId);
      setTrackers((current) => {
        const latest = { ...emptyTracker, ...(current[selectedId] ?? {}) };
        return { ...current, [selectedId]: { ...latest, [activeMetric]: Number(latest[activeMetric]) + 1 } };
      });
    }
    setTapBurst((current) => current + 1);
  };

  const undoLastTap = () => {
    const action = availableUndoActions[0];
    if (!action) return;
    setUndoActions((current) => current.filter((entry) => entry.id !== action.id));
    const amountDelta = action.amountDelta;
    if (action.metric === "cans" && Math.abs(amountDelta) <= 0.100001) {
      setTrackers((current) => ({
        ...current,
        [action.catId]: (() => {
          const latest = { ...emptyTracker, ...(current[String(action.catId)] ?? {}) };
          return { ...latest, ...undoWetFoodDelta(latest.cans, latest.canProgress, amountDelta) };
        })(),
      }));
      const reverseDetail = amountDelta > 0 ? "Removed" : "Added";
      const reverseAmount = Math.abs(amountDelta);
      addCareLog("cans", `${reverseDetail} ${reverseAmount === 0.1 ? "10% of a can" : `${reverseAmount} cans`}`, -amountDelta, action.eventId);
      return;
    }
    const unit = careActionFor(careActions, action.metric)?.unit ?? metricUnits[action.metric as TrackableKey] ?? "";
    const absoluteDelta = Math.abs(amountDelta);
    const displayUnit = absoluteDelta === 1 ? unit.replace(/s$/, "") : unit;
    const amountText = Number.isInteger(absoluteDelta) ? String(absoluteDelta) : String(Number(absoluteDelta.toFixed(1)));
    const currentValue = { ...emptyTracker, ...(trackers[String(action.catId)] ?? {}) }[action.metric];
    if (typeof currentValue === "boolean") {
      setTrackers((current) => {
        const latest = { ...emptyTracker, ...(current[String(action.catId)] ?? {}) };
        return { ...current, [action.catId]: { ...latest, [action.metric]: !currentValue } };
      });
      addCareLog(action.metric, amountDelta > 0 ? "Undid this check-in" : "Marked done", -amountDelta, action.eventId);
      return;
    }
    if (typeof currentValue !== "number") return;
    setTrackers((current) => {
      const latest = { ...emptyTracker, ...(current[String(action.catId)] ?? {}) };
      return { ...current, [action.catId]: { ...latest, [action.metric]: undoNumericDelta(latest[action.metric] as number, amountDelta) } };
    });
    const reverseVerb = amountDelta > 0 ? "Removed" : "Added";
    addCareLog(action.metric, `${reverseVerb} ${amountText}${displayUnit === "%" ? "%" : displayUnit ? ` ${displayUnit}` : ""}`, -amountDelta, action.eventId);
  };

  if (isSupabaseConfigured && (!cloudSession || authLoading)) {
    return <SignInScreen busy={authBusy} error={cloudError} loading={authLoading} onSignIn={() => void startGoogleSignIn()} toolbar={themeToggle} />;
  }
  if (isSupabaseConfigured && cloudWorkspaceLoading && !cloudFamily) {
    return <main aria-busy="true" className="family-portal-loading app-workspace-loading"><span className="family-loading-spinner" />Loading your family and cats…</main>;
  }

  return (
    <div className="app-root">
      {(pullGestureActive || pullRefreshing) && <div className={`pull-refresh-indicator${pullRefreshing ? " is-refreshing" : ""}`} role="status"><span />{pullRefreshing ? "Refreshing…" : "Release to refresh"}</div>}
      <div className="app-utility-bar">{notificationCenter}{themeToggle}</div>
      <div className={`app-shell ${activeTab !== "care" || cats.length === 0 ? "family-route-hidden" : ""}`}>
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Purrfect day home">
          <span className="brand-mark"><Icon name="paw" size={21} /></span>
          <span>Purrfect<span>day</span></span>
        </a>

        <div className="cats-heading">
          <p>{cloudFamily ? `Cats in ${cloudFamily.name}` : "My cats"}</p>
          <button aria-label={cloudFamily ? `Add a cat to ${cloudFamily.name}` : "Add a cat"} onClick={() => setShowAddCat(true)}>
            <Icon name="plus" size={17} />
          </button>
        </div>

        <nav className="cat-list" aria-label="Your cats">
          {cats.map((cat) => (
            <button
              className={selectedId === cat.id ? "selected" : ""}
              key={cat.id}
              onClick={() => { setSelectedId(cat.id); }}
            >
              <CatAvatar cat={cat} />
              <span>{cat.name}</span>
              {selectedId === cat.id && <Icon name="chevron" size={17} />}
            </button>
          ))}
        </nav>

        <button className="add-cat-button" onClick={() => setShowAddCat(true)}>
          <Icon name="plus" size={18} />
          {cloudFamily ? `Add cat to ${cloudFamily.name}` : "Add a cat"}
        </button>

        <div className="sidebar-note">
          <span><Icon name="sparkle" size={18} /></span>
          <p><strong>Little care, big love.</strong> Every check-in keeps your kitty happy.</p>
        </div>
      </aside>

      <main>
        <header className="mobile-header">
          <a className="brand" href="#">
            <span className="brand-mark"><Icon name="paw" size={20} /></span>
            <span>Purrfect<span>day</span></span>
          </a>
        </header>

        <section className="mobile-tracker">
          <div className="mobile-cat-row">
            <div>
              <p>Taking care of</p>
              <h1>{selectedCat.name}</h1>
              <button className="edit-profile-trigger" onClick={() => openCatProfile(selectedCat.id)} type="button"><Icon name="edit" size={14} /> Edit profile</button>
            </div>
            <div aria-label="Swipe to switch cats" className="mobile-cat-picker" onPointerDown={handleCatPickerPointerDown} onPointerUp={handleCatPickerPointerUp} onPointerCancel={() => { catSwipeStart.current = null; }}>
              {cats.map((cat) => (
                <button
                  aria-label={`Track care for ${cat.name}`}
                  className={cat.id === selectedId ? "active" : ""}
                  key={cat.id}
                  onClick={() => { if (ignoreNextCatTap.current) { ignoreNextCatTap.current = false; return; } setSelectedId(cat.id); }}
                >
                  <CatAvatar cat={cat} />
                </button>
              ))}
            </div>
          </div>

          <div className="mobile-progress-card">
            <button aria-label="Open care menu" className="mobile-progress-heart" onClick={() => setShowTrackPicker(true)} type="button"><Icon name="heart" size={17} /></button>
            <div>
              <strong>{completed === careActionCount ? "All cared for!" : completed + " of " + careActionCount + " cares"}</strong>
              <div className="mobile-progress-track">
                <i style={{ width: `${Math.max(5, (completed / Math.max(1, careActionCount)) * 100)}%` }} />
              </div>
            </div>
          </div>
          {cloudError && <p className="cloud-feedback" role="status">{cloudError}</p>}

          <div className="mobile-tracker-actions">
            <button className="track-picker-trigger" onClick={() => setShowTrackPicker(true)} type="button">
              <Icon name="more" size={16} />
              Care Menu
            </button>
          </div>

          <div
            className={`big-tap-wrap ${activeItem.color} ${showBreakdown ? "is-flipped" : ""}`}
            onPointerDown={handleTrackerPointerDown}
            onPointerUp={handleTrackerPointerUp}
            onPointerCancel={() => { swipeStart.current = null; }}
          >
          {undoAvailable && !showBreakdown && (
            <button aria-label={`Undo recent care action, ${availableUndoActions.length} available`} className="tap-undo-icon" onClick={undoLastTap} title="Undo a recent check-in" type="button">
              <Icon name="undo" size={17} /><span>{availableUndoActions.length}</span>
            </button>
          )}
          <div className="big-tap-flip">
          <div
            key={modeSwipeTransition?.key ?? 0}
            aria-label={`${activeItem.label} tracker`}
            aria-hidden={showBreakdown || undefined}
            className={`big-tap-card ${activeItem.color} metric-${activeMetric} ${isComplete ? "complete" : ""} ${modeSwipeTransition ? `mode-swipe-${modeSwipeTransition.direction}` : ""}`}
            role="group"
          >
            <div className="tap-doodles" aria-hidden="true">
              <i /><i /><i />
            </div>
            <div className="big-icon"><Icon name={isComplete ? "check" : activeItem.icon} size={43} /></div>
            <p>{activeItem.label}</p>
            {activeMetric === "cans" && activeAction.targetCadence === "daily" && !isToggle ? (
              <div className="wet-food-count">
                <strong>{tracker.cans} <small>{tracker.cans === 1 ? "can" : "cans"}</small></strong>
                <div><i style={{ width: `${tracker.canProgress}%` }} /></div>
                <span>{tracker.canProgress}% of the next can</span>
                {activeGoal && <GoalProgress className="big-goal-progress" value={Number(activeValue)} goal={activeGoal} />}
              </div>
            ) : isToggle ? (
              <strong>
                {activeValue
                  ? `Done ${activeAction.targetCadence === "weekly" ? "this week" : activeAction.targetCadence === "monthly" ? "this month" : "today"}!`
                  : `Not yet ${activeAction.targetCadence === "weekly" ? "this week" : activeAction.targetCadence === "monthly" ? "this month" : "today"}`}
              </strong>
            ) : (
              <>
                <strong className="big-count">
                  {activeValue}{activeUsesPercentage ? "%" : ""}
                  {activeGoal && <small> / {activeGoal}{activeUsesPercentage ? "%" : ""}</small>}
                </strong>
                {activeGoal && <GoalProgress className="big-goal-progress" value={Number(activeValue)} goal={activeGoal} />}
              </>
            )}
            <button aria-label={(activeMetric === "cans" && activeAction.targetCadence === "daily" && !isToggle) || activeUsesPercentage ? "Tap to add 10%" : isToggle ? activeValue ? "Tap to undo" : "Tap when done" : "Tap to add one"} className="tap-prompt" disabled={showBreakdown} onClick={() => {
              if (ignoreNextTap.current) { ignoreNextTap.current = false; return; }
              setShowBreakdown(false);
              handleBigTap();
            }} type="button">
              <Icon name={isToggle && activeValue ? "check" : "plus"} size={17} />
              {(activeMetric === "cans" && activeAction.targetCadence === "daily" && !isToggle) || activeUsesPercentage
                ? "Tap to add 10%"
                : isToggle
                  ? activeMetric === "ears"
                    ? (activeValue ? "Tap to undo this week" : "Tap when done this week")
                    : (activeValue ? "Tap to undo" : "Tap when done")
                  : "Tap to add one"}
            </button>
            {tapBurst > 0 && tapAnimation !== "none" && (
              <div className={`metric-scene tap-animation-${tapAnimation} variant-${tapBurst % 3}`} key={tapBurst} aria-hidden="true">
                {tapAnimation === "chomp" && (
                  <div className="chomp-cat">
                    <span className="chomp-ear left" /><span className="chomp-ear right" />
                    <i className="chomp-eye left" /><i className="chomp-eye right" />
                    <b className="chomp-mouth"><i /></b>
                    <em className="food-bit" />
                  </div>
                )}
                {tapAnimation === "play" && (
                  <div className="play-scene">
                    <i className="string" /><b className="toy" /><span className="swipe-paw"><i /><i /><i /></span>
                  </div>
                )}
                {tapAnimation === "outside" && <div className="outside-scene"><Icon name="catLounging" size={72} /><i /></div>}
                {tapAnimation === "pee" && (
                  <div className="pee-scene"><Icon name="pee" size={58} /></div>
                )}
                {tapAnimation === "water" && (
                  <div className="droplet-scene"><i /><i /><i /><i /><i /></div>
                )}
                {tapAnimation === "poop" && (
                  <div className="poop-scene">
                    <span className="poop"><i /><i /><i /></span>
                    <b className="fly fly-one"><i /></b><b className="fly fly-two"><i /></b>
                  </div>
                )}
                {tapAnimation === "paw" && (
                  <div className="paw-scene"><Icon name="paw" size={54} /><i /><i /></div>
                )}
                {tapAnimation === "ears" && (
                  <div className="ear-scene"><Icon name="ear" size={60} /><i className="ear-drop ear-drop-left" /><i className="ear-drop ear-drop-right" /></div>
                )}
                <div className="tap-burst">
                  <b>{(activeMetric === "cans" && activeAction.targetCadence === "daily") || activeUsesPercentage ? "+10%" : isToggle ? "Done!" : "+1"}</b>
                  <i /><i /><i /><i /><i />
                </div>
              </div>
            )}
          </div>
          <button aria-hidden={showBreakdown} className="feeding-breakdown-trigger" disabled={showBreakdown} onClick={() => setShowBreakdown(true)} tabIndex={showBreakdown ? -1 : 0} type="button">
            {breakdownQuestion} <span aria-label={`${breakdownAmountLabel} tracked`}>{breakdownAmountLabel}</span>
          </button>
          <div className="big-tap-backface" aria-hidden={!showBreakdown} aria-label={`${activeItem.shortLabel} record`}>
            <div className="record-card-heading">
              <div><small>{contributionPeriod} record</small><strong>{breakdownQuestion}</strong></div>
              <span aria-label={`${breakdownAmountLabel} tracked`}>{breakdownAmountLabel}</span>
            </div>
            <h3>{activeItem.shortLabel}</h3>
            {visibleActivityEntries.length ? (
              <ol className="record-card-list">
                {visibleActivityEntries.map((entry) => (
                  <li key={entry.id}>
                    <div><strong>{entry.who}</strong><small>{entry.what} · {entry.detail}</small></div>
                    <time dateTime={entry.timestamp}>{contributionTimeFormat.format(new Date(entry.timestamp))}</time>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="record-card-empty">No {activeItem.shortLabel.toLowerCase()} activity recorded {activeAction.targetCadence === "weekly" ? "this week" : activeAction.targetCadence === "monthly" ? "this month" : "today"} yet.</p>
            )}
            <button className="record-card-back" disabled={!showBreakdown} onClick={() => setShowBreakdown(false)} type="button">‹ Back to tracking</button>
          </div>
          </div>
          </div>
          <p className="mobile-helper">
            {activeGoal
              ? isComplete
                ? `Nice! ${selectedCat.name} reached the ${activeAction.targetCadence} target.`
                : `${Math.max(0, activeGoal - Number(activeValue))} more to reach the ${activeAction.targetCadence} target`
              : activeAction.targetCadence === "weekly"
                ? "This check-in resets each week"
                : activeAction.targetCadence === "monthly"
                  ? "This check-in resets each month"
                : "Tap the big card whenever it happens"}
          </p>
          {careWarning && <p className="care-limit-warning" role="status">{careWarning}</p>}
          {(showTrackPicker || trackPickerExit.closing) && createPortal(<div className={`track-picker-backdrop${trackPickerExit.closing ? " is-closing" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) requestCareMenuExit(); }}>
            <section aria-labelledby="track-picker-title" aria-modal="true" className={`track-picker-dialog${trackPickerExit.closing ? " is-closing" : ""}`} role="dialog">
              <header><div className="track-picker-heading"><h2 id="track-picker-title">Care tracker</h2><p aria-label={editingCareActions ? "Drag to rearrange or tap an action to edit" : "Tap to track, hold an action to edit, use the reorder icon to sort"}>{editingCareActions ? "Drag to rearrange · tap to edit" : <>Tap to track · hold to edit · <span aria-hidden="true"><Icon name="reorder" size={11} /></span> to sort</>}</p></div><div className="track-picker-header-actions"><button className={editingCareActions ? "is-editing" : ""} disabled={careActionOrderSaving} onClick={() => {
                if (editingCareActions) void finishCareActionEditing();
                else { setCareActionOrderBaseline(careActions.map((action) => ({ ...action }))); setCareActionDeletionBaseline([...careActionDeletions]); setEditingCareActions(true); }
              }} aria-label={editingCareActions ? "Done rearranging care actions" : "Reorder care actions"} title={editingCareActions ? "Done" : "Reorder care actions"} type="button">{careActionOrderSaving ? "Saving…" : editingCareActions ? "Done" : <Icon name="reorder" size={17} />}</button><button aria-label="Close tracking options" disabled={careActionOrderSaving} onClick={() => requestCareMenuExit()} type="button">×</button></div></header>
              <div className="mobile-item-grid">
                {mobileMetrics.map((item) => {
                  const value = tracker[item.key] ?? (careActionFor(careActions, item.key)?.behavior === "toggle" ? false : 0);
                  const goal = item.targetCadence !== "none" ? Number(tracker[item.key + "Goal"] ?? (item.goal ? tracker[item.goal] : undefined) ?? item.targetAmount ?? 0) : 0;
                  const done = typeof value === "boolean" ? value : Number(value) > 0;
                  const itemAction = careActionFor(careActions, item.key);
                  const itemIsPercentage = itemAction?.behavior === "percentage";
                  return <div className={`care-action-tile-wrap${editingCareActions ? " is-editing" : ""}${draggedActionKey === item.key ? " is-dragging" : ""}`} data-action-key={item.key} key={item.key}
                    onClick={() => {
                      if (longPressActionKey.current?.key === item.key) {
                        const shouldSuppress = Date.now() < longPressActionKey.current.expiresAt;
                        longPressActionKey.current = null;
                        if (shouldSuppress) return;
                      }
                      if (editingCareActions) {
                        if (suppressActionClick.current) { suppressActionClick.current = false; return; }
                        openActionEditor(item.key);
                        return;
                      }
                      setActiveMetric(item.key);
                      setTapBurst(0);
                      setShowBreakdown(false);
                      requestCareMenuExit();
                    }}
                    onPointerDown={(event) => {
                      if (!editingCareActions) {
                        const pointerId = event.pointerId;
                        const startX = event.clientX;
                        const startY = event.clientY;
                        const timer = window.setTimeout(() => {
                          if (careActionHold.current?.pointerId !== pointerId) return;
                          careActionHold.current = null;
                          longPressActionKey.current = { key: item.key, expiresAt: Date.now() + 1200 };
                          openActionEditor(item.key);
                        }, 520);
                        careActionHold.current = { pointerId, startX, startY, timer };
                        return;
                      }
                      const bounds = event.currentTarget.getBoundingClientRect();
                      careActionDrag.current = { key: item.key, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top, moved: false, lastTargetKey: null };
                      const preview = event.currentTarget.querySelector<HTMLButtonElement>(":scope > .care-action-tile-content > button:not(.care-action-remove)")?.cloneNode(true) as HTMLButtonElement | undefined;
                      if (preview) {
                        preview.classList.add("care-action-drag-preview");
                        preview.setAttribute("aria-hidden", "true");
                        preview.removeAttribute("aria-label");
                        preview.style.width = `${bounds.width}px`;
                        preview.style.height = `${bounds.height - 9}px`;
                        preview.style.left = `${bounds.left}px`;
                        preview.style.top = `${bounds.top}px`;
                        document.body.append(preview);
                        careActionDragPreview.current = preview;
                      }
                      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture is unavailable in some browsers. */ }
                      setDraggedActionKey(item.key);
                    }}
                    onPointerMove={(event) => {
                      const hold = careActionHold.current;
                      if (hold?.pointerId === event.pointerId && Math.hypot(event.clientX - hold.startX, event.clientY - hold.startY) > 8) {
                        window.clearTimeout(hold.timer);
                        careActionHold.current = null;
                      }
                      const drag = careActionDrag.current;
                      if (!drag || drag.pointerId !== event.pointerId) return;
                      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6) drag.moved = true;
                      if (!drag.moved) return;
                      if (careActionDragPreview.current) {
                        careActionDragPreview.current.style.left = `${event.clientX - drag.offsetX}px`;
                        careActionDragPreview.current.style.top = `${event.clientY - drag.offsetY}px`;
                      }
                      const target = document.elementsFromPoint(event.clientX, event.clientY).map((element) => element.closest<HTMLElement>(".care-action-tile-wrap[data-action-key]")).find((candidate) => candidate && candidate.dataset.actionKey !== drag.key);
                      const targetKey = target?.dataset.actionKey;
                      if (!targetKey || targetKey === drag.key) drag.lastTargetKey = null;
                      else if (targetKey !== drag.lastTargetKey) {
                        drag.lastTargetKey = targetKey;
                        const reorderedActions = moveCareAction(careActions, drag.key, targetKey);
                        if (reorderedActions !== careActions) {
                          careActionLayoutBefore.current = new Map(Array.from(document.querySelectorAll<HTMLElement>(".care-action-tile-wrap[data-action-key]")).flatMap((element) => {
                            const key = element.dataset.actionKey;
                            return key ? [[key, element.getBoundingClientRect()] as const] : [];
                          }));
                          setCareActions(reorderedActions);
                        }
                      }
                    }}
                    onPointerUp={(event) => {
                      if (careActionHold.current?.pointerId === event.pointerId) {
                        window.clearTimeout(careActionHold.current.timer);
                        careActionHold.current = null;
                      }
                      const drag = careActionDrag.current;
                      if (!drag || drag.pointerId !== event.pointerId) return;
                      careActionDragPreview.current?.remove();
                      careActionDragPreview.current = null;
                      careActionDrag.current = null;
                      setDraggedActionKey(null);
                      if (drag.moved) suppressActionClick.current = true;
                    }}
                    onPointerCancel={(event) => {
                      if (careActionHold.current?.pointerId === event.pointerId) {
                        window.clearTimeout(careActionHold.current.timer);
                        careActionHold.current = null;
                      }
                      if (careActionDrag.current?.pointerId !== event.pointerId) return;
                      const moved = careActionDrag.current.moved;
                      careActionDragPreview.current?.remove();
                      careActionDragPreview.current = null;
                      careActionDrag.current = null;
                      setDraggedActionKey(null);
                      if (moved) suppressActionClick.current = true;
                    }}
                    onPointerLeave={() => {
                      if (!careActionHold.current) return;
                      window.clearTimeout(careActionHold.current.timer);
                      careActionHold.current = null;
                    }}
                    onContextMenu={(event) => { if (!editingCareActions) event.preventDefault(); }}>
                    <div className={`care-action-tile-content${editingCareActions ? " is-editing" : ""}`}>
                    <button aria-label={editingCareActions ? `Drag ${item.shortLabel} to reorder, or tap to edit` : undefined} aria-pressed={!editingCareActions && activeMetric === item.key} className={`${item.color} ${activeMetric === item.key ? "active" : ""}`} type="button">
                      <span><Icon name={item.icon} size={21} /></span>
                      <strong>{item.shortLabel}</strong>
                      {goal > 0 && <><small className="tile-goal-count">{Number(value)}{itemIsPercentage ? "%" : ""} / {goal}{itemIsPercentage ? "%" : ""}</small><GoalProgress className="tile-goal-progress" value={Number(value)} goal={goal} /></>}
                      {done && !editingCareActions && <i><Icon name="check" size={10} /></i>}
                    </button>
                    {editingCareActions && <button aria-label={`Remove ${item.shortLabel} care action`} className="care-action-remove" disabled={careActions.length <= 1} onClick={(event) => { event.stopPropagation(); const action = careActionFor(careActions, item.key); if (action) setPendingCareActionRemoval(action); }} onPointerDown={(event) => event.stopPropagation()} title={careActions.length <= 1 ? "Keep at least one care action" : `Remove ${item.shortLabel}`} type="button"><Icon name="minus" size={15} /></button>}
                    </div>
                  </div>;
                })}
                {!editingCareActions && <button className="care-action-add-tile" onClick={() => openActionEditor()} type="button"><span><Icon name="plus" size={22} /></span><strong>Add care action</strong></button>}
              </div>
            </section>
          </div>, document.body)}

          <CareLogPanel cat={selectedCat} logs={careLogs} memberName={memberName} onMemberNameChange={setMemberName} timezone={cloudFamily?.timezone} cloudMode={Boolean(cloudFamily)} expanded={careLogExpanded} onToggle={() => setCareLogExpanded((open) => !open)} />
        </section>

        <div className="desktop-dashboard">
        <section className="page-header">
          <div className="greeting">
            <CatAvatar cat={selectedCat} size="large" />
            <div>
              <p className="eyebrow">Today with {selectedCat.name}</p>
              <h1>How’s your little one?</h1>
              <p className="date"><Icon name="calendar" size={16} /> {dateLabel}</p>
              <button className="edit-profile-trigger" onClick={() => openCatProfile(selectedCat.id)} type="button"><Icon name="edit" size={14} /> Edit profile</button>
              {photoError && <small className="photo-error">{photoError}</small>}
            </div>
          </div>
          <div className="daily-progress">
            <div>
              <span>Daily care</span>
              <strong>{completed} of {careActionCount}</strong>
            </div>
            <div className="progress-track"><span style={{ width: `${(completed / Math.max(1, careActionCount)) * 100}%` }} /></div>
          </div>
        </section>
        {cloudError && <p className="cloud-feedback desktop-cloud-feedback" role="status">{cloudError}</p>}
        {undoAvailable && <button aria-label={`Undo recent care action, ${availableUndoActions.length} available`} className="desktop-undo-action" onClick={undoLastTap} type="button"><Icon name="undo" size={16} /> Undo{availableUndoActions.length > 1 ? ` (${availableUndoActions.length})` : ""}</button>}

        <section className="dashboard-grid">
          <article className="card food-card">
            <div className="card-heading">
              <span className="heading-icon peach"><Icon name="bowl" /></span>
              <div><h2>Food & water</h2><p>Today’s meals and sips</p></div>
              <button className="quota-button" onClick={openCareActionManager}>
                <Icon name="settings" size={15} />
                Care actions
              </button>
            </div>
            <div className="tracker-list">
              <div className="tracker-row">
                <span className="item-icon food-treats"><Icon name="treat" size={19} /></span>
                <div className="tracker-label"><strong>Dental treats</strong><small>pieces</small><GoalProgress value={tracker.treats} goal={tracker.treatsGoal} color="#78915B" /></div>
                <Stepper value={tracker.treats} goal={tracker.treatsGoal} onChange={(v) => update("treats", v)} accent="#78915B" />
              </div>
              <div className="tracker-row">
                <span className="item-icon food-kibble"><Icon name="bowl" size={19} /></span>
                <div className="tracker-label"><strong>Kibble</strong><small>spoons</small><GoalProgress value={tracker.kibble} goal={tracker.kibbleGoal} color="#A66D42" /></div>
                <Stepper value={tracker.kibble} goal={tracker.kibbleGoal} onChange={(v) => update("kibble", v)} accent="#A66D42" />
              </div>
              <div className="tracker-row">
                <span className="item-icon food-wet"><Icon name="medical" size={18} /></span>
                <div className="tracker-label"><strong>Wet food</strong><small>cans</small><GoalProgress value={tracker.cans} goal={tracker.cansGoal} color="#D0A365" /></div>
                <Stepper value={tracker.cans} goal={tracker.cansGoal} onChange={(v) => update("cans", v)} accent="#D0A365" />
              </div>
              <div className="tracker-row">
                <span className="item-icon aqua"><Icon name="drop" size={19} /></span>
                <div className="tracker-label"><strong>Water topped up</strong><small>fresh & flowing</small></div>
                <Stepper value={tracker.fountain} onChange={(value) => update("fountain", value)} accent="#428C9F" label="water top-ups" />
              </div>
            </div>
          </article>

          <article className="card health-card">
            <div className="card-heading">
              <span className="heading-icon rose"><Icon name="heart" /></span>
              <div><h2>Health check</h2><p>Small signs matter</p></div>
              <span className="frequency">Daily</span>
            </div>
            <div className="tracker-list">
              <div className="tracker-row">
                <span className="item-icon pink"><Icon name="paw" size={19} /></span>
                <div className="tracker-label"><strong>Pawing at teeth</strong><small>times noticed</small></div>
                <Stepper value={tracker.teethPawing} onChange={(v) => update("teethPawing", v)} accent="#C8819C" />
              </div>
              <div className="tracker-row compact">
                <span className="item-icon lavender"><Icon name="sparkle" size={19} /></span>
                <div className="tracker-label"><strong>Bathroom check</strong><small>today</small></div>
                <div className="split-toggles">
                  <div className="bathroom-counter"><Icon name="poop" size={16} /><Stepper accent="#7767A5" label="Poop" value={tracker.pooped} onChange={(value) => update("pooped", value)} /></div>
                  <div className="bathroom-counter"><Icon name="pee" size={16} /><Stepper accent="#4A8FA0" label="Pee" value={tracker.peed} onChange={(value) => update("peed", value)} /></div>
                </div>
              </div>
              <div className="tracker-row weekly-row">
                <span className="item-icon orange"><Icon name="ear" size={19} /></span>
                <div className="tracker-label"><strong>Ears cleaned</strong><small>gentle weekly care</small></div>
                <span className="frequency weekly">Weekly</span>
                <Toggle active={tracker.ears} onClick={() => update("ears", !tracker.ears)} label={tracker.ears ? "Done this week" : "Not yet this week"} />
              </div>
            </div>
          </article>

          <article className={`play-card ${tracker.played > 0 ? "played" : ""}`}>
            <div className="play-copy">
              <span className="heading-icon violet"><Icon name="yarn" /></span>
              <div>
                <span className="frequency">Daily</span>
                <h2>Playtime</h2>
                <p>{tracker.played} {tracker.played === 1 ? "session" : "sessions"} logged for {selectedCat.name}.</p>
              </div>
            </div>
            <button onClick={() => update("played", tracker.played + 1)}>
              <Icon name="yarn" size={18} />
              Add session
            </button>
            <div className="yarn" aria-hidden="true"><span /><i /></div>
          </article>
        </section>
        <CareLogPanel cat={selectedCat} logs={careLogs} memberName={memberName} onMemberNameChange={setMemberName} timezone={cloudFamily?.timezone} cloudMode={Boolean(cloudFamily)} expanded={careLogExpanded} onToggle={() => setCareLogExpanded((open) => !open)} />
        </div>
      </main>
      </div>

      {(showAddCat || addCatExit.closing) && (
        <div className={`modal-backdrop${addCatExit.closing ? " is-closing" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget && !addCatBusy) requestCloseAddCat(); }}>
          <form aria-labelledby="add-cat-title" aria-modal="true" className={`modal${addCatExit.closing ? " is-closing" : ""}`} onSubmit={addCat} onMouseDown={(event) => event.stopPropagation()} role="dialog">
            <span className="modal-icon"><Icon name="paw" size={24} /></span>
            <h2 id="add-cat-title">Add a new cat</h2>
            <p>Who’s joining the family?</p>
            <label>
              Cat’s name
              <input
                maxLength={24}
                onChange={(event) => setNewCatName(event.target.value)}
                placeholder="e.g. Miso"
                value={newCatName}
              />
            </label>
            <label>
              Photo (optional)
              <span className="cat-photo-upload-control">
                <span>Choose file!</span>
                <input
                  aria-label="Choose file!"
                  accept="image/*,.heic,.heif"
                  type="file"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      try {
                        setNewCatPhoto(await readCatPhoto(file));
                        setNewCatPhotoPosition({ x: 50, y: 50 });
                        setNewCatPhotoZoom(1);
                        setPhotoError("");
                      } catch (cause) {
                        setPhotoError(errorMessage(cause, "Could not decode this photo."));
                      }
                    } else {
                      setNewCatPhoto(undefined);
                    }
                    event.target.value = "";
                  }}
                />
              </span>
            </label>
            {newCatPhoto && (
              <CatPhotoCropEditor photo={newCatPhoto} position={newCatPhotoPosition} onPositionChange={setNewCatPhotoPosition} zoom={newCatPhotoZoom} onZoomChange={setNewCatPhotoZoom} />
            )}
            {photoError && <small className="photo-error">{photoError}</small>}
            <div className="modal-actions">
              <button disabled={addCatBusy || addCatExit.closing} type="button" onClick={requestCloseAddCat}>Cancel</button>
              <button type="submit" disabled={addCatBusy || !newCatName.trim()}>{addCatBusy ? <><span className="button-spinner" /> Adding…</> : <><Icon name="plus" size={17} /> Add cat</>}</button>
            </div>
          </form>
        </div>
      )}

      {(profileEditCatId !== null || profileExit.closing) && (() => {
        const cat = cats.find((entry) => String(entry.id) === String(profileEditCatId));
        if (!cat) return null;
        return <div className={`modal-backdrop${profileExit.closing ? " is-closing" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget && !profileSaving && !profilePhotoLoading) requestCloseCatProfile(); }}>
          <form aria-labelledby="edit-cat-profile-title" aria-modal="true" className={`modal cat-profile-modal${profileExit.closing ? " is-closing" : ""}`} onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => void saveCatProfile(event)} role="dialog">
            <span className="modal-icon"><Icon name="paw" size={24} /></span>
            <h2 id="edit-cat-profile-title">Edit {cat.name}</h2>
            <p>Update {cat.name}’s profile and care actions.</p>
            <label>Cat’s name<input maxLength={60} onChange={(event) => setProfileNameDraft(event.target.value)} required value={profileNameDraft} /></label>
            <section className="profile-photo-field" aria-label="Cat profile photo">
              <strong>Photo</strong>
              {profilePhotoDraft && profilePhotoDraft !== cat.photo
                ? <CatPhotoCropEditor photo={profilePhotoDraft} position={profilePhotoPosition} onPositionChange={setProfilePhotoPosition} zoom={profilePhotoZoom} onZoomChange={setProfilePhotoZoom} />
                : <div className="profile-current-photo">{profilePhotoDraft ? <img alt={`${cat.name} profile preview`} src={profilePhotoDraft} /> : <span aria-hidden="true"><Icon name="paw" size={30} /></span>}</div>}
              <label className="cat-photo-upload-control profile-photo-choose"><span>{profilePhotoLoading ? "Preparing photo…" : profilePhotoDraft ? "Choose a different photo" : "Choose photo"}</span><input aria-label="Choose profile photo" accept="image/*,.heic,.heif" disabled={profilePhotoLoading || profileSaving} onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setProfilePhotoLoading(true);
                try { setProfilePhotoDraft(await readCatPhoto(file)); setProfilePhotoPosition({ x: 50, y: 50 }); setProfilePhotoZoom(1); setPhotoError(""); }
                catch (cause) { setPhotoError(errorMessage(cause, "Could not decode this photo.")); }
                finally { setProfilePhotoLoading(false); event.target.value = ""; }
              }} type="file" /></label>
              {profilePhotoDraft && <button className="profile-photo-remove" disabled={profileSaving || profilePhotoLoading} onClick={() => setProfilePhotoDraft(undefined)} type="button">Remove photo</button>}
            </section>
            <section className="profile-care-actions">
              <div><strong>Care tracker</strong><small>Add, edit, remove, or reorder the actions your family tracks.</small></div>
              <button className="edit-profile-trigger" onClick={() => setShowTrackPicker(true)} type="button"><Icon name="paw" size={15} /> Manage care actions</button>
            </section>
            {photoError && <small className="photo-error">{photoError}</small>}
            <div className="modal-actions"><button aria-label={`Remove ${cat.name}`} className="cat-profile-remove" disabled={profileSaving || profilePhotoLoading || profileExit.closing} onClick={() => void removeCat(cat)} type="button">Remove cat</button><button disabled={profileSaving || profilePhotoLoading || profileExit.closing} onClick={requestCloseCatProfile} type="button">Cancel</button><button disabled={profileSaving || profilePhotoLoading || profileExit.closing || !profileNameDraft.trim()} type="submit">{profileSaving ? <><span className="button-spinner" /> Saving…</> : "Save profile"}</button></div>
          </form>
        </div>;
      })()}

      {(editingActionKey !== null || actionEditorExit.closing) && createPortal(<div className={`modal-backdrop action-editor-backdrop${actionEditorExit.closing ? " is-closing" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget && !actionSaving) requestCloseActionEditor(); }}>
        <form aria-labelledby="action-editor-title" aria-modal="true" className={`modal care-action-editor${actionEditorExit.closing ? " is-closing" : ""}`} onSubmit={saveActionDraft} role="dialog">
          <h2 id="action-editor-title">{careActionFor(careActions, actionDraft.key) ? "Edit care action" : "Add a care action"}</h2>
          <div aria-label="Care box preview" className="action-preview action-preview-top">
            <span className="action-preview-label">Tap the icon to edit</span>
            <CareActionPreview action={actionDraft} onEditAppearance={() => setShowActionAppearance(true)} />
          </div>
          <label>Action name<input autoComplete="off" maxLength={40} onChange={(event) => setActionDraft((draft) => ({ ...draft, name: event.target.value, shortName: event.target.value }))} required value={actionDraft.name} /></label>
          {actionDraft.behavior === "numeric" && <label>Unit<input autoComplete="off" maxLength={20} onChange={(event) => setActionDraft((draft) => ({ ...draft, unit: event.target.value }))} placeholder="times, spoons, sessions…" required value={actionDraft.unit} /></label>}
          <ChoicePicker label="Quantifier" options={behaviorOptions} onChange={(value) => {
            const behavior = value as CareActionConfig["behavior"];
            setActionDraft((draft) => ({
              ...draft,
              behavior,
              unit: behavior === "percentage" ? draft.key === "cans" ? "cans" : "%" : behavior === "numeric" && draft.unit === "%" ? "times" : draft.unit,
              targetAmount: draft.targetCadence === "none" ? null : behavior === "toggle" ? 1 : behavior === "percentage" ? 100 : draft.behavior === "percentage" ? 1 : draft.targetAmount ?? 1,
            }));
          }} value={actionDraft.behavior} />
          <ChoicePicker label="Target" options={targetOptions} onChange={(cadence) => setActionDraft((draft) => ({ ...draft, targetCadence: cadence as CareActionConfig["targetCadence"], targetAmount: cadence === "none" ? null : draft.behavior === "toggle" ? 1 : draft.behavior === "percentage" ? 100 : draft.targetAmount ?? 1 }))} value={actionDraft.targetCadence} />
          {actionDraft.behavior === "numeric" && actionDraft.targetCadence !== "none" && <label>{actionDraft.targetCadence[0].toUpperCase() + actionDraft.targetCadence.slice(1)} target<input inputMode="numeric" min="1" onChange={(event) => setActionDraft((draft) => ({ ...draft, targetAmount: Number(event.target.value) }))} required type="number" value={actionDraft.targetAmount ?? ""} /></label>}
          <div className="modal-actions">
            {careActionFor(careActions, actionDraft.key) && <button className="danger" disabled={actionSaving || careActions.length <= 1} onClick={(event) => { event.preventDefault(); const action = careActionFor(careActions, actionDraft.key); if (action) setPendingCareActionRemoval(action); }} title={careActions.length <= 1 ? "Keep at least one care action" : "Delete this care action"} type="button">Delete action</button>}
            <button disabled={actionSaving || actionEditorExit.closing} onClick={requestCloseActionEditor} type="button">Cancel</button>
            <button disabled={actionSaving || actionEditorExit.closing || !actionDraft.name.trim()} type="submit">{actionSaving ? <><span className="button-spinner" /> Saving…</> : "Save action"}</button>
          </div>
        </form>
        {showActionAppearance && <div className="modal-backdrop action-appearance-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowActionAppearance(false); }}>
          <section aria-labelledby="action-appearance-title" aria-modal="true" className="modal action-appearance-dialog" role="dialog">
            <h2 id="action-appearance-title">Icon &amp; colour</h2>
            <p>Choose how this care action looks.</p>
            <ChoicePicker label="Icon & animation" options={actionIconOptions} onChange={(icon) => {
              const appearance = actionIconOptions.find((option) => option.value === icon);
              if (appearance) setActionDraft((draft) => ({ ...draft, icon: appearance.value, animation: appearance.animation }));
            }} value={actionDraft.icon} />
            <fieldset className="action-color-field"><legend>Colour</legend><div className="action-color-options">{actionColors.map((color) => <button aria-label={color.label} aria-pressed={actionDraft.color === color.value} className={`action-color-swatch ${color.value}${actionDraft.color === color.value ? " is-selected" : ""}`} key={color.value} onClick={() => setActionDraft((draft) => ({ ...draft, color: color.value }))} title={color.label} type="button"><Icon name={actionDraft.icon as IconName} size={17} /></button>)}</div></fieldset>
            <div className="modal-actions"><button onClick={() => setShowActionAppearance(false)} type="button">Done</button></div>
          </section>
        </div>}
      </div>, document.body)}
      <nav aria-label="Primary navigation" className={`primary-nav page-${activeTab}`}>
        <button aria-current={activeTab === "care" ? "page" : undefined} className={activeTab === "care" ? "active" : ""} disabled={cats.length === 0} onClick={returnToCare} type="button">
          <Icon name="paw" size={19} />
          <span>Care</span>
        </button>
        <button aria-current={activeTab === "cats" ? "page" : undefined} className={activeTab === "cats" ? "active" : ""} onClick={() => navigateTo("cats")} type="button">
          <Icon name="cat" size={21} />
          <span>Cats</span>
        </button>
        <button aria-current={activeTab === "family" ? "page" : undefined} className={activeTab === "family" ? "active" : ""} onClick={() => navigateTo("family")} type="button">
          <Icon name="family" size={19} />
          <span>Family</span>
        </button>
      </nav>
      {activeTab === "cats" && <AnalyticsPage cats={cats} logs={careLogs} goals={analyticsGoals} targets={cloudTargets} members={cloudMembers} careActions={careActions} selectedCatId={selectedId} timezone={cloudFamily?.timezone} familyName={cloudFamily?.name} onAddCat={() => setShowAddCat(true)} onEditCat={openCatProfile} onManageFamily={() => navigateTo("family")} />}
      {activeTab === "family" && <FamilyPortal cats={cats} initialFamily={cloudFamily ?? undefined} initialMembers={cloudFamily ? cloudMembers : undefined} initialSession={cloudSession} workspaceReady={!cloudWorkspaceLoading} onRegisterExitGuard={(guard) => { familyExitGuard.current = guard; }} onClose={() => { navigateToRaw(cloudFamily ? "care" : "cats"); setCloudRefreshTick((tick) => tick + 1); }} onManageCats={() => navigateToRaw("cats")} onSelectCat={(id) => { setSelectedId(id); navigateToRaw("care"); }} />}
      {pendingCatRemoval && <ConfirmDialog
        title={`Remove ${pendingCatRemoval.name}?`}
        description={`${pendingCatRemoval.name} will be removed from your family tracker. Their existing care history will be kept.`}
        confirmLabel="Remove cat"
        busy={catRemovalBusy}
        onCancel={() => setPendingCatRemoval(null)}
        onConfirm={() => void confirmRemoveCat()}
      />}
      {pendingCareActionRemoval && <ConfirmDialog
        title={`Delete ${pendingCareActionRemoval.name}?`}
        description="This removes the action from the family care menu for everyone. Existing care logs and notifications keep the action details recorded at the time."
        confirmLabel="Delete action"
        busy={actionSaving}
        onCancel={() => setPendingCareActionRemoval(null)}
        onConfirm={() => void removeCareAction(pendingCareActionRemoval)}
      />}
      {showDiscardCareActionOrder && <ConfirmDialog
        title="Discard care menu changes?"
        description="Your new care item order has not been saved. Leaving now will undo these changes. Choose Done to keep the new order."
        confirmLabel="Discard changes"
        onCancel={() => { setShowDiscardCareActionOrder(false); pendingCareMenuExit.current = null; }}
        onConfirm={discardCareActionOrder}
      />}
      {discardDraft && <ConfirmDialog
        title="Discard unsaved changes?"
        description={discardDraft.description}
        confirmLabel="Discard changes"
        onCancel={() => setDiscardDraft(null)}
        onConfirm={() => { const discard = discardDraft.discard; setDiscardDraft(null); discard(); }}
      />}
    </div>
  );
}
