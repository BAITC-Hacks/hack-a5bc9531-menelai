import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadDataset, type Dataset } from "./dataset";

// Registry of loaded datasets; exactly one is active. Routes call current() per request.
export const DEMO_ID = "demo";
export const datasetsDir = process.env.DATASETS_DIR ?? resolve(import.meta.dir, "../../../data/datasets");

const registry = new Map<string, Dataset>();
let activeId = DEMO_ID;

export const current = () => registry.get(activeId)!;
export const get = (id: string) => registry.get(id);
export const list = () => [...registry.values()];
export const register = (d: Dataset) => void registry.set(d.id, d);
export const unregister = (id: string) => void registry.delete(id);

export function activate(id: string): boolean {
  if (!registry.has(id)) return false;
  activeId = id;
  return true;
}

/** Layout of an uploaded dataset on disk: <datasetsDir>/<id>/{raw,out,meta.json}. */
export const uploadPaths = (id: string) => {
  const dir = resolve(datasetsDir, id);
  return { dir, raw: resolve(dir, "raw"), out: resolve(dir, "out"), meta: resolve(dir, "meta.json") };
};

register(
  await loadDataset({
    id: DEMO_ID,
    name: "Демо: выгрузка организаторов",
    source: "bundled",
    createdAt: new Date().toISOString(),
    dataDir: process.env.DATA_DIR ?? resolve(import.meta.dir, "../../../task/data"),
    outDir: process.env.OUT_DIR ?? resolve(import.meta.dir, "../../../out"),
  }),
);

if (existsSync(datasetsDir)) {
  for (const id of readdirSync(datasetsDir)) {
    const p = uploadPaths(id);
    if (!existsSync(p.raw) || !existsSync(p.out) || !existsSync(p.meta)) continue;
    try {
      const { name, createdAt } = JSON.parse(readFileSync(p.meta, "utf8")) as { name: string; createdAt: string };
      register(await loadDataset({ id, name, source: "upload", createdAt, dataDir: p.raw, outDir: p.out }));
    } catch (e) {
      console.warn(`[store] пропущен набор ${id}: ${(e as Error).message}`);
    }
  }
}
