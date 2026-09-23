import { resolve } from "node:path";
import { nodes } from "./load";
import type { Cluster, EdgeMetrics, GraphNode, NodeMetrics, NodeRole, TopNode } from "./types";

const outDir = process.env.OUT_DIR ?? resolve(import.meta.dir, "../../../out");

// Columns kept as strings; everything else is numeric unless listed in BOOL. gids must never go through Number().
const STR = new Set(["gid", "src", "dst", "role", "evidence", "role_rule", "why", "hypothesis", "top_gids", "first_date", "last_date"]);
const BOOL = new Set(["is_seed", "truncated_by_depth", "real_sink", "no_edges", "in_cycle", "mutual", "back_edge"]);

// Minimal RFC 4180 parser: quoted fields, doubled quotes, newlines inside quotes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += ch;
  }
  if (field !== "" || row.length) row.push(field), rows.push(row);
  return rows;
}

const camel = (s: string) => s.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());

function convert(col: string, v: string): unknown {
  if (STR.has(col)) return v;
  if (BOOL.has(col)) return v === "true";
  return v === "" ? null : Number(v);
}

async function read<T>(name: string): Promise<T[]> {
  const file = Bun.file(resolve(outDir, `${name}.csv`));
  if (!(await file.exists()))
    throw new Error(`${file.name} not found. Run: python3 pipeline/run.py --data task/data --out out`);
  const [header, ...rows] = parseCsv(await file.text());
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [camel(h), convert(h, r[i] ?? "")])) as T);
}

export const nodeRoles = await read<NodeRole>("nodes_roles");
export const nodeMetrics = await read<NodeMetrics>("node_metrics");
export const topNodes = await read<TopNode>("top_nodes");
export const edgeMetrics = await read<EdgeMetrics>("edge_metrics");
export const clusters = (await read<Omit<Cluster, "topGids"> & { topGids: string }>("clusters")).map((c) => ({
  ...c,
  topGids: c.topGids ? c.topGids.split(";") : [],
})) as Cluster[];

export const roleByGid = new Map(nodeRoles.map((r) => [r.gid, r]));
export const metricsByGid = new Map(nodeMetrics.map((m) => [m.gid, m]));
export const clusterById = new Map(clusters.map((c) => [c.clusterId, c]));

export const graphNodes: GraphNode[] = nodes.map((n) => {
  const r = roleByGid.get(n.gid);
  const m = metricsByGid.get(n.gid);
  if (!r || !m) throw new Error(`gid ${n.gid} missing from out/nodes_roles.csv or out/node_metrics.csv`);
  return {
    ...n,
    role: r.role,
    roleScore: r.roleScore,
    clusterId: r.clusterId,
    priorityScore: r.priorityScore,
    inKzt: m.inKzt,
    outKzt: m.outKzt,
    inDeg: m.inDeg,
    outDeg: m.outDeg,
  };
});
export const graphNodeByGid = new Map(graphNodes.map((n) => [n.gid, n]));
