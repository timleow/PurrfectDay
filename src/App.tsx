import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import FamilyPortal from "./components/FamilyPortal";
import CatsOverview from "./components/CatsOverview";
import ConfirmDialog from "./components/ConfirmDialog";
import SignInScreen from "./components/SignInScreen";
import { blobToDataUrl, compressCatPhoto, cropCatPhoto } from "./data/catPhoto";
import { addDateKeyDays, dateKeyInZone, getFamilyCareWindow, startOfDayInZone } from "./data/dateWindows";
import { debounce } from "./data/debounce";
import { clearWorkspaceCache, readWorkspaceCache, writeWorkspaceCache } from "./data/workspaceCache";
import { canUndoCareAction, undoNumericDelta, undoWetFoodDelta } from "./data/undoCareAction";
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
  archiveCat as archiveCloudCat,
  updateCat as updateCloudCat,
  uploadCatPhoto,
  type CareEvent,
  type CloudCat,
  type Family,
  type FamilyMember,
  type TargetRule,
} from "./data/familyService";
import { isSupabaseConfigured, supabase } from "./data/supabase";

type IconName =
  | "bowl"
  | "calendar"
  | "check"
  | "chevron"
  | "drop"
  | "ear"
  | "family"
  | "heart"
  | "medical"
  | "minus"
  | "more"
  | "moon"
  | "paw"
  | "play"
  | "poop"
  | "pee"
  | "plus"
  | "settings"
  | "sparkle"
  | "sun"
  | "treat"
  | "undo"
  | "yarn";

type Cat = {
  id: number | string;
  name: string;
  color: string;
  initial: string;
  photo?: string;
};

type Tracker = {
  treats: number;
  kibble: number;
  cans: number;
  canProgress: number;
  treatsGoal: number;
  kibbleGoal: number;
  cansGoal: number;
  teethPawing: number;
  fountain: boolean;
  pooped: boolean;
  peed: boolean;
  ears: boolean;
  played: number;
  earsWeek: string;
};

type TrackableKey =
  | "treats"
  | "kibble"
  | "cans"
  | "teethPawing"
  | "fountain"
  | "pooped"
  | "peed"
  | "ears"
  | "played";

type CareLog = {
  id: string;
  catId: number | string;
  metric?: TrackableKey;
  actorUserId?: string;
  who: string;
  what: string;
  detail: string;
  timestamp: string;
  amountDelta?: number;
  batchCount?: number;
};

type PendingCareAction = {
  id: string;
  catId: string;
  metric: TrackableKey;
  amountDelta: number;
  timestamp: string;
  eventId?: string;
};

type FoodGoalKey = "treatsGoal" | "kibbleGoal" | "cansGoal";
type UndoAction = { catId: number | string; metric: TrackableKey; amountDelta: number; actorUserId?: string };

const metricLabels: Record<TrackableKey, string> = {
  treats: "Dental treats",
  kibble: "Kibble",
  cans: "Wet food",
  teethPawing: "Pawing at teeth",
  fountain: "Fountain top-up",
  pooped: "Pooped",
  peed: "Peed",
  ears: "Ears cleaned",
  played: "Playtime",
};

const tileLabels: Record<TrackableKey, string> = {
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

const metricIcons: Record<TrackableKey, IconName> = {
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

const databaseMetrics: Record<TrackableKey, string> = {
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

function trackerFromCloud(catId: string, events: CareEvent[], targets: TargetRule[], timezone: string): Tracker {
  const window = getFamilyCareWindow(timezone);
  const dayStart = new Date(window.todayFrom).getTime();
  const tomorrow = new Date(window.tomorrowFrom).getTime();
  const weekStart = new Date(window.weekFrom).getTime();
  const catEvents = events.filter((event) => event.cat_id === catId);
  const sum = (metric: string, from: number, until: number) => catEvents
    .filter((event) => event.metric === metric && new Date(event.occurred_at).getTime() >= from && new Date(event.occurred_at).getTime() < until)
    .reduce((total, event) => total + Number(event.amount_delta), 0);
  const goal = (metric: string, cadence: "daily" | "weekly", fallback: number) => {
    const rule = targets
      .filter((item) => item.cat_id === catId && item.metric === metric && item.cadence === cadence && item.effective_from <= window.today && (!item.effective_until || item.effective_until >= window.today))
      .sort((left, right) => right.effective_from.localeCompare(left.effective_from))[0];
    return Number(rule?.target_amount ?? fallback);
  };
  const wetAmount = Math.max(0, sum("wet_food", dayStart, tomorrow));
  const wholeCans = Math.floor(wetAmount + 0.000001);
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
    fountain: sum("fountain", dayStart, tomorrow) > 0,
    pooped: sum("poop", dayStart, tomorrow) > 0,
    peed: sum("pee", dayStart, tomorrow) > 0,
    ears: sum("ear_cleaning", weekStart, tomorrow) > 0,
    earsWeek: sum("ear_cleaning", weekStart, tomorrow) > 0 ? window.weekStart : "",
    played: Math.max(0, sum("play", dayStart, tomorrow)),
  };
}

function careLogsFromCloud(events: CareEvent[], members: FamilyMember[], userId: string, fallbackName: string, timezone: string): CareLog[] {
  const endOfToday = new Date(getFamilyCareWindow(timezone).tomorrowFrom);
  const actorNames = new Map(members.map((member) => [member.user_id, member.display_name || member.email.split("@")[0]]));
  return events.filter((event) => new Date(event.occurred_at) < endOfToday).flatMap((event) => {
    const metric = appMetrics[event.metric];
    if (!metric) return [];
    return [{
      id: event.id,
      catId: event.cat_id,
      metric,
      actorUserId: event.actor_user_id,
      who: actorNames.get(event.actor_user_id) ?? (event.actor_user_id === userId ? fallbackName : "Family member"),
      what: metricLabels[metric],
      detail: event.detail,
      timestamp: event.occurred_at,
      amountDelta: Number(event.amount_delta),
    } satisfies CareLog];
  });
}

function applyCareAction(tracker: Tracker, metric: TrackableKey, amountDelta: number): Tracker {
  if (metric === "cans") {
    const amount = Math.max(0, tracker.cans + tracker.canProgress / 100 + amountDelta);
    const cans = Math.floor(amount + 0.000001);
    return { ...tracker, cans, canProgress: Math.round((amount - cans) * 100) };
  }
  if (metric === "fountain" || metric === "pooped" || metric === "peed" || metric === "ears") {
    return { ...tracker, [metric]: amountDelta > 0 };
  }
  return { ...tracker, [metric]: Math.max(0, Number(tracker[metric]) + amountDelta) };
}

function getLogMetric(entry: CareLog): TrackableKey {
  if (entry.metric) return entry.metric;
  return (Object.entries(metricLabels).find(([, label]) => label === entry.what)?.[0] as TrackableKey | undefined) ?? "fountain";
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

function getCareLogDelta(entry: CareLog) {
  if (entry.amountDelta !== undefined) return entry.amountDelta;
  const match = entry.detail.match(/^(Added|Removed) (\d+(?:\.\d+)?)(%)?/);
  if (!match) return undefined;
  const metric = getLogMetric(entry);
  const amount = Number(match[2]) / (metric === "cans" && match[3] === "%" ? 100 : 1);
  return match[1] === "Removed" ? -amount : amount;
}

function batchCareLogs(logs: CareLog[]) {
  const sortedLogs = [...logs].sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
  const groups: CareLog[][] = [];
  const batchableAction = (entry: CareLog) => getCareLogDelta(entry) !== undefined;

  for (const entry of sortedLogs) {
    const metric = getLogMetric(entry);
    const action = entry.detail.startsWith("Removed") ? "Removed" : "Added";
    const group = batchableAction(entry) && entry.amountDelta !== undefined
      ? groups.find((candidate) => {
        const first = candidate[0];
        return batchableAction(first)
          && getLogMetric(first) === metric
          && (first.actorUserId ?? first.who) === (entry.actorUserId ?? entry.who)
          && (first.detail.startsWith("Removed") ? "Removed" : "Added") === action
          && new Date(entry.timestamp).getTime() - new Date(first.timestamp).getTime() <= 5 * 60 * 1000;
      })
      : undefined;

    if (group) group.push(entry);
    else groups.push([entry]);
  }

  return groups.map((group) => {
    const first = group[0];
    const firstDelta = getCareLogDelta(first);
    if (group.length === 1 || firstDelta === undefined) return first;

    const metric = getLogMetric(first);
    const action = first.detail.startsWith("Removed") ? "Removed" : "Added";
    const totalDelta = group.reduce((total, entry) => total + (getCareLogDelta(entry) ?? 0), 0);
    const amount = Math.abs(totalDelta);
    const formattedAmount = Number(amount.toFixed(1));
    const detail = metric === "cans"
      ? `${action} ${Math.round(formattedAmount * 100)}% of a can`
      : `${action} ${formattedAmount} ${formattedAmount === 1
        ? ({ treats: "treat", kibble: "spoon", teethPawing: "time", played: "session" } as Partial<Record<TrackableKey, string>>)[metric] ?? metricUnits[metric] ?? "times"
        : metricUnits[metric] ?? "times"}`;

    return { ...first, detail, amountDelta: totalDelta, batchCount: group.length };
  }).sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
}

function removeUndoneCareLogs(logs: CareLog[]) {
  const ordered = [...logs].sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
  const remaining: Array<{ entry: CareLog; delta: number }> = [];
  for (const entry of ordered) {
    const delta = getCareLogDelta(entry);
    if (delta === undefined || delta >= 0) {
      remaining.push({ entry, delta: delta ?? 0 });
      continue;
    }
    let toUndo = Math.abs(delta);
    const actor = entry.actorUserId ?? entry.who;
    for (const candidate of remaining) {
      if (toUndo <= 0.000001) break;
      if (candidate.delta <= 0 || getLogMetric(candidate.entry) !== getLogMetric(entry)) continue;
      if ((candidate.entry.actorUserId ?? candidate.entry.who) !== actor) continue;
      const canceled = Math.min(candidate.delta, toUndo);
      candidate.delta -= canceled;
      toUndo -= canceled;
    }
    if (toUndo > 0.000001) remaining.push({ entry, delta: -toUndo });
  }
  return remaining.flatMap(({ entry, delta }) => {
    if (delta >= -0.000001 && delta <= 0.000001) return [];
    if (delta > 0 && getCareLogDelta(entry) !== undefined && Math.abs(delta - (getCareLogDelta(entry) ?? 0)) > 0.000001) {
      const amount = getLogMetric(entry) === "cans" ? `${Math.round(delta * 100)}% of a can` : `${Number(delta.toFixed(1))} ${metricUnits[getLogMetric(entry)] ?? "times"}`;
      return [{ ...entry, amountDelta: delta, detail: `Added ${amount}` }];
    }
    if (delta < 0 && getCareLogDelta(entry) !== undefined && Math.abs(delta - (getCareLogDelta(entry) ?? 0)) > 0.000001) {
      const amount = getLogMetric(entry) === "cans" ? `${Math.round(Math.abs(delta) * 100)}% of a can` : `${Number(Math.abs(delta).toFixed(1))} ${metricUnits[getLogMetric(entry)] ?? "times"}`;
      return [{ ...entry, amountDelta: delta, detail: `Removed ${amount}` }];
    }
    return [entry];
  });
}

const metricUnits: Partial<Record<TrackableKey, string>> = {
  treats: "treats",
  kibble: "spoons",
  cans: "cans",
  teethPawing: "times",
  played: "sessions",
};

const breakdownQuestions: Record<TrackableKey, string> = {
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
  fountain: false,
  pooped: false,
  peed: false,
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
  const parsed = JSON.parse(saved) as Record<string, Partial<Tracker> & { played?: number | boolean }>;
  return Object.fromEntries(
    Object.entries(parsed).map(([id, tracker]) => [
      Number(id),
      {
        ...emptyTracker,
        ...tracker,
        played: typeof tracker.played === "number" ? tracker.played : tracker.played ? 1 : 0,
        earsWeek: tracker.earsWeek ?? (tracker.ears ? getLocalWeekKey() : ""),
      },
    ]),
  );
}

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    bowl: (
      <>
        <path d="M4 10h16c-.45 5.4-3.1 8-8 8s-7.55-2.6-8-8Z" />
        <path d="M7 7.5c1.4-1.5 2.7-1.5 4 0s2.6 1.5 4 0" />
      </>
    ),
    calendar: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="3" />
        <path d="M8 3v4M16 3v4M4 10h16" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    drop: <path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11Z" />,
    ear: (
      <>
        <path d="M6.2 5.7C8.3 2.2 14.8 2.1 17 6c2.1 3.8-.9 6.1-3 7.4-2.5 1.6-1.6 5.3-5.1 5.3-3.4 0-5.3-7.8-2.7-13Z" />
        <path d="M9 8.3c1.5-1.5 4.5-1.4 5.4.6.8 1.7-1.2 2.5-2.3 3.2" />
      </>
    ),
    family: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 20v-1.4a5.5 5.5 0 0 1 11 0V20M16 5.5a3 3 0 0 1 0 5.8M17 14.2a4.7 4.7 0 0 1 3.5 4.5V20" />
      </>
    ),
    heart: <path d="M20.8 5.8c-2.4-2.4-6.3-1.8-8.8 1.1-2.5-2.9-6.4-3.5-8.8-1.1-2.7 2.7-1.4 7.3.9 9.6 2 2 7.9 5.6 7.9 5.6s5.9-3.6 7.9-5.6c2.3-2.3 3.6-6.9.9-9.6Z" />,
    medical: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="3" />
        <path d="M9 3v4h6V3M9 13h6M12 10v6" />
      </>
    ),
    minus: <path d="M6 12h12" />,
    more: <>
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </>,
    moon: <path d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8 8.5 8.5 0 1 0 20.2 15.1Z" />,
    poop: (
      <>
        <path d="M5 18.2c0-1.7 1.2-3 3-3.2-.7-2.1.4-4.3 2.6-4.8.3-2.4 1.5-4 3.4-4s3.1 1.6 3.4 4c2.1.5 3.2 2.7 2.5 4.8 1.8.2 3 1.5 3 3.2 0 1-.8 1.8-1.8 1.8H6.8c-1 0-1.8-.8-1.8-1.8Z" />
        <path d="M9.4 17.2h.1m5 0h.1m-3.6 1.2c.7.6 1.4.6 2.1 0" />
      </>
    ),
    pee: (
      <>
        <path d="M12 2.5s3.3 3.8 3.3 6.2a3.3 3.3 0 0 1-6.6 0c0-2.4 3.3-6.2 3.3-6.2Z" />
        <path d="M5.3 12.8s2.3 2.7 2.3 4.4a2.3 2.3 0 0 1-4.6 0c0-1.7 2.3-4.4 2.3-4.4ZM18.7 12.8s2.3 2.7 2.3 4.4a2.3 2.3 0 0 1-4.6 0c0-1.7 2.3-4.4 2.3-4.4Z" />
      </>
    ),
    paw: (
      <>
        <ellipse cx="12" cy="15.5" rx="5.3" ry="4.2" />
        <ellipse cx="5.7" cy="11" rx="2.1" ry="2.7" />
        <ellipse cx="18.3" cy="11" rx="2.1" ry="2.7" />
        <ellipse cx="9" cy="6.5" rx="2.1" ry="2.7" />
        <ellipse cx="15" cy="6.5" rx="2.1" ry="2.7" />
      </>
    ),
    play: <path d="m8 5 11 7-11 7V5Z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    settings: (
      <>
        <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="8" cy="17" r="2" />
      </>
    ),
    sparkle: (
      <>
        <path d="M12 3c.7 4.8 3.2 7.3 8 8-4.8.7-7.3 3.2-8 8-.7-4.8-3.2-7.3-8-8 4.8-.7 7.3-3.2 8-8Z" />
        <path d="M19 2v4M17 4h4" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
    treat: (
      <>
        <path d="m7 8-3-2v6l3-2M17 8l3-2v6l-3-2" />
        <rect x="7" y="6" width="10" height="8" rx="3" />
      </>
    ),
    undo: <path d="M9 14 4 9l5-5M4 9h9a7 7 0 0 1 0 14h-2" />,
    yarn: (
      <>
        <circle cx="10.5" cy="12.5" r="6.5" />
        <path d="M5 9.2c2.1 1.5 5.8 1.7 10.8-.1M4.1 12.3c3.7-1.9 8.7-1.8 12.7.2M4.7 15.1c3.4-1.9 7.4-1.7 10.5.1M8.6 6.4c-.3 4.1 1.1 7.5 4.6 11.4M15.7 17.5c2.3-.2 3.7.2 4.4 1.3.7 1-.3 2.5-1.5 2" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name]}
    </svg>
  );
}

function CatAvatar({
  cat,
  size = "normal",
}: {
  cat: Cat;
  size?: "normal" | "large";
}) {
  return (
    <div
      className={`cat-avatar ${size === "large" ? "cat-avatar-large" : ""}`}
      style={{ "--cat-color": cat.color } as React.CSSProperties}
    >
      {cat.photo ? (
        <img className="cat-photo" src={cat.photo} alt={`${cat.name}`} />
      ) : (
        <>
          <span className="cat-ear cat-ear-left" />
          <span className="cat-ear cat-ear-right" />
          <span className="cat-face">
            <i />
            <b>{cat.initial}</b>
            <i />
          </span>
        </>
      )}
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
              <span className={`activity-log-dot metric-${getLogMetric(entry)}`}><Icon name={metricIcons[getLogMetric(entry)]} size={13} /></span>
              <div><strong>{tileLabels[getLogMetric(entry)]}</strong><small>{conciseLogAction(entry.detail)} · by {entry.who}</small></div>
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
}: {
  value: number;
  onChange: (next: number) => void;
  accent: string;
  goal?: number;
}) {
  return (
    <div className="stepper" style={{ "--accent": accent } as React.CSSProperties}>
      <button
        aria-label="Decrease"
        disabled={value === 0}
        onClick={() => onChange(Math.max(0, value - 1))}
      >
        <Icon name="minus" size={16} />
      </button>
      <strong>{goal ? <>{value}<small>/{goal}</small></> : value}</strong>
      <button aria-label="Increase" onClick={() => onChange(value + 1)}>
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
  const [activeTab, setActiveTab] = useState<"care" | "cats" | "family">("care");
  const [showQuotas, setShowQuotas] = useState(false);
  const [goalDrafts, setGoalDrafts] = useState<Record<FoodGoalKey, string>>({ treatsGoal: "4", kibbleGoal: "3", cansGoal: "1" });
  const [newCatName, setNewCatName] = useState("");
  const [newCatPhoto, setNewCatPhoto] = useState<string | undefined>();
  const [newCatPhotoPosition, setNewCatPhotoPosition] = useState({ x: 50, y: 50 });
  const [newCatPhotoZoom, setNewCatPhotoZoom] = useState(1);
  const [photoEditCatId, setPhotoEditCatId] = useState<number | string | null>(null);
  const [photoEditDraft, setPhotoEditDraft] = useState<string | undefined>();
  const [photoEditSaving, setPhotoEditSaving] = useState(false);
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
  const cachedUserId = useRef<string | null>(null);
  const [cloudTargets, setCloudTargets] = useState<TargetRule[]>([]);
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
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("purrfect-theme", theme);
  }, [theme]);

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

  useEffect(() => {
    localStorage.setItem("purrfect-active-metric", activeMetric);
  }, [activeMetric]);

  useEffect(() => {
    if (!showTrackPicker) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowTrackPicker(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [showTrackPicker]);

  const returnToCare = () => setActiveTab("care");

  const selectedCat = cats.find((cat) => cat.id === selectedId) ?? cats[0] ?? { id: "", name: "Your cat", color: "#79B8A9", initial: "?" };
  const savedTracker = { ...emptyTracker, ...(trackers[selectedId] ?? {}) };
  const tracker = {
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
        setCloudMembers(cached.members);
        setCloudEvents(cached.events);
        setCloudTargets(cached.targets);
        setCats(cachedCats);
        setCareLogs(careLogsFromCloud(cached.events, cached.members, userId, fallbackName, cached.family.timezone));
        setTrackers(Object.fromEntries(cached.cats.map((cat) => [cat.id, trackerFromCloud(cat.id, cached.events, cached.targets, cached.family.timezone)])));
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
            if (event.metric !== databaseMetrics[action.metric] || Math.abs(Number(event.amount_delta) - action.amountDelta) > 0.000001) return false;
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
          const baseTracker = trackerFromCloud(cat.id, events, targets, family.timezone);
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
        if (active) setCloudWorkspaceLoading(false);
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

  const addCareLog = (key: TrackableKey, detail: string, amountDelta?: number) => {
    const who = cloudFamily && cloudSession
      ? cloudMembers.find((member) => member.user_id === cloudSession.user.id)?.display_name || cloudSession.user.email?.split("@")[0] || "Family member"
      : memberName.trim() || "Family member";
    const timestamp = new Date().toISOString();
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
      void recordCareEvent({
        family_id: cloudFamily.id,
        cat_id: selectedCat.id,
        metric: databaseMetrics[key],
        amount_delta: inferredDelta,
        unit: metricUnits[key] ?? "times",
        detail,
        occurred_at: timestamp,
      }).then((event) => {
        const savedAction = pendingCareActions.current.get(pendingAction.id);
        if (savedAction) savedAction.eventId = event.id;
        const entry: CareLog = {
          id: event.id,
          catId: event.cat_id,
          metric: key,
          actorUserId: event.actor_user_id,
          who,
          what: metricLabels[key],
          detail: event.detail,
          timestamp: event.occurred_at,
          amountDelta: Number(event.amount_delta),
        };
        setCloudEvents((current) => [event, ...current].slice(0, 500));
        setCareLogs((current) => [entry, ...current].slice(0, 500));
      }).catch((cause: unknown) => {
        pendingCareActions.current.delete(pendingAction.id);
        setTrackers((current) => {
          const latest = { ...emptyTracker, ...(current[pendingAction.catId] ?? {}) };
          return { ...current, [pendingAction.catId]: applyCareAction(latest, pendingAction.metric, -pendingAction.amountDelta) };
        });
        setCloudError(cause instanceof Error ? cause.message : "Could not save that care entry.");
        setCloudRefreshTick((tick) => tick + 1);
      });
      return;
    }
    setCareLogs((current) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        catId: selectedId,
        metric: key,
        who,
        what: metricLabels[key],
        detail,
        timestamp,
        amountDelta: amountDelta ?? (detail === "Marked done" ? 1 : detail === "Undid this check-in" ? -1 : undefined),
      },
      ...current,
    ].slice(0, 500));
  };

  const update = (key: keyof Tracker, value: number | boolean) => {
    setUndoAction(null);
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
    if (key in metricLabels) {
      const metricKey = key as TrackableKey;
      const previous = key === "ears" ? tracker.ears : { ...emptyTracker, ...(trackers[selectedId] ?? {}) }[key];
      if (typeof previous === "number" && typeof value === "number" && previous !== value) {
        const difference = Math.abs(value - previous);
        const unit = metricUnits[metricKey] ?? "";
        const displayUnit = difference === 1 ? unit.replace(/s$/, "") : unit;
        addCareLog(metricKey, `${value > previous ? "Added" : "Removed"} ${difference}${displayUnit ? ` ${displayUnit}` : ""}`, (value > previous ? 1 : -1) * difference);
      } else if (typeof previous === "boolean" && typeof value === "boolean" && previous !== value) {
        addCareLog(metricKey, value ? "Marked done" : "Undid this check-in", value ? 1 : -1);
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

  const openGoalEditor = () => {
    setGoalDrafts({
      treatsGoal: String(tracker.treatsGoal),
      kibbleGoal: String(tracker.kibbleGoal),
      cansGoal: String(tracker.cansGoal),
    });
    setShowQuotas(true);
  };

  const saveGoalDrafts = () => {
    (Object.keys(goalDrafts) as FoodGoalKey[]).forEach((key) => {
      const value = Number(goalDrafts[key]);
      if (Number.isFinite(value) && value > 0 && value !== tracker[key]) update(key, value);
    });
    setShowQuotas(false);
  };

  const completed = useMemo(() => {
    const checks = [
      tracker.treats >= tracker.treatsGoal,
      tracker.kibble >= tracker.kibbleGoal,
      tracker.cans >= tracker.cansGoal,
      tracker.fountain,
      tracker.pooped,
      tracker.peed,
      tracker.played > 0,
    ];
    return checks.filter(Boolean).length;
  }, [tracker]);

  const addCat = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = newCatName.trim();
    if (!name) return;
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
        setTrackers((current) => ({ ...current, [created.id]: trackerFromCloud(created.id, cloudEvents, cloudTargets, cloudFamily.timezone) }));
        setSelectedId(created.id);
        setNewCatName("");
        setNewCatPhoto(undefined);
        setNewCatPhotoPosition({ x: 50, y: 50 });
        setNewCatPhotoZoom(1);
        setPhotoError("");
        setShowAddCat(false);
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
    setShowAddCat(false);
  };

  const openCatPhotoEditor = async (file?: File, catId = selectedId) => {
    if (!file) return;
    try {
      const photo = await readCatPhoto(file);
      setPhotoEditCatId(catId);
      setPhotoEditDraft(photo);
      setNewCatPhotoPosition({ x: 50, y: 50 });
      setNewCatPhotoZoom(1);
      setPhotoError("");
      setCloudError("");
    } catch (cause) {
      const message = errorMessage(cause, "Could not process this photo.");
      setPhotoError(message);
      if (cloudFamily) setCloudError(`Could not save the cat photo: ${message}`);
    }
  };

  const saveCatPhotoEdit = async () => {
    if (photoEditCatId === null || !photoEditDraft || photoEditSaving) return;
    const catId = photoEditCatId;
    setPhotoEditSaving(true);
    try {
      const croppedPhoto = await cropCatPhoto(photoEditDraft, { ...newCatPhotoPosition, zoom: newCatPhotoZoom });
      if (cloudFamily && typeof catId === "string") {
        if (cloudSession) clearWorkspaceCache(cloudSession.user.id);
        const blob = await fetch(croppedPhoto).then((response) => response.blob());
        const file = new File([blob], "cat-photo.jpg", { type: blob.type || "image/jpeg" });
        const path = await uploadCatPhoto(cloudFamily.id, catId, file);
        const photoUrl = await getCatPhotoUrl(path);
        setCats((current) => current.map((cat) => cat.id === catId ? { ...cat, photo: photoUrl } : cat));
      } else {
        setCats((current) => current.map((cat) => cat.id === catId ? { ...cat, photo: croppedPhoto } : cat));
      }
      setPhotoEditCatId(null);
      setPhotoEditDraft(undefined);
      setPhotoError("");
      setCloudError("");
    } catch (cause) {
      const message = errorMessage(cause, "Could not process this photo.");
      setPhotoError(message);
      if (cloudFamily) setCloudError(`Could not save the cat photo: ${message}`);
    } finally {
      setPhotoEditSaving(false);
    }
  };

  const cancelCatPhotoEdit = () => {
    if (photoEditSaving) return;
    setPhotoEditCatId(null);
    setPhotoEditDraft(undefined);
    setPhotoError("");
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
    key: TrackableKey;
    label: string;
    shortLabel: string;
    icon: IconName;
    color: string;
    goal?: keyof Tracker;
    unit?: string;
  }> = [
    { key: "treats", label: "Dental treats", shortLabel: "Treats", icon: "treat", color: "sunny", goal: "treatsGoal", unit: "treats" },
    { key: "kibble", label: "Spoons of kibble", shortLabel: "Kibble", icon: "bowl", color: "sky", goal: "kibbleGoal", unit: "spoons" },
    { key: "cans", label: "Cans of wet food", shortLabel: "Wet food", icon: "medical", color: "mint", goal: "cansGoal", unit: "cans" },
    { key: "fountain", label: "Fountain top-up", shortLabel: "Water", icon: "drop", color: "aqua" },
    { key: "teethPawing", label: "Pawing at teeth", shortLabel: "Teeth", icon: "paw", color: "berry", unit: "times" },
    { key: "pooped", label: "Pooped today", shortLabel: "Poop", icon: "poop", color: "lilac" },
    { key: "peed", label: "Peed today", shortLabel: "Pee", icon: "pee", color: "blueberry" },
    { key: "ears", label: "Ears cleaned", shortLabel: "Ears", icon: "ear", color: "peachy" },
    { key: "played", label: "Playtime", shortLabel: "Play", icon: "yarn", color: "purple", unit: "session" },
  ];
  const activeItem = mobileMetrics.find((item) => item.key === activeMetric)!;
  const switchTrackingMode = (direction: -1 | 1) => {
    setActiveMetric((current) => {
      const index = mobileMetrics.findIndex((item) => item.key === current);
      return mobileMetrics[(index + direction + mobileMetrics.length) % mobileMetrics.length].key;
    });
    setUndoAction(null);
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
  const activeValue = tracker[activeMetric] as number | boolean;
  const activeGoal = activeItem.goal ? (tracker[activeItem.goal] as number) : undefined;
  const breakdownAmount = activeMetric === "cans"
    ? tracker.cans + tracker.canProgress / 100
    : typeof activeValue === "boolean" ? Number(activeValue) : activeValue;
  const breakdownAmountLabel = String(Number(breakdownAmount.toFixed(1)));
  const isToggle = typeof activeValue === "boolean";
  const isComplete = isToggle ? activeValue : activeGoal ? activeValue >= activeGoal : false;
  const now = new Date();
  const activityEntries = careLogs.filter((entry) => {
    const timestamp = new Date(entry.timestamp);
    const todayWindow = cloudFamily ? getFamilyCareWindow(cloudFamily.timezone, now) : undefined;
    const isToday = todayWindow
      ? timestamp >= new Date(todayWindow.todayFrom) && timestamp < new Date(todayWindow.tomorrowFrom)
      : timestamp.getFullYear() === now.getFullYear() && timestamp.getMonth() === now.getMonth() && timestamp.getDate() === now.getDate();
    const isInPeriod = activeMetric === "ears"
      ? todayWindow
        ? timestamp >= new Date(todayWindow.weekFrom) && timestamp < new Date(todayWindow.tomorrowFrom)
        : getLocalWeekKey(timestamp) === getLocalWeekKey(now)
      : isToday;
    const isCareAction = getCareLogDelta(entry) !== undefined
      || entry.detail.startsWith("Completed")
      || entry.detail === "Marked done";
    return String(entry.catId) === String(selectedId) && (entry.metric ? entry.metric === activeMetric : entry.what === metricLabels[activeMetric]) && isInPeriod && isCareAction;
  });
  const visibleActivityEntries = batchCareLogs(removeUndoneCareLogs(activityEntries));
  const contributionTimeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  const contributionPeriod = activeMetric === "ears" ? "This week" : "Today";

  const handleBigTap = () => {
    if (activeMetric === "cans") {
      const amountDelta = 0.1;
      setUndoAction({ catId: selectedId, metric: "cans", amountDelta, actorUserId: cloudSession?.user.id });
      addCareLog("cans", "Added 10% of a can", amountDelta);
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
    } else if (typeof activeValue === "number") {
      const unit = metricUnits[activeMetric] ?? "";
      const displayUnit = unit.replace(/s$/, "");
      addCareLog(activeMetric, `Added 1${displayUnit ? ` ${displayUnit}` : ""}`, 1);
      setTrackers((current) => {
        const latest = { ...emptyTracker, ...(current[selectedId] ?? {}) };
        return { ...current, [selectedId]: { ...latest, [activeMetric]: Number(latest[activeMetric]) + 1 } };
      });
      setUndoAction({ catId: selectedId, metric: activeMetric, amountDelta: 1, actorUserId: cloudSession?.user.id });
    } else {
      if (!activeValue && (activeMetric === "peed" || activeMetric === "pooped")) {
        playCareSound(activeMetric);
      }
      update(activeMetric, !activeValue);
    }
    setTapBurst((current) => current + 1);
  };

  const undoLastTap = () => {
    if (!undoAction || String(undoAction.catId) !== String(selectedId)) return;
    setUndoAction(null);
    if (!canUndoCareAction(undoAction.actorUserId, cloudSession?.user.id)) return;
    const amountDelta = undoAction.amountDelta;
    if (undoAction.metric === "cans") {
      setTrackers((current) => ({
        ...current,
        [undoAction.catId]: (() => {
          const latest = { ...emptyTracker, ...(current[undoAction.catId] ?? {}) };
          return { ...latest, ...undoWetFoodDelta(latest.cans, latest.canProgress, amountDelta) };
        })(),
      }));
      addCareLog("cans", "Undid this check-in", -amountDelta);
      return;
    }
    const unit = metricUnits[undoAction.metric] ?? "";
    const displayUnit = amountDelta === 1 ? unit.replace(/s$/, "") : unit;
    const amountText = Number.isInteger(amountDelta) ? String(amountDelta) : String(Number(amountDelta.toFixed(1)));
    const currentValue = { ...emptyTracker, ...(trackers[undoAction.catId] ?? {}) }[undoAction.metric];
    if (typeof currentValue !== "number") return;
    setTrackers((current) => {
      const latest = { ...emptyTracker, ...(current[undoAction.catId] ?? {}) };
      return { ...current, [undoAction.catId]: { ...latest, [undoAction.metric]: undoNumericDelta(latest[undoAction.metric] as number, amountDelta) } };
    });
    addCareLog(undoAction.metric, `Removed ${amountText}${displayUnit ? ` ${displayUnit}` : ""}`, -amountDelta);
  };

  if (isSupabaseConfigured && (!cloudSession || authLoading)) {
    return <SignInScreen busy={authBusy} error={cloudError} loading={authLoading} onSignIn={() => void startGoogleSignIn()} toolbar={themeToggle} />;
  }
  if (isSupabaseConfigured && cloudWorkspaceLoading && !cloudFamily) {
    return <main aria-busy="true" className="family-portal-loading app-workspace-loading"><span className="family-loading-spinner" />Loading your family and cats…</main>;
  }

  return (
    <div className="app-root">
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
              onClick={() => { setSelectedId(cat.id); setUndoAction(null); }}
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
          <div className="mobile-header-actions">
            {themeToggle}
          </div>
        </header>

        <section className="mobile-tracker">
          <div className="mobile-cat-row">
            <div>
              <p>Taking care of</p>
              <h1>{selectedCat.name}</h1>
              <label className="photo-picker">
                {selectedCat.photo ? "Change photo" : "Add a photo"}
                <input accept="image/*,.heic,.heif" type="file" onChange={(event) => { void openCatPhotoEditor(event.target.files?.[0]); event.target.value = ""; }} />
              </label>
            </div>
            <div className="mobile-cat-picker">
              {cats.map((cat) => (
                <button
                  aria-label={`Track care for ${cat.name}`}
                  className={cat.id === selectedId ? "active" : ""}
                  key={cat.id}
                  onClick={() => { setSelectedId(cat.id); setUndoAction(null); }}
                >
                  <CatAvatar cat={cat} />
                </button>
              ))}
            </div>
          </div>

          <div className="mobile-progress-card">
            <span><Icon name="heart" size={17} /></span>
            <div>
              <strong>{completed === 7 ? "All cared for!" : `${completed} of 7 daily cares`}</strong>
              <div className="mobile-progress-track">
                <i style={{ width: `${Math.max(5, (completed / 7) * 100)}%` }} />
              </div>
            </div>
            <small>{completed === 7 ? "Perfect day" : "Keep going"}</small>
          </div>
          {cloudError && <p className="cloud-feedback" role="status">{cloudError}</p>}

          <div className="mobile-tracker-actions">
            <button className="track-picker-trigger" onClick={() => setShowTrackPicker(true)} type="button">
              <Icon name="more" size={16} />
              Care Menu
            </button>
            <button className="edit-goals-trigger" onClick={openGoalEditor} type="button"><Icon name="settings" size={15} /> Edit goals</button>
          </div>

          <div
            className={`big-tap-wrap ${activeItem.color} ${showBreakdown ? "is-flipped" : ""}`}
            onPointerDown={handleTrackerPointerDown}
            onPointerUp={handleTrackerPointerUp}
            onPointerCancel={() => { swipeStart.current = null; }}
          >
          {undoAction && String(undoAction.catId) === String(selectedId) && !showBreakdown && (
            <button aria-label={`Undo last ${undoAction.metric === "cans" ? "wet food tap" : "+1"}`} className="tap-undo-icon" onClick={undoLastTap} title="Undo last check-in" type="button">
              <Icon name="undo" size={17} />
            </button>
          )}
          <div className="big-tap-flip">
          <button
            key={modeSwipeTransition?.key ?? 0}
            aria-label={isToggle ? `Toggle ${activeItem.label}` : `Add one ${activeItem.unit}`}
            aria-hidden={showBreakdown}
            className={`big-tap-card ${activeItem.color} metric-${activeMetric} ${isComplete ? "complete" : ""} ${modeSwipeTransition ? `mode-swipe-${modeSwipeTransition.direction}` : ""}`}
            disabled={showBreakdown}
            tabIndex={showBreakdown ? -1 : 0}
            onClick={() => {
              if (ignoreNextTap.current) {
                ignoreNextTap.current = false;
                return;
              }
              setShowBreakdown(false);
              handleBigTap();
            }}
          >
            <div className="tap-doodles" aria-hidden="true">
              <i /><i /><i />
            </div>
            <div className="big-icon"><Icon name={isComplete ? "check" : activeItem.icon} size={43} /></div>
            <p>{activeItem.label}</p>
            {activeMetric === "cans" ? (
              <div className="wet-food-count">
                <strong>{tracker.cans} <small>{tracker.cans === 1 ? "can" : "cans"}</small></strong>
                <div><i style={{ width: `${tracker.canProgress}%` }} /></div>
                <span>{tracker.canProgress}% of the next can</span>
                {activeGoal && <GoalProgress className="big-goal-progress" value={Number(activeValue)} goal={activeGoal} />}
              </div>
            ) : isToggle ? (
              <strong>
                {activeMetric === "ears"
                  ? activeValue ? "Done this week!" : "Not yet this week"
                  : activeValue ? "Done today!" : "Not yet"}
              </strong>
            ) : (
              <>
                <strong className="big-count">
                  {activeValue}
                  {activeGoal && <small> / {activeGoal}</small>}
                </strong>
                {activeGoal && <GoalProgress className="big-goal-progress" value={Number(activeValue)} goal={activeGoal} />}
              </>
            )}
            <span className="tap-prompt">
              <Icon name={isToggle && activeValue ? "check" : "plus"} size={17} />
              {activeMetric === "cans"
                ? "Tap to add 10%"
                : isToggle
                  ? activeMetric === "ears"
                    ? (activeValue ? "Tap to undo this week" : "Tap when done this week")
                    : (activeValue ? "Tap to undo" : "Tap when done")
                  : "Tap to add one"}
            </span>
            {tapBurst > 0 && (
              <div className={`metric-scene variant-${tapBurst % 3}`} key={tapBurst} aria-hidden="true">
                {(activeMetric === "treats" || activeMetric === "kibble" || activeMetric === "cans") && (
                  <div className="chomp-cat">
                    <span className="chomp-ear left" /><span className="chomp-ear right" />
                    <i className="chomp-eye left" /><i className="chomp-eye right" />
                    <b className="chomp-mouth"><i /></b>
                    <em className="food-bit" />
                  </div>
                )}
                {activeMetric === "played" && (
                  <div className="play-scene">
                    <i className="string" /><b className="toy" /><span className="swipe-paw"><i /><i /><i /></span>
                  </div>
                )}
                {activeMetric === "peed" && (
                  <div className="pee-scene"><Icon name="pee" size={58} /></div>
                )}
                {activeMetric === "fountain" && (
                  <div className="droplet-scene"><i /><i /><i /><i /><i /></div>
                )}
                {activeMetric === "pooped" && (
                  <div className="poop-scene">
                    <span className="poop"><i /><i /><i /></span>
                    <b className="fly fly-one"><i /></b><b className="fly fly-two"><i /></b>
                  </div>
                )}
                {activeMetric === "teethPawing" && (
                  <div className="paw-scene"><Icon name="paw" size={54} /><i /><i /></div>
                )}
                {activeMetric === "ears" && (
                  <div className="ear-scene"><Icon name="ear" size={60} /><i /><i /></div>
                )}
                <div className="tap-burst">
                  <b>{activeMetric === "cans" ? "+10%" : isToggle ? "Done!" : "+1"}</b>
                  <i /><i /><i /><i /><i />
                </div>
              </div>
            )}
          </button>
          <button aria-hidden={showBreakdown} className="feeding-breakdown-trigger" disabled={showBreakdown} onClick={() => setShowBreakdown(true)} tabIndex={showBreakdown ? -1 : 0} type="button">
            {breakdownQuestions[activeMetric]} <span aria-label={`${breakdownAmountLabel} tracked`}>{breakdownAmountLabel}</span>
          </button>
          <div className="big-tap-backface" aria-hidden={!showBreakdown} aria-label={`${activeItem.shortLabel} record`}>
            <div className="record-card-heading">
              <div><small>{contributionPeriod} record</small><strong>{breakdownQuestions[activeMetric]}</strong></div>
              <span aria-label={`${breakdownAmountLabel} tracked`}>{breakdownAmountLabel}</span>
            </div>
            <h3>{activeItem.shortLabel}</h3>
            {visibleActivityEntries.length ? (
              <ol className="record-card-list">
                {visibleActivityEntries.map((entry) => (
                  <li key={entry.id}>
                    <div><strong>{entry.who}</strong><small>{entry.detail}</small></div>
                    <time dateTime={entry.timestamp}>{contributionTimeFormat.format(new Date(entry.timestamp))}</time>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="record-card-empty">No {activeItem.shortLabel.toLowerCase()} activity recorded {activeMetric === "ears" ? "this week" : "today"} yet.</p>
            )}
            <button className="record-card-back" disabled={!showBreakdown} onClick={() => setShowBreakdown(false)} type="button">‹ Back to tracking</button>
          </div>
          </div>
          </div>
          <p className="mobile-helper">
            {activeGoal
              ? isComplete
                ? `Nice! ${selectedCat.name} reached today’s goal.`
                : `${Math.max(0, activeGoal - Number(activeValue))} more to reach today’s goal`
              : activeMetric === "ears"
                ? "This check-in resets each week"
                : "Tap the big card whenever it happens"}
          </p>
          {showTrackPicker && <div className="track-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowTrackPicker(false); }}>
            <section aria-labelledby="track-picker-title" aria-modal="true" className="track-picker-dialog" role="dialog">
              <header><div><span>Care tracker</span><h2 id="track-picker-title">What would you like to track?</h2></div><button aria-label="Close tracking options" onClick={() => setShowTrackPicker(false)} type="button">×</button></header>
              <div className="mobile-item-grid">
                {mobileMetrics.map((item) => {
                  const value = tracker[item.key];
                  const done = typeof value === "boolean" ? value : value > 0;
                  return <button
                    aria-pressed={activeMetric === item.key}
                    className={`${item.color} ${activeMetric === item.key ? "active" : ""}`}
                    key={item.key}
                    onClick={() => {
                      setActiveMetric(item.key);
                      setUndoAction(null);
                      setTapBurst(0);
                      setShowBreakdown(false);
                      setShowTrackPicker(false);
                    }}
                    type="button"
                  >
                    <span><Icon name={item.icon} size={21} /></span>
                    <strong>{item.shortLabel}</strong>
                    {item.goal && <><small className="tile-goal-count">{Number(value)} / {Number(tracker[item.goal])}</small><GoalProgress className="tile-goal-progress" value={Number(value)} goal={Number(tracker[item.goal])} /></>}
                    {done && <i><Icon name="check" size={10} /></i>}
                  </button>;
                })}
              </div>
              <p className="track-picker-hint">You can also swipe left or right on the care card.</p>
            </section>
          </div>}

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
              <label className="photo-picker">
                {selectedCat.photo ? "Change photo" : "Add a photo"}
                <input accept="image/*,.heic,.heif" type="file" onChange={(event) => { void openCatPhotoEditor(event.target.files?.[0]); event.target.value = ""; }} />
              </label>
              {photoError && <small className="photo-error">{photoError}</small>}
            </div>
          </div>
          <div className="daily-progress">
            <div>
              <span>Daily care</span>
              <strong>{completed} of 7</strong>
            </div>
            <div className="progress-track"><span style={{ width: `${(completed / 7) * 100}%` }} /></div>
            <small>{completed === 7 ? "All done — what a loved kitty!" : "You’re doing great!"}</small>
          </div>
          <div className="page-header-actions">
            {themeToggle}
          </div>
        </section>
        {cloudError && <p className="cloud-feedback desktop-cloud-feedback" role="status">{cloudError}</p>}

        <section className="dashboard-grid">
          <article className="card food-card">
            <div className="card-heading">
              <span className="heading-icon peach"><Icon name="bowl" /></span>
              <div><h2>Food & water</h2><p>Today’s meals and sips</p></div>
              <button className="quota-button" onClick={openGoalEditor}>
                <Icon name="settings" size={15} />
                Quotas
              </button>
            </div>
            <div className="tracker-list">
              <div className="tracker-row">
                <span className="item-icon yellow"><Icon name="treat" size={19} /></span>
                <div className="tracker-label"><strong>Dental treats</strong><small>pieces</small><GoalProgress value={tracker.treats} goal={tracker.treatsGoal} color="#E3A238" /></div>
                <Stepper value={tracker.treats} goal={tracker.treatsGoal} onChange={(v) => update("treats", v)} accent="#E3A238" />
              </div>
              <div className="tracker-row">
                <span className="item-icon blue"><Icon name="bowl" size={19} /></span>
                <div className="tracker-label"><strong>Kibble</strong><small>spoons</small><GoalProgress value={tracker.kibble} goal={tracker.kibbleGoal} color="#6D91CA" /></div>
                <Stepper value={tracker.kibble} goal={tracker.kibbleGoal} onChange={(v) => update("kibble", v)} accent="#6D91CA" />
              </div>
              <div className="tracker-row">
                <span className="item-icon green"><Icon name="medical" size={18} /></span>
                <div className="tracker-label"><strong>Wet food</strong><small>cans</small><GoalProgress value={tracker.cans} goal={tracker.cansGoal} color="#71A991" /></div>
                <Stepper value={tracker.cans} goal={tracker.cansGoal} onChange={(v) => update("cans", v)} accent="#71A991" />
              </div>
              <div className="tracker-row">
                <span className="item-icon aqua"><Icon name="drop" size={19} /></span>
                <div className="tracker-label"><strong>Fountain topped up</strong><small>fresh & flowing</small></div>
                <Toggle active={tracker.fountain} onClick={() => update("fountain", !tracker.fountain)} label={tracker.fountain ? "Done" : "Not yet"} />
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
                  <Toggle active={tracker.pooped} onClick={() => update("pooped", !tracker.pooped)} label={<><Icon name="poop" size={14} /> Pooped</>} />
                  <Toggle active={tracker.peed} onClick={() => update("peed", !tracker.peed)} label={<><Icon name="pee" size={14} /> Peed</>} />
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

      {showAddCat && (
        <div className="modal-backdrop" onMouseDown={() => setShowAddCat(false)}>
          <form className="modal" onSubmit={addCat} onMouseDown={(event) => event.stopPropagation()}>
            <span className="modal-icon"><Icon name="paw" size={24} /></span>
            <h2>Add a new cat</h2>
            <p>Who’s joining the family?</p>
            <label>
              Cat’s name
              <input
                autoFocus
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
              <button type="button" onClick={() => { setShowAddCat(false); setNewCatPhoto(undefined); setNewCatPhotoPosition({ x: 50, y: 50 }); setNewCatPhotoZoom(1); setPhotoError(""); }}>Cancel</button>
              <button type="submit" disabled={!newCatName.trim()}><Icon name="plus" size={17} /> Add cat</button>
            </div>
          </form>
        </div>
      )}

      {photoEditCatId !== null && photoEditDraft && (
        <div className="modal-backdrop" onMouseDown={cancelCatPhotoEdit}>
          <section aria-labelledby="edit-cat-photo-title" aria-modal="true" className="modal" onMouseDown={(event) => event.stopPropagation()} role="dialog">
            <span className="modal-icon"><Icon name="paw" size={24} /></span>
            <h2 id="edit-cat-photo-title">Change {cats.find((cat) => cat.id === photoEditCatId)?.name ?? "cat"}’s photo</h2>
            <p>Choose how the photo appears in the cat icon.</p>
            <CatPhotoCropEditor photo={photoEditDraft} position={newCatPhotoPosition} onPositionChange={setNewCatPhotoPosition} zoom={newCatPhotoZoom} onZoomChange={setNewCatPhotoZoom} />
            {photoError && <small className="photo-error">{photoError}</small>}
            <div className="modal-actions">
              <button disabled={photoEditSaving} onClick={cancelCatPhotoEdit} type="button">Cancel</button>
              <button disabled={photoEditSaving} onClick={() => void saveCatPhotoEdit()} type="button">{photoEditSaving ? "Saving…" : "Save photo"}</button>
            </div>
          </section>
        </div>
      )}

      {showQuotas && (
        <div className="modal-backdrop" onMouseDown={() => setShowQuotas(false)}>
          <div className="modal quota-modal" onMouseDown={(event) => event.stopPropagation()}>
            <span className="modal-icon quota-icon"><Icon name="settings" size={24} /></span>
            <h2>Daily food quotas</h2>
            <p>Set {selectedCat.name}’s target amounts for each day.</p>
            <div className="quota-fields">
              <label>
                <span><Icon name="treat" size={18} /> Dental treats <small>pieces</small></span>
                <input
                  inputMode="numeric"
                  min="1"
                  onChange={(event) => setGoalDrafts((drafts) => ({ ...drafts, treatsGoal: event.target.value }))}
                  type="number"
                  value={goalDrafts.treatsGoal}
                />
              </label>
              <label>
                <span><Icon name="bowl" size={18} /> Kibble <small>spoons</small></span>
                <input
                  inputMode="numeric"
                  min="1"
                  onChange={(event) => setGoalDrafts((drafts) => ({ ...drafts, kibbleGoal: event.target.value }))}
                  type="number"
                  value={goalDrafts.kibbleGoal}
                />
              </label>
              <label>
                <span><Icon name="medical" size={18} /> Wet food <small>cans</small></span>
                <input
                  inputMode="numeric"
                  min="1"
                  onChange={(event) => setGoalDrafts((drafts) => ({ ...drafts, cansGoal: event.target.value }))}
                  type="number"
                  value={goalDrafts.cansGoal}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={saveGoalDrafts}>Done</button>
            </div>
          </div>
        </div>
      )}
      <nav aria-label="Primary navigation" className={`primary-nav page-${activeTab}`}>
        <button aria-current={activeTab === "care" ? "page" : undefined} className={activeTab === "care" ? "active" : ""} disabled={cats.length === 0} onClick={returnToCare} type="button">
          <Icon name="paw" size={19} />
          <span>Care</span>
        </button>
        <button aria-current={activeTab === "cats" ? "page" : undefined} className={activeTab === "cats" ? "active" : ""} onClick={() => setActiveTab("cats")} type="button">
          <Icon name="heart" size={19} />
          <span>Cats</span>
        </button>
        <button aria-current={activeTab === "family" ? "page" : undefined} className={activeTab === "family" ? "active" : ""} onClick={() => setActiveTab("family")} type="button">
          <Icon name="family" size={19} />
          <span>Family</span>
        </button>
      </nav>
      {activeTab === "cats" && <CatsOverview
        cats={cats}
        error={cloudError || photoError}
        familyName={cloudFamily?.name}
        onManageFamily={() => setActiveTab("family")}
        onAdd={() => setShowAddCat(true)}
        onPhoto={(id, file) => void openCatPhotoEditor(file, id)}
        onRemove={removeCat}
        onRename={renameCat}
        onSelect={(id) => { setSelectedId(id); setUndoAction(null); setActiveTab("care"); }}
        selectedId={selectedId}
        summaries={Object.fromEntries(cats.map((cat) => { const current = { ...emptyTracker, ...(trackers[String(cat.id)] ?? {}) }; return [String(cat.id), { ...current, ears: current.earsWeek === (cloudFamily ? getFamilyCareWindow(cloudFamily.timezone).weekStart : getLocalWeekKey()) && current.ears }]; }))}
      />}
      {activeTab === "family" && <FamilyPortal cats={cats} initialFamily={cloudFamily ?? undefined} initialMembers={cloudFamily ? cloudMembers : undefined} initialSession={cloudSession} onClose={() => { setActiveTab(cloudFamily ? "care" : "cats"); setCloudRefreshTick((tick) => tick + 1); }} onManageCats={() => setActiveTab("cats")} onSelectCat={(id) => { setSelectedId(id); setUndoAction(null); setActiveTab("care"); }} />}
      {pendingCatRemoval && <ConfirmDialog
        title={`Remove ${pendingCatRemoval.name}?`}
        description={`${pendingCatRemoval.name} will be removed from your family tracker. Their existing care history will be kept.`}
        confirmLabel="Remove cat"
        busy={catRemovalBusy}
        onCancel={() => setPendingCatRemoval(null)}
        onConfirm={() => void confirmRemoveCat()}
      />}
    </div>
  );
}
