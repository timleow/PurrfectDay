import { useEffect, useMemo, useRef, useState } from "react";
import CareIcon, { type IconName } from "./CareIcon";
import { addDateKeyDays, dateKeyInZone, startOfDayInZone } from "../data/dateWindows";
import { getCareLogDelta, getLogMetric, metricLabels, metricUnits, removeUndoneCareLogs, type CareLog, type TrackableKey } from "../data/careLogBatching";
import type { TargetRule } from "../data/familyService";
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

export default function AnalyticsPage({ cats, logs, goals, targets = [], timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", selectedCatId, initialRange }: {
  cats: OverviewCat[];
  logs: CareLog[];
  goals: Record<string, GoalValues>;
  targets?: TargetRule[];
  timezone?: string;
  selectedCatId: number | string;
  initialRange?: Range;
}) {
  const [range, setRange] = useState<Range>(initialRange ?? "week");
  const [selectedDateKey, setSelectedDateKey] = useState(() => dateKeyInZone(new Date(), timezone));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [closingDatePicker, setClosingDatePicker] = useState(false);
  const datePickerCloseTimer = useRef<number | undefined>(undefined);
  const [pickerMonth, setPickerMonth] = useState(() => dateKeyInZone(new Date(), timezone).slice(0, 7));
  const [catFilter, setCatFilter] = useState(selectedCatId === "" ? "all" : String(selectedCatId));
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
    setCatFilter(String(cats[nextIndex].id));
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
    if (range === "day") setSelectedDateKey(addDateKeyDays(selectedDateKey, direction));
    else if (range === "week") setSelectedDateKey(addDateKeyDays(selectedDateKey, direction * 7));
    else {
      const monthDate = new Date(Date.UTC(anchorParts[0], anchorParts[1] - 1 + direction, 1));
      setSelectedDateKey(`${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, "0")}-01`);
    }
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
  const scopedCats = catFilter === "all" ? cats : cats.filter((cat) => String(cat.id) === catFilter);
  const scopedCatIds = new Set(scopedCats.map((cat) => String(cat.id)));
  const periodStart = new Date(startOfDayInZone(rangeStartKey, timezone)).getTime();
  const periodEnd = new Date(startOfDayInZone(visibleEndExclusive, timezone)).getTime();
  const activeLogs = useMemo(() => removeUndoneCareLogs(logs), [logs]).filter((entry) => {
    const time = new Date(entry.timestamp).getTime();
    return scopedCatIds.has(String(entry.catId)) && time >= periodStart && time < periodEnd;
  });
  const goalsForDate = (dateKey: string) => scopedCats.map((cat) => {
    const fallback = goals[String(cat.id)] ?? { treatsGoal: 4, kibbleGoal: 3, cansGoal: 1 };
    const applicable = (metric: "treats" | "kibble" | "wet_food", defaultValue: number) => targets
      .filter((target) => target.cat_id === String(cat.id) && target.metric === metric && target.cadence === "daily" && target.effective_from <= dateKey && (!target.effective_until || target.effective_until >= dateKey))
      .sort((left, right) => right.effective_from.localeCompare(left.effective_from))[0]?.target_amount ?? defaultValue;
    return {
      treatsGoal: Number(applicable("treats", fallback.treatsGoal)),
      kibbleGoal: Number(applicable("kibble", fallback.kibbleGoal)),
      cansGoal: Number(applicable("wet_food", fallback.cansGoal)),
    };
  });
  const valueOn = (key: string, catId: string, metric: TrackableKey) => activeLogs.reduce((sum, entry) => {
    if (String(entry.catId) !== catId || dateKeyInZone(new Date(entry.timestamp), timezone) !== key || getLogMetric(entry) !== metric) return sum;
    const delta = getCareLogDelta(entry);
    return sum + Math.max(0, delta ?? (entry.detail === "Marked done" ? 1 : 0));
  }, 0);
  const dailyScores = dates.map((key) => {
    let checks = 0;
    const dailyGoals = goalsForDate(key);
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
    const hasData = activeLogs.some((entry) => dateKeyInZone(new Date(entry.timestamp), timezone) === key);
    return { key, date: dateFromKey(key), score: scopedCats.length ? checks / scopedCats.length : 0, checks, hasData };
  });
  const totalChecks = dailyScores.reduce((sum, day) => sum + day.checks, 0);
  const targetCount = Math.max(1, dates.length * 7 * scopedCats.length);
  const careRate = Math.round((totalChecks / targetCount) * 100);
  const loggedDays = dailyScores.filter((day) => day.hasData).length;
  const teethNotices = activeLogs.filter((entry) => getLogMetric(entry) === "teethPawing").reduce((sum, entry) => sum + Math.max(0, getCareLogDelta(entry) ?? 1), 0);
  const foodSummary = foodMetrics.map((metric) => {
    const value = activeLogs.reduce((sum, entry) => getLogMetric(entry) === metric.key ? sum + Math.max(0, getCareLogDelta(entry) ?? 0) : sum, 0);
    const goal = dates.reduce((periodGoal, dateKey) => periodGoal + goalsForDate(dateKey).reduce((sum, catGoals) => sum + catGoals[metric.goal], 0), 0);
    return { ...metric, value, goal, status: value > goal ? "overshot" : value >= goal ? "met" : "missed" };
  });
  const waterTopUps = activeLogs.filter((entry) => getLogMetric(entry) === "fountain").reduce((sum, entry) => sum + Math.max(0, getCareLogDelta(entry) ?? 1), 0);
  const playSessions = activeLogs.filter((entry) => getLogMetric(entry) === "played").reduce((sum, entry) => sum + Math.max(0, getCareLogDelta(entry) ?? 1), 0);
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
  const contributions = activityMetrics.map((metric) => {
    const byMember = new Map<string, { name: string; amount: number }>();
    activeLogs.forEach((entry) => {
      if (getLogMetric(entry) !== metric) return;
      const amount = Math.max(0, getCareLogDelta(entry) ?? (entry.detail === "Marked done" ? 1 : 0));
      if (amount <= 0) return;
      const key = entry.actorUserId ?? entry.who;
      const current = byMember.get(key) ?? { name: entry.who, amount: 0 };
      current.amount += amount;
      byMember.set(key, current);
    });
    const leaders = [...byMember.values()].sort((left, right) => right.amount - left.amount);
    return { metric, leaders, total: leaders.reduce((sum, member) => sum + member.amount, 0) };
  }).filter((entry) => entry.total > 0);
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
      <div><span className="analytics-eyebrow">Care, over time</span><h1 id="analytics-title">Analytics</h1><p>Little check-ins add up to a lot of love.</p></div>
    </header>

    <div aria-label="Choose a cat. Swipe to switch cats." className="analytics-cat-picker" onPointerDown={handleCatPointerDown} onPointerUp={handleCatPointerUp} onPointerCancel={() => { catSwipeStart.current = null; }}>
      <button aria-pressed={catFilter === "all"} className={`analytics-all-cats ${catFilter === "all" ? "active" : ""}`} onClick={() => setCatFilter("all")} type="button">All cats</button>
      <div className="analytics-cat-options">
        {cats.map((cat) => {
          const active = String(cat.id) === catFilter;
          return <button aria-label={`Show analytics for ${cat.name}`} aria-pressed={active} className={`analytics-cat-option ${active ? "active" : ""}`} key={cat.id} onClick={() => {
            if (ignoreNextCatClick.current) { ignoreNextCatClick.current = false; return; }
            setCatFilter(String(cat.id));
          }} type="button">
            <span className="analytics-cat-avatar" style={{ "--cat-color": cat.color } as React.CSSProperties}>
              {cat.photo ? <img alt="" src={cat.photo} /> : <><i className="analytics-cat-ear analytics-cat-ear-left" /><i className="analytics-cat-ear analytics-cat-ear-right" /><b>{cat.initial}</b></>}
            </span>
            <span className="analytics-cat-name">{cat.name}</span>
          </button>;
        })}
      </div>
    </div>

    <div className="analytics-range" aria-label="Analytics period">
      {(["day", "week", "month"] as Range[]).map((option) => <button aria-pressed={range === option} className={range === option ? "active" : ""} key={option} onClick={() => setRange(option)} type="button">Per {option}</button>)}
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
            return <button aria-pressed={key === rangeStartKey} className={key === rangeStartKey ? "active" : ""} disabled={disabled} key={key} onClick={() => { setSelectedDateKey(key); closeDatePicker(); }} type="button">{new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(pickerYear, index, 1)))}</button>;
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
              return <button aria-pressed={dayKey === selectedDateKey} className={`${dayKey === selectedDateKey ? "active" : ""} ${dayKey === todayKey ? "today" : ""} ${isInSelectedWeek ? "in-selected-week" : ""}`} disabled={dayKey > todayKey} key={dayKey} onClick={() => { setSelectedDateKey(dayKey); closeDatePicker(); }} type="button">{Number(dayKey.slice(-2))}</button>;
            })}
          </div>
        </>}
      </section>
    </div>}

    {!scopedCats.length ? <section className="analytics-empty"><CareIcon name="paw" size={28} /><h2>Add a cat to start seeing trends</h2><p>Care summaries and family contributions will appear here as you log activities.</p></section> : <>
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

      <section className="analytics-card analytics-trend">
        <div className="analytics-card-heading"><div><span className="analytics-card-icon"><CareIcon name="chart" size={19} /></span><div><h2>Care rhythm</h2><p>Average daily targets completed per cat</p></div></div><small>out of 7</small></div>
        <div className={`analytics-chart ${range === "month" ? "is-month" : ""}`}>
          {dailyScores.map((day) => <div className="analytics-chart-day" key={day.key} title={`${day.key}: ${formatAmount(day.score)} of 7`}><div className="analytics-bar-track"><i className={day.score >= 7 ? "is-perfect" : ""} style={{ height: `${Math.max(day.hasData ? 7 : 2, (day.score / 7) * 100)}%` }} />{day.score >= 7 && <span><CareIcon name="sparkle" size={10} /></span>}</div><small>{range === "month" ? Number(day.key.slice(-2)) : new Intl.DateTimeFormat(undefined, { weekday: "narrow", timeZone: "UTC" }).format(day.date)}</small></div>)}
        </div>
        {loggedDays <= 1 && range !== "day" && <p className="analytics-hint"><CareIcon name="paw" size={14} /> Keep checking in—your trend will grow here day by day.</p>}
      </section>

      <section className="analytics-card analytics-contributions">
        <div className="analytics-card-heading"><div><span className="analytics-card-icon is-lilac"><CareIcon name="family" size={19} /></span><div><h2>Family contributions</h2><p>Who logged the most of each kind of care</p></div></div></div>
        {contributions.length ? <div className="analytics-contribution-list">{contributions.map(({ metric, leaders, total }) => {
          const topAmount = leaders[0].amount;
          const topNames = leaders.filter((member) => member.amount === topAmount).map((member) => member.name);
          return <div className="analytics-contribution-row" key={metric}><span className={`analytics-contribution-icon ${metric === "treats" ? "honey" : metric === "kibble" ? "blue" : metric === "cans" ? "green" : metric === "fountain" ? "aqua" : "lilac"}`}><CareIcon name={activityIcons[metric]} size={16} /></span><strong>{metricLabels[metric]}</strong><span>{topNames.join(" & ")} <small>{formatMetricAmount(metric, topAmount)}</small></span><small className="analytics-total">{formatMetricAmount(metric, total)} total</small></div>;
        })}</div> : <p className="analytics-empty-copy">No care activities were logged during this period.</p>}
      </section>

      <section aria-label="Care that may need attention" className="analytics-card analytics-alerts">
        <div className="analytics-card-heading"><div><span className="analytics-card-icon is-peach"><CareIcon name="heart" size={19} /></span><div><h2>Needs a little attention</h2><p>{periodComplete ? "Based on care logged for this period" : `Compared with goals through ${expectedThroughDate}`}</p></div></div></div>
        {careAlerts.length ? <ul className="analytics-alert-list">{careAlerts.map((alert) => <li className={`analytics-alert ${alert.severity}`} key={alert.key}><span><CareIcon name={alert.icon} size={17} /></span><div><strong>{alert.title}</strong><small>{alert.detail}</small></div></li>)}</ul> : <p className="analytics-empty-copy">Nothing to flag from the care logs in this period.</p>}
      </section>
      </div>
    </>}
  </main>;
}
