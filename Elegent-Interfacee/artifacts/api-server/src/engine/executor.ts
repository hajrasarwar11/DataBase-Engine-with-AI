// Query executor: takes AST + active DB context → calls C++ engine via TCP
import { engineCmd } from "./client";
import type { AST } from "./parser";

export interface ExecContext {
  activeDatabaseId?: number;
  activeDatabaseName?: string;
  activeTxnId?: number;
}

export interface PlanNote {
  strategy: "INDEX_LOOKUP" | "SECONDARY_INDEX_LOOKUP" | "SECONDARY_INDEX_RANGE_SCAN" |
            "FULL_SCAN" | "BFS_TRAVERSAL" | "DDL" | "DML" |
            "NESTED_LOOP_JOIN" | "AGGREGATE" | "EXPLAIN";
  detail: string;
}

export interface ExecResult {
  success: boolean;
  rows?: unknown[];
  rowCount?: number;
  affectedCount?: number;
  message?: string;
  error?: string;
  executionTimeMs: number;
  plan?: PlanNote;
  graphData?: { nodes: unknown[]; edges: unknown[] };
  txnId?: number;
}

function resolveDb(ast: { db?: string | null }, ctx: ExecContext): string {
  const d = ast.db || ctx.activeDatabaseName;
  if (!d) throw new Error("No database selected. Use IN <dbname> or select one in the toolbar.");
  return d;
}

// Deep-select a nested field value (supports "user.name" dot notation)
function getField(obj: Record<string, unknown>, field: string): unknown {
  const parts = field.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export async function execute(ast: AST, ctx: ExecContext): Promise<ExecResult> {
  const t0 = Date.now();
  const ms = () => Date.now() - t0;

  try {
    // ── EXPLAIN ────────────────────────────────────────────────────────────
    if (ast.type === "EXPLAIN") {
      const inner = await execute(ast.inner, ctx);
      const planDetail = inner.plan
        ? `Strategy: ${inner.plan.strategy} | ${inner.plan.detail}`
        : "No plan available";
      return {
        success: true,
        rows: inner.rows,
        rowCount: inner.rowCount,
        executionTimeMs: ms(),
        message: `EXPLAIN: ${planDetail}`,
        plan: { strategy: "EXPLAIN", detail: planDetail },
      };
    }

    // ── SHOW STATS ─────────────────────────────────────────────────────────
    if (ast.type === "SHOW_STATS") {
      const r = await engineCmd({ cmd: "STATS" }) as {
        databases: Array<{
          name: string;
          collections: Array<{
            name: string; type: string; record_count: number;
            page_count: number; next_id: number;
            cache_hits: number; cache_misses: number; cache_hit_rate: number;
            secondary_indexes: string[];
          }>;
        }>;
        total_records: number;
      };

      // Flatten into display rows
      const rows: unknown[] = [];
      for (const db of r.databases) {
        if (ast.db && db.name !== ast.db) continue;
        for (const col of db.collections) {
          rows.push({
            database: db.name,
            collection: col.name,
            type: col.type,
            records: col.record_count,
            pages: col.page_count,
            cache_hit_rate: `${col.cache_hit_rate}%`,
            secondary_indexes: col.secondary_indexes.join(", ") || "—",
          });
        }
      }
      return {
        success: true, rows, rowCount: rows.length, executionTimeMs: ms(),
        plan: { strategy: "DML", detail: `Engine statistics — ${r.total_records} total records across all collections` },
      };
    }

    // ── SHOW INDEXES ───────────────────────────────────────────────────────
    if (ast.type === "SHOW_INDEXES") {
      const db = resolveDb(ast, ctx);
      const r = await engineCmd({ cmd: "LIST_INDEXES", db, col: ast.col }) as {
        indexes: Array<{ field: string; unique_values: number; total_entries: number }>;
      };
      const rows = r.indexes.map(ix => ({
        field: ix.field,
        unique_values: ix.unique_values,
        total_entries: ix.total_entries,
        type: "B+ Tree (secondary)",
      }));
      return {
        success: true, rows, rowCount: rows.length, executionTimeMs: ms(),
        plan: { strategy: "DML", detail: `List secondary indexes on '${ast.col}'` },
      };
    }

    // ── CREATE INDEX ───────────────────────────────────────────────────────
    if (ast.type === "CREATE_INDEX") {
      const db = resolveDb(ast, ctx);
      const r = await engineCmd({ cmd: "CREATE_INDEX", db, col: ast.col, field: ast.field }) as { entries: number };
      return {
        success: true,
        message: `Secondary B+ Tree index created on '${ast.col}.${ast.field}' — ${r.entries} entries indexed`,
        executionTimeMs: ms(),
        plan: { strategy: "DDL", detail: `Build secondary index on field '${ast.field}', scan all existing records` },
      };
    }

    // ── DROP INDEX ─────────────────────────────────────────────────────────
    if (ast.type === "DROP_INDEX") {
      const db = resolveDb(ast, ctx);
      await engineCmd({ cmd: "DROP_INDEX", db, col: ast.col, field: ast.field });
      return {
        success: true,
        message: `Index on '${ast.col}.${ast.field}' dropped`,
        executionTimeMs: ms(),
        plan: { strategy: "DDL", detail: `Drop secondary index file for field '${ast.field}'` },
      };
    }

    // ── DDL ────────────────────────────────────────────────────────────────
    if (ast.type === "CREATE_DB") {
      await engineCmd({ cmd: "CREATE_DB", name: ast.name });
      return { success: true, message: `Database '${ast.name}' created`, executionTimeMs: ms(),
               plan: { strategy: "DDL", detail: "Create database directory + WAL" } };
    }
    if (ast.type === "DROP_DB") {
      await engineCmd({ cmd: "DROP_DB", name: ast.name });
      return { success: true, message: `Database '${ast.name}' dropped`, executionTimeMs: ms(),
               plan: { strategy: "DDL", detail: "Remove all pages + WAL for database" } };
    }
    if (ast.type === "CREATE_COL") {
      const db = (ast.db || ctx.activeDatabaseName)!;
      if (!db) throw new Error("Specify IN <database> or select a database.");
      await engineCmd({ cmd: "CREATE_COL", db, name: ast.name, type: ast.colType, schema: ast.schema });
      return { success: true, message: `${ast.colType} '${ast.name}' created in '${db}'`, executionTimeMs: ms(),
               plan: { strategy: "DDL", detail: "Allocate page file + header page" } };
    }
    if (ast.type === "DROP_COL") {
      const db = resolveDb(ast, ctx);
      await engineCmd({ cmd: "DROP_COL", db, name: ast.name });
      return { success: true, message: `Collection '${ast.name}' dropped`, executionTimeMs: ms(),
               plan: { strategy: "DDL", detail: "Delete page file + secondary index files" } };
    }

    // ── Transactions ───────────────────────────────────────────────────────
    if (ast.type === "BEGIN") {
      const r = await engineCmd({ cmd: "BEGIN" }) as { txn_id: number };
      return { success: true, message: `Transaction ${r.txn_id} started`, txnId: r.txn_id, executionTimeMs: ms(),
               plan: { strategy: "DML", detail: "BEGIN — WAL transaction open" } };
    }
    if (ast.type === "COMMIT") {
      await engineCmd({ cmd: "COMMIT", txn: ast.txn ?? 0 });
      return { success: true, message: "Transaction committed", executionTimeMs: ms(),
               plan: { strategy: "DML", detail: "COMMIT — WAL entries flushed to disk" } };
    }
    if (ast.type === "ROLLBACK") {
      await engineCmd({ cmd: "ROLLBACK", txn: ast.txn ?? 0 });
      return { success: true, message: "Transaction rolled back", executionTimeMs: ms(),
               plan: { strategy: "DML", detail: "ROLLBACK — undo log applied, before-images restored" } };
    }

    // ── FIND ───────────────────────────────────────────────────────────────
    if (ast.type === "FIND") {
      const db = resolveDb(ast, ctx);

      // Query planner annotation
      const hasIdEq = ast.where && "id" in ast.where && typeof (ast.where as Record<string,unknown>)["id"] === "number";
      let planStrategy: PlanNote["strategy"] = "FULL_SCAN";
      let planDetail = ast.where ? "Sequential scan + filter via B+ Tree leaf chain" : "Full sequential scan of all records";

      if (hasIdEq) {
        planStrategy = "INDEX_LOOKUP";
        planDetail = `B+ Tree primary key lookup on id=${(ast.where as Record<string,unknown>)["id"]}`;
      } else if (ast.where) {
        // Check if any WHERE field might have a secondary index (heuristic — engine resolves)
        planDetail = "Query planner: secondary index probe, fallback to sequential scan";
      }
      if (ast.orderBy)   planDetail += ` | ORDER BY ${ast.orderBy} ${ast.orderAsc ? "ASC" : "DESC"}`;
      if (ast.groupBy)   planDetail += ` | GROUP BY ${ast.groupBy}`;
      if (ast.aggFunc)   planDetail += ` | AGGREGATE ${ast.aggFunc}(${ast.aggField})`;
      if (ast.join)      planDetail += ` | NESTED LOOP JOIN ${ast.join.collection}`;

      const r = await engineCmd({
        cmd: "FIND", db, col: ast.target,
        where:      ast.where ?? null,
        limit:      ast.limit ?? 1000,
        order_by:   ast.orderBy ?? "",
        order_asc:  ast.orderAsc,
        group_by:   ast.groupBy && ast.groupBy !== "__all__" ? ast.groupBy : "",
        agg_func:   ast.aggFunc ?? "",
        agg_field:  ast.aggField ?? "",
      }) as { rows: unknown[]; count: number; plan?: string };

      if (r.plan) {
        planStrategy = (r.plan as PlanNote["strategy"]) ?? planStrategy;
      }

      let rows = r.rows;

      // ── JOIN (nested loop at TypeScript level) ───────────────────────────
      if (ast.join) {
        planStrategy = "NESTED_LOOP_JOIN";
        const jr = await engineCmd({
          cmd: "FIND", db, col: ast.join.collection,
          where: null, limit: 10000,
        }) as { rows: unknown[] };

        const joinMap = new Map<unknown, unknown[]>();
        for (const jrow of jr.rows) {
          const key = getField(jrow as Record<string, unknown>, ast.join.foreignField);
          if (!joinMap.has(key)) joinMap.set(key, []);
          joinMap.get(key)!.push(jrow);
        }

        const joined: unknown[] = [];
        for (const row of rows) {
          const key = getField(row as Record<string, unknown>, ast.join.localField);
          const matches = joinMap.get(key) ?? [];
          if (matches.length === 0) {
            // Left outer join — include row even with no match
            joined.push(row);
          }
          for (const jrow of matches) {
            // Merge: right-side fields prefixed with join collection name
            const merged: Record<string, unknown> = { ...(row as Record<string, unknown>) };
            for (const [k, v] of Object.entries(jrow as Record<string, unknown>)) {
              merged[`${ast.join.collection}.${k}`] = v;
            }
            joined.push(merged);
          }
        }
        rows = joined;
      }

      // ── Whole-collection aggregate (no group_by) ─────────────────────────
      if (ast.aggFunc && (!ast.groupBy || ast.groupBy === "__all__") && !r.plan?.includes("grouped")) {
        planStrategy = "AGGREGATE";
        const func = ast.aggFunc;
        const field = ast.aggField ?? "";
        let result: unknown;
        if (func === "COUNT") {
          result = rows.length;
        } else {
          const nums = rows
            .map(r => (r as Record<string, unknown>)[field])
            .filter(v => typeof v === "number") as number[];
          if (func === "SUM")  result = nums.reduce((a, b) => a + b, 0);
          else if (func === "AVG") result = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
          else if (func === "MIN") result = nums.length ? Math.min(...nums) : null;
          else if (func === "MAX") result = nums.length ? Math.max(...nums) : null;
        }
        const aggRow = { [`${func}(${field || "*"})`]: result };
        return {
          success: true, rows: [aggRow], rowCount: 1, executionTimeMs: ms(),
          plan: { strategy: "AGGREGATE", detail: `${func}(${field || "*"}) over ${r.count} records` },
        };
      }

      return {
        success: true, rows, rowCount: (rows as unknown[]).length, executionTimeMs: ms(),
        plan: { strategy: planStrategy, detail: planDetail },
      };
    }

    // ── ADD ────────────────────────────────────────────────────────────────
    if (ast.type === "ADD") {
      const db = resolveDb(ast, ctx);
      const r = await engineCmd({ cmd: "INSERT", db, col: ast.target, data: ast.values, txn: ctx.activeTxnId ?? 0 }) as { id: number };
      return {
        success: true, affectedCount: 1, message: `Record inserted with id=${r.id}`, executionTimeMs: ms(),
        plan: { strategy: "DML", detail: "Slot insertion on data page + B+ Tree primary index update + secondary indexes update + WAL append" },
      };
    }

    // ── MODIFY ─────────────────────────────────────────────────────────────
    if (ast.type === "MODIFY") {
      const db = resolveDb(ast, ctx);
      const r = await engineCmd({ cmd: "MODIFY", db, col: ast.target, where: ast.where ?? null, set: ast.set, txn: ctx.activeTxnId ?? 0 }) as { updated: number };
      return {
        success: true, affectedCount: r.updated, message: `${r.updated} record(s) updated`, executionTimeMs: ms(),
        plan: { strategy: "DML", detail: "In-place page update (or slot move) + secondary index update + WAL append" },
      };
    }

    // ── REMOVE ─────────────────────────────────────────────────────────────
    if (ast.type === "REMOVE") {
      const db = resolveDb(ast, ctx);
      const r = await engineCmd({ cmd: "REMOVE", db, col: ast.target, where: ast.where ?? null, txn: ctx.activeTxnId ?? 0 }) as { deleted: number };
      return {
        success: true, affectedCount: r.deleted, message: `${r.deleted} record(s) deleted`, executionTimeMs: ms(),
        plan: { strategy: "DML", detail: "Tombstone slot + B+ Tree removal + secondary index removal + WAL append" },
      };
    }

    // ── FIND PATH ──────────────────────────────────────────────────────────
    if (ast.type === "FIND_PATH") {
      const db = resolveDb(ast, ctx);
      const r = await engineCmd({
        cmd: "FIND_PATH", db, col: ast.from.name,
        from: ast.from.id, to: ast.to.id,
      }) as { path: unknown[]; length: number; nodes?: unknown[]; edges?: unknown[] };

      // Derive graph visualization data: edges are path records, nodes synthesized from from/to IDs
      const edgeRecords = (r.edges ?? r.path ?? []) as Record<string,unknown>[];
      let graphNodes: unknown[] = r.nodes ?? [];

      if (graphNodes.length === 0 && edgeRecords.length > 0) {
        const nodeMap = new Map<number, Record<string,unknown>>();
        for (const edge of edgeRecords) {
          const fromId = edge.from as number;
          const toId   = edge.to   as number;
          if (fromId !== undefined && !nodeMap.has(fromId)) nodeMap.set(fromId, { id: fromId });
          if (toId   !== undefined && !nodeMap.has(toId))   nodeMap.set(toId,   { id: toId });
        }
        graphNodes = Array.from(nodeMap.values());
      }

      return {
        success: true, rows: r.path, rowCount: r.length, executionTimeMs: ms(),
        plan: { strategy: "BFS_TRAVERSAL", detail: `BFS from node(${ast.from.id}) to node(${ast.to.id}) — all graph edges traversed` },
        graphData: { nodes: graphNodes, edges: edgeRecords },
      };
    }

    throw new Error(`Unhandled AST type: ${(ast as {type:string}).type}`);

  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err), executionTimeMs: ms() };
  }
}
