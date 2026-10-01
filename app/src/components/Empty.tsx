import { Card, EmptyState, Spinner } from "@heroui/react";
import { CircleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface ViewProps {
  // An icon, or a spinner while loading.
  media: ReactNode;
  title: string;
  description?: string;
}

// HeroUI's EmptyState is a bare muted box, so the icon, the title and the line
// under it go inside, with the title in the text color.
function View({ media, title, description }: ViewProps) {
  return (
    <EmptyState>
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        {media}
        <div className="flex flex-col gap-1">
          <span className="font-medium text-foreground">{title}</span>
          {description && <span>{description}</span>}
        </div>
      </div>
    </EmptyState>
  );
}

// What stands where there's nothing to list.
export function Empty({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description?: string }) {
  return <View media={<Icon aria-hidden className="size-6" />} title={title} description={description} />;
}

// What a page shows until its first load ends: why it failed, or that it's loading.
export function Pending({ error }: { error: Error | undefined }) {
  if (error) return <Empty icon={CircleAlert} title={error.message} />;
  return <View media={<Spinner size="md" color="current" />} title="Loading" />;
}

interface ListedProps {
  // False until the first load ends.
  loaded: boolean;
  error: Error | undefined;
  count: number;
  icon: LucideIcon;
  // Says there's nothing to list, and what would show up.
  empty: { title: string; description: string };
  // The table, shown only when it has rows.
  children: ReactNode;
}

// A table with rows, or an empty view in its place, on a card like the table's.
export function Listed({ loaded, error, count, icon, empty, children }: ListedProps) {
  if (loaded && count > 0) return children;
  return <Card>{loaded ? <Empty icon={icon} {...empty} /> : <Pending error={error} />}</Card>;
}
