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

function strategyLabel(strategy?: string) {
  if (!strategy) return "UNKNOWN";
  return strategy;
}

function Sparkline({ data }: { data: TimingEntry[] }) {
  if (data.length < 2) return null;
  const maxMs = Math.max(...data.map(d => d.ms), 1);
  const w = 60, h = 14;
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (d.ms / maxMs) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = data[data.length - 1];
  return (
    <span className="inline-flex items-center gap-1.5 shrink-0">
      <svg width={w} height={h} className="overflow-visible">
        <polyline
          points={pts.join(" ")}
          fill="none"
          stroke="rgba(200,200,200,0.35)"
          strokeWidth="1"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {data.map((d, i) => (
          <circle
            key={i}
            cx={(i / (data.length - 1)) * w}
            cy={h - (d.ms / maxMs) * (h - 2) - 1}
            r="1.5"
            fill={d.success ? 'rgba(180,180,180,0.6)' : 'rgba(180,60,60,0.7)'}
          />
        ))}
      </svg>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#555' }}>
        {last.ms}ms
      </span>
    </span>
  );
}

export function ResultsView({ result, activeTab, setActiveTab, timingHistory = [] }: ResultsViewProps) {
  const [page, setPage] = useState(0);

  const data: Record<string, unknown>[] = useMemo(() => {
    setPage(0);
    return Array.isArray(result?.data) ? result.data : [];
  }, [result]);

  if (!result) {
    return (
      <div className="flex flex-col h-full border-t" style={{ background: '#000000', borderColor: '#2e2e2e' }}>
        <div className="flex-1 flex items-center justify-center flex-col gap-2">
          <TableIcon className="w-8 h-8" style={{ color: '#555555' }} />
          <p style={{ color: '#666666', fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" }}>run a query to see results</p>
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
    <div className="flex flex-col h-full border-t" style={{ background: '#000000', borderColor: '#2e2e2e' }}>
      {/* Tab Bar */}
      <div
        className="flex items-center justify-between shrink-0 border-b"
        style={{ background: '#1a1a1a', borderColor: '#2e2e2e' }}
      >
        <div className="flex items-end">
          <TabBtn icon={TableIcon} label="Table"   tab="results" active={activeTab} onClick={setActiveTab} />
          <TabBtn icon={FileJson}  label="JSON"    tab="json"    active={activeTab} onClick={setActiveTab} />
          <TabBtn icon={Info}      label="Info"    tab="info"    active={activeTab} onClick={setActiveTab} />
          {hasGraph && (
            <TabBtn icon={GitBranch} label="Graph" tab="graph" active={activeTab} onClick={setActiveTab} />
          )}
        </div>

        <div className="flex items-center gap-2 pr-2">
          {!isError && data.length > PAGE_SIZE && (
            <div
              className="text-[10px]"
              style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#666' }}
            >
              {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, data.length)} / {data.length}
            </div>
          )}
          {!isError && data.length > 0 && (
            <>
              <ExportBtn label="CSV"  onClick={() => exportCSV(data, result.columns ?? [])} />
              <ExportBtn label="JSON" onClick={() => exportJSON(data)} />
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden relative" style={{ background: '#000000' }}>
        {isError ? (
          <div
            className="absolute inset-0 p-5 flex items-start overflow-auto"
            style={{ background: 'rgba(100,20,20,0.08)' }}
          >
            <AlertCircle className="w-4 h-4 mr-3 mt-0.5 shrink-0" style={{ color: '#c44' }} />
            <div>
              <h3
                className="font-semibold mb-1"
                style={{ color: '#e06060', fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" }}
              >
                Query Error
              </h3>
              <p
                className="break-all whitespace-pre-wrap"
                style={{ color: '#c87070', fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" }}
              >
                {result.error}
              </p>
            </div>
          </div>
        ) : (
          <>
            {result.message && (
              <div
                className="absolute top-0 left-0 right-0 z-20 flex items-center gap-2 px-3 py-1.5 border-b"
                style={{ background: '#0f1a0f', borderColor: '#1e3a1e', color: '#7a9a7a', fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" }}
              >
                <Activity className="w-3.5 h-3.5 shrink-0" />
                <span>{result.message}</span>
              </div>
            )}

            {/* TABLE */}
            {activeTab === "results" && (
              <div className={cn("absolute inset-0 flex flex-col", result.message && "top-[30px]")}>
                {data.length > 0 ? (
                  <>
                    <div className="flex-1 overflow-auto">
                      <table className="w-full text-left border-collapse" style={{ fontSize: 12 }}>
                        <thead
                          className="sticky top-0 z-10"
                          style={{ background: '#1a1a1a', borderBottom: '1px solid #2e2e2e' }}
                        >
                          <tr>
                            <th
                              className="py-1.5 px-3 text-center border-r w-8"
                              style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#666666', borderColor: '#2e2e2e', fontSize: 10, fontWeight: 400 }}
                            >
                              #
                            </th>
                            {result.columns?.map((col: string) => (
                              <th
                                key={col}
                                className="py-1.5 px-3 border-r last:border-0 truncate max-w-[200px]"
                                style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#cccccc', borderColor: '#2e2e2e', fontSize: 11, fontWeight: 500 }}
                              >
                                <div className="flex items-center gap-1.5">
                                  <ArrowUpDown className="w-2.5 h-2.5 shrink-0" style={{ color: '#555' }} />
                                  {col}
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {pageData.map((row: any, i: number) => (
                            <tr
                              key={safePage * PAGE_SIZE + i}
                              className="border-b"
                              style={{ borderColor: '#1a1a1a' }}
                              onMouseEnter={e => (e.currentTarget.style.background = '#0d0d0d')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                              <td
                                className="py-1 px-3 text-center border-r"
                                style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#555555', borderColor: '#1a1a1a', fontSize: 10 }}
                              >
                                {safePage * PAGE_SIZE + i + 1}
                              </td>
                              {result.columns?.map((col: string) => (
                                <td
                                  key={col}
                                  className="py-1 px-3 border-r last:border-0 truncate max-w-[300px]"
                                  style={{ fontFamily: "'IBM Plex Mono', monospace", borderColor: '#1a1a1a' }}
                                >
                                  {formatCellValue(row[col])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {totalPages > 1 && (
                      <div
                        className="flex items-center justify-between px-4 py-1 border-t shrink-0"
                        style={{ background: '#1a1a1a', borderColor: '#2e2e2e' }}
                      >
                        <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#666', fontSize: 10 }}>
                          {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, data.length)} of {data.length} rows
                        </span>
                        <div className="flex items-center gap-1">
                          <PaginationBtn onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0}>
                            <ChevronLeft className="w-3 h-3" />
                          </PaginationBtn>
                          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#777', fontSize: 10, padding: '0 8px' }}>
                            {safePage + 1} / {totalPages}
                          </span>
                          <PaginationBtn onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1}>
                            <ChevronRight className="w-3 h-3" />
                          </PaginationBtn>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div
                    className="h-full flex items-center justify-center"
                    style={{ color: '#666', fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" }}
                  >
                    success — no rows returned
                  </div>
                )}
              </div>
            )}

            {/* RAW JSON */}
            {activeTab === "json" && (
              <div className="absolute inset-0 overflow-auto p-4">
                <pre style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: '#aaaaaa', lineHeight: 1.6 }}>
                  {JSON.stringify(result.data || result, null, 2)}
                </pre>
              </div>
            )}

            {/* INFO */}
            {activeTab === "info" && (
              <div className="absolute inset-0 overflow-auto p-5">
                <div className="max-w-xl space-y-3">
                  <InfoSection title="Query Profile" icon={Activity}>
                    <InfoRow label="Execution time" value={`${result.executionTimeMs} ms`} />
                    <InfoRow label="Rows returned"  value={String(result.rowCount ?? 0)} />
                    <InfoRow label="Engine"         value="UQL C++ Engine v1.0" />
                    <InfoRow label="Status"         value="SUCCESS" highlight />
                  </InfoSection>

                  {result.plan && (
                    <InfoSection title="Execution Plan" icon={Layers}>
                      <InfoRow label="Strategy" value={strategyLabel(result.plan.strategy)} mono />
                      <div
                        className="mt-2 px-3 py-2 border rounded-sm"
                        style={{ background: '#0d0d0d', borderColor: '#2e2e2e' }}
                      >
                        <p style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#666', fontSize: 11, lineHeight: 1.6 }}>
                          {result.plan.detail}
                        </p>
                      </div>
                    </InfoSection>
                  )}

                  {hasGraph && (
                    <InfoSection title="Graph Info" icon={GitBranch}>
                      <InfoRow label="Path length"  value={String(result.rowCount ?? 0)} />
                      <InfoRow label="Total nodes"  value={String(result.graphData?.nodes?.length ?? 0)} />
                      <InfoRow label="Total edges"  value={String(result.graphData?.edges?.length ?? 0)} />
                      <InfoRow label="Algorithm"    value="BFS" />
                    </InfoSection>
                  )}
                </div>
              </div>
            )}

            {/* GRAPH */}
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

// ── Status Bar ──────────────────────────────────────────────────────────────
function StatusBar({ result, timingHistory }: { result: any; timingHistory: TimingEntry[] }) {
  const isError = result && !result.success;
  return (
    <div
      className="flex items-center justify-between px-4 shrink-0"
      style={{ height: 22, background: '#1a1a1a', borderTop: '1px solid #2e2e2e' }}
    >
      <div className="flex items-center gap-4">
        <span
          className="flex items-center gap-1.5"
          style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#666', fontSize: 10 }}
        >
          <Activity className="w-2.5 h-2.5" />
          UQL Engine
        </span>
        {result && (
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              color: isError ? '#c44' : '#6a6',
              fontSize: 10,
            }}
          >
            {isError ? "ERROR" : "OK"}
          </span>
        )}
        {result?.plan?.strategy && (
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#555', fontSize: 10 }}>
            {result.plan.strategy}
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        {timingHistory.length >= 2 && <Sparkline data={timingHistory} />}
        {result && !isError && (
          <>
            {result.graphData && (
              <span className="flex items-center gap-1" style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#666', fontSize: 10 }}>
                <GitBranch className="w-2.5 h-2.5" /> graph
              </span>
            )}
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#666', fontSize: 10 }}>
              {result.rowCount ?? 0} rows
            </span>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#666', fontSize: 10 }}>
              {result.executionTimeMs}ms
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function formatCellValue(val: any) {
  if (val === null || val === undefined)
    return <span style={{ color: '#555', fontStyle: 'italic' }}>null</span>;
  if (typeof val === "boolean")
    return <span style={{ color: '#aaa' }}>{val.toString()}</span>;
  if (typeof val === "number")
    return <span style={{ color: '#cccccc' }}>{val}</span>;
  if (typeof val === "object")
    return <span style={{ color: '#aaaaaa' }}>{JSON.stringify(val)}</span>;
  return <span style={{ color: '#cccccc' }}>{String(val)}</span>;
}

function TabBtn({ icon: Icon, label, tab, active, onClick }: {
  icon: any; label: string; tab: Tab; active: Tab; onClick: (t: Tab) => void;
}) {
  const isActive = active === tab;
  return (
    <button
      onClick={() => onClick(tab)}
      className="flex items-center gap-1.5 px-3 transition-all border-t-2"
      style={{
        height: 30,
        fontSize: 11,
        fontFamily: "'IBM Plex Mono', monospace",
        color: isActive ? '#ffffff' : '#888888',
        background: isActive ? '#000000' : 'transparent',
        borderTopColor: isActive ? '#ffffff' : 'transparent',
      }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = '#cccccc'; }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = '#888888'; }}
    >
      <Icon className="w-3 h-3" />
      {label}
    </button>
  );
}

function ExportBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-0.5 border transition-colors"
      style={{
        fontSize: 10,
        fontFamily: "'IBM Plex Mono', monospace",
        color: '#777',
        borderColor: '#2a2a2a',
        borderRadius: 3,
        background: 'transparent',
      }}
      onMouseEnter={e => { e.currentTarget.style.color = '#cccccc'; e.currentTarget.style.borderColor = '#444'; }}
      onMouseLeave={e => { e.currentTarget.style.color = '#777'; e.currentTarget.style.borderColor = '#2a2a2a'; }}
    >
      <Download className="w-2.5 h-2.5" />
      {label}
    </button>
  );
}

function PaginationBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="p-0.5 transition-colors disabled:opacity-30"
      style={{ color: '#666', borderRadius: 2 }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.color = '#cccccc'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#666'; }}
    >
      {children}
    </button>
  );
}

function InfoSection({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="border" style={{ borderColor: '#2e2e2e', borderRadius: 3 }}>
      <div className="flex items-center gap-2 px-4 py-2 border-b" style={{ borderColor: '#2e2e2e', background: '#1a1a1a' }}>
        <Icon className="w-3.5 h-3.5" style={{ color: '#888888' }} />
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#cccccc', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {title}
        </span>
      </div>
      <div className="px-4 py-3 space-y-2">{children}</div>
    </div>
  );
}

function InfoRow({ label, value, mono, highlight }: { label: string; value: string; mono?: boolean; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", color: '#777', fontSize: 11 }}>{label}</span>
      <span style={{
        fontFamily: mono || highlight ? "'IBM Plex Mono', monospace" : "'IBM Plex Sans', sans-serif",
        color: highlight ? '#8a8' : '#aaa',
        fontSize: 11,
      }}>
        {value}
      </span>
    </div>
  );
}
