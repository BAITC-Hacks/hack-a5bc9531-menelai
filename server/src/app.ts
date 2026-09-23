import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { api } from "./routes";

// Paths are relative to the process cwd (server/). Built client + SPA fallback for production.
export const app = new Hono()
  .route("/api", api)
  .all("/api/*", (c) => c.json({ error: "not found" }, 404))
  .use("/*", serveStatic({ root: "../client/dist" }))
  .get("*", serveStatic({ path: "../client/dist/index.html" }))
  .notFound((c) => c.json({ error: "not found" }, 404))
  .onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });
