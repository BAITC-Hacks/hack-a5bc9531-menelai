import { Hono } from "hono";
import { info } from "../data/dataset";
import { current } from "../data/store";

export default new Hono().get("/", (c) => {
  const d = current();
  const { id, name, source, createdAt, ...rest } = info(d);
  return c.json({
    datasetId: id,
    datasetName: name,
    ...rest,
    totalKzt: d.totalKzt,
    minTxKzt: d.results?.meta.min_tx_kzt ?? null,
    byDepth: d.byDepth,
    clusters: d.results?.clusters.length ?? null,
  });
});
