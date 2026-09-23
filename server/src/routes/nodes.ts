import { Hono } from "hono";
import { current } from "../data/store";

export default new Hono().get("/:gid", (c) => {
  const { nodes, edges, results } = current();
  const gid = c.req.param("gid");
  const node = nodes.find((n) => n.gid === gid);
  if (!node) return c.json({ error: `unknown gid ${gid}` }, 404);
  return c.json({
    node,
    metrics: results?.metrics[gid] ?? null,
    in: edges.filter((e) => e.dst === gid),
    out: edges.filter((e) => e.src === gid),
  });
});
