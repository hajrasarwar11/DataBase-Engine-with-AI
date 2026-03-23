import { useMemo, useState, useCallback, useEffect } from "react";
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
  MarkerType,
  type NodeProps,
  Handle,
  Position,
  type OnNodeClick,
  type OnEdgeClick,
  type EdgeProps,
  getBezierPath,
  EdgeLabelRenderer,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { GitBranch, X, Database, Hash } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface GraphViewProps {
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
  pathIds?: number[];
}

type InspectorItem =
  | { kind: "node"; data: Record<string, unknown>; label: string }
  | { kind: "edge"; data: Record<string, unknown> };

// ── Color palette — subtle accent colors for node borders ─────────────────────
const BORDER_COLORS = [
  "#6b7280", // gray
  "#60a5fa", // blue
  "#34d399", // teal
  "#f472b6", // pink
  "#fb923c", // orange
  "#a78bfa", // violet
  "#facc15", // yellow
  "#4ade80", // green
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatLabel(rec: Record<string, unknown>): string {
  for (const k of ["name", "title", "label", "username", "email"]) {
    const v = rec[k];
    if (v && typeof v === "string") return v.slice(0, 20);
  }
  return `#${rec.id}`;
}

function getNodeType(rec: Record<string, unknown> | undefined): string {
  if (!rec) return "Node";
  for (const k of ["type", "collection", "label", "__type"]) {
    const v = rec[k];
    if (v && typeof v === "string") return v.slice(0, 16);
  }
  return "Node";
}

// ── Force-directed spring layout ──────────────────────────────────────────────
function springLayout(
  nodeIds: string[],
  edgeList: Array<{ from: string; to: string }>,
): Record<string, { x: number; y: number }> {
  const n = nodeIds.length;
  if (n === 0) return {};

  const positions: Record<string, { x: number; y: number }> = {};

  // Initialize with circular seed positions
  nodeIds.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    const radius = Math.max(180, n * 42);
    positions[id] = {
      x: Math.cos(angle) * radius + 500,
      y: Math.sin(angle) * radius + 350,
    };
  });

  if (n === 1) return positions;

  // Spring relaxation — Fruchterman-Reingold style
  const k = Math.sqrt((900 * 700) / n) * 1.2;
  const iterations = 100;

  for (let iter = 0; iter < iterations; iter++) {
    const forces: Record<string, { fx: number; fy: number }> = {};
    nodeIds.forEach((id) => { forces[id] = { fx: 0, fy: 0 }; });

    // Repulsion between every pair
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = nodeIds[i], b = nodeIds[j];
        const dx = positions[b].x - positions[a].x;
        const dy = positions[b].y - positions[a].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.1);
        const repulse = (k * k) / dist;
        const ux = dx / dist, uy = dy / dist;
        forces[a].fx -= ux * repulse;
        forces[a].fy -= uy * repulse;
        forces[b].fx += ux * repulse;
        forces[b].fy += uy * repulse;
      }
    }

    // Attraction along edges
    edgeList.forEach(({ from, to }) => {
      if (!positions[from] || !positions[to]) return;
      const dx = positions[to].x - positions[from].x;
      const dy = positions[to].y - positions[from].y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.1);
      const attract = (dist * dist) / k;
      const ux = dx / dist, uy = dy / dist;
      forces[from].fx += ux * attract;
      forces[from].fy += uy * attract;
      forces[to].fx -= ux * attract;
      forces[to].fy -= uy * attract;
    });

    // Apply with cooling
    const temp = Math.max(60 * (1 - iter / iterations), 2);
    nodeIds.forEach((id) => {
      const { fx, fy } = forces[id];
      const fLen = Math.sqrt(fx * fx + fy * fy);
      if (fLen > 0) {
        positions[id].x += (fx / fLen) * Math.min(fLen, temp);
        positions[id].y += (fy / fLen) * Math.min(fLen, temp);
      }
    });
  }

  return positions;
}

// ── Custom circular node (Neo4j-style) ────────────────────────────────────────
function CircleNode({ data, selected }: NodeProps) {
  const { label, subLabel, borderColor, isOnPath } = data as {
    label: string;
    subLabel: string;
    borderColor: string;
    isOnPath: boolean;
  };

  const bg = isOnPath ? "#ffffff" : "#111111";
  const textColor = isOnPath ? "#000000" : "#e5e5e5";
  const subColor = isOnPath ? "#444444" : "#666666";
  const border = isOnPath ? "#ffffff" : borderColor;
  const shadow = selected
    ? "0 0 0 3px rgba(255,255,255,0.5), 0 0 20px rgba(255,255,255,0.2)"
    : isOnPath
    ? "0 0 18px rgba(255,255,255,0.25)"
    : "none";

  return (
    <div
      style={{
        width: 80,
        height: 80,
        borderRadius: "50%",
        background: bg,
        border: `2.5px solid ${border}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: shadow,
        cursor: "pointer",
        userSelect: "none",
        transition: "box-shadow 0.15s",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ opacity: 0, width: 1, height: 1, background: "transparent", border: "none" }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ opacity: 0, width: 1, height: 1, background: "transparent", border: "none" }}
      />

      <div
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: label.length > 12 ? 9 : 11,
          fontWeight: 600,
          color: textColor,
          textAlign: "center",
          padding: "0 10px",
          lineHeight: 1.25,
          overflow: "hidden",
          maxWidth: 72,
          wordBreak: "break-word",
        }}
      >
        {label}
      </div>
      {subLabel && (
        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 8,
            color: subColor,
            marginTop: 2,
            textAlign: "center",
          }}
        >
          {subLabel}
        </div>
      )}
    </div>
  );
}

// ── Custom edge with label ─────────────────────────────────────────────────────
function LabeledEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  data, markerEnd, style,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const label = (data as any)?.label as string | undefined;
  const isOnPath = (data as any)?.isOnPath as boolean;

  return (
    <>
      <path
        id={id}
        style={style}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd={markerEnd}
      />
      {isOnPath && (
        <path
          d={edgePath}
          style={{
            stroke: "rgba(255,255,255,0.15)",
            strokeWidth: 8,
            fill: "none",
            strokeDasharray: "6 4",
            animation: "dash 1.2s linear infinite",
          }}
        />
      )}
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
              cursor: "pointer",
            }}
            className="nodrag nopan"
          >
            <div
              style={{
                background: "#111111",
                border: "1px solid #2e2e2e",
                borderRadius: 3,
                padding: "1px 5px",
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 9,
                color: isOnPath ? "#e5e5e5" : "#777777",
                whiteSpace: "nowrap",
                letterSpacing: "0.04em",
              }}
            >
              {label}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const NODE_TYPES = { circle: CircleNode };
const EDGE_TYPES = { labeled: LabeledEdge };

// ── Inspector panel ───────────────────────────────────────────────────────────
function Inspector({
  item,
  onClose,
}: {
  item: InspectorItem;
  onClose: () => void;
}) {
  const entries = Object.entries(item.data).filter(([k]) => k !== "__rf");

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: 220,
        height: "100%",
        background: "#0d0d0d",
        borderLeft: "1px solid #2e2e2e",
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid #2e2e2e",
          background: "#141414",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {item.kind === "node" ? (
            <Database
              style={{ width: 12, height: 12, color: "#888" }}
            />
          ) : (
            <GitBranch
              style={{ width: 12, height: 12, color: "#888" }}
            />
          )}
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: "#cccccc",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {item.kind === "node" ? item.label : "Relationship"}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{ color: "#666", background: "none", border: "none", cursor: "pointer", padding: 2 }}
          onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
          onMouseLeave={e => (e.currentTarget.style.color = "#666")}
        >
          <X style={{ width: 14, height: 14 }} />
        </button>
      </div>

      {/* Properties */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {entries.map(([key, val]) => (
          <div
            key={key}
            style={{
              padding: "4px 12px",
              borderBottom: "1px solid #1a1a1a",
            }}
          >
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 9,
                color: "#666",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 1,
              }}
            >
              {key}
            </div>
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                color: val === null || val === undefined ? "#444" : "#d4d4d4",
                fontStyle: val === null || val === undefined ? "italic" : "normal",
                wordBreak: "break-word",
                lineHeight: 1.4,
              }}
            >
              {val === null || val === undefined
                ? "null"
                : typeof val === "object"
                ? JSON.stringify(val)
                : String(val)}
            </div>
          </div>
        ))}
        {entries.length === 0 && (
          <div
            style={{
              padding: "16px 12px",
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: "#444",
              textAlign: "center",
            }}
          >
            no properties
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div
        style={{
          padding: "6px 12px",
          borderTop: "1px solid #1e1e1e",
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 9,
          color: "#444",
          flexShrink: 0,
        }}
      >
        click anywhere to deselect
      </div>
    </div>
  );
}

// ── Main GraphView ─────────────────────────────────────────────────────────────
export function GraphView({ nodes, edges, pathIds = [] }: GraphViewProps) {
  const pathSet = new Set(pathIds);
  const [inspector, setInspector] = useState<InspectorItem | null>(null);

  // Collect unique node IDs (from node records + edge endpoints)
  const nodeIdList = useMemo<string[]>(() => {
    const set = new Set<string>();
    nodes.forEach((n) => { if (n.id !== undefined) set.add(String(n.id)); });
    edges.forEach((e) => {
      if (e.from !== undefined) set.add(String(e.from));
      if (e.to !== undefined) set.add(String(e.to));
    });
    return Array.from(set);
  }, [nodes, edges]);

  const edgePairs = useMemo(
    () => edges.map((e) => ({ from: String(e.from), to: String(e.to) })),
    [edges],
  );

  // Compute spring layout once on data change
  const positions = useMemo(
    () => springLayout(nodeIdList, edgePairs),
    [nodeIdList, edgePairs],
  );

  // Build React Flow nodes
  const initialRfNodes: Node[] = useMemo(() => {
    return nodeIdList.map((id, i) => {
      const rec = nodes.find((n) => String(n.id) === id);
      const label = rec ? formatLabel(rec) : `Node ${id}`;
      const nodeType = getNodeType(rec);
      const isOnPath = pathSet.has(Number(id));
      const borderColor = BORDER_COLORS[i % BORDER_COLORS.length];
      const pos = positions[id] ?? { x: i * 120, y: 200 };

      return {
        id,
        type: "circle",
        position: pos,
        data: {
          label,
          subLabel: nodeType !== "Node" ? nodeType : `id:${id}`,
          borderColor,
          isOnPath,
          record: rec ?? { id },
          nodeType,
        },
        style: { background: "transparent", border: "none", padding: 0 },
      } satisfies Node;
    });
  }, [nodeIdList, positions, nodes, pathIds]);

  // Build React Flow edges
  const initialRfEdges: Edge[] = useMemo(() => {
    return edges.map((e, i) => {
      const from = String(e.from);
      const to = String(e.to);
      const fromOnPath = pathSet.has(Number(from));
      const toOnPath = pathSet.has(Number(to));
      const isOnPath = fromOnPath && toOnPath;
      const relType = e.relation_type as string | undefined;

      return {
        id: `e-${i}-${from}-${to}`,
        source: from,
        target: to,
        type: "labeled",
        data: { label: relType, isOnPath },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: isOnPath ? "#e5e5e5" : "#444444",
        },
        style: {
          stroke: isOnPath ? "#e5e5e5" : "#3a3a3a",
          strokeWidth: isOnPath ? 2 : 1.5,
        },
      } satisfies Edge;
    });
  }, [edges, pathIds]);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(initialRfNodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(initialRfEdges);

  // Sync when data changes
  useEffect(() => {
    setRfNodes(initialRfNodes);
  }, [initialRfNodes]);
  useEffect(() => {
    setRfEdges(initialRfEdges);
  }, [initialRfEdges]);

  const onNodeClick: OnNodeClick = useCallback((_evt, node) => {
    const rec = (node.data as any).record as Record<string, unknown>;
    const label = (node.data as any).nodeType as string;
    setInspector({ kind: "node", data: rec, label });
  }, []);

  const onEdgeClick: OnEdgeClick = useCallback((_evt, edge) => {
    const edgeRec = edges.find(
      (_, i) => `e-${i}-${edge.source}-${edge.target}` === edge.id,
    );
    setInspector({
      kind: "edge",
      data: edgeRec ?? { from: edge.source, to: edge.target },
    });
  }, [edges]);

  const onPaneClick = useCallback(() => setInspector(null), []);

  if (nodeIdList.length === 0) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <GitBranch style={{ width: 32, height: 32, color: "#2e2e2e" }} />
        <p
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 12,
            color: "#555",
          }}
        >
          run a FIND PATH query to visualise a graph
        </p>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", width: "100%", position: "relative", background: "#000000" }}>
      {/* Stats bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: inspector ? 220 : 0,
          height: 30,
          background: "#0d0d0d",
          borderBottom: "1px solid #1e1e1e",
          zIndex: 5,
          display: "flex",
          alignItems: "center",
          gap: 20,
          padding: "0 14px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Database style={{ width: 11, height: 11, color: "#555" }} />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#888" }}>
            {nodeIdList.length} nodes
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <GitBranch style={{ width: 11, height: 11, color: "#555" }} />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#888" }}>
            {edges.length} edges
          </span>
        </div>
        {pathIds.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Hash style={{ width: 11, height: 11, color: "#555" }} />
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#888" }}>
              path: {pathIds.length} hops
            </span>
          </div>
        )}
        <div style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 9,
            color: "#444",
            letterSpacing: "0.05em",
          }}
        >
          {inspector ? "viewing properties" : "click node or edge to inspect"}
        </span>
      </div>

      {/* Graph canvas */}
      <div
        style={{
          position: "absolute",
          top: 30,
          left: 0,
          right: inspector ? 220 : 0,
          bottom: 0,
        }}
      >
        <style>{`
          @keyframes dash {
            to { stroke-dashoffset: -20; }
          }
          .react-flow__attribution { display: none; }
          .react-flow__controls {
            background: #141414 !important;
            border: 1px solid #2e2e2e !important;
            border-radius: 6px !important;
            box-shadow: none !important;
          }
          .react-flow__controls button {
            background: transparent !important;
            border: none !important;
            border-bottom: 1px solid #1e1e1e !important;
            color: #777 !important;
            fill: #777 !important;
          }
          .react-flow__controls button:hover {
            background: #1e1e1e !important;
            color: #fff !important;
            fill: #fff !important;
          }
          .react-flow__controls button:last-child {
            border-bottom: none !important;
          }
          .react-flow__minimap {
            background: #0a0a0a !important;
            border: 1px solid #2e2e2e !important;
            border-radius: 6px !important;
          }
        `}</style>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          minZoom={0.1}
          maxZoom={5}
          colorMode="dark"
          defaultEdgeOptions={{ type: "labeled" }}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1}
            color="#1a1a1a"
          />
          <Controls position="bottom-left" />
          <MiniMap
            position="bottom-right"
            nodeColor={(n) => {
              const d = n.data as any;
              return d?.isOnPath ? "#ffffff" : d?.borderColor ?? "#333333";
            }}
            maskColor="rgba(0,0,0,0.7)"
            style={{ borderRadius: 6 }}
          />
        </ReactFlow>
      </div>

      {/* Inspector */}
      {inspector && (
        <Inspector item={inspector} onClose={() => setInspector(null)} />
      )}
    </div>
  );
}
