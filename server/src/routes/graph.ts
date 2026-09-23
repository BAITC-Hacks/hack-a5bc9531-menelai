import { Hono } from "hono";
import { edges, nodes } from "../data/load";
import { positions, results } from "../data/results";

// Nodes carry pipeline role/priority/cluster (null when out/ is missing) plus layout coordinates.
const payload = {
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

export default new Hono().get("/", (c) => c.json(payload));
