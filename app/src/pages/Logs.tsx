import {
  Button,
  Card,
  SearchField,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  toast,
} from "@heroui/react";
import { Copy, ScrollText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Empty, Pending } from "../components/Empty";
import { api, type LogLevel, type LogLine } from "../lib/api";
import { formatTime } from "../lib/data";

const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

// Each option shows its level and everything more severe.
const LEVEL_FILTER: Record<LogLevel, string> = {
  debug: "All",
  info: "Info",
  warn: "Warn",
  error: "Error",
};

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: "text-muted",
  info: "text-muted",
  warn: "text-warning",
  error: "text-danger",
};

const POLL_MS = 5000;
const MAX_LINES = 500;

function formatFields(line: LogLine, separator: string): string {
  return Object.entries(line.fields ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join(separator);
}

function formatLine(line: LogLine): string {
  const fields = formatFields(line, " ");
  return `${formatTime(line.at)} ${line.level.toUpperCase().padEnd(5)} [${line.scope}] ${line.message}${fields ? ` ${fields}` : ""}`;
}

async function copyText(text: string): Promise<boolean> {
  // navigator.clipboard only exists on HTTPS or localhost, so fall back to a
  // hidden textarea when the page is opened by its LAN address.
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea copy.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  return copied;
}

export function Logs() {
  // Undefined until the first load ends.
  const [lines, setLines] = useState<LogLine[]>();
  const [error, setError] = useState<Error>();
  const [minLevel, setMinLevel] = useState<LogLevel>("info");
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);

  // Loads the newest lines at the chosen level, and while Live is on asks
  // every 5 s for the ones that came after the last it has.
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let lastId = 0;

    async function tail() {
      try {
        const next = await api.logs({ level: minLevel, limit: MAX_LINES, after: lastId });
        if (!active) return;
        if (next.length > 0) {
          lastId = next[next.length - 1].id;
          setLines((current) => [...(current ?? []), ...next].slice(-MAX_LINES));
        }
      } catch {
        // The lines stay as they are, and the next ask tries again.
      }
      if (active) timer = window.setTimeout(tail, POLL_MS);
    }

    async function load() {
      try {
        const loaded = await api.logs({ level: minLevel, limit: MAX_LINES });
        if (!active) return;
        setLines(loaded);
        setError(undefined);
        lastId = loaded.length > 0 ? loaded[loaded.length - 1].id : 0;
      } catch (error) {
        if (!active) return;
        setError(error as Error);
      }
      if (follow) timer = window.setTimeout(tail, POLL_MS);
    }

    void load();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [minLevel, follow]);

  // The server filters by level, so only the text search is left.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (lines ?? []).filter((line) => !needle || formatLine(line).toLowerCase().includes(needle));
  }, [lines, query]);

  // Keep the newest line in view while following.
  useEffect(() => {
    const el = scroller.current;
    if (follow && el) el.scrollTop = el.scrollHeight;
  }, [visible, follow]);

  const copy = async () => {
    const copied = await copyText(visible.map(formatLine).join("\n"));
    if (copied) toast.success(`Copied ${visible.length} lines`);
    else toast.danger("Couldn't copy the logs", { description: "Select the lines and copy them by hand." });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <ToggleButtonGroup
          aria-label="Lowest level shown"
          size="sm"
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[minLevel]}
          onSelectionChange={(keys) => setMinLevel([...keys][0] as LogLevel)}
        >
          {LEVELS.map((level, i) => (
            <ToggleButton key={level} id={level}>
              {i > 0 && <ToggleButtonGroup.Separator />}
              {LEVEL_FILTER[level]}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <div className="w-full sm:w-72">
          <SearchField aria-label="Filter logs" fullWidth value={query} onChange={setQuery}>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Filter" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Switch isSelected={follow} onChange={setFollow}>
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              Live
            </Switch.Content>
          </Switch>
          <Tooltip>
            <Button
              isIconOnly
              variant="ghost"
              aria-label="Copy visible lines"
              onPress={copy}
              isDisabled={visible.length === 0}
            >
              <Copy aria-hidden />
            </Button>
            <Tooltip.Content>Copy visible lines</Tooltip.Content>
          </Tooltip>
        </div>
      </div>

      <Card>
        <div ref={scroller} role="log" className="max-h-[70vh] overflow-y-auto">
          {visible.length > 0 ? (
            <div className="font-mono text-xs leading-6">
              {visible.map((line) => (
                <LogRow key={line.id} line={line} />
              ))}
            </div>
          ) : lines ? (
            <Empty icon={ScrollText} title="No matching lines" description="Try another level or filter" />
          ) : (
            <Pending error={error} />
          )}
        </div>
      </Card>
    </div>
  );
}

function LogRow({ line }: { line: LogLine }) {
  const fields = formatFields(line, "  ");

  return (
    <div className="grid grid-cols-[auto_auto_1fr] gap-x-4 sm:grid-cols-[4.5rem_3rem_4.5rem_1fr]">
      <span className="tabular-nums text-muted">{formatTime(line.at).slice(0, 8)}</span>
      <span className={LEVEL_COLOR[line.level]}>{line.level}</span>
      <span className="text-muted">{line.scope}</span>
      <span className="col-span-3 min-w-0 break-words sm:col-span-1">
        {line.message}
        {fields && <span className="ml-3 text-muted">{fields}</span>}
      </span>
    </div>
  );
}
