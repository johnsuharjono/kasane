import {
  MarkerType,
  Position,
  type Edge,
  type Node,
  type XYPosition,
} from "@xyflow/react";
import ELK, { type ElkExtendedEdge } from "elkjs/lib/elk-api.js";
import layoutWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import type { DiagramScope, ForeignKey, Relation } from "./types";

const elk = new ELK({ workerFactory: () => new Worker(layoutWorkerUrl) });
const width = 244;
const headerHeight = 42;
const rowHeight = 25;

type DiagramColumn = Relation["columns"][number] & {
  inbound: boolean;
  outbound: boolean;
};
export type TableNode = Node<
  {
    relation: Relation;
    columns: DiagramColumn[];
    outsideSchema: boolean;
  },
  "table"
>;
type TableHandle = NonNullable<TableNode["handles"]>[number] & { id: string };

export type DiagramEdge = Edge<
  { path?: string; offset?: XYPosition; detourY?: number },
  "foreignKey"
>;

export const tableId = (schema: string, table: string) =>
  JSON.stringify([schema, table]);
export const portId = (
  table: string,
  column: string,
  direction: "in" | "out",
) => JSON.stringify([table, column, direction]);

export async function layoutDiagram(
  scope: DiagramScope,
  catalog: Relation[],
  keys: ForeignKey[],
  allColumns: boolean,
) {
  const tables = new Map(
    catalog
      .filter((table) => table.kind === "table")
      .map((table) => [tableId(table.schema, table.name), table]),
  );
  const visible = new Set(
    [...tables.entries()]
      .filter(
        ([, table]) =>
          table.schema === scope.schema &&
          (scope.table === undefined || table.name === scope.table),
      )
      .map(([id]) => id),
  );
  const outbound = new Set<string>();
  const inbound = new Set<string>();
  const edges: DiagramEdge[] = [];

  for (const key of keys) {
    const source = tableId(key.sourceSchema, key.sourceTable);
    const target = tableId(key.targetSchema, key.targetTable);
    const sourceTable = tables.get(source);
    const targetTable = tables.get(target);
    if (!sourceTable || !targetTable) continue;

    for (const [index, column] of key.sourceColumns.entries()) {
      const referenced = key.targetColumns[index];
      if (
        !sourceTable.columns.some((c) => c.name === column) ||
        !targetTable.columns.some((c) => c.name === referenced)
      )
        continue;

      visible.add(source);
      visible.add(target);
      const sourceHandle = portId(source, column, "out");
      const targetHandle = portId(target, referenced, "in");
      outbound.add(sourceHandle);
      inbound.add(targetHandle);
      edges.push({
        id: JSON.stringify([source, key.name, index]),
        source,
        target,
        sourceHandle,
        targetHandle,
        type: "foreignKey",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "var(--diagram-link)",
          width: 12,
          height: 12,
        },
        ariaLabel: `${key.name}. ${key.sourceSchema}.${key.sourceTable}.${column} references ${key.targetSchema}.${key.targetTable}.${referenced}`,
      });
    }
  }

  const nodes = [...tables]
    .filter(([id]) => visible.has(id))
    .map(([id, relation]) => {
      const columns = relation.columns
        .map((column) => ({
          ...column,
          inbound: inbound.has(portId(id, column.name, "in")),
          outbound: outbound.has(portId(id, column.name, "out")),
        }))
        .filter(
          (column) =>
            allColumns ||
            column.primaryKeyPosition ||
            column.inbound ||
            column.outbound,
        );

      const handles: TableHandle[] = [];
      columns.forEach((column, index) => {
        const y = headerHeight + (index + 0.5) * rowHeight;
        if (column.inbound) {
          handles.push({
            id: portId(id, column.name, "in"),
            type: "target",
            position: Position.Left,
            x: 0,
            y,
            width: 0,
            height: 0,
          });
        }
        if (column.outbound) {
          handles.push({
            id: portId(id, column.name, "out"),
            type: "source",
            position: Position.Right,
            x: width,
            y,
            width: 0,
            height: 0,
          });
        }
      });

      const height = headerHeight + Math.max(columns.length, 1) * rowHeight;
      return {
        id,
        type: "table",
        handles,
        width,
        height,
        measured: { width, height },
        dragHandle: ".diagram-table-header",
        position: { x: 0, y: 0 },
        data: {
          relation,
          columns,
          outsideSchema: relation.schema !== scope.schema,
        },
        ariaLabel: `${relation.schema}.${relation.name}`,
      } satisfies TableNode;
    });

  if (!nodes.length) return { nodes, edges };
  const layout = await elk.layout({
    id: "schema",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "32",
      "elk.layered.spacing.nodeNodeBetweenLayers": "78",
      "elk.layered.spacing.edgeNodeBetweenLayers": "22",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "10",
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: node.width,
      height: node.height,
      ports: node.handles.map(({ id, x, y, width, height, position }) => ({
        id,
        x,
        y,
        width,
        height,
        layoutOptions: {
          "elk.port.side": position === Position.Left ? "WEST" : "EAST",
        },
      })),
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.sourceHandle!],
      targets: [edge.targetHandle!],
    })),
  });

  const positions = new Map(
    layout.children?.map(({ id, x, y }) => [id, { x: x ?? 0, y: y ?? 0 }]),
  );
  const routes = new Map(
    ((layout.edges ?? []) as ElkExtendedEdge[]).map(({ id, sections }) => [
      id,
      sections
        ?.map(({ startPoint, bendPoints, endPoint }) =>
          [startPoint, ...(bendPoints ?? []), endPoint]
            .map(({ x, y }, index) => `${index === 0 ? "M" : "L"}${x},${y}`)
            .join(" "),
        )
        .join(" "),
    ]),
  );
  return {
    nodes: nodes.map((node) => ({
      ...node,
      position: positions.get(node.id) ?? node.position,
    })),
    edges: edges.map((edge) => ({
      ...edge,
      data: { path: routes.get(edge.id) ?? "" },
    })),
  };
}
