export function dateKeyInZone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDateKeyDays(key: string, days: number) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function startOfDayInZone(dateKey: string, timezone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const wallTime = Date.UTC(year, month - 1, day);
  let candidate = wallTime;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]));
    const representedWallTime = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    candidate += wallTime - representedWallTime;
  }
  return new Date(candidate).toISOString();
}

export function getFamilyCareWindow(timezone: string, now = new Date()) {
  const today = dateKeyInZone(now, timezone);
  const [year, month, day] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const weekStart = addDateKeyDays(today, -((weekday + 6) % 7));
  return {
    today,
    weekStart,
    todayFrom: startOfDayInZone(today, timezone),
    tomorrowFrom: startOfDayInZone(addDateKeyDays(today, 1), timezone),
    weekFrom: startOfDayInZone(weekStart, timezone),
  };
}
