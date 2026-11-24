import { quoteIdent } from "./api";
import type { Relation, TableFilter, TableSettings } from "./types";
export const defaultTableSettings: TableSettings = { page: 0 };

// E-strings explicitly escape both backslashes and quotes, independent of standard_conforming_strings.
const literal = (v: string) =>
  `E'${v.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
export function activeTableFilters(
  relation: Relation,
  settings: TableSettings,
): TableFilter[] {
  const { filterColumn, filterOperator, filterValue } = settings;
  const legacy =
    filterColumn &&
    filterOperator &&
    (filterOperator === "is-null" || filterValue)
      ? [
          {
            column: filterColumn,
            operator: filterOperator,
            value: filterValue ?? "",
          },
        ]
      : [];
  return (settings.filters ?? legacy).filter((filter) =>
    relation.columns.some((column) => column.name === filter.column),
  );
}

function tableSource(relation: Relation, settings: TableSettings): string {
  const source = `FROM ${quoteIdent(relation.schema)}.${quoteIdent(relation.name)}`;
  const conditions = activeTableFilters(relation, settings).map(
    ({ column, operator, value }) => {
      const name = quoteIdent(column);
      if (operator === "is-null") return `${name} IS NULL`;
      if (operator === "equals") return `${name}::text = ${literal(value)}`;
      return `strpos(lower(${name}::text), lower(${literal(value)})) > 0`;
    },
  );
  return conditions.length
    ? `${source} WHERE ${conditions.join(" AND ")}`
    : source;
}
export const TABLE_PAGE_SIZES: readonly number[] = [25, 50, 100, 250, 500];
export const pageSizeFor = ({ pageSize }: TableSettings) =>
  pageSize !== undefined && TABLE_PAGE_SIZES.includes(pageSize) ? pageSize : 50;
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
export const tablePrimaryKey = (relation: Relation) =>
  relation.columns
    .filter((column) => column.primaryKeyPosition !== undefined)
    .sort((a, b) => a.primaryKeyPosition! - b.primaryKeyPosition!);

export function tableQuery(
  relation: Relation,
  settings: TableSettings,
  captureRows = false,
): string {
  const hidden = new Set(settings.hiddenColumns ?? []);
  const visible = relation.columns.filter((c) => !hidden.has(c.name));
  const list =
    hidden.size && visible.length
      ? visible.map((c) => quoteIdent(c.name)).join(", ")
      : "*";
  const primaryKey = tablePrimaryKey(relation);
  // The trailing identity fields are stripped before the result reaches the grid.
  const identity = captureRows
    ? `, ${primaryKey.map((column) => quoteIdent(column.name)).join(", ")}, tableoid::text, ctid::text, xmin::text`
    : "";
  let query = `SELECT ${list}${identity} ${tableSource(relation, settings)}`;
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
  const pageSize = pageSizeFor(settings);
  return `${query} LIMIT ${pageSize + 1} OFFSET ${pageFor(settings) * pageSize};`;
}
