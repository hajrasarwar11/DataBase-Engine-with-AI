/**
 * UQL Storage Engine — file-backed, in-memory store.
 * All data lives in .uql-data/store.json at the workspace root.
 * No external database required.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DatabaseRow = {
  id: number;
  name: string;
  type: string;
  description: string | null;
  createdAt: string;
};

export type CollectionRow = {
  id: number;
  databaseId: number;
  name: string;
  type: string;
  recordCount: number;
  schema: unknown;
  createdAt: string;
};

export type RecordRow = {
  id: number;
  collectionId: number;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type QueryHistoryRow = {
  id: number;
  query: string;
  databaseId: number | null;
  executedAt: string;
  executionTimeMs: string;
  success: boolean;
  rowCount: number | null;
  errorMessage: string | null;
};

export type ConversationRow = {
  id: number;
  title: string;
  createdAt: string;
};

export type MessageRow = {
  id: number;
  conversationId: number;
  role: string;
  content: string;
  createdAt: string;
};

type StoreData = {
  meta: { version: number };
  databases: Record<string, DatabaseRow>;
  collections: Record<string, CollectionRow>;
  records: Record<string, RecordRow>;
  queryHistory: Record<string, QueryHistoryRow>;
  conversations: Record<string, ConversationRow>;
  messages: Record<string, MessageRow>;
  sequences: {
    databases: number;
    collections: number;
    records: number;
    queryHistory: number;
    conversations: number;
    messages: number;
  };
};

// ─── Storage path ─────────────────────────────────────────────────────────────

const DATA_DIR = join(process.cwd(), ".uql-data");
const DATA_FILE = join(DATA_DIR, "store.json");

function freshStore(): StoreData {
  return {
    meta: { version: 1 },
    databases: {},
    collections: {},
    records: {},
    queryHistory: {},
    conversations: {},
    messages: {},
    sequences: {
      databases: 0,
      collections: 0,
      records: 0,
      queryHistory: 0,
      conversations: 0,
      messages: 0,
    },
  };
}

// ─── Store class ──────────────────────────────────────────────────────────────

class UQLStore {
  private data: StoreData;

  constructor() {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    if (existsSync(DATA_FILE)) {
      try {
        this.data = JSON.parse(readFileSync(DATA_FILE, "utf8")) as StoreData;
      } catch {
        console.warn("[UQLStore] Corrupt store file — starting fresh.");
        this.data = freshStore();
        this.persist();
      }
    } else {
      this.data = freshStore();
      this.persist();
    }
    console.log(`[UQLStore] Loaded from ${DATA_FILE}`);
  }

  private persist(): void {
    writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), "utf8");
  }

  private nextId(table: keyof StoreData["sequences"]): number {
    this.data.sequences[table]++;
    return this.data.sequences[table];
  }

  private now(): string {
    return new Date().toISOString();
  }

  // ── Databases ──────────────────────────────────────────────────────────────

  listDatabases(): DatabaseRow[] {
    return Object.values(this.data.databases).sort((a, b) => a.id - b.id);
  }

  createDatabase(values: {
    name: string;
    type: string;
    description?: string | null;
  }): DatabaseRow {
    const id = this.nextId("databases");
    const row: DatabaseRow = {
      id,
      name: values.name,
      type: values.type,
      description: values.description ?? null,
      createdAt: this.now(),
    };
    this.data.databases[id] = row;
    this.persist();
    return row;
  }

  getDatabase(id: number): DatabaseRow | null {
    return this.data.databases[id] ?? null;
  }

  getDatabaseByName(name: string): DatabaseRow | null {
    return (
      Object.values(this.data.databases).find(
        (d) => d.name.toLowerCase() === name.toLowerCase()
      ) ?? null
    );
  }

  deleteDatabase(id: number): DatabaseRow | null {
    const row = this.data.databases[id];
    if (!row) return null;
    const colIds = Object.values(this.data.collections)
      .filter((c) => c.databaseId === id)
      .map((c) => c.id);
    for (const cid of colIds) {
      for (const rid of Object.keys(this.data.records)) {
        if (this.data.records[rid].collectionId === cid) {
          delete this.data.records[rid];
        }
      }
      delete this.data.collections[cid];
    }
    delete this.data.databases[id];
    this.persist();
    return row;
  }

  countCollectionsForDatabase(databaseId: number): number {
    return Object.values(this.data.collections).filter(
      (c) => c.databaseId === databaseId
    ).length;
  }

  // ── Collections ────────────────────────────────────────────────────────────

  listCollections(databaseId: number): CollectionRow[] {
    return Object.values(this.data.collections)
      .filter((c) => c.databaseId === databaseId)
      .sort((a, b) => a.id - b.id);
  }

  createCollection(values: {
    databaseId: number;
    name: string;
    type: string;
    recordCount?: number;
  }): CollectionRow {
    const id = this.nextId("collections");
    const row: CollectionRow = {
      id,
      databaseId: values.databaseId,
      name: values.name,
      type: values.type,
      recordCount: values.recordCount ?? 0,
      schema: null,
      createdAt: this.now(),
    };
    this.data.collections[id] = row;
    this.persist();
    return row;
  }

  getCollection(id: number): CollectionRow | null {
    return this.data.collections[id] ?? null;
  }

  findCollectionsByName(databaseId: number, name: string): CollectionRow[] {
    return Object.values(this.data.collections).filter(
      (c) =>
        c.databaseId === databaseId &&
        c.name.toLowerCase() === name.toLowerCase()
    );
  }

  findCollectionByNameAndType(
    databaseId: number,
    name: string,
    type: string
  ): CollectionRow | null {
    return (
      Object.values(this.data.collections).find(
        (c) =>
          c.databaseId === databaseId &&
          c.name.toLowerCase() === name.toLowerCase() &&
          c.type === type
      ) ?? null
    );
  }

  dropCollection(id: number): CollectionRow | null {
    const row = this.data.collections[id];
    if (!row) return null;
    for (const rid of Object.keys(this.data.records)) {
      if (this.data.records[rid].collectionId === id) {
        delete this.data.records[rid];
      }
    }
    delete this.data.collections[id];
    this.persist();
    return row;
  }

  updateCollectionRecordCount(id: number, delta: number): void {
    const col = this.data.collections[id];
    if (col) {
      col.recordCount = Math.max(0, col.recordCount + delta);
      this.persist();
    }
  }

  // ── Records ────────────────────────────────────────────────────────────────

  listRecords(collectionId: number, limit?: number): RecordRow[] {
    const rows = Object.values(this.data.records)
      .filter((r) => r.collectionId === collectionId)
      .sort((a, b) => a.id - b.id);
    return limit ? rows.slice(0, limit) : rows;
  }

  insertRecord(values: {
    collectionId: number;
    data: Record<string, unknown>;
  }): RecordRow {
    const id = this.nextId("records");
    const now = this.now();
    const row: RecordRow = {
      id,
      collectionId: values.collectionId,
      data: values.data,
      createdAt: now,
      updatedAt: now,
    };
    this.data.records[id] = row;
    this.persist();
    return row;
  }

  updateRecord(
    id: number,
    data: Record<string, unknown>
  ): RecordRow | null {
    const row = this.data.records[id];
    if (!row) return null;
    row.data = data;
    row.updatedAt = this.now();
    this.persist();
    return row;
  }

  deleteRecord(id: number): RecordRow | null {
    const row = this.data.records[id];
    if (!row) return null;
    delete this.data.records[id];
    this.persist();
    return row;
  }

  findRecordByNameInCollection(
    collectionId: number,
    name: string
  ): RecordRow | null {
    return (
      Object.values(this.data.records).find(
        (r) =>
          r.collectionId === collectionId &&
          String((r.data as Record<string, unknown>)?.name ?? "").toLowerCase() ===
            name.toLowerCase()
      ) ?? null
    );
  }

  // ── Query History ──────────────────────────────────────────────────────────

  insertQueryHistory(values: {
    query: string;
    databaseId?: number | null;
    executionTimeMs: string;
    success: boolean;
    rowCount?: number | null;
    errorMessage?: string | null;
  }): QueryHistoryRow {
    const id = this.nextId("queryHistory");
    const row: QueryHistoryRow = {
      id,
      query: values.query,
      databaseId: values.databaseId ?? null,
      executedAt: this.now(),
      executionTimeMs: values.executionTimeMs,
      success: values.success,
      rowCount: values.rowCount ?? null,
      errorMessage: values.errorMessage ?? null,
    };
    this.data.queryHistory[id] = row;
    this.persist();
    return row;
  }

  listQueryHistory(limit: number): QueryHistoryRow[] {
    return Object.values(this.data.queryHistory)
      .sort(
        (a, b) =>
          new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime()
      )
      .slice(0, limit);
  }

  // ── Conversations ──────────────────────────────────────────────────────────

  listConversations(): ConversationRow[] {
    return Object.values(this.data.conversations).sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  createConversation(title: string): ConversationRow {
    const id = this.nextId("conversations");
    const row: ConversationRow = { id, title, createdAt: this.now() };
    this.data.conversations[id] = row;
    this.persist();
    return row;
  }

  getConversation(id: number): ConversationRow | null {
    return this.data.conversations[id] ?? null;
  }

  updateConversationTitle(id: number, title: string): ConversationRow | null {
    const row = this.data.conversations[id];
    if (!row) return null;
    row.title = title;
    this.persist();
    return row;
  }

  deleteConversation(id: number): ConversationRow | null {
    const row = this.data.conversations[id];
    if (!row) return null;
    for (const mid of Object.keys(this.data.messages)) {
      if (this.data.messages[mid].conversationId === id) {
        delete this.data.messages[mid];
      }
    }
    delete this.data.conversations[id];
    this.persist();
    return row;
  }

  // ── Messages ───────────────────────────────────────────────────────────────

  listMessages(conversationId: number): MessageRow[] {
    return Object.values(this.data.messages)
      .filter((m) => m.conversationId === conversationId)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
  }

  insertMessage(values: {
    conversationId: number;
    role: string;
    content: string;
  }): MessageRow {
    const id = this.nextId("messages");
    const row: MessageRow = {
      id,
      conversationId: values.conversationId,
      role: values.role,
      content: values.content,
      createdAt: this.now(),
    };
    this.data.messages[id] = row;
    this.persist();
    return row;
  }
}

export const store = new UQLStore();
