import { useIdeState } from "@/hooks/use-ide-state";
import { SchemaExplorer } from "@/components/panels/schema-explorer";
import { QueryEditor, type QueryEditorHandle, type EditorStateUpdate } from "@/components/panels/query-editor";
import { ResultsView } from "@/components/panels/results-view";
import { AIAssistant, type AIAssistantHandle } from "@/components/panels/ai-assistant";
import { QueryHistory } from "@/components/panels/query-history";
import { SavedQueries } from "@/components/panels/saved-queries";
import { ShortcutsOverlay } from "@/components/panels/shortcuts-overlay";
import {
  History, LayoutTemplate, Plus, X as XIcon,
  Bookmark, WifiOff, Wifi, AlertTriangle, RotateCcw, Zap,
  PanelLeft, PanelRight, BrainCircuit,
  Play, Loader2, FolderOpen, Save, Undo2, Redo2,
  MessageSquare, Wand2, Copy, Check, Database, ChevronDown,
  Map, Keyboard, RefreshCw, Sparkles, LayoutList,
  Sun, Moon,
} from "lucide-react";
import { useTheme } from "@/lib/theme-context";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { getListDatabasesQueryKey, useListDatabases } from "@workspace/api-client-react";

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

// ── Toolbar icon button ────────────────────────────────────────────────────────
function TBtn({
  icon: Icon, onClick, title, disabled = false, active = false,
}: {
  icon: React.ElementType; onClick: () => void; title: string; disabled?: boolean; active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="w-[26px] h-[26px] flex items-center justify-center transition-all disabled:opacity-30 shrink-0"
      style={{
        borderRadius: 3,
        background: active ? 'var(--uql-input)' : 'transparent',
        border: `1px solid ${active ? 'var(--uql-b2)' : 'transparent'}`,
        color: active ? 'var(--uql-t1)' : 'var(--uql-t4)',
      }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = 'var(--uql-input)'; e.currentTarget.style.borderColor = 'var(--uql-b2)'; e.currentTarget.style.color = 'var(--uql-t1)'; } }}
      onMouseLeave={e => { e.currentTarget.style.background = active ? 'var(--uql-input)' : 'transparent'; e.currentTarget.style.borderColor = active ? 'var(--uql-b2)' : 'transparent'; e.currentTarget.style.color = active ? 'var(--uql-t1)' : 'var(--uql-t4)'; }}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

function Sep() {
  return <div className="h-4 w-px mx-1 shrink-0" style={{ background: 'var(--uql-b2)' }} />;
}

function TitleBtn({ icon: Icon, active, onClick, title }: any) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-6 h-6 flex items-center justify-center transition-colors"
      style={{
        borderRadius: 3,
        background: active ? 'var(--uql-input)' : 'transparent',
        color: active ? 'var(--uql-t3)' : 'var(--uql-t5)',
        border: `1px solid ${active ? 'var(--uql-b2)' : 'transparent'}`,
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--uql-t1)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--uql-t5)'; }}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

// ── DB Selector ────────────────────────────────────────────────────────────────
function DbSelector({ activeDatabaseId, onSelectDatabase }: {
  activeDatabaseId: number | null;
  onSelectDatabase: (id: number | null) => void;
}) {
  const { data: databases } = useListDatabases();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const activeDb = Array.isArray(databases)
    ? databases.find(d => d.id === activeDatabaseId) ?? null
    : null;

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] border transition-colors min-w-[120px] max-w-[180px]"
        style={{
          background: 'var(--uql-input)',
          borderColor: 'var(--uql-b2)',
          color: activeDb ? 'var(--uql-t3)' : 'var(--uql-t5)',
          borderRadius: 3,
          fontFamily: "'IBM Plex Mono', monospace",
          height: 26,
        }}
      >
        <Database className="w-3 h-3 shrink-0" style={{ color: 'var(--uql-t7)' }} />
        <span className="flex-1 text-left truncate">{activeDb ? activeDb.name : "no database"}</span>
        <ChevronDown className={cn("w-3 h-3 shrink-0 transition-transform", open && "rotate-180")} style={{ color: 'var(--uql-t7)' }} />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-0.5 z-50 border min-w-[180px] max-w-[280px] overflow-hidden"
          style={{ background: 'var(--uql-header)', borderColor: 'var(--uql-b1)', borderRadius: 3 }}
        >
          <button
            onClick={() => { onSelectDatabase(null); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left transition-colors"
            style={{
              color: !activeDb ? 'var(--uql-t2)' : 'var(--uql-t5)',
              background: !activeDb ? 'var(--uql-row-b)' : 'transparent',
              fontFamily: "'IBM Plex Mono', monospace",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--uql-input)')}
            onMouseLeave={e => (e.currentTarget.style.background = !activeDb ? 'var(--uql-row-b)' : 'transparent')}
          >
            <span className="w-3 flex items-center justify-center shrink-0">
              {!activeDb && <Check className="w-2.5 h-2.5" />}
            </span>
            <span className="italic" style={{ color: 'var(--uql-t8)' }}>none</span>
          </button>
          {Array.isArray(databases) && databases.length > 0 && (
            <div className="border-t" style={{ borderColor: 'var(--uql-b3)' }}>
              {databases.map(db => (
                <button
                  key={db.id}
                  onClick={() => { onSelectDatabase(db.id); setOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left transition-colors"
                  style={{
                    color: db.id === activeDatabaseId ? 'var(--uql-t2)' : 'var(--uql-t5)',
                    background: db.id === activeDatabaseId ? 'var(--uql-row-b)' : 'transparent',
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--uql-input)')}
                  onMouseLeave={e => (e.currentTarget.style.background = db.id === activeDatabaseId ? 'var(--uql-row-b)' : 'transparent')}
                >
                  <span className="w-3 flex items-center justify-center shrink-0">
                    {db.id === activeDatabaseId && <Check className="w-2.5 h-2.5" />}
                  </span>
                  <Database className="w-3 h-3 shrink-0" style={{ color: 'var(--uql-t7)' }} />
                  <span className="flex-1 truncate">{db.name}</span>
                </button>
              ))}
            </div>
          )}
          {(!databases || (Array.isArray(databases) && databases.length === 0)) && (
            <div className="px-3 py-2 text-[11px] italic" style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--uql-t7)' }}>
              no databases
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Studio() {
  const { isDark, toggle: toggleTheme } = useTheme();
  const state = useIdeState();
  const queryClient = useQueryClient();
  const { data: databases = [], refetch: refetchDatabases } = useListDatabases();
  const [isCreateDbOpen, setIsCreateDbOpen] = useState(false);
  const { status: connStatus, latency } = useConnectionStatus();

  // ── AI assistant ref + panel state ────────────────────────────────────────
  const aiRef = useRef<AIAssistantHandle>(null);
  const [aiPanelState, setAiPanelState] = useState({ conversationCount: 0, showSessions: false });

  // ── Editor ref + reactive toolbar state ───────────────────────────────────
  const editorRef = useRef<QueryEditorHandle>(null);
  const [editorState, setEditorState] = useState<EditorStateUpdate>({
    isPending: false,
    canUndo: false,
    canRedo: false,
    copyFlash: false,
  });

  const activeDatabaseName =
    Array.isArray(databases)
      ? databases.find((d) => d.id === state.activeDatabaseId)?.name ?? null
      : null;

  const handleExecutionComplete = useCallback((result: any, rawQuery: string) => {
    state.setActiveTabResult(result);
    state.recordTiming(result.executionTimeMs ?? 0, result.success ?? false);
    if (!result.success) return;
    if (result.graphData?.nodes?.length > 0 || result.graphData?.edges?.length > 0) {
      state.setActiveTab('graph');
    }
    const upper = rawQuery.trim().toUpperCase().replace(/\s+/g, ' ');
    const firstWord = upper.split(/\s/)[0];
    if (firstWord === 'BEGIN') state.setIsInTransaction(true);
    if (firstWord === 'COMMIT' || firstWord === 'ROLLBACK') state.setIsInTransaction(false);
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

  const handleRollback = useCallback(async () => {
    try {
      const r = await fetch('/api/query', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'ROLLBACK' }),
      });
      const data = await r.json();
      state.setIsInTransaction(false);
      state.setActiveTabResult(data);
    } catch {}
  }, [state]);

  const handleCollectionClick = useCallback((dbId: number, collectionName: string) => {
    state.setActiveDatabaseId(dbId);
    state.setQueryText(`FIND ${collectionName}`);
  }, [state]);

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
  const hasResult = activeEditorTab?.result != null;

  // ── Panel resize state ─────────────────────────────────────────────────────
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(300);
  const [resultsHeight, setResultsHeight] = useState(220);
  const [isDragging, setIsDragging] = useState(false);

  const startLeftDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const startX = e.clientX;
    const startW = leftWidth;
    const onMove = (ev: MouseEvent) => {
      setLeftWidth(Math.max(160, Math.min(480, startW + ev.clientX - startX)));
    };
    const onUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [leftWidth]);

  const startRightDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const startX = e.clientX;
    const startW = rightWidth;
    const onMove = (ev: MouseEvent) => {
      setRightWidth(Math.max(200, Math.min(600, startW - (ev.clientX - startX))));
    };
    const onUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [rightWidth]);

  const startResultsDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const startY = e.clientY;
    const startH = resultsHeight;
    const onMove = (ev: MouseEvent) => {
      setResultsHeight(Math.max(80, Math.min(600, startH + (startY - ev.clientY))));
    };
    const onUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [resultsHeight]);

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden" style={{ fontFamily: "'IBM Plex Sans', sans-serif", background: 'var(--uql-panel)' }}>
      <ShortcutsOverlay open={state.shortcutsOpen} onClose={() => state.setShortcutsOpen(false)} />

      {/* ── Title Bar ── */}
      <div className="h-8 flex items-center px-3 gap-4 shrink-0 select-none border-b" style={{ background: 'var(--uql-header)', borderColor: 'var(--uql-b1)' }}>
        <div className="flex items-center gap-2 pr-4 border-r" style={{ borderColor: 'var(--uql-b2)' }}>
          <LayoutTemplate className="w-3.5 h-3.5" style={{ color: 'var(--uql-t1)' }} />
          <span className="text-[11px] font-bold tracking-[0.1em] uppercase" style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--uql-t1)' }}>
            UQL Studio
          </span>
        </div>

        <div className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--uql-t5)', fontFamily: "'IBM Plex Mono', monospace" }}>
          {connStatus === "online"
            ? <Wifi className="w-3 h-3" style={{ color: 'var(--uql-t5)' }} />
            : connStatus === "offline"
            ? <WifiOff className="w-3 h-3" style={{ color: 'var(--uql-t8)' }} />
            : <Zap className="w-3 h-3 animate-pulse" style={{ color: 'var(--uql-t8)' }} />
          }
          <span>
            {connStatus === "online" ? `${latency}ms` : connStatus === "offline" ? "offline" : "…"}
          </span>
        </div>

        <div className="flex-1" />

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          className="w-6 h-6 flex items-center justify-center transition-colors mr-1"
          style={{ color: 'var(--uql-t5)', borderRadius: 3 }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--uql-t1)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--uql-t5)')}
        >
          {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        </button>

        <div className="flex items-center gap-1">
          <TitleBtn
            icon={History}
            active={state.bottomPanelOpen}
            onClick={() => state.setBottomPanelOpen(v => !v)}
            title="Toggle History (Ctrl+Shift+H)"
          />
          <TitleBtn
            icon={Bookmark}
            active={state.savedQueriesOpen}
            onClick={() => state.setSavedQueriesOpen(v => !v)}
            title="Toggle Saved Queries (Ctrl+Shift+S)"
          />
          <div className="h-4 w-px mx-0.5" style={{ background: 'var(--uql-b2)' }} />
          <TitleBtn
            icon={PanelLeft}
            active={state.leftPanelOpen}
            onClick={() => state.setLeftPanelOpen(v => !v)}
            title="Toggle Explorer (Ctrl+Shift+E)"
          />
          <TitleBtn
            icon={BrainCircuit}
            active={state.rightPanelOpen}
            onClick={() => state.setRightPanelOpen(v => !v)}
            title="Toggle AI Assistant (Ctrl+Shift+A)"
          />
        </div>
      </div>

      {/* ── Transaction Banner ── */}
      <AnimatePresence>
        {state.isInTransaction && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 28, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="shrink-0 overflow-hidden z-30"
          >
            <div className="h-[28px] bg-[#1a1400] border-b border-[#3a2e00] flex items-center justify-between px-4">
              <div className="flex items-center gap-2 text-[#b8960a] text-[11px] font-medium" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                <AlertTriangle className="w-3 h-3" />
                <span>ACTIVE TRANSACTION — run COMMIT to save or ROLLBACK to discard</span>
              </div>
              <button
                onClick={handleRollback}
                className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-[#b8960a] border border-[#3a2e00] hover:bg-[#2a2200] transition-colors rounded-sm"
                style={{ fontFamily: "'IBM Plex Mono', monospace" }}
              >
                <RotateCcw className="w-3 h-3" />
                ROLLBACK
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Toolbar Row ── */}
      <div
        className="flex items-center gap-0.5 px-2 shrink-0 border-b"
        style={{ background: 'var(--uql-toolbar)', borderColor: 'var(--uql-b1)', height: 36 }}
      >
        {/* Execute */}
        <button
          onClick={() => editorRef.current?.execute()}
          disabled={editorState.isPending}
          className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold disabled:opacity-40 transition-colors shrink-0 mr-1"
          style={{
            background: 'var(--uql-exec-bg)',
            color: 'var(--uql-exec-text)',
            borderRadius: 3,
            fontFamily: "'IBM Plex Mono', monospace",
            height: 26,
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--uql-exec-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--uql-exec-bg)')}
        >
          {editorState.isPending
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Play className="w-3.5 h-3.5 fill-current" />
          }
          Execute
        </button>

        <Sep />

        {/* New tab */}
        <TBtn
          icon={Plus}
          onClick={() => state.addTab()}
          title="New tab (Ctrl+T)"
        />

        {/* Open file */}
        <TBtn
          icon={FolderOpen}
          onClick={() => editorRef.current?.open()}
          title="Open file (Ctrl+O)"
        />

        {/* Save file */}
        <TBtn
          icon={Save}
          onClick={() => editorRef.current?.save()}
          title="Save file (Ctrl+S)"
        />

        <Sep />

        {/* Undo */}
        <TBtn
          icon={Undo2}
          onClick={() => editorRef.current?.undo()}
          title="Undo (Ctrl+Z)"
          disabled={!editorState.canUndo}
        />

        {/* Redo */}
        <TBtn
          icon={Redo2}
          onClick={() => editorRef.current?.redo()}
          title="Redo (Ctrl+Y)"
          disabled={!editorState.canRedo}
        />

        <Sep />

        {/* Comment */}
        <TBtn
          icon={MessageSquare}
          onClick={() => editorRef.current?.comment()}
          title="Toggle comment (Ctrl+/)"
        />

        {/* Format */}
        <TBtn
          icon={Wand2}
          onClick={() => editorRef.current?.format()}
          title="Format query"
        />

        {/* Copy */}
        <TBtn
          icon={Copy}
          onClick={() => editorRef.current?.copy()}
          title="Copy to clipboard"
          active={editorState.copyFlash}
        />

        <Sep />

        {/* DB Selector */}
        <DbSelector
          activeDatabaseId={state.activeDatabaseId}
          onSelectDatabase={state.setActiveDatabaseId}
        />

        <Sep />

        {/* Minimap */}
        <TBtn
          icon={Map}
          onClick={() => state.toggleMinimap()}
          title="Toggle minimap (Ctrl+Shift+M)"
          active={state.minimapOpen}
        />

        {/* Shortcuts */}
        <TBtn
          icon={Keyboard}
          onClick={() => state.setShortcutsOpen(true)}
          title="Keyboard shortcuts (Ctrl+K)"
        />

        <span
          className="ml-auto text-[10px] shrink-0 hidden sm:block"
          style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--uql-t8)' }}
        >
          Ctrl+Enter to run
        </span>
      </div>

      {/* ── Combined OBJECT EXPLORER header + File Tabs Strip ── */}
      <div
        className="flex items-stretch border-b shrink-0 overflow-hidden"
        style={{ background: 'var(--uql-header)', borderColor: 'var(--uql-b1)', minHeight: 32 }}
      >
        {/* Left portion — mirrors sidebar width, shows OBJECT EXPLORER header */}
        <div
          className="shrink-0 overflow-hidden flex items-center border-r"
          style={{
            borderColor: 'var(--uql-b1)',
            background: 'var(--uql-header)',
            width: state.leftPanelOpen ? leftWidth : 0,
            transition: isDragging ? 'none' : 'width 0.15s ease',
          }}
        >
          <div
            style={{ width: leftWidth, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', flexShrink: 0 }}
          >
            <span
              className="flex items-center gap-1.5 truncate"
              style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--uql-t3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}
            >
              <Database className="w-3 h-3 shrink-0" />
              Object Explorer
            </span>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={() => refetchDatabases()}
                title="Refresh"
                className="w-5 h-5 flex items-center justify-center rounded transition-colors"
                style={{ color: 'var(--uql-t7)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--uql-t1)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--uql-t7)')}
              >
                <RefreshCw className="w-3 h-3" />
              </button>
              <button
                onClick={() => setIsCreateDbOpen(true)}
                title="New Database"
                className="w-5 h-5 flex items-center justify-center rounded transition-colors"
                style={{ color: 'var(--uql-t7)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--uql-t1)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--uql-t7)')}
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {/* Center portion — file tabs (flexible) */}
        <div className="flex items-end flex-1 overflow-x-auto min-w-0">
          {state.tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => state.setActiveTabId(tab.id)}
              className="flex items-center gap-1.5 px-3 cursor-pointer transition-all shrink-0 select-none group border-r"
              style={{
                height: 32,
                fontSize: 11,
                fontFamily: "'IBM Plex Mono', monospace",
                borderColor: 'var(--uql-b1)',
                borderTop: `2px solid ${state.activeTabId === tab.id ? 'var(--uql-t1)' : 'transparent'}`,
                background: state.activeTabId === tab.id ? 'var(--uql-tab-active)' : 'var(--uql-tab-inactive)',
                color: state.activeTabId === tab.id ? 'var(--uql-t1)' : 'var(--uql-t7)',
              }}
              onMouseEnter={e => { if (state.activeTabId !== tab.id) e.currentTarget.style.color = 'var(--uql-t3)'; }}
              onMouseLeave={e => { if (state.activeTabId !== tab.id) e.currentTarget.style.color = 'var(--uql-t7)'; }}
            >
              <span className="truncate max-w-[140px]">{tab.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); state.closeTab(tab.id); }}
                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-all ml-0.5"
                style={{ color: 'var(--uql-t4)' }}
                title="Close tab"
              >
                <XIcon className="w-3 h-3" />
              </button>
            </div>
          ))}

          {/* ── Add new query tab ── */}
          <button
            onClick={() => state.addTab()}
            title="New query tab (Ctrl+T)"
            className="flex items-center justify-center w-8 h-8 transition-colors shrink-0"
            style={{ color: 'var(--uql-t7)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--uql-t1)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--uql-t7)')}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right portion — AI assistant panel header */}
        <div
          className="shrink-0 overflow-hidden flex items-center border-l"
          style={{
            borderColor: 'var(--uql-b1)',
            background: 'var(--uql-header)',
            width: state.rightPanelOpen ? rightWidth : 0,
            transition: isDragging ? 'none' : 'width 0.15s ease',
          }}
        >
          <div style={{ width: rightWidth, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', flexShrink: 0 }}>
            <span
              className="flex items-center gap-1.5 truncate"
              style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--uql-t5)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}
            >
              <Sparkles className="w-3 h-3 shrink-0" />
              UQL Copilot
              <span
                className="px-1 ml-0.5"
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: 'var(--uql-t8)', background: 'var(--uql-panel)', border: '1px solid var(--uql-b3)', borderRadius: 2 }}
              >
                AI
              </span>
            </span>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={() => aiRef.current?.toggleSessions()}
                title="Sessions"
                className="relative w-5 h-5 flex items-center justify-center rounded transition-colors"
                style={{ color: aiPanelState.showSessions ? 'var(--uql-t1)' : 'var(--uql-t7)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--uql-t1)')}
                onMouseLeave={e => (e.currentTarget.style.color = aiPanelState.showSessions ? 'var(--uql-t1)' : 'var(--uql-t7)')}
              >
                <LayoutList className="w-3 h-3" />
                {aiPanelState.conversationCount > 0 && (
                  <span
                    className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full flex items-center justify-center"
                    style={{ background: 'var(--uql-b2)', fontSize: 8, color: 'var(--uql-t4)', fontFamily: "'IBM Plex Mono', monospace" }}
                  >
                    {aiPanelState.conversationCount > 9 ? "9+" : aiPanelState.conversationCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => aiRef.current?.newChat()}
                title="New Chat"
                className="w-5 h-5 flex items-center justify-center rounded transition-colors"
                style={{ color: 'var(--uql-t7)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--uql-t1)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--uql-t7)')}
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Workspace ── */}
      <div className="flex flex-1 overflow-hidden relative" style={{ userSelect: isDragging ? 'none' : 'auto' }}>

        {/* Left Sidebar */}
        <div
          className="shrink-0 h-full overflow-hidden"
          style={{
            width: state.leftPanelOpen ? leftWidth : 0,
            opacity: state.leftPanelOpen ? 1 : 0,
            transition: isDragging ? 'opacity 0.15s' : 'width 0.15s ease, opacity 0.15s',
            flexShrink: 0,
          }}
        >
          <div style={{ width: leftWidth, height: '100%' }}>
            <SchemaExplorer
              activeDatabaseId={state.activeDatabaseId}
              onSelectDatabase={state.setActiveDatabaseId}
              onCollectionClick={handleCollectionClick}
              isCreateOpen={isCreateDbOpen}
              onCloseCreate={() => setIsCreateDbOpen(false)}
            />
          </div>
        </div>

        {/* Left drag divider */}
        {state.leftPanelOpen && (
          <div
            style={{ width: 4, cursor: 'col-resize', flexShrink: 0, zIndex: 10, background: 'transparent', transition: 'background 0.1s' }}
            onMouseDown={startLeftDrag}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--uql-drag-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          />
        )}

        {/* Center Panel */}
        <div className="flex-1 flex flex-col min-w-0 h-full relative z-0">
          <div className="flex-1 flex flex-col min-h-0">
            <div style={{ flex: 1, minHeight: 150 }}>
              <QueryEditor
                ref={editorRef}
                queryText={state.queryText}
                setQueryText={state.setQueryText}
                activeDatabaseId={state.activeDatabaseId}
                onSelectDatabase={state.setActiveDatabaseId}
                onExecutionComplete={handleExecutionComplete}
                theme={isDark ? 'dark' : 'light'}
                onOpenShortcuts={() => state.setShortcutsOpen(true)}
                minimapOpen={state.minimapOpen}
                onToggleMinimap={state.toggleMinimap}
                onStateChange={setEditorState}
              />
            </div>
            {hasResult && (
              <>
                <div
                  style={{ height: 4, cursor: 'row-resize', flexShrink: 0, background: 'var(--uql-b1)', transition: 'background 0.1s' }}
                  onMouseDown={startResultsDrag}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--uql-drag-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'var(--uql-b1)')}
                />
                <div style={{ height: resultsHeight, flexShrink: 0, overflow: 'hidden' }}>
                  <ResultsView
                    result={activeEditorTab?.result ?? null}
                    activeTab={activeEditorTab?.activeResultTab ?? 'results'}
                    setActiveTab={state.setActiveTab}
                    timingHistory={state.timingHistory}
                  />
                </div>
              </>
            )}
          </div>

          {/* Bottom History Panel */}
          <motion.div
            initial={false}
            animate={{ height: state.bottomPanelOpen ? 260 : 0 }}
            transition={{ duration: 0.15 }}
            className="w-full shrink-0 overflow-hidden z-20 absolute bottom-0 left-0 border-t"
            style={{ background: 'var(--uql-panel)', borderColor: 'var(--uql-b1)' }}
          >
            <div className="h-[260px] w-full">
              <QueryHistory onLoadQuery={(q) => state.setQueryText(q)} />
            </div>
          </motion.div>

          {/* Saved Queries Panel */}
          <AnimatePresence>
            {state.savedQueriesOpen && (
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: 280 }}
                exit={{ height: 0 }}
                transition={{ duration: 0.15 }}
                className="w-full shrink-0 overflow-hidden z-[25] absolute bottom-0 left-0 border-t"
                style={{ background: 'var(--uql-panel)', borderColor: 'var(--uql-b1)' }}
              >
                <div className="h-[280px] w-full">
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

        {/* Right drag divider */}
        {state.rightPanelOpen && (
          <div
            style={{ width: 4, cursor: 'col-resize', flexShrink: 0, zIndex: 10, background: 'transparent', transition: 'background 0.1s' }}
            onMouseDown={startRightDrag}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--uql-drag-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          />
        )}

        {/* Right Sidebar - AI Assistant */}
        <div
          className="shrink-0 h-full overflow-hidden border-l"
          style={{
            borderColor: 'var(--uql-b1)',
            width: state.rightPanelOpen ? rightWidth : 0,
            opacity: state.rightPanelOpen ? 1 : 0,
            transition: isDragging ? 'opacity 0.15s' : 'width 0.15s ease, opacity 0.15s',
            flexShrink: 0,
          }}
        >
          <div style={{ width: rightWidth, height: '100%' }}>
            <AIAssistant
              ref={aiRef}
              activeDatabaseId={state.activeDatabaseId}
              activeDatabaseName={activeDatabaseName}
              onInsertQuery={(q) => state.setQueryText(q)}
              lastResult={state.activeEditorTab?.result ?? null}
              lastQuery={state.activeEditorTab?.query ?? null}
              hideHeader={true}
              onStateChange={setAiPanelState}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
