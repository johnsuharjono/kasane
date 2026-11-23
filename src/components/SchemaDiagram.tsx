import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";
import { KeyRound, Maximize, RefreshCw, Search, Table2 } from "lucide-react";
import "@xyflow/react/dist/style.css";
import "./schema-diagram.css";
import { api } from "../api";
import {
  layoutDiagram,
  portId,
  tableId,
  type DiagramEdge,
  type TableNode,
} from "../schema-diagram";
import {
  asError,
  type DiagramScope,
  type ForeignKey,
  type Relation,
} from "../types";
import { Button } from "./Button";
import { Input } from "./ui/input";

type OpenTable = (table: Relation, view: "data" | "structure") => void;
const TableActions = createContext<OpenTable>(() => {});

function DiagramTable({ id, data }: NodeProps<TableNode>) {
  const { relation, columns, outsideSchema } = data;
  const open = useContext(TableActions);
  const name = `${relation.schema}.${relation.name}`;
  return (
    <article
      className={`diagram-table${outsideSchema ? " diagram-external" : ""}`}
      aria-label={name}
    >
      <header title={name}>
        <Table2
          className="flex-none text-(--diagram-accent)"
          size={15}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <small>{relation.schema}</small>
          <strong>{relation.name}</strong>
        </div>
      </header>
      {columns.map((column) => (
        <div
          className="diagram-column"
          key={column.name}
          title={`${column.name} · ${column.type}`}
        >
          {column.inbound && (
            <Handle
              id={portId(id, column.name, "in")}
              type="target"
              position={Position.Left}
            />
          )}
          {column.outbound && (
            <Handle
              id={portId(id, column.name, "out")}
              type="source"
              position={Position.Right}
            />
          )}
          <span className="diagram-key">
            {column.primaryKeyPosition && (
              <span aria-label="Primary key">
                <KeyRound size={12} />
              </span>
            )}
            {column.outbound && (
              <abbr className="no-underline" title="Foreign key">
                FK
              </abbr>
            )}
          </span>
          <code>{column.name}</code>
          <span className="diagram-column-type max-w-[77px]">
            {column.type}
          </span>
        </div>
      ))}
      {!columns.length && (
        <div className="diagram-column diagram-no-keys">
          {relation.columns.length ? "No key columns" : "No columns"}
        </div>
      )}
      <footer>
        <button
          className="nopan"
          type="button"
          aria-label={`Open data for ${name}`}
          onClick={() => open(relation, "data")}
        >
          Data
        </button>
        <button
          className="nopan"
          type="button"
          aria-label={`View structure for ${name}`}
          onClick={() => open(relation, "structure")}
        >
          Structure
        </button>
      </footer>
    </article>
  );
}

function ForeignKeyEdge({ id, data, markerEnd }: EdgeProps<DiagramEdge>) {
  return <BaseEdge id={id} path={data?.path ?? ""} markerEnd={markerEnd} />;
}

const nodeTypes = { table: DiagramTable };
const edgeTypes = { foreignKey: ForeignKeyEdge };

type Props = {
  scope: DiagramScope;
  sessionId: string;
  connecting: boolean;
  catalog: Relation[];
  onRefresh: () => void;
  onOpenTable: OpenTable;
  onOpenSchema: () => void;
};

export function SchemaDiagram(props: Props) {
  return (
    <ReactFlowProvider>
      <DiagramWorkspace {...props} />
    </ReactFlowProvider>
  );
}

function DiagramWorkspace({
  scope,
  sessionId,
  connecting,
  catalog,
  onRefresh,
  onOpenTable,
  onOpenSchema,
}: Props) {
  const { schema, table } = scope;
  const [allColumns, setAllColumns] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | undefined>(
    table === undefined ? undefined : tableId(schema, table),
  );
  const [metadata, setMetadata] = useState<{
    sessionId: string;
    keys?: ForeignKey[];
    error?: string;
  }>();
  const [graph, setGraph] = useState<{
    keys: ForeignKey[];
    allColumns: boolean;
    nodes?: TableNode[];
    edges?: DiagramEdge[];
    error?: string;
  }>();
  const { fitView } = useReactFlow<TableNode, DiagramEdge>();

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    api.foreignKeys(sessionId, { schema, table }).then(
      (keys) => {
        if (active) setMetadata({ sessionId, keys });
      },
      (error: unknown) => {
        if (active) setMetadata({ sessionId, error: asError(error).message });
      },
    );
    return () => {
      active = false;
    };
  }, [sessionId, schema, table]);

  const keys = metadata?.sessionId === sessionId ? metadata?.keys : undefined;
  useEffect(() => {
    if (!keys) return;
    let active = true;
    layoutDiagram({ schema, table }, catalog, keys, allColumns).then(
      (result) => {
        if (active) setGraph({ keys, allColumns, ...result });
      },
      (error: unknown) => {
        if (active)
          setGraph({ keys, allColumns, error: asError(error).message });
      },
    );
    return () => {
      active = false;
    };
  }, [keys, schema, table, catalog, allColumns]);

  const current =
    keys && graph?.keys === keys && graph.allColumns === allColumns
      ? graph
      : undefined;
  const query = search.trim().toLowerCase();
  const nodes = useMemo(
    () =>
      current?.nodes?.map((node) => ({
        ...node,
        selected: selected === node.id,
        className:
          query &&
          `${node.data.relation.schema}.${node.data.relation.name}`
            .toLowerCase()
            .includes(query)
            ? "diagram-match"
            : undefined,
      })),
    [current, query, selected],
  );
  const matches =
    nodes?.filter((node) => node.className === "diagram-match") ?? [];
  const edges = useMemo(
    () =>
      current?.edges?.map((edge) => ({
        ...edge,
        className:
          selected === edge.source || selected === edge.target
            ? "diagram-edge-active"
            : undefined,
      })),
    [current, selected],
  );
  const error =
    (metadata?.sessionId === sessionId ? metadata?.error : undefined) ??
    current?.error;

  return (
    <section className="schema-diagram" aria-label="Schema diagram">
      <div className="diagram-toolbar">
        <h1
          className="relation-title"
          title={table ? `${schema}.${table}` : schema}
        >
          {table && <span>{schema}.</span>}
          {table ?? schema}
        </h1>
        {table !== undefined && (
          <Button className="quiet" onClick={onOpenSchema}>
            Full schema
          </Button>
        )}
        <span className="spacer" />
        <form
          className="diagram-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            if (!matches.length) return;
            const next =
              matches[
                (matches.findIndex((node) => node.id === selected) + 1) %
                  matches.length
              ];
            setSelected(next.id);
            void fitView({
              nodes: [next],
              maxZoom: 1,
              padding: 28,
              duration: 180,
            });
          }}
        >
          <Search size={14} aria-hidden="true" />
          <Input
            className="h-[29px] w-[108px] border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
            type="search"
            aria-label="Find table in diagram"
            placeholder="Find table"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {query && (
            <button
              className="min-w-[18px] text-(--diagram-accent) tabular-nums disabled:text-muted-foreground"
              type="submit"
              disabled={!matches.length}
              title="Go to next match"
              aria-label="Go to next match"
            >
              {matches.length}
            </button>
          )}
        </form>
        <Button
          className="quiet aria-pressed:bg-accent aria-pressed:text-(--diagram-accent)"
          aria-pressed={allColumns}
          onClick={() => setAllColumns(!allColumns)}
        >
          All columns
        </Button>
        <Button
          className="quiet icon"
          aria-label="Fit diagram"
          title="Fit diagram"
          disabled={!nodes?.length}
          onClick={() =>
            void fitView({ maxZoom: 1, padding: 28, duration: 180 })
          }
        >
          <Maximize size={14} />
        </Button>
        <Button
          className="quiet icon"
          aria-label="Refresh diagram"
          title="Refresh diagram"
          disabled={connecting}
          onClick={onRefresh}
        >
          <RefreshCw size={14} />
        </Button>
      </div>
      {nodes?.length ? (
        <div className="diagram-canvas min-h-0 flex-1 bg-(--diagram-canvas)">
          <TableActions.Provider value={onOpenTable}>
            <ReactFlow
              key={`${sessionId}:${allColumns}`}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              nodesConnectable={false}
              nodesDraggable={false}
              edgesReconnectable={false}
              elementsSelectable={false}
              deleteKeyCode={null}
              onNodeClick={(_, node) => setSelected(node.id)}
              onPaneClick={() => setSelected(undefined)}
              fitView
              fitViewOptions={{ maxZoom: 1, padding: 28 }}
              minZoom={0.04}
            >
              <Background
                variant={BackgroundVariant.Lines}
                gap={20}
                color="var(--diagram-grid)"
              />
              <Controls showFitView={false} showInteractive={false} />
            </ReactFlow>
          </TableActions.Provider>
        </div>
      ) : (
        <div className="diagram-status" role="status">
          {error ??
            (connecting || (sessionId && !nodes)
              ? "Loading diagram…"
              : sessionId
                ? "No tables in this diagram."
                : "Connect to load the diagram.")}
        </div>
      )}
    </section>
  );
}
