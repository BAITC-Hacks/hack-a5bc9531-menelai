import { Hono } from "hono";
import graph from "./graph";
import health from "./health";
import nodes from "./nodes";
import stats from "./stats";
import transactions from "./transactions";

export const api = new Hono()
  .route("/health", health)
  .route("/stats", stats)
  .route("/graph", graph)
  .route("/transactions", transactions)
  .route("/nodes", nodes);

export type AppType = typeof api;
