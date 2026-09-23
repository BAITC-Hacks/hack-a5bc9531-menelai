import { Hono } from "hono";
import { clusterById, clusters, graphNodes } from "../data/out";

export default new Hono()
  .get("/", (c) => c.json(clusters))
  .get("/:id", (c) => {
    const id = c.req.param("id");
    const cluster = clusterById.get(Number(id));
    if (!cluster) return c.json({ error: `unknown cluster ${id}` }, 404);
    return c.json({ ...cluster, members: graphNodes.filter((n) => n.clusterId === cluster.clusterId) });
  });
