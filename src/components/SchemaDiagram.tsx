import { useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  getSmoothStepPath,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type EdgeProps,
  type NodeProps,
  type XYPosition,
} from "@xyflow/react";
import { Maximize, RefreshCw, Search, Table2 } from "lucide-react";
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

function DiagramTable({ id, data }: NodeProps<TableNode>) {
  const { relation, columns, outsideSchema } = data;
  const name = `${relation.schema}.${relation.name}`;
  return (
    <article
      className={`diagram-table${outsideSchema ? " diagram-external" : ""}`}
      aria-label={name}
    >
      <header className="diagram-table-header" title={name}>
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
      {columns.map((column) => {
        const primary = Boolean(column.primaryKeyPosition);
        const foreign = column.outbound;
        const keyLabel = primary
          ? foreign
            ? "Primary and foreign key"
            : "Primary key"
          : "Foreign key";
        return (
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
            <span>
              {(primary || foreign) && (
                <abbr className="diagram-key" title={keyLabel}>
                  {primary && foreign ? "PK/FK" : primary ? "PK" : "FK"}
                </abbr>
              )}
            </span>
            <code>{column.name}</code>
            <span className="diagram-column-type max-w-[77px]">
              {column.type}
            </span>
          </div>
        );
      })}
      {!columns.length && (
        <div className="diagram-column diagram-no-keys">
          {relation.columns.length ? "No key columns" : "No columns"}
        </div>
      )}
    </article>
  );
}

function ForeignKeyEdge({
  id,
  data,
  markerEnd,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
}: EdgeProps<DiagramEdge>) {
  const path =
    data?.path ||
    getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      offset: sourceX < targetX ? Math.min(20, (targetX - sourceX) / 2) : 20,
      centerY: sourceX >= targetX ? data?.detourY : undefined,
    })[0];
  const offset = data?.offset;
  return (
    <g transform={offset && `translate(${offset.x} ${offset.y})`}>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} />
    </g>
  );
}

const nodeTypes = { table: DiagramTable };
const edgeTypes = { foreignKey: ForeignKeyEdge };

type Props = {
  scope: DiagramScope;
  sessionId: string;
  connecting: boolean;
  catalog: Relation[];
  onRefresh: () => void;
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
  onOpenSchema,
}: Props) {
  const { schema, table } = scope;
  const [allColumns, setAllColumns] = useState(false);
  const [search, setSearch] = useState("");
  const [positions, setPositions] = useState<Record<string, XYPosition>>({});
  const [drag, setDrag] = useState<{ id: string; position: XYPosition }>();
  const moved = useMemo(
    () => (drag ? { ...positions, [drag.id]: drag.position } : positions),
    [drag, positions],
  );
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
        position: moved?.[node.id] ?? node.position,
        selected: selected === node.id,
        className:
          query &&
          `${node.data.relation.schema}.${node.data.relation.name}`
            .toLowerCase()
            .includes(query)
            ? "diagram-match"
            : undefined,
      })),
    [current, moved, query, selected],
  );
  const matches =
    nodes?.filter((node) => node.className === "diagram-match") ?? [];
  const edges = useMemo(() => {
    const defaults = new Map(
      current?.nodes?.map((node) => [node.id, node.position]),
    );
    return current?.edges?.map((edge) => {
      let data = edge.data;
      const source = moved?.[edge.source];
      const target = moved?.[edge.target];
      const origin = defaults.get(edge.source);
      if (source && origin && edge.source === edge.target && data?.path) {
        data = {
          ...data,
          offset: { x: source.x - origin.x, y: source.y - origin.y },
        };
      } else if (source || target) {
        const sourceY = (source ?? origin)?.y ?? 0;
        const targetY = (target ?? defaults.get(edge.target))?.y ?? 0;
        data = { detourY: Math.min(sourceY, targetY) - 20 };
      }
      return {
        ...edge,
        data,
        className:
          selected === edge.source || selected === edge.target
            ? "diagram-edge-active"
            : undefined,
      };
    });
  }, [current, moved, selected]);
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
          onClick={() => {
            setPositions({});
            setDrag(undefined);
            onRefresh();
          }}
        >
          <RefreshCw size={14} />
        </Button>
      </div>
      {nodes?.length ? (
        <div className="diagram-canvas min-h-0 flex-1 bg-(--diagram-canvas)">
          <ReactFlow
            key={`${sessionId}:${allColumns}`}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesConnectable={false}
            edgesReconnectable={false}
            elementsSelectable={false}
            deleteKeyCode={null}
            onNodeClick={(_, node) => setSelected(node.id)}
            onNodesChange={(changes) => {
              for (const change of changes) {
                if (
                  change.type === "position" &&
                  change.dragging &&
                  change.position
                )
                  setDrag({ id: change.id, position: change.position });
              }
            }}
            onNodeDragStop={(_, node) => {
              setPositions((previous) => ({
                ...previous,
                [node.id]: node.position,
              }));
              setDrag(undefined);
            }}
            onPaneClick={() => setSelected(undefined)}
            fitView
            fitViewOptions={{ maxZoom: 1, padding: 28 }}
            minZoom={0.04}
          >
            <Background
              variant={BackgroundVariant.Dots}
              size={1.5}
              gap={20}
              color="var(--diagram-grid)"
            />
            <Controls showFitView={false} showInteractive={false} />
          </ReactFlow>
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
