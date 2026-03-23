import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const ID_MAP_PATH = join(process.cwd(), ".uql-data", "db-ids.json");

export function loadIdMap(): Record<string, number> {
  try {
    if (existsSync(ID_MAP_PATH)) return JSON.parse(readFileSync(ID_MAP_PATH, "utf8"));
  } catch {}
  return {};
}

export function saveIdMap(map: Record<string, number>) {
  mkdirSync(join(process.cwd(), ".uql-data"), { recursive: true });
  writeFileSync(ID_MAP_PATH, JSON.stringify(map, null, 2));
}

export function getOrAssignId(name: string): number {
  const map = loadIdMap();
  if (map[name] !== undefined) return map[name];
  const newId = Math.max(0, ...Object.values(map)) + 1;
  map[name] = newId;
  saveIdMap(map);
  return newId;
}

export function nameById(id: number): string | null {
  const map = loadIdMap();
  for (const [name, nid] of Object.entries(map)) if (nid === id) return name;
  return null;
}
