export type BuiltInTrackableKey =
  | "treats"
  | "kibble"
  | "cans"
  | "teethPawing"
  | "fountain"
  | "pooped"
  | "peed"
  | "ears"
  | "played";
export type TrackableKey = BuiltInTrackableKey | (string & {});

export type CareLog = {
  id: string;
  catId: number | string;
  metric?: TrackableKey;
  icon?: string;
  unit?: string;
  actorUserId?: string;
  who: string;
  what: string;
  detail: string;
  timestamp: string;
  amountDelta?: number;
  reversesEventId?: string | null;
  batchCount?: number;
  latestTimestamp?: string;
};

export const metricLabels: Partial<Record<TrackableKey, string>> = {
  treats: "Dental treats",
  kibble: "Kibble",
  cans: "Wet food",
  teethPawing: "Pawing at teeth",
  fountain: "Water top-up",
  pooped: "Pooped",
  peed: "Peed",
  ears: "Ears cleaned",
  played: "Playtime",
};

export const metricUnits: Partial<Record<TrackableKey, string>> = {
  treats: "treats",
  kibble: "spoons",
  cans: "cans",
  teethPawing: "times",
  pooped: "times",
  peed: "times",
  played: "sessions",
};

export function getLogMetric(entry: CareLog): TrackableKey {
  if (entry.metric) return entry.metric;
  return (Object.entries(metricLabels).find(([, label]) => label === entry.what)?.[0] as TrackableKey | undefined) ?? "fountain";
}

export function getCareLogDelta(entry: CareLog) {
  if (entry.amountDelta !== undefined) return entry.amountDelta;
  const match = entry.detail.match(/^(Added|Removed) (\d+(?:\.\d+)?)(%)?/);
  if (!match) return undefined;
  const metric = getLogMetric(entry);
  const amount = Number(match[2]) / (metric === "cans" && match[3] === "%" ? 100 : 1);
  return match[1] === "Removed" ? -amount : amount;
}

const batchWindowMs = 5 * 60 * 1000;
const legacyUndoWindowMs = 15 * 1000;
const epsilon = 0.000001;

function actorKey(entry: CareLog) {
  return entry.actorUserId ?? entry.who;
}

/** Remove reversals before batching. New undo entries point to the exact action they reverse. */
export function removeUndoneCareLogs(logs: CareLog[]) {
  const ordered = [...logs].sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
  const remaining: Array<{ entry: CareLog; delta?: number }> = [];

  for (const entry of ordered) {
    const delta = getCareLogDelta(entry);
    if (delta === undefined || delta >= 0) {
      remaining.push({ entry, delta });
      continue;
    }

    let toUndo = Math.abs(delta);
    const candidates = entry.reversesEventId
      ? remaining.map((candidate, index) => ({ candidate, index })).filter(({ candidate }) => candidate.entry.id === entry.reversesEventId)
      : remaining.map((candidate, index) => ({ candidate, index })).reverse();
    for (const { candidate, index } of candidates) {
      if (toUndo <= epsilon) break;
      if (candidate.delta === undefined || candidate.delta <= 0) continue;
      if (String(candidate.entry.catId) !== String(entry.catId)) continue;
      if (getLogMetric(candidate.entry) !== getLogMetric(entry) || actorKey(candidate.entry) !== actorKey(entry)) continue;
      if (!entry.reversesEventId) {
        const ageMs = new Date(entry.timestamp).getTime() - new Date(candidate.entry.timestamp).getTime();
        if (ageMs < 0 || ageMs > legacyUndoWindowMs) continue;
      }
      const canceled = Math.min(candidate.delta, toUndo);
      candidate.delta -= canceled;
      toUndo -= canceled;
    }
    // Reversal entries are bookkeeping; they never appear in visible activity.
  }

  return remaining.flatMap(({ entry, delta }) => {
    if (delta === undefined) return [entry];
    if (delta <= epsilon) return [];
    const originalDelta = getCareLogDelta(entry) ?? 0;
    if (Math.abs(delta - originalDelta) <= epsilon) return [entry];
    const metric = getLogMetric(entry);
    const amount = metric === "cans"
      ? `${Math.round(delta * 100)}% of a can`
      : `${Number(delta.toFixed(1))}${entry.unit === "%" ? "%" : ` ${entry.unit ?? metricUnits[metric] ?? "times"}`}`;
    return [{ ...entry, amountDelta: delta, detail: `Added ${amount}` }];
  });
}

/** Batch same-cat, same-person actions within five minutes of the group's earliest event. */
export function batchCareLogs(logs: CareLog[]) {
  const sortedLogs = [...logs].sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
  const groups: CareLog[][] = [];

  for (const entry of sortedLogs) {
    const delta = getCareLogDelta(entry);
    const group = delta !== undefined && delta > 0
      ? groups.find((candidate) => {
        const first = candidate[0];
        const firstDelta = getCareLogDelta(first);
        return firstDelta !== undefined
          && firstDelta > 0
          && String(first.catId) === String(entry.catId)
          && getLogMetric(first) === getLogMetric(entry)
          && first.what === entry.what
          && first.icon === entry.icon
          && first.unit === entry.unit
          && actorKey(first) === actorKey(entry)
          && new Date(entry.timestamp).getTime() - new Date(first.timestamp).getTime() <= batchWindowMs;
      })
      : undefined;

    if (group) group.push(entry);
    else groups.push([entry]);
  }

  return groups.map((group) => {
    const first = group[0];
    if (group.length === 1) return first;
    const metric = getLogMetric(first);
    const totalDelta = group.reduce((total, entry) => total + (getCareLogDelta(entry) ?? 0), 0);
    const amount = Number(Math.abs(totalDelta).toFixed(1));
    const action = first.detail.startsWith("Removed") ? "Removed" : "Added";
    const unit = first.unit ?? metricUnits[metric] ?? "times";
    const singular = ({ treats: "treat", kibble: "spoon", teethPawing: "time", played: "session" } as Partial<Record<TrackableKey, string>>)[metric] ?? unit.replace(/s$/, "");
    const detail = metric === "cans"
      ? `${action} ${Math.round(amount * 100)}% of a can`
      : unit === "%"
        ? `${action} ${amount}%`
      : `${action} ${amount} ${amount === 1 ? singular : unit}`;
    return { ...first, detail, amountDelta: totalDelta, batchCount: group.length, latestTimestamp: group[group.length - 1].timestamp };
  }).sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
}
