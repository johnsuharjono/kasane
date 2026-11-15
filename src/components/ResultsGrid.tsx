import { native } from "../api";
import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  useTable,
  tableFeatures,
  columnSizingFeature,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  Copy,
  KeyRound,
  PanelRightOpen,
  X,
} from "lucide-react";
import { Button } from "./Button";
import type {
  Column,
  ColumnReference,
  Relation,
  Result,
  TableSettings,
} from "../types";
import { quoteIdent } from "../api";
const features = tableFeatures({ columnSizingFeature });
// Two-line header: column name above its type.
const HEADER_HEIGHT = 46;
type Point = { row: number; col: number };
const isNumber = (c: Column) => /int|numeric|float/.test(c.dataType);
const isChip = (c: Column) => c.isEnum || c.dataType === "bool";
const display = (c: Column, v: string) =>
  c.dataType === "bool" ? (v === "t" ? "true" : v === "f" ? "false" : v) : v;
// Untyped literals coerce to the target column type in INSERT … VALUES.
const sqlLiteral = (v: string | null) =>
  v === null ? "NULL" : `'${v.replaceAll("'", "''")}'`;
const tsv = (v: string | null) =>
  v === null ? "\\N" : /[\t\n\r"]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
export const ResultsGrid = memo(function ResultsGrid({
  result,
  sort,
  onSort,
  compact = false,
  rowOffset = 0,
  relation,
  onOpenReference,
}: {
  result: Result;
  relation?: Relation;
  onOpenReference?: (reference: ColumnReference, value: string) => void;
  compact?: boolean;
  rowOffset?: number;
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
  const drag = useRef<AbortController | null>(null);
  useEffect(() => () => drag.current?.abort(), []);
  const columns = useMemo(
    () =>
      result.columns.map((c, i) => ({
        id: String(i),
        accessorFn: (row: (string | null)[]) => row[i],
        header: c.name,
        size: isNumber(c) ? 140 : isChip(c) ? 150 : 210,
        minSize: 80,
        maxSize: 800,
      })),
    [result.columns],
  );
  const table = useTable({ features, columns, data: result.rows });
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
  function copyRowJSON() {
    const row = result.rows[end.row];
    if (!row) return;
    void writeClipboard(
      JSON.stringify(
        Object.fromEntries(result.columns.map((c, i) => [c.name, row[i]])),
        null,
        2,
      ),
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
          className="icon quiet"
          aria-label="Inspect selected row"
          aria-pressed={inspect}
          onClick={() => setInspect(!inspect)}
        >
          <PanelRightOpen size={15} />
        </Button>
      </div>
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
          aria-label="Query results"
          aria-rowcount={result.rows.length + 1}
          aria-colcount={columns.length}
          tabIndex={0}
          aria-activedescendant={
            result.rows.length
              ? `${gridId}-cell-${end.row}-${end.col}`
              : undefined
          }
          onKeyDown={(e) => {
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
            else if (e.key === "Tab") {
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
              setInspect((v) => !v);
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
            <div className="row-number header-number">#</div>
            {horizontal.getVirtualItems().map((v) => (
              <div
                key={v.key}
                className="column-header"
                role="columnheader"
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
                  onDoubleClick={() => leaf[v.index].resetSize()}
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
                          [String(v.index)]: Math.min(
                            800,
                            Math.max(80, size + event.clientX - x),
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
            {vertical.getVirtualItems().map((v) => (
              <div
                key={v.key}
                className="grid-row"
                role="row"
                aria-rowindex={v.index + 2}
                style={{
                  position: "absolute",
                  top: v.start - HEADER_HEIGHT,
                  height: 32,
                  width,
                }}
              >
                <div className="row-number">{v.index + 1 + rowOffset}</div>
                {horizontal.getVirtualItems().map((c) => {
                  const value = result.rows[v.index][c.index],
                    column = result.columns[c.index],
                    selected =
                      v.index >= minRow &&
                      v.index <= maxRow &&
                      c.index >= minCol &&
                      c.index <= maxCol;
                  return (
                    <div
                      id={`${gridId}-cell-${v.index}-${c.index}`}
                      key={c.key}
                      role="gridcell"
                      aria-colindex={c.index + 1}
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
                      onDoubleClick={() => setInspect(true)}
                    >
                      {value === null ? (
                        <span className="value-chip null">NULL</span>
                      ) : value === "" ? (
                        <span className="empty-value">empty</span>
                      ) : isChip(column) ? (
                        <span className="value-chip">
                          {display(column, value)}
                        </span>
                      ) : value.length > 160 ? (
                        `${value.slice(0, 160)}…`
                      ) : (
                        value
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {!result.rows.length && (
            <div className="empty-result">
              Query completed. No rows returned.
            </div>
          )}
        </div>
        {inspect && result.rows[end.row] && (
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
