import { Hono } from "hono";
import { edges } from "../data/load";
import { graphNodes } from "../data/out";

export default new Hono().get("/", (c) => c.json({ nodes: graphNodes, edges }));
