import { useState } from "react";
import { useListQueryHistory } from "@workspace/api-client-react";
import { format } from "date-fns";
import {
  History, CheckCircle2, XCircle, Loader2, Play, ChevronLeft, ChevronRight,
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

interface QueryHistoryProps {
  onLoadQuery?: (query: string) => void;
}

export function QueryHistory({ onLoadQuery }: QueryHistoryProps) {
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<"all" | "success" | "error">("all");

  const { data: allHistory, isLoading } = useListQueryHistory({ limit: 200 });

  const filtered = Array.isArray(allHistory)
    ? allHistory.filter(item => {
        if (filter === "success") return item.success;
        if (filter === "error") return !item.success;
        return true;
      })
    : [];

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="flex flex-col h-full bg-panel-bg border-t border-panel-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-foreground/[0.08] bg-foreground/[0.03] shrink-0">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <History className="w-3.5 h-3.5" />
          Query History
          {filtered.length > 0 && (
            <span className="bg-foreground/5 text-muted-foreground/60 text-[10px] px-1.5 py-0.5 rounded-full font-mono">
              {filtered.length}
            </span>
          )}
        </h2>

        {/* Filter buttons */}
        <div className="flex items-center gap-1 text-[10px]">
          <Filter className="w-3 h-3 text-muted-foreground/40 mr-1" />
          {(["all", "success", "error"] as const).map(f => (
            <button
              key={f}
              onClick={() => { setFilter(f); setPage(0); }}
              className={cn(
                "px-2 py-0.5 rounded-md font-medium transition-all capitalize",
                filter === f
                  ? f === "error"
                    ? "bg-red-500/15 text-red-400"
                    : f === "success"
                    ? "bg-foreground/10 text-foreground/80"
                    : "bg-foreground/10 text-foreground"
                  : "text-muted-foreground/60 hover:text-muted-foreground"
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-x-auto overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center p-4">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : pageItems.length === 0 ? (
          <div className="text-center p-6 text-sm text-muted-foreground italic">
            {filter === "all" ? "No history recorded yet." : `No ${filter} queries.`}
          </div>
        ) : (
          <table className="w-full text-left border-collapse whitespace-nowrap min-w-[600px]">
            <thead className="bg-foreground/[0.04] text-xs text-muted-foreground font-medium sticky top-0 shadow-sm border-b border-foreground/[0.08] z-10">
              <tr>
                <th className="py-2 px-3 w-8">St</th>
                <th className="py-2 px-3">Query</th>
                <th className="py-2 px-3 w-24">Time</th>
                <th className="py-2 px-3 w-20">Exec (ms)</th>
                <th className="py-2 px-3 w-16">Rows</th>
                <th className="py-2 px-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="text-[12px] font-mono">
              {pageItems.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-foreground/[0.06] hover:bg-foreground/[0.03] text-foreground/80 group transition-colors"
                >
                  <td className="py-1.5 px-3">
                    {item.success ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-foreground/40" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-red-400" />
                    )}
                  </td>
                  <td className="py-1.5 px-3 max-w-xs">
                    <span className="block truncate text-muted-foreground/80" title={item.query}>
                      {item.query.replace(/\s+/g, ' ').trim()}
                    </span>
                  </td>
                  <td className="py-1.5 px-3 text-muted-foreground/50 text-[11px]">
                    {format(new Date(item.executedAt), 'HH:mm:ss')}
                  </td>
                  <td className="py-1.5 px-3 text-muted-foreground/60">
                    <span className={cn(
                      "font-mono",
                      item.executionTimeMs > 100 ? "text-foreground/50" : "text-foreground/40"
                    )}>
                      {item.executionTimeMs}
                    </span>
                  </td>
                  <td className="py-1.5 px-3 text-muted-foreground/60">
                    {item.rowCount !== undefined ? item.rowCount : '—'}
                  </td>
                  <td className="py-1.5 px-3">
                    {onLoadQuery && (
                      <button
                        onClick={() => onLoadQuery(item.query)}
                        title="Load into editor"
                        className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                      >
                        <Play className="w-3 h-3" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination footer */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-1.5 border-t border-foreground/[0.08] bg-foreground/[0.02] shrink-0">
          <span className="text-[10px] text-muted-foreground/50">
            {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-foreground/10 disabled:opacity-30 transition-all"
            >
              <ChevronLeft className="w-3 h-3" />
            </button>
            <span className="text-[10px] text-muted-foreground/60 px-1 font-mono">
              {safePage + 1}/{totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-foreground/10 disabled:opacity-30 transition-all"
            >
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
