import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  uid,
  type Tab,
  type Cell,
  type Execution,
  type Notebook,
  type SQLDocument,
} from "./types";
type Workspace = {
  tabs: Tab[];
  activeId: string | null;
  connectionId: string | null;
  activeByConnection: Record<string, string | null>;
  explorer: Record<string, { search: string; collapsed: string[] }>;
  selectConnection: (id: string | null) => void;
  setExplorer: (
    id: string,
    value: { search: string; collapsed: string[] },
  ) => void;
  add: (
    kind: Tab["kind"],
    connectionId: string | null,
    source?: string,
  ) => void;
  open: (notebook: Notebook) => void;
  openSQL: (document: SQLDocument) => void;
  activate: (id: string) => void;
  patch: (id: string, fn: (tab: Tab) => Tab) => void;
  close: (id: string) => void;
  editCell: (id: string, cellId: string, source: string) => void;
  setExecution: (id: string, cellId: string, execution: Execution) => void;
};
export const useWorkspace = create<Workspace>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeId: null,
      connectionId: null,
      activeByConnection: {},
      explorer: {},
      setExplorer: (id, value) =>
        set((s) => ({ explorer: { ...s.explorer, [id]: value } })),
      selectConnection: (connectionId) =>
        set((s) => {
          if (connectionId === s.connectionId) return {};
          const activeByConnection = {
            ...s.activeByConnection,
            [s.connectionId ?? "local"]: s.activeId,
          };
          const candidates = s.tabs.filter(
            (t) => t.connectionId === connectionId,
          );
          return {
            connectionId,
            activeByConnection,
            activeId:
              candidates.find(
                (t) => t.id === activeByConnection[connectionId ?? "local"],
              )?.id ??
              candidates.at(-1)?.id ??
              null,
          };
        }),
      add: (kind, connectionId, source) => {
        const id = uid();
        set((s) => ({
          activeId: id,
          tabs: [
            ...s.tabs,
            {
              id,
              kind,
              connectionId,
              title:
                kind === "query"
                  ? `Query ${s.tabs.filter((t) => t.kind === "query").length + 1}`
                  : "Untitled notebook",
              dirty: true,
              executions: {},
              cells:
                kind === "query"
                  ? [
                      {
                        id: uid(),
                        kind: "sql",
                        source:
                          source ?? "SELECT current_database(), current_user;",
                      },
                    ]
                  : [
                      {
                        id: uid(),
                        kind: "markdown",
                        source: "# Notes",
                      },
                      {
                        id: uid(),
                        kind: "sql",
                        source: source ?? "SELECT current_database();",
                      },
                    ],
            },
          ],
        }));
      },
      openSQL: (d) => {
        if (get().tabs.some((t) => t.id === d.id)) {
          set({ activeId: d.id });
          return;
        }
        set((s) => ({
          activeId: d.id,
          tabs: [
            ...s.tabs,
            {
              id: d.id,
              kind: "query",
              title: d.title,
              connectionId: d.connectionId,
              cells: [{ id: uid(), kind: "sql", source: d.source }],
              executions: {},
              dirty: false,
            },
          ],
        }));
      },
      open: (n) => {
        if (get().tabs.some((t) => t.id === n.id)) {
          set({ activeId: n.id });
          return;
        }
        set((s) => ({
          activeId: n.id,
          tabs: [
            ...s.tabs,
            { ...n, kind: "notebook", executions: {}, dirty: false },
          ],
        }));
      },
      activate: (activeId) => set({ activeId }),
      patch: (id, fn) =>
        set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? fn(t) : t)) })),
      close: (id) =>
        set((s) => {
          const tabs = s.tabs.filter((t) => t.id !== id);
          return {
            tabs,
            activeId:
              s.activeId === id
                ? (tabs.filter((t) => t.connectionId === s.connectionId).at(-1)
                    ?.id ?? null)
                : s.activeId,
          };
        }),
      editCell: (id, cellId, source) =>
        get().patch(id, (t) => {
          const index = t.cells.findIndex((c) => c.id === cellId);
          const executions = { ...t.executions };
          t.cells.slice(index).forEach((c) => {
            if (executions[c.id])
              executions[c.id] = { ...executions[c.id], outdated: true };
          });
          return {
            ...t,
            dirty: true,
            cells: t.cells.map((c) => (c.id === cellId ? { ...c, source } : c)),
            executions,
          };
        }),
      setExecution: (id, cellId, execution) =>
        get().patch(id, (t) => ({
          ...t,
          executions: {
            ...t.executions,
            [cellId]: {
              ...execution,
              outdated:
                execution.outdated ||
                (!cellId.startsWith("table-") &&
                  t.cells.find((c) => c.id === cellId)?.source !==
                    execution.source),
            },
          },
        })),
    }),
    {
      name: "kasane.workspaces",
      storage: createJSONStorage(() => ({
        getItem: (key) => localStorage.getItem(key),
        removeItem: (key) => localStorage.removeItem(key),
        setItem: (key, value) => {
          try {
            localStorage.setItem(key, value);
          } catch {
            // A full webview store must not interrupt SQL execution or source editing.
            window.dispatchEvent(new Event("kasane-storage-error"));
          }
        },
      })),
      version: 1,
      // Source/layout only. Sessions, result payloads and credentials never enter persistence.
      partialize: (s) => ({
        connectionId: s.connectionId,
        activeId: s.activeId,
        activeByConnection: s.activeByConnection,
        explorer: s.explorer,
        tabs: s.tabs.map((t) => ({
          id: t.id,
          kind: t.kind,
          title: t.title,
          cells: t.cells,
          connectionId: t.connectionId,
          dirty: t.dirty,
          tableKey: t.tableKey,
          relation: t.relation,
          view: t.view,
          tableSettings: t.tableSettings,
          filtersOpen: t.filtersOpen,
          editorHeight: t.editorHeight,
        })),
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<Workspace> | undefined;
        if (!saved || !Array.isArray(saved.tabs)) return current;
        const tabs = saved.tabs
          .filter(
            (t) =>
              typeof t.id === "string" &&
              (t.kind === "query" || t.kind === "notebook") &&
              Array.isArray(t.cells),
          )
          .map((t) => ({
            ...t,
            sessionId: undefined,
            disconnected: false,
            executions: {},
            restored: true,
          }));
        return {
          ...current,
          connectionId: saved.connectionId ?? null,
          activeId: tabs.some(
            (t) =>
              t.id === saved.activeId &&
              t.connectionId === (saved.connectionId ?? null),
          )
            ? saved.activeId!
            : null,
          activeByConnection: saved.activeByConnection ?? {},
          explorer: saved.explorer ?? {},
          tabs,
        };
      },
    },
  ),
);
export function mutateCells(tab: Tab, cells: Cell[]): Tab {
  return {
    ...tab,
    cells,
    dirty: true,
    executions: Object.fromEntries(
      Object.entries(tab.executions)
        .filter(([id]) => cells.some((c) => c.id === id))
        .map(([id, e]) => [id, { ...e, outdated: true }]),
    ),
  };
}
