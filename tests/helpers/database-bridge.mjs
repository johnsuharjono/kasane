import pg from "pg";
import { readFile } from "node:fs/promises";
const catalog = (await readFile("src-tauri/src/db.rs", "utf8")).match(
  /pub const CATALOG: &str = "([^"]+)";/,
)[1];
// Browser-only test bridge: real PostgreSQL sessions; connection secrets and documents are test-local.
export async function installDatabaseBridge(page, { afterCatalog } = {}) {
  const connections = [],
    sessions = new Map(),
    sqlDocuments = new Map(),
    notebooks = new Map(),
    events = [];
  const types = { getTypeParser: () => (v) => v };
  await page.exposeFunction("kasaneTestInvoke", async (command, args = {}) => {
    if (command === "plugin:window|set_theme") return;
    if (command === "list_connections") return connections;
    if (command === "list_sql_documents") return [...sqlDocuments.values()];
    if (command === "list_notebooks") return [...notebooks.values()];
    if (command === "save_connection") {
      const i = connections.findIndex((c) => c.id === args.connection.id);
      if (i >= 0) connections.splice(i, 1);
      connections.push(structuredClone(args.connection));
      return;
    }
    if (command === "save_sql_document") {
      sqlDocuments.set(args.document.id, structuredClone(args.document));
      return;
    }
    if (command === "delete_sql_document") {
      sqlDocuments.delete(args.id);
      return;
    }
    if (command === "delete_notebook") {
      notebooks.delete(args.id);
      return;
    }
    if (command === "save_notebook") {
      notebooks.set(args.notebook.id, structuredClone(args.notebook));
      return;
    }
    if (command === "test_connection") {
      const c = args.connection;
      if (![55432, 55433].includes(c.port))
        throw new Error("Only isolated fixtures are allowed");
      const client = new pg.Client({
        host: "127.0.0.1",
        port: c.port,
        database: c.database,
        user: c.username,
        password: args.password ?? "kasane_dev_only",
      });
      const start = performance.now();
      await client.connect();
      const { rows } = await client.query("SHOW server_version");
      await client.end();
      return {
        serverVersion: rows[0].server_version,
        durationMs: performance.now() - start,
      };
    }
    if (command === "open_session") {
      const c = connections.find((c) => c.id === args.connectionId);
      if (!c) throw new Error("Unknown fixture connection");
      if (
        ![55432, 55433].includes(c.port) ||
        !["kasane_dev", "kasane_analytics"].includes(c.database)
      )
        throw new Error("Only isolated fixtures are allowed");
      const client = new pg.Client({
        host: "127.0.0.1",
        port: c.port,
        database: c.database,
        user: "kasane",
        password: "kasane_dev_only",
        types,
      });
      await client.connect();
      const typeRows = (
        await client.query("SELECT oid::text,typname,typtype FROM pg_type")
      ).rows;
      const names = new Map(typeRows.map((r) => [Number(r.oid), r.typname]));
      const enums = new Set(
        typeRows.filter((r) => r.typtype === "e").map((r) => Number(r.oid)),
      );
      sessions.set(args.sessionId, {
        client,
        names,
        enums,
        connectionId: c.id,
        database: c.database,
      });
      events.push({
        command,
        sessionId: args.sessionId,
        connectionId: c.id,
        database: c.database,
      });
      return;
    }
    if (command === "close_session") {
      const s = sessions.get(args.sessionId);
      if (s) {
        events.push({
          command,
          sessionId: args.sessionId,
          connectionId: s.connectionId,
        });
        await s.client.end();
        sessions.delete(args.sessionId);
      }
      return;
    }
    if (command === "get_catalog" || command === "execute_sql") {
      const s = sessions.get(args.sessionId);
      if (!s) throw new Error("Session missing");
      const sql = command === "get_catalog" ? catalog : args.sql;
      events.push({
        command,
        sessionId: args.sessionId,
        connectionId: s.connectionId,
        database: s.database,
        sql,
      });
      const start = performance.now();
      const result = await s.client.query({ text: sql, rowMode: "array" });
      const rows = [];
      let bytes = 0;
      for (const row of result.rows) {
        const size = row.reduce(
          (n, v) => n + (v === null ? 0 : Buffer.byteLength(v)),
          0,
        );
        if (rows.length >= 1000 || bytes + size > 8 * 1024 * 1024) break;
        rows.push(row);
        bytes += size;
      }
      if (command === "get_catalog") await afterCatalog?.(s.connectionId);
      return {
        columns: result.fields.map((f) => ({
          name: f.name,
          dataType: s.names.get(f.dataTypeID),
          oid: f.dataTypeID,
          isEnum: s.enums.has(f.dataTypeID),
        })),
        rows,
        durationMs: performance.now() - start,
        returnedRows: String(result.rows.length),
        affectedRows: String(result.rowCount ?? 0),
        truncated: rows.length < result.rows.length,
        bytes,
      };
    }
    throw new Error(`Unsupported test command ${command}`);
  });
  await page.addInitScript(() => {
    window.isTauri = true;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      invoke: (command, args) => window.kasaneTestInvoke(command, args),
    };
  });
  return {
    connections,
    sessions,
    sqlDocuments,
    notebooks,
    events,
    async close() {
      for (const s of sessions.values()) await s.client.end();
      sessions.clear();
    },
  };
}
