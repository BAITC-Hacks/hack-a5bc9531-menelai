import { Hono } from "hono";
import { current } from "../data/store";

export default new Hono().get("/", (c) => c.json(current().graph));
