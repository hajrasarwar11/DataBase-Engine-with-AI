// ── File System Access API helpers ────────────────────────────────────────────
// Persists directory handles + collection type info across page reloads.

const IDB_NAME = 'uql-studio-fs';
const IDB_STORE = 'dir-handles';
const IDB_VER = 1;

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VER);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDirHandle(key: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(handle, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getDirHandle(key: string): Promise<FileSystemDirectoryHandle | null> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function verifyPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: 'readwrite' as const };
  try {
    if (await (handle as any).queryPermission(opts) === 'granted') return true;
    if (await (handle as any).requestPermission(opts) === 'granted') return true;
  } catch {
    // some browsers don't support queryPermission
  }
  return false;
}

export function isFsAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

// ── Collection type cache (localStorage) ─────────────────────────────────────
// key: `uql-col-types-<dbName>`  value: { [collectionName]: "table"|"graph"|"document" }

function colTypesKey(dbName: string) {
  return `uql-col-types-${dbName}`;
}

export function saveCollectionType(dbName: string, colName: string, type: 'table' | 'graph' | 'document') {
  try {
    const raw = localStorage.getItem(colTypesKey(dbName));
    const map: Record<string, string> = raw ? JSON.parse(raw) : {};
    map[colName] = type;
    localStorage.setItem(colTypesKey(dbName), JSON.stringify(map));
  } catch { /* non-fatal */ }
}

export function getCollectionType(dbName: string, colName: string): 'table' | 'graph' | 'document' | null {
  try {
    const raw = localStorage.getItem(colTypesKey(dbName));
    if (!raw) return null;
    const map: Record<string, string> = JSON.parse(raw);
    const v = map[colName];
    if (v === 'table' || v === 'graph' || v === 'document') return v;
  } catch { /* non-fatal */ }
  return null;
}

// ── Folder names per collection type ─────────────────────────────────────────
function folderForType(type: 'table' | 'graph' | 'document' | null): string {
  if (type === 'table') return 'Tables';
  if (type === 'graph') return 'Graphs';
  if (type === 'document') return 'Documents';
  return 'Tables'; // fallback
}

// ── File extension per collection type ────────────────────────────────────────
function extForType(type: 'table' | 'graph' | 'document' | null): string {
  if (type === 'table') return 'csv';
  if (type === 'graph') return 'json';
  if (type === 'document') return 'json';
  return 'csv';
}

// ── Convert records array to CSV string ───────────────────────────────────────
function toCsv(records: Record<string, unknown>[]): string {
  if (!records.length) return '';
  const headers = Array.from(new Set(records.flatMap(r => Object.keys(r))));
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  return [
    headers.join(','),
    ...records.map(r => headers.map(h => escape(r[h])).join(',')),
  ].join('\n');
}

// ── Write a file into a sub-directory of dirHandle ───────────────────────────
async function writeFile(
  dirHandle: FileSystemDirectoryHandle,
  subDirs: string[],
  filename: string,
  content: string,
): Promise<void> {
  let cur: FileSystemDirectoryHandle = dirHandle;
  for (const part of subDirs) {
    cur = await cur.getDirectoryHandle(part, { create: true });
  }
  const fh = await cur.getFileHandle(filename, { create: true });
  const writable = await fh.createWritable();
  await writable.write(content);
  await writable.close();
}

// ── Write collection data to the right subfolder ─────────────────────────────
// Tables  → <dbRoot>/Tables/<name>.csv
// Graphs  → <dbRoot>/Graphs/<name>.json
// Documents → <dbRoot>/Documents/<name>.json
export async function writeCollectionFile(
  dirHandle: FileSystemDirectoryHandle,
  dbName: string,
  colName: string,
  type: 'table' | 'graph' | 'document' | null,
  records: Record<string, unknown>[],
): Promise<void> {
  const folder = folderForType(type);
  const ext = extForType(type);
  let content: string;

  if (type === 'table') {
    content = toCsv(records);
  } else {
    content = JSON.stringify({ collection: colName, database: dbName, exportedAt: new Date().toISOString(), records }, null, 2);
  }

  await writeFile(dirHandle, [dbName, folder], `${colName}.${ext}`, content);
}

// ── Write query .uql file to database root folder ────────────────────────────
// <chosen-dir>/<dbName>/query.uql  (or custom filename)
export async function writeQueryFile(
  dirHandle: FileSystemDirectoryHandle,
  dbName: string,
  filename: string,
  content: string,
): Promise<void> {
  await writeFile(dirHandle, [dbName], filename, content);
}

// ── Write metadata.json to the database root ─────────────────────────────────
export async function writeMetadata(
  dirHandle: FileSystemDirectoryHandle,
  dbName: string,
): Promise<void> {
  const meta = {
    name: dbName,
    engine: 'UQL Studio',
    created: new Date().toISOString(),
    structure: {
      Tables: 'CSV files — one per TABLE collection',
      Graphs: 'JSON files — one per GRAPH collection',
      Documents: 'JSON files — one per DOCUMENT collection',
      'query.uql': 'Saved query files',
    },
  };
  await writeFile(dirHandle, [dbName], 'metadata.json', JSON.stringify(meta, null, 2));
}

// ── Parse UQL query to detect mutations ──────────────────────────────────────
// Returns { collection, db } for ADD/MODIFY/REMOVE, or null.
export function parseModifyTarget(query: string): { collection: string; db: string | null } | null {
  const q = query.trim();

  let m = q.match(/^ADD\s+(\w+)\s+VALUES/i);
  if (m) return { collection: m[1], db: q.match(/\bIN\s+(\w+)\s*$/i)?.[1] ?? null };

  m = q.match(/^MODIFY\s+(\w+)\s+SET/i);
  if (m) return { collection: m[1], db: q.match(/\bIN\s+(\w+)\s*$/i)?.[1] ?? null };

  m = q.match(/^REMOVE\s+(\w+)/i);
  if (m) return { collection: m[1], db: q.match(/\bIN\s+(\w+)\s*$/i)?.[1] ?? null };

  return null;
}

// ── Parse CREATE TABLE/GRAPH/DOCUMENT to detect new collection type ───────────
export function parseCreateCollection(query: string): { name: string; type: 'table' | 'graph' | 'document'; db: string | null } | null {
  const q = query.trim();

  let m = q.match(/^CREATE\s+TABLE\s+(\w+)/i);
  if (m) return { name: m[1], type: 'table', db: q.match(/\bIN\s+(\w+)\s*$/i)?.[1] ?? null };

  m = q.match(/^CREATE\s+GRAPH\s+(\w+)/i);
  if (m) return { name: m[1], type: 'graph', db: q.match(/\bIN\s+(\w+)\s*$/i)?.[1] ?? null };

  m = q.match(/^CREATE\s+DOCUMENT\s+(\w+)/i);
  if (m) return { name: m[1], type: 'document', db: q.match(/\bIN\s+(\w+)\s*$/i)?.[1] ?? null };

  return null;
}
