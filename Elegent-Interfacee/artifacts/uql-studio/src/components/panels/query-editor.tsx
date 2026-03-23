import { useExecuteQuery, useListDatabases } from "@workspace/api-client-react";
import {
  Play, Eraser, Loader2, Database, ChevronDown, Check,
  Undo2, Redo2, MessageSquare, FolderOpen, Save, Copy, Wand2,
  Keyboard, Map,
} from "lucide-react";
import Editor from "react-simple-code-editor";
import { highlightUQL, type Theme } from "@/lib/utils";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";

interface QueryEditorProps {
  queryText: string;
  setQueryText: (v: string) => void;
  activeDatabaseId: number | null;
  onSelectDatabase: (id: number | null) => void;
  onExecutionComplete: (result: unknown, query: string) => void;
  theme?: Theme;
  onOpenShortcuts?: () => void;
  minimapOpen?: boolean;
  onToggleMinimap?: () => void;
  errorHighlight?: { line: number; col?: number } | null;
}

const UQL_KEYWORDS = [
  'FIND','ADD','MODIFY','REMOVE','WHERE','SET','VALUES','FROM','TO','PATH','AS',
  'AND','OR','NOT','LIMIT','ORDER','BY','DESC','ASC','CREATE','DROP','GRAPH',
  'DOC','DOCUMENT','TABLE','DB','DATABASE','IN',
];

// ─── Toolbar icon button ───────────────────────────────────────────────────────
function TBtn({
  icon: Icon, onClick, title, disabled = false, active = false,
}: {
  icon: React.ElementType;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cn(
        "p-1.5 rounded transition-all disabled:opacity-40",
        active
          ? "bg-primary/20 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-foreground/10"
      )}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

function Sep() {
  return <div className="h-5 w-px bg-foreground/10 mx-0.5 shrink-0" />;
}

// ─── Custom undo/redo stack ────────────────────────────────────────────────────
function useUndoRedo(value: string, onChange: (v: string) => void) {
  const stack = useRef<string[]>([value]);
  const idx = useRef<number>(0);
  const skipPush = useRef(false);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (skipPush.current) { skipPush.current = false; return; }
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      if (value !== stack.current[idx.current]) {
        stack.current = stack.current.slice(0, idx.current + 1);
        stack.current.push(value);
        idx.current = stack.current.length - 1;
      }
    }, 600);
    return () => { if (pushTimer.current) clearTimeout(pushTimer.current); };
  }, [value]);

  const undo = useCallback(() => {
    if (idx.current > 0) {
      idx.current--;
      skipPush.current = true;
      onChange(stack.current[idx.current]);
    }
  }, [onChange]);

  const redo = useCallback(() => {
    if (idx.current < stack.current.length - 1) {
      idx.current++;
      skipPush.current = true;
      onChange(stack.current[idx.current]);
    }
  }, [onChange]);

  const canUndo = () => idx.current > 0;
  const canRedo = () => idx.current < stack.current.length - 1;

  return { undo, redo, canUndo, canRedo };
}

// ─── Parse error line number from error message ────────────────────────────────
function parseErrorLine(errorMsg: string, query: string): number | null {
  // Look for "line N" or "at line N" patterns
  const m = errorMsg.match(/line\s+(\d+)/i) ?? errorMsg.match(/row\s+(\d+)/i);
  if (m) return parseInt(m[1], 10) - 1;

  // Try to find the bad token in the query
  const tokenMatch = errorMsg.match(/got '([^']+)'/);
  if (tokenMatch) {
    const token = tokenMatch[1];
    const lines = query.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(token)) return i;
    }
  }
  return null;
}

// ─── Highlight with error underline ───────────────────────────────────────────
function highlightWithError(code: string, theme: Theme, errorLine: number | null): string {
  const lines = highlightUQL(code, theme).split('\n');
  return lines.map((line, i) => {
    if (i === errorLine) {
      return `<span style="background:rgba(239,68,68,0.12);text-decoration:underline wavy rgba(239,68,68,0.7);text-underline-offset:3px;display:block;">${line}</span>`;
    }
    return line;
  }).join('\n');
}

// ─── Minimap ──────────────────────────────────────────────────────────────────
function Minimap({ code, theme, errorLine }: { code: string; theme: Theme; errorLine: number | null }) {
  const lines = code.split('\n');
  const isDark = theme === 'dark';
  return (
    <div className={cn(
      "w-[120px] shrink-0 h-full overflow-hidden border-l select-none",
      isDark ? "border-white/5 bg-black/20" : "border-black/5 bg-black/[0.02]"
    )}>
      <div
        className="px-1 py-1 origin-top-left"
        style={{ transform: 'scale(0.25)', width: '480px', transformOrigin: '0 0' }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              "leading-[1.6] whitespace-pre font-mono text-[14px] truncate",
              i === errorLine && "bg-red-500/20"
            )}
            style={{
              color: isDark ? 'rgba(148,163,184,0.5)' : 'rgba(51,65,85,0.4)',
            }}
          >
            {line || ' '}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export function QueryEditor({
  queryText,
  setQueryText,
  activeDatabaseId,
  onSelectDatabase,
  onExecutionComplete,
  theme = 'dark',
  onOpenShortcuts,
  minimapOpen = false,
  onToggleMinimap,
  errorHighlight,
}: QueryEditorProps) {
  const executeMutation = useExecuteQuery();
  const { data: databases } = useListDatabases();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [copyFlash, setCopyFlash] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lastErrorLine, setLastErrorLine] = useState<number | null>(null);

  const { undo, redo, canUndo, canRedo } = useUndoRedo(queryText, setQueryText);

  const activeDb = Array.isArray(databases)
    ? databases.find(d => d.id === activeDatabaseId) ?? null
    : null;

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Recompute error line when errorHighlight changes
  useEffect(() => {
    setLastErrorLine(errorHighlight?.line ?? null);
  }, [errorHighlight]);

  // ── Run ───────────────────────────────────────────────────────────────────
  const handleRun = useCallback(() => {
    if (!queryText.trim()) return;
    setLastErrorLine(null);
    executeMutation.mutate(
      { data: { query: queryText, databaseId: activeDatabaseId || undefined } },
      {
        onSuccess: (data: any) => {
          if (!data.success && data.error) {
            const line = parseErrorLine(data.error, queryText);
            setLastErrorLine(line);
          }
          onExecutionComplete(data, queryText);
        },
        onError: (err: unknown) => {
          onExecutionComplete(
            {
              success: false,
              error: err instanceof Error ? err.message : "Failed to execute query",
              executionTimeMs: 0,
            },
            queryText
          );
        },
      }
    );
  }, [queryText, activeDatabaseId, executeMutation, onExecutionComplete]);

  // ── Key bindings ──────────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === "Enter") { e.preventDefault(); handleRun(); }
    if (ctrl && e.key === "/")     { e.preventDefault(); handleComment(); }
    if (ctrl && !e.shiftKey && e.key === "z") { e.preventDefault(); undo(); }
    if (ctrl && (e.key === "y" || (e.shiftKey && e.key === "z"))) { e.preventDefault(); redo(); }
    if (ctrl && e.key === "s")     { e.preventDefault(); handleSave(); }
    if (ctrl && e.key === "o")     { e.preventDefault(); handleOpen(); }
    if (ctrl && e.key === "k")     { e.preventDefault(); onOpenShortcuts?.(); }
    if (ctrl && e.shiftKey && e.key === "M") { e.preventDefault(); onToggleMinimap?.(); }
  }, [handleRun, undo, redo, onOpenShortcuts, onToggleMinimap]);

  // ── Comment / Uncomment ───────────────────────────────────────────────────
  const handleComment = () => {
    const ta = containerRef.current?.querySelector("textarea");
    if (!ta) { toggleCommentAll(); return; }
    const { selectionStart, selectionEnd, value } = ta;
    const lines = value.split("\n");
    let charCount = 0, firstLine = -1, lastLine = -1;
    for (let i = 0; i < lines.length; i++) {
      const lineStart = charCount;
      const lineEnd = charCount + lines[i].length;
      if (firstLine === -1 && lineEnd >= selectionStart) firstLine = i;
      if (lineStart <= selectionEnd) lastLine = i;
      charCount += lines[i].length + 1;
    }
    if (firstLine === -1) { firstLine = 0; lastLine = lines.length - 1; }
    const selectedLines = lines.slice(firstLine, lastLine + 1);
    const allCommented = selectedLines.every(l => l.trimStart().startsWith("--"));
    const newLines = [...lines];
    for (let i = firstLine; i <= lastLine; i++) {
      newLines[i] = allCommented ? newLines[i].replace(/^(\s*)--\s?/, "$1") : "-- " + newLines[i];
    }
    setQueryText(newLines.join("\n"));
  };

  const toggleCommentAll = () => {
    const lines = queryText.split("\n");
    const allCommented = lines.every(l => l.trim() === "" || l.trimStart().startsWith("--"));
    setQueryText(allCommented
      ? lines.map(l => l.replace(/^(\s*)--\s?/, "$1")).join("\n")
      : lines.map(l => "-- " + l).join("\n")
    );
  };

  // ── Format ────────────────────────────────────────────────────────────────
  const handleFormat = () => {
    const lines = queryText.split("\n").map(line => {
      const trimmed = line.trimEnd();
      if (trimmed.trimStart().startsWith("--")) return trimmed;
      const words = trimmed.split(/\b/);
      return words.map(w => UQL_KEYWORDS.includes(w.toUpperCase()) ? w.toUpperCase() : w).join("");
    });
    const cleaned: string[] = [];
    let blankCount = 0;
    for (const line of lines) {
      if (line.trim() === "") {
        blankCount++;
        if (blankCount <= 1) cleaned.push(line);
      } else { blankCount = 0; cleaned.push(line); }
    }
    setQueryText(cleaned.join("\n"));
  };

  // ── Copy ──────────────────────────────────────────────────────────────────
  const handleCopy = () => {
    navigator.clipboard.writeText(queryText).then(() => {
      setCopyFlash(true);
      setTimeout(() => setCopyFlash(false), 1200);
    });
  };

  // ── Save / Open ───────────────────────────────────────────────────────────
  const handleSave = () => {
    const blob = new Blob([queryText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "query.uql"; a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpen = () => fileInputRef.current?.click();
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setQueryText(String(ev.target?.result ?? ""));
    reader.readAsText(file);
    e.target.value = "";
  };

  // Highlight function with error underline
  const highlightFn = useMemo(
    () => (code: string) => highlightWithError(code, theme, lastErrorLine),
    [theme, lastErrorLine]
  );

  return (
    <div className="flex flex-col h-full bg-editor-bg relative" onKeyDown={handleKeyDown}>
      <input ref={fileInputRef} type="file" accept=".uql,.sql,.txt" className="hidden" onChange={handleFileChange} />

      {/* Editor Toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 bg-panel-bg border-b border-panel-border z-10 flex-wrap shrink-0">
        {/* Run */}
        <button
          onClick={handleRun}
          disabled={!queryText.trim() || executeMutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-emerald-500 to-emerald-400 hover:from-emerald-400 hover:to-emerald-300 text-emerald-950 font-semibold text-sm rounded-md shadow-lg shadow-emerald-500/20 disabled:opacity-50 transition-all shrink-0"
        >
          {executeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
          Run Query
        </button>

        <button
          onClick={() => setQueryText("")}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-muted-foreground hover:text-foreground hover:bg-foreground/10 rounded-md text-sm transition-all shrink-0"
        >
          <Eraser className="w-4 h-4" />
          Clear
        </button>

        <Sep />

        {/* Database selector */}
        <div className="relative shrink-0" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(o => !o)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm transition-all min-w-[160px] max-w-[240px]",
              activeDb
                ? "bg-primary/10 border-primary/30 text-foreground hover:bg-primary/15"
                : "bg-foreground/5 border-foreground/10 text-muted-foreground hover:border-foreground/20 hover:text-foreground"
            )}
          >
            <Database className={cn("w-3.5 h-3.5 shrink-0", activeDb ? "text-cyan-500" : "text-muted-foreground/50")} />
            <span className="flex-1 text-left truncate font-medium">
              {activeDb ? activeDb.name : "Select database…"}
            </span>
            <ChevronDown className={cn("w-3.5 h-3.5 shrink-0 transition-transform", dropdownOpen && "rotate-180")} />
          </button>

          {dropdownOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-2xl shadow-black/30 min-w-[200px] max-w-[300px] overflow-hidden">
              <button
                onClick={() => { onSelectDatabase(null); setDropdownOpen(false); }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left",
                  !activeDb ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                )}
              >
                <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                  {!activeDb && <Check className="w-3 h-3" />}
                </span>
                <span className="italic">No database selected</span>
              </button>
              {databases && databases.length > 0 && (
                <div className="border-t border-border">
                  {databases.map(db => (
                    <button
                      key={db.id}
                      onClick={() => { onSelectDatabase(db.id); setDropdownOpen(false); }}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left",
                        db.id === activeDatabaseId ? "bg-primary/10 text-primary" : "text-foreground hover:bg-foreground/5"
                      )}
                    >
                      <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                        {db.id === activeDatabaseId && <Check className="w-3 h-3" />}
                      </span>
                      <Database className="w-3.5 h-3.5 shrink-0 text-primary/70" />
                      <span className="flex-1 truncate font-medium">{db.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {(!databases || databases.length === 0) && (
                <div className="px-3 py-2 text-xs text-muted-foreground/50 italic">
                  No databases yet — run CREATE DB &lt;name&gt;
                </div>
              )}
            </div>
          )}
        </div>

        <Sep />

        <TBtn icon={Undo2}  onClick={undo}  title="Undo (Ctrl+Z)" disabled={!canUndo()} />
        <TBtn icon={Redo2}  onClick={redo}  title="Redo (Ctrl+Y)" disabled={!canRedo()} />

        <Sep />

        <TBtn icon={MessageSquare} onClick={handleComment}   title="Toggle Comment (Ctrl+/)" />
        <TBtn icon={FolderOpen}    onClick={handleOpen}      title="Open file (Ctrl+O)" />
        <TBtn icon={Save}          onClick={handleSave}      title="Save file (Ctrl+S)" />
        <TBtn icon={Copy}          onClick={handleCopy}      title="Copy to clipboard" active={copyFlash} />
        <TBtn icon={Wand2}         onClick={handleFormat}    title="Format / prettify query" />

        <Sep />

        <TBtn icon={Map}      onClick={() => onToggleMinimap?.()}    title="Toggle Minimap (Ctrl+Shift+M)" active={minimapOpen} />
        <TBtn icon={Keyboard} onClick={() => onOpenShortcuts?.()}    title="Keyboard shortcuts (Ctrl+K)" />

        <span className="text-[10px] text-muted-foreground/40 ml-auto shrink-0 hidden sm:block">
          Ctrl+Enter to run · Ctrl+/ comment · Ctrl+K shortcuts
        </span>
      </div>

      {/* Editor + Minimap */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Code Editor */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto uql-editor-container bg-editor-bg relative group min-w-0"
        >
          <div className="absolute left-0 top-0 bottom-0 w-12 bg-foreground/[0.03] border-r border-foreground/5 z-0" />
          <Editor
            value={queryText}
            onValueChange={setQueryText}
            highlight={highlightFn}
            padding={24}
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 14,
              minHeight: "100%",
              backgroundColor: "transparent",
              position: "relative",
              zIndex: 1,
              marginLeft: "8px",
            }}
            textareaClassName={cn(
              "editor-textarea outline-none resize-none",
              theme === 'dark' ? "text-transparent caret-cyan-400" : "text-transparent caret-sky-600"
            )}
            className={theme === 'dark' ? "text-slate-300" : "text-slate-700"}
          />
        </div>

        {/* Minimap */}
        {minimapOpen && (
          <Minimap code={queryText} theme={theme} errorLine={lastErrorLine} />
        )}
      </div>
    </div>
  );
}
