import { Pagination } from "@heroui/react";

interface PagerProps {
  // Names the pages, like "Trackers pages".
  label: string;
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}

// A table's pages, laid out as in HeroUI's docs: what's shown on the left,
// the pages on the right.
export function Pager({ label, page, pageSize, total, onChange }: PagerProps) {
  const pages = pageCount(total, pageSize);
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <Pagination size="sm" aria-label={label}>
      <Pagination.Summary>
        {first}–{last} of {total}
      </Pagination.Summary>
      <Pagination.Content>
        <Pagination.Item>
          <Pagination.Previous isDisabled={page === 1} onPress={() => onChange(page - 1)}>
            <Pagination.PreviousIcon />
            Prev
          </Pagination.Previous>
        </Pagination.Item>
        {pageList(page, pages).map((n, i) =>
          n === null ? (
            <Pagination.Item key={`gap-${i}`}>
              <Pagination.Ellipsis />
            </Pagination.Item>
          ) : (
            <Pagination.Item key={n}>
              <Pagination.Link isActive={n === page} onPress={() => onChange(n)}>
                {n}
              </Pagination.Link>
            </Pagination.Item>
          ),
        )}
        <Pagination.Item>
          <Pagination.Next isDisabled={page === pages} onPress={() => onChange(page + 1)}>
            Next
            <Pagination.NextIcon />
          </Pagination.Next>
        </Pagination.Item>
      </Pagination.Content>
    </Pagination>
  );
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

// Every page when there are few. Otherwise the first, the last and the ones
// around the current page, with null where pages are left out.
function pageList(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const from = Math.max(2, Math.min(page - 1, pages - 4));
  const to = Math.min(pages - 1, Math.max(page + 1, 5));
  const middle = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return [1, ...(from > 2 ? [null] : []), ...middle, ...(to < pages - 1 ? [null] : []), pages];
}
