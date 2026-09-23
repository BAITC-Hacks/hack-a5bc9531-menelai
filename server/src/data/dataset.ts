import { buildAnalytics, type Analytics } from "./analytics";
import { readTables } from "./load";
import { layout, loadResults, type Results } from "./results";
import { buildTools, type Tools } from "./tools";
import type { Edge, GraphData, Node, Transaction } from "./types";

export type Dataset = {
  id: string;
  name: string;
  source: "bundled" | "upload";
  createdAt: string;
  dataDir: string;
  outDir: string;
  nodes: Node[];
  edges: Edge[];
  transactions: Transaction[];
  results: Results | null;
  positions: Record<string, [number, number]>;
  analytics: Analytics | null;
  tools: Tools;
  maxDepth: number;
  period: [string, string] | null;
  seeds: number;
  totalKzt: number;
  byDepth: number[];
  graph: ReturnType<typeof graphPayload>;
};

export type DatasetInfo = {
  id: string;
  name: string;
  source: "bundled" | "upload";
  createdAt: string;
  nodes: number;
  edges: number;
  transactions: number;
  seeds: number;
  maxDepth: number;
  period: [string, string] | null;
  roles: Record<string, number> | null;
};

// /api/graph payload: nodes carry pipeline role/priority/cluster (null when the pipeline output is missing) plus layout coordinates.
function graphPayload({ nodes, edges, results }: GraphData, positions: Record<string, [number, number]>) {
  return {
    nodes: nodes.map((n) => {
      const m = results?.metrics[n.gid];
      return {
        ...n,
        x: positions[n.gid][0],
        y: positions[n.gid][1],
        role: m?.role ?? null,
        priority: m?.priority_score ?? null,
        cluster: m?.cluster_id ?? null,
        inDeg: m?.in_deg ?? 0,
        outDeg: m?.out_deg ?? 0,
        inKzt: m?.in_kzt ?? 0,
        outKzt: m?.out_kzt ?? 0,
      };
    }),
    edges,
  };
}

type LoadArgs = Pick<Dataset, "id" | "name" | "source" | "createdAt" | "dataDir" | "outDir">;

/** Reads raw tables + pipeline output and precomputes layout, analytics and tool indexes (once per dataset). */
export async function loadDataset(a: LoadArgs): Promise<Dataset> {
  const t0 = performance.now();
  const { nodes, edges, transactions } = await readTables(a.dataDir);
  const results = loadResults(a.outDir);
  const data = { nodes, edges, transactions, results };
  const dates = transactions.map((t) => t.date).sort();
  const maxDepth = nodes.reduce((m, n) => Math.max(m, n.depth), 0);
  const positions = layout(nodes, edges);
  const ds: Dataset = {
    ...a,
    ...data,
    positions,
    analytics: buildAnalytics(data, maxDepth),
    tools: buildTools(data),
    maxDepth,
    period: dates.length ? [dates[0], dates.at(-1)!] : null,
    seeds: nodes.filter((n) => n.isSeed).length,
    totalKzt: edges.reduce((s, e) => s + e.sumKzt, 0),
    byDepth: Array.from({ length: maxDepth + 1 }, (_, k) => nodes.filter((n) => n.depth === k).length),
    graph: graphPayload(data, positions),
  };
  console.log(`[dataset] ${a.id}: ${nodes.length} узлов, ${edges.length} рёбер за ${Math.round(performance.now() - t0)} мс`);
  return ds;
}

export const info = (d: Dataset): DatasetInfo => ({
  id: d.id,
  name: d.name,
  source: d.source,
  createdAt: d.createdAt,
  nodes: d.nodes.length,
  edges: d.edges.length,
  transactions: d.transactions.length,
  seeds: d.seeds,
  maxDepth: d.maxDepth,
  period: d.period,
  roles: d.results?.meta.role_counts ?? null,
});
