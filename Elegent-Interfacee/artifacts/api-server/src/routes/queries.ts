import { Router, type IRouter } from "express";
import { parse } from "../engine/parser";
import { execute } from "../engine/executor";
import { engineCmd } from "../engine/client";
import { nameById } from "../engine/id-map";


const router = Router();
// List query history (dummy implementation, replace with real logic if needed)
router.get("/history", async (req, res) => {
  // Return an empty array or your actual query history
  res.json([]);
});

// Session-scoped active transaction ID — single-server, single-process model.
// BEGIN sets it; COMMIT/ROLLBACK clears it.
let activeTxnId: number | null = null;

// ── Execute UQL query ─────────────────────────────────────────────────────────
// Alias for /queries/execute to match frontend expectation
router.post("/execute", async (req, res, next) => {
  // Forward to the same handler as /query
  req.url = "/query";
  next();
});

router.post("/query", async (req, res) => {
  try {
    const { query, databaseId } = req.body as { query?: string; databaseId?: number };

    if (!query || typeof query !== "string") {
      res.status(400).json({ error: "query is required" }); return;
    }

    // Strip comment lines before parsing
    const stripped = query
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .trim();

    if (!stripped) {
      res.json({ success: true, data: [], columns: [], rowCount: 0, executionTimeMs: 0 });
      return;
    }

    // Resolve database name from ID
    const activeDatabaseName = databaseId ? nameById(databaseId) ?? undefined : undefined;

    // Parse + execute multiple statements (split by ';')
    const statements = stripped.split(";").map(s => s.trim()).filter(Boolean);
    let lastResult = null;
    for (const stmt of statements) {
      const ast = parse(stmt);

      // Inject active txn_id into COMMIT / ROLLBACK ASTs
      if ((ast.type === "COMMIT" || ast.type === "ROLLBACK") && activeTxnId !== null) {
        (ast as any).txn = activeTxnId;
      }

      const result = await execute(ast, { activeDatabaseName, activeTxnId: activeTxnId ?? undefined });

      if (!result.success) {
        // If commit/rollback fails, still clear the txn state
        if (ast.type === "COMMIT" || ast.type === "ROLLBACK") activeTxnId = null;
        res.status(400).json({
          success: false,
          error: result.error,
          executionTimeMs: result.executionTimeMs,
        });
        return;
      }

      // Track transaction ID from BEGIN
      if (ast.type === "BEGIN" && result.txnId) {
        activeTxnId = result.txnId;
      }
      // Clear on COMMIT / ROLLBACK
      if (ast.type === "COMMIT" || ast.type === "ROLLBACK") {
        activeTxnId = null;
      }

      lastResult = result;
    }

    if (!lastResult) {
      res.json({ success: true, data: [], columns: [], rowCount: 0, executionTimeMs: 0 });
      return;
    }

    // Normalize rows into column-based grid format
    const rows = lastResult.rows ?? [];
    const flatRows = rows.map((r) => {
      if (typeof r === "object" && r !== null) return r as Record<string, unknown>;
      return { value: r };
    });
    const columns: string[] =
      flatRows.length > 0
        ? [...new Set(flatRows.flatMap((r) => Object.keys(r)))]
        : ["message"];

    // Convert rowCount to total records
    const rowCount = lastResult.rowCount ?? lastResult.affectedCount ?? flatRows.length;

    res.json({
      success: true,
      message: lastResult.message,
      data: flatRows,
      columns,
      rowCount,
      queryType: "multi-model",
      executionTimeMs: lastResult.executionTimeMs,
      plan: lastResult.plan,
      graphData: lastResult.graphData ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ success: false, error: msg });
  }
});

// ── List collections for a database (by name) ─────────────────────────────────
router.get("/collections/:dbName", async (req, res) => {
  try {
    const r = await engineCmd({ cmd: "LIST_COLS", db: req.params.dbName }) as {
      collections: Array<{ name: string; type: string; count: number; schema: unknown[] }>;
    };
    res.json(r.collections);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
