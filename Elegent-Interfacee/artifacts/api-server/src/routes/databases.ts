import { Router, type IRouter } from "express";
import { engineCmd } from "../engine/client";
import { getOrAssignId, nameById, loadIdMap, saveIdMap } from "../engine/id-map";

const router: IRouter = Router();

router.get("/databases", async (_req, res) => {
  try {
    const r = await engineCmd({ cmd: "LIST_DBS" }) as { databases: string[] };
    const result = await Promise.all(r.databases.map(async (name) => {
      const id = getOrAssignId(name);
      const cols = await engineCmd({ cmd: "LIST_COLS", db: name }) as { collections: unknown[] };
      return { id, name, collectionCount: cols.collections.length, type: "multi-model" };
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/databases", async (req, res) => {
  try {
    const { name } = req.body as { name?: string };
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "name is required" }); return;
    }
    await engineCmd({ cmd: "CREATE_DB", name: name.trim() });
    const id = getOrAssignId(name.trim());
    res.status(201).json({ id, name: name.trim(), collectionCount: 0, type: "multi-model" });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

router.get("/databases/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = nameById(id);
    if (!name) { res.status(404).json({ error: "Database not found" }); return; }
    const cols = await engineCmd({ cmd: "LIST_COLS", db: name }) as { collections: unknown[] };
    res.json({ id, name, collectionCount: cols.collections.length, type: "multi-model" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.delete("/databases/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = nameById(id);
    if (!name) { res.status(404).json({ error: "Database not found" }); return; }
    await engineCmd({ cmd: "DROP_DB", name });
    const map = loadIdMap();
    delete map[name];
    saveIdMap(map);
    res.json({ message: `Database "${name}" deleted` });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/databases/:id/collections", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = nameById(id);
    if (!name) { res.status(404).json({ error: "Database not found" }); return; }
    const r = await engineCmd({ cmd: "LIST_COLS", db: name }) as {
      collections: Array<{ name: string; type: string; count: number; schema: unknown[]; indexes: string[] }>;
    };
    const result = r.collections.map((c, i) => ({
      id: id * 1000 + i + 1,
      databaseId: id,
      name: c.name,
      type: c.type,
      recordCount: c.count,
      schema: c.schema,
      indexes: c.indexes ?? [],
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
