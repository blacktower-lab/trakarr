import { Button, I18nProvider, SearchField, Table, Toast, Tooltip, toast } from "@heroui/react";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  ChevronUp,
  CircleCheck,
  CircleQuestionMark,
  Coins,
  History,
  LayoutDashboard,
  Pause,
  Pencil,
  Pin,
  PinOff,
  Play,
  Plus,
  RadioTower,
  ScrollText,
  Settings as SettingsIcon,
  SlidersHorizontal,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Listed } from "./components/Empty";
import { Logo } from "./components/Logo";
import "../../assets/wordmark.css";
import { PageMenu, type PageMenuItem } from "./components/PageMenu";
import { pageCount, Pager } from "./components/Pager";
import { QuotaEditor } from "./components/QuotaEditor";
import { RowActions, type RowAction } from "./components/RowActions";
import { RuleEditor } from "./components/RuleEditor";
import { Section } from "./components/Section";
import { UsageBar } from "./components/UsageBar";
import { usePoll } from "./hooks/usePoll";
import {
  api,
  type EventKind,
  type HeldTorrent,
  type QuotaChange,
  type RuleFields,
  type Status,
  type TrakarrEvent,
} from "./lib/api";
import { cx } from "./lib/cx";
import {
  budgetOf,
  filterTrackers,
  formatAgo,
  formatGiB,
  formatRatio,
  formatWhen,
  freeleechLeft,
  gaugeOf,
  mergeRules,
  minutesSince,
  pinnedFirst,
  ratioOf,
  sortTrackers,
  toReleaseOf,
  trackerRows,
  type Rule,
  type TrackerRow,
  type TrackerSort,
} from "./lib/data";
import { Logs } from "./pages/Logs";
import { Rules } from "./pages/Rules";
import { Settings } from "./pages/Settings";

type Page = "dashboard" | "rules" | "logs" | "settings";

const PAGES: Record<Page, PageMenuItem> = {
  dashboard: { label: "Dashboard", icon: LayoutDashboard },
  rules: { label: "Rules", icon: SlidersHorizontal },
  logs: { label: "Logs", icon: ScrollText },
  settings: { label: "Settings", icon: SettingsIcon },
};

const PAGE_X = "px-4 md:px-8 lg:px-10";

export function App() {
  return (
    // The UI is in English, so HeroUI's number fields format ratios the same
    // way the rest of the page does, whatever the browser's language.
    <I18nProvider locale="en-US">
      <Shell />
      <Toast.Provider />
    </I18nProvider>
  );
}

// What one poll brings. If a later poll fails, the last one's data stays.
interface Live {
  rules: Rule[];
  status: Status;
  events: TrakarrEvent[];
}

const DEFAULT_POLL_SECONDS = 5;

const TRACKERS_PER_PAGE = 10;

// A tracker with no rule is only measured, so its row is faded. UsageBar fades
// its bar the same way.
const FADED = "opacity-40";

type SortDescriptor = NonNullable<Table["ContentProps"]["sortDescriptor"]>;

function Shell() {
  const [page, setPage] = useState<Page>("dashboard");
  // The only poll: the rules, their live numbers and the recent events come
  // together, and everything below reads from them.
  const live = usePoll<Live>(
    async () => {
      const [configs, status, events] = await Promise.all([api.rules(), api.status(), api.events(4)]);
      return { rules: mergeRules(configs, status.rules), status, events };
    },
    (last) => (last?.status.pollSeconds ?? DEFAULT_POLL_SECONDS) * 1000,
  );
  const { data, error } = live;

  // The rule being edited, or none while a new one is written, which can start
  // from a draft, like a tracker's domain.
  const [editing, setEditing] = useState<{ rule?: Rule; draft?: Partial<Rule>; session: number }>({ session: 0 });
  const [editorOpen, setEditorOpen] = useState(false);

  const openEditor = (rule?: Rule, draft?: Partial<Rule>) => {
    setEditing((current) => ({ rule, draft, session: current.session + 1 }));
    setEditorOpen(true);
  };

  // A failed save keeps the editor open, so what was typed isn't lost.
  const saveRule = async (fields: RuleFields) => {
    const { rule } = editing;
    try {
      await (rule ? api.updateRule(rule.id, fields) : api.createRule(fields));
    } catch (error) {
      toast.danger(`Couldn't save ${fields.name}`, { description: (error as Error).message });
      return;
    }
    setEditorOpen(false);
    live.refresh();
    toast.success(`${fields.name} ${rule ? "saved" : "added"}`);
  };

  const deleteRule = async (rule: Rule) => {
    try {
      await api.deleteRule(rule.id);
    } catch (error) {
      toast.danger(`Couldn't delete ${rule.name}`, { description: (error as Error).message });
      return;
    }
    live.refresh();
    toast(`${rule.name} deleted`);
  };

  // The tracker whose quota is being changed.
  const [quota, setQuota] = useState<{ tracker?: TrackerRow; session: number }>({ session: 0 });
  const [quotaOpen, setQuotaOpen] = useState(false);

  const openQuota = (tracker: TrackerRow) => {
    setQuota((current) => ({ tracker, session: current.session + 1 }));
    setQuotaOpen(true);
  };

  // Like a rule's, a failed save keeps the dialog open.
  const saveQuota = async (change: QuotaChange) => {
    const domain = quota.tracker?.domain;
    if (!domain) return;
    try {
      await api.updateTracker(domain, change);
    } catch (error) {
      toast.danger(`Couldn't change ${domain}'s quota`, { description: (error as Error).message });
      return;
    }
    setQuotaOpen(false);
    live.refresh();
    toast.success(`${domain} quota saved`);
  };

  const togglePin = async (tracker: TrackerRow) => {
    const { domain } = tracker;
    if (!domain) return;
    const pinned = !tracker.pinned;
    try {
      await api.updateTracker(domain, { pinned });
    } catch (error) {
      toast.danger(`Couldn't ${pinned ? "pin" : "unpin"} ${domain}`, { description: (error as Error).message });
      return;
    }
    live.refresh();
    toast(`${domain} ${pinned ? "pinned" : "unpinned"}`);
  };

  const toggleEnabled = async (rule: Rule) => {
    const enabled = !rule.enabled;
    try {
      await api.updateRule(rule.id, { enabled });
    } catch (error) {
      toast.danger(`Couldn't ${enabled ? "resume" : "pause"} ${rule.name}`, { description: (error as Error).message });
      return;
    }
    live.refresh();
    toast(`${rule.name} ${enabled ? "resumed" : "paused"}`);
  };

  return (
    // isolate keeps the sticky header's z-index inside the app, so dialogs portaled
    // to <body> paint above it.
    <div className="isolate min-h-dvh bg-background text-foreground">
      <header className="sticky top-[env(safe-area-inset-top,0px)] z-10 border-b border-separator bg-background">
        <div className={cx("mx-auto flex max-w-[1400px] items-center gap-4 pt-3", PAGE_X)}>
          <div className="flex items-center gap-1.25">
            <Logo className="size-11" />
            <span className="wordmark text-[21px]">trakarr</span>
          </div>
          <div className="ml-auto">
            <QbittorrentStatus status={data?.status} error={error} />
          </div>
        </div>
        <div className={cx("mx-auto max-w-[1400px] pt-6", PAGE_X)}>
          <PageMenu label="Pages" items={PAGES} current={page} onSelect={setPage} />
        </div>
      </header>

      <main className={cx("mx-auto max-w-[1400px] pb-16 pt-8", PAGE_X)}>
        {page === "dashboard" ? (
          <Dashboard
            live={data}
            error={error}
            onEdit={(rule) => openEditor(rule)}
            onNew={(draft) => openEditor(undefined, draft)}
            onChangeQuota={openQuota}
            onTogglePin={togglePin}
            onShowLogs={() => setPage("logs")}
            onToggleEnabled={toggleEnabled}
          />
        ) : page === "rules" ? (
          <Rules rules={data?.rules} error={error} onNew={() => openEditor()} onEdit={(rule) => openEditor(rule)} onDelete={deleteRule} />
        ) : page === "logs" ? (
          <Logs />
        ) : (
          <Settings />
        )}
      </main>

      <RuleEditor
        open={editorOpen}
        rule={editing.rule}
        draft={editing.draft}
        session={editing.session}
        onOpenChange={setEditorOpen}
        onSave={saveRule}
      />

      <QuotaEditor
        open={quotaOpen}
        tracker={quota.tracker}
        session={quota.session}
        onOpenChange={setQuotaOpen}
        onSave={saveQuota}
      />
    </div>
  );
}

// Whether trakarr reaches qBittorrent. Its address and how fresh the numbers
// are sit in the tooltip.
function QbittorrentStatus({ status, error }: { status: Status | undefined; error: Error | undefined }) {
  if (error) return <StatusText color="bg-danger">{error.message}</StatusText>;
  if (!status) {
    return (
      <Tooltip>
        <Tooltip.Trigger>
          <StatusText color="bg-foreground/30" />
        </Tooltip.Trigger>
        <Tooltip.Content>Connecting</Tooltip.Content>
      </Tooltip>
    );
  }

  const { qbittorrent } = status;
  const details = qbittorrent.ok
    ? [
        qbittorrent.address,
        qbittorrent.lastUpdate !== null &&
          `updated ${Math.max(0, Math.round((Date.now() - qbittorrent.lastUpdate) / 1000))} s ago`,
      ]
    : [qbittorrent.address, qbittorrent.message];

  return (
    <Tooltip>
      <Tooltip.Trigger>
        <StatusText color={qbittorrent.ok ? "bg-success" : "bg-danger"}>
          {qbittorrent.ok ? `qBittorrent ${qbittorrent.version}` : "qBittorrent"}
        </StatusText>
      </Tooltip.Trigger>
      <Tooltip.Content>{details.filter(Boolean).join(" · ")}</Tooltip.Content>
    </Tooltip>
  );
}

function StatusText({ color, children }: { color: string; children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted">
      <span className={cx("size-1.5 rounded-full", color)} />
      {children}
    </span>
  );
}

interface DashboardProps {
  live: Live | undefined;
  error: Error | undefined;
  onEdit: (rule: Rule) => void;
  // Opens a new rule on a draft.
  onNew: (draft: Partial<Rule>) => void;
  onChangeQuota: (tracker: TrackerRow) => void;
  onTogglePin: (tracker: TrackerRow) => void;
  onShowLogs: () => void;
  onToggleEnabled: (rule: Rule) => void;
}

function Dashboard({ live, error, onEdit, onNew, onChangeQuota, onTogglePin, onShowLogs, onToggleEnabled }: DashboardProps) {
  const rules = live?.rules ?? [];
  // In their usual order until a column is sorted.
  const [sort, setSort] = useState<SortDescriptor>();
  const [search, setSearch] = useState("");
  const rows = trackerRows(rules, live?.status.trackers ?? []);
  const matching = filterTrackers(rows, search);
  // The pinned ones stay on top, whatever the sort.
  const trackers = pinnedFirst(sort ? sortTrackers(matching, sort.column as TrackerSort, sort.direction) : matching);
  // A page past the last, after trackers went away, shows the last one.
  const [trackerPage, setTrackerPage] = useState(1);
  const page = Math.min(trackerPage, pageCount(trackers.length, TRACKERS_PER_PAGE));
  const shown = trackers.slice((page - 1) * TRACKERS_PER_PAGE, page * TRACKERS_PER_PAGE);
  const held = live?.status.held ?? [];
  const events = live?.events ?? [];

  return (
    <div className="flex flex-col gap-10">
      <Section
        title="Trackers"
        action={
          rows.length > 0 && (
            // The input won't shrink below its own width, which is larger on a
            // phone, so anything narrower clips the clear button.
            <div className="w-64">
              <SearchField
                aria-label="Filter trackers"
                fullWidth
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  setTrackerPage(1);
                }}
              >
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder="Filter by name" />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
            </div>
          )
        }
      >
        <Listed
          loaded={!!live}
          error={error}
          count={trackers.length}
          icon={RadioTower}
          // With trackers in the list, an empty one means the search left none.
          empty={
            rows.length > 0
              ? { title: "No matching trackers", description: "Try another name" }
              : {
                  title: "No trackers yet",
                  description: live?.status.qbittorrent.ok
                    ? "qBittorrent has no torrents"
                    : "They show up once qBittorrent connects",
                }
          }
        >
          <Table>
            {/* Sizes the columns from their widths, so sorting never moves them. */}
            <Table.ResizableContainer>
              <Table.Content
                aria-label="Trackers"
                sortDescriptor={sort}
                onSortChange={(next) => {
                  setSort(next);
                  setTrackerPage(1);
                }}
              >
                <Table.Header>
                  <SortableColumn id="name" isRowHeader width="1fr" minWidth={260}>
                    Tracker
                  </SortableColumn>
                  <SortableColumn id="ratio" width={120} hint="Uploaded over downloaded">
                    Ratio
                  </SortableColumn>
                  <SortableColumn id="downloaded" width={360} hint="Downloaded against what its upload allows">
                    Downloaded
                  </SortableColumn>
                  <SortableColumn id="buffer" width={180} hint="Left before the next hold or release">
                    Buffer
                  </SortableColumn>
                  <Table.Column textValue="Actions" width={72}>
                    <span className="sr-only">Actions</span>
                  </Table.Column>
                </Table.Header>
                <Table.Body>
                  {shown.map((tracker) => {
                    const { rule } = tracker;
                    return (
                      <Table.Row key={tracker.key} id={tracker.key}>
                        <Table.Cell>
                          <TrackerName tracker={tracker} onTogglePin={onTogglePin} />
                        </Table.Cell>
                        <Table.Cell>
                          <span className={cx(!rule && FADED)}>
                            <Ratio totals={tracker} freeleech={freeleechLeft(tracker.freeleech) > 0} />
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          <UsageBar
                            rule={gaugeOf(tracker)}
                            faded={!rule}
                            freeleechLeft={freeleechLeft(tracker.freeleech)}
                          />
                        </Table.Cell>
                        <Table.Cell>
                          {freeleechLeft(tracker.freeleech) > 0 ? (
                            <span className={cx(!rule && FADED)}>
                              <FreeleechBuffer />
                            </span>
                          ) : (
                            rule?.enabled && <Buffer rule={rule} held={rule.state === "held"} />
                          )}
                        </Table.Cell>
                        <Table.Cell>
                          <TrackerActions
                            tracker={tracker}
                            onEdit={onEdit}
                            onNew={onNew}
                            onChangeQuota={onChangeQuota}
                            onTogglePin={onTogglePin}
                            onToggleEnabled={onToggleEnabled}
                          />
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Content>
            </Table.ResizableContainer>
            {trackers.length > TRACKERS_PER_PAGE && (
              <Table.Footer>
                <Pager
                  label="Trackers pages"
                  page={page}
                  pageSize={TRACKERS_PER_PAGE}
                  total={trackers.length}
                  onChange={setTrackerPage}
                />
              </Table.Footer>
            )}
          </Table>
        </Listed>
      </Section>

      <Section title="Held torrents">
        <Listed
          loaded={!!live}
          error={error}
          count={held.length}
          icon={CircleCheck}
          empty={{ title: "Nothing is held", description: "Downloads a rule holds show up here" }}
        >
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Held torrents">
                <Table.Header>
                  <Table.Column isRowHeader>Torrent</Table.Column>
                  <Table.Column>Tracker</Table.Column>
                  <Table.Column>Progress</Table.Column>
                  <Table.Column>Held</Table.Column>
                </Table.Header>
                <Table.Body>
                  {held.map((torrent) => (
                    <Table.Row key={torrent.hash} id={torrent.hash}>
                      <Table.Cell>{torrent.name}</Table.Cell>
                      <Table.Cell>{rules.find((r) => r.id === torrent.ruleId)?.name ?? "—"}</Table.Cell>
                      <Table.Cell>{progressOf(torrent)}</Table.Cell>
                      <Table.Cell>{formatAgo(minutesSince(torrent.at))}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Listed>
      </Section>

      <Section
        title="Recent events"
        action={
          <Button variant="ghost" size="sm" onPress={onShowLogs}>
            Open logs
          </Button>
        }
      >
        <Listed
          loaded={!!live}
          error={error}
          count={events.length}
          icon={History}
          empty={{ title: "No events yet", description: "Holds, releases and changes show up here" }}
        >
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Recent events">
                <Table.Header>
                  <Table.Column>Time</Table.Column>
                  <Table.Column isRowHeader>Event</Table.Column>
                </Table.Header>
                <Table.Body>
                  {events.map((event) => (
                    <Table.Row key={event.id} id={event.id}>
                      <Table.Cell>{formatWhen(event.at)}</Table.Cell>
                      <Table.Cell>
                        <span className="inline-flex items-center gap-2.5">
                          <EventDot kind={event.kind} />
                          {event.text}
                        </span>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Listed>
      </Section>
    </div>
  );
}

type ColumnWidth = Table["ColumnProps"]["width"];

interface SortableColumnProps {
  id: TrackerSort;
  isRowHeader?: boolean;
  width: ColumnWidth;
  minWidth?: number;
  // What the column shows, in the tooltip of a ? after its label. HeroUI's
  // tooltips break anywhere past a line's end, so it has to fit in one.
  hint?: string;
  children: string;
}

// A column that sorts the table when pressed. HeroUI puts its arrow at the end
// of the column, so it's off and the arrow is drawn here, left of the label. The
// sorted column points up or down, like HeroUI's does; the others show that they
// can be sorted. All take the same room, so nothing shifts when the sort moves.
function SortableColumn({ id, isRowHeader, width, minWidth, hint, children }: SortableColumnProps) {
  return (
    <Table.Column id={id} isRowHeader={isRowHeader} allowsSorting textValue={children} width={width} minWidth={minWidth}>
      {({ sortDirection }) => (
        <Table.SortableColumnHeader sortDirection={sortDirection} showIndicator={false}>
          {/* One child, so the header's justify-between leaves them together. */}
          <span className="inline-flex items-center gap-1.5">
            {sortDirection ? (
              <ChevronUp
                aria-hidden
                size={12}
                className={cx(
                  "shrink-0 transition-transform duration-100 ease-out motion-reduce:transition-none",
                  sortDirection === "descending" && "rotate-180",
                )}
              />
            ) : (
              <ChevronsUpDown aria-hidden size={12} className="shrink-0 text-muted" />
            )}
            {children}
            {hint && (
              <Tooltip>
                <Tooltip.Trigger aria-label={`About ${children}`}>
                  <CircleQuestionMark aria-hidden size={12} className="text-muted" />
                </Tooltip.Trigger>
                <Tooltip.Content>{hint}</Tooltip.Content>
              </Tooltip>
            )}
          </span>
        </Table.SortableColumnHeader>
      )}
    </Table.Column>
  );
}

interface TrackerActionsProps {
  tracker: TrackerRow;
  onEdit: (rule: Rule) => void;
  onNew: (draft: Partial<Rule>) => void;
  onChangeQuota: (tracker: TrackerRow) => void;
  onTogglePin: (tracker: TrackerRow) => void;
  onToggleEnabled: (rule: Rule) => void;
}

// A tracker's menu: its rule's actions, or one to start a rule on its domain,
// and its quota and pin. A rule's own row has no domain, so neither.
function TrackerActions({ tracker, onEdit, onNew, onChangeQuota, onTogglePin, onToggleEnabled }: TrackerActionsProps) {
  const { rule } = tracker;
  const perDomain: RowAction[] = tracker.domain
    ? [
        { id: "quota", label: "Change quota", icon: Coins },
        tracker.pinned
          ? { id: "pin", label: "Unpin tracker", icon: PinOff }
          : { id: "pin", label: "Pin tracker", icon: Pin },
      ]
    : [];
  const items: RowAction[] = rule
    ? [
        { id: "edit", label: "Edit rule", icon: Pencil },
        ...perDomain,
        {
          id: "toggle",
          label: rule.enabled ? "Pause rule" : "Resume rule",
          icon: rule.enabled ? Pause : Play,
          danger: rule.enabled,
        },
      ]
    : [{ id: "add", label: "Add rule", icon: Plus }, ...perDomain];

  const act = (id: string) => {
    if (id === "quota") onChangeQuota(tracker);
    else if (id === "pin") onTogglePin(tracker);
    else if (!rule) {
      onNew({
        name: tracker.name,
        domains: [tracker.name],
        torrents: tracker.torrents,
        uploadedGiB: tracker.uploadedGiB,
        downloadedGiB: tracker.downloadedGiB,
      });
    } else if (id === "edit") onEdit(rule);
    else onToggleEnabled(rule);
  };

  return <RowActions label={`Actions for ${tracker.name}`} items={items} onAction={act} />;
}

// Gone from qBittorrent, a held torrent has no progress to show.
function progressOf(torrent: HeldTorrent): string {
  return torrent.progress === null ? "—" : `${Math.round(torrent.progress * 100)}%`;
}

// A tracker with a rule shows the rule's state in its dot. One with none is
// faded, with a gray dot: only enabled rules have colors. A pinned tracker's dot
// is a pin in the same color, and pressing it pins or unpins. The torrents it has
// follow its name.
function TrackerName({ tracker, onTogglePin }: { tracker: TrackerRow; onTogglePin: (tracker: TrackerRow) => void }) {
  const { rule, pinned } = tracker;
  const [label, color] = statusOf(rule);
  const mark = <StatusMark label={label} color={color} pinned={pinned} />;

  return (
    // Not inline-flex: that row sits on the text's baseline, which moves with
    // what's in the mark and lifted the name of a pinned tracker.
    <span className={cx("flex items-center gap-2.5", !rule && FADED)}>
      {tracker.domain ? (
        // A plain button, since HeroUI's all have a background on hover. It's wider
        // than the mark: its negative margins give the room back, so the name stays
        // where it is.
        <span className="-mx-2.5 flex" title={`${label} · ${pinned ? "Unpin" : "Pin"} tracker`}>
          <button
            type="button"
            aria-label={`${pinned ? "Unpin" : "Pin"} ${tracker.name}, ${label}`}
            onClick={() => onTogglePin(tracker)}
            className="flex size-7 cursor-(--cursor-interactive) items-center justify-center rounded-md outline-none focus-visible:status-focused"
          >
            {mark}
          </button>
        </span>
      ) : (
        // A rule's own row has no domain to pin, so its mark is no button.
        <span title={label} className="flex">
          {mark}
        </span>
      )}
      <span>
        <span className="font-medium">{tracker.name}</span>{" "}
        <span className="text-muted tabular-nums">({tracker.torrents})</span>
      </span>
      {rule && !rule.enabled && <span className="text-muted">paused</span>}
    </span>
  );
}

interface RatioProps {
  totals: Pick<TrackerRow, "uploadedGiB" | "downloadedGiB">;
  // On a freeleech nothing downloaded counts, so the ratio has no end.
  freeleech: boolean;
}

function Ratio({ totals, freeleech }: RatioProps) {
  return (
    <Tooltip>
      <Tooltip.Trigger>
        <span className="cursor-help font-medium tabular-nums">{freeleech ? "∞" : formatRatio(ratioOf(totals))}</span>
      </Tooltip.Trigger>
      <Tooltip.Content>
        {freeleech
          ? "Downloads don't count during the freeleech"
          : `${formatGiB(totals.uploadedGiB)} up · ${formatGiB(totals.downloadedGiB)} down`}
      </Tooltip.Content>
    </Tooltip>
  );
}

// Distance to the next state change, in the bytes that move it there: what can
// still be downloaded before a hold, or what must be uploaded before a release.
function Buffer({ rule, held }: { rule: Rule; held: boolean }) {
  const bytes = formatGiB(held ? toReleaseOf(rule) : budgetOf(rule));
  const Arrow = held ? ArrowUp : ArrowDown;

  return (
    <Tooltip>
      <Tooltip.Trigger>
        <span className="inline-flex cursor-help items-center gap-1.5">
          <Arrow size={12} strokeWidth={2.5} aria-hidden className="text-muted" />
          {bytes}
          <span className="sr-only">{held ? "to upload until release" : "to download until hold"}</span>
        </span>
      </Tooltip.Trigger>
      <Tooltip.Content>{held ? `Upload ${bytes} more to release` : `Download ${bytes} more and it holds`}</Tooltip.Content>
    </Tooltip>
  );
}

// On a freeleech nothing downloaded counts, so there's no buffer to keep, on
// any tracker: it says so instead, at the user's request.
function FreeleechBuffer() {
  return (
    <Tooltip>
      <Tooltip.Trigger>
        <span className="cursor-help">Freeleech</span>
      </Tooltip.Trigger>
      <Tooltip.Content>Downloads don't count during the freeleech</Tooltip.Content>
    </Tooltip>
  );
}

function statusOf(rule: Rule | undefined): [label: string, color: string] {
  if (!rule) return ["No rule", "text-foreground"];
  if (!rule.enabled) return ["Paused", "text-foreground/30"];
  return rule.state === "held" ? ["Held", "text-danger"] : ["OK", "text-success"];
}

// HeroUI's Badge dot only sits on the corner of another element, so the status
// dots next to text are drawn here. A pin takes the dot's place and color: it
// overflows the dot's room instead of widening it, so the names line up whether
// a tracker is pinned or not.
function StatusMark({ label, color, pinned }: { label: string; color: string; pinned: boolean }) {
  return (
    <span className={cx("flex size-2 shrink-0 items-center justify-center", color)}>
      {pinned ? <Pin aria-hidden size={16} className="shrink-0" /> : <span aria-hidden className="size-2 rounded-full bg-current" />}
      <span className="sr-only">{label}</span>
    </span>
  );
}

function EventDot({ kind }: { kind: EventKind }) {
  const color = {
    hold: "bg-danger",
    release: "bg-success",
    rule: "bg-foreground/30",
    tracker: "bg-foreground/30",
    settings: "bg-foreground/30",
    error: "bg-warning",
  }[kind];
  return <span aria-hidden className={cx("size-1.5 shrink-0 rounded-full", color)} />;
}
