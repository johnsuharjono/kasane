import { SelectField } from "./SelectField";
import { Input } from "./ui/input";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, X } from "lucide-react";
import { Button } from "./Button";
import { ExecutionView } from "./ExecutionView";
import {
  defaultTableSettings,
  pageFor,
  TABLE_PAGE_SIZE,
  tableCountQuery,
} from "../table-query";
import { usePreferences } from "../preferences";
import type { Tab, TableSettings } from "../types";
export function TableBrowser({
  tab,
  onExecute,
  onCount,
}: {
  tab: Tab;
  onExecute: (settings: TableSettings) => void;
  onCount: () => void;
}) {
  const settings = tab.tableSettings ?? defaultTableSettings;
  const [draft, setDraft] = useState(settings);
  const execution = tab.executions["table-data"];
  const { autoPreview } = usePreferences();
  const running = Object.values(tab.executions).some(
    (e) => e.state === "running",
  );
  const page = pageFor(settings),
    pageSize = TABLE_PAGE_SIZE;
  const count = tab.executions["table-count"];
  const validCount =
    count?.source === tableCountQuery(tab.relation!, settings) &&
    !count.outdated;
  const total =
    validCount && count.state === "success"
      ? count.result?.rows[0]?.[0]
      : undefined;
  const totalPages = total
    ? (BigInt(total) + BigInt(pageSize) - 1n) / BigInt(pageSize)
    : undefined;
  const fetched =
    execution?.state === "success" ? (execution.result?.rows.length ?? 0) : 0;
  useEffect(() => {
    if (!execution && !tab.disconnected && !tab.restored && autoPreview)
      onExecute(settings);
  }, [tab.id]);
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
  return (
    <div className="table-browser">
      {tab.filtersOpen && (
        <form
          className="table-filters"
          onSubmit={(e) => {
            e.preventDefault();
            onExecute({ ...draft, page: 0, sort: settings.sort });
          }}
        >
          <span>Filter</span>
          <SelectField
            label="Filter column"
            disabled={running}
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
            disabled={running}
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
              disabled={running}
              value={draft.filterValue}
              onChange={(e) =>
                setDraft({ ...draft, filterValue: e.target.value })
              }
            />
          )}
          <Button type="submit" disabled={running || !draft.filterColumn}>
            Apply
          </Button>
          {settings.filterColumn && (
            <Button
              className="quiet icon"
              aria-label="Clear filter"
              disabled={running}
              onClick={() => {
                const next = {
                  ...defaultTableSettings,
                  sort: settings.sort,
                };
                setDraft(next);
                onExecute(next);
              }}
            >
              <X size={13} />
            </Button>
          )}
        </form>
      )}
      {!execution && (tab.restored || !autoPreview) ? (
        <div className="execution-empty">
          <span>{tab.restored ? "Table restored." : "Table ready."}</span>
          <small>Refresh to load current data.</small>
        </div>
      ) : (
        <ExecutionView
          execution={execution}
          rowOffset={page * pageSize}
          sort={settings.sort}
          onSort={running ? undefined : sort}
        />
      )}
      {validCount && count?.state === "failed" && (
        <div className="table-count-error" role="alert">
          Count failed: {count.error?.message}
        </div>
      )}
      <div className="table-pagination" aria-label="Table pagination">
        <span className="page-range" aria-live="polite">
          {fetched
            ? `${(page * pageSize + 1).toLocaleString()}–${(page * pageSize + fetched).toLocaleString()}`
            : "0 rows"}
          {total !== undefined &&
            total !== null &&
            ` of ${BigInt(total).toLocaleString()} rows`}
        </span>
        <Button
          className="quiet small"
          onClick={onCount}
          disabled={running || tab.disconnected}
          title="Count rows matching the current filter. This can scan a large table."
        >
          {count?.state === "running"
            ? "Counting…"
            : total != null
              ? "Recount"
              : "Count rows"}
        </Button>
        <span className="spacer" />
        <Button
          className="quiet icon"
          aria-label="First page"
          disabled={running || tab.disconnected || page === 0}
          onClick={() => onExecute({ ...settings, page: 0 })}
        >
          <ChevronsLeft size={14} />
        </Button>
        <Button
          className="quiet icon"
          aria-label="Previous page"
          disabled={running || tab.disconnected || page === 0}
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
