import { Hono } from "hono";
import analytics from "./analytics";
import assistant from "./assistant";
import datasets from "./datasets";
import graph from "./graph";
import health from "./health";
import nodes from "./nodes";
import results from "./results";
import stats from "./stats";
import transactions from "./transactions";

export const api = new Hono()
  .route("/health", health)
  .route("/stats", stats)
  .route("/graph", graph)
  .route("/transactions", transactions)
  .route("/nodes", nodes)
  .route("/analytics", analytics)
  .route("/assistant", assistant)
  .route("/datasets", datasets)
  .route("/", results);

export type AppType = typeof api;
