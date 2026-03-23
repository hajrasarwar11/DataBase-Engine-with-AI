import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { GitBranch } from "lucide-react";

interface GraphViewProps {
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
  pathIds?: number[];
}

// Color palette for node types
const NODE_COLORS = [
  "#06b6d4", "#8b5cf6", "#10b981", "#f59e0b",
  "#ef4444", "#3b82f6", "#ec4899", "#14b8a6",
];

function formatLabel(rec: Record<string, unknown>): string {
  // Try common label fields
  for (const k of ["name", "title", "label", "username", "email"]) {
    if (rec[k] && typeof rec[k] === "string") return String(rec[k]).slice(0, 24);
  }
  return `#${rec.id}`;
}

export function GraphView({ nodes, edges, pathIds = [] }: GraphViewProps) {
  const pathSet = new Set(pathIds);

  // Convert records to React Flow nodes with force-directed-like layout
  const rfNodes: Node[] = useMemo(() => {
    if (nodes.length === 0 && edges.length === 0) return [];

    // Collect all unique node IDs (from records + from/to in edges)
    const nodeIds = new Set<string>();
    nodes.forEach(n => { if (n.id !== undefined) nodeIds.add(String(n.id)); });
    edges.forEach(e => {
      if (e.from !== undefined) nodeIds.add(String(e.from));
      if (e.to   !== undefined) nodeIds.add(String(e.to));
    });

    const ids = Array.from(nodeIds);
    const total = ids.length;

    return ids.map((id, i) => {
      // Circular layout
      const angle = (2 * Math.PI * i) / total;
      const radius = Math.max(180, total * 35);
      const x = Math.cos(angle) * radius + 400;
      const y = Math.sin(angle) * radius + 300;

      // Find record data
      const rec = nodes.find(n => String(n.id) === id) as Record<string, unknown> | undefined;
      const label = rec ? formatLabel(rec) : `Node ${id}`;
      const isOnPath = pathSet.has(Number(id));

      const colorIdx = i % NODE_COLORS.length;
      const color = isOnPath ? "#f59e0b" : NODE_COLORS[colorIdx];

      return {
        id,
        position: { x, y },
        data: {
          label: (
            <div className="text-xs font-mono text-center">
              <div className="font-bold text-white" style={{ fontSize: 11 }}>{label}</div>
              <div style={{ color: "#94a3b8", fontSize: 9 }}>id: {id}</div>
            </div>
          ),
        },
        style: {
          background: color + "22",
          border: `2px solid ${color}`,
          borderRadius: 8,
          padding: "6px 12px",
          minWidth: 90,
          boxShadow: isOnPath ? `0 0 12px ${color}88` : undefined,
        },
      } satisfies Node;
    });
  }, [nodes, edges, pathIds]);

  const rfEdges: Edge[] = useMemo(() => {
    return edges.map((e, i) => {
      const from = String(e.from);
      const to   = String(e.to);
      const fromOnPath = pathSet.has(Number(from));
      const toOnPath   = pathSet.has(Number(to));
      const onPath = fromOnPath && toOnPath;
      return {
        id: `e-${i}-${from}-${to}`,
        source: from,
        target: to,
        label: e.relation_type as string | undefined,
        animated: onPath,
        style: {
          stroke: onPath ? "#f59e0b" : "#475569",
          strokeWidth: onPath ? 2.5 : 1.5,
        },
        labelStyle: { fill: "#94a3b8", fontSize: 10 },
      } satisfies Edge;
    });
  }, [edges, pathIds]);

  const [rfNodesState, , onNodesChange] = useNodesState(rfNodes);
  const [rfEdgesState, , onEdgesChange] = useEdgesState(rfEdges);

  if (rfNodes.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm flex-col gap-3">
        <GitBranch className="w-8 h-8 opacity-20" />
        <p>Run a FIND PATH or graph FIND query to see graph visualization</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full" style={{ background: "hsl(var(--editor-bg))" }}>
      <ReactFlow
        nodes={rfNodesState}
        edges={rfEdgesState}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.2}
        maxZoom={4}
        attributionPosition="bottom-right"
        colorMode="dark"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#334155"
        />
        <Controls
          style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }}
        />
        <MiniMap
          style={{ background: "#0f172a", border: "1px solid #334155" }}
          nodeColor={(n) => (n.style?.border as string ?? "#06b6d4").replace("2px solid ", "")}
        />
      </ReactFlow>
    </div>
  );
}
