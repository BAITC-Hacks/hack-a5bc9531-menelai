import { Hono } from "hono";
import { topNodes } from "../data/out";

export default new Hono().get("/", (c) => c.json(topNodes));
