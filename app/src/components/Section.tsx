import { Typography } from "@heroui/react";
import type { ReactNode } from "react";

// A page section: a title with an optional action on its right, then the content.
// The action drops under the title when they don't fit. The title is HeroUI's
// smallest heading, which renders as an h6.
export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
        <Typography type="h6">{title}</Typography>
        {action}
      </div>
      {children}
    </section>
  );
}
