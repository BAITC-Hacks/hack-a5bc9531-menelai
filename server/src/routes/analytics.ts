import { Hono } from "hono";
import { current } from "../data/store";

const NO_RESULTS = { error: "нет выгрузки пайплайна: запустите pipeline/run.py (см. README)" };
const KEYS = ["time", "routes", "anomalies", "resilience", "completeness"] as const;

export default new Hono().get("/:key", (c) => {
  const key = c.req.param("key") as (typeof KEYS)[number];
  if (!KEYS.includes(key)) return c.json({ error: `unknown analytics ${key}` }, 404);
  const { analytics } = current();
  if (!analytics) return c.json(NO_RESULTS, 503);
  return c.json(analytics[key]);
});
