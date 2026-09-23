import { Hono } from "hono";
import { edges, nodes, transactions } from "../data/load";
import { results } from "../data/results";

const dates = transactions.map((t) => t.date).sort();

export default new Hono().get("/", (c) =>
  c.json({
    nodes: nodes.length,
    edges: edges.length,
    transactions: transactions.length,
    seeds: nodes.filter((n) => n.isSeed).length,
    totalKzt: edges.reduce((s, e) => s + e.sumKzt, 0),
    period: [dates[0], dates.at(-1)],
    byDepth: [0, 1, 2, 3, 4].map((d) => nodes.filter((n) => n.depth === d).length),
    roles: results?.meta.role_counts ?? null,
    clusters: results?.clusters.length ?? null,
  }),
);
