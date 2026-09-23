import { Hono } from "hono";
import { api } from "./routes";

export const app = new Hono()
  .route("/api", api)
  .notFound((c) => c.json({ error: "not found" }, 404))
  .onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });
