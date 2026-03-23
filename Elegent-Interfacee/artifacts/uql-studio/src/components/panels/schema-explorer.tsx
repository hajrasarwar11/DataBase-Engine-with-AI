import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDatabases,
  useCreateDatabase,
  useDeleteDatabase,
  useListCollections,
  useExecuteQuery,
  getListDatabasesQueryKey,
} from "@workspace/api-client-react";
import {
  Database, Plus, Trash2, ChevronRight, ChevronDown, Loader2,
  FileText, Share2, RefreshCw, Hash, Table as TableIcon, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface SchemaExplorerProps {
  activeDatabaseId: number | null;
  onSelectDatabase: (id: number) => void;
  onCollectionClick?: (dbId: number, collectionName: string) => void;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

// Every database always shows these 3 folders
const FOLDERS = [
  {
    name: "Tables",
    icon: TableIcon,
    color: "text-blue-400",
    types: ["table"],
    createHint: "CREATE TABLE",
    emptyHint: "table",
  },
  {
    name: "Graphs",
    icon: Share2,
    color: "text-emerald-400",
    // "graph", "node", "edge" all group under Graphs
    types: ["graph", "node", "edge"],
    createHint: "CREATE GRAPH",
    emptyHint: "graph",
  },
  {
    name: "Documents",
    icon: FileText,
    color: "text-yellow-400",
    types: ["collection"],
    createHint: "CREATE DOCUMENT",
    emptyHint: "document",
  },
];

export function SchemaExplorer({
  activeDatabaseId,
  onSelectDatabase,
  onCollectionClick,
}: SchemaExplorerProps) {
  const { data: databases, isLoading, refetch } = useListDatabases();
  const [expandedDbs, setExpandedDbs] = useState<Set<number>>(new Set());
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const toggleDb = useCallback((id: number) => {
    setExpandedDbs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col h-full bg-panel-bg border-r border-panel-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-foreground/[0.08] shrink-0">
        <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
          <Database className="w-3.5 h-3.5" />
          Object Explorer
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => refetch()}
            title="Refresh"
            className="p-1 hover:bg-foreground/10 rounded text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setIsCreateOpen(true)}
            title="New Database"
            className="p-1 hover:bg-foreground/10 rounded text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Databases label */}
      <div className="px-3 py-1.5 border-b border-foreground/[0.08] shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1.5">
          Databases
          {databases && (
            <span className="ml-auto opacity-50">({databases.length})</span>
          )}
        </span>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {isLoading ? (
          <div className="flex items-center justify-center p-8 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : Array.isArray(databases) && databases.length === 0 ? (
          <div className="p-4 text-center space-y-2">
            <Database className="w-8 h-8 mx-auto opacity-20 mb-3" />
            <p className="text-xs text-muted-foreground">No databases yet.</p>
            <p className="text-[11px] text-muted-foreground/50">
              Run: <code className="text-cyan-400">CREATE DB MyProject</code>
            </p>
          </div>
        ) : Array.isArray(databases) ? (
          databases.map(db => (
            <DatabaseNode
              key={db.id}
              db={db}
              isExpanded={expandedDbs.has(db.id)}
              isActive={activeDatabaseId === db.id}
              onToggle={() => toggleDb(db.id)}
              onSelect={() => {
                onSelectDatabase(db.id);
              }}
              onCollectionClick={onCollectionClick}
            />
          ))
        ) : null}
      </div>

      {isCreateOpen && (
        <CreateDatabaseDialog onClose={() => setIsCreateOpen(false)} />
      )}
    </div>
  );
}

function DatabaseNode({
  db,
  isExpanded,
  isActive,
  onToggle,
  onSelect,
  onCollectionClick,
}: any) {
  const queryClient = useQueryClient();
  const { data: collections, isLoading } = useListCollections(db.id, {
    query: { enabled: isExpanded },
  });
  const deleteMutation = useDeleteDatabase();

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      confirm(
        `Delete database "${db.name}" and all its data? This cannot be undone.`
      )
    ) {
      deleteMutation.mutate(
        { id: db.id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListDatabasesQueryKey() });
          },
        }
      );
    }
  };

  return (
    <div className="select-none">
      {/* Database Row */}
      <div
        className={cn(
          "flex items-center gap-1.5 px-2 py-1.5 cursor-pointer group transition-all text-[13px]",
          isActive
            ? "bg-primary/15 text-foreground border-l-2 border-primary"
            : "text-foreground/80 hover:bg-foreground/5 border-l-2 border-transparent"
        )}
        onClick={() => {
          onSelect();
          onToggle();
        }}
      >
        <span className="text-muted-foreground/60 w-3.5 flex items-center justify-center shrink-0">
          {isExpanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </span>
        <Database className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
        <span className="flex-1 font-semibold truncate">{db.name}</span>
        {isActive && (
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
        )}
        <button
          onClick={handleDelete}
          className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 text-muted-foreground transition-all shrink-0"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Expanded: Folders */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            {isLoading ? (
              <div className="ml-7 py-2 text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading...
              </div>
            ) : (
              <div className="ml-4 border-l border-foreground/[0.07]">
                {FOLDERS.map(folder => {
                  const items = (collections ?? []).filter((c: any) =>
                    folder.types.includes(c.type)
                  );
                  return (
                    <FolderNode
                      key={folder.name}
                      folder={folder}
                      items={items}
                      dbName={db.name}
                      dbId={db.id}
                      databaseId={db.id}
                      onCollectionClick={onCollectionClick}
                    />
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FolderNode({ folder, items, dbName, dbId, databaseId, onCollectionClick }: any) {
  const hasItems = items && items.length > 0;
  const [isOpen, setIsOpen] = useState(false);

  // Auto-open when items arrive
  useEffect(() => {
    if (hasItems) setIsOpen(true);
  }, [hasItems]);

  return (
    <div className="select-none">
      {/* Folder row */}
      <div
        className="flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-foreground/5 group transition-colors"
        onClick={() => setIsOpen(o => !o)}
      >
        <span className="text-muted-foreground/40 w-3 flex items-center justify-center shrink-0">
          {isOpen ? (
            <ChevronDown className="w-2.5 h-2.5" />
          ) : (
            <ChevronRight className="w-2.5 h-2.5" />
          )}
        </span>
        <folder.icon
          className={cn(
            "w-3.5 h-3.5 shrink-0",
            hasItems ? folder.color : "text-muted-foreground/25"
          )}
        />
        <span
          className={cn(
            "flex-1 text-[12px] font-medium",
            hasItems ? "text-muted-foreground" : "text-muted-foreground/35"
          )}
        >
          {folder.name}
        </span>
        <span
          className={cn(
            "text-[10px] px-1.5 py-0.5 rounded-full font-mono shrink-0",
            hasItems
              ? "bg-foreground/5 text-muted-foreground"
              : "text-muted-foreground/25"
          )}
        >
          {items?.length ?? 0}
        </span>
      </div>

      {/* Items */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.12 }}
            className="overflow-hidden ml-4 border-l border-foreground/[0.05]"
          >
            {!hasItems ? (
              <div className="py-1.5 px-3 text-[10px] text-muted-foreground/30 italic">
                empty — use{" "}
                <code className="text-cyan-400/50">
                  {folder.createHint} &lt;name&gt; IN {dbName}
                </code>
              </div>
            ) : (
              items.map((item: any) => (
                <CollectionItem
                  key={item.id}
                  item={item}
                  dbId={dbId}
                  dbName={dbName}
                  databaseId={databaseId}
                  onCollectionClick={onCollectionClick}
                />
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const TYPE_TO_DROP: Record<string, string> = {
  table: "TABLE",
  graph: "GRAPH",
  collection: "DOCUMENT",
  node: "GRAPH",
  edge: "GRAPH",
};

function CollectionItem({ item, dbId, dbName, databaseId, onCollectionClick }: any) {
  const [showFields, setShowFields] = useState(false);
  const queryClient = useQueryClient();
  const dropMutation = useExecuteQuery();

  const schema = item.schema as any;
  const fields: string[] =
    schema?.columns ?? schema?.fields ?? schema?.properties ?? [];
  const indexes: string[] = item.indexes ?? [];

  const Icon =
    item.type === "table"
      ? TableIcon
      : item.type === "graph" || item.type === "node" || item.type === "edge"
      ? Share2
      : FileText;

  const color =
    item.type === "table"
      ? "text-blue-400"
      : item.type === "graph" || item.type === "node" || item.type === "edge"
      ? "text-emerald-400"
      : "text-yellow-400";

  const handleDrop = (e: React.MouseEvent) => {
    e.stopPropagation();
    const typeKw = TYPE_TO_DROP[item.type] ?? "TABLE";
    const label = typeKw.charAt(0) + typeKw.slice(1).toLowerCase();
    if (!confirm(`Drop ${label} "${item.name}" and all its records? This cannot be undone.`)) return;

    dropMutation.mutate(
      { data: { query: `DROP ${typeKw} ${item.name} IN ${dbName}` } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            predicate: (q) => {
              const key = q.queryKey[0];
              return typeof key === "string" && key.includes("/collections");
            },
          });
        },
      }
    );
  };

  return (
    <div className="select-none">
      <div
        className="flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-foreground/5 group transition-colors"
        onClick={() => {
          onCollectionClick?.(dbId, item.name);
          if (fields.length > 0) setShowFields(v => !v);
        }}
      >
        <span className="w-3 shrink-0 flex items-center justify-center text-muted-foreground/30">
          {fields.length > 0 ? (
            showFields ? (
              <ChevronDown className="w-2.5 h-2.5" />
            ) : (
              <ChevronRight className="w-2.5 h-2.5" />
            )
          ) : (
            <span className="w-2.5" />
          )}
        </span>
        <Icon className={cn("w-3.5 h-3.5 shrink-0", color)} />
        <span className="flex-1 text-[12px] text-foreground/80 font-medium truncate group-hover:text-foreground transition-colors">
          {item.name}
        </span>
        <span className="text-[10px] text-muted-foreground/50 font-mono shrink-0 group-hover:hidden">
          {formatCount(item.recordCount)}
        </span>
        <button
          onClick={handleDrop}
          disabled={dropMutation.isPending}
          title={`Drop ${item.name}`}
          className="hidden group-hover:flex items-center justify-center w-4 h-4 shrink-0 text-muted-foreground hover:text-red-400 transition-colors"
        >
          {dropMutation.isPending
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : <Trash2 className="w-3 h-3" />
          }
        </button>
      </div>

      {/* Schema fields */}
      <AnimatePresence>
        {showFields && fields.length > 0 && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.1 }}
            className="overflow-hidden ml-6 border-l border-foreground/[0.04]"
          >
            {fields.map((field: string) => {
              const hasIndex = indexes.includes(field);
              return (
                <div
                  key={field}
                  className="flex items-center gap-2 px-3 py-0.5 text-[11px] text-muted-foreground/50"
                >
                  <Hash className="w-2.5 h-2.5 shrink-0 text-muted-foreground/25" />
                  <span className="font-mono flex-1">{field}</span>
                  {hasIndex && (
                    <Zap className="w-2.5 h-2.5 shrink-0 text-cyan-400/70" title="Secondary index" />
                  )}
                </div>
              );
            })}
            {indexes.length > 0 && fields.length === 0 && indexes.map((idx: string) => (
              <div
                key={idx}
                className="flex items-center gap-2 px-3 py-0.5 text-[11px] text-cyan-400/50"
              >
                <Zap className="w-2.5 h-2.5 shrink-0" />
                <span className="font-mono">{idx}</span>
                <span className="text-[9px] ml-auto text-cyan-400/30">idx</span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CreateDatabaseDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const createMutation = useCreateDatabase();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate(
      { data: { name: name.trim(), type: "relational" } },
      { onSuccess: () => { setName(""); onClose(); } }
    );
  };

  const isValid = name.trim().length > 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-background/60 backdrop-blur-md"
      />

      {/* Dialog */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="relative bg-panel-bg border border-foreground/[0.1] rounded-2xl shadow-[0_32px_80px_rgba(0,0,0,0.6)] w-full max-w-[400px] mx-4 overflow-hidden"
      >
        {/* Accent bar */}
        <div className="h-[2px] bg-gradient-to-r from-transparent via-primary to-transparent opacity-80" />

        {/* Header */}
        <div className="px-6 pt-5 pb-4 flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-cyan-600/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
            <Database className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[15px] font-semibold text-foreground tracking-tight">
              Create Database
            </h3>
            <p className="text-[12px] text-muted-foreground/70 mt-0.5 leading-relaxed">
              Or run{" "}
              <code className="text-primary/90 font-mono bg-primary/10 px-1.5 py-0.5 rounded text-[11px]">
                CREATE DB MyProject
              </code>{" "}
              in the editor
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-foreground/[0.07] mx-6" />

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          <div className="space-y-2">
            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
              Database Name
            </label>
            <div className="relative">
              <input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full bg-editor-bg border border-foreground/[0.1] rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/35 focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15 transition-all font-mono tracking-wide"
                placeholder="e.g. ProjectAlpha"
                spellCheck={false}
              />
            </div>
            <p className="text-[11px] text-muted-foreground/45 leading-relaxed">
              Tables, graphs, and documents live inside a database.
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-foreground bg-foreground/[0.04] hover:bg-foreground/[0.08] border border-foreground/[0.08] hover:border-foreground/[0.14] transition-all font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || !isValid}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary/20"
            >
              {createMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              {createMutation.isPending ? "Creating…" : "Create Database"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>,
    document.body
  );
}
