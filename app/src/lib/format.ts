import type { Clock } from "./api";
import { LOCALES, type Language, type Translate } from "./i18n";

// How the dashboard shows what it measures: sizes, ratios, durations and times,
// in the chosen language, time zone and clock.

export interface Prefs {
  language: Language;
  // An IANA name, or empty for the browser's.
  timeZone: string;
  clock: Clock;
}

export const DEFAULT_PREFS: Prefs = { language: "en", timeZone: "", clock: "24" };

// The zone, or none when it isn't one, say after settings.json was edited by hand.
function zoneOf(timeZone: string): string | undefined {
  if (timeZone === "") return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}

export function createFormat({ language, timeZone, clock }: Prefs, t: Translate) {
  const locale = LOCALES[language];
  const zone = zoneOf(timeZone);

  // Numbers keep their decimal point in every language, like the fields they're
  // typed in: see PointDecimals.
  const number = (n: number, digits: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

  function size(gib: number, gibUnit: string, tibUnit: string): string {
    if (gib === 0) return "0 B";
    if (gib >= 1024) return `${number(gib / 1024, 2)} ${tibUnit}`;
    return `${number(gib, 1)} ${gibUnit}`;
  }

  // The time of day in the zone and clock, built from its parts so the digits
  // and the separator are the same in every language.
  const timeOfDay = (seconds: boolean) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: clock === "12" ? "numeric" : "2-digit",
      minute: "2-digit",
      ...(seconds && { second: "2-digit" }),
      hourCycle: clock === "12" ? "h12" : "h23",
    });
  const minuteFormat = timeOfDay(false);
  const secondFormat = timeOfDay(true);
  const dayFormat = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric" });

  // The calendar day in the zone, as a count of days, so two of them subtract.
  function dayOf(date: Date): number {
    const part = (type: string) => Number(dayFormat.formatToParts(date).find((p) => p.type === type)?.value);
    return Date.UTC(part("year"), part("month") - 1, part("day")) / 86_400_000;
  }

  // "15:04", "15:04:05" or "15:04:05.123", with AM or PM on a 12-hour clock.
  function time(at: number, precision: "minute" | "second" | "millisecond"): string {
    const date = new Date(at);
    const parts = (precision === "minute" ? minuteFormat : secondFormat).formatToParts(date);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const fraction = precision === "millisecond" ? `.${String(date.getUTCMilliseconds()).padStart(3, "0")}` : "";
    const base = `${part("hour")}:${part("minute")}${precision === "minute" ? "" : `:${part("second")}`}${fraction}`;
    return clock === "12" ? `${base} ${part("dayPeriod")}` : base;
  }

  return {
    locale,
    number,

    ratio: (ratio: number) => (Number.isFinite(ratio) ? number(ratio, 2) : "∞"),

    // Sizes are in GiB to keep the numbers readable. Gib is for the ones the
    // formulas give, and gb for the ones people say.
    gib: (gib: number) => size(gib, "GiB", "TiB"),
    gb: (gib: number) => size(gib, "GB", "TB"),

    // Time left in its two largest units: "23h 10m", "45m", under a minute "<1m".
    left(ms: number): string {
      const minutes = Math.floor(ms / 60_000);
      if (minutes < 1) return "<1m";
      if (minutes < 60) return `${minutes}m`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
      const days = Math.floor(hours / 24);
      return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
    },

    // Relative time in its largest whole unit: "35m ago", "1h ago", "2d ago".
    ago(minutes: number): string {
      if (minutes < 60) return t("{minutes}m ago", { minutes });
      if (minutes < 60 * 24) return t("{hours}h ago", { hours: Math.floor(minutes / 60) });
      return t("{days}d ago", { days: Math.floor(minutes / (60 * 24)) });
    },

    // When an event happened: the time today, then "Yesterday", then the date.
    when(at: number, now = Date.now()): string {
      const days = dayOf(new Date(now)) - dayOf(new Date(at));
      if (days <= 0) return time(at, "minute");
      if (days === 1) return t("Yesterday");
      return new Date(at).toLocaleDateString(locale, { month: "short", day: "numeric", timeZone: zone });
    },

    // The calendar day in the zone, with its year, like "Oct 3, 2026".
    date(at: number): string {
      return new Date(at).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric", timeZone: zone });
    },

    time,
  };
}

export type Format = ReturnType<typeof createFormat>;
