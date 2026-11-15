import { Layers } from "lucide-react";
import { ResultsGrid } from "./ResultsGrid";
import type {
  ColumnReference,
  Execution,
  Relation,
  TableSettings,
} from "../types";
export function ExecutionView({
  execution: e,
  sort,
  onSort,
  compact = false,
  rowOffset = 0,
  relation,
  onOpenReference,
}: {
  execution?: Execution;
  relation?: Relation;
  onOpenReference?: (reference: ColumnReference, value: string) => void;
  compact?: boolean;
  rowOffset?: number;
  sort?: TableSettings["sort"];
  onSort?: (column: string) => void;
}) {
  if (!e)
    return (
      <div className="execution-empty">
        <Layers size={21} strokeWidth={1} />
        <span>No results yet.</span>
        <small>Run with ⌘ Enter.</small>
      </div>
    );
  return (
    <div className={`execution-view ${e.state}`}>
      {e.outdated && (
        <div className="outdated-banner">
          Outdated results · the source, cell order, connection, or session has
          changed.
        </div>
      )}
      {e.state === "running" && (
        <div className="running-banner">
          <span className="spinner" />
          Running on your database…
          <small>Cancel to request a PostgreSQL interrupt.</small>
        </div>
      )}
      {e.error && (
        <div className="query-error" role="alert">
          <strong>
            {e.error.code === "57014"
              ? "Query cancelled"
              : e.error.disconnected
                ? "Session disconnected"
                : "Couldn’t complete this query"}
          </strong>
          <code>{e.error.message}</code>
          {e.error.code && <small>PostgreSQL {e.error.code}</small>}
          {e.error.detail && <p>{e.error.detail}</p>}
          {e.error.hint && <p>{e.error.hint}</p>}
        </div>
      )}
      {e.result && (
        <ResultsGrid
          compact={compact}
          rowOffset={rowOffset}
          result={e.result}
          relation={relation}
          onOpenReference={onOpenReference}
          sort={sort}
          onSort={onSort}
        />
      )}
    </div>
  );
}
