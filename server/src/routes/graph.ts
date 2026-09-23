import { Hono } from "hono";
import { edges, nodes } from "../data/load";

export default new Hono().get("/", (c) => c.json({ nodes, edges }));
