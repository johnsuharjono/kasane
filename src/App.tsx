import { ConnectionSwitcher } from "./components/ConnectionSwitcher";
import { SettingsDialog } from "./components/SettingsDialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
} from "./components/ui/dropdown-menu";
import {
  open as openDialog,
  save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import { TableBrowser } from "./components/TableBrowser";
import { ExecutionView } from "./components/ExecutionView";
import { tableQuery, tableCountQuery, TABLE_PAGE_SIZE } from "./table-query";
import type { TableSettings } from "./types";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "./components/ui/context-menu";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "./components/ui/resizable";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import { QueryPane } from "./components/QueryPane";
import { useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  BookOpen,
  ChevronRight,
  Database,
  FileCode2,
  Layers,
  Plus,
  Play,
  Search,
  ListFilter,
  Square,
  Table2,
  X,
  ArrowUp,
  ArrowDown,
  Trash2,
  Save,
  RefreshCw,
  Settings2,
  PanelLeftClose,
  PanelLeftOpen,
  CircleHelp,
  ArrowUpRight,
  FileText,
  Check,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button } from "./components/Button";
import { SqlEditor } from "./components/SqlEditor";
import { ConnectionDialog } from "./components/ConnectionDialog";
import { api, native, quoteIdent } from "./api";
import { useWorkspace, mutateCells } from "./store";
import {
  asError,
  uid,
  type Connection,
  type Notebook,
  type SQLDocument,
  type Relation,
  type Tab,
} from "./types";
export default function App() {
  const {
    tabs,
    activeId,
    connectionId,
    selectConnection,
    explorer,
    setExplorer,
    add,
    open,
    openSQL,
    activate,
    patch,
    close,
    editCell,
    setExecution,
  } = useWorkspace();
  const tab = tabs.find((t) => t.id === activeId);
  const [connections, setConnections] = useState<Connection[]>([]),
    [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [sqlDocuments, setSQLDocuments] = useState<SQLDocument[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const selected = connectionId ?? "";
  const [browser, setBrowser] = useState<{
    connectionId: string;
    sessionId: string;
    relations: Relation[];
  }>();
  const catalog = browser?.connectionId === selected ? browser.relations : [];
  const browseSession =
    browser?.connectionId === selected ? browser.sessionId : "";
  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [revision, setRevision] = useState(0);
  const [paused, setPaused] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const explorerState = explorer[selected] ?? { search: "", collapsed: [] };
  const search = explorerState.search;
  const setSearch = (search: string) =>
    setExplorer(selected, { ...explorerState, search });
  const visibleTabs = tabs.filter((t) => t.connectionId === connectionId);
  const visibleSQL = sqlDocuments.filter(
    (d) => d.connectionId === connectionId,
  );
  const visibleNotebooks = notebooks.filter(
    (n) => n.connectionId === connectionId,
  );
  const [connectionDialog, setConnectionDialog] = useState(false),
    [editConnection, setEditConnection] = useState<Connection>();
  const [sidebar, setSidebar] = useState(true),
    [help, setHelp] = useState(false);
  const [focusedCell, setFocusedCell] = useState<string | null>(null),
    [markdownEditing, setMarkdownEditing] = useState<string | null>(null);
  const sidebarWidth = useRef(
    Number(localStorage.getItem("kasane.sidebarWidth")) || 252,
  );
  const busy = useRef(new Set<string>());
  const catalogCache = useRef(new Map<string, Relation[]>());
  const activeConnection = connections.find((c) => c.id === tab?.connectionId);
  const refresh = async () => {
    if (!native) return;
    try {
      const [c, n, q] = await Promise.all([
        api.connections(),
        api.notebooks(),
        api.sqlDocuments(),
      ]);
      setConnections(c);
      setNotebooks(n);
      setSQLDocuments(q);
      const current = useWorkspace.getState().connectionId;
      if (!c.some((x) => x.id === current)) selectConnection(c[0]?.id ?? null);
      setReady(true);
    } catch (e) {
      setNotice(asError(e).message);
    }
  };
  useEffect(() => {
    const storageError = () =>
      setNotice(
        "Workspace restoration could not be saved. Use Cmd+S to save document source.",
      );
    window.addEventListener("kasane-storage-error", storageError);
    return () =>
      window.removeEventListener("kasane-storage-error", storageError);
  }, []);
  useEffect(() => {
    void refresh();
  }, []);
  // Ignore late catalog responses after switching connections.
  useEffect(() => {
    if (!native || !ready || !selected || paused === selected) {
      setConnecting(false);
      return;
    }
    let active = true,
      opened = false,
      released = false;
    const id = uid();
    const release = () => {
      if (opened && !released) {
        released = true;
        void api.close(id).catch(() => {});
      }
    };
    setConnecting(true);
    setBrowser(undefined);
    setNotice("");
    void (async () => {
      try {
        await api.open(selected, id);
        opened = true;
        if (!active) {
          release();
          return;
        }
        const relations = await api.catalog(id);
        if (!active) return;
        catalogCache.current.set(selected, relations);
        setBrowser({ connectionId: selected, sessionId: id, relations });
      } catch (e) {
        release();
        if (active) setNotice(asError(e).message);
      } finally {
        if (!active) release();
        else setConnecting(false);
      }
    })();
    return () => {
      active = false;
      release();
    };
  }, [selected, ready, revision, paused]);
  function connect() {
    setPaused(null);
    setRevision((v) => v + 1);
  }
  async function disconnect() {
    setPaused(selected);
    setBrowser(undefined);
    const documents = useWorkspace
      .getState()
      .tabs.filter((t) => t.connectionId === selected);
    for (const document of documents) {
      patch(document.id, (t) => ({
        ...t,
        sessionId: undefined,
        disconnected: true,
        executions: Object.fromEntries(
          Object.entries(t.executions).map(([id, e]) => [
            id,
            { ...e, outdated: true },
          ]),
        ),
      }));
    }
    await Promise.all(
      documents.map((t) =>
        t.sessionId ? api.close(t.sessionId).catch(() => {}) : undefined,
      ),
    );
  }

  async function connectionSaved(savedId?: string) {
    try {
      if (editConnection) {
        catalogCache.current.delete(editConnection.id);
        if (selected === editConnection.id) {
          setBrowser(undefined);
          connect();
        }
        for (const document of useWorkspace
          .getState()
          .tabs.filter((t) => t.connectionId === editConnection.id)) {
          if (document.sessionId)
            await api.close(document.sessionId).catch(() => {});
          patch(document.id, (t) => ({
            ...t,
            sessionId: undefined,
            disconnected: false,
            executions: Object.fromEntries(
              Object.entries(t.executions).map(([id, e]) => [
                id,
                { ...e, outdated: true },
              ]),
            ),
          }));
        }
      }
      await refresh();
      if (savedId) selectConnection(savedId);
    } catch (e) {
      setNotice(asError(e).message);
    }
  }
  async function sessionFor(t: Tab) {
    if (t.disconnected)
      throw new Error(
        "Session disconnected. Use Reconnect session before running more SQL.",
      );
    if (t.sessionId) return t.sessionId;
    if (!t.connectionId)
      throw new Error("Choose a saved connection before running SQL.");
    const id = uid();
    await api.open(t.connectionId, id);
    if (!catalogCache.current.has(t.connectionId)) {
      try {
        catalogCache.current.set(t.connectionId, await api.catalog(id));
      } catch (e) {
        await api.close(id);
        throw e;
      }
    }
    patch(t.id, (x) => ({ ...x, sessionId: id }));
    return id;
  }
  async function runTable(t: Tab, settings: TableSettings) {
    if (!t.relation || busy.current.has(t.id)) return;
    busy.current.add(t.id);
    const requestId = uid(),
      source = tableQuery(t.relation, settings);
    patch(t.id, (t) => ({ ...t, tableSettings: settings }));
    setExecution(t.id, "table-data", { state: "running", requestId, source });
    try {
      const sessionId = await sessionFor(t);
      const fetched = await api.execute(sessionId, requestId, source);
      const pageSize = TABLE_PAGE_SIZE;
      const rows = fetched.rows.slice(0, pageSize);
      const result = { ...fetched, rows, returnedRows: String(rows.length) };
      setExecution(t.id, "table-data", {
        hasNextPage: !fetched.truncated && fetched.rows.length > pageSize,
        state: "success",
        requestId,
        source,
        result,
      });
    } catch (e) {
      const error = asError(e);
      setExecution(t.id, "table-data", {
        state: "failed",
        requestId,
        source,
        error,
      });
      if (error.disconnected)
        patch(t.id, (t) => ({ ...t, disconnected: true }));
    } finally {
      busy.current.delete(t.id);
    }
  }
  async function countTable(t: Tab) {
    if (!t.relation || busy.current.has(t.id)) return;
    busy.current.add(t.id);
    const requestId = uid(),
      source = tableCountQuery(
        t.relation,
        t.tableSettings ?? {
          filterColumn: "",
          filterOperator: "contains",
          filterValue: "",
        },
      );
    setExecution(t.id, "table-count", { state: "running", requestId, source });
    try {
      const sessionId = await sessionFor(t);
      const result = await api.execute(sessionId, requestId, source);
      setExecution(t.id, "table-count", {
        state: "success",
        requestId,
        source,
        result,
      });
    } catch (e) {
      const error = asError(e);
      setExecution(t.id, "table-count", {
        state: "failed",
        requestId,
        source,
        error,
      });
      if (error.disconnected)
        patch(t.id, (t) => ({ ...t, disconnected: true }));
    } finally {
      busy.current.delete(t.id);
    }
  }
  async function runCells(t: Tab, cellIds: string[]) {
    if (busy.current.has(t.id)) return;
    busy.current.add(t.id);
    setNotice("");
    try {
      for (const cellId of cellIds) {
        const current = useWorkspace.getState().tabs.find((x) => x.id === t.id);
        const cell = current?.cells.find((c) => c.id === cellId);
        if (!current || !cell || cell.kind !== "sql") continue;
        const requestId = uid(),
          source = cell.source;
        patch(t.id, (t) => ({
          ...t,
          executions: Object.fromEntries(
            Object.entries(t.executions).map(([id, e]) => [
              id,
              id === "table-data" ||
              t.cells.findIndex((c) => c.id === id) >
                t.cells.findIndex((c) => c.id === cellId)
                ? { ...e, outdated: true }
                : e,
            ]),
          ),
        }));
        setExecution(t.id, cellId, { state: "running", requestId, source });
        // Session state may have been changed by a preceding cell; never reconnect/retry a failed execution.
        try {
          const sessionId = await sessionFor(current);
          const result = await api.execute(sessionId, requestId, source);
          setExecution(t.id, cellId, {
            state: "success",
            requestId,
            source,
            result,
            outdated: useWorkspace.getState().tabs.find((x) => x.id === t.id)
              ?.executions[cellId]?.outdated,
          });
        } catch (e) {
          const error = asError(e);
          setExecution(t.id, cellId, {
            state: "failed",
            requestId,
            source,
            error,
          });
          if (error.disconnected)
            patch(t.id, (x) => ({ ...x, disconnected: true }));
          break;
        }
      }
    } finally {
      busy.current.delete(t.id);
    }
  }
  async function cancel(t: Tab) {
    const running = Object.values(t.executions).find(
      (e) => e.state === "running",
    );
    if (t.sessionId && running)
      try {
        await api.cancel(t.sessionId, running.requestId);
      } catch (e) {
        setNotice(asError(e).message);
      }
  }
  async function openSQLFile() {
    try {
      const path = await openDialog({
        multiple: false,
        filters: [{ name: "SQL", extensions: ["sql"] }],
      });
      if (!path) return;
      const existing = useWorkspace
        .getState()
        .tabs.find((t) => t.path === path);
      if (existing) {
        activate(existing.id);
        return;
      }
      const source = await api.readSQL(path);
      add("query", selected || null, source);
      const id = useWorkspace.getState().activeId!;
      patch(id, (t) => ({
        ...t,
        path,
        title: path
          .split(/[\\/]/)
          .at(-1)!
          .replace(/\.sql$/i, ""),
        dirty: true,
      }));
    } catch (e) {
      setNotice(asError(e).message);
    }
  }
  async function save(t: Tab) {
    if (t.kind === "query" && !t.relation) {
      try {
        const document: SQLDocument = {
          version: 1,
          id: t.id,
          title: t.title,
          connectionId: t.connectionId,
          source: t.cells[0].source,
        };
        await api.saveSQLDocument(document);
        patch(t.id, (current) => ({
          ...current,
          dirty:
            current.cells[0].source !== document.source ||
            current.title !== document.title ||
            current.connectionId !== document.connectionId,
        }));
        await refresh();
        setNotice("SQL document saved locally.");
      } catch (e) {
        setNotice(asError(e).message);
      }
      return;
    }
    if (t.kind !== "notebook") return;
    const notebook: Notebook = {
      version: 1,
      id: t.id,
      title: t.title,
      connectionId: t.connectionId,
      cells: t.cells.map(({ id, kind, source }) => ({ id, kind, source })),
    };
    try {
      await api.saveNotebook(notebook);
      patch(t.id, (x) => ({
        ...x,
        dirty:
          JSON.stringify(x.cells) !== JSON.stringify(t.cells) ||
          x.title !== t.title,
      }));
      await refresh();
      setNotice("Notebook saved locally. SQL results are kept in memory only.");
    } catch (e) {
      setNotice(asError(e).message);
    }
  }
  async function exportSQL(t: Tab) {
    try {
      let path = await saveDialog({
        defaultPath: t.title.endsWith(".sql") ? t.title : t.title + ".sql",
        filters: [{ name: "SQL", extensions: ["sql"] }],
      });
      if (!path) return;
      if (!path.toLowerCase().endsWith(".sql")) path += ".sql";
      await api.writeSQL(path, t.cells[0].source);
      setNotice("SQL exported.");
    } catch (e) {
      setNotice(asError(e).message);
    }
  }
  async function closeTab(t: Tab) {
    if (Object.values(t.executions).some((e) => e.state === "running")) {
      setNotice("Cancel the running query before closing this tab.");
      return;
    }
    if ((t.kind === "notebook" || !t.relation) && t.dirty) {
      await save(t);
      if (useWorkspace.getState().tabs.find((x) => x.id === t.id)?.dirty)
        return;
    }
    if (t.sessionId) await api.close(t.sessionId).catch(() => {});
    close(t.id);
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const t = useWorkspace
        .getState()
        .tabs.find((t) => t.id === useWorkspace.getState().activeId);
      if (e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      }
      if (e.key === "s" && t && !t.relation) {
        e.preventDefault();
        void save(t);
      }
      if (e.key === "o") {
        e.preventDefault();
        void openSQLFile();
      }
      if (e.key === "t") {
        e.preventDefault();
        add(e.shiftKey ? "notebook" : "query", selected || null);
      }
      if (e.key === "w" && t) {
        e.preventDefault();
        void closeTab(t);
      }
      if (e.key === "\\") {
        e.preventDefault();
        setSidebar((v) => !v);
      }
    };
    const menu = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;
      const t = useWorkspace
        .getState()
        .tabs.find((t) => t.id === useWorkspace.getState().activeId);
      if (action === "settings") setSettingsOpen(true);
      if (action === "open-sql") void openSQLFile();
      if (action === "new-query") add("query", selected || null);
      if (action === "new-notebook") add("notebook", selected || null);
      if (action === "save-notebook" && t) void save(t);
      if (action === "close-tab" && t) void closeTab(t);
    };
    window.addEventListener("keydown", key);
    window.addEventListener("kasane-menu", menu);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("kasane-menu", menu);
    };
  }, [selected]);
  const schemas = [...new Set(catalog.map((r) => r.schema))];
  const running =
    !!tab && Object.values(tab.executions).some((e) => e.state === "running");
  const currentCatalog =
    catalogCache.current.get(tab?.connectionId ?? "") ?? [];
  function openTable(
    r: Relation,
    view: "data" | "query" | "structure" = "data",
  ) {
    if (view === "query") {
      add(
        "query",
        selected,
        `SELECT *\nFROM ${quoteIdent(r.schema)}.${quoteIdent(r.name)}\nLIMIT 500;`,
      );
      return;
    }
    const tableKey = JSON.stringify([selected, r.schema, r.name]);
    const existing = useWorkspace
      .getState()
      .tabs.find((t) => t.tableKey === tableKey);
    if (existing) {
      activate(existing.id);
      patch(existing.id, (t) => ({ ...t, view, relation: r }));
      return;
    }
    add(
      "query",
      selected,
      `SELECT *\nFROM ${quoteIdent(r.schema)}.${quoteIdent(r.name)}\nLIMIT 500;`,
    );
    const t = useWorkspace.getState().tabs.at(-1)!;
    patch(t.id, (t) => ({
      ...t,
      title: r.name,
      tableKey,
      relation: r,
      view,
      tableSettings: {
        page: 0,
        filterColumn: "",
        filterOperator: "contains",
        filterValue: "",
      },
    }));
  }
  function newCell(kind: "sql" | "markdown") {
    if (!tab) return;
    const cell = { id: uid(), kind, source: kind === "sql" ? "SELECT " : "" };
    patch(tab.id, (t) => mutateCells(t, [...t.cells, cell]));
    setFocusedCell(cell.id);
    if (kind === "markdown") setMarkdownEditing(cell.id);
  }
  return (
    <div className={`app ${sidebar ? "" : "sidebar-hidden"}`}>
      <header className="titlebar" data-tauri-drag-region>
        <div className="traffic-space" />
        <div className="titlebar-brand" data-tauri-drag-region>
          <Layers size={15} />
          <strong>Kasane</strong>
          <span>重ね</span>
        </div>
        <Button
          className="quiet icon"
          aria-label="Keyboard shortcuts"
          onClick={() => setHelp(!help)}
        >
          <CircleHelp size={16} />
        </Button>
      </header>
      <ResizablePanelGroup
        orientation="horizontal"
        className="workspace-panels"
      >
        {sidebar && (
          <>
            <ResizablePanel
              id="sidebar"
              defaultSize={sidebarWidth.current}
              minSize={200}
              maxSize={420}
              onResize={(size) => {
                sidebarWidth.current = size.inPixels;
                localStorage.setItem(
                  "kasane.sidebarWidth",
                  String(size.inPixels),
                );
              }}
            >
              <aside className="sidebar">
                <div className="sidebar-top">
                  <span className="eyebrow">WORKSPACE</span>
                  <Button
                    className="icon quiet"
                    aria-label="Hide sidebar"
                    onClick={() => setSidebar(false)}
                  >
                    <PanelLeftClose size={15} />
                  </Button>
                </div>
                <ConnectionSwitcher
                  connections={connections}
                  selected={selected}
                  connected={!!browseSession}
                  connecting={connecting}
                  busy={tabs.some(
                    (t) =>
                      t.connectionId === selected &&
                      Object.values(t.executions).some(
                        (e) => e.state === "running",
                      ),
                  )}
                  onSelect={(id) => {
                    setPaused(null);
                    selectConnection(id);
                  }}
                  onAdd={() => {
                    setEditConnection(undefined);
                    setConnectionDialog(true);
                  }}
                  onEdit={(c) => {
                    setEditConnection(c);
                    setConnectionDialog(true);
                  }}
                  onConnect={connect}
                  onDisconnect={() => void disconnect()}
                />
                <div className="sidebar-divider" />
                <div className="section-label">
                  <span>Database explorer</span>
                  <span className="tiny-label">{catalog.length || "—"}</span>
                </div>
                <div className="sidebar-search">
                  <Search size={13} />
                  <Input
                    className="h-auto border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                    placeholder="Filter tables…"
                    aria-label="Filter tables"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <kbd>⌕</kbd>
                </div>
                <div className="schema-tree">
                  {schemas.map((schema) => (
                    <details
                      key={`${selected}:${schema}`}
                      open={!explorerState.collapsed.includes(schema)}
                      onToggle={(e) => {
                        const collapsed = explorerState.collapsed.filter(
                          (s) => s !== schema,
                        );
                        if (!e.currentTarget.open) collapsed.push(schema);
                        if (
                          collapsed.join("\0") !==
                          explorerState.collapsed.join("\0")
                        )
                          setExplorer(selected, {
                            ...explorerState,
                            collapsed,
                          });
                      }}
                    >
                      <summary>
                        <ChevronRight size={13} />
                        <Layers size={14} />
                        {schema}
                        <small>
                          {catalog.filter((r) => r.schema === schema).length}
                        </small>
                      </summary>
                      {catalog
                        .filter(
                          (r) =>
                            r.schema === schema &&
                            `${r.name} ${r.columns.map((c) => c.name).join(" ")}`
                              .toLowerCase()
                              .includes(search.toLowerCase()),
                        )
                        .map((r) => (
                          <ContextMenu key={r.name}>
                            <ContextMenuTrigger
                              render={
                                <button
                                  className="table-entry"
                                  title={`Open ${schema}.${r.name}`}
                                  onClick={() => openTable(r)}
                                />
                              }
                            >
                              <Table2 size={14} />
                              <span>{r.name}</span>
                              {r.kind !== "table" && <small>{r.kind}</small>}
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                              <ContextMenuItem
                                onClick={() => openTable(r, "data")}
                              >
                                Open Data
                              </ContextMenuItem>
                              <ContextMenuItem
                                onClick={() => openTable(r, "query")}
                              >
                                Open SQL
                              </ContextMenuItem>
                              <ContextMenuItem
                                onClick={() => openTable(r, "structure")}
                              >
                                View Structure
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        ))}
                    </details>
                  ))}
                  {!browseSession && (
                    <div className="sidebar-hint">
                      {connecting ? (
                        "Loading schemas…"
                      ) : selected ? (
                        <Button className="quiet small" onClick={connect}>
                          Connect to browse
                        </Button>
                      ) : (
                        "Add a connection to browse."
                      )}
                    </div>
                  )}
                </div>
                <div className="sidebar-divider" />
                <div className="section-label">
                  <span>SQL documents</span>
                  <Button
                    className="quiet icon"
                    aria-label="New SQL document"
                    onClick={() => add("query", selected || null)}
                  >
                    <Plus size={15} />
                  </Button>
                </div>
                <div
                  className="notebook-list sql-library"
                  aria-label="SQL documents"
                >
                  {visibleSQL.map((d) => (
                    <button key={d.id} onClick={() => openSQL(d)}>
                      <FileCode2 size={14} />
                      <span>
                        {tabs.find((t) => t.id === d.id)?.title ?? d.title}
                      </span>
                    </button>
                  ))}
                  {!visibleSQL.length && (
                    <div className="sidebar-hint">No saved SQL documents.</div>
                  )}
                </div>
                <div className="section-label">
                  <span>Notebooks</span>
                  <Button
                    className="quiet icon"
                    aria-label="New notebook"
                    onClick={() => add("notebook", selected || null)}
                  >
                    <Plus size={15} />
                  </Button>
                </div>
                <div className="notebook-list">
                  {visibleNotebooks.map((n) => (
                    <button key={n.id} onClick={() => open(n)}>
                      <BookOpen size={14} />
                      <span>{n.title}</span>
                    </button>
                  ))}
                  {!visibleNotebooks.length && (
                    <div className="sidebar-hint">No saved notebooks.</div>
                  )}
                </div>
                <div className="sidebar-bottom">
                  <div className="brand-stamp">重</div>
                  <span>
                    PostgreSQL<small>Local workspace</small>
                  </span>
                  <Button
                    className="quiet icon"
                    aria-label="Settings"
                    onClick={() => setSettingsOpen(true)}
                  >
                    <Settings2 size={15} />
                  </Button>
                </div>
              </aside>
            </ResizablePanel>
            <ResizableHandle aria-label="Resize sidebar" withHandle />
          </>
        )}
        <ResizablePanel id="workspace" minSize={480}>
          <main className="workspace">
            <nav className="tabbar" aria-label="Open documents">
              {!sidebar && (
                <Button
                  className="icon quiet"
                  aria-label="Show sidebar"
                  onClick={() => setSidebar(true)}
                >
                  <PanelLeftOpen size={16} />
                </Button>
              )}
              {visibleTabs.map((t) => (
                <div
                  key={t.id}
                  className={`tab ${activeId === t.id ? "active" : ""}`}
                >
                  <button onClick={() => activate(t.id)}>
                    {t.kind === "query" ? (
                      <FileCode2 size={14} />
                    ) : (
                      <BookOpen size={14} />
                    )}
                    <span>{t.title}</span>
                    {t.dirty && !t.relation && <span className="dirty-dot" />}
                  </button>
                  <Button
                    className="quiet icon"
                    aria-label={`Close ${t.title}`}
                    onClick={() => closeTab(t)}
                  >
                    <X size={12} />
                  </Button>
                </div>
              ))}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      className="quiet icon new-tab"
                      aria-label="New document"
                    />
                  }
                >
                  <Plus size={16} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    onClick={() => add("query", selected || null)}
                  >
                    SQL document<DropdownMenuShortcut>⌘T</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => add("notebook", selected || null)}
                  >
                    Notebook<DropdownMenuShortcut>⌘⇧T</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void openSQLFile()}>
                    Import SQL…
                    <DropdownMenuShortcut>⌘O</DropdownMenuShortcut>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <span className="spacer" />
              <Button
                className="quiet icon tabbar-action"
                aria-label="Import SQL"
                onClick={() => void openSQLFile()}
              >
                <FolderOpen size={16} />
              </Button>
              <span className="local-badge">LOCAL WORKSPACE</span>
            </nav>
            {notice && (
              <div className="notice" role="status">
                <span>{notice}</span>
                <Button
                  className="quiet icon"
                  aria-label="Dismiss notice"
                  onClick={() => setNotice("")}
                >
                  <X size={13} />
                </Button>
              </div>
            )}
            {!native && (
              <div className="desktop-note">
                Desktop services are unavailable in a browser. Launch with{" "}
                <code>npm run tauri dev</code> to connect and save notebooks.
              </div>
            )}
            {!tab ? (
              <div className="welcome">
                <div className="welcome-mark">
                  <Layers size={44} strokeWidth={1} />
                  <span>重ね</span>
                </div>
                <span className="eyebrow">POSTGRESQL WORKSPACE</span>
                <h1>Kasane</h1>
                <p>Connect to a database or create a notebook.</p>
                <div className="welcome-actions">
                  <Button
                    className="primary"
                    onClick={() => {
                      setEditConnection(undefined);
                      setConnectionDialog(true);
                    }}
                  >
                    <Database size={15} />
                    Add a connection
                    <ArrowUpRight size={14} />
                  </Button>
                  <Button onClick={() => add("notebook", selected || null)}>
                    <BookOpen size={15} />
                    Create a notebook
                  </Button>
                </div>
                <div className="welcome-footnote">
                  <kbd>⌘ T</kbd> new SQL document<span>·</span>
                  <kbd>⌘ ⇧ T</kbd> new notebook
                </div>
              </div>
            ) : (
              <>
                {tab.kind === "query" && !tab.relation && (
                  <div className="sql-document-heading">
                    <Input
                      aria-label="SQL document title"
                      value={tab.title}
                      maxLength={200}
                      onChange={(e) =>
                        patch(tab.id, (t) => ({
                          ...t,
                          title: e.target.value,
                          dirty: true,
                        }))
                      }
                    />
                    <small>
                      {tab.dirty ? "Unsaved changes" : "Saved locally"}
                    </small>
                    <Button
                      className="quiet small"
                      onClick={() => void exportSQL(tab)}
                    >
                      Export SQL
                    </Button>
                  </div>
                )}
                {(!tab.relation || tab.disconnected) && (
                  <div className="document-toolbar">
                    {!tab.relation && (
                      <div className="document-context">
                        <span className="context-dot" />
                        <span title={activeConnection?.name}>
                          {activeConnection?.database ?? "Local drafts"}
                        </span>
                      </div>
                    )}
                    <span className="toolbar-caption">
                      {tab.kind === "notebook"
                        ? "Dedicated notebook session"
                        : tab.relation
                          ? "Table session"
                          : "Query session"}
                      {tab.sessionId ? " · connected" : ""}
                    </span>
                    <span className="spacer" />
                    {tab.disconnected && (
                      <Button
                        className="quiet"
                        disabled={running}
                        onClick={async () => {
                          try {
                            if (tab.sessionId)
                              await api.close(tab.sessionId).catch(() => {});
                            const t = {
                              ...tab,
                              sessionId: undefined,
                              disconnected: false,
                            };
                            await sessionFor(t);
                            patch(tab.id, (x) => ({
                              ...mutateCells(x, x.cells),
                              disconnected: false,
                            }));
                          } catch (e) {
                            setNotice(asError(e).message);
                          }
                        }}
                      >
                        Reconnect session
                      </Button>
                    )}
                    {tab.sessionId && !tab.disconnected && !tab.relation && (
                      <Button
                        className="quiet"
                        disabled={running}
                        onClick={async () => {
                          await api.close(tab.sessionId!);
                          patch(tab.id, (t) => ({
                            ...mutateCells(t, t.cells),
                            sessionId: undefined,
                          }));
                        }}
                      >
                        Reset session
                      </Button>
                    )}
                    {!tab.relation && (
                      <Button className="quiet" onClick={() => save(tab)}>
                        <Save size={14} />
                        Save<kbd>⌘S</kbd>
                      </Button>
                    )}
                    {running ? (
                      <Button className="danger" onClick={() => cancel(tab)}>
                        <Square size={12} />
                        Cancel
                      </Button>
                    ) : tab.relation && tab.view !== "query" ? null : (
                      <Button
                        className="primary"
                        disabled={!tab.connectionId || tab.view === "structure"}
                        onClick={() =>
                          runCells(
                            tab,
                            tab.kind === "query"
                              ? [tab.cells[0].id]
                              : tab.cells
                                  .filter((c) => c.kind === "sql")
                                  .map((c) => c.id),
                          )
                        }
                      >
                        <Play size={12} fill="currentColor" />
                        {tab.kind === "query" ? "Run query" : "Run all"}
                        {tab.kind === "query" && <kbd>⌘↵</kbd>}
                      </Button>
                    )}
                  </div>
                )}
                {tab.kind === "query" ? (
                  <>
                    {tab.relation && (
                      <Tabs
                        value={tab.view ?? "data"}
                        onValueChange={(view) =>
                          patch(tab.id, (t) => ({
                            ...t,
                            view: view as "data" | "structure",
                          }))
                        }
                        className="table-view-switch"
                      >
                        <TabsList>
                          <TabsTrigger value="data">Data</TabsTrigger>
                          <TabsTrigger value="structure">Structure</TabsTrigger>
                        </TabsList>
                        <span className="table-breadcrumb">
                          {activeConnection?.database} / {tab.relation.schema}.
                          {tab.relation.name}
                        </span>
                        {tab.view === "data" && (
                          <>
                            <Button
                              className="quiet small"
                              aria-label="Filter rows"
                              aria-expanded={!!tab.filtersOpen}
                              onClick={() =>
                                patch(tab.id, (t) => ({
                                  ...t,
                                  filtersOpen: !t.filtersOpen,
                                }))
                              }
                            >
                              <ListFilter size={14} />
                              Filter
                              {tab.tableSettings?.filterColumn && (
                                <span className="filter-count">1</span>
                              )}
                            </Button>
                            {running ? (
                              <Button
                                className="danger small"
                                onClick={() => cancel(tab)}
                              >
                                <Square size={12} />
                                Cancel
                              </Button>
                            ) : (
                              <Button
                                className="quiet icon"
                                aria-label="Refresh table data"
                                onClick={() =>
                                  void runTable(
                                    tab,
                                    tab.tableSettings ?? {
                                      filterColumn: "",
                                      filterOperator: "contains",
                                      filterValue: "",
                                    },
                                  )
                                }
                              >
                                <RefreshCw size={14} />
                              </Button>
                            )}
                          </>
                        )}
                      </Tabs>
                    )}
                    {tab.view === "structure" && tab.relation ? (
                      <div className="structure-view">
                        <h2>{tab.relation.name}</h2>
                        <p>
                          {tab.relation.schema} · {tab.relation.kind}
                        </p>
                        <table>
                          <thead>
                            <tr>
                              <th>Column</th>
                              <th>Type</th>
                              <th>Nullable</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tab.relation.columns.map((c) => (
                              <tr key={c.name}>
                                <td>{c.name}</td>
                                <td>{c.type}</td>
                                <td>{c.required ? "No" : "Yes"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : tab.view === "data" && tab.relation ? (
                      <TableBrowser
                        key={tab.id}
                        tab={tab}
                        onExecute={(settings) => void runTable(tab, settings)}
                        onCount={() => void countTable(tab)}
                      />
                    ) : (
                      <QueryPane
                        key={tab.id}
                        source={tab.cells[0].source}
                        onChange={(v) => editCell(tab.id, tab.cells[0].id, v)}
                        onRun={() => runCells(tab, [tab.cells[0].id])}
                        catalog={currentCatalog}
                        height={tab.editorHeight}
                        onResize={(editorHeight) =>
                          patch(tab.id, (t) => ({ ...t, editorHeight }))
                        }
                      >
                        <ExecutionView
                          execution={tab.executions[tab.cells[0].id]}
                        />
                      </QueryPane>
                    )}
                  </>
                ) : (
                  <div className="notebook-document">
                    <div className="notebook-heading">
                      <span className="eyebrow">
                        <BookOpen size={13} />
                        NOTEBOOK
                      </span>
                      <Input
                        className="notebook-title h-auto rounded-none border-0 bg-transparent p-0 text-[2.6rem] md:text-[2.6rem] leading-tight shadow-none focus-visible:ring-0"
                        aria-label="Notebook title"
                        value={tab.title}
                        onChange={(e) =>
                          patch(tab.id, (t) => ({
                            ...t,
                            title: e.target.value,
                            dirty: true,
                          }))
                        }
                      />
                      <p>
                        {activeConnection?.database ?? "Offline"}
                        <span>·</span>
                        {tab.cells.length} cells<span>·</span>
                        {tab.dirty ? "Unsaved changes" : "Saved locally"}
                      </p>
                    </div>
                    <div className="notebook-cells">
                      {tab.cells.map((cell, index) => (
                        <section
                          key={cell.id}
                          className={`notebook-cell ${focusedCell === cell.id ? "focused" : ""}`}
                          onFocus={() => setFocusedCell(cell.id)}
                        >
                          <div className="cell-gutter">
                            <span>{String(index + 1).padStart(2, "0")}</span>
                            {cell.kind === "sql" ? (
                              <FileCode2 size={14} />
                            ) : (
                              <FileText size={14} />
                            )}
                          </div>
                          <div className="cell-main">
                            <div className="cell-toolbar">
                              <span className="eyebrow">
                                {cell.kind === "sql" ? "SQL" : "MARKDOWN"}
                              </span>
                              {cell.kind === "sql" &&
                                tab.executions[cell.id]?.state === "success" &&
                                !tab.executions[cell.id]?.outdated && (
                                  <span className="cell-complete">
                                    <Check size={11} />
                                    Complete
                                  </span>
                                )}
                              <span className="spacer" />
                              {cell.kind === "markdown" && (
                                <Button
                                  className="quiet small"
                                  onClick={() =>
                                    setMarkdownEditing(
                                      markdownEditing === cell.id
                                        ? null
                                        : cell.id,
                                    )
                                  }
                                >
                                  {markdownEditing === cell.id
                                    ? "Done"
                                    : "Edit"}
                                </Button>
                              )}
                              <Button
                                className="quiet icon"
                                aria-label={`Move cell ${index + 1} up`}
                                disabled={index === 0 || running}
                                onClick={() =>
                                  patch(tab.id, (t) => {
                                    const cells = [...t.cells];
                                    [cells[index - 1], cells[index]] = [
                                      cells[index],
                                      cells[index - 1],
                                    ];
                                    return mutateCells(t, cells);
                                  })
                                }
                              >
                                <ArrowUp size={13} />
                              </Button>
                              <Button
                                className="quiet icon"
                                aria-label={`Move cell ${index + 1} down`}
                                disabled={
                                  index === tab.cells.length - 1 || running
                                }
                                onClick={() =>
                                  patch(tab.id, (t) => {
                                    const cells = [...t.cells];
                                    [cells[index], cells[index + 1]] = [
                                      cells[index + 1],
                                      cells[index],
                                    ];
                                    return mutateCells(t, cells);
                                  })
                                }
                              >
                                <ArrowDown size={13} />
                              </Button>
                              <Button
                                className="quiet icon"
                                aria-label={`Delete cell ${index + 1}`}
                                disabled={running}
                                onClick={() =>
                                  patch(tab.id, (t) =>
                                    mutateCells(
                                      t,
                                      t.cells.filter((c) => c.id !== cell.id),
                                    ),
                                  )
                                }
                              >
                                <Trash2 size={13} />
                              </Button>
                              {cell.kind === "sql" && (
                                <Button
                                  className="quiet small run-cell"
                                  disabled={running || !tab.connectionId}
                                  onClick={() => runCells(tab, [cell.id])}
                                >
                                  <Play size={11} />
                                  Run cell
                                </Button>
                              )}
                            </div>
                            {cell.kind === "sql" ? (
                              <>
                                <SqlEditor
                                  compact
                                  value={cell.source}
                                  onChange={(v) => editCell(tab.id, cell.id, v)}
                                  onRun={() => runCells(tab, [cell.id])}
                                  catalog={currentCatalog}
                                />
                                <ExecutionView
                                  compact
                                  execution={tab.executions[cell.id]}
                                />
                              </>
                            ) : markdownEditing === cell.id ? (
                              <Textarea
                                autoFocus
                                aria-label={`Markdown cell ${index + 1}`}
                                className="markdown-editor"
                                value={cell.source}
                                onChange={(e) =>
                                  editCell(tab.id, cell.id, e.target.value)
                                }
                                onKeyDown={(e) => {
                                  if (
                                    (e.metaKey || e.ctrlKey) &&
                                    e.key === "Enter"
                                  ) {
                                    e.preventDefault();
                                    setMarkdownEditing(null);
                                  }
                                }}
                              />
                            ) : (
                              <div
                                className="markdown-content"
                                onDoubleClick={() =>
                                  setMarkdownEditing(cell.id)
                                }
                              >
                                <ReactMarkdown
                                  allowedElements={[
                                    "h1",
                                    "h2",
                                    "h3",
                                    "h4",
                                    "p",
                                    "strong",
                                    "em",
                                    "code",
                                    "pre",
                                    "ul",
                                    "ol",
                                    "li",
                                    "blockquote",
                                    "hr",
                                    "a",
                                    "br",
                                    "del",
                                  ]}
                                  unwrapDisallowed
                                  components={{
                                    a: ({ children }) => (
                                      <span className="markdown-link">
                                        {children}
                                      </span>
                                    ),
                                  }}
                                >
                                  {cell.source ||
                                    "Double-click to write a note…"}
                                </ReactMarkdown>
                              </div>
                            )}
                          </div>
                        </section>
                      ))}
                    </div>
                    <div className="add-cell">
                      <span />
                      <Button
                        className="quiet"
                        onClick={() => newCell("sql")}
                        disabled={running}
                      >
                        <Plus size={13} />
                        SQL cell
                      </Button>
                      <Button
                        className="quiet"
                        onClick={() => newCell("markdown")}
                        disabled={running}
                      >
                        <Plus size={13} />
                        Markdown
                      </Button>
                      <span />
                    </div>
                  </div>
                )}
              </>
            )}
            <footer className="workspace-footer">
              <span
                className={`status-dot ${browseSession ? "" : "offline"}`}
              />
              {browseSession ? "Browser connected" : "Local workspace"}
              <span className="spacer" />
              <span>⌘ Enter to run</span>
              <span className="footer-separator" />
              PostgreSQL
            </footer>
          </main>
        </ResizablePanel>
      </ResizablePanelGroup>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      {connectionDialog && (
        <ConnectionDialog
          key={editConnection?.id ?? "new"}
          initial={editConnection}
          open={connectionDialog}
          onOpenChange={setConnectionDialog}
          onSaved={(id) => void connectionSaved(id)}
        />
      )}
      {help && (
        <div className="help-popover">
          <strong>Make yourself at home</strong>
          <Button
            className="quiet icon"
            aria-label="Close keyboard shortcuts"
            onClick={() => setHelp(false)}
          >
            <X size={13} />
          </Button>
          {[
            ["⌘ T", "New SQL document"],
            ["⌘ ⇧ T", "New notebook"],
            ["⌘ Enter", "Run SQL cell or query"],
            ["⌘ S", "Save document"],
            ["⌘ O", "Import SQL"],
            ["⌘ ,", "Settings"],
            ["⌘ W", "Close tab (saves notebook)"],
            ["⌘ \\", "Toggle sidebar"],
            ["⇧ Arrows", "Extend grid selection"],
            ["⌘ C", "Copy selected cells"],
            ["Enter", "Inspect selected cell"],
          ].map(([k, v]) => (
            <div key={k}>
              <span>{v}</span>
              <kbd>{k}</kbd>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
