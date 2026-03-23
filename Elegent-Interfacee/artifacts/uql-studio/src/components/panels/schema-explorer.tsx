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
      style={{ background: '#0d0d0d', borderRight: '1px solid #2e2e2e' }}
    >
      {/* Databases sub-label */}
      <div className="px-3 py-1 border-b shrink-0" style={{ borderColor: '#2e2e2e', background: '#1a1a1a' }}>
        <span
          className="flex items-center"
          style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#cccccc', textTransform: 'uppercase', letterSpacing: '0.06em' }}
        >
          Databases
          {databases && (
            <span className="ml-auto" style={{ color: '#888888' }}>({databases.length})</span>
          )}
        </span>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {isLoading ? (
          <div className="flex items-center justify-center p-8" style={{ color: '#666' }}>
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : Array.isArray(databases) && databases.length === 0 ? (
          <div className="p-4 text-center space-y-2">
            <Database className="w-7 h-7 mx-auto mb-2" style={{ color: '#444' }} />
            <p style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#888', fontSize: 11 }}>
              no databases
            </p>
            <p style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#666', fontSize: 10 }}>
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
      style={{ color: '#666', borderRadius: 2 }}
      onMouseEnter={e => (e.currentTarget.style.color = '#cccccc')}
      onMouseLeave={e => (e.currentTarget.style.color = '#666')}
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
          borderLeftColor: isActive ? '#ffffff' : 'transparent',
          background: isActive ? '#161616' : 'transparent',
          color: isActive ? '#e0e0e0' : '#aaaaaa',
          fontFamily: "'IBM Plex Mono', monospace",
        }}
        onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = '#111'; e.currentTarget.style.color = '#cccccc'; } }}
        onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#aaaaaa'; } }}
        onClick={() => { onSelect(); onToggle(); }}
      >
        <span className="w-3 flex items-center justify-center shrink-0" style={{ color: '#666' }}>
          {isExpanded
            ? <ChevronDown className="w-2.5 h-2.5" />
            : <ChevronRight className="w-2.5 h-2.5" />}
        </span>
        <Database className="w-3 h-3 shrink-0" style={{ color: isActive ? '#aaa' : '#666' }} />
        <span className="flex-1 font-medium truncate">{db.name}</span>
        {isActive && (
          <span className="w-1 h-1 rounded-full shrink-0" style={{ background: '#888' }} />
        )}
        <button
          onClick={handleDelete}
          className="opacity-0 group-hover:opacity-100 p-0.5 transition-all shrink-0"
          style={{ color: '#666' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#c44')}
          onMouseLeave={e => (e.currentTarget.style.color = '#666')}
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
                style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#777', fontSize: 11 }}
              >
                <Loader2 className="w-3 h-3 animate-spin" /> loading…
              </div>
            ) : (
              <div className="ml-3 border-l" style={{ borderColor: '#1e1e1e' }}>
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
        onMouseEnter={e => (e.currentTarget.style.background = '#111')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        onClick={() => setIsOpen(o => !o)}
      >
        <span className="w-2.5 flex items-center justify-center shrink-0" style={{ color: '#666' }}>
          {isOpen
            ? <ChevronDown className="w-2 h-2" />
            : <ChevronRight className="w-2 h-2" />}
        </span>
        <folder.icon
          className="w-3 h-3 shrink-0"
          style={{ color: hasItems ? '#888' : '#555' }}
        />
        <span
          className="flex-1 text-[11px] font-medium"
          style={{ color: hasItems ? '#aaa' : '#666' }}
        >
          {folder.name}
        </span>
        <span
          className="text-[10px] shrink-0"
          style={{ color: hasItems ? '#777' : '#555', fontFamily: "'IBM Plex Mono', monospace" }}
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
            style={{ borderColor: '#181818' }}
          >
            {!hasItems ? (
              <div
                className="py-1 px-3 italic"
                style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#555', fontSize: 10 }}
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
        onMouseEnter={e => (e.currentTarget.style.background = '#111')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        onClick={() => {
          onCollectionClick?.(dbId, item.name);
          if (fields.length > 0) setShowFields(v => !v);
        }}
      >
        <span className="w-3 shrink-0 flex items-center justify-center" style={{ color: '#555' }}>
          {fields.length > 0 ? (
            showFields
              ? <ChevronDown className="w-2 h-2" />
              : <ChevronRight className="w-2 h-2" />
          ) : <span className="w-2" />}
        </span>
        <Icon className="w-3 h-3 shrink-0" style={{ color: '#666' }} />
        <span
          className="flex-1 text-[11px] font-medium truncate"
          style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#aaaaaa' }}
        >
          {item.name}
        </span>
        <span
          className="text-[10px] shrink-0 group-hover:hidden"
          style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#555' }}
        >
          {formatCount(item.recordCount)}
        </span>
        <button
          onClick={handleDrop}
          disabled={dropMutation.isPending}
          title={`Drop ${item.name}`}
          className="hidden group-hover:flex items-center justify-center w-4 h-4 shrink-0 transition-colors"
          style={{ color: '#666' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#c44')}
          onMouseLeave={e => (e.currentTarget.style.color = '#666')}
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
            style={{ borderColor: '#161616' }}
          >
            {fields.map((field: string) => {
              const hasIndex = indexes.includes(field);
              return (
                <div
                  key={field}
                  className="flex items-center gap-2 px-3 py-0.5"
                  style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#777' }}
                >
                  <Hash className="w-2.5 h-2.5 shrink-0" style={{ color: '#555' }} />
                  <span className="flex-1">{field}</span>
                  {hasIndex && (
                    <Zap className="w-2.5 h-2.5 shrink-0" style={{ color: '#777' }} title="Secondary index" />
                  )}
                </div>
              );
            })}
            {indexes.length > 0 && fields.length === 0 && indexes.map((idx: string) => (
              <div
                key={idx}
                className="flex items-center gap-2 px-3 py-0.5"
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#777' }}
              >
                <Zap className="w-2.5 h-2.5 shrink-0" />
                <span>{idx}</span>
                <span className="ml-auto" style={{ fontSize: 9, color: '#555' }}>idx</span>
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
          background: '#1a1a1a',
          border: '1px solid #3d3d3d',
          borderRadius: 3,
          boxShadow: '0 20px 60px rgba(0,0,0,0.85)',
          animation: 'modal-in 0.14s ease',
        }}
      >
        {/* Title bar */}
        <div
          className="flex items-center justify-between px-4 py-2"
          style={{ background: '#222222', borderBottom: '1px solid #2e2e2e' }}
        >
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 600, color: '#ffffff' }}>
            New Database
          </span>
          <button
            onClick={onClose}
            style={{ color: '#777', background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#ffffff')}
            onMouseLeave={e => (e.currentTarget.style.color = '#777')}
          >
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit}>
          <div className="px-5 py-5">
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#888', letterSpacing: '0.04em', marginBottom: 6 }}>
              DATABASE NAME
            </div>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-1.5 outline-none"
              style={{
                background: '#2a2a2a',
                border: '1px solid #3d3d3d',
                color: '#e0e0e0',
                fontSize: 12,
                fontFamily: "'IBM Plex Mono', monospace",
                borderRadius: 3,
              }}
              placeholder="e.g. ProjectAlpha"
              spellCheck={false}
              onFocus={e => (e.currentTarget.style.borderColor = '#888')}
              onBlur={e => (e.currentTarget.style.borderColor = '#3d3d3d')}
            />
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-end gap-2 px-5 py-3"
            style={{ background: '#222222', borderTop: '1px solid #2e2e2e' }}
          >
            <button
              type="button"
              onClick={onClose}
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
              disabled={createMutation.isPending || !isValid}
              style={{
                padding: '5px 20px',
                fontFamily: "'IBM Plex Mono', monospace",
                background: isValid ? '#f0f0f0' : '#2a2a2a',
                color: isValid ? '#0a0a0a' : '#666',
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
              onMouseEnter={e => { if (isValid) e.currentTarget.style.background = '#ffffff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = isValid ? '#f0f0f0' : '#2a2a2a'; }}
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
