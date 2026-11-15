import { quoteIdent } from "./api";
import type { Relation, TableSettings } from "./types";
export const defaultTableSettings: TableSettings = {
  page: 0,
  filterColumn: "",
  filterOperator: "contains",
  filterValue: "",
};
// E-strings explicitly escape both backslashes and quotes, independent of standard_conforming_strings.
const literal = (v: string) =>
  `E'${v.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
function tableSource(relation: Relation, settings: TableSettings): string {
  let query = `FROM ${quoteIdent(relation.schema)}.${quoteIdent(relation.name)}`;
  const column = relation.columns.find((c) => c.name === settings.filterColumn);
  if (column) {
    const name = quoteIdent(column.name);
    if (settings.filterOperator === "is-null")
      query += ` WHERE ${name} IS NULL`;
    else if (settings.filterValue !== "")
      query +=
        settings.filterOperator === "equals"
          ? ` WHERE ${name}::text = ${literal(settings.filterValue)}`
          : ` WHERE strpos(lower(${name}::text), lower(${literal(settings.filterValue)})) > 0`;
  }
  return query;
}
export const TABLE_PAGE_SIZE = 500;
export const pageFor = (settings: TableSettings) =>
  Number.isSafeInteger(settings.page) && settings.page! >= 0
    ? Math.min(settings.page!, 1_000_000)
    : 0;
export function tableCountQuery(
  relation: Relation,
  settings: TableSettings,
): string {
  return `SELECT count(*)::text AS total ${tableSource(relation, settings)};`;
}
export function tableQuery(
  relation: Relation,
  settings: TableSettings,
): string {
  const hidden = new Set(settings.hiddenColumns ?? []);
  const visible = relation.columns.filter((c) => !hidden.has(c.name));
  const list =
    hidden.size && visible.length
      ? visible.map((c) => quoteIdent(c.name)).join(", ")
      : "*";
  let query = `SELECT ${list} ${tableSource(relation, settings)}`;
  const primaryKey = relation.columns
    .filter((c) => c.primaryKeyPosition !== undefined)
    .sort((a, b) => a.primaryKeyPosition! - b.primaryKeyPosition!);
  const order: string[] = [];
  if (
    settings.sort &&
    relation.columns.some((c) => c.name === settings.sort!.column)
  )
    order.push(
      `${quoteIdent(settings.sort.column)} ${settings.sort.direction === "desc" ? "DESC" : "ASC"} NULLS LAST`,
    );
  for (const key of primaryKey) {
    if (key.name !== settings.sort?.column)
      order.push(`${quoteIdent(key.name)} ASC`);
  }
  // Views/keyless relations use all output columns as tie breakers. Values are
  // ordered as text because types such as json have no PostgreSQL ordering operator.
  if (!primaryKey.length) {
    for (const column of relation.columns) {
      if (column.name !== settings.sort?.column)
        order.push(
          `${quoteIdent(column.name)}::text COLLATE "C" ASC NULLS LAST`,
        );
    }
  }
  if (order.length) query += ` ORDER BY ${order.join(", ")}`;
  return (
    query +
    ` LIMIT ${TABLE_PAGE_SIZE + 1} OFFSET ${pageFor(settings) * TABLE_PAGE_SIZE};`
  );
}
