import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import CareIcon, { type IconName } from "./CareIcon";
import { addDateKeyDays, dateKeyInZone, startOfDayInZone } from "../data/dateWindows";
import { getCareLogDelta, getLogMetric, metricLabels, metricUnits, removeUndoneCareLogs, type CareLog, type TrackableKey } from "../data/careLogBatching";
import type { CareActionConfig, FamilyMember, TargetRule } from "../data/familyService";
import type { OverviewCat } from "./CatsOverview";
import "./AnalyticsPage.css";

type Range = "day" | "week" | "month";
type GoalValues = { treatsGoal: number; kibbleGoal: number; cansGoal: number };

const foodMetrics: Array<{ key: "treats" | "kibble" | "cans"; goal: keyof GoalValues; label: string; unit: string; icon: IconName; color: string }> = [
  { key: "treats", goal: "treatsGoal", label: "Dental treats", unit: "treats", icon: "treat", color: "honey" },
  { key: "kibble", goal: "kibbleGoal", label: "Kibble", unit: "spoons", icon: "bowl", color: "blue" },
  { key: "cans", goal: "cansGoal", label: "Wet food", unit: "cans", icon: "medical", color: "green" },
];

const activityMetrics: TrackableKey[] = ["treats", "kibble", "cans", "teethPawing", "fountain", "pooped", "peed", "ears", "played"];
const activityIcons: Record<TrackableKey, IconName> = {
  treats: "treat", kibble: "bowl", cans: "medical", teethPawing: "paw", fountain: "drop",
  pooped: "poop", peed: "pee", ears: "ear", played: "yarn",
};

function dateFromKey(key: string) {
  return new Date(`${key}T12:00:00Z`);
}

function formatAmount(amount: number) {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(1).replace(/\.0$/, "");
}

function formatMetricAmount(metric: TrackableKey, amount: number) {
  if (metric === "cans") return `${formatAmount(amount)} ${amount === 1 ? "can" : "cans"}`;
  const unit = metricUnits[metric] ?? "times";
  return `${formatAmount(amount)} ${amount === 1 ? unit.replace(/s$/, "") : unit}`;
}

function ContributorAvatar({ name, photoUrl }: { name: string; photoUrl?: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = Boolean(photoUrl && failedUrl === photoUrl);
  return <span aria-hidden="true" className="analytics-podium-avatar">
    <span>{name.trim()[0]?.toUpperCase() || "?"}</span>
    {photoUrl && !failed && <img alt="" loading="lazy" onError={() => setFailedUrl(photoUrl)} src={photoUrl} />}
  </span>;
}

export default function AnalyticsPage({ cats, logs, goals, targets = [], members = [], careActions = [], timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", selectedCatId, initialRange, familyName, onAddCat = () => {}, onEditCat = () => {}, onManageFamily = () => {} }: {
  cats: OverviewCat[];
  logs: CareLog[];
  goals: Record<string, GoalValues>;
  targets?: TargetRule[];
  members?: Array<Pick<FamilyMember, "user_id" | "display_name" | "avatar_url">>;
  careActions?: CareActionConfig[];
  timezone?: string;
  selectedCatId: number | string;
  initialRange?: Range;
  familyName?: string;
  onAddCat?: () => void;
  onEditCat?: (id: number | string) => void;
  onManageFamily?: () => void;
}) {
  const [isTransitionPending, startTransition] = useTransition();
  const [showCalculationLoader, setShowCalculationLoader] = useState(false);
  const [range, setRange] = useState<Range>(initialRange ?? "week");
  const [selectedDateKey, setSelectedDateKey] = useState(() => dateKeyInZone(new Date(), timezone));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [closingDatePicker, setClosingDatePicker] = useState(false);
  const datePickerCloseTimer = useRef<number | undefined>(undefined);
  const [pickerMonth, setPickerMonth] = useState(() => dateKeyInZone(new Date(), timezone).slice(0, 7));
  const [catFilter, setCatFilter] = useState(selectedCatId === "" ? "all" : String(selectedCatId));
  const [selectedContributorKey, setSelectedContributorKey] = useState<string | null>(null);
  const availableCareActions = useMemo(() => careActions.filter((action) => !action.deleted), [careActions]);
  const [selectedCareMetric, setSelectedCareMetric] = useState<string | null>(null);
  const careMetric = selectedCareMetric ?? availableCareActions[0]?.key ?? activityMetrics[0];
  const [showCareMetricPicker, setShowCareMetricPicker] = useState(false);
  const catSwipeStart = useRef<{ x: number; y: number } | null>(null);
  const ignoreNextCatClick = useRef(false);
  const handleCatPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") return;
    catSwipeStart.current = { x: event.clientX, y: event.clientY };
  };
  const handleCatPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = catSwipeStart.current;
    catSwipeStart.current = null;
    if (!start || cats.length < 2) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 42 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    ignoreNextCatClick.current = true;
    window.setTimeout(() => { ignoreNextCatClick.current = false; }, 300);
    const currentIndex = cats.findIndex((cat) => String(cat.id) === catFilter);
    const startIndex = currentIndex >= 0 ? currentIndex : Math.max(0, cats.findIndex((cat) => String(cat.id) === String(selectedCatId)));
    const nextIndex = (startIndex + (dx < 0 ? 1 : -1) + cats.length) % cats.length;
    startTransition(() => setCatFilter(String(cats[nextIndex].id)));
  };
  const todayKey = dateKeyInZone(new Date(), timezone);
  const todayParts = todayKey.split("-").map(Number);
  const todayWeekday = new Date(Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2])).getUTCDay();
  const currentPeriodStartKey = range === "day" ? todayKey : range === "week"
    ? addDateKeyDays(todayKey, -((todayWeekday + 6) % 7))
    : `${todayKey.slice(0, 7)}-01`;
  const anchorParts = selectedDateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(anchorParts[0], anchorParts[1] - 1, anchorParts[2])).getUTCDay();
  const rangeStartKey = range === "day" ? selectedDateKey : range === "week"
    ? addDateKeyDays(selectedDateKey, -((weekday + 6) % 7))
    : `${selectedDateKey.slice(0, 7)}-01`;
  const rangeEndExclusive = range === "day" ? addDateKeyDays(rangeStartKey, 1)
    : range === "week" ? addDateKeyDays(rangeStartKey, 7)
      : `${anchorParts[0] + (anchorParts[1] === 12 ? 1 : 0)}-${String(anchorParts[1] === 12 ? 1 : anchorParts[1] + 1).padStart(2, "0")}-01`;
  // A selected period is complete only once its end is today or earlier.
  // In particular, today's day/week/month is still in progress.
  const periodComplete = rangeEndExclusive <= todayKey;
  const visibleEndExclusive = rangeEndExclusive <= addDateKeyDays(todayKey, 1) ? rangeEndExclusive : addDateKeyDays(todayKey, 1);
  const shiftPeriod = (direction: -1 | 1) => {
    startTransition(() => setSelectedDateKey((currentKey) => {
      if (range === "day") return addDateKeyDays(currentKey, direction);
      if (range === "week") return addDateKeyDays(currentKey, direction * 7);
      const currentParts = currentKey.split("-").map(Number);
      const monthDate = new Date(Date.UTC(currentParts[0], currentParts[1] - 1 + direction, 1));
      return `${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, "0")}-01`;
    }));
  };
  const openDatePicker = () => {
    setPickerMonth(rangeStartKey.slice(0, 7));
    setClosingDatePicker(false);
    setShowDatePicker(true);
  };
  const closeDatePicker = () => {
    if (closingDatePicker) return;
    setClosingDatePicker(true);
    datePickerCloseTimer.current = window.setTimeout(() => {
      setShowDatePicker(false);
      setClosingDatePicker(false);
      datePickerCloseTimer.current = undefined;
    }, 220);
  };
  useEffect(() => () => {
    if (datePickerCloseTimer.current !== undefined) window.clearTimeout(datePickerCloseTimer.current);
  }, []);
  useEffect(() => {
    if (selectedCareMetric && !availableCareActions.some((action) => action.key === selectedCareMetric)) setSelectedCareMetric(null);
  }, [availableCareActions, selectedCareMetric]);
  useEffect(() => setShowCareMetricPicker(false), [catFilter]);
  useEffect(() => {
    if (catFilter !== "all" && !cats.some((cat) => String(cat.id) === catFilter)) {
      setCatFilter(cats[0] ? String(cats[0].id) : "all");
    }
  }, [cats, catFilter]);
  useEffect(() => {
    if (!isTransitionPending) {
      setShowCalculationLoader(false);
      return;
    }
    const timer = window.setTimeout(() => setShowCalculationLoader(true), 140);
    return () => window.clearTimeout(timer);
  }, [isTransitionPending]);
  const pickerParts = pickerMonth.split("-").map(Number);
  const pickerYear = pickerParts[0];
  const pickerMonthNumber = pickerParts[1];
  const pickerFirstKey = `${pickerMonth}-01`;
  const pickerOffset = (new Date(Date.UTC(pickerYear, pickerMonthNumber - 1, 1)).getUTCDay() + 6) % 7;
  const pickerDaysInMonth = new Date(Date.UTC(pickerYear, pickerMonthNumber, 0)).getUTCDate();
  const pickerCells: Array<string | null> = [
    ...Array.from({ length: pickerOffset }, () => null),
    ...Array.from({ length: pickerDaysInMonth }, (_, index) => addDateKeyDays(pickerFirstKey, index)),
  ];
  const pickerAtCurrentMonth = pickerMonth >= todayKey.slice(0, 7);
  const shiftPickerMonth = (direction: -1 | 1) => {
    const next = new Date(Date.UTC(pickerYear, pickerMonthNumber - 1 + direction, 1));
    setPickerMonth(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  const dates = useMemo(() => {
    const result: string[] = [];
    for (let key = rangeStartKey; key < visibleEndExclusive; key = addDateKeyDays(key, 1)) result.push(key);
    return result;
  }, [rangeStartKey, visibleEndExclusive]);
  const scopedCats = useMemo(() => catFilter === "all" ? cats : cats.filter((cat) => String(cat.id) === catFilter), [catFilter, cats]);
  const scopedCatIds = useMemo(() => new Set(scopedCats.map((cat) => String(cat.id))), [scopedCats]);
  const periodStart = new Date(startOfDayInZone(rangeStartKey, timezone)).getTime();
  const periodEnd = new Date(startOfDayInZone(visibleEndExclusive, timezone)).getTime();
  const visibleLogs = useMemo(() => removeUndoneCareLogs(logs), [logs]);
  const activeLogs = useMemo(() => visibleLogs.filter((entry) => {
    const time = new Date(entry.timestamp).getTime();
    return scopedCatIds.has(String(entry.catId)) && time >= periodStart && time < periodEnd;
  }), [visibleLogs, scopedCatIds, periodStart, periodEnd]);
  const targetIndex = useMemo(() => {
    const index = new Map<string, TargetRule[]>();
    targets.forEach((target) => {
      if (target.cadence !== "daily") return;
      const key = `${target.cat_id}|${target.metric}`;
      const entries = index.get(key) ?? [];
      entries.push(target);
      index.set(key, entries);
    });
    index.forEach((entries) => entries.sort((left, right) => right.effective_from.localeCompare(left.effective_from)));
    return index;
  }, [targets]);
  const goalsForDate = (dateKey: string) => scopedCats.map((cat) => {
    const fallback = goals[String(cat.id)] ?? { treatsGoal: 4, kibbleGoal: 3, cansGoal: 1 };
    const applicable = (metric: "treats" | "kibble" | "wet_food", defaultValue: number) => targetIndex.get(`${cat.id}|${metric}`)
      ?.find((target) => target.effective_from <= dateKey && (!target.effective_until || target.effective_until >= dateKey))?.target_amount ?? defaultValue;
    return {
      treatsGoal: Number(applicable("treats", fallback.treatsGoal)),
      kibbleGoal: Number(applicable("kibble", fallback.kibbleGoal)),
      cansGoal: Number(applicable("wet_food", fallback.cansGoal)),
    };
  });
  const { valueByDateCatMetric, activeLogDates } = useMemo(() => {
    const values = new Map<string, number>();
    const logDates = new Set<string>();
    activeLogs.forEach((entry) => {
      const dateKey = dateKeyInZone(new Date(entry.timestamp), timezone);
      logDates.add(dateKey);
      const metric = getLogMetric(entry);
      if (!metric) return;
      const delta = getCareLogDelta(entry);
      const amount = Math.max(0, delta ?? (entry.detail === "Marked done" ? 1 : 0));
      if (amount <= 0) return;
      const key = `${dateKey}|${entry.catId}|${metric}`;
      values.set(key, (values.get(key) ?? 0) + amount);
    });
    return { valueByDateCatMetric: values, activeLogDates: logDates };
  }, [activeLogs, timezone]);
  const valueOn = (key: string, catId: string, metric: TrackableKey) => valueByDateCatMetric.get(`${key}|${catId}|${metric}`) ?? 0;
  const selectedCareAction = availableCareActions.find((action) => action.key === careMetric);
  const selectedCareCat = cats.find((cat) => String(cat.id) === catFilter);
  const careTimeline = useMemo(() => {
    const isSingleDay = range === "day";
    const points = isSingleDay
      ? Array.from({ length: 24 }, (_, hour) => ({ key: String(hour), label: hour % 3 === 0 ? `${hour % 12 || 12}${hour < 12 ? "a" : "p"}` : "" }))
      : dates.map((key) => ({ key, label: range === "month" ? String(Number(key.slice(-2))) : new Intl.DateTimeFormat(undefined, { weekday: "narrow", timeZone: "UTC" }).format(dateFromKey(key)) }));
    const values = new Map(points.map((point) => [point.key, 0]));
    const catId = catFilter;
    visibleLogs.forEach((entry) => {
      if (String(entry.catId) !== catId || getLogMetric(entry) !== careMetric) return;
      const dateKey = dateKeyInZone(new Date(entry.timestamp), timezone);
      let pointKey = dateKey;
      if (isSingleDay) {
        if (dateKey !== selectedDateKey) return;
        const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: timezone }).format(new Date(entry.timestamp)));
        pointKey = String(hour);
      }
      const current = values.get(pointKey);
      if (current === undefined) return;
      const delta = getCareLogDelta(entry) ?? (entry.detail === "Marked done" ? 1 : 0);
      if (delta > 0) values.set(pointKey, current + delta);
    });
    return points.map((point) => ({ ...point, value: values.get(point.key) ?? 0 }));
  }, [visibleLogs, catFilter, careMetric, range, dates, selectedDateKey, timezone]);
  const careTimelineMax = Math.max(1, ...careTimeline.map((point) => point.value));
  const goalsByDate = useMemo(() => new Map(dates.map((key) => [key, goalsForDate(key)])), [dates, scopedCats, goals, targetIndex]);
  const dailyScores = useMemo(() => dates.map((key) => {
    let checks = 0;
    const dailyGoals = goalsByDate.get(key) ?? [];
    for (let index = 0; index < scopedCats.length; index += 1) {
      const catId = String(scopedCats[index].id);
      const goal = dailyGoals[index];
      const careChecks = [
        valueOn(key, catId, "treats") >= goal.treatsGoal,
        valueOn(key, catId, "kibble") >= goal.kibbleGoal,
        valueOn(key, catId, "cans") >= goal.cansGoal,
        valueOn(key, catId, "fountain") > 0,
        valueOn(key, catId, "pooped") > 0,
        valueOn(key, catId, "peed") > 0,
        valueOn(key, catId, "played") > 0,
      ];
      checks += careChecks.filter(Boolean).length;
    }
    const hasData = activeLogDates.has(key);
    return { key, date: dateFromKey(key), score: scopedCats.length ? checks / scopedCats.length : 0, checks, hasData };
  }), [dates, goalsByDate, scopedCats, activeLogDates, valueByDateCatMetric]);
  const totalChecks = dailyScores.reduce((sum, day) => sum + day.checks, 0);
  const targetCount = Math.max(1, dates.length * 7 * scopedCats.length);
  const careRate = Math.round((totalChecks / targetCount) * 100);
  const loggedDays = dailyScores.filter((day) => day.hasData).length;
  const { teethNotices, waterTopUps, playSessions } = useMemo(() => {
    let teeth = 0;
    let water = 0;
    let play = 0;
    activeLogs.forEach((entry) => {
      const metric = getLogMetric(entry);
      if (metric !== "teethPawing" && metric !== "fountain" && metric !== "played") return;
      const amount = Math.max(0, getCareLogDelta(entry) ?? 1);
      if (metric === "teethPawing") teeth += amount;
      else if (metric === "fountain") water += amount;
      else play += amount;
    });
    return { teethNotices: teeth, waterTopUps: water, playSessions: play };
  }, [activeLogs]);
  const foodSummary = useMemo(() => foodMetrics.map((metric) => {
    const value = activeLogs.reduce((sum, entry) => getLogMetric(entry) === metric.key ? sum + Math.max(0, getCareLogDelta(entry) ?? 0) : sum, 0);
    const goal = dates.reduce((periodGoal, dateKey) => periodGoal + (goalsByDate.get(dateKey) ?? []).reduce((sum, catGoals) => sum + catGoals[metric.goal], 0), 0);
    return { ...metric, value, goal, status: value > goal ? "overshot" : value >= goal ? "met" : "missed" };
  }), [activeLogs, dates, goalsByDate]);
  const teethNoticesPerCatDay = teethNotices / Math.max(1, scopedCats.length * dates.length);
  const expectedThroughDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(dateFromKey(addDateKeyDays(visibleEndExclusive, -1)));
  const careAlerts: Array<{ key: string; title: string; detail: string; icon: IconName; severity: "watch" | "attention" }> = [];
  foodSummary.filter((item) => item.value < item.goal).forEach((item) => careAlerts.push({
    key: `food-${item.key}`,
    title: `${item.label} ${periodComplete ? "below goal" : "behind pace"}`,
    detail: `${formatAmount(item.value)} of ${formatAmount(item.goal)} ${item.unit} logged${periodComplete ? " for the selected period" : `; ${formatAmount(item.goal)} expected through ${expectedThroughDate}`}.`,
    icon: item.icon,
    severity: "watch",
  }));
  if (periodComplete && waterTopUps === 0) careAlerts.push({ key: "water", title: "No water top-ups logged", detail: "There were no fountain refills recorded in the completed period.", icon: "drop", severity: "watch" });
  if (periodComplete && playSessions === 0) careAlerts.push({ key: "play", title: "No play sessions logged", detail: "There were no play sessions recorded in the completed period.", icon: "yarn", severity: "watch" });
  if (teethNoticesPerCatDay > 2) careAlerts.push({
    key: "teeth-pawing",
    title: "Frequent teeth pawing",
    detail: `${formatAmount(teethNoticesPerCatDay)} notices per cat per day on average.`,
    icon: "paw",
    severity: "attention",
  });
  const { contributions, contributorTotals } = useMemo(() => {
    const memberById = new Map(members.map((member) => [member.user_id, member]));
    const totalsByMetric = new Map<TrackableKey, Map<string, { key: string; name: string; amount: number }>>();
    const totalsByContributor = new Map<string, { key: string; name: string; avatarUrl?: string | null; checkIns: number }>();
    activeLogs.forEach((entry) => {
      const amount = getCareLogDelta(entry) ?? (entry.detail === "Marked done" ? 1 : 0);
      if (amount <= 0) return;
      const metric = getLogMetric(entry);
      if (!metric) return;
      const key = entry.actorUserId ?? entry.who;
      const familyMember = entry.actorUserId ? memberById.get(entry.actorUserId) : undefined;
      let metricMembers = totalsByMetric.get(metric);
      if (!metricMembers) { metricMembers = new Map(); totalsByMetric.set(metric, metricMembers); }
      const currentMetric = metricMembers.get(key) ?? { key, name: familyMember?.display_name || entry.who, amount: 0 };
      currentMetric.amount += amount;
      metricMembers.set(key, currentMetric);
      const currentContributor = totalsByContributor.get(key) ?? {
        key,
        name: familyMember?.display_name || entry.who,
        avatarUrl: familyMember?.avatar_url,
        checkIns: 0,
      };
      // Count care entries instead of summing unlike units such as treats, spoons, and sessions.
      currentContributor.checkIns += Math.max(1, entry.batchCount ?? 1);
      totalsByContributor.set(key, currentContributor);
    });
    const metricContributions = activityMetrics.map((metric) => {
      const leaders = [...(totalsByMetric.get(metric)?.values() ?? [])].sort((left, right) => right.amount - left.amount);
      return { metric, leaders, total: leaders.reduce((sum, member) => sum + member.amount, 0) };
    }).filter((entry) => entry.total > 0);
    return { contributions: metricContributions, contributorTotals: totalsByContributor };
  }, [activeLogs, members]);
  const totalCheckIns = [...contributorTotals.values()].reduce((sum, member) => sum + member.checkIns, 0);
  const podiumMembers = [...contributorTotals.values()]
    .sort((left, right) => right.checkIns - left.checkIns || left.name.localeCompare(right.name))
    .slice(0, 3)
    .map((member) => ({ ...member, percentage: Math.round((member.checkIns / totalCheckIns) * 100) }));
  const selectedContributor = selectedContributorKey ? contributorTotals.get(selectedContributorKey) : undefined;
  const visibleContributions = selectedContributorKey
    ? contributions.filter((entry) => entry.leaders.some((member) => member.key === selectedContributorKey))
    : contributions;
  const dateFormat = (key: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(dateFromKey(key));
  const weekEndKey = addDateKeyDays(rangeStartKey, 6);
  const periodLabel = range === "day"
    ? dateFormat(rangeStartKey, { month: "long", day: "numeric", year: "numeric" })
    : range === "week"
      ? `${dateFormat(rangeStartKey, { month: "short", day: "numeric" })} – ${dateFormat(weekEndKey, { month: "short", day: "numeric", year: "numeric" })}`
      : dateFormat(rangeStartKey, { month: "long", year: "numeric" });
  const periodName = range === "day" ? "day" : range === "week" ? "week" : "month";
  const selectedLabel = catFilter === "all" ? "All cats" : cats.find((cat) => String(cat.id) === catFilter)?.name ?? "Cat";

  return <main className="analytics-page" aria-labelledby="analytics-title">
    <header className="analytics-header">
      <div><span className="analytics-eyebrow">A home for every whisker</span><h1 id="analytics-title">Cats</h1><p>Care at a glance, with a deeper look whenever you need it.</p></div>
      {familyName && <button className="family-primary-button analytics-add-cat" onClick={onAddCat} type="button"><CareIcon name="cat" size={21} /><span>Add a cat</span></button>}
    </header>
    {showCalculationLoader && <div aria-live="polite" className="analytics-calculation-loader" role="status"><span><CareIcon name="paw" size={16} /></span>Gathering care notes…</div>}

    <div aria-label="Choose a cat. Swipe to switch cats." className="analytics-cat-picker" onPointerDown={handleCatPointerDown} onPointerUp={handleCatPointerUp} onPointerCancel={() => { catSwipeStart.current = null; }}>
      <button aria-pressed={catFilter === "all"} className={`analytics-all-cats ${catFilter === "all" ? "active" : ""}`} onClick={() => startTransition(() => setCatFilter("all"))} type="button">All cats</button>
      <div className="analytics-cat-options">
        {cats.map((cat) => {
          const active = String(cat.id) === catFilter;
          return <div aria-label={`${cat.name}${active ? ", selected" : ""}`} className={`analytics-cat-option ${active ? "active" : ""}`} key={cat.id}>
            <button aria-label={`Show analytics for ${cat.name}`} aria-pressed={active} className="analytics-cat-select" onClick={() => {
              if (ignoreNextCatClick.current) { ignoreNextCatClick.current = false; return; }
              startTransition(() => setCatFilter(String(cat.id)));
            }} type="button">
              <span className="analytics-cat-avatar" style={{ "--cat-color": cat.color } as React.CSSProperties}>
                {cat.photo ? <img alt="" src={cat.photo} /> : <><i className="analytics-cat-ear analytics-cat-ear-left" /><i className="analytics-cat-ear analytics-cat-ear-right" /><b>{cat.initial}</b></>}
              </span>
              <span className="analytics-cat-name">{cat.name}</span>
            </button>
            {active && <button aria-label={`Edit or remove ${cat.name}`} className="analytics-cat-manage-badge" onClick={() => onEditCat(cat.id)} title={`Edit ${cat.name}`} type="button"><CareIcon name="more" size={17} /></button>}
          </div>;
        })}
      </div>
    </div>

    <div className="analytics-range" aria-label="Analytics period">
      {(["day", "week", "month"] as Range[]).map((option) => <button aria-pressed={range === option} className={range === option ? "active" : ""} key={option} onClick={() => startTransition(() => setRange(option))} type="button">Per {option}</button>)}
    </div>

    <div className="analytics-period-controls">
      <button aria-label={`Previous ${range}`} className="analytics-period-arrow is-previous" onClick={() => shiftPeriod(-1)} type="button"><CareIcon name="chevron" size={17} /></button>
      <button aria-label={`Choose ${range}`} className="analytics-date-trigger" onClick={openDatePicker} type="button"><CareIcon name="calendar" size={17} /><span>{periodLabel}</span></button>
      <button aria-label={`Next ${range}`} className="analytics-period-arrow" disabled={rangeStartKey >= currentPeriodStartKey} onClick={() => shiftPeriod(1)} type="button"><CareIcon name="chevron" size={17} /></button>
      <small>{loggedDays} {loggedDays === 1 ? "day" : "days"} logged · {selectedLabel}</small>
    </div>

    {showDatePicker && <div className={`analytics-picker-backdrop${closingDatePicker ? " is-closing" : ""}`} onClick={closeDatePicker}>
      <section aria-label={`Choose ${range}`} aria-modal="true" className={`analytics-picker-dialog${closingDatePicker ? " is-closing" : ""}`} onClick={(event) => event.stopPropagation()} role="dialog">
        <header className="analytics-picker-heading"><div><span className="analytics-eyebrow">View by {range}</span><h2>{range === "day" ? "Choose a day" : range === "week" ? "Choose a week" : "Choose a month"}</h2><p>{range === "week" ? "Pick any day in the week you want to see." : range === "day" ? "Pick a day to see its care details." : "Choose a month to explore."}</p></div><button aria-label="Close date picker" onClick={closeDatePicker} type="button">×</button></header>
        {range === "month" ? <>
          <div className="analytics-picker-month-nav"><button aria-label="Previous year" onClick={() => setPickerMonth(`${pickerYear - 1}-${String(pickerMonthNumber).padStart(2, "0")}`)} type="button">‹</button><strong>{pickerYear}</strong><button aria-label="Next year" disabled={pickerYear >= todayParts[0]} onClick={() => setPickerMonth(`${pickerYear + 1}-${String(pickerMonthNumber).padStart(2, "0")}`)} type="button">›</button></div>
          <div className="analytics-month-grid">{Array.from({ length: 12 }, (_, index) => {
            const month = index + 1;
            const key = `${pickerYear}-${String(month).padStart(2, "0")}-01`;
            const disabled = key > `${todayKey.slice(0, 7)}-01`;
            return <button aria-pressed={key === rangeStartKey} className={key === rangeStartKey ? "active" : ""} disabled={disabled} key={key} onClick={() => { startTransition(() => setSelectedDateKey(key)); closeDatePicker(); }} type="button">{new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(pickerYear, index, 1)))}</button>;
          })}</div>
        </> : <>
          <div className="analytics-picker-month-nav"><button aria-label="Previous month" onClick={() => shiftPickerMonth(-1)} type="button">‹</button><strong>{new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(pickerYear, pickerMonthNumber - 1, 1)))}</strong><button aria-label="Next month" disabled={pickerAtCurrentMonth} onClick={() => shiftPickerMonth(1)} type="button">›</button></div>
          <div className="analytics-calendar-grid">
            {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => <span className="analytics-weekday" key={`${day}-${index}`}>{day}</span>)}
            {pickerCells.map((dayKey, index) => {
              if (!dayKey) return <span aria-hidden="true" className="analytics-calendar-empty" key={`empty-${index}`} />;
              const selectedWeekday = new Date(Date.UTC(anchorParts[0], anchorParts[1] - 1, anchorParts[2])).getUTCDay();
              const selectedWeekStart = addDateKeyDays(selectedDateKey, -((selectedWeekday + 6) % 7));
              const isInSelectedWeek = range === "week" && dayKey >= selectedWeekStart && dayKey <= addDateKeyDays(selectedWeekStart, 6);
              return <button aria-pressed={dayKey === selectedDateKey} className={`${dayKey === selectedDateKey ? "active" : ""} ${dayKey === todayKey ? "today" : ""} ${isInSelectedWeek ? "in-selected-week" : ""}`} disabled={dayKey > todayKey} key={dayKey} onClick={() => { startTransition(() => setSelectedDateKey(dayKey)); closeDatePicker(); }} type="button">{Number(dayKey.slice(-2))}</button>;
            })}
          </div>
        </>}
      </section>
    </div>}

    {!scopedCats.length ? <section className="analytics-empty"><CareIcon name="paw" size={28} />{cats.length === 0 && !familyName ? <><h2>Your cats start with family</h2><p>Create a family or ask someone to add your Google account. Then add your cats and share their care with everyone.</p><div className="analytics-family-actions"><button className="family-primary-button cats-add-button" onClick={onManageFamily} type="button">Create a family</button><button className="analytics-family-invite" onClick={onManageFamily} type="button">I was invited to a family</button></div></> : <><h2>{cats.length ? "No care in this period yet" : "Add a cat to get started"}</h2><p>{cats.length ? "Care summaries and family contributions will appear here as you log activities." : "Add your family’s first cat to start tracking their care."}</p>{cats.length === 0 && <button className="family-primary-button cats-add-button" onClick={onAddCat} type="button"><CareIcon name="cat" size={21} /> Add a cat</button>}</>}</section> : <>
      <section className="analytics-overview" aria-label="Care summary">
        <article className="analytics-score-card"><div className="analytics-score-ring" style={{ "--score": `${careRate * 3.6}deg` } as React.CSSProperties}><span><strong>{careRate}%</strong><small>care score</small></span></div><div><strong>{careRate >= 80 ? "Pawsome work!" : careRate >= 50 ? "A good start!" : "Room to grow"}</strong><small>{totalChecks} of {targetCount} care targets completed for the selected {periodName}</small></div></article>
      </section>

      <div className={`analytics-insights${range === "month" ? " is-monthly" : ""}`}>
      <section className="analytics-card analytics-food-targets">
        <div className="analytics-card-heading"><div><span className="analytics-card-icon is-peach"><CareIcon name="bowl" size={19} /></span><div><h2>Food targets</h2><p>Portions and goals for the selected {periodName}</p></div></div></div>
        <div className="analytics-target-list">{foodSummary.map((metric) => {
          const width = Math.min(100, (metric.value / Math.max(1, metric.goal)) * 100);
          return <div className="analytics-target-row" key={metric.key}><span className={`analytics-target-icon ${metric.color}`}><CareIcon name={metric.icon} size={18} /></span><div className="analytics-target-info"><div><strong>{metric.label}</strong><span>{formatAmount(metric.value)} / {formatAmount(metric.goal)} {metric.unit}</span></div><div className="analytics-target-track"><i className={metric.status} style={{ width: `${width}%` }} /></div></div><span className={`analytics-status ${metric.status}`}>{metric.status === "met" ? "Met" : metric.status === "overshot" ? "Over" : "Not met"}</span></div>;
        })}</div>
        <p className="analytics-footnote">{periodComplete ? `Goals show the full selected ${periodName}.` : `Goals show what is expected through ${expectedThroughDate}.`} Past goal changes are applied where available.</p>
      </section>

      {selectedCareCat && <section className="analytics-card analytics-care-timeline">
        <div className="analytics-card-heading"><div><span className="analytics-card-icon is-peach"><CareIcon name="chart" size={19} /></span><div><h2>Care over time</h2><p>{selectedCareCat.name} · {range === "day" ? "Activity by hour" : `Activity each day this ${periodName}`}</p></div></div></div>
        <div className="analytics-care-item-control">
          <button aria-expanded={showCareMetricPicker} aria-haspopup="listbox" className="analytics-care-item-trigger" onClick={() => setShowCareMetricPicker((open) => !open)} type="button">
            <span className={`analytics-care-item-trigger-icon ${selectedCareAction?.color ?? ""}`}><CareIcon name={(selectedCareAction?.icon as IconName | undefined) ?? activityIcons[careMetric as TrackableKey] ?? "paw"} size={17} /></span>
            <span><small>Tracking</small><strong>{selectedCareAction?.name ?? metricLabels[careMetric as TrackableKey] ?? careMetric}</strong></span>
            <span aria-hidden="true" className="analytics-care-item-caret">⌄</span>
          </button>
          {showCareMetricPicker && <div aria-label="Choose care item" className="analytics-care-item-menu" role="listbox">
            {(availableCareActions.length ? availableCareActions.map((action) => ({ key: action.key, name: action.name, icon: action.icon, color: action.color })) : activityMetrics.map((key) => ({ key, name: metricLabels[key] ?? key, icon: activityIcons[key], color: "" }))).map((action) => <button aria-selected={careMetric === action.key} className={careMetric === action.key ? "active" : ""} key={action.key} onClick={() => { setSelectedCareMetric(action.key); setShowCareMetricPicker(false); }} role="option" type="button"><span className={action.color}><CareIcon name={action.icon as IconName} size={17} /></span><strong>{action.name}</strong>{careMetric === action.key && <i aria-hidden="true">✓</i>}</button>)}
          </div>}
        </div>
        <div aria-label={`${selectedCareAction?.name ?? metricLabels[careMetric as TrackableKey] ?? careMetric} over time`} className={`analytics-care-timeline-chart ${selectedCareAction?.color ?? ""}${range === "month" ? " is-month" : ""}${range === "day" ? " is-hourly" : ""}`} role="img">
          {careTimeline.map((point) => <div className="analytics-care-timeline-point" key={point.key} title={`${range === "day" ? `${point.key}:00` : point.key}: ${formatAmount(point.value)}`}><div className="analytics-care-timeline-track"><i style={{ height: `${point.value ? Math.max(5, (point.value / careTimelineMax) * 100) : 0}%` }} /></div><small>{point.label}</small></div>)}
        </div>
        {!careTimeline.some((point) => point.value > 0) && <p className="analytics-empty-copy">No {selectedCareAction?.name.toLowerCase() ?? metricLabels[careMetric as TrackableKey]?.toLowerCase() ?? "care"} logged for {selectedCareCat.name} in this period yet.</p>}
      </section>}

      <section className="analytics-card analytics-contributions">
        <div className="analytics-card-heading"><div><span className="analytics-card-icon is-lilac"><CareIcon name="family" size={19} /></span><div><h2>Family contributions</h2><p>{selectedContributor ? `Care breakdown for ${selectedContributor.name}` : "Share of logged care check-ins"}</p></div></div>{selectedContributor && <button className="analytics-contribution-clear" onClick={() => setSelectedContributorKey(null)} type="button">Show everyone</button>}</div>
        {podiumMembers.length > 0 && <div aria-label="Top care contributors" className="analytics-podium">
          {podiumMembers.map((member, index) => {
            const rank = index + 1;
            return <button aria-label={`Show contributions for ${member.name}, rank ${rank}, ${member.percentage}% of care check-ins`} aria-pressed={selectedContributorKey === member.key} className={`analytics-podium-person rank-${rank}${selectedContributorKey === member.key ? " is-selected" : ""}`} key={member.key} onClick={() => setSelectedContributorKey((selected) => selected === member.key ? null : member.key)} type="button">
              <span className="analytics-podium-rank">{rank}</span>
              <ContributorAvatar name={member.name} photoUrl={member.avatarUrl} />
              <strong>{member.name}</strong>
              <small>{member.percentage}%</small>
            </button>;
          })}
        </div>}
        {visibleContributions.length ? <div className="analytics-contribution-list">{visibleContributions.map(({ metric, leaders, total }) => {
          const selectedAmount = selectedContributorKey ? leaders.find((member) => member.key === selectedContributorKey) : undefined;
          const displayedAmount = selectedAmount?.amount ?? leaders[0].amount;
          const displayedNames = selectedAmount ? [selectedAmount.name] : leaders.filter((member) => member.amount === displayedAmount).map((member) => member.name);
          return <div className="analytics-contribution-row" key={metric}><span className={`analytics-contribution-icon ${metric === "treats" ? "honey" : metric === "kibble" ? "blue" : metric === "cans" ? "green" : metric === "fountain" ? "aqua" : "lilac"}`}><CareIcon name={activityIcons[metric]} size={16} /></span><strong>{metricLabels[metric]}</strong><span>{displayedNames.join(" & ")} <small>{formatMetricAmount(metric, displayedAmount)}</small></span><small className="analytics-total">{formatMetricAmount(metric, total)} total</small></div>;
        })}</div> : <p className="analytics-empty-copy">{selectedContributor ? `${selectedContributor.name} has no care activities in this period.` : "No care activities were logged during this period."}</p>}
      </section>

      <section className="analytics-card analytics-trend">
        <div className="analytics-card-heading"><div><span className="analytics-card-icon"><CareIcon name="chart" size={19} /></span><div><h2>Care rhythm</h2><p>Average daily targets completed per cat</p></div></div><small>out of 7</small></div>
        <div className={`analytics-chart ${range === "month" ? "is-month" : ""}`}>
          {dailyScores.map((day) => <div className="analytics-chart-day" key={day.key} title={`${day.key}: ${formatAmount(day.score)} of 7`}><div className="analytics-bar-track"><i className={day.score >= 7 ? "is-perfect" : ""} style={{ height: `${Math.max(day.hasData ? 7 : 2, (day.score / 7) * 100)}%` }} />{day.score >= 7 && <span><CareIcon name="sparkle" size={10} /></span>}</div><small>{range === "month" ? Number(day.key.slice(-2)) : new Intl.DateTimeFormat(undefined, { weekday: "narrow", timeZone: "UTC" }).format(day.date)}</small></div>)}
        </div>
        {loggedDays <= 1 && range !== "day" && <p className="analytics-hint"><CareIcon name="paw" size={14} /> Keep checking in—your trend will grow here day by day.</p>}
      </section>

      <section aria-label="Care that may need attention" className="analytics-card analytics-alerts">
        <div className="analytics-card-heading"><div><span className="analytics-card-icon is-peach"><CareIcon name="heart" size={19} /></span><div><h2>Needs a little attention</h2><p>{periodComplete ? "Based on care logged for this period" : `Compared with goals through ${expectedThroughDate}`}</p></div></div></div>
        {careAlerts.length ? <ul className="analytics-alert-list">{careAlerts.map((alert) => <li className={`analytics-alert ${alert.severity}`} key={alert.key}><span><CareIcon name={alert.icon} size={17} /></span><div><strong>{alert.title}</strong><small>{alert.detail}</small></div></li>)}</ul> : <p className="analytics-empty-copy">Nothing to flag from the care logs in this period.</p>}
      </section>
      </div>
    </>}
  </main>;
}
