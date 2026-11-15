import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BookOpen,
  ChevronsUpDown,
  Columns3,
  Eye,
  FileCode2,
  Search,
  Table2,
  Zap,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import type { Relation } from "../types";

export type PaletteAction = {
  id: string;
  label: string;
  shortcut?: string;
  /** Connection swatch shown for "Switch to …" actions. */
  color?: string;
  run: () => void;
};
export type PaletteDocument = {
  id: string;
  kind: "sql" | "notebook";
  title: string;
  open: () => void;
};
const groups = ["Tables", "Columns", "Documents", "Actions"] as const;
type Group = (typeof groups)[number];
type Filter = "All" | Group;
const filters: Filter[] = ["All", ...groups];
const limits: Record<Group, number> = {
  Tables: 8,
  Columns: 8,
  Documents: 6,
  Actions: 12,
};
type Item = {
  key: string;
  group: Group;
  label: string;
  prefix?: string;
  meta?: string;
  icon: ReactNode;
  shortcut?: string;
  run: () => void;
};

/** 0 = prefix, 1 = word start, 2 = substring; undefined = no match. */
function score(label: string, query: string) {
  if (!query) return 3;
  const text = label.toLowerCase();
  const at = text.indexOf(query);
  if (at < 0) return undefined;
  if (at === 0) return 0;
  return /[\s._-]/.test(text[at - 1]) ? 1 : 2;
}
function Highlight({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}

export function CommandPalette({
  open,
  onOpenChange,
  relations,
  documents,
  actions,
  workspaceName,
  onOpenRelation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  relations: Relation[];
  documents: PaletteDocument[];
  actions: PaletteAction[];
  workspaceName?: string;
  onOpenRelation: (relation: Relation) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (open) {
      setQuery("");
      setFilter("All");
      setActive(0);
    }
  }, [open]);
  const q = query.trim().toLowerCase();
  const items = useMemo(() => {
    const all: (Item & { rank: number })[] = [];
    const push = (item: Item, rank: number | undefined) => {
      if (rank !== undefined) all.push({ ...item, rank });
    };
    for (const r of relations) {
      push(
        {
          key: `t:${r.schema}.${r.name}`,
          group: "Tables",
          label: r.name,
          prefix: `${r.schema}.`,
          meta:
            r.kind === "table"
              ? r.estimatedRows !== undefined
                ? `table · ≈${r.estimatedRows.toLocaleString()} rows`
                : "table"
              : r.kind,
          icon: r.kind === "table" ? <Table2 size={16} /> : <Eye size={16} />,
          run: () => onOpenRelation(r),
        },
        score(r.name, q),
      );
      // Columns only appear once the user types; listing every column is noise.
      if (q)
        for (const c of r.columns)
          push(
            {
              key: `c:${r.schema}.${r.name}.${c.name}`,
              group: "Columns",
              label: c.name,
              prefix: `${r.name}.`,
              meta: c.type,
              icon: <Columns3 size={16} />,
              run: () => onOpenRelation(r),
            },
            score(c.name, q),
          );
    }
    for (const d of documents)
      push(
        {
          key: `d:${d.id}`,
          group: "Documents",
          label: d.title,
          meta: d.kind === "sql" ? "SQL document" : "Notebook",
          icon:
            d.kind === "sql" ? <FileCode2 size={16} /> : <BookOpen size={16} />,
          run: d.open,
        },
        score(d.title, q),
      );
    for (const a of actions)
      push(
        {
          key: `a:${a.id}`,
          group: "Actions",
          label: a.label,
          shortcut: a.shortcut,
          icon: a.color ? (
            <span className="connection-dot" style={{ background: a.color }} />
          ) : a.id.startsWith("switch") ? (
            <ChevronsUpDown size={16} />
          ) : (
            <Zap size={16} />
          ),
          run: a.run,
        },
        score(a.label, q),
      );
    return groups.flatMap((group) => {
      if (filter !== "All" && filter !== group) return [];
      const inGroup = all
        .filter((i) => i.group === group)
        .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
      return filter === "All" ? inGroup.slice(0, limits[group]) : inGroup;
    });
  }, [relations, documents, actions, q, filter, onOpenRelation]);
  const current = Math.min(active, Math.max(0, items.length - 1));
  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${current}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current]);
  function choose(item: Item | undefined) {
    if (!item) return;
    onOpenChange(false);
    item.run();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="command-palette top-[12vh] translate-y-0 gap-0 p-0 sm:max-w-[640px]"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <label className="palette-input">
          <Search size={18} aria-hidden="true" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={
              items.length ? `${id}-option-${current}` : undefined
            }
            aria-label="Search tables, columns, documents and commands"
            placeholder="Search tables, columns, documents and commands"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const step = e.key === "ArrowDown" ? 1 : -1;
                setActive(
                  (current + step + items.length) % Math.max(1, items.length),
                );
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(items[current]);
              } else if (e.key === "Tab") {
                e.preventDefault();
                const i = filters.indexOf(filter);
                setFilter(
                  filters[
                    (i + (e.shiftKey ? -1 : 1) + filters.length) %
                      filters.length
                  ],
                );
                setActive(0);
              }
            }}
          />
          <kbd aria-hidden="true">esc</kbd>
        </label>
        <div
          className="palette-filters"
          role="tablist"
          aria-label="Result type"
        >
          {filters.map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              tabIndex={-1}
              onClick={() => {
                setFilter(f);
                setActive(0);
              }}
            >
              {f}
            </button>
          ))}
        </div>
        <div
          ref={list}
          id={`${id}-list`}
          className="palette-results"
          role="listbox"
          aria-label="Results"
        >
          {items.map((item, index) => (
            <div key={item.key} role="presentation">
              {(index === 0 || items[index - 1].group !== item.group) && (
                <div className="palette-group" role="presentation">
                  {item.group}
                </div>
              )}
              <div
                id={`${id}-option-${index}`}
                data-index={index}
                role="option"
                aria-selected={index === current}
                className="palette-option"
                onPointerMove={() => index !== current && setActive(index)}
                onClick={() => choose(item)}
              >
                <span className="palette-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="palette-label">
                  {item.prefix && <span className="prefix">{item.prefix}</span>}
                  <Highlight text={item.label} query={q} />
                </span>
                {item.meta && <span className="palette-meta">{item.meta}</span>}
                <span className="spacer" />
                {item.shortcut && <kbd>{item.shortcut}</kbd>}
              </div>
            </div>
          ))}
          {!items.length && (
            <div className="palette-empty">
              {relations.length || documents.length
                ? `Nothing matches “${query.trim()}”.`
                : "Connect to a database to search its tables."}
            </div>
          )}
        </div>
        <div className="palette-footer" aria-hidden="true">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>⇥ next filter</span>
          <span className="spacer" />
          {workspaceName && <span>Searching {workspaceName}</span>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
