import { useIdeState } from "@/hooks/use-ide-state";
import { SchemaExplorer } from "@/components/panels/schema-explorer";
import { QueryEditor } from "@/components/panels/query-editor";
import { ResultsView } from "@/components/panels/results-view";
import { AIAssistant } from "@/components/panels/ai-assistant";
import { QueryHistory } from "@/components/panels/query-history";
import { SavedQueries } from "@/components/panels/saved-queries";
import { ShortcutsOverlay } from "@/components/panels/shortcuts-overlay";
import {
  PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
  History, LayoutTemplate, Sun, Moon, Plus, X as XIcon,
  Bookmark, WifiOff, Wifi, AlertTriangle, RotateCcw, Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { getListDatabasesQueryKey, useListDatabases } from "@workspace/api-client-react";

// ── Connection health polling ─────────────────────────────────────────────────
function useConnectionStatus() {
  const [status, setStatus] = useState<"online" | "offline" | "checking">("checking");
  const [latency, setLatency] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const t0 = performance.now();
      try {
        const r = await fetch("/api/healthz", { method: "GET" });
        if (!cancelled) {
          setLatency(Math.round(performance.now() - t0));
          setStatus(r.ok ? "online" : "offline");
        }
      } catch {
        if (!cancelled) { setStatus("offline"); setLatency(null); }
      }
    };
    check();
    const id = setInterval(check, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return { status, latency };
}

export default function Studio() {
  const state = useIdeState();
  const queryClient = useQueryClient();
  const { data: databases = [] } = useListDatabases();
  const { status: connStatus, latency } = useConnectionStatus();

  const activeDatabaseName =
    Array.isArray(databases)
      ? databases.find((d) => d.id === state.activeDatabaseId)?.name ?? null
      : null;

  // ── Execution complete handler ──────────────────────────────────────────────
  const handleExecutionComplete = useCallback((result: any, rawQuery: string) => {
    state.setActiveTabResult(result);
    state.recordTiming(result.executionTimeMs ?? 0, result.success ?? false);

    if (!result.success) return;

    // Auto-switch to graph tab when graphData is present
    if (result.graphData?.nodes?.length > 0 || result.graphData?.edges?.length > 0) {
      state.setActiveTab('graph');
    }

    // Track transaction state
    const upper = rawQuery.trim().toUpperCase().replace(/\s+/g, ' ');
    const firstWord = upper.split(/\s/)[0];
    if (firstWord === 'BEGIN') state.setIsInTransaction(true);
    if (firstWord === 'COMMIT' || firstWord === 'ROLLBACK') state.setIsInTransaction(false);

    // Refresh schema on DDL
    const isReadOnly = firstWord === "FIND" || firstWord === "SHOW" || firstWord === "EXPLAIN";
    if (!isReadOnly) {
      queryClient.invalidateQueries({ queryKey: getListDatabasesQueryKey() });
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === "string" && key.includes("/collections");
        },
      });
    }
  }, [state, queryClient]);

  // ── Rollback from banner ───────────────────────────────────────────────────
  const handleRollback = useCallback(async () => {
    try {
      const r = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'ROLLBACK' }),
      });
      const data = await r.json();
      state.setIsInTransaction(false);
      state.setActiveTabResult(data);
    } catch {}
  }, [state]);

  // ── Collection click ───────────────────────────────────────────────────────
  const handleCollectionClick = useCallback((dbId: number, collectionName: string) => {
    state.setActiveDatabaseId(dbId);
    state.setQueryText(`FIND ${collectionName}`);
  }, [state]);

  // ── Global keyboard shortcuts ──────────────────────────────────────────────
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      if (e.key === "t" || e.key === "T") { e.preventDefault(); state.addTab(); }
      if (e.key === "w" || e.key === "W") { e.preventDefault(); state.closeTab(state.activeTabId); }
      if (e.shiftKey && e.key === "E") { e.preventDefault(); state.setLeftPanelOpen(v => !v); }
      if (e.shiftKey && e.key === "H") { e.preventDefault(); state.setBottomPanelOpen(v => !v); }
      if (e.shiftKey && e.key === "A") { e.preventDefault(); state.setRightPanelOpen(v => !v); }
      if (e.shiftKey && e.key === "S") { e.preventDefault(); state.setSavedQueriesOpen(v => !v); }
      if (e.key === "k" || e.key === "K") { e.preventDefault(); state.setShortcutsOpen(true); }
      if (e.key === "Tab") {
        e.preventDefault();
        const idx = state.tabs.findIndex(t => t.id === state.activeTabId);
        const next = state.tabs[(idx + 1) % state.tabs.length];
        if (next) state.setActiveTabId(next.id);
      }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [state]);

  const activeEditorTab = state.activeEditorTab;

  return (
    <div className="flex flex-col h-screen w-full bg-background overflow-hidden selection:bg-primary/30" data-theme={state.theme}>

      {/* Shortcuts overlay */}
      <ShortcutsOverlay open={state.shortcutsOpen} onClose={() => state.setShortcutsOpen(false)} />

      {/* ── Top App Bar ─────────────────────────────────────────────────────── */}
      <header className="h-12 border-b border-panel-border bg-panel-bg flex items-center justify-between px-4 shrink-0 shadow-sm relative z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center shadow-lg shadow-primary/20">
            <LayoutTemplate className="w-4 h-4 text-white" />
          </div>
          <h1 className="font-bold tracking-tight text-foreground">
            UQL <span className="text-primary font-normal">Studio</span>
          </h1>

          {/* Connection indicator */}
          <div className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium border",
            connStatus === "online"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : connStatus === "offline"
              ? "bg-red-500/10 border-red-500/20 text-red-400"
              : "bg-yellow-500/10 border-yellow-500/20 text-yellow-400"
          )}>
            {connStatus === "online"
              ? <Wifi className="w-3 h-3" />
              : connStatus === "offline"
              ? <WifiOff className="w-3 h-3" />
              : <Zap className="w-3 h-3 animate-pulse" />
            }
            <span>
              {connStatus === "online"
                ? `${latency}ms`
                : connStatus === "offline"
                ? "Offline"
                : "…"
              }
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Theme toggle */}
          <button
            onClick={state.toggleTheme}
            title={state.theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            className="p-1.5 rounded-md transition-all text-muted-foreground hover:text-foreground hover:bg-foreground/10"
          >
            {state.theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <div className="flex bg-foreground/[0.06] border border-foreground/10 rounded-md p-1 gap-1 mr-4">
            <ToggleBtn
              icon={state.leftPanelOpen ? PanelLeftClose : PanelLeftOpen}
              active={state.leftPanelOpen}
              onClick={() => state.setLeftPanelOpen(!state.leftPanelOpen)}
              title="Toggle Explorer (Ctrl+Shift+E)"
            />
            <ToggleBtn
              icon={History}
              active={state.bottomPanelOpen}
              onClick={() => state.setBottomPanelOpen(!state.bottomPanelOpen)}
              title="Toggle History (Ctrl+Shift+H)"
            />
            <ToggleBtn
              icon={Bookmark}
              active={state.savedQueriesOpen}
              onClick={() => state.setSavedQueriesOpen(!state.savedQueriesOpen)}
              title="Toggle Saved Queries (Ctrl+Shift+S)"
            />
            <ToggleBtn
              icon={state.rightPanelOpen ? PanelRightClose : PanelRightOpen}
              active={state.rightPanelOpen}
              onClick={() => state.setRightPanelOpen(!state.rightPanelOpen)}
              title="Toggle AI Assistant (Ctrl+Shift+A)"
            />
          </div>
        </div>
      </header>

      {/* ── Transaction Banner ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {state.isInTransaction && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 36, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="shrink-0 overflow-hidden z-30"
          >
            <div className="h-[36px] bg-amber-500/15 border-b border-amber-500/25 flex items-center justify-between px-4">
              <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold">
                <AlertTriangle className="w-3.5 h-3.5 animate-pulse" />
                <span>Active Transaction — run COMMIT to save or ROLLBACK to undo all changes</span>
              </div>
              <button
                onClick={handleRollback}
                className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-medium border border-amber-500/25 transition-all"
              >
                <RotateCcw className="w-3 h-3" />
                ROLLBACK
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Multi-Tab Bar ────────────────────────────────────────────────────── */}
      <div className="flex items-end bg-panel-bg border-b border-panel-border px-2 pt-1 gap-0.5 shrink-0 z-10 overflow-x-auto scrollbar-thin">
        {state.tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => state.setActiveTabId(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs font-medium cursor-pointer transition-all shrink-0 max-w-[180px] group border-t border-l border-r",
              state.activeTabId === tab.id
                ? "bg-editor-bg text-foreground border-panel-border border-b-editor-bg -mb-px z-10 shadow-[0_-2px_8px_rgba(0,0,0,0.15)]"
                : "bg-panel-bg/50 text-muted-foreground hover:text-foreground border-transparent hover:border-foreground/[0.08]"
            )}
          >
            <span className="truncate flex-1">{tab.title}</span>
            <button
              onClick={(e) => { e.stopPropagation(); state.closeTab(tab.id); }}
              disabled={state.tabs.length <= 1}
              className={cn(
                "shrink-0 rounded p-0.5 transition-all disabled:opacity-0 disabled:pointer-events-none",
                state.activeTabId === tab.id
                  ? "text-muted-foreground hover:text-foreground hover:bg-foreground/10"
                  : "text-transparent group-hover:text-muted-foreground hover:text-foreground hover:bg-foreground/10"
              )}
            >
              <XIcon className="w-3 h-3" />
            </button>
          </div>
        ))}

        {/* New tab button */}
        <button
          onClick={() => state.addTab()}
          title="New tab (Ctrl+T)"
          className="flex items-center justify-center w-6 h-6 mb-1 ml-1 rounded text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-all shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── Main Workspace ───────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden relative">

        {/* Left Sidebar - Explorer */}
        <motion.div
          initial={false}
          animate={{ width: state.leftPanelOpen ? 280 : 0, opacity: state.leftPanelOpen ? 1 : 0 }}
          className="shrink-0 h-full overflow-hidden shadow-2xl relative z-10"
        >
          <div className="w-[280px] h-full">
            <SchemaExplorer
              activeDatabaseId={state.activeDatabaseId}
              onSelectDatabase={state.setActiveDatabaseId}
              onCollectionClick={handleCollectionClick}
            />
          </div>
        </motion.div>

        {/* Center Panel - Editor + Results */}
        <div className="flex-1 flex flex-col min-w-0 h-full relative z-0 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-[3] min-h-[200px]">
              <QueryEditor
                queryText={state.queryText}
                setQueryText={state.setQueryText}
                activeDatabaseId={state.activeDatabaseId}
                onSelectDatabase={state.setActiveDatabaseId}
                onExecutionComplete={handleExecutionComplete}
                theme={state.theme}
                onOpenShortcuts={() => state.setShortcutsOpen(true)}
                minimapOpen={state.minimapOpen}
                onToggleMinimap={state.toggleMinimap}
              />
            </div>

            <div className="flex-[2] min-h-[150px] shadow-[0_-10px_20px_rgba(0,0,0,0.2)] z-10">
              <ResultsView
                result={activeEditorTab?.result ?? null}
                activeTab={activeEditorTab?.activeResultTab ?? 'results'}
                setActiveTab={state.setActiveTab}
                timingHistory={state.timingHistory}
              />
            </div>
          </div>

          {/* Bottom History Panel */}
          <motion.div
            initial={false}
            animate={{ height: state.bottomPanelOpen ? 280 : 0 }}
            className="w-full shrink-0 overflow-hidden shadow-[0_-10px_30px_rgba(0,0,0,0.4)] z-20 absolute bottom-0 left-0 bg-panel-bg"
          >
            <div className="h-[280px] w-full">
              <QueryHistory onLoadQuery={(q) => state.setQueryText(q)} />
            </div>
          </motion.div>

          {/* Saved Queries Panel (overlays bottom) */}
          <AnimatePresence>
            {state.savedQueriesOpen && (
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: 300 }}
                exit={{ height: 0 }}
                className="w-full shrink-0 overflow-hidden shadow-[0_-10px_30px_rgba(0,0,0,0.4)] z-[25] absolute bottom-0 left-0 bg-panel-bg"
              >
                <div className="h-[300px] w-full">
                  <SavedQueries
                    queries={state.savedQueries}
                    onLoad={(q) => { state.setQueryText(q); state.setSavedQueriesOpen(false); }}
                    onDelete={state.deleteSavedQuery}
                    onSave={state.saveQuery}
                    currentQuery={state.queryText}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Sidebar - AI Assistant */}
        <motion.div
          initial={false}
          animate={{ width: state.rightPanelOpen ? 320 : 0, opacity: state.rightPanelOpen ? 1 : 0 }}
          className="shrink-0 h-full overflow-hidden shadow-[-20px_0_30px_rgba(0,0,0,0.3)] relative z-10"
        >
          <div className="w-[320px] h-full">
            <AIAssistant
              activeDatabaseId={state.activeDatabaseId}
              activeDatabaseName={activeDatabaseName}
              onInsertQuery={(q) => state.setQueryText(q)}
            />
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function ToggleBtn({ icon: Icon, active, onClick, title }: any) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "p-1.5 rounded transition-all",
        active
          ? "bg-foreground/10 text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground hover:bg-foreground/8"
      )}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
