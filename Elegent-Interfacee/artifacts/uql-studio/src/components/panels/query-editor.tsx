import { useExecuteQuery, useListDatabases } from "@workspace/api-client-react";
import { Loader2, X as XIcon } from "lucide-react";
import Editor from "react-simple-code-editor";
import { createPortal } from "react-dom";
import { highlightUQL, type Theme } from "@/lib/utils";
import { useState, useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import { cn } from "@/lib/utils";

// ── Public handle exposed via ref ─────────────────────────────────────────────
export interface QueryEditorHandle {
  execute: () => void;
  undo: () => void;
  redo: () => void;
  comment: () => void;
  format: () => void;
  save: () => void;
  open: () => void;
  copy: () => void;
}

export interface EditorStateUpdate {
  isPending: boolean;
  canUndo: boolean;
  canRedo: boolean;
  copyFlash: boolean;
}

const UQL_KEYWORDS = [
  'FIND','ADD','MODIFY','REMOVE','WHERE','SET','VALUES','FROM','TO','PATH','AS',
  'AND','OR','NOT','LIMIT','ORDER','BY','DESC','ASC','CREATE','DROP','GRAPH',
  'DOC','DOCUMENT','TABLE','DB','DATABASE','IN',
];

// ── Undo/redo with reactive canUndo/canRedo ──────────────────────────────────
function useUndoRedo(value: string, onChange: (v: string) => void) {
  const stack = useRef<string[]>([value]);
  const idx = useRef<number>(0);
  const skipPush = useRef(false);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const syncAvail = useCallback(() => {
    setCanUndo(idx.current > 0);
    setCanRedo(idx.current < stack.current.length - 1);
  }, []);

  useEffect(() => {
    if (skipPush.current) { skipPush.current = false; return; }
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      if (value !== stack.current[idx.current]) {
        stack.current = stack.current.slice(0, idx.current + 1);
        stack.current.push(value);
        idx.current = stack.current.length - 1;
        syncAvail();
      }
    }, 600);
    return () => { if (pushTimer.current) clearTimeout(pushTimer.current); };
  }, [value, syncAvail]);

  const undo = useCallback(() => {
    if (idx.current > 0) {
      idx.current--;
      skipPush.current = true;
      onChange(stack.current[idx.current]);
      syncAvail();
    }
  }, [onChange, syncAvail]);

  const redo = useCallback(() => {
    if (idx.current < stack.current.length - 1) {
      idx.current++;
      skipPush.current = true;
      onChange(stack.current[idx.current]);
      syncAvail();
    }
  }, [onChange, syncAvail]);

  return { undo, redo, canUndo, canRedo };
}

function parseErrorLine(errorMsg: string, query: string): number | null {
  const m = errorMsg.match(/line\s+(\d+)/i) ?? errorMsg.match(/row\s+(\d+)/i);
  if (m) return parseInt(m[1], 10) - 1;
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

function highlightWithError(code: string, theme: Theme, errorLine: number | null): string {
  const lines = highlightUQL(code, theme).split('\n');
  return lines.map((line, i) => {
    if (i === errorLine) {
      return `<span style="background:rgba(239,68,68,0.10);text-decoration:underline wavy rgba(239,68,68,0.6);text-underline-offset:3px;display:block;">${line}</span>`;
    }
    return line;
  }).join('\n');
}

function Minimap({ code, theme, errorLine }: { code: string; theme: Theme; errorLine: number | null }) {
  const lines = code.split('\n');
  return (
    <div className="w-[100px] shrink-0 h-full overflow-hidden border-l border-[#2e2e2e] bg-[#0d0d0d] select-none">
      <div className="px-1 py-1 origin-top-left" style={{ transform: 'scale(0.22)', width: '455px', transformOrigin: '0 0' }}>
        {lines.map((line, i) => (
          <div
            key={i}
            className={cn("leading-[1.6] whitespace-pre font-mono text-[14px] truncate", i === errorLine && "bg-red-500/20")}
            style={{ color: 'rgba(160,160,160,0.35)' }}
          >
            {line || ' '}
          </div>
        ))}
      </div>
    </div>
  );
}

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
  onStateChange?: (state: EditorStateUpdate) => void;
}

export const QueryEditor = forwardRef<QueryEditorHandle, QueryEditorProps>(function QueryEditorInner(
  {
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
    onStateChange,
  },
  ref
) {
  const executeMutation = useExecuteQuery();
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lastErrorLine, setLastErrorLine] = useState<number | null>(null);
  const [copyFlash, setCopyFlash] = useState(false);

  const { undo, redo, canUndo, canRedo } = useUndoRedo(queryText, setQueryText);

  useEffect(() => {
    setLastErrorLine(errorHighlight?.line ?? null);
  }, [errorHighlight]);

  // Notify parent of state changes so toolbar can reflect them
  useEffect(() => {
    onStateChange?.({ isPending: executeMutation.isPending, canUndo, canRedo, copyFlash });
  }, [executeMutation.isPending, canUndo, canRedo, copyFlash, onStateChange]);

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
            { success: false, error: err instanceof Error ? err.message : "Failed to execute query", executionTimeMs: 0 },
            queryText
          );
        },
      }
    );
  }, [queryText, activeDatabaseId, executeMutation, onExecutionComplete]);

  const handleComment = useCallback(() => {
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
  }, [queryText, setQueryText]);

  const toggleCommentAll = useCallback(() => {
    const lines = queryText.split("\n");
    const allCommented = lines.every(l => l.trim() === "" || l.trimStart().startsWith("--"));
    setQueryText(allCommented
      ? lines.map(l => l.replace(/^(\s*)--\s?/, "$1")).join("\n")
      : lines.map(l => "-- " + l).join("\n")
    );
  }, [queryText, setQueryText]);

  const handleFormat = useCallback(() => {
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
  }, [queryText, setQueryText]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(queryText).then(() => {
      setCopyFlash(true);
      setTimeout(() => setCopyFlash(false), 1200);
    });
  }, [queryText]);

  // ── Save As dialog state ────────────────────────────────────────────────────
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveFilename, setSaveFilename] = useState('query.uql');

  const handleSave = useCallback(() => {
    setSaveFilename('query.uql');
    setSaveDialogOpen(true);
  }, []);

  const doSave = useCallback((filename: string) => {
    const name = filename.trim() || 'query.uql';
    const blob = new Blob([queryText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name.endsWith('.uql') || name.endsWith('.txt') ? name : name + '.uql';
    a.click();
    URL.revokeObjectURL(url);
    setSaveDialogOpen(false);
  }, [queryText]);

  const handleOpen = useCallback(() => fileInputRef.current?.click(), []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setQueryText(String(ev.target?.result ?? ""));
    reader.readAsText(file);
    e.target.value = "";
  }, [setQueryText]);

  // Expose imperative API to parent (used by studio toolbar)
  useImperativeHandle(ref, () => ({
    execute: handleRun,
    undo,
    redo,
    comment: handleComment,
    format: handleFormat,
    save: handleSave,
    open: handleOpen,
    copy: handleCopy,
  }), [handleRun, undo, redo, handleComment, handleFormat, handleSave, handleOpen, handleCopy]);

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
  }, [handleRun, handleComment, undo, redo, handleSave, handleOpen, onOpenShortcuts, onToggleMinimap]);

  const highlightFn = useMemo(
    () => (code: string) => highlightWithError(code, theme, lastErrorLine),
    [theme, lastErrorLine]
  );

  // ── Line numbers ───────────────────────────────────────────────────────────
  const gutterRef = useRef<HTMLDivElement>(null);
  const lineCount = queryText.split('\n').length;
  const LINE_HEIGHT = 1.65;
  const FONT_SIZE = 13;
  const PADDING = 16;

  const handleEditorScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = (e.target as HTMLElement).scrollTop;
    }
  }, []);

  return (
    <>
    <div
      className="flex flex-col h-full relative"
      style={{ background: '#000000' }}
      onKeyDown={handleKeyDown}
    >
      <input ref={fileInputRef} type="file" accept=".uql,.sql,.txt" className="hidden" onChange={handleFileChange} />

      {/* Loading overlay when executing */}
      {executeMutation.isPending && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 px-2 py-1 rounded"
          style={{ background: '#1a1a1a', border: '1px solid #2e2e2e' }}>
          <Loader2 className="w-3 h-3 animate-spin" style={{ color: '#888888' }} />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#888888' }}>running…</span>
        </div>
      )}

      {/* Editor + Minimap */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* ── Line number gutter ── */}
        <div
          ref={gutterRef}
          style={{
            background: '#0d0d0d',
            borderRight: '1px solid #1e1e1e',
            width: lineCount >= 100 ? 52 : 44,
            flexShrink: 0,
            overflowY: 'hidden',
            overflowX: 'hidden',
            userSelect: 'none',
            paddingTop: PADDING,
          }}
        >
          {Array.from({ length: lineCount }, (_, i) => i + 1).map(n => (
            <div
              key={n}
              style={{
                height: `${FONT_SIZE * LINE_HEIGHT}px`,
                lineHeight: `${FONT_SIZE * LINE_HEIGHT}px`,
                fontSize: FONT_SIZE - 1,
                color: lastErrorLine === n - 1 ? '#c44' : '#444444',
                textAlign: 'right',
                paddingRight: 10,
                fontFamily: "'IBM Plex Mono', monospace",
              }}
            >
              {n}
            </div>
          ))}
        </div>

        {/* ── Editor area ── */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto uql-editor-container relative min-w-0"
          style={{ background: '#000000' }}
          onScroll={handleEditorScroll}
        >
          <Editor
            value={queryText}
            onValueChange={setQueryText}
            highlight={highlightFn}
            padding={PADDING}
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: FONT_SIZE,
              lineHeight: LINE_HEIGHT,
              minHeight: "100%",
              backgroundColor: "transparent",
            }}
            textareaClassName={cn(
              "editor-textarea outline-none resize-none",
              "text-transparent caret-white"
            )}
            className="text-[#cccccc]"
          />
        </div>

        {minimapOpen && (
          <Minimap code={queryText} theme={theme} errorLine={lastErrorLine} />
        )}
      </div>
    </div>

    {/* ── Save As dialog ──────────────────────────────────────────────── */}
    {saveDialogOpen && createPortal(
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.82)' }}
        onClick={(e) => { if (e.target === e.currentTarget) setSaveDialogOpen(false); }}
      >
        <div
          style={{
            width: 360,
            background: '#1a1a1a',
            border: '1px solid #3d3d3d',
            borderRadius: 3,
            boxShadow: '0 20px 60px rgba(0,0,0,0.85)',
            animation: 'save-dialog-in 0.14s ease',
            overflow: 'hidden',
          }}
        >
          {/* Title bar */}
          <div
            className="flex items-center justify-between px-4 py-2"
            style={{ background: '#222222', borderBottom: '1px solid #2e2e2e' }}
          >
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 600, color: '#ffffff' }}>
              Save Query File
            </span>
            <button
              onClick={() => setSaveDialogOpen(false)}
              style={{ color: '#777', background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#ffffff')}
              onMouseLeave={e => (e.currentTarget.style.color = '#777')}
            >
              <XIcon className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Body */}
          <form
            onSubmit={(e) => { e.preventDefault(); doSave(saveFilename); }}
          >
            <div className="px-5 py-5">
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#888', letterSpacing: '0.04em', marginBottom: 6 }}>
                FILE NAME
              </div>
              <input
                autoFocus
                value={saveFilename}
                onChange={e => setSaveFilename(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setSaveDialogOpen(false); }}
                className="w-full px-3 py-1.5 outline-none"
                style={{
                  background: '#2a2a2a',
                  border: '1px solid #3d3d3d',
                  color: '#e0e0e0',
                  fontSize: 12,
                  fontFamily: "'IBM Plex Mono', monospace",
                  borderRadius: 3,
                }}
                placeholder="query.uql"
                spellCheck={false}
                onFocus={e => (e.currentTarget.style.borderColor = '#888')}
                onBlur={e => (e.currentTarget.style.borderColor = '#3d3d3d')}
              />
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#555', marginTop: 6 }}>
                The file will be saved to your browser's download location.
              </div>
            </div>

            {/* Footer */}
            <div
              className="flex items-center justify-end gap-2 px-5 py-3"
              style={{ background: '#222222', borderTop: '1px solid #2e2e2e' }}
            >
              <button
                type="button"
                onClick={() => setSaveDialogOpen(false)}
                style={{
                  padding: '5px 16px',
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: '#aaa',
                  background: 'transparent',
                  border: '1px solid #3d3d3d',
                  fontSize: 11,
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#666'; }}
                onMouseLeave={e => { e.currentTarget.style.color = '#aaa'; e.currentTarget.style.borderColor = '#3d3d3d'; }}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={{
                  padding: '5px 20px',
                  fontFamily: "'IBM Plex Mono', monospace",
                  background: '#f0f0f0',
                  color: '#0a0a0a',
                  border: '1px solid transparent',
                  fontSize: 11,
                  borderRadius: 3,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#ffffff')}
                onMouseLeave={e => (e.currentTarget.style.background = '#f0f0f0')}
              >
                Save
              </button>
            </div>
          </form>
        </div>

        <style>{`
          @keyframes save-dialog-in {
            from { transform: translateY(-10px); opacity: 0; }
            to { transform: none; opacity: 1; }
          }
        `}</style>
      </div>,
      document.body
    )}
    </>
  );
});
