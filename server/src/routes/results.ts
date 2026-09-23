import { Hono } from "hono";
import { resolve } from "node:path";
import { outDir, results } from "../data/results";

const NO_RESULTS = { error: "нет выгрузки пайплайна: запустите pipeline/run.py (см. README)" };
const CSV = ["nodes_roles.csv", "clusters.csv", "top_nodes.csv"];

// Pipeline outputs: top list, clusters, thresholds and the three CSV files as downloads.
export default new Hono()
  .get("/top", (c) => {
    if (!results) return c.json(NO_RESULTS, 503);
    const { top, metrics } = results;
    return c.json(
      top.map((t) => {
        const m = metrics[t.gid];
        return { ...t, roleScore: m.role_score, clusterId: m.cluster_id, isSeed: m.is_seed, depth: m.depth, inKzt: m.in_kzt, outKzt: m.out_kzt, evidence: m.evidence };
      }),
    );
  })
  .get("/clusters", (c) => {
    if (!results) return c.json(NO_RESULTS, 503);
    const roles: Record<number, Record<string, number>> = {};
    for (const m of Object.values(results.metrics)) {
      const r = (roles[m.cluster_id] ??= {});
      r[m.role] = (r[m.role] ?? 0) + 1;
    }
    return c.json(results.clusters.map((cl) => ({ ...cl, roles: roles[cl.clusterId] ?? {} })));
  })
  .get("/meta", (c) => (results ? c.json(results.meta) : c.json(NO_RESULTS, 503)))
  .get("/export/:file", (c) => {
    const file = c.req.param("file");
    if (!CSV.includes(file)) return c.json({ error: `unknown file ${file}` }, 404);
    if (!results) return c.json(NO_RESULTS, 503);
    return new Response(Bun.file(resolve(outDir, file)), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file}"` },
    });
  });
