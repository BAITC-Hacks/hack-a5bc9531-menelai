import { Hono } from "hono";

export default new Hono().get("/", (c) => c.json({ ok: true }));
