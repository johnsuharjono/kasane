import { Undo2, X } from "lucide-react";
import { previewTableUpdates, rowEditKey } from "../table-edits";
import { tablePrimaryKey } from "../table-query";
import type { Relation, TableEdit, TableRowEdit } from "../types";
import { Button } from "./Button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

function diffValue(value: string | null) {
  if (value === null) return <span className="value-chip null">NULL</span>;
  return value === "" ? <em>empty string</em> : value;
}

export function TableChanges({
  relation,
  edit,
  canApply,
  onApply,
  onClose,
  onDiscard,
  onUndo,
}: {
  relation: Relation;
  edit: TableEdit;
  canApply: boolean;
  onApply: () => void;
  onClose: () => void;
  onDiscard: () => void;
  onUndo: (row: TableRowEdit, column: string) => void;
}) {
  const keys = tablePrimaryKey(relation);
  return (
    <aside className="cell-inspector table-changes" aria-label="Table changes">
      <div className="inspector-heading">
        <strong>Pending changes</strong>
        <span className="inspector-context">
          {edit.rows.length} {edit.rows.length === 1 ? "row" : "rows"}
        </span>
        <span className="spacer" />
        <Button
          size="icon-sm"
          className="quiet"
          aria-label="Close changes"
          onClick={onClose}
          disabled={edit.applying}
        >
          <X size={14} aria-hidden="true" />
        </Button>
      </div>
      <Tabs defaultValue="diff" className="changes-tabs">
        <TabsList className="changes-tab-list">
          <TabsTrigger value="diff">Diff</TabsTrigger>
          <TabsTrigger value="sql">SQL</TabsTrigger>
        </TabsList>
        <TabsContent value="diff" className="changes-content">
          {edit.rows.map((row) => (
            <section className="change-row" key={rowEditKey(row)}>
              <h3>
                {row.key
                  .map((value, i) => `${keys[i]?.name ?? "Key"} = ${value}`)
                  .join(" · ")}
              </h3>
              {row.cells.map((cell) => (
                <div key={cell.column} className="change-cell">
                  <div className="change-cell-heading">
                    <code>{cell.column}</code>
                    <Button
                      size="icon-sm"
                      className="quiet"
                      aria-label={`Undo change to ${cell.column}`}
                      onClick={() => onUndo(row, cell.column)}
                      disabled={edit.applying}
                    >
                      <Undo2 size={13} aria-hidden="true" />
                    </Button>
                  </div>
                  <div className="change-value before">
                    <span className="change-value-label">Before</span>
                    <code>{diffValue(cell.before)}</code>
                  </div>
                  <div className="change-value after">
                    <span className="change-value-label">After</span>
                    <code>{diffValue(cell.value)}</code>
                  </div>
                </div>
              ))}
            </section>
          ))}
        </TabsContent>
        <TabsContent value="sql" className="changes-content">
          <pre aria-label="SQL preview">
            {previewTableUpdates(relation, edit.rows)}
          </pre>
        </TabsContent>
      </Tabs>
      {edit.error && (
        <div className="changes-error" role="alert">
          <strong>Couldn’t apply changes</strong>
          <span>{edit.error.message}</span>
          {edit.error.detail && <span>{edit.error.detail}</span>}
        </div>
      )}
      <div className="inspector-actions changes-actions">
        <Button
          className="quiet small"
          onClick={onDiscard}
          disabled={edit.applying}
        >
          Discard all
        </Button>
        <Button
          className="primary small"
          onClick={onApply}
          disabled={!canApply}
        >
          {edit.applying ? "Applying…" : "Apply changes"}
        </Button>
      </div>
    </aside>
  );
}
