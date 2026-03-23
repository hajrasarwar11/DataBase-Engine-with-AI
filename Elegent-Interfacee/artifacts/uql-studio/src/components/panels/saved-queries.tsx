import { useState } from "react";
import { Bookmark, Trash2, Play, Plus, X, BookmarkCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import type { SavedQuery } from "@/hooks/use-ide-state";
import { format } from "date-fns";

interface SavedQueriesProps {
  queries: SavedQuery[];
  onLoad: (query: string) => void;
  onDelete: (id: string) => void;
  onSave: (name: string, query: string) => void;
  currentQuery: string;
}

export function SavedQueries({ queries, onLoad, onDelete, onSave, currentQuery }: SavedQueriesProps) {
  const [savingName, setSavingName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = () => {
    const name = savingName.trim() || `Query ${new Date().toLocaleTimeString()}`;
    onSave(name, currentQuery);
    setSavingName("");
    setIsSaving(false);
  };

  return (
    <div className="flex flex-col h-full bg-panel-bg border-t border-panel-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-foreground/[0.08] bg-foreground/[0.03] shrink-0">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <Bookmark className="w-3.5 h-3.5" />
          Saved Queries
          {Array.isArray(queries) && queries.length > 0 && (
            <span className="bg-foreground/5 text-muted-foreground/60 text-[10px] px-1.5 py-0.5 rounded-full font-mono">
              {queries.length}
            </span>
          )}
        </h2>

        <button
          onClick={() => setIsSaving(v => !v)}
          title="Save current query"
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all",
            isSaving
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-foreground/10"
          )}
        >
          <Plus className="w-3 h-3" />
          Save current
        </button>
      </div>

      {/* Save form */}
      <AnimatePresence>
        {isSaving && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden shrink-0"
          >
            <div className="px-4 py-3 border-b border-foreground/[0.08] bg-primary/[0.04]">
              <p className="text-[10px] text-muted-foreground mb-2 font-mono truncate opacity-60">
                {currentQuery.split('\n').find(l => l.trim() && !l.trim().startsWith('--'))?.trim().slice(0, 60) ?? 'Current query'}
              </p>
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={savingName}
                  onChange={e => setSavingName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setIsSaving(false); }}
                  placeholder="Snippet name (Enter to save)"
                  className="flex-1 bg-background/80 border border-foreground/[0.12] rounded-lg px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary transition-all"
                />
                <button
                  onClick={handleSave}
                  className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-all flex items-center gap-1.5"
                >
                  <BookmarkCheck className="w-3 h-3" />
                  Save
                </button>
                <button
                  onClick={() => setIsSaving(false)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-all"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {queries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-6 gap-3">
            <div className="w-12 h-12 rounded-xl bg-foreground/5 flex items-center justify-center border border-foreground/[0.08]">
              <Bookmark className="w-6 h-6 opacity-20" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">No saved queries</p>
              <p className="text-xs text-muted-foreground/50 mt-1">Click "Save current" to bookmark a query</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-foreground/[0.06]">
            {queries.map(sq => (
              <div
                key={sq.id}
                className="group flex items-start gap-3 px-4 py-3 hover:bg-foreground/[0.03] transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[13px] font-medium text-foreground truncate">{sq.name}</span>
                    <span className="text-[10px] text-muted-foreground/40 shrink-0">
                      {format(new Date(sq.createdAt), 'MMM d, HH:mm')}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground/50 font-mono truncate leading-relaxed">
                    {sq.query.split('\n').find(l => l.trim() && !l.trim().startsWith('--'))?.trim() ?? sq.query.slice(0, 60)}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => onLoad(sq.query)}
                    title="Load into editor"
                    className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDelete(sq.id)}
                    title="Delete snippet"
                    className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
