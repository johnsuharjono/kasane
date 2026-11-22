export type Connection = {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  /** Legacy: true meant verify-full. Kept in sync with tlsMode when saving. */
  tls: boolean;
  tlsMode?: TlsMode;
  color?: ConnectionColor;
};
export type TlsMode = "disable" | "require" | "verify-full";
export const tlsModeOf = (c: Pick<Connection, "tls" | "tlsMode">): TlsMode =>
  c.tlsMode ?? (c.tls ? "verify-full" : "disable");
export type ConnectionTest = { serverVersion: string; durationMs: number };
export type ConnectionColor =
  "gray" | "blue" | "teal" | "green" | "amber" | "orange" | "rose" | "violet";
export type Column = {
  name: string;
  dataType: string;
  oid: number;
  isEnum?: boolean;
};
export type Result = {
  columns: Column[];
  rows: (string | null)[][];
  durationMs: number;
  returnedRows: string;
  affectedRows: string;
  truncated: boolean;
  bytes: number;
};
export type DbError = {
  message: string;
  code?: string;
  detail?: string;
  hint?: string;
  disconnected?: boolean;
  cancelled?: boolean;
};
export type Relation = {
  schema: string;
  name: string;
  kind: string;
  /** pg_class.reltuples; absent for views and never-analyzed tables. */
  estimatedRows?: number;
  columns: {
    name: string;
    type: string;
    required: boolean;
    primaryKeyPosition?: number;
    /** Single-column foreign key target. */
    references?: ColumnReference;
  }[];
};
export type RelationStructure = {
  comment: string | null;
  viewDefinition: string | null;
  columns: {
    name: string;
    dataType: string;
    required: boolean;
    primaryKey: boolean;
    defaultExpression: string | null;
    generatedExpression: string | null;
    identity: "always" | "by default" | null;
    comment: string | null;
  }[];
  constraints: { name: string; definition: string }[];
  indexes: {
    name: string;
    method: string;
    definition: string;
    valid: boolean;
  }[];
};
export type ColumnReference = { schema: string; table: string; column: string };
export type Cell = { id: string; kind: "markdown" | "sql"; source: string };
export type Notebook = {
  version: 1;
  id: string;
  title: string;
  connectionId: string | null;
  cells: Cell[];
};
export type SQLDocument = {
  version: 1;
  id: string;
  title: string;
  connectionId: string | null;
  source: string;
};
export type Execution = {
  state: "running" | "success" | "failed";
  requestId: string;
  source: string;
  outdated?: boolean;
  /** Notebook execution counter shown as [n] beside the cell. */
  runNumber?: number;
  hasNextPage?: boolean;
  result?: Result;
  error?: DbError;
};
export type TableSettings = {
  page?: number;
  sort?: { column: string; direction: "asc" | "desc" };
  filterColumn: string;
  filterOperator: "contains" | "equals" | "is-null";
  filterValue: string;
  /** Columns left out of the SELECT list. */
  hiddenColumns?: string[];
};
export type Tab = {
  id: string;
  kind: "query" | "notebook";
  title: string;
  cells: Cell[];
  connectionId: string | null;
  path?: string;
  tableKey?: string;
  relation?: Relation;
  view?: "data" | "query" | "structure";
  tableSettings?: TableSettings;
  filtersOpen?: boolean;
  editorHeight?: number;
  restored?: boolean;
  sessionId?: string;
  disconnected?: boolean;
  dirty: boolean;
  executions: Record<string, Execution>;
};
export const uid = () => crypto.randomUUID();
export const asError = (e: unknown): DbError =>
  typeof e === "object" && e && "message" in e
    ? (e as DbError)
    : { message: String(e) };
