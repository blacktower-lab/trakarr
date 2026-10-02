import type { LucideIcon } from "lucide-react";
import { cx } from "../lib/cx";
import { useT } from "../lib/prefs";

export interface PageMenuItem {
  label: string;
  icon: LucideIcon;
}

interface PageMenuProps<T extends string> {
  label: string;
  items: Record<T, PageMenuItem>;
  current: T;
  onSelect: (id: T) => void;
}

// The app's own page menu, made at the user's request instead of HeroUI's
// tabs, after the one on HeroUI's docs: muted pages, and the current one in
// the text color with a line under it, also in the text color.
export function PageMenu<T extends string>({ label, items, current, onSelect }: PageMenuProps<T>) {
  const t = useT();
  return (
    <nav aria-label={label} className="overflow-x-auto">
      <ul className="flex w-max gap-5">
        {(Object.keys(items) as T[]).map((id) => {
          const { label: text, icon: Icon } = items[id];
          const selected = id === current;
          return (
            <li key={id}>
              <button
                type="button"
                aria-current={selected ? "page" : undefined}
                onClick={() => onSelect(id)}
                className={cx(
                  "relative flex cursor-(--cursor-interactive) items-center gap-2 rounded-md px-1 pb-3 pt-1 text-sm font-medium outline-none transition-colors focus-visible:status-focused motion-reduce:transition-none",
                  selected ? "text-foreground" : "text-muted hover:text-foreground",
                )}
              >
                {/* Narrow screens drop the icons so every page name fits. */}
                <Icon aria-hidden size={16} className="hidden sm:block" />
                {t(text)}
                {selected && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-foreground" />}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
