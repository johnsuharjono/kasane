import { useEffect, useMemo, useState } from "react";
import { TableCellEditor, TableInlineEditor } from "./TableCellEditor";
import { TableChanges } from "./TableChanges";
import { SelectField } from "./SelectField";
import { Input } from "./ui/input";
import { rowEditKey, tableEditUnavailable } from "../table-edits";
import { TableFilterControl, TableSortControl } from "./TableQueryControls";
import { useDelayed } from "../use-delayed";
import {
  ChevronLeft,
  ChevronRight,
  Columns3,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react";
import { Button } from "./Button";
import { ExecutionView } from "./ExecutionView";
import {
  activeTableFilters,
  defaultTableSettings,
  pageFor,
  pageSizeFor,
  TABLE_PAGE_SIZES,
  tableCountQuery,
} from "../table-query";
import { usePreferences } from "../preferences";
import type {
  ColumnReference,
  Execution,
  RowIdentity,
  Tab,
  TableCellEdit,
  TableEdit,
  TableRowEdit,
  TableSettings,
} from "../types";
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
  onRefresh,
  onEditChange,
  onApplyEdits,
  count,
  onCancelCount,
  onOpenReference,
}: {
  tab: Tab;
  connected: boolean;
  connecting: boolean;
  onPreview: (settings: TableSettings) => void;
  onExecute: (settings: TableSettings) => void;
  onRefresh: () => void;
  onEditChange: (edit: TableEdit | undefined) => void;
  onApplyEdits: () => void;
  count?: Execution;
  onCancelCount: () => void;
  onOpenReference: (reference: ColumnReference, value: string) => void;
}) {
  const settings = tab.tableSettings ?? defaultTableSettings;
  const relation = tab.relation!;
  const filters = activeTableFilters(relation, settings);
  const columns = [
    { value: "", label: "Choose column" },
    ...relation.columns.map(({ name }) => ({ value: name, label: name })),
  ];
  const execution = tab.executions["table-data"];
  const { autoPreview } = usePreferences();
  const running = execution?.state === "running";
  const edit = tab.tableEdit;
  const [editor, setEditor] = useState<{
    row: number;
    column: number;
    requestId: string;
    anchor: HTMLElement;
    fullValue?: string | null;
  }>();
  const editUnavailable = tableEditUnavailable(relation);
  const editBusy = running || !!edit?.applying;
  const sameSession = !edit?.sessionId || edit.sessionId === tab.sessionId;
  const reviewOpen = !!edit?.reviewOpen && !!edit.rows.length;
  const stagedCount =
    edit?.rows.reduce((count, row) => count + row.cells.length, 0) ?? 0;
  const stagedRows = useMemo(
    () => new Map(edit?.rows.map((row) => [rowEditKey(row), row])),
    [edit?.rows],
  );
  const editable = new Map(
    relation.columns
      .filter(
        (column) => column.canUpdate && column.primaryKeyPosition === undefined,
      )
      .map((column) => [column.name, column]),
  );
  const gridExecution = useMemo(() => {
    const result = execution?.result;
    const identities = execution?.rowIdentities;
    if (!result || !identities || !stagedRows.size || !sameSession)
      return execution;
    const rows = result.rows.map((row, i) => {
      const draft = stagedRows.get(rowEditKey(identities[i]));
      if (!draft) return row;
      const cells = new Map(
        draft.cells.map((cell) => [cell.column, cell.value]),
      );
      return row.map((value, j) => {
        const column = result.columns[j].name;
        return cells.has(column) ? cells.get(column)! : value;
      });
    });
    return { ...execution, result: { ...result, rows } };
  }, [execution, stagedRows, sameSession]);
  function stagedRow(row: number) {
    const identity = execution?.rowIdentities?.[row];
    return identity && sameSession
      ? stagedRows.get(rowEditKey(identity))
      : undefined;
  }
  function canEdit(row: number, column: string) {
    return (
      !editUnavailable &&
      !editBusy &&
      sameSession &&
      !tab.disconnected &&
      execution?.editSessionId === tab.sessionId &&
      !execution?.outdated &&
      !!execution?.rowIdentities?.[row] &&
      editable.has(column)
    );
  }
  function updateCell(
    identity: RowIdentity,
    column: string,
    change?: TableCellEdit,
  ) {
    const id = rowEditKey(identity);
    const existing = stagedRows.get(id);
    const cells =
      existing?.cells.filter((cell) => cell.column !== column) ?? [];
    if (change) cells.push(change);
    const nextRow: TableRowEdit = { ...(existing ?? identity), cells };
    const rows = (edit?.rows ?? []).flatMap((row) =>
      rowEditKey(row) === id ? (cells.length ? [nextRow] : []) : [row],
    );
    if (!existing && cells.length) rows.push(nextRow);
    onEditChange(
      rows.length
        ? {
            rows,
            sessionId: edit?.sessionId ?? tab.sessionId,
            reviewOpen: !!edit?.reviewOpen,
          }
        : undefined,
    );
  }
  function stage(value: string | null) {
    if (
      !editor ||
      !execution?.result ||
      editor.requestId !== execution.requestId
    )
      return;
    const column = execution.result.columns[editor.column].name;
    const identity = execution.rowIdentities?.[editor.row];
    if (!identity || !canEdit(editor.row, column)) return;
    const existing = stagedRow(editor.row);
    const previous = existing?.cells.find((cell) => cell.column === column);
    const before = previous
      ? previous.before
      : execution.result.rows[editor.row][editor.column];
    setEditor(undefined);
    if (!previous && value === before) return;
    if (
      value !== before &&
      edit &&
      existing &&
      (existing.version !== identity.version ||
        existing.tuple !== identity.tuple)
    ) {
      onEditChange({
        ...edit,
        error: {
          message:
            "This row changed in PostgreSQL. Undo its staged changes before editing the refreshed row.",
        },
      });
      return;
    }
    updateCell(
      identity,
      column,
      value === before ? undefined : { column, before, value },
    );
  }
  const editorColumn =
    editor &&
    editable.get(execution?.result?.columns[editor.column]?.name ?? "");
  const activeEditor =
    editor && editorColumn && execution?.requestId === editor.requestId
      ? editor
      : undefined;
  const canPreview = !execution && !tab.disconnected && autoPreview;
  const loading = running || (canPreview && (connected || connecting));
  // Controls dim only for slow work; App's busy guard drops clicks meanwhile.
  const busy = useDelayed(running) || !!edit?.applying;
  const [pageDraft, setPageDraft] = useState<string>();
  const page = pageFor(settings),
    pageSize = pageSizeFor(settings);
  const validCount =
    count?.source === tableCountQuery(relation, settings) && !count.outdated;
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
    if (editBusy) return;
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
  const activeValue =
    activeEditor && gridExecution?.result
      ? gridExecution.result.rows[activeEditor.row][activeEditor.column]
      : undefined;
  const jsonEditor = editorColumn && /^jsonb?$/.test(editorColumn.type);
  const fullEditor =
    activeEditor &&
    (jsonEditor ||
      activeEditor.fullValue !== undefined ||
      activeValue === null ||
      (typeof activeValue === "string" && /[\r\n]/.test(activeValue)));
  const hidden = settings.hiddenColumns ?? [];
  function setHidden(hiddenColumns: string[]) {
    onExecute({ ...settings, hiddenColumns });
  }
  return (
    <div className="table-browser">
      <div className="table-toolbar">
        <Button
          className="quiet small"
          aria-label="Refresh table data"
          aria-busy={loading}
          title="Refresh table data"
          disabled={loading || !!edit?.applying || tab.disconnected}
          onClick={onRefresh}
        >
          <RefreshCw
            size={14}
            className={loading ? "motion-safe:animate-spin" : undefined}
            aria-hidden="true"
          />
          Refresh
        </Button>
        <TableFilterControl
          columns={columns}
          disabled={editBusy}
          filters={filters}
          onApply={(filters) => onExecute({ ...settings, page: 0, filters })}
        />
        <TableSortControl
          columns={columns}
          disabled={editBusy}
          sort={settings.sort}
          onApply={(sort) => onExecute({ ...settings, page: 0, sort })}
        />
        {filters.length > 0 && (
          <Button
            className="quiet icon"
            aria-label="Clear filter"
            title="Clear filters"
            disabled={editBusy}
            onClick={() => onExecute({ ...settings, page: 0, filters: [] })}
          >
            <X size={14} aria-hidden="true" />
          </Button>
        )}
        <span className="spacer" />
        {!!stagedCount && edit && (
          <Button
            size="sm"
            className={reviewOpen ? "selected-view" : ""}
            aria-pressed={reviewOpen}
            onClick={() => onEditChange({ ...edit, reviewOpen: !reviewOpen })}
            disabled={edit.applying}
          >
            <span className="pending-dot" aria-hidden="true" />
            Changes ({stagedCount.toLocaleString()})
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                className="quiet small"
                aria-label="Choose columns"
                disabled={editBusy}
              />
            }
          >
            <Columns3 size={13} aria-hidden="true" />
            Columns {relation.columns.length - hidden.length}/
            {relation.columns.length}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 min-w-52">
            {relation.columns.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.name}
                closeOnClick={false}
                checked={!hidden.includes(c.name)}
                disabled={
                  !hidden.includes(c.name) &&
                  hidden.length === relation.columns.length - 1
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
        {counting && (
          <Button className="quiet small" onClick={onCancelCount}>
            Cancel count
          </Button>
        )}
        <div
          className="table-pagination"
          role="group"
          aria-label="Table pagination"
        >
          <Button
            className="quiet icon"
            aria-label="Previous page"
            disabled={busy || tab.disconnected || page === 0}
            aria-disabled={running || tab.disconnected || page === 0}
            onClick={() => onExecute({ ...settings, page: page - 1 })}
          >
            <ChevronLeft size={14} />
          </Button>
          <form
            className="page-jump"
            onSubmit={(event) => {
              event.preventDefault();
              const requested = Number(pageDraft ?? page + 1);
              setPageDraft(undefined);
              if (
                !Number.isSafeInteger(requested) ||
                requested < 1 ||
                editBusy ||
                tab.disconnected
              )
                return;
              const available =
                totalPages !== undefined && totalPages <= 1_000_001n
                  ? Number(totalPages)
                  : 1_000_001;
              const next = Math.min(requested, Math.max(1, available)) - 1;
              if (next !== page) onExecute({ ...settings, page: next });
            }}
          >
            <Input
              className="page-number h-[28px] w-[48px]"
              aria-label="Page number"
              inputMode="numeric"
              maxLength={7}
              value={pageDraft ?? String(page + 1)}
              disabled={editBusy || tab.disconnected}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) =>
                setPageDraft(event.target.value.replace(/[^0-9]/g, ""))
              }
              onBlur={() => setPageDraft(undefined)}
            />
            {totalPages !== undefined && (
              <span className="page-count">
                of {totalPages === 0n ? "1" : totalPages.toLocaleString()}
              </span>
            )}
          </form>
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
          <SelectField
            label="Rows per page"
            value={String(pageSize)}
            disabled={editBusy || tab.disconnected}
            onChange={(value) =>
              onExecute({ ...settings, page: 0, pageSize: Number(value) })
            }
            options={TABLE_PAGE_SIZES.map((size) => ({
              value: String(size),
              label: String(size),
            }))}
          />
          <span
            className="page-total"
            title={filters.length ? "Matching rows" : "Total rows"}
          >
            {total != null ? BigInt(total).toLocaleString() : ""}
          </span>
          <span className="page-range sr-only" aria-live="polite">
            {execution?.state === "success" && (
              <>
                {fetched
                  ? `${(page * pageSize + 1).toLocaleString()}–${(page * pageSize + fetched).toLocaleString()}`
                  : "0 rows"}
                {total != null && ` of ${BigInt(total).toLocaleString()} rows`}
              </>
            )}
          </span>
        </div>
      </div>
      <div className="table-data-layout">
        {loading ? (
          <div className="execution-empty" role="status">
            <LoaderCircle
              size={16}
              className="animate-spin"
              aria-hidden="true"
            />
            <span>Loading rows…</span>
          </div>
        ) : !execution ? (
          <div className="execution-empty">
            <span>Table ready.</span>
            <small>Refresh to load current data.</small>
          </div>
        ) : (
          <ExecutionView
            execution={gridExecution}
            editing={
              !editUnavailable || edit
                ? {
                    canEdit,
                    isStaged: (row, column) =>
                      !!stagedRow(row)?.cells.some(
                        (cell) => cell.column === column,
                      ),
                    openEditor: (row, column, anchor) => {
                      if (execution)
                        setEditor({
                          row,
                          column,
                          requestId: execution.requestId,
                          anchor,
                        });
                    },
                    inlineEditor:
                      activeEditor &&
                      !fullEditor &&
                      typeof activeValue === "string"
                        ? {
                            row: activeEditor.row,
                            column: activeEditor.column,
                            content: (restoreFocus) => (
                              <TableInlineEditor
                                initialValue={activeValue}
                                onStage={(value) => {
                                  stage(value);
                                  if (
                                    document.activeElement?.closest(
                                      ".table-inline-editor",
                                    )
                                  )
                                    restoreFocus();
                                }}
                                onClose={() => {
                                  setEditor(undefined);
                                  restoreFocus();
                                }}
                                onOpenFull={(fullValue) =>
                                  setEditor({ ...activeEditor, fullValue })
                                }
                              />
                            ),
                          }
                        : undefined,
                    reviewOpen,
                    closeReview: () => {
                      if (edit) onEditChange({ ...edit, reviewOpen: false });
                    },
                  }
                : undefined
            }
            relation={relation}
            selectRows
            onOpenReference={onOpenReference}
            rowOffset={page * pageSize}
            sort={settings.sort}
            onSort={sort}
          />
        )}
        {edit && reviewOpen && (
          <TableChanges
            relation={relation}
            edit={edit}
            canApply={
              !editBusy && !tab.disconnected && sameSession && !!edit.sessionId
            }
            onApply={onApplyEdits}
            onClose={() => onEditChange({ ...edit, reviewOpen: false })}
            onDiscard={() => onEditChange(undefined)}
            onUndo={(row, column) => updateCell(row, column)}
          />
        )}
      </div>
      {fullEditor && editorColumn && (
        <TableCellEditor
          anchor={activeEditor.anchor}
          column={editorColumn.name}
          json={!!jsonEditor}
          required={editorColumn.required}
          initialValue={activeEditor.fullValue ?? activeValue ?? null}
          onStage={stage}
          onClose={() => setEditor(undefined)}
        />
      )}
      {!sameSession && (
        <div className="table-count-error" role="status">
          Drafts belong to a previous session.
        </div>
      )}
      {!reviewOpen && edit?.error && (
        <div className="table-count-error" role="alert">
          {edit.error.message}
        </div>
      )}
      {validCount && count?.state === "failed" && (
        <div className="table-count-error" role="alert">
          Count failed: {count.error?.message}
        </div>
      )}
    </div>
  );
}
