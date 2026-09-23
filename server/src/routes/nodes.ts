import { Hono } from "hono";
import { edges, transactions } from "../data/load";
import { graphNodeByGid, metricsByGid, roleByGid } from "../data/out";

type Daily = { date: string; inKzt: number; outKzt: number; inTx: number; outTx: number };

export default new Hono().get("/:gid", (c) => {
  const gid = c.req.param("gid");
  const node = graphNodeByGid.get(gid);
  if (!node) return c.json({ error: `unknown gid ${gid}` }, 404);
  const r = roleByGid.get(gid)!;

  const byDate = new Map<string, Daily>();
  for (const t of transactions) {
    if (t.src !== gid && t.dst !== gid) continue;
    let d = byDate.get(t.date);
    if (!d) byDate.set(t.date, (d = { date: t.date, inKzt: 0, outKzt: 0, inTx: 0, outTx: 0 }));
    if (t.src === gid) (d.outKzt += t.sumKzt), d.outTx++;
    if (t.dst === gid) (d.inKzt += t.sumKzt), d.inTx++;
  }

  return c.json({
    node,
    metrics: metricsByGid.get(gid)!,
    role: { role: r.role, roleScore: r.roleScore, roleRule: r.roleRule, evidence: r.evidence, priorityScore: r.priorityScore },
    in: edges.filter((e) => e.dst === gid),
    out: edges.filter((e) => e.src === gid),
    daily: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
  });
});
