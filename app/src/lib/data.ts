// What the pages share: the rule type the UI works with, and the formatting
// and formulas behind its numbers. Sizes are in GiB to keep the numbers readable.
//   ratio      = uploaded / downloaded
//   budget     = uploaded / holdBelow - downloaded
//   to release = releaseAbove * downloaded - uploaded
//   limit      = uploaded / holdBelow while OK, uploaded / releaseAbove while held

import type { Freeleech, RuleConfig, RuleState, RuleStatus, TrackerStatus } from "./api";

// A rule's settings from /rules, with its live numbers from /status.
export interface Rule extends RuleConfig {
  uploadedGiB: number;
  downloadedGiB: number;
  // Torrents in qBittorrent the rule reaches.
  torrents: number;
  state: RuleState;
}

const GIB = 1024 ** 3;

// A new rule's thresholds. They also measure the trackers with no rule, which
// trakarr only shows: nothing is held without a rule.
export const DEFAULT_THRESHOLDS = { holdBelow: 1, releaseAbove: 1.1 };

export function toBytes(gib: number): number {
  return Math.round(gib * GIB);
}

export function toGiB(bytes: number): number {
  return bytes / GIB;
}

export function mergeRules(configs: RuleConfig[], statuses: RuleStatus[]): Rule[] {
  const live = new Map(statuses.map((status) => [status.id, status]));
  return configs.map((config) => {
    const status = live.get(config.id);
    return {
      ...config,
      uploadedGiB: toGiB(status?.uploaded ?? 0),
      downloadedGiB: toGiB(status?.downloaded ?? 0),
      torrents: status?.torrents ?? 0,
      state: status?.state ?? "ok",
    };
  });
}

// A row of the Dashboard's trackers: a domain the torrents in qBittorrent
// announce to, or a rule that no such domain leads to, like one on tags.
export interface TrackerRow {
  key: string;
  // The domain, or what the rule matches.
  name: string;
  // None for a rule's row, which has no quota.
  domain: string | undefined;
  torrents: number;
  // With what was bought, and without what came on a freeleech.
  uploadedGiB: number;
  downloadedGiB: number;
  boughtGiB: number;
  freeleech: Freeleech | null;
  rule: Rule | undefined;
}

// Each rule's trackers in the rules' order, then the trackers with no rule,
// the ones with the most torrents first.
export function trackerRows(rules: Rule[], trackers: TrackerStatus[]): TrackerRow[] {
  const row = (tracker: TrackerStatus, rule: Rule | undefined): TrackerRow => ({
    key: tracker.domain,
    name: tracker.domain,
    domain: tracker.domain,
    torrents: tracker.torrents,
    uploadedGiB: toGiB(tracker.uploaded),
    downloadedGiB: toGiB(tracker.downloaded),
    boughtGiB: toGiB(tracker.bought),
    freeleech: tracker.freeleech,
    rule,
  });
  const ruled = rules.flatMap((rule) => {
    const own = trackers.filter((tracker) => tracker.ruleId === rule.id);
    if (own.length > 0) return own.map((tracker) => row(tracker, rule));
    const { torrents, uploadedGiB, downloadedGiB } = rule;
    const name = [...rule.tags, ...rule.domains].join(", ");
    return [
      {
        key: `rule:${rule.id}`,
        name,
        domain: undefined,
        torrents,
        uploadedGiB,
        downloadedGiB,
        boughtGiB: 0,
        freeleech: null,
        rule,
      },
    ];
  });
  const free = trackers
    .filter((tracker) => !rules.some((rule) => rule.id === tracker.ruleId))
    .sort((a, b) => b.torrents - a.torrents || a.domain.localeCompare(b.domain))
    .map((tracker) => row(tracker, undefined));
  return [...ruled, ...free];
}

// What measures a tracker's downloads: its rule, or for one with none, a stand-in
// on the default thresholds. The stand-in isn't enabled, since it holds nothing.
export function gaugeOf(row: TrackerRow): Rule {
  return (
    row.rule ?? {
      id: "",
      name: row.name,
      tags: [],
      domains: [row.name],
      ...DEFAULT_THRESHOLDS,
      action: "throttle",
      prowlarr: null,
      enabled: false,
      uploadedGiB: row.uploadedGiB,
      downloadedGiB: row.downloadedGiB,
      torrents: row.torrents,
      state: "ok",
    }
  );
}

export type TrackerSort = "name" | "ratio" | "downloaded" | "buffer";

// What each sortable column sorts by. Rows with nothing in the column, like
// a tracker's Buffer without a rule, go last either way. Ties keep the usual
// order.
export function sortTrackers(rows: TrackerRow[], column: TrackerSort, direction: "ascending" | "descending"): TrackerRow[] {
  const sign = direction === "ascending" ? 1 : -1;
  const value = (row: TrackerRow): string | number | undefined => {
    const { rule } = row;
    if (column === "name") return row.name;
    if (column === "ratio") return freeleechLeft(row.freeleech) > 0 ? Infinity : ratioOf(row);
    if (column === "downloaded") return usageOf(gaugeOf(row));
    // Held rules come first going up: they're past their hold already. A
    // tracker on a freeleech, with a rule or not, has no end to what it can
    // download.
    if (freeleechLeft(row.freeleech) > 0) return Infinity;
    if (!rule?.enabled) return undefined;
    return rule.state === "held" ? -toReleaseOf(rule) : budgetOf(rule);
  };
  return rows
    .map((row, index) => ({ row, index, value: value(row) }))
    .sort((a, b) => {
      if (a.value === undefined || b.value === undefined) {
        return a.value === b.value ? a.index - b.index : a.value === undefined ? 1 : -1;
      }
      const order =
        typeof a.value === "string" ? a.value.localeCompare(String(b.value)) : a.value - (b.value as number);
      return order * sign || a.index - b.index;
    })
    .map(({ row }) => row);
}

export function ratioOf({ uploadedGiB, downloadedGiB }: Pick<Rule, "uploadedGiB" | "downloadedGiB">): number {
  return downloadedGiB === 0 ? Infinity : uploadedGiB / downloadedGiB;
}

export function budgetOf(rule: Rule): number {
  return rule.uploadedGiB / rule.holdBelow - rule.downloadedGiB;
}

// What the tracker may have downloaded at its next threshold: the hold ratio
// while it's OK, the release ratio while it's held. A held tracker is over it.
export function limitOf(rule: Rule): number {
  const held = rule.enabled && rule.state === "held";
  return rule.uploadedGiB / (held ? rule.releaseAbove : rule.holdBelow);
}

// How much of its limit a rule has downloaded, as a fraction. With nothing
// uploaded the limit is zero, and any download is past it without end.
export function usageOf(rule: Rule): number {
  const limit = limitOf(rule);
  if (limit > 0) return rule.downloadedGiB / limit;
  return rule.downloadedGiB > 0 ? Infinity : 0;
}

export function toReleaseOf(rule: Rule): number {
  return Math.max(0, rule.releaseAbove * rule.downloadedGiB - rule.uploadedGiB);
}

// How long a freeleech still runs, in ms. Zero once it's over, even before
// the server drops it.
export function freeleechLeft(freeleech: Freeleech | null, now = Date.now()): number {
  return freeleech ? Math.max(0, freeleech.until - now) : 0;
}

// Time left in its two largest units: "23h 10m", "45m", under a minute "<1m".
export function formatLeft(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
}

export function formatGiB(gib: number): string {
  if (gib === 0) return "0 B";
  if (gib >= 1024) return `${(gib / 1024).toFixed(2)} TiB`;
  return `${gib.toFixed(1)} GiB`;
}

// Compact relative time in its largest whole unit: "35m ago", "1h ago", "2d ago".
export function formatAgo(minutes: number): string {
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / (60 * 24))}d ago`;
}

export function formatRatio(ratio: number): string {
  return Number.isFinite(ratio) ? ratio.toFixed(2) : "∞";
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

// When an event happened: the time today, then "Yesterday", then the date.
export function formatWhen(at: number, now = new Date()): string {
  const date = new Date(at);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// The time of day of a log line, to the millisecond.
export function formatTime(at: number): string {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function minutesSince(at: number): number {
  return Math.max(0, Math.floor((Date.now() - at) / 60_000));
}
