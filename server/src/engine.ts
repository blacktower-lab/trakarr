import type { HoldAction, Rule, TrackerQuota } from "./config.ts";

// The rule logic, with no I/O: which torrents a rule reaches, its ratio, its
// state, and what to hold or release.

export type RuleState = "ok" | "held";

// What trakarr keeps of a torrent in qBittorrent. Trackers are reduced to their
// domains as they arrive, so announce URLs and their passkeys go no further.
export interface Torrent {
  hash: string;
  name: string;
  tags: string[];
  domains: string[];
  uploaded: number;
  downloaded: number;
  dlLimit: number;
  state: string;
  progress: number;
}

// A torrent trakarr holds, with what it needs to undo the hold.
export interface Held {
  hash: string;
  ruleId: string;
  name: string;
  action: HoldAction;
  dlLimit: number;
  at: number;
}

// The last totals seen for a torrent, kept after it's removed so the tracker's
// ratio doesn't forget it. A hash that is removed and added again starts from
// zero in qBittorrent, so its earlier lives add up in `past`.
export interface LedgerEntry {
  hash: string;
  domains: string[];
  uploaded: number;
  downloaded: number;
  pastUploaded: number;
  pastDownloaded: number;
  removed: boolean;
  // What it downloaded on a freeleech, in all its lives, which doesn't count.
  freeDownloaded: number;
}

type Match = Pick<Rule, "domains">;

// A torrent matches if it announces to one of the rule's domains or their
// subdomains.
export function matches(rule: Match, domains: string[]): boolean {
  return domains.some((domain) => rule.domains.some((d) => domain === d || domain.endsWith(`.${d}`)));
}

// What a match's torrents uploaded and downloaded, as its trackers count it:
// the upload bought on its domains counts as uploaded, and what was downloaded
// on a freeleech doesn't count.
export function totals(
  rule: Match,
  ledger: Iterable<LedgerEntry>,
  quotas: TrackerQuota[],
): { uploaded: number; downloaded: number } {
  let uploaded = 0;
  let downloaded = 0;
  for (const entry of ledger) {
    if (!matches(rule, entry.domains)) continue;
    uploaded += entry.uploaded + entry.pastUploaded;
    downloaded += entry.downloaded + entry.pastDownloaded - entry.freeDownloaded;
  }
  for (const quota of quotas) {
    if (matches(rule, [quota.domain])) uploaded += quota.bought;
  }
  return { uploaded, downloaded };
}

// Whether a torrent announces to a tracker, or a subdomain of one, of a list.
export function announcesTo(torrent: Pick<Torrent, "domains">, domains: string[]): boolean {
  return matches({ domains }, torrent.domains);
}

// No limit when nothing was downloaded, as with cross-seeds only.
export function ratioOf(uploaded: number, downloaded: number): number {
  return downloaded === 0 ? Infinity : uploaded / downloaded;
}

// A rule on the buffer holds as soon as what it uploaded no longer covers what
// it downloaded, which is a ratio of 1, and releases a little above it so it
// doesn't flap on the line.
export const BUFFER_THRESHOLDS = { holdBelow: 1, releaseAbove: 1.1 };

type Thresholds = Pick<Rule, "holdBelow" | "releaseAbove" | "byBuffer">;

// The ratios a rule holds and releases at: its own, or the buffer's.
export function thresholdsOf(rule: Thresholds): Pick<Rule, "holdBelow" | "releaseAbove"> {
  return rule.byBuffer ? BUFFER_THRESHOLDS : rule;
}

// Between the two thresholds the state stays as it is, so a ratio sitting on
// the line doesn't flap.
export function nextState(state: RuleState, ratio: number, rule: Thresholds): RuleState {
  const { holdBelow, releaseAbove } = thresholdsOf(rule);
  if (state === "ok" && ratio < holdBelow) return "held";
  if (state === "held" && ratio > releaseAbove) return "ok";
  return state;
}

const DOWNLOADING = new Set(["downloading", "stalledDL", "metaDL", "forcedMetaDL", "queuedDL", "forcedDL"]);

// Completed torrents are never touched, and neither are the ones the user stopped.
export function isDownloading(torrent: Torrent): boolean {
  return torrent.progress < 1 && DOWNLOADING.has(torrent.state);
}

export interface Plan {
  // New holds, by the id of the rule that holds them.
  hold: Map<string, Torrent[]>;
  release: Held[];
  // Held torrents that are no longer in qBittorrent.
  gone: string[];
}

// Compares what should be held with what is. A torrent stays held while an
// enabled rule that matches it is held, and anything else trakarr holds is
// released. A torrent on a tracker's freeleech is never held, since what it
// downloads doesn't count. Run on every poll, this also puts things right after
// a crash, a restart or a deleted rule.
export function plan(
  rules: Rule[],
  states: Map<string, RuleState>,
  torrents: Map<string, Torrent>,
  held: Map<string, Held>,
  freeleech: string[],
): Plan {
  const holding = rules.filter((rule) => rule.enabled && states.get(rule.id) === "held");
  const hold = new Map<string, Torrent[]>();
  const release: Held[] = [];
  for (const torrent of torrents.values()) {
    const owner = announcesTo(torrent, freeleech)
      ? undefined
      : holding.find((rule) => matches(rule, torrent.domains));
    const entry = held.get(torrent.hash);
    if (entry && !owner) release.push(entry);
    else if (!entry && owner && isDownloading(torrent)) hold.set(owner.id, [...(hold.get(owner.id) ?? []), torrent]);
  }
  const gone = [...held.keys()].filter((hash) => !torrents.has(hash));
  return { hold, release, gone };
}

export function formatRatio(ratio: number): string {
  return Number.isFinite(ratio) ? ratio.toFixed(3) : "∞";
}
