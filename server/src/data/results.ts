import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import { edges, nodes } from "./load";

// Pipeline output (pipeline/run.py → out/). The server only displays it, never recomputes roles.
export const outDir = process.env.OUT_DIR ?? resolve(import.meta.dir, "../../../out");

export type Link = { gid: string; sum_kzt: number; n_tx: number };
export type Metrics = {
  in_deg: number; out_deg: number; in_kzt: number; out_kzt: number; in_tx: number; out_tx: number;
  pass_through: number | null; seed_share: number; seed_money_in: number; n_seed_upstream: number;
  betweenness: number; pagerank: number; in_cycle: boolean; fast_out_share: number | null;
  sync_in_events: number; truncated: boolean; depth: number; is_seed: boolean;
  role: string; role_score: number; priority_score: number; cluster_id: number; evidence: string;
  cycles: string[][]; sync_days: string[]; top_in: Link[]; top_out: Link[];
};
export type Meta = {
  rules: string;
  thresholds: Record<string, number>;
  role_weight: Record<string, number>;
  role_counts: Record<string, number>;
  [k: string]: unknown;
};

// Minimal RFC 4180 reader: evidence/hypothesis fields contain commas and quotes.
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

function loadResults() {
  const files = ["node_metrics.json", "clusters.csv", "top_nodes.csv"].map((f) => resolve(outDir, f));
  const missing = files.filter((f) => !existsSync(f));
  if (missing.length) {
    console.warn(`[results] нет выгрузки пайплайна (${missing.join(", ")}); маршруты ролей вернут 503`);
    return null;
  }
  const { _meta, ...metrics } = JSON.parse(readFileSync(files[0], "utf8")) as Record<string, Metrics> & { _meta: Meta };
  const clusters = parseCsv(readFileSync(files[1], "utf8")).map((r) => ({
    clusterId: Number(r.cluster_id),
    nNodes: Number(r.n_nodes),
    nSeed: Number(r.n_seed),
    sumKztInternal: Number(r.sum_kzt_internal),
    topGids: r.top_gids ? r.top_gids.split(";") : [],
    hypothesis: r.hypothesis,
  }));
  const top = parseCsv(readFileSync(files[2], "utf8")).map((r) => ({
    rank: Number(r.rank),
    gid: r.gid,
    role: r.role,
    priorityScore: Number(r.priority_score),
    why: r.why,
  }));
  return { metrics: metrics as Record<string, Metrics>, meta: _meta, clusters, top };
}

export const results = loadResults();

// Force layout computed once at startup; d3-force is deterministic (fixed LCG), so positions are stable.
// ponytail: ~1 s for 2 248 nodes; at ~1M nodes precompute offline (e.g. in the pipeline) instead.
function layout(): Record<string, [number, number]> {
  const sim = nodes.map((n) => ({ gid: n.gid })) as { gid: string; x?: number; y?: number }[];
  const links = edges.map((e) => ({ source: e.src, target: e.dst }));
  forceSimulation(sim)
    .force("link", forceLink(links).id((d: any) => d.gid).distance(14).strength(0.6))
    .force("charge", forceManyBody().strength(-16).distanceMax(260))
    .force("x", forceX().strength(0.045))
    .force("y", forceY().strength(0.045))
    .stop()
    .tick(320);
  return Object.fromEntries(sim.map((n) => [n.gid, [Math.round(n.x! * 10) / 10, Math.round(n.y! * 10) / 10]]));
}

export const positions = layout();
