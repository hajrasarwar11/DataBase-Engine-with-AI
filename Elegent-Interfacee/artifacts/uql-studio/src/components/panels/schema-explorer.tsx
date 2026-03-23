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
  FileText, Share2, RefreshCw, Hash, Table as TableIcon, Zap, X as XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface SchemaExplorerProps {
  activeDatabaseId: number | null;
  onSelectDatabase: (id: number) => void;
  onCollectionClick?: (dbId: number, collectionName: string) => void;
  isCreateOpen?: boolean;
  onCloseCreate?: () => void;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

const FOLDERS = [
  { name: "Tables",    icon: TableIcon, types: ["table"],               createHint: "CREATE TABLE",    emptyHint: "table" },
  { name: "Graphs",    icon: Share2,    types: ["graph", "node", "edge"], createHint: "CREATE GRAPH",    emptyHint: "graph" },
  { name: "Documents", icon: FileText,  types: ["collection"],           createHint: "CREATE DOCUMENT", emptyHint: "document" },
];

export function SchemaExplorer({
  activeDatabaseId,
  onSelectDatabase,
  onCollectionClick,
  isCreateOpen: isCreateOpenProp,
  onCloseCreate,
}: SchemaExplorerProps) {
  const { data: databases, isLoading } = useListDatabases();
  const [expandedDbs, setExpandedDbs] = useState<Set<number>>(new Set());
  const [isCreateOpenInternal, setIsCreateOpenInternal] = useState(false);

  // Controlled from parent if props provided, otherwise internal
  const isCreateOpen = isCreateOpenProp ?? isCreateOpenInternal;
  const handleCloseCreate = onCloseCreate ?? (() => setIsCreateOpenInternal(false));

  const toggleDb = useCallback((id: number) => {
    setExpandedDbs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ background: 'var(--uql-panel)', borderRight: '1px solid var(--uql-b1)' }}
    >
      {/* Databases sub-label */}
      <div className="px-3 py-1 border-b shrink-0" style={{ borderColor: 'var(--uql-b1)', background: 'var(--uql-header)' }}>
        <span
          className="flex items-center"
          style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--uql-t3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}
        >
          Databases
          {databases && (
            <span className="ml-auto" style={{ color: 'var(--uql-t5)' }}>({databases.length})</span>
          )}
        </span>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {isLoading ? (
          <div className="flex items-center justify-center p-8" style={{ color: 'var(--uql-t7)' }}>
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : Array.isArray(databases) && databases.length === 0 ? (
          <div className="p-4 text-center space-y-2">
            <Database className="w-7 h-7 mx-auto mb-2" style={{ color: 'var(--uql-b2)' }} />
            <p style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--uql-t5)', fontSize: 11 }}>
              no databases
            </p>
            <p style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--uql-t7)', fontSize: 10 }}>
              run: CREATE DB MyProject
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
              onSelect={() => { onSelectDatabase(db.id); }}
              onCollectionClick={onCollectionClick}
            />
          ))
        ) : null}
      </div>

      {isCreateOpen && (
        <CreateDatabaseDialog onClose={handleCloseCreate} />
      )}
    </div>
  );
}

function IconBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-1 transition-colors"
      style={{ color: 'var(--uql-t7)', borderRadius: 2 }}
      onMouseEnter={e => (e.currentTarget.style.color = 'var(--uql-t3)')}
      onMouseLeave={e => (e.currentTarget.style.color = 'var(--uql-t7)')}
    >
      {children}
    </button>
  );
}

function DatabaseNode({ db, isExpanded, isActive, onToggle, onSelect, onCollectionClick }: any) {
  const queryClient = useQueryClient();
  const { data: collections, isLoading } = useListCollections(db.id, {
    query: { enabled: isExpanded },
  });
  const deleteMutation = useDeleteDatabase();

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Delete database "${db.name}" and all its data? This cannot be undone.`)) {
      deleteMutation.mutate(
        { id: db.id },
        { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListDatabasesQueryKey() }); } }
      );
    }
  };

  return (
    <div className="select-none">
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer group transition-colors border-l-2"
        style={{
          fontSize: 12,
          borderLeftColor: isActive ? 'var(--uql-db-accent)' : 'transparent',
          background: isActive ? 'var(--uql-row-a)' : 'transparent',
          color: isActive ? 'var(--uql-t2)' : 'var(--uql-t4)',
          fontFamily: "'IBM Plex Mono', monospace",
        }}
        onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = 'var(--uql-deeper)'; e.currentTarget.style.color = 'var(--uql-t3)'; } }}
        onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--uql-t4)'; } }}
        onClick={() => { onSelect(); onToggle(); }}
      >
        <span className="w-3 flex items-center justify-center shrink-0" style={{ color: 'var(--uql-t7)' }}>
          {isExpanded
            ? <ChevronDown className="w-2.5 h-2.5" />
            : <ChevronRight className="w-2.5 h-2.5" />}
        </span>
        <Database className="w-3 h-3 shrink-0" style={{ color: isActive ? 'var(--uql-t4)' : 'var(--uql-t7)' }} />
        <span className="flex-1 font-medium truncate">{db.name}</span>
        {isActive && (
          <span className="w-1 h-1 rounded-full shrink-0" style={{ background: 'var(--uql-t5)' }} />
        )}
        <button
          onClick={handleDelete}
          className="opacity-0 group-hover:opacity-100 p-0.5 transition-all shrink-0"
          style={{ color: 'var(--uql-t7)' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#c44')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--uql-t7)')}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="overflow-hidden"
          >
            {isLoading ? (
              <div
                className="ml-6 py-2 flex items-center gap-2"
                style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--uql-t6)', fontSize: 11 }}
              >
                <Loader2 className="w-3 h-3 animate-spin" /> loading…
              </div>
            ) : (
              <div className="ml-3 border-l" style={{ borderColor: 'var(--uql-b4)' }}>
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

  useEffect(() => {
    if (hasItems) setIsOpen(true);
  }, [hasItems]);

  return (
    <div className="select-none">
      <div
        className="flex items-center gap-1.5 px-2 py-1 cursor-pointer transition-colors group"
        style={{ fontFamily: "'IBM Plex Mono', monospace" }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--uql-deeper)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        onClick={() => setIsOpen(o => !o)}
      >
        <span className="w-2.5 flex items-center justify-center shrink-0" style={{ color: 'var(--uql-t7)' }}>
          {isOpen
            ? <ChevronDown className="w-2 h-2" />
            : <ChevronRight className="w-2 h-2" />}
        </span>
        <folder.icon
          className="w-3 h-3 shrink-0"
          style={{ color: hasItems ? 'var(--uql-t5)' : 'var(--uql-t8)' }}
        />
        <span
          className="flex-1 text-[11px] font-medium"
          style={{ color: hasItems ? 'var(--uql-t4)' : 'var(--uql-t7)' }}
        >
          {folder.name}
        </span>
        <span
          className="text-[10px] shrink-0"
          style={{ color: hasItems ? 'var(--uql-t6)' : 'var(--uql-t8)', fontFamily: "'IBM Plex Mono', monospace" }}
        >
          {items?.length ?? 0}
        </span>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.1 }}
            className="overflow-hidden ml-3 border-l"
            style={{ borderColor: 'var(--uql-b5)' }}
          >
            {!hasItems ? (
              <div
                className="py-1 px-3 italic"
                style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--uql-t8)', fontSize: 10 }}
              >
                empty — {folder.createHint} &lt;name&gt; IN {dbName}
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
  table: "TABLE", graph: "GRAPH", collection: "DOCUMENT", node: "GRAPH", edge: "GRAPH",
};

function CollectionItem({ item, dbId, dbName, databaseId, onCollectionClick }: any) {
  const [showFields, setShowFields] = useState(false);
  const queryClient = useQueryClient();
  const dropMutation = useExecuteQuery();

  const schema = item.schema as any;
  const fields: string[] = schema?.columns ?? schema?.fields ?? schema?.properties ?? [];
  const indexes: string[] = item.indexes ?? [];

  const Icon =
    item.type === "table"
      ? TableIcon
      : item.type === "graph" || item.type === "node" || item.type === "edge"
      ? Share2
      : FileText;

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
        className="flex items-center gap-1.5 px-2 py-1 cursor-pointer group transition-colors"
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--uql-deeper)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        onClick={() => {
          onCollectionClick?.(dbId, item.name);
          if (fields.length > 0) setShowFields(v => !v);
        }}
      >
        <span className="w-3 shrink-0 flex items-center justify-center" style={{ color: 'var(--uql-t8)' }}>
          {fields.length > 0 ? (
            showFields
              ? <ChevronDown className="w-2 h-2" />
              : <ChevronRight className="w-2 h-2" />
          ) : <span className="w-2" />}
        </span>
        <Icon className="w-3 h-3 shrink-0" style={{ color: 'var(--uql-t7)' }} />
        <span
          className="flex-1 text-[11px] font-medium truncate"
          style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--uql-t4)' }}
        >
          {item.name}
        </span>
        <span
          className="text-[10px] shrink-0 group-hover:hidden"
          style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--uql-t8)' }}
        >
          {formatCount(item.recordCount)}
        </span>
        <button
          onClick={handleDrop}
          disabled={dropMutation.isPending}
          title={`Drop ${item.name}`}
          className="hidden group-hover:flex items-center justify-center w-4 h-4 shrink-0 transition-colors"
          style={{ color: 'var(--uql-t7)' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#c44')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--uql-t7)')}
        >
          {dropMutation.isPending
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : <Trash2 className="w-3 h-3" />
          }
        </button>
      </div>

      <AnimatePresence>
        {showFields && fields.length > 0 && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.1 }}
            className="overflow-hidden ml-5 border-l"
            style={{ borderColor: 'var(--uql-row-a)' }}
          >
            {fields.map((field: string) => {
              const hasIndex = indexes.includes(field);
              return (
                <div
                  key={field}
                  className="flex items-center gap-2 px-3 py-0.5"
                  style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--uql-t6)' }}
                >
                  <Hash className="w-2.5 h-2.5 shrink-0" style={{ color: 'var(--uql-t8)' }} />
                  <span className="flex-1">{field}</span>
                  {hasIndex && (
                    <Zap className="w-2.5 h-2.5 shrink-0" style={{ color: 'var(--uql-t6)' }} title="Secondary index" />
                  )}
                </div>
              );
            })}
            {indexes.length > 0 && fields.length === 0 && indexes.map((idx: string) => (
              <div
                key={idx}
                className="flex items-center gap-2 px-3 py-0.5"
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--uql-t6)' }}
              >
                <Zap className="w-2.5 h-2.5 shrink-0" />
                <span>{idx}</span>
                <span className="ml-auto" style={{ fontSize: 9, color: 'var(--uql-t8)' }}>idx</span>
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
      style={{ background: 'rgba(0,0,0,0.82)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative overflow-hidden"
        style={{
          width: 360,
          background: 'var(--uql-header)',
          border: '1px solid var(--uql-b2)',
          borderRadius: 3,
          boxShadow: '0 20px 60px rgba(0,0,0,0.85)',
          animation: 'modal-in 0.14s ease',
        }}
      >
        {/* Title bar */}
        <div
          className="flex items-center justify-between px-4 py-2"
          style={{ background: 'var(--uql-toolbar)', borderBottom: '1px solid var(--uql-b1)' }}
        >
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 600, color: 'var(--uql-t1)' }}>
            New Database
          </span>
          <button
            onClick={onClose}
            style={{ color: 'var(--uql-t6)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--uql-t1)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--uql-t6)')}
          >
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit}>
          <div className="px-5 py-5">
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--uql-t5)', letterSpacing: '0.04em', marginBottom: 6 }}>
              DATABASE NAME
            </div>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-1.5 outline-none"
              style={{
                background: 'var(--uql-input)',
                border: '1px solid var(--uql-b2)',
                color: 'var(--uql-t2)',
                fontSize: 12,
                fontFamily: "'IBM Plex Mono', monospace",
                borderRadius: 3,
              }}
              placeholder="e.g. ProjectAlpha"
              spellCheck={false}
              onFocus={e => (e.currentTarget.style.borderColor = 'var(--uql-t5)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'var(--uql-b2)')}
            />
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-end gap-2 px-5 py-3"
            style={{ background: 'var(--uql-toolbar)', borderTop: '1px solid var(--uql-b1)' }}
          >
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '5px 16px',
                fontFamily: "'IBM Plex Mono', monospace",
                color: 'var(--uql-t4)',
                background: 'transparent',
                border: '1px solid var(--uql-b2)',
                fontSize: 11,
                borderRadius: 3,
                cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--uql-t1)'; e.currentTarget.style.borderColor = 'var(--uql-t7)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--uql-t4)'; e.currentTarget.style.borderColor = 'var(--uql-b2)'; }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || !isValid}
              style={{
                padding: '5px 20px',
                fontFamily: "'IBM Plex Mono', monospace",
                background: isValid ? 'var(--uql-exec-bg)' : 'var(--uql-input)',
                color: isValid ? 'var(--uql-exec-text)' : 'var(--uql-t7)',
                border: '1px solid transparent',
                fontSize: 11,
                borderRadius: 3,
                fontWeight: 700,
                cursor: isValid ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (isValid) e.currentTarget.style.background = 'var(--uql-exec-hover)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = isValid ? 'var(--uql-exec-bg)' : 'var(--uql-input)'; }}
            >
              {createMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {createMutation.isPending ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>

      <style>{`
        @keyframes modal-in {
          from { transform: translateY(-10px); opacity: 0; }
          to { transform: none; opacity: 1; }
        }
      `}</style>
    </div>,
    document.body
  );
}
