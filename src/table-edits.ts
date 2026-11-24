import { quoteIdent } from "./api";
import { tablePrimaryKey } from "./table-query";
import type { Relation, RowIdentity, TableRowEdit } from "./types";

export function tableEditUnavailable(relation: Relation) {
  if (relation.kind !== "table") return "Only tables can be edited.";
  if (!tablePrimaryKey(relation).length)
    return "This table has no primary key.";
  if (
    !relation.columns.some(
      (column) => column.canUpdate && column.primaryKeyPosition === undefined,
    )
  )
    return "Row editing is unavailable with this connection’s permissions.";
}

export function rowEditKey(row: RowIdentity) {
  return JSON.stringify([row.tableOid, row.key]);
}

export function previewTableUpdates(relation: Relation, rows: TableRowEdit[]) {
  const table = `${quoteIdent(relation.schema)}.${quoteIdent(relation.name)}`;
  const key = tablePrimaryKey(relation);
  return [
    "BEGIN;",
    ...rows.map((row) => {
      const values = [
        ...row.cells.map((cell) => cell.value),
        ...row.key,
        row.tableOid,
        row.tuple,
        row.version,
      ];
      const assignments = row.cells.map(
        (cell, i) => `${quoteIdent(cell.column)} = $${i + 1}`,
      );
      const predicates = [
        ...key.map((column) => quoteIdent(column.name)),
        "tableoid",
        "ctid",
        "xmin",
      ].map((column, i) => `${column} = $${row.cells.length + i + 1}`);
      return [
        `UPDATE ${table}`,
        `SET ${assignments.join(", ")}`,
        `WHERE ${predicates.join("\n  AND ")};`,
        ...values.map(
          (value, i) =>
            `-- $${i + 1} = ${value === null ? "NULL" : JSON.stringify(value)}`,
        ),
      ].join("\n");
    }),
    "COMMIT;",
  ].join("\n\n");
}
