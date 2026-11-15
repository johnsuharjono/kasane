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
import {
  tableQuery,
  tableCountQuery,
  TABLE_PAGE_SIZE,
  defaultTableSettings,
} from "./table-query";
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
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CommandPalette,
  type PaletteAction,
} from "./components/CommandPalette";
import { useAppearance } from "./appearance";
import { connectionColor } from "./connection-colors";
import {
  FolderOpen,
  BookOpen,
  BookPlus,
  FilePlus2,
  Moon,
  Sun,
  PanelLeft,
  Code2,
  Eye,
  Filter,
  KeyRound,
  ChevronRight,
  Database,
  FileCode2,
  Plus,
  Play,
  Search,
  Square,
  Table2,
  X,
  ArrowUp,
  ArrowDown,
  Trash2,
  Save,
  RefreshCw,
  CircleHelp,
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
  // Success messages fade on their own; errors stay until dismissed.
  const [flash, setFlash] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [hiddenTabs, setHiddenTabs] = useState<string[]>([]);
  const tabStrip = useRef<HTMLElement>(null);
  const { resolved: theme, setAppearance } = useAppearance();
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
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(""), 6000);
    return () => clearTimeout(timer);
  }, [flash]);
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
          source = cell.source,
          runNumber =
            Math.max(
              0,
              ...Object.values(current.executions).map((e) => e.runNumber ?? 0),
            ) + 1;
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
        setExecution(t.id, cellId, {
          state: "running",
          requestId,
          source,
          runNumber,
        });
        // Session state may have been changed by a preceding cell; never reconnect/retry a failed execution.
        try {
          const sessionId = await sessionFor(current);
          const result = await api.execute(sessionId, requestId, source);
          setExecution(t.id, cellId, {
            state: "success",
            requestId,
            source,
            runNumber,
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
            runNumber,
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
        setFlash("SQL document saved locally.");
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
      setFlash("Notebook saved locally. SQL results are kept in memory only.");
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
      setFlash("SQL exported.");
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
      if (e.key.toLowerCase() === "k" && !e.shiftKey) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === "Enter" && e.shiftKey && t?.kind === "notebook") {
        e.preventDefault();
        runAll(t);
      }
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
    const cell = { id: uid(), kind, source: "" };
    patch(tab.id, (t) => mutateCells(t, [...t.cells, cell]));
    setFocusedCell(cell.id);
    if (kind === "markdown") setMarkdownEditing(cell.id);
  }
  function runAll(t: Tab) {
    void runCells(
      t,
      t.kind === "query"
        ? [t.cells[0].id]
        : t.cells.filter((c) => c.kind === "sql").map((c) => c.id),
    );
  }
  async function reconnect(t: Tab) {
    try {
      if (t.sessionId) await api.close(t.sessionId).catch(() => {});
      await sessionFor({ ...t, sessionId: undefined, disconnected: false });
      patch(t.id, (x) => ({
        ...mutateCells(x, x.cells),
        disconnected: false,
      }));
    } catch (e) {
      setNotice(asError(e).message);
    }
  }
  async function resetSession(t: Tab) {
    await api.close(t.sessionId!);
    patch(t.id, (x) => ({ ...mutateCells(x, x.cells), sessionId: undefined }));
  }
  function refreshTable(t: Tab) {
    void runTable(t, t.tableSettings ?? defaultTableSettings);
  }
  // Tabs scroll horizontally; those outside the strip are listed in a "+N" menu.
  useLayoutEffect(() => {
    const strip = tabStrip.current;
    if (!strip) return;
    const measure = () => {
      const left = strip.scrollLeft,
        right = left + strip.clientWidth;
      const hidden: string[] = [];
      for (const el of strip.querySelectorAll<HTMLElement>("[data-tab-id]"))
        if (
          el.offsetLeft < left - 1 ||
          el.offsetLeft + el.offsetWidth > right + 1
        )
          hidden.push(el.dataset.tabId!);
      setHiddenTabs((old) =>
        old.join("\0") === hidden.join("\0") ? old : hidden,
      );
    };
    strip
      .querySelector<HTMLElement>(
        `[data-tab-id="${CSS.escape(activeId ?? "")}"]`,
      )
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    measure();
    const observer = new ResizeObserver(() => requestAnimationFrame(measure));
    observer.observe(strip);
    strip.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      strip.removeEventListener("scroll", measure);
    };
  }, [activeId, visibleTabs.length, sidebar]);
  const query = search.toLowerCase();
  const allDocuments = [
    ...visibleSQL.map((d) => ({
      id: d.id,
      kind: "sql" as const,
      title: tabs.find((t) => t.id === d.id)?.title ?? d.title,
      open: () => openSQL(d),
    })),
    ...visibleNotebooks.map((n) => ({
      id: n.id,
      kind: "notebook" as const,
      title: n.title,
      open: () => open(n),
    })),
  ].sort((a, b) => a.title.localeCompare(b.title));
  const documents = allDocuments.filter((d) =>
    d.title.toLowerCase().includes(query),
  );
  const activeWorkspace = connections.find((c) => c.id === selected);
  const paletteActions: PaletteAction[] = [
    {
      id: "new-sql",
      label: "New SQL document",
      shortcut: "⌘T",
      run: () => add("query", selected || null),
    },
    {
      id: "new-notebook",
      label: "New notebook",
      shortcut: "⇧⌘T",
      run: () => add("notebook", selected || null),
    },
    {
      id: "import",
      label: "Import SQL…",
      shortcut: "⌘O",
      run: () => void openSQLFile(),
    },
    ...(tab?.kind === "notebook" && !running
      ? [
          {
            id: "run-all",
            label: "Run all cells",
            shortcut: "⇧⌘↵",
            run: () => runAll(tab),
          },
        ]
      : []),
    ...connections
      .filter((c) => c.id !== selected)
      .map((c) => ({
        id: `switch-${c.id}`,
        label: `Switch to ${c.name}`,
        color: connectionColor(c),
        run: () => {
          setPaused(null);
          selectConnection(c.id);
        },
      })),
    {
      id: "new-connection",
      label: "New connection…",
      run: () => {
        setEditConnection(undefined);
        setConnectionDialog(true);
      },
    },
    {
      id: "sidebar",
      label: sidebar ? "Hide sidebar" : "Show sidebar",
      shortcut: "⌘\\",
      run: () => setSidebar((v) => !v),
    },
    {
      id: "theme",
      label: theme === "dark" ? "Use light theme" : "Use dark theme",
      run: () => setAppearance(theme === "dark" ? "light" : "dark"),
    },
    {
      id: "settings",
      label: "Settings",
      shortcut: "⌘,",
      run: () => setSettingsOpen(true),
    },
  ];
  const sessionState = (t: Tab) =>
    t.disconnected
      ? { label: "Disconnected", tone: "warning" }
      : Object.values(t.executions).some((e) => e.state === "running")
        ? { label: "Running", tone: "busy" }
        : t.sessionId
          ? { label: "Session live", tone: "live" }
          : { label: "No session", tone: "idle" };
  const tabIcon = (t: Tab) =>
    t.relation ? (
      <Table2 size={14} aria-hidden="true" />
    ) : t.kind === "query" ? (
      <FileCode2 size={14} aria-hidden="true" />
    ) : (
      <BookOpen size={14} aria-hidden="true" />
    );
  return (
    <div className={`app ${sidebar ? "" : "sidebar-hidden"}`}>
      <header className="titlebar" data-tauri-drag-region>
        <div className="traffic-space" />
        <Button
          className="quiet icon"
          aria-label={sidebar ? "Hide sidebar" : "Show sidebar"}
          aria-pressed={sidebar}
          onClick={() => setSidebar((v) => !v)}
        >
          <PanelLeft size={16} />
        </Button>
        <nav
          className={`tabbar ${hiddenTabs.length ? "overflowing" : ""}`}
          aria-label="Open documents"
          ref={tabStrip}
        >
          {visibleTabs.map((t) => {
            const tabRunning = Object.values(t.executions).some(
              (e) => e.state === "running",
            );
            return (
              <div
                key={t.id}
                data-tab-id={t.id}
                className={`tab ${activeId === t.id ? "active" : ""}`}
              >
                <button onClick={() => activate(t.id)}>
                  {tabIcon(t)}
                  <span>{t.title}</span>
                  {tabRunning ? (
                    <span className="tab-spinner" aria-hidden="true" />
                  ) : (
                    t.dirty &&
                    !t.relation && (
                      <span className="dirty-dot" aria-hidden="true" />
                    )
                  )}
                </button>
                <Button
                  className="quiet icon"
                  aria-label={`Close ${t.title}`}
                  onClick={() => closeTab(t)}
                >
                  <X size={12} />
                </Button>
              </div>
            );
          })}
        </nav>
        {hiddenTabs.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  className="quiet small tab-overflow"
                  aria-label={`${hiddenTabs.length} more tabs`}
                />
              }
            >
              +{hiddenTabs.length}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-56">
              {visibleTabs
                .filter((t) => hiddenTabs.includes(t.id))
                .map((t) => (
                  <DropdownMenuItem key={t.id} onClick={() => activate(t.id)}>
                    {tabIcon(t)}
                    {t.title}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
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
            <DropdownMenuItem onClick={() => add("query", selected || null)}>
              SQL document<DropdownMenuShortcut>⌘T</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => add("notebook", selected || null)}>
              Notebook<DropdownMenuShortcut>⌘⇧T</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void openSQLFile()}>
              Import SQL…
              <DropdownMenuShortcut>⌘O</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          className="quiet icon"
          aria-label="Import SQL"
          onClick={() => void openSQLFile()}
        >
          <FolderOpen size={15} />
        </Button>
        <span className="spacer" data-tauri-drag-region />
        <button
          className="command-trigger"
          onClick={() => setPaletteOpen(true)}
          aria-keyshortcuts="Meta+K"
        >
          <Search size={14} aria-hidden="true" />
          <span>Search or run a command</span>
          <kbd aria-hidden="true">⌘K</kbd>
        </button>
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
                <div className="sidebar-search">
                  <Search size={13} aria-hidden="true" />
                  <Input
                    className="h-auto border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
                    placeholder="Filter tables & documents"
                    aria-label="Filter tables"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="sidebar-scroll">
                  <div className="section-label">
                    <span>Schemas</span>
                    <span className="tiny-label">
                      {catalog.length ? `${catalog.length} relations` : "—"}
                    </span>
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
                          {schema}
                          <small>
                            {catalog.filter((r) => r.schema === schema).length}
                          </small>
                        </summary>
                        <div className="schema-children">
                          {catalog
                            .filter(
                              (r) =>
                                r.schema === schema &&
                                `${r.name} ${r.columns.map((c) => c.name).join(" ")}`
                                  .toLowerCase()
                                  .includes(query),
                            )
                            .map((r) => (
                              <ContextMenu key={r.name}>
                                <ContextMenuTrigger
                                  render={
                                    <button
                                      className={`table-entry ${tab?.relation && tab.tableKey === JSON.stringify([selected, r.schema, r.name]) ? "active" : ""}`}
                                      title={`Open ${schema}.${r.name}`}
                                      onClick={() => openTable(r)}
                                    />
                                  }
                                >
                                  {r.kind === "table" ? (
                                    <Table2 size={14} aria-hidden="true" />
                                  ) : (
                                    <Eye size={14} aria-hidden="true" />
                                  )}
                                  <span>{r.name}</span>
                                  {r.kind !== "table" ? (
                                    <small className="kind-label">
                                      {r.kind}
                                    </small>
                                  ) : (
                                    r.estimatedRows !== undefined && (
                                      <small
                                        className="row-estimate"
                                        aria-hidden="true"
                                        title={`About ${r.estimatedRows.toLocaleString()} rows (planner estimate)`}
                                      >
                                        {formatEstimate(r.estimatedRows)}
                                      </small>
                                    )
                                  )}
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
                        </div>
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
                  <div className="section-label">
                    <span>Documents</span>
                    <span className="section-actions">
                      <Button
                        className="quiet icon"
                        aria-label="New SQL document"
                        title="New SQL document"
                        onClick={() => add("query", selected || null)}
                      >
                        <FilePlus2 size={14} />
                      </Button>
                      <Button
                        className="quiet icon"
                        aria-label="New notebook"
                        title="New notebook"
                        onClick={() => add("notebook", selected || null)}
                      >
                        <BookPlus size={14} />
                      </Button>
                    </span>
                  </div>
                  <div className="notebook-list" aria-label="Documents">
                    {documents.map((d) => (
                      <button
                        key={d.id}
                        className={activeId === d.id ? "active" : ""}
                        onClick={d.open}
                      >
                        {d.kind === "sql" ? (
                          <FileCode2 size={14} aria-hidden="true" />
                        ) : (
                          <BookOpen size={14} aria-hidden="true" />
                        )}
                        <span>{d.title}</span>
                        <small aria-hidden="true">
                          {d.kind === "sql" ? "sql" : "notebook"}
                        </small>
                      </button>
                    ))}
                    {!documents.length && (
                      <div className="sidebar-hint">
                        {query
                          ? "No matching documents."
                          : "No saved documents."}
                      </div>
                    )}
                  </div>
                </div>
                <div className="sidebar-bottom">
                  <Button
                    className="quiet settings-button justify-start"
                    aria-label="Settings"
                    onClick={() => setSettingsOpen(true)}
                  >
                    <Code2 size={15} aria-hidden="true" />
                    Settings
                  </Button>
                  <Button
                    className="quiet icon"
                    aria-label={
                      theme === "dark"
                        ? "Switch to light theme"
                        : "Switch to dark theme"
                    }
                    onClick={() =>
                      setAppearance(theme === "dark" ? "light" : "dark")
                    }
                  >
                    {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
                  </Button>
                </div>
              </aside>
            </ResizablePanel>
            <ResizableHandle aria-label="Resize sidebar" withHandle />
          </>
        )}
        <ResizablePanel id="workspace" minSize={480}>
          <main className="workspace">
            {!native && (
              <div className="desktop-note">
                Desktop services are unavailable in a browser. Launch with{" "}
                <code>npm run tauri dev</code> to connect and save notebooks.
              </div>
            )}
            {!tab ? (
              <div className="welcome">
                <div className="welcome-mark">
                  <Database size={40} strokeWidth={1} />
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
                  </Button>
                  <Button onClick={() => add("notebook", selected || null)}>
                    <BookOpen size={15} />
                    Create a notebook
                  </Button>
                </div>
                <div className="welcome-footnote">
                  <kbd>⌘ K</kbd> search<span>·</span>
                  <kbd>⌘ T</kbd> new SQL document<span>·</span>
                  <kbd>⌘ ⇧ T</kbd> new notebook
                </div>
              </div>
            ) : tab.relation ? (
              <>
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
                  <h1
                    className="relation-title"
                    title={`${activeConnection?.database ?? ""} / ${tab.relation.schema}.${tab.relation.name}`}
                  >
                    <span>{tab.relation.schema}.</span>
                    {tab.relation.name}
                  </h1>

                  <TabsList>
                    <TabsTrigger value="data">Data</TabsTrigger>
                    <TabsTrigger value="structure">Structure</TabsTrigger>
                  </TabsList>
                  <span className="spacer" />
                  {tab.disconnected && (
                    <Button
                      className="quiet"
                      disabled={running}
                      onClick={() => void reconnect(tab)}
                    >
                      Reconnect session
                    </Button>
                  )}
                  {tab.view === "data" && (
                    <Button
                      className="quiet"
                      aria-label="Filter rows"
                      aria-expanded={!!tab.filtersOpen}
                      onClick={() =>
                        patch(tab.id, (t) => ({
                          ...t,
                          filtersOpen: !t.filtersOpen,
                        }))
                      }
                    >
                      <Filter size={14} />
                      Filter
                      {tab.tableSettings?.filterColumn && (
                        <span className="filter-count">1</span>
                      )}
                    </Button>
                  )}
                  <Button onClick={() => openTable(tab.relation!, "query")}>
                    <FileCode2 size={14} />
                    Open as SQL
                  </Button>
                  {tab.view === "data" &&
                    (running ? (
                      <Button className="danger" onClick={() => cancel(tab)}>
                        <Square size={12} />
                        Cancel
                      </Button>
                    ) : (
                      <Button
                        className="icon"
                        aria-label="Refresh table data"
                        onClick={() => refreshTable(tab)}
                      >
                        <RefreshCw size={14} />
                      </Button>
                    ))}
                </Tabs>
                {tab.view === "structure" ? (
                  <div className="structure-view">
                    <table>
                      <thead>
                        <tr>
                          <th className="ordinal">#</th>
                          <th>Column</th>
                          <th>Type</th>
                          <th>Nullable</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tab.relation.columns.map((c, i) => (
                          <tr key={c.name}>
                            <td className="ordinal">{i + 1}</td>
                            <td className="column-name">
                              {c.name}
                              {c.primaryKeyPosition !== undefined && (
                                <KeyRound
                                  size={12}
                                  className="pk-icon"
                                  aria-label="Primary key"
                                />
                              )}
                            </td>
                            <td className="column-type">{c.type}</td>
                            <td>
                              {c.required ? (
                                <span className="not-null">not null</span>
                              ) : (
                                <span className="value-chip">nullable</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <TableBrowser
                    key={tab.id}
                    tab={tab}
                    onExecute={(settings) => void runTable(tab, settings)}
                    onCount={() => void countTable(tab)}
                  />
                )}
              </>
            ) : (
              <>
                <div className="document-toolbar">
                  <span className="breadcrumb">
                    <span>{activeConnection?.database ?? "Local drafts"}</span>
                    <span aria-hidden="true">/</span>
                    <span>
                      {tab.kind === "notebook" ? "Notebooks" : "SQL documents"}
                    </span>
                    <span aria-hidden="true">/</span>
                  </span>
                  {tab.kind === "query" ? (
                    <Input
                      className="document-title-input"
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
                  ) : (
                    <strong className="breadcrumb-current">{tab.title}</strong>
                  )}
                  <span
                    className={`session-pill ${sessionState(tab).tone}`}
                    role="status"
                  >
                    {sessionState(tab).label}
                  </span>
                  {tab.kind === "query" && (
                    <small className="save-state">
                      {tab.dirty ? "Unsaved changes" : "Saved locally"}
                    </small>
                  )}
                  <span className="spacer" />
                  {tab.kind === "query" && (
                    <Button
                      className="quiet"
                      onClick={() => void exportSQL(tab)}
                    >
                      Export SQL
                    </Button>
                  )}
                  {tab.disconnected && (
                    <Button
                      className="quiet"
                      disabled={running}
                      onClick={() => void reconnect(tab)}
                    >
                      Reconnect session
                    </Button>
                  )}
                  {tab.sessionId && !tab.disconnected && (
                    <Button
                      className="quiet"
                      disabled={running}
                      onClick={() => void resetSession(tab)}
                    >
                      Reset session
                    </Button>
                  )}
                  <Button onClick={() => save(tab)}>
                    <Save size={14} />
                    Save<kbd aria-hidden="true">⌘S</kbd>
                  </Button>
                  {running ? (
                    <Button className="danger" onClick={() => cancel(tab)}>
                      <Square size={12} />
                      Cancel
                    </Button>
                  ) : (
                    <Button
                      className="primary"
                      disabled={!tab.connectionId}
                      onClick={() => runAll(tab)}
                    >
                      <Play size={12} fill="currentColor" />
                      {tab.kind === "query" ? "Run query" : "Run all"}
                      <kbd aria-hidden="true">
                        {tab.kind === "query" ? "⌘↵" : "⇧⌘↵"}
                      </kbd>
                    </Button>
                  )}
                </div>
                {tab.kind === "query" ? (
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
                ) : (
                  <div className="notebook-document">
                    <div className="notebook-heading">
                      <Input
                        className="notebook-title h-auto rounded-none border-0 bg-transparent dark:bg-transparent p-0 text-[2.4rem] md:text-[2.4rem] leading-tight shadow-none focus-visible:ring-0"
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
                        {tab.cells.length}{" "}
                        {tab.cells.length === 1 ? "cell" : "cells"}
                        <span>·</span>
                        shared session<span>·</span>
                        <span className={tab.dirty ? "unsaved" : ""}>
                          {tab.dirty ? "Unsaved changes" : "Saved locally"}
                        </span>
                      </p>
                    </div>
                    <div className="notebook-cells">
                      {tab.cells.map((cell, index) => {
                        const execution = tab.executions[cell.id];
                        const complete =
                          execution?.state === "success" && !execution.outdated;
                        return (
                          <section
                            key={cell.id}
                            className={`notebook-cell ${cell.kind} ${focusedCell === cell.id ? "focused" : ""}`}
                            onFocus={() => setFocusedCell(cell.id)}
                          >
                            <div className="cell-gutter">
                              {cell.kind === "sql" && (
                                <>
                                  <Button
                                    className={`run-cell ${focusedCell === cell.id ? "primary" : ""}`}
                                    aria-label="Run cell"
                                    title="Run cell (⌘↵)"
                                    disabled={running || !tab.connectionId}
                                    onClick={() => runCells(tab, [cell.id])}
                                  >
                                    <Play size={11} fill="currentColor" />
                                  </Button>
                                  <span
                                    className={`run-number ${complete ? "cell-complete" : ""} ${execution?.state === "failed" ? "failed" : ""}`}
                                    title={
                                      complete
                                        ? "Complete"
                                        : execution?.outdated
                                          ? "Outdated"
                                          : undefined
                                    }
                                  >
                                    [
                                    {execution?.state === "running"
                                      ? "*"
                                      : (execution?.runNumber ?? " ")}
                                    ]
                                  </span>
                                </>
                              )}
                            </div>
                            <div className="cell-main">
                              <div className="cell-toolbar">
                                <span className="eyebrow">
                                  {cell.kind === "sql" ? "SQL" : "MARKDOWN"}
                                </span>
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
                              </div>
                              {cell.kind === "sql" ? (
                                <>
                                  <SqlEditor
                                    compact
                                    value={cell.source}
                                    onChange={(v) =>
                                      editCell(tab.id, cell.id, v)
                                    }
                                    onRun={() => runCells(tab, [cell.id])}
                                    catalog={currentCatalog}
                                  />
                                  {execution && (
                                    <ExecutionView
                                      compact
                                      execution={execution}
                                    />
                                  )}
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
                        );
                      })}
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
          </main>
        </ResizablePanel>
      </ResizablePanelGroup>
      <footer className="workspace-footer">
        <span
          className={`status-dot ${browseSession ? "" : connecting ? "busy" : "offline"}`}
          aria-hidden="true"
        />
        <span>
          {browseSession
            ? "Connected"
            : connecting
              ? "Connecting…"
              : activeWorkspace
                ? "Disconnected"
                : "No connection"}
        </span>
        {activeWorkspace && (
          <span className="mono">
            {activeWorkspace.username}@{activeWorkspace.host}:
            {activeWorkspace.port}/{activeWorkspace.database}
          </span>
        )}
        <span className="spacer" />
        {tab && !tab.relation && (
          <span>
            {tab.kind === "notebook" ? "Notebook" : "Query"} session ·{" "}
            {sessionState(tab).label.toLowerCase()}
          </span>
        )}
        {tab?.relation && <span>Table session · read-only</span>}
        <span className="footer-separator" />
        <span>UTC</span>
        <span className="footer-separator" />
        <span>PostgreSQL</span>
      </footer>
      <div className="toasts" aria-live="polite">
        {notice && (
          <div className="toast" role="status">
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
        {flash && (
          <div className="toast success" role="status">
            <Check size={14} aria-hidden="true" />
            <span>{flash}</span>
            <Button
              className="quiet icon"
              aria-label={notice ? "Dismiss message" : "Dismiss notice"}
              onClick={() => setFlash("")}
            >
              <X size={13} />
            </Button>
          </div>
        )}
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        relations={catalog}
        documents={allDocuments}
        actions={paletteActions}
        workspaceName={activeWorkspace?.name}
        onOpenRelation={(r) => openTable(r)}
      />
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
          <strong>Keyboard shortcuts</strong>
          <Button
            className="quiet icon"
            aria-label="Close keyboard shortcuts"
            onClick={() => setHelp(false)}
          >
            <X size={13} />
          </Button>
          {[
            ["⌘ K", "Search or run a command"],
            ["⌘ T", "New SQL document"],
            ["⌘ ⇧ T", "New notebook"],
            ["⌘ Enter", "Run SQL cell or query"],
            ["⌘ ⇧ Enter", "Run all notebook cells"],
            ["⌘ S", "Save document"],
            ["⌘ O", "Import SQL"],
            ["⌘ ,", "Settings"],
            ["⌘ W", "Close tab (saves notebook)"],
            ["⌘ \\", "Toggle sidebar"],
            ["⇧ Arrows", "Extend grid selection"],
            ["⌘ C", "Copy selected cells"],
            ["Enter", "Inspect selected row"],
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
function formatEstimate(n: number) {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}
