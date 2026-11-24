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
    canUpdate?: boolean;
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
export type RowIdentity = {
  key: string[];
  tableOid: string;
  tuple: string;
  version: string;
};
export type TableCellEdit = {
  column: string;
  before: string | null;
  value: string | null;
};
export type TableRowEdit = RowIdentity & { cells: TableCellEdit[] };
export type TableEdit = {
  rows: TableRowEdit[];
  sessionId?: string;
  reviewOpen: boolean;
  applying?: boolean;
  error?: DbError;
};
export type Execution = {
  state: "running" | "success" | "failed";
  requestId: string;
  source: string;
  outdated?: boolean;
  /** Notebook execution counter shown as [n] beside the cell. */
  runNumber?: number;
  hasNextPage?: boolean;
  rowIdentities?: RowIdentity[];
  editSessionId?: string;
  result?: Result;
  error?: DbError;
};
export type TableFilter = {
  column: string;
  operator: "contains" | "equals" | "is-null";
  value: string;
};
export type TableSettings = {
  page?: number;
  pageSize?: number;
  sort?: { column: string; direction: "asc" | "desc" };
  filters?: TableFilter[];
  /** Single-filter settings saved by older versions. */
  filterColumn?: string;
  filterOperator?: TableFilter["operator"];
  filterValue?: string;
  /** Columns left out of the SELECT list. */
  hiddenColumns?: string[];
};
export type DiagramScope = { schema: string; table?: string };
export type ForeignKey = {
  name: string;
  sourceSchema: string;
  sourceTable: string;
  sourceColumns: string[];
  targetSchema: string;
  targetTable: string;
  targetColumns: string[];
};
export type Tab = {
  id: string;
  kind: "query" | "notebook" | "diagram";
  diagram?: DiagramScope;
  title: string;
  cells: Cell[];
  connectionId: string | null;
  path?: string;
  tableKey?: string;
  relation?: Relation;
  view?: "data" | "query" | "structure";
  tableSettings?: TableSettings;
  tableEdit?: TableEdit;
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
