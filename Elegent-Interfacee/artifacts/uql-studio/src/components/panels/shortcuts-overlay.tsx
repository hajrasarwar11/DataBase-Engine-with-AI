import { useEffect } from "react";
import { X, Keyboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

const SHORTCUTS = [
  {
    group: "Editor",
    items: [
      { keys: ["Ctrl", "Enter"], desc: "Run query" },
      { keys: ["Ctrl", "/"], desc: "Toggle comment / uncomment selection" },
      { keys: ["Ctrl", "Z"], desc: "Undo" },
      { keys: ["Ctrl", "Y"], desc: "Redo" },
      { keys: ["Ctrl", "Shift", "Z"], desc: "Redo (alternate)" },
    ],
  },
  {
    group: "File",
    items: [
      { keys: ["Ctrl", "S"], desc: "Save query as .uql file" },
      { keys: ["Ctrl", "O"], desc: "Open query file" },
      { keys: ["Ctrl", "C"], desc: "Copy query to clipboard (in editor)" },
    ],
  },
  {
    group: "Panels",
    items: [
      { keys: ["Ctrl", "Shift", "E"], desc: "Toggle Explorer panel" },
      { keys: ["Ctrl", "Shift", "H"], desc: "Toggle History panel" },
      { keys: ["Ctrl", "Shift", "A"], desc: "Toggle AI Copilot panel" },
      { keys: ["Ctrl", "Shift", "M"], desc: "Toggle Minimap" },
    ],
  },
  {
    group: "Tabs",
    items: [
      { keys: ["Ctrl", "T"], desc: "New query tab" },
      { keys: ["Ctrl", "W"], desc: "Close current tab" },
      { keys: ["Ctrl", "Tab"], desc: "Next tab" },
    ],
  },
  {
    group: "UQL Quick Reference",
    items: [
      { keys: ["FIND <col>"], desc: "Select all records" },
      { keys: ["FIND <col> WHERE field = value"], desc: "Filter with WHERE" },
      { keys: ["ADD <col> VALUES { ... }"], desc: "Insert a record" },
      { keys: ["MODIFY <col> SET { } WHERE ..."], desc: "Update records" },
      { keys: ["REMOVE <col> WHERE ..."], desc: "Delete records" },
      { keys: ["BEGIN / COMMIT / ROLLBACK"], desc: "ACID transaction" },
      { keys: ["EXPLAIN FIND ..."], desc: "Show query plan" },
      { keys: ["SHOW STATS IN <db>"], desc: "Engine statistics" },
    ],
  },
];

interface ShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsOverlay({ open, onClose }: ShortcutsOverlayProps) {
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        onClose();
      }
    };
    if (open) document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ duration: 0.15 }}
            className="bg-panel-bg border border-foreground/[0.12] rounded-2xl shadow-2xl shadow-black/40 w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-foreground/[0.08] shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-primary/10 rounded-lg">
                  <Keyboard className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h2 className="font-semibold text-foreground text-sm">Keyboard Shortcuts</h2>
                  <p className="text-xs text-muted-foreground">Press Esc to close</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="overflow-y-auto p-5 space-y-6">
              {SHORTCUTS.map(group => (
                <div key={group.group}>
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-3">
                    {group.group}
                  </h3>
                  <div className="space-y-1">
                    {group.items.map((item, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-foreground/[0.03] transition-colors group"
                      >
                        <span className="text-sm text-foreground/80">{item.desc}</span>
                        <div className="flex items-center gap-1 shrink-0 ml-4">
                          {item.keys.map((k, ki) => (
                            <span key={ki} className="flex items-center gap-1">
                              <kbd className={cn(
                                "px-2 py-0.5 text-[11px] font-mono rounded-md border shadow-sm",
                                "bg-background/80 border-foreground/[0.15] text-foreground/70",
                                "font-semibold tracking-tight"
                              )}>
                                {k}
                              </kbd>
                              {ki < item.keys.length - 1 && (
                                <span className="text-muted-foreground/40 text-[10px]">+</span>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
