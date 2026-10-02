// What the pages share: the rule type the UI works with, and the formulas
// behind its numbers, which format.ts shows. Sizes are in GiB to keep the
// numbers readable.
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
  // Pinned trackers go to the top of the list. A rule's row has no domain to pin.
  pinned: boolean;
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
    pinned: tracker.pinned,
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
        pinned: false,
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

// The trackers whose name has what was typed, in any case. A blank search keeps
// them all.
export function filterTrackers(rows: TrackerRow[], query: string): TrackerRow[] {
  const needle = query.trim().toLowerCase();
  return needle ? rows.filter((row) => row.name.toLowerCase().includes(needle)) : rows;
}

// The pinned trackers first, each group in the order it came.
export function pinnedFirst(rows: TrackerRow[]): TrackerRow[] {
  return [...rows.filter((row) => row.pinned), ...rows.filter((row) => !row.pinned)];
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

export function minutesSince(at: number): number {
  return Math.max(0, Math.floor((Date.now() - at) / 60_000));
}
