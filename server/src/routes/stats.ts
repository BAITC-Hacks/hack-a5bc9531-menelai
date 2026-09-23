import { Hono } from "hono";
import { edges, nodes, transactions } from "../data/load";

export default new Hono().get("/", (c) =>
  c.json({
    nodes: nodes.length,
    edges: edges.length,
    transactions: transactions.length,
    seeds: nodes.filter((n) => n.isSeed).length,
    totalKzt: edges.reduce((s, e) => s + e.sumKzt, 0),
  }),
);
