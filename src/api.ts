import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  Connection,
  Notebook,
  Result,
  Relation,
  SQLDocument,
} from "./types";
export const native = isTauri();
export async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!native)
    throw new Error(
      "Database connections and local notebooks require the Kasane desktop app. Run npm run tauri dev.",
    );
  return invoke<T>(command, args);
}
export const api = {
  sqlDocuments: () => call<SQLDocument[]>("list_sql_documents"),
  saveSQLDocument: (document: SQLDocument) =>
    call<void>("save_sql_document", { document }),
  readSQL: (path: string) => call<string>("read_sql_file", { path }),
  writeSQL: (path: string, source: string) =>
    call<void>("write_sql_file", { path, source }),
  connections: () => call<Connection[]>("list_connections"),
  saveConnection: (connection: Connection, password?: string) =>
    call<void>("save_connection", { connection, password: password ?? null }),
  deleteConnection: (id: string) => call<void>("delete_connection", { id }),
  open: (connectionId: string, sessionId: string) =>
    call<void>("open_session", { connectionId, sessionId }),
  close: (sessionId: string) => call<void>("close_session", { sessionId }),
  execute: (sessionId: string, requestId: string, sql: string) =>
    call<Result>("execute_sql", { sessionId, requestId, sql }),
  cancel: (sessionId: string, requestId: string) =>
    call<void>("cancel_query", { sessionId, requestId }),
  notebooks: () => call<Notebook[]>("list_notebooks"),
  saveNotebook: (notebook: Notebook) =>
    call<void>("save_notebook", { notebook }),
  async catalog(sessionId: string): Promise<Relation[]> {
    const result = await call<Result>("get_catalog", { sessionId });
    if (result.truncated)
      throw new Error(
        "Catalog exceeds the current metadata limit. Some objects were omitted; narrow catalog loading is required.",
      );
    const map = new Map<string, Relation>();
    for (const [
      schema,
      name,
      kind,
      column,
      type,
      required,
      primaryKeyPosition,
      estimatedRows,
    ] of result.rows) {
      const key = JSON.stringify([schema, name]);
      if (!map.has(key))
        map.set(key, {
          schema: schema!,
          name: name!,
          kind: kind!,
          estimatedRows: estimatedRows ? Number(estimatedRows) : undefined,
          columns: [],
        });
      map.get(key)!.columns.push({
        name: column!,
        type: type!,
        required: required === "true",
        primaryKeyPosition: primaryKeyPosition
          ? Number(primaryKeyPosition)
          : undefined,
      });
    }
    return [...map.values()];
  },
};
export const quoteIdent = (value: string) => `"${value.replaceAll('"', '""')}"`;
