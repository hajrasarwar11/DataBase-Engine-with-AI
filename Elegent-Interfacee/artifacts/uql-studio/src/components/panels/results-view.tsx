import { useState, useMemo } from "react";
import {
  Table as TableIcon, FileJson, Info, AlertCircle,
  Clock, Hash, Activity, Database, GitBranch,
  Download, ArrowUpDown, Layers, ChevronLeft, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GraphView } from "./graph-view";
import type { TimingEntry } from "@/hooks/use-ide-state";

type Tab = "results" | "json" | "info" | "graph";

const PAGE_SIZE = 50;

interface ResultsViewProps {
  result: any | null;
  activeTab: Tab;
  setActiveTab: (t: Tab) => void;
  timingHistory?: TimingEntry[];
}

// ── Export helpers ──────────────────────────────────────────────────────────
function downloadText(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function exportCSV(data: Record<string, unknown>[], columns: string[]) {
  const header = columns.map(c => `"${c}"`).join(",");
  const rows = data.map(row =>
    columns.map(c => {
      const v = row[c];
      if (v === null || v === undefined) return "";
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    }).join(",")
  );
  downloadText([header, ...rows].join("\n"), "uql-results.csv", "text/csv");
}

function exportJSON(data: unknown) {
  downloadText(JSON.stringify(data, null, 2), "uql-results.json", "application/json");
}

// ── Plan strategy badge color ──────────────────────────────────────────────
function strategyColor(strategy?: string) {
  if (!strategy) return "bg-gray-500/20 text-gray-300";
  if (strategy.includes("INDEX"))     return "bg-cyan-500/20 text-cyan-300";
  if (strategy.includes("BFS"))       return "bg-purple-500/20 text-purple-300";
  if (strategy.includes("JOIN"))      return "bg-orange-500/20 text-orange-300";
  if (strategy.includes("AGGREGATE")) return "bg-green-500/20 text-green-300";
  if (strategy.includes("FULL"))      return "bg-yellow-500/20 text-yellow-300";
  if (strategy === "DDL")             return "bg-blue-500/20 text-blue-300";
  if (strategy === "EXPLAIN")         return "bg-violet-500/20 text-violet-300";
  return "bg-gray-500/20 text-gray-300";
}

// ── Sparkline SVG ──────────────────────────────────────────────────────────
function Sparkline({ data }: { data: TimingEntry[] }) {
  if (data.length < 2) return null;
  const maxMs = Math.max(...data.map(d => d.ms), 1);
  const w = 80, h = 18;
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (d.ms / maxMs) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = data[data.length - 1];
  return (
    <span className="inline-flex items-center gap-1.5 shrink-0" title={`Last ${data.length} queries`}>
      <svg width={w} height={h} className="overflow-visible">
        <polyline
          points={pts.join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          className="text-primary-foreground/50"
        />
        {data.map((d, i) => (
          <circle
            key={i}
            cx={(i / (data.length - 1)) * w}
            cy={h - (d.ms / maxMs) * (h - 2) - 1}
            r="1.5"
            className={d.success ? "fill-emerald-300/80" : "fill-red-400/80"}
          />
        ))}
      </svg>
      <span className="text-primary-foreground/60 text-[10px] font-mono">{last.ms}ms</span>
    </span>
  );
}

export function ResultsView({ result, activeTab, setActiveTab, timingHistory = [] }: ResultsViewProps) {
  const [page, setPage] = useState(0);

  // Reset to page 0 when result changes
  const data: Record<string, unknown>[] = useMemo(() => {
    setPage(0);
    return Array.isArray(result?.data) ? result.data : [];
  }, [result]);

  if (!result) {
    return (
      <div className="flex flex-col h-full bg-panel-bg border-t border-panel-border">
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm flex-col gap-3">
          <div className="w-16 h-16 rounded-2xl bg-foreground/5 flex items-center justify-center border border-foreground/[0.08] shadow-inner">
            <TableIcon className="w-8 h-8 opacity-20" />
          </div>
          <p>Run a query to see results</p>
        </div>
        <StatusBar timingHistory={timingHistory} result={null} />
      </div>
    );
  }

  const hasGraph = result.graphData && (
    result.graphData.nodes?.length > 0 || result.graphData.edges?.length > 0
  );
  const isError = !result.success;

  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageData = data.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const pathIds: number[] = data.map((r: any) => r.id).filter(Boolean);

  return (
    <div className="flex flex-col h-full bg-panel-bg border-t border-panel-border">
      {/* Tabs + Export Buttons */}
      <div className="flex items-center justify-between px-2 pt-2 border-b border-foreground/[0.08] bg-foreground/[0.03] shrink-0">
        <div className="flex items-center">
          <TabButton icon={TableIcon} label="Table"   tab="results" active={activeTab} onClick={setActiveTab} />
          <TabButton icon={FileJson}  label="JSON"    tab="json"    active={activeTab} onClick={setActiveTab} />
          <TabButton icon={Info}      label="Info"    tab="info"    active={activeTab} onClick={setActiveTab} />
          {hasGraph && (
            <TabButton icon={GitBranch} label="Graph" tab="graph" active={activeTab} onClick={setActiveTab} />
          )}
        </div>

        <div className="flex items-center gap-2 pr-2">
          {/* Pagination indicator */}
          {!isError && data.length > PAGE_SIZE && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60 font-mono mr-1">
              <span>{safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, data.length)}</span>
              <span className="opacity-40">/ {data.length}</span>
            </div>
          )}

          {/* Export buttons */}
          {!isError && data.length > 0 && (
            <>
              <button
                onClick={() => exportCSV(data, result.columns ?? [])}
                className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border border-foreground/10 text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-all"
                title="Export all rows as CSV"
              >
                <Download className="w-2.5 h-2.5" />
                CSV
              </button>
              <button
                onClick={() => exportJSON(data)}
                className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border border-foreground/10 text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-all"
                title="Export all rows as JSON"
              >
                <Download className="w-2.5 h-2.5" />
                JSON
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden relative bg-editor-bg">
        {isError ? (
          <div className="absolute inset-0 p-6 flex items-start text-destructive-foreground bg-destructive/10 overflow-auto">
            <AlertCircle className="w-5 h-5 mr-3 mt-0.5 text-destructive shrink-0" />
            <div>
              <h3 className="font-semibold text-destructive mb-1">Query Execution Error</h3>
              <p className="font-mono text-sm break-all whitespace-pre-wrap">{result.error}</p>
            </div>
          </div>
        ) : (
          <>
            {result.message && (
              <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-3 px-4 py-2 bg-emerald-500/10 border-b border-emerald-500/20 text-emerald-300 text-sm font-medium">
                <Activity className="w-4 h-4 shrink-0 text-emerald-400" />
                <span>{result.message}</span>
              </div>
            )}

            {/* TABLE VIEW */}
            {activeTab === "results" && (
              <div className={cn("absolute inset-0 flex flex-col", result.message && "top-10")}>
                {data.length > 0 ? (
                  <>
                    <div className="flex-1 overflow-auto">
                      <table className="w-full text-left border-collapse text-sm">
                        <thead className="bg-background/80 sticky top-0 backdrop-blur-md z-10 shadow-sm border-b border-foreground/[0.12]">
                          <tr>
                            <th className="py-2 px-3 font-medium text-muted-foreground w-10 text-center border-r border-foreground/[0.08] text-xs">#</th>
                            {result.columns?.map((col: string) => (
                              <th key={col} className="py-2 px-3 font-semibold text-foreground/80 border-r border-foreground/[0.08] last:border-0 truncate max-w-[200px] text-xs">
                                <div className="flex items-center gap-1.5">
                                  <ArrowUpDown className="w-3 h-3 text-muted-foreground/30 shrink-0" />
                                  {col}
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="font-mono text-xs text-muted-foreground">
                          {pageData.map((row: any, i: number) => (
                            <tr key={safePage * PAGE_SIZE + i} className="border-b border-foreground/[0.06] hover:bg-foreground/[0.02] transition-colors">
                              <td className="py-1.5 px-3 text-center text-muted-foreground/30 border-r border-foreground/[0.06] text-[11px]">
                                {safePage * PAGE_SIZE + i + 1}
                              </td>
                              {result.columns?.map((col: string) => (
                                <td key={col} className="py-1.5 px-3 border-r border-foreground/[0.06] last:border-0 truncate max-w-[300px]">
                                  {formatCellValue(row[col])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Row pagination */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between px-4 py-1.5 border-t border-foreground/[0.08] bg-foreground/[0.02] shrink-0">
                        <span className="text-[10px] text-muted-foreground/50 font-mono">
                          Showing {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, data.length)} of {data.length} rows
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setPage(p => Math.max(0, p - 1))}
                            disabled={safePage === 0}
                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-foreground/10 disabled:opacity-30 transition-all"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                          </button>
                          <span className="text-[11px] text-muted-foreground/60 px-2 font-mono">
                            {safePage + 1} / {totalPages}
                          </span>
                          <button
                            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                            disabled={safePage >= totalPages - 1}
                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-foreground/10 disabled:opacity-30 transition-all"
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                    Success — no rows returned.
                  </div>
                )}
              </div>
            )}

            {/* RAW JSON */}
            {activeTab === "json" && (
              <div className="absolute inset-0 overflow-auto p-4">
                <pre className="font-mono text-sm text-emerald-400/80 leading-relaxed">
                  {JSON.stringify(result.data || result, null, 2)}
                </pre>
              </div>
            )}

            {/* EXECUTION INFO */}
            {activeTab === "info" && (
              <div className="absolute inset-0 overflow-auto p-6">
                <div className="max-w-2xl space-y-4">
                  <div className="bg-foreground/[0.04] border border-foreground/[0.12] rounded-xl p-5">
                    <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                      <Activity className="w-4 h-4 text-primary" />
                      Query Profile
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <InfoCard icon={Clock}    label="Execution Time" value={`${result.executionTimeMs} ms`} />
                      <InfoCard icon={Hash}     label="Rows Returned"  value={result.rowCount ?? 0} />
                      <InfoCard icon={Database} label="Query Engine"   value="UQL C++ Engine v1.0" />
                      <InfoCard icon={Info}     label="Status"         value="SUCCESS" valueClass="text-emerald-400" />
                    </div>
                  </div>

                  {result.plan && (
                    <div className="bg-foreground/[0.04] border border-foreground/[0.12] rounded-xl p-5">
                      <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                        <Layers className="w-4 h-4 text-primary" />
                        Query Execution Plan
                      </h3>
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Strategy:</span>
                          <span className={cn("px-2 py-0.5 rounded-md text-xs font-mono font-semibold", strategyColor(result.plan.strategy))}>
                            {result.plan.strategy}
                          </span>
                        </div>
                        <div className="bg-foreground/[0.03] rounded-lg p-3 border border-foreground/[0.08]">
                          <p className="text-xs text-muted-foreground leading-relaxed font-mono">{result.plan.detail}</p>
                        </div>
                        <div className="text-xs text-muted-foreground/60">
                          UQL engine uses B+ Tree primary index for id=X lookups, secondary indexes for indexed fields, and sequential scans for all other queries.
                        </div>
                      </div>
                    </div>
                  )}

                  {hasGraph && (
                    <div className="bg-foreground/[0.04] border border-foreground/[0.12] rounded-xl p-5">
                      <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                        <GitBranch className="w-4 h-4 text-purple-400" />
                        Graph Traversal Info
                      </h3>
                      <div className="grid grid-cols-2 gap-3">
                        <InfoCard icon={Hash}      label="Path Length"  value={result.rowCount ?? 0} />
                        <InfoCard icon={Database}  label="Total Nodes"  value={result.graphData?.nodes?.length ?? 0} />
                        <InfoCard icon={GitBranch} label="Total Edges"  value={result.graphData?.edges?.length ?? 0} />
                        <InfoCard icon={Activity}  label="Algorithm"    value="BFS (Breadth-First Search)" />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* GRAPH VIEW */}
            {activeTab === "graph" && hasGraph && (
              <div className="absolute inset-0">
                <GraphView
                  nodes={(result.graphData?.nodes ?? []) as Record<string, unknown>[]}
                  edges={(result.graphData?.edges ?? []) as Record<string, unknown>[]}
                  pathIds={pathIds}
                />
              </div>
            )}
          </>
        )}
      </div>

      <StatusBar timingHistory={timingHistory} result={result} />
    </div>
  );
}

// ── Status Bar ─────────────────────────────────────────────────────────────
function StatusBar({ result, timingHistory }: { result: any; timingHistory: TimingEntry[] }) {
  const isError = result && !result.success;
  return (
    <div className="h-7 bg-primary text-primary-foreground flex items-center px-4 text-[11px] font-medium justify-between shadow-[0_-2px_10px_rgba(6,182,212,0.1)] shrink-0">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5">
          <Activity className="w-3 h-3" /> UQL Engine Online
        </span>
        {result && (
          <span className={cn("px-2 py-0.5 rounded-sm bg-foreground/[0.03]", isError ? "text-red-200" : "text-emerald-100")}>
            {isError ? "ERROR" : "SUCCESS"}
          </span>
        )}
        {result?.plan?.strategy && (
          <span className="text-primary-foreground/60">{result.plan.strategy}</span>
        )}
      </div>
      <div className="flex items-center gap-4 text-primary-foreground/80">
        {timingHistory.length >= 2 && <Sparkline data={timingHistory} />}
        {result && !isError && (
          <>
            {result.graphData && <span className="flex items-center gap-1"><GitBranch className="w-3 h-3" /> Graph</span>}
            <span>{result.rowCount ?? 0} rows</span>
            <span>{result.executionTimeMs}ms</span>
          </>
        )}
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
function formatCellValue(val: any) {
  if (val === null || val === undefined) return <span className="text-muted-foreground/30 italic">null</span>;
  if (typeof val === "boolean") return <span className="text-purple-400">{val.toString()}</span>;
  if (typeof val === "number")  return <span className="text-orange-400">{val}</span>;
  if (typeof val === "object")  return <span className="text-emerald-600 truncate">{JSON.stringify(val)}</span>;
  return <span>{String(val)}</span>;
}

function TabButton({ icon: Icon, label, tab, active, onClick }: {
  icon: any; label: string; tab: Tab; active: Tab; onClick: (t: Tab) => void;
}) {
  return (
    <button
      onClick={() => onClick(tab)}
      className={cn(
        "flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg transition-all border-b-2 border-transparent",
        active === tab
          ? "bg-editor-bg text-primary border-primary shadow-[0_-4px_10px_rgba(0,0,0,0.2)]"
          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground/80"
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

function InfoCard({ icon: Icon, label, value, valueClass }: {
  icon: any; label: string; value: any; valueClass?: string;
}) {
  return (
    <div className="bg-panel-bg border border-foreground/[0.08] p-3 rounded-lg flex items-center gap-3">
      <div className="p-2 bg-foreground/5 rounded-md shrink-0">
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
        <div className={cn("text-sm font-semibold font-mono truncate", valueClass || "text-foreground")}>{value}</div>
      </div>
    </div>
  );
}

