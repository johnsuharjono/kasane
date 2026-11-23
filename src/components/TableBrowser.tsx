import { SelectField } from "./SelectField";
import { Input } from "./ui/input";
import { useEffect, useState } from "react";
import { useDelayed } from "../use-delayed";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  Columns3,
  Filter,
  LoaderCircle,
  Lock,
  X,
} from "lucide-react";
import { Button } from "./Button";
import { ExecutionView } from "./ExecutionView";
import {
  defaultTableSettings,
  pageFor,
  TABLE_PAGE_SIZE,
  tableCountQuery,
} from "../table-query";
import { usePreferences } from "../preferences";
import type { ColumnReference, Execution, Tab, TableSettings } from "../types";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
export function TableBrowser({
  tab,
  connected,
  connecting,
  onPreview,
  onExecute,
  count,
  onCancelCount,
  onOpenReference,
}: {
  tab: Tab;
  connected: boolean;
  connecting: boolean;
  onPreview: (settings: TableSettings) => void;
  onExecute: (settings: TableSettings) => void;
  count?: Execution;
  onCancelCount: () => void;
  onOpenReference: (reference: ColumnReference, value: string) => void;
}) {
  const settings = tab.tableSettings ?? defaultTableSettings;
  const [draft, setDraft] = useState(settings);
  // Filters can change from outside (following a foreign key); mirror them.
  useEffect(() => {
    setDraft(settings);
  }, [settings.filterColumn, settings.filterOperator, settings.filterValue]);
  const execution = tab.executions["table-data"];
  const { autoPreview } = usePreferences();
  const running = execution?.state === "running";
  const canPreview = !execution && !tab.disconnected && autoPreview;
  const loading = running || (canPreview && (connected || connecting));
  // Controls dim only for slow work; App's busy guard drops clicks meanwhile.
  const busy = useDelayed(running);
  const page = pageFor(settings),
    pageSize = TABLE_PAGE_SIZE;
  const validCount =
    count?.source === tableCountQuery(tab.relation!, settings) &&
    !count.outdated;
  const total =
    validCount && count.state === "success"
      ? count.result?.rows[0]?.[0]
      : undefined;
  const counting = useDelayed(validCount && count?.state === "running");
  const totalPages = total
    ? (BigInt(total) + BigInt(pageSize) - 1n) / BigInt(pageSize)
    : undefined;
  const fetched =
    execution?.state === "success" ? (execution.result?.rows.length ?? 0) : 0;
  useEffect(() => {
    if (connected && canPreview) onPreview(settings);
  }, [tab.id, connected, canPreview]);
  function sort(column: string) {
    if (running) return;
    const next = {
      ...settings,
      page: 0,
      sort:
        settings.sort?.column === column
          ? settings.sort.direction === "asc"
            ? { column, direction: "desc" as const }
            : undefined
          : { column, direction: "asc" as const },
    };
    onExecute(next);
  }
  const operatorLabel = {
    contains: "contains",
    equals: "equals",
    "is-null": "is null",
  }[settings.filterOperator];
  const hidden = settings.hiddenColumns ?? [];
  function setHidden(hiddenColumns: string[]) {
    onExecute({ ...settings, hiddenColumns });
  }
  function clearFilter() {
    const next = {
      ...defaultTableSettings,
      sort: settings.sort,
      hiddenColumns: settings.hiddenColumns,
    };
    setDraft(next);
    onExecute(next);
  }
  return (
    <div className="table-browser">
      <div className="table-toolbar">
        {tab.filtersOpen ? (
          <form
            className="table-filters"
            onSubmit={(e) => {
              e.preventDefault();
              onExecute({
                ...draft,
                page: 0,
                sort: settings.sort,
                hiddenColumns: settings.hiddenColumns,
              });
            }}
          >
            <Filter size={14} aria-hidden="true" />
            <SelectField
              label="Filter column"
              disabled={busy}
              aria-disabled={running}
              value={draft.filterColumn}
              onChange={(filterColumn) => setDraft({ ...draft, filterColumn })}
              options={[
                { value: "", label: "Choose column" },
                ...tab.relation!.columns.map((c) => ({
                  value: c.name,
                  label: c.name,
                })),
              ]}
            />
            <SelectField
              label="Filter operator"
              disabled={busy}
              aria-disabled={running}
              value={draft.filterOperator}
              onChange={(filterOperator) =>
                setDraft({
                  ...draft,
                  filterOperator:
                    filterOperator as TableSettings["filterOperator"],
                })
              }
              options={[
                { value: "contains", label: "contains" },
                { value: "equals", label: "equals" },
                { value: "is-null", label: "is null" },
              ]}
            />
            {draft.filterOperator !== "is-null" && (
              <Input
                aria-label="Filter value"
                placeholder="Value"
                disabled={busy}
                aria-disabled={running}
                value={draft.filterValue}
                onChange={(e) =>
                  setDraft({ ...draft, filterValue: e.target.value })
                }
              />
            )}
            <Button type="submit" disabled={busy || !draft.filterColumn}>
              Apply
            </Button>
            {settings.filterColumn && (
              <Button
                className="quiet icon"
                aria-label="Clear filter"
                disabled={busy}
                aria-disabled={running}
                onClick={clearFilter}
              >
                <X size={13} />
              </Button>
            )}
          </form>
        ) : (
          <span className="filter-summary">
            {settings.filterColumn ? (
              <>
                <Filter size={13} aria-hidden="true" />
                <code>{settings.filterColumn}</code> {operatorLabel}
                {settings.filterOperator !== "is-null" && (
                  <code>{settings.filterValue}</code>
                )}
              </>
            ) : (
              "All rows"
            )}
            {settings.sort && (
              <>
                <span aria-hidden="true">·</span>
                sorted by <code>{settings.sort.column}</code>{" "}
                {settings.sort.direction === "asc" ? "↑" : "↓"}
              </>
            )}
          </span>
        )}
        <span className="spacer" />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button className="quiet small" aria-label="Choose columns" />
            }
          >
            <Columns3 size={13} aria-hidden="true" />
            Columns {tab.relation!.columns.length - hidden.length}/
            {tab.relation!.columns.length}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 min-w-52">
            {tab.relation!.columns.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.name}
                closeOnClick={false}
                checked={!hidden.includes(c.name)}
                disabled={
                  !hidden.includes(c.name) &&
                  hidden.length === tab.relation!.columns.length - 1
                }
                onCheckedChange={(checked) =>
                  setHidden(
                    checked
                      ? hidden.filter((h) => h !== c.name)
                      : [...hidden, c.name],
                  )
                }
              >
                <span className="column-option">{c.name}</span>
              </DropdownMenuCheckboxItem>
            ))}
            {hidden.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setHidden([])}>
                  Show all columns
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="row-count" aria-live="polite">
          {total != null ? (
            <>
              <strong>{BigInt(total).toLocaleString()}</strong>{" "}
              {settings.filterColumn ? "rows match" : "rows"}
            </>
          ) : counting ? (
            "Counting…"
          ) : null}
        </span>
        {counting && (
          <Button className="quiet small" onClick={onCancelCount}>
            Cancel count
          </Button>
        )}
      </div>
      {loading ? (
        <div className="execution-empty" role="status">
          <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
          <span>Loading rows…</span>
        </div>
      ) : !execution ? (
        <div className="execution-empty">
          <span>Table ready.</span>
          <small>Refresh to load current data.</small>
        </div>
      ) : (
        <ExecutionView
          execution={execution}
          relation={tab.relation}
          onOpenReference={onOpenReference}
          rowOffset={page * pageSize}
          sort={settings.sort}
          onSort={sort}
        />
      )}
      {validCount && count?.state === "failed" && (
        <div className="table-count-error" role="alert">
          Count failed: {count.error?.message}
        </div>
      )}
      <div className="table-pagination" aria-label="Table pagination">
        <span className="read-only">
          <Lock size={12} aria-hidden="true" />
          Read-only
        </span>
        <span className="spacer" />
        <span className="page-range" aria-live="polite">
          {execution?.state === "success" && (
            <>
              {fetched
                ? `${(page * pageSize + 1).toLocaleString()}–${(page * pageSize + fetched).toLocaleString()}`
                : "0 rows"}
              {total != null && ` of ${BigInt(total).toLocaleString()} rows`}
            </>
          )}
        </span>
        <Button
          className="quiet icon"
          aria-label="First page"
          disabled={busy || tab.disconnected || page === 0}
          aria-disabled={running || tab.disconnected || page === 0}
          onClick={() => onExecute({ ...settings, page: 0 })}
        >
          <ChevronsLeft size={14} />
        </Button>
        <Button
          className="quiet icon"
          aria-label="Previous page"
          disabled={busy || tab.disconnected || page === 0}
          aria-disabled={running || tab.disconnected || page === 0}
          onClick={() => onExecute({ ...settings, page: page - 1 })}
        >
          <ChevronLeft size={14} />
        </Button>
        <span className="page-number">
          Page {(page + 1).toLocaleString()}
          {totalPages !== undefined && totalPages > 0n
            ? ` of ${totalPages.toLocaleString()}`
            : ""}
        </span>
        <Button
          className="quiet icon"
          aria-label="Next page"
          disabled={
            busy ||
            tab.disconnected ||
            !execution?.hasNextPage ||
            execution?.outdated
          }
          aria-disabled={
            running ||
            tab.disconnected ||
            !execution?.hasNextPage ||
            execution?.outdated
          }
          onClick={() => onExecute({ ...settings, page: page + 1 })}
        >
          <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  );
}
