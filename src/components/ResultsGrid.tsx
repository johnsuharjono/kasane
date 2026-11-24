import { api, native, quoteIdent } from "../api";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useTable,
  tableFeatures,
  columnSizingFeature,
  rowSelectionFeature,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  Download,
  KeyRound,
  PanelRightOpen,
  X,
} from "lucide-react";
import { Button } from "./Button";
import { Checkbox } from "./ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import type {
  Column,
  ColumnReference,
  Relation,
  Result,
  TableSettings,
} from "../types";
import { asError } from "../types";
const features = tableFeatures({ columnSizingFeature, rowSelectionFeature });
// Two-line header: column name above its type.
const HEADER_HEIGHT = 46;
const MIN_COLUMN_WIDTH = 80;
const MAX_COLUMN_WIDTH = 800;
const clampColumnWidth = (width: number) =>
  Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width));
type Point = { row: number; col: number };
export type GridEditing = {
  canEdit: (row: number, column: string) => boolean;
  isStaged: (row: number, column: string) => boolean;
  openEditor: (row: number, column: number, anchor: HTMLElement) => void;
  inlineEditor?: {
    row: number;
    column: number;
    content: (restoreFocus: () => void) => ReactNode;
  };
  reviewOpen: boolean;
  closeReview: () => void;
};
const isNumber = (c: Column) => /int|numeric|float/.test(c.dataType);
const isChip = (c: Column) => c.isEnum || c.dataType === "bool";
const display = (c: Column, v: string) =>
  c.dataType === "bool" ? (v === "t" ? "true" : v === "f" ? "false" : v) : v;
function cellPreview(column: Column, value: string | null) {
  if (value === null) return { text: "NULL", className: "value-chip null" };
  if (value === "") return { text: "empty", className: "empty-value" };
  if (isChip(column))
    return { text: display(column, value), className: "value-chip" };
  return { text: value.length > 160 ? `${value.slice(0, 160)}…` : value };
}

function defaultTableColumnWidth(
  column: Column,
  rows: Result["rows"],
  index: number,
) {
  const json = /^jsonb?$/.test(column.dataType);
  const minimum = json ? 300 : isNumber(column) ? 96 : 120;
  const maximum = json ? 540 : 340;
  let width = Math.max(column.name.length, column.dataType.length) * 7 + 42;
  // Use a bounded sample and the same truncated previews the grid displays.
  for (const row of rows.slice(0, 32)) {
    width = Math.max(
      width,
      cellPreview(column, row[index]).text.length * 7 + 28,
    );
  }
  return Math.min(maximum, Math.max(minimum, width));
}

function measureColumnWidth(
  header: HTMLElement,
  column: Column,
  rows: Result["rows"],
  index: number,
) {
  // Match the grid's rendering, including rows outside the virtual viewport.
  const probe = document.createElement("div");
  probe.className = "grid-size-probe";
  probe.setAttribute("aria-hidden", "true");
  const content = document.createElement("div");
  content.className = "grid-size-content";
  const headerCopy = header.cloneNode(true) as HTMLElement;
  headerCopy.removeAttribute("style");
  headerCopy.querySelector(".resize-handle")?.remove();
  content.append(headerCopy);
  for (const row of rows) {
    const value = row[index];
    const preview = cellPreview(column, value);
    const cell = document.createElement("div");
    cell.className = `grid-cell${value === null ? " null-value" : ""}${isNumber(column) ? " number-value" : ""}`;
    if (preview.className) {
      const label = document.createElement("span");
      label.className = preview.className;
      label.textContent = preview.text;
      cell.append(label);
    } else {
      cell.textContent = preview.text;
    }
    content.append(cell);
  }
  probe.append(content);
  header.closest(".data-grid")?.append(probe);
  const width = Math.ceil(content.getBoundingClientRect().width);
  probe.remove();
  return clampColumnWidth(width);
}
// Untyped literals coerce to the target column type in INSERT … VALUES.
const sqlLiteral = (v: string | null) =>
  v === null ? "NULL" : `'${v.replaceAll("'", "''")}'`;
const tsv = (v: string | null) =>
  v === null ? "\\N" : /[\t\n\r"]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
// PostgreSQL CSV uses unquoted empty for NULL and quoted empty for empty text.
const csvField = (value: string | null) =>
  value === null
    ? ""
    : value === "" || /[,\r\n"]/.test(value)
      ? `"${value.replaceAll('"', '""')}"`
      : value;
export const ResultsGrid = memo(function ResultsGrid({
  result,
  sort,
  onSort,
  compact = false,
  rowOffset = 0,
  selectRows = false,
  editing,
  relation,
  onOpenReference,
}: {
  result: Result;
  relation?: Relation;
  onOpenReference?: (reference: ColumnReference, value: string) => void;
  compact?: boolean;
  rowOffset?: number;
  selectRows?: boolean;
  editing?: GridEditing;
  sort?: TableSettings["sort"];
  onSort?: (column: string) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const gridId = useId();
  const selecting = useRef(false);
  useEffect(() => {
    const done = () => {
      selecting.current = false;
    };
    window.addEventListener("pointerup", done);
    return () => window.removeEventListener("pointerup", done);
  }, []);
  const [anchor, setAnchor] = useState<Point>({ row: 0, col: 0 });
  const [end, setEnd] = useState<Point>({ row: 0, col: 0 });
  const [inspect, setInspect] = useState(false);
  const [copyState, setCopyState] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const drag = useRef<AbortController | null>(null);
  useEffect(() => () => drag.current?.abort(), []);
  const initialRows = useRef(result.rows);
  const columns = useMemo(
    () =>
      result.columns.map((c, i) => ({
        id: String(i),
        accessorFn: (row: (string | null)[]) => row[i],
        header: c.name,
        size: selectRows
          ? defaultTableColumnWidth(c, initialRows.current, i)
          : isNumber(c)
            ? 140
            : isChip(c)
              ? 150
              : 210,
        minSize: MIN_COLUMN_WIDTH,
        maxSize: MAX_COLUMN_WIDTH,
      })),
    [result.columns, selectRows],
  );
  const table = useTable({
    features,
    columns,
    data: result.rows,
    enableRowSelection: selectRows,
  });
  const selectedRows = selectRows ? table.getSelectedRowModel().flatRows : [];
  const selectedCount = selectedRows.length;
  const allRowsSelected = selectRows && table.getIsAllPageRowsSelected();
  const gridRows = selectRows ? table.getCoreRowModel().rows : undefined;
  const leaf = table.getAllLeafColumns();
  const sizes = leaf.map((c) => c.getSize());
  const sizingKey = sizes.join(",");
  const vertical = useVirtualizer({
    useAnimationFrameWithResizeObserver: true,
    count: result.rows.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 32,
    overscan: 8,
    scrollMargin: HEADER_HEIGHT,
  });
  const horizontal = useVirtualizer({
    useAnimationFrameWithResizeObserver: true,
    count: columns.length,
    getScrollElement: () => scroll.current,
    estimateSize: (i) => sizes[i],
    horizontal: true,
    overscan: 2,
    paddingStart: 48,
  });
  useEffect(() => {
    horizontal.measure();
  }, [sizingKey]);
  const minRow = Math.min(anchor.row, end.row),
    maxRow = Math.max(anchor.row, end.row),
    minCol = Math.min(anchor.col, end.col),
    maxCol = Math.max(anchor.col, end.col);
  const selectedValue = result.rows[end.row]?.[end.col];
  const primaryKeys = new Set(
    relation?.columns
      .filter((c) => c.primaryKeyPosition !== undefined)
      .map((c) => c.name),
  );
  const references = new Map(
    relation?.columns
      .filter((c) => c.references)
      .map((c) => [c.name, c.references!]),
  );
  async function writeClipboard(text: string) {
    try {
      if (native) {
        const { writeText } =
          await import("@tauri-apps/plugin-clipboard-manager");
        await writeText(text);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopyState("Copied");
    } catch {
      setCopyState("Clipboard unavailable");
    }
  }
  function rowObject(row: Result["rows"][number]) {
    return Object.fromEntries(
      result.columns.map((column, i) => [column.name, row[i]]),
    );
  }
  function copyRowJSON() {
    const row = result.rows[end.row];
    if (row) void writeClipboard(JSON.stringify(rowObject(row), null, 2));
  }
  function rowsAsCSV(rows: Result["rows"]) {
    const header = result.columns.map((column) => column.name);
    return (
      [header, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n") +
      "\r\n"
    );
  }
  function copyRowInsert() {
    const row = result.rows[end.row];
    if (!row || !relation) return;
    void writeClipboard(
      `INSERT INTO ${quoteIdent(relation.schema)}.${quoteIdent(relation.name)} (${result.columns
        .map((c) => quoteIdent(c.name))
        .join(", ")})\nVALUES (${result.columns
        .map((_, i) => sqlLiteral(row[i]))
        .join(", ")});`,
    );
  }
  async function copy() {
    const text = result.rows
      .slice(minRow, maxRow + 1)
      .map((r) =>
        r
          .slice(minCol, maxCol + 1)
          .map(tsv)
          .join("\t"),
      )
      .join("\n");
    await writeClipboard(text);
  }
  async function exportCSV() {
    setExporting(true);
    setExportError("");
    try {
      const rows = selectedCount
        ? selectedRows.map((row) => row.original)
        : result.rows;
      const rowCount = rows.length;
      const summary = `${rowCount.toLocaleString()} ${selectedCount ? "selected" : "displayed"} ${rowCount === 1 ? "row" : "rows"}`;
      const path = await saveDialog({
        defaultPath: "results.csv",
        title: `Export ${summary}${result.truncated ? " (limited result)" : ""}`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!path) return;
      await api.writeCSV(path, rowsAsCSV(rows));
    } catch (error) {
      setExportError(asError(error).message);
    } finally {
      setExporting(false);
    }
  }
  function openInspector(open: boolean) {
    if (open && editing?.reviewOpen) editing.closeReview();
    setInspect(open);
  }
  function activateCell(row: number, col: number) {
    const column = result.columns[col];
    const cell = document.getElementById(`${gridId}-cell-${row}-${col}`);
    if (cell && column && editing?.canEdit(row, column.name))
      editing.openEditor(row, col, cell);
    else if (!selectRows) openInspector(true);
  }
  function move(point: Point, extend = false) {
    point = {
      row: Math.max(0, Math.min(result.rows.length - 1, point.row)),
      col: Math.max(0, Math.min(columns.length - 1, point.col)),
    };
    setEnd(point);
    if (!extend) setAnchor(point);
    setCopyState("");
    vertical.scrollToIndex(point.row, { align: "auto" });
    horizontal.scrollToIndex(point.col, { align: "auto" });
  }
  if (!result.columns.length)
    return (
      <div className="statement-complete">
        <Check size={22} />
        <strong>Statement completed</strong>
        <span>
          {result.affectedRows} rows affected · {result.durationMs.toFixed(1)}{" "}
          ms
        </span>
      </div>
    );
  const width = horizontal.getTotalSize();
  return (
    <div className="results" data-testid="results">
      <div className="results-toolbar">
        {selectedCount ? (
          <>
            <span className="row-selection-count" role="status">
              {selectedCount.toLocaleString()} selected
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    className="quiet small"
                    aria-label="Copy selected rows"
                  />
                }
              >
                <Copy size={13} aria-hidden="true" />
                Copy rows
                <ChevronDown size={12} aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-auto min-w-36">
                <DropdownMenuItem
                  onClick={() =>
                    void writeClipboard(
                      JSON.stringify(
                        selectedRows.map((row) => rowObject(row.original)),
                        null,
                        2,
                      ),
                    )
                  }
                >
                  Copy as JSON
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    void writeClipboard(
                      rowsAsCSV(selectedRows.map((row) => row.original)),
                    )
                  }
                >
                  Copy as CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              className="quiet small"
              onClick={() => void exportCSV()}
              disabled={exporting}
              title="Save the selected rows and displayed columns"
            >
              <Download size={13} aria-hidden="true" />
              Export CSV
            </Button>
            <Button
              className="quiet icon"
              onClick={() => {
                table.resetRowSelection(true);
                setCopyState("");
              }}
              aria-label="Clear row selection"
              title="Clear row selection"
            >
              <X size={14} aria-hidden="true" />
            </Button>
            <span className="row-selection-feedback" role="status">
              {copyState}
            </span>
            <span className="spacer" />
          </>
        ) : (
          <>
            <span className="result-status">
              <Check size={13} className="ok" aria-hidden="true" />
              <span>
                {result.truncated
                  ? `${result.rows.length.toLocaleString()} of ${Number(result.returnedRows).toLocaleString()} returned`
                  : `${Number(result.returnedRows).toLocaleString()} returned`}
              </span>
              <span aria-hidden="true">·</span>
              <span>{result.durationMs.toFixed(1)} ms</span>
              {result.truncated && (
                <span className="warning">Limited to 1,000 rows / 8 MiB</span>
              )}
            </span>
            <span className="spacer" />
            <Button
              className="quiet"
              onClick={copy}
              disabled={!result.rows.length}
              title="Copy selected cells (⌘C)"
            >
              <Copy size={13} />
              {copyState || "Copy"}
            </Button>
            <Button
              className="quiet"
              onClick={() => void exportCSV()}
              disabled={exporting}
              title="Save the displayed rows and columns"
            >
              <Download size={13} aria-hidden="true" />
              Export CSV
            </Button>
          </>
        )}
        <Button
          className="icon quiet"
          aria-label="Inspect selected row"
          aria-pressed={inspect && !editing?.reviewOpen}
          onClick={() => openInspector(!inspect || !!editing?.reviewOpen)}
        >
          <PanelRightOpen size={15} />
        </Button>
      </div>
      {exportError && (
        <div className="query-error" role="alert">
          <strong>Couldn’t export CSV</strong>
          <p>{exportError}</p>
        </div>
      )}
      <div
        className="grid-and-inspector"
        style={
          compact
            ? {
                height: Math.min(
                  360,
                  Math.max(
                    result.rows.length ? 84 : 100,
                    HEADER_HEIGHT + result.rows.length * 32 + 16,
                  ),
                ),
                flex: "0 0 auto",
              }
            : undefined
        }
      >
        <div
          ref={scroll}
          className="data-grid"
          role="grid"
          aria-label={selectRows ? "Table data" : "Query results"}
          aria-multiselectable={selectRows || undefined}
          aria-rowcount={result.rows.length + 1}
          aria-colcount={columns.length + Number(selectRows)}
          tabIndex={0}
          aria-activedescendant={
            result.rows.length
              ? `${gridId}-cell-${end.row}-${end.col}`
              : undefined
          }
          onKeyDown={(e) => {
            if (selectRows && e.target !== e.currentTarget) return;
            if ((e.metaKey || e.ctrlKey) && e.key === "c") {
              e.preventDefault();
              void copy();
              return;
            }
            if ((e.metaKey || e.ctrlKey) && e.key === "a") {
              e.preventDefault();
              setAnchor({ row: 0, col: 0 });
              setEnd({ row: result.rows.length - 1, col: columns.length - 1 });
              return;
            }
            const next = { ...end };
            let handled = true;
            if (e.key === "ArrowDown") next.row++;
            else if (e.key === "ArrowUp") next.row--;
            else if (e.key === "ArrowLeft") next.col--;
            else if (e.key === "ArrowRight") next.col++;
            else if (e.key === "Tab" && !selectRows) {
              next.col += e.shiftKey ? -1 : 1;
              if (next.col >= columns.length) {
                next.col = 0;
                next.row++;
              }
              if (next.col < 0) {
                next.col = columns.length - 1;
                next.row--;
              }
            } else if (e.key === "Home") {
              next.col = 0;
              if (e.metaKey || e.ctrlKey) next.row = 0;
            } else if (e.key === "End") {
              next.col = columns.length - 1;
              if (e.metaKey || e.ctrlKey) next.row = result.rows.length - 1;
            } else if (e.key === "Enter") {
              if (selectRows) activateCell(end.row, end.col);
              else openInspector(!inspect);
            } else handled = false;
            if (handled) {
              e.preventDefault();
              if (e.key !== "Enter") move(next, e.shiftKey && e.key !== "Tab");
            }
          }}
        >
          <div
            className="grid-header"
            role="row"
            style={{ width, height: HEADER_HEIGHT }}
          >
            {selectRows ? (
              <div
                className="row-number header-number row-selector"
                role="columnheader"
                aria-colindex={1}
              >
                <Checkbox
                  aria-label="Select all rows on this page"
                  checked={allRowsSelected}
                  indeterminate={selectedCount > 0 && !allRowsSelected}
                  disabled={!result.rows.length}
                  onCheckedChange={(checked) => {
                    setCopyState("");
                    table.toggleAllPageRowsSelected(checked);
                  }}
                />
              </div>
            ) : (
              <div className="row-number header-number">#</div>
            )}
            {horizontal.getVirtualItems().map((v) => (
              <div
                key={v.key}
                className="column-header"
                role="columnheader"
                aria-colindex={v.index + 1 + Number(selectRows)}
                aria-sort={
                  sort?.column === result.columns[v.index].name
                    ? sort.direction === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
                style={{ left: v.start, width: v.size }}
              >
                <span className="column-title">
                  {onSort ? (
                    <button
                      className="sort-column"
                      onClick={() => onSort(result.columns[v.index].name)}
                    >
                      <span>{result.columns[v.index].name}</span>
                      {sort?.column === result.columns[v.index].name &&
                        (sort.direction === "asc" ? (
                          <ArrowUp size={11} aria-label="sorted ascending" />
                        ) : (
                          <ArrowDown size={11} aria-label="sorted descending" />
                        ))}
                    </button>
                  ) : (
                    <span>{result.columns[v.index].name}</span>
                  )}
                  {primaryKeys.has(result.columns[v.index].name) && (
                    <KeyRound
                      size={11}
                      className="pk-icon"
                      aria-label="Primary key"
                    />
                  )}
                </span>
                <small>
                  {result.columns[v.index].dataType}
                  {references.has(result.columns[v.index].name) &&
                    ` → ${references.get(result.columns[v.index].name)!.table}`}
                </small>
                <div
                  className="resize-handle"
                  role="separator"
                  aria-label={`Resize ${result.columns[v.index].name}`}
                  aria-orientation="vertical"
                  title="Double-click to fit column"
                  onDoubleClick={(e) => {
                    const header = e.currentTarget.parentElement;
                    if (!header) return;
                    const size = measureColumnWidth(
                      header,
                      result.columns[v.index],
                      result.rows,
                      v.index,
                    );
                    table.setColumnSizing((old) => ({
                      ...old,
                      [String(v.index)]: size,
                    }));
                  }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    drag.current?.abort();
                    const controller = new AbortController();
                    drag.current = controller;
                    const x = e.clientX;
                    const size = sizes[v.index];
                    window.addEventListener(
                      "pointermove",
                      (event) =>
                        table.setColumnSizing((old) => ({
                          ...old,
                          [String(v.index)]: clampColumnWidth(
                            size + event.clientX - x,
                          ),
                        })),
                      { signal: controller.signal },
                    );
                    window.addEventListener(
                      "pointerup",
                      () => controller.abort(),
                      { once: true, signal: controller.signal },
                    );
                  }}
                />
              </div>
            ))}
          </div>
          <div
            className="grid-canvas"
            style={{ height: vertical.getTotalSize(), width }}
          >
            {vertical.getVirtualItems().map((v) => {
              const row = gridRows?.[v.index];
              const rowSelected = row?.getIsSelected();
              return (
                <div
                  key={v.key}
                  className="grid-row"
                  aria-selected={rowSelected}
                  role="row"
                  aria-rowindex={v.index + 2}
                  style={{
                    position: "absolute",
                    top: v.start - HEADER_HEIGHT,
                    height: 32,
                    width,
                  }}
                >
                  {row ? (
                    <div
                      className="row-number row-selector"
                      role="rowheader"
                      aria-colindex={1}
                    >
                      <Checkbox
                        aria-label={`Select row ${v.index + 1 + rowOffset}`}
                        checked={rowSelected}
                        onCheckedChange={(checked) => {
                          setCopyState("");
                          row.toggleSelected(checked);
                        }}
                      />
                    </div>
                  ) : (
                    <div className="row-number">{v.index + 1 + rowOffset}</div>
                  )}
                  {horizontal.getVirtualItems().map((c) => {
                    const value = result.rows[v.index][c.index],
                      column = result.columns[c.index],
                      preview = cellPreview(column, value),
                      selected =
                        v.index >= minRow &&
                        v.index <= maxRow &&
                        c.index >= minCol &&
                        c.index <= maxCol;
                    const editor = editing?.inlineEditor;
                    const editingCell =
                      editor?.row === v.index && editor.column === c.index;
                    return (
                      <div
                        id={`${gridId}-cell-${v.index}-${c.index}`}
                        key={c.key}
                        role="gridcell"
                        aria-readonly={
                          selectRows
                            ? !editing?.canEdit(v.index, column.name)
                            : undefined
                        }
                        data-staged={
                          editing?.isStaged(v.index, column.name) || undefined
                        }
                        aria-colindex={c.index + 1 + Number(selectRows)}
                        aria-selected={selected}
                        className={`grid-cell ${selected ? "selected" : ""} ${value === null ? "null-value" : ""} ${isNumber(column) ? "number-value" : ""}`}
                        style={{ left: c.start, width: c.size }}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          selecting.current = true;
                          setEnd({ row: v.index, col: c.index });
                          if (!e.shiftKey)
                            setAnchor({ row: v.index, col: c.index });
                          setCopyState("");
                          scroll.current?.focus();
                        }}
                        onPointerEnter={(e) => {
                          if (selecting.current && e.buttons === 1)
                            setEnd({ row: v.index, col: c.index });
                        }}
                        onDoubleClick={() => activateCell(v.index, c.index)}
                      >
                        {editingCell ? (
                          editor.content(() =>
                            scroll.current?.focus({ preventScroll: true }),
                          )
                        ) : preview.className ? (
                          <span className={preview.className}>
                            {preview.text}
                          </span>
                        ) : (
                          preview.text
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {!result.rows.length && (
            <div className="empty-result">
              Query completed. No rows returned.
            </div>
          )}
        </div>
        {inspect && !editing?.reviewOpen && result.rows[end.row] && (
          <aside className="cell-inspector" aria-label="Row inspector">
            <div className="inspector-heading">
              <strong>Row {(end.row + 1 + rowOffset).toLocaleString()}</strong>
              {relation && (
                <span className="inspector-context">{relation.name}</span>
              )}
              <span className="spacer" />
              <Button
                className="icon quiet"
                aria-label="Previous row"
                disabled={end.row === 0}
                onClick={() => move({ ...end, row: end.row - 1 })}
              >
                <ArrowUp size={13} />
              </Button>
              <Button
                className="icon quiet"
                aria-label="Next row"
                disabled={end.row >= result.rows.length - 1}
                onClick={() => move({ ...end, row: end.row + 1 })}
              >
                <ArrowDown size={13} />
              </Button>
              <Button
                className="icon quiet"
                aria-label="Close inspector"
                onClick={() => setInspect(false)}
              >
                <X size={14} />
              </Button>
            </div>
            <div className="inspector-body">
              <section className="inspector-selected">
                <span className="inspector-label">
                  {result.columns[end.col]?.name} ·{" "}
                  {result.columns[end.col]?.dataType}
                </span>
                <pre>
                  {selectedValue === null ? "NULL" : (selectedValue ?? "")}
                </pre>
              </section>
              <dl className="inspector-fields">
                {result.columns.map((c, i) => {
                  const v = result.rows[end.row][i];
                  return (
                    <div
                      key={i}
                      className={i === end.col ? "current" : ""}
                      onClick={() => move({ ...end, col: i })}
                    >
                      <dt>
                        {c.name} <small>{c.dataType}</small>
                      </dt>
                      <dd>
                        {v !== null &&
                          references.has(c.name) &&
                          onOpenReference && (
                            <button
                              className="reference-link"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenReference(references.get(c.name)!, v);
                              }}
                            >
                              Open {references.get(c.name)!.table}
                              <ArrowUpRight size={12} aria-hidden="true" />
                            </button>
                          )}
                        {v === null ? (
                          <span className="value-chip null">NULL</span>
                        ) : isChip(c) ? (
                          <span className="value-chip">{display(c, v)}</span>
                        ) : v.length > 400 ? (
                          `${v.slice(0, 400)}…`
                        ) : (
                          v
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>
            <div className="inspector-actions">
              <Button onClick={copyRowJSON}>Copy as JSON</Button>
              {relation && (
                <Button onClick={copyRowInsert}>Copy as INSERT</Button>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
});
