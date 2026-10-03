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
  Infinity as InfinityIcon,
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
import { useState } from "react";
import { AuthGate } from "./components/AuthGate";
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
import { LOCALES, msg } from "./lib/i18n";
import { PrefsProvider, SettingsProvider, useFormat, usePrefs, useT } from "./lib/prefs";
import {
  budgetOf,
  filterTrackers,
  freeleechLeft,
  gaugeOf,
  mergeRules,
  minutesSince,
  pinnedFirst,
  ratioOf,
  sortTrackers,
  thresholdsOf,
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
  dashboard: { label: msg("Dashboard"), icon: LayoutDashboard },
  rules: { label: msg("Rules"), icon: SlidersHorizontal },
  logs: { label: msg("Logs"), icon: ScrollText },
  settings: { label: msg("Settings"), icon: SettingsIcon },
};

const PAGE_X = "px-4 md:px-8 lg:px-10";

export function App() {
  return (
    <PrefsProvider>
      <Localized />
    </PrefsProvider>
  );
}

function Localized() {
  const { prefs } = usePrefs();

  return (
    // HeroUI's own text and number fields follow the chosen language, so ratios
    // are shown and typed the way the rest of the page shows them.
    <I18nProvider locale={LOCALES[prefs.language]}>
      <AuthGate>
        <SettingsProvider>
          <Shell />
        </SettingsProvider>
      </AuthGate>
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
  const t = useT();
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
      toast.danger(t("Couldn't save {name}", { name: fields.name }), { description: (error as Error).message });
      return;
    }
    setEditorOpen(false);
    live.refresh();
    toast.success(rule ? t("{name} saved", { name: fields.name }) : t("{name} added", { name: fields.name }));
  };

  const deleteRule = async (rule: Rule) => {
    try {
      await api.deleteRule(rule.id);
    } catch (error) {
      toast.danger(t("Couldn't delete {name}", { name: rule.name }), { description: (error as Error).message });
      return;
    }
    live.refresh();
    toast(t("{name} deleted", { name: rule.name }));
  };

  // The tracker whose quota is being changed.
  const [quota, setQuota] = useState<{ tracker?: TrackerRow; session: number }>({ session: 0 });
  const [quotaOpen, setQuotaOpen] = useState(false);
  // Its row from the last poll, so the dialog follows a purchase saved elsewhere.
  // The one it opened with stays while the dialog animates closed.
  const quotaTracker =
    trackerRows(data?.rules ?? [], data?.status.trackers ?? []).find((row) => row.key === quota.tracker?.key) ?? quota.tracker;

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
      toast.danger(t("Couldn't change {domain}'s quota", { domain }), { description: (error as Error).message });
      return;
    }
    setQuotaOpen(false);
    live.refresh();
    toast.success(t("{domain} quota saved", { domain }));
  };

  const togglePin = async (tracker: TrackerRow) => {
    const { domain } = tracker;
    if (!domain) return;
    const pinned = !tracker.pinned;
    try {
      await api.updateTracker(domain, { pinned });
    } catch (error) {
      toast.danger(pinned ? t("Couldn't pin {domain}", { domain }) : t("Couldn't unpin {domain}", { domain }), {
        description: (error as Error).message,
      });
      return;
    }
    live.refresh();
    toast(pinned ? t("{domain} pinned", { domain }) : t("{domain} unpinned", { domain }));
  };

  const toggleEnabled = async (rule: Rule) => {
    const enabled = !rule.enabled;
    try {
      await api.updateRule(rule.id, { enabled });
    } catch (error) {
      toast.danger(
        enabled ? t("Couldn't resume {name}", { name: rule.name }) : t("Couldn't pause {name}", { name: rule.name }),
        { description: (error as Error).message },
      );
      return;
    }
    live.refresh();
    toast(enabled ? t("{name} resumed", { name: rule.name }) : t("{name} paused", { name: rule.name }));
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
        </div>
        <div className={cx("mx-auto max-w-[1400px] pt-6", PAGE_X)}>
          <PageMenu label={t("Pages")} items={PAGES} current={page} onSelect={setPage} />
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
        tracker={quotaTracker}
        session={quota.session}
        onOpenChange={setQuotaOpen}
        onSave={saveQuota}
      />
    </div>
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
  const t = useT();
  const format = useFormat();
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
        title={t("Trackers")}
        action={
          rows.length > 0 && (
            // The input won't shrink below its own width, which is larger on a
            // phone, so anything narrower clips the clear button.
            <div className="w-64">
              <SearchField
                aria-label={t("Filter trackers")}
                fullWidth
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  setTrackerPage(1);
                }}
              >
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder={t("Filter by name")} />
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
              ? { title: t("No matching trackers"), description: t("Try another name") }
              : {
                  title: t("No trackers yet"),
                  description: live?.status.qbittorrent.ok
                    ? t("qBittorrent has no torrents")
                    : t("They show up once qBittorrent connects"),
                }
          }
        >
          <Table>
            {/* Sizes the columns from their widths, so sorting never moves them. */}
            <Table.ResizableContainer>
              <Table.Content
                aria-label={t("Trackers")}
                sortDescriptor={sort}
                onSortChange={(next) => {
                  setSort(next);
                  setTrackerPage(1);
                }}
              >
                <Table.Header>
                  <SortableColumn id="name" isRowHeader width="1fr" minWidth={260}>
                    {t("Tracker")}
                  </SortableColumn>
                  <SortableColumn id="ratio" width={120} hint={t("Uploaded over downloaded")}>
                    {t("Ratio")}
                  </SortableColumn>
                  <SortableColumn id="downloaded" width={360} hint={t("Downloaded against what its upload allows")}>
                    {t("Downloaded")}
                  </SortableColumn>
                  <SortableColumn id="buffer" width={180} hint={t("Left before the next hold or release")}>
                    {t("Buffer")}
                  </SortableColumn>
                  <Table.Column textValue={t("Actions")} width={72}>
                    <span className="sr-only">{t("Actions")}</span>
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
                            <Ratio
                              totals={tracker}
                              rule={gaugeOf(tracker)}
                              freeleech={freeleechLeft(tracker.freeleech) > 0}
                            />
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          <UsageBar
                            rule={gaugeOf(tracker)}
                            faded={!rule}
                            limited={!!rule}
                            freeleechLeft={freeleechLeft(tracker.freeleech)}
                          />
                        </Table.Cell>
                        <Table.Cell>
                          {freeleechLeft(tracker.freeleech) > 0 ? (
                            <span className={cx(!rule && FADED)}>
                              <FreeleechBuffer />
                            </span>
                          ) : rule ? (
                            rule.enabled && <Buffer rule={rule} held={rule.state === "held"} />
                          ) : (
                            <span className={FADED}>
                              <NoBuffer />
                            </span>
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
                  label={t("Trackers pages")}
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

      <Section title={t("Held torrents")}>
        <Listed
          loaded={!!live}
          error={error}
          count={held.length}
          icon={CircleCheck}
          empty={{ title: t("Nothing is held"), description: t("Downloads a rule holds show up here") }}
        >
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label={t("Held torrents")}>
                <Table.Header>
                  <Table.Column isRowHeader>{t("Torrent")}</Table.Column>
                  <Table.Column>{t("Tracker")}</Table.Column>
                  <Table.Column>{t("Progress")}</Table.Column>
                  <Table.Column>{t("Held")}</Table.Column>
                </Table.Header>
                <Table.Body>
                  {held.map((torrent) => (
                    <Table.Row key={torrent.hash} id={torrent.hash}>
                      <Table.Cell>{torrent.name}</Table.Cell>
                      <Table.Cell>{rules.find((r) => r.id === torrent.ruleId)?.name ?? "—"}</Table.Cell>
                      <Table.Cell>{progressOf(torrent)}</Table.Cell>
                      <Table.Cell>{format.ago(minutesSince(torrent.at))}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Listed>
      </Section>

      <Section
        title={t("Recent events")}
        action={
          <Button variant="ghost" size="sm" onPress={onShowLogs}>
            {t("Open logs")}
          </Button>
        }
      >
        <Listed
          loaded={!!live}
          error={error}
          count={events.length}
          icon={History}
          empty={{ title: t("No events yet"), description: t("Holds, releases and changes show up here") }}
        >
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label={t("Recent events")}>
                <Table.Header>
                  <Table.Column>{t("Time")}</Table.Column>
                  <Table.Column isRowHeader>{t("Event")}</Table.Column>
                </Table.Header>
                <Table.Body>
                  {events.map((event) => (
                    <Table.Row key={event.id} id={event.id}>
                      <Table.Cell>{format.when(event.at)}</Table.Cell>
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
  const t = useT();
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
                <Tooltip.Trigger aria-label={t("About {name}", { name: children })}>
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
  const t = useT();
  const { rule } = tracker;
  const perDomain: RowAction[] = tracker.domain
    ? [
        { id: "quota", label: t("Change quota"), icon: Coins },
        tracker.pinned
          ? { id: "pin", label: t("Unpin tracker"), icon: PinOff }
          : { id: "pin", label: t("Pin tracker"), icon: Pin },
      ]
    : [];
  const items: RowAction[] = rule
    ? [
        { id: "edit", label: t("Edit rule"), icon: Pencil },
        ...perDomain,
        {
          id: "toggle",
          label: rule.enabled ? t("Pause rule") : t("Resume rule"),
          icon: rule.enabled ? Pause : Play,
          danger: rule.enabled,
        },
      ]
    : [{ id: "add", label: t("Add rule"), icon: Plus }, ...perDomain];

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

  return <RowActions label={t("Actions for {name}", { name: tracker.name })} items={items} onAction={act} />;
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
  const t = useT();
  const { rule, pinned } = tracker;
  const [status, color] = statusOf(rule);
  const label = t(status);
  const mark = <StatusMark label={label} color={color} pinned={pinned} />;

  return (
    // Not inline-flex: that row sits on the text's baseline, which moves with
    // what's in the mark and lifted the name of a pinned tracker.
    <span className={cx("flex items-center gap-2.5", !rule && FADED)}>
      {tracker.domain ? (
        // A plain button, since HeroUI's all have a background on hover. It's wider
        // than the mark: its negative margins give the room back, so the name stays
        // where it is.
        <span className="-mx-2.5 flex" title={`${label} · ${pinned ? t("Unpin tracker") : t("Pin tracker")}`}>
          <button
            type="button"
            aria-label={
              pinned
                ? t("Unpin {name}, {status}", { name: tracker.name, status: label })
                : t("Pin {name}, {status}", { name: tracker.name, status: label })
            }
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
      {rule && !rule.enabled && <span className="text-muted">{t("paused")}</span>}
    </span>
  );
}

interface RatioProps {
  totals: Pick<TrackerRow, "uploadedGiB" | "downloadedGiB">;
  // What measures the tracker, for the ratio its tooltip names.
  rule: Rule;
  // On a freeleech nothing downloaded counts, so the ratio has no end.
  freeleech: boolean;
}

// The tooltip names the ratio the tracker is held or released at. Without an
// enabled rule nothing holds it, so it says what would.
function Ratio({ totals, rule, freeleech }: RatioProps) {
  const t = useT();
  const format = useFormat();
  const held = rule.enabled && rule.state === "held";
  const { holdBelow, releaseAbove } = thresholdsOf(rule);
  return (
    <Tooltip>
      <Tooltip.Trigger>
        <span className="cursor-help font-medium tabular-nums">{freeleech ? "∞" : format.ratio(ratioOf(totals))}</span>
      </Tooltip.Trigger>
      <Tooltip.Content>
        {freeleech
          ? t("Downloads don't count during the freeleech")
          : held
            ? t("Releases above a {ratio} ratio", { ratio: format.ratio(releaseAbove) })
            : rule.enabled
              ? t("Holds below a {ratio} ratio", { ratio: format.ratio(holdBelow) })
              : t("Would hold below a {ratio} ratio", { ratio: format.ratio(holdBelow) })}
      </Tooltip.Content>
    </Tooltip>
  );
}

// Distance to the next state change, in the bytes that move it there: what can
// still be downloaded before a hold, or what must be uploaded before a release.
function Buffer({ rule, held }: { rule: Rule; held: boolean }) {
  const t = useT();
  const bytes = useFormat().gib(held ? toReleaseOf(rule) : budgetOf(rule));
  const Arrow = held ? ArrowUp : ArrowDown;

  return (
    <Tooltip>
      <Tooltip.Trigger>
        <span className="inline-flex cursor-help items-center gap-1.5">
          <Arrow size={12} strokeWidth={2.5} aria-hidden className="text-muted" />
          {bytes}
          <span className="sr-only">{held ? t("to upload until release") : t("to download until hold")}</span>
        </span>
      </Tooltip.Trigger>
      <Tooltip.Content>
        {held ? t("Upload {bytes} more to release", { bytes }) : t("Download {bytes} more and it holds", { bytes })}
      </Tooltip.Content>
    </Tooltip>
  );
}

// A tracker with no rule has no limit, so it has no buffer to keep: it shows
// as infinite, at the user's request.
function NoBuffer() {
  const t = useT();
  return (
    <span className="inline-flex items-center">
      <InfinityIcon size={16} strokeWidth={2.5} aria-hidden />
      <span className="sr-only">{t("No limit")}</span>
    </span>
  );
}

// On a freeleech nothing downloaded counts, so there's no buffer to keep, on
// any tracker: it says so instead, at the user's request.
function FreeleechBuffer() {
  const t = useT();
  return (
    <Tooltip>
      <Tooltip.Trigger>
        <span className="cursor-help">{t("Freeleech")}</span>
      </Tooltip.Trigger>
      <Tooltip.Content>{t("Downloads don't count during the freeleech")}</Tooltip.Content>
    </Tooltip>
  );
}

// The label is translated where it's shown.
function statusOf(rule: Rule | undefined): [label: string, color: string] {
  if (!rule) return [msg("No rule"), "text-foreground"];
  if (!rule.enabled) return [msg("Paused"), "text-foreground/30"];
  return rule.state === "held" ? [msg("Held"), "text-danger"] : [msg("OK"), "text-success"];
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
