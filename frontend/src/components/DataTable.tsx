import { useMemo, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Pagination } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type ColumnAlign = "left" | "right" | "center";

export interface Column<T> {
  /** Also the fallback property name when `render` is omitted. */
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  align?: ColumnAlign;
  /** Any CSS width — "10rem", "25%", "80px". Applied to a <col>-style style prop. */
  width?: string;
  sortable?: boolean;
  /** Hides the column below the `md` breakpoint. */
  hideOnMobile?: boolean;
}

export type SortDirection = "asc" | "desc";

export interface SortState {
  key: string;
  direction: SortDirection;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  /** Replaces the default "no records" panel. */
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  /** Current sort; pair with `onSortChange` to make headers interactive. */
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  pagination?: Pagination;
  onPageChange?: (page: number) => void;
  /** Extra classes per row — highlight overdue lines, dim cancelled ones. */
  rowClassName?: (row: T) => string | undefined;
  /** Totals row rendered inside <tfoot>, aligned with the columns. */
  footer?: ReactNode;
  /** Rows to fake while loading. Match the page size for a stable layout. */
  skeletonRows?: number;
  className?: string;
  /** Header stays put while the body scrolls. Needs a bounded height. */
  stickyHeader?: boolean;
  /** Caption for screen readers when the surrounding page has no heading. */
  ariaLabel?: string;
}

const ALIGN_CLASS: Record<ColumnAlign, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

function nextDirection(sort: SortState | undefined, key: string): SortDirection {
  // First click on a new column sorts ascending; clicking the active one flips.
  if (!sort || sort.key !== key) return "asc";
  return sort.direction === "asc" ? "desc" : "asc";
}

/**
 * Reads a column's value straight off the row when no `render` is given.
 * The cast is unavoidable: `key` is a free-form string so the caller can name a
 * computed column, and TS cannot prove it indexes T.
 */
function fallbackValue<T>(row: T, key: string): ReactNode {
  const value = (row as Record<string, unknown>)[key];
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/**
 * The one table component in the app. Horizontal overflow is contained here so
 * a wide report never makes the page body scroll sideways.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  empty,
  onRowClick,
  sort,
  onSortChange,
  pagination,
  onPageChange,
  rowClassName,
  footer,
  skeletonRows = 8,
  className,
  stickyHeader = false,
  ariaLabel,
}: DataTableProps<T>) {
  const skeletons = useMemo(() => Array.from({ length: skeletonRows }, (_, i) => i), [skeletonRows]);

  const showPager =
    pagination !== undefined && onPageChange !== undefined && pagination.total_pages > 1;

  const rangeStart = pagination ? (pagination.page - 1) * pagination.limit + 1 : 0;
  const rangeEnd = pagination ? Math.min(pagination.page * pagination.limit, pagination.total) : 0;

  return (
    <div className={cn("rounded-lg border bg-card", className)}>
      <div className={cn("scroll-x rounded-t-lg", stickyHeader && "max-h-[70vh] overflow-y-auto")}>
        <Table aria-label={ariaLabel}>
          <TableHeader className={cn(stickyHeader && "sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]")}>
            <TableRow className="hover:bg-transparent">
              {columns.map((column) => {
                const isSorted = sort?.key === column.key;
                const interactive = column.sortable === true && onSortChange !== undefined;
                const SortIcon = !isSorted ? ChevronsUpDown : sort.direction === "asc" ? ArrowUp : ArrowDown;

                return (
                  <TableHead
                    key={column.key}
                    style={column.width ? { width: column.width } : undefined}
                    className={cn(
                      ALIGN_CLASS[column.align ?? "left"],
                      column.hideOnMobile && "hidden md:table-cell",
                    )}
                    aria-sort={isSorted ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                  >
                    {interactive ? (
                      <button
                        type="button"
                        onClick={() => onSortChange({ key: column.key, direction: nextDirection(sort, column.key) })}
                        className={cn(
                          "-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground",
                          column.align === "right" && "flex-row-reverse",
                          isSorted && "text-foreground",
                        )}
                      >
                        {column.header}
                        <SortIcon className="h-3 w-3 opacity-60" aria-hidden />
                      </button>
                    ) : (
                      column.header
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>

          <TableBody>
            {loading &&
              skeletons.map((index) => (
                <TableRow key={`skeleton-${index}`} className="hover:bg-transparent">
                  {columns.map((column) => (
                    <TableCell
                      key={column.key}
                      className={cn(column.hideOnMobile && "hidden md:table-cell")}
                    >
                      <Skeleton
                        className={cn("h-4", column.align === "right" ? "ml-auto w-16" : "w-full max-w-[10rem]")}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}

            {!loading && rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="p-0">
                  {empty ?? (
                    <EmptyState
                      title="Nothing here yet"
                      description="No records match the current filters."
                    />
                  )}
                </TableCell>
              </TableRow>
            )}

            {!loading &&
              rows.map((row) => (
                <TableRow
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                  role={onRowClick ? "button" : undefined}
                  className={cn(
                    onRowClick && "cursor-pointer focus-visible:bg-muted/60",
                    rowClassName?.(row),
                  )}
                >
                  {columns.map((column) => (
                    <TableCell
                      key={column.key}
                      className={cn(
                        ALIGN_CLASS[column.align ?? "left"],
                        column.hideOnMobile && "hidden md:table-cell",
                      )}
                    >
                      {column.render ? column.render(row) : fallbackValue(row, column.key)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
          </TableBody>

          {footer && !loading && rows.length > 0 && (
            <TableFooter>
              <TableRow className="hover:bg-transparent">{footer}</TableRow>
            </TableFooter>
          )}
        </Table>
      </div>

      {pagination && (rows.length > 0 || loading) && (
        <div className="flex flex-col gap-2 border-t px-3 py-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p className="tabular">
            {pagination.total === 0
              ? "No records"
              : `${rangeStart}–${rangeEnd} of ${pagination.total}`}
          </p>

          {showPager && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page <= 1 || loading}
                onClick={() => onPageChange(pagination.page - 1)}
              >
                <ChevronLeft />
                Previous
              </Button>
              <span className="tabular px-1">
                Page {pagination.page} of {pagination.total_pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page >= pagination.total_pages || loading}
                onClick={() => onPageChange(pagination.page + 1)}
              >
                Next
                <ChevronRight />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
