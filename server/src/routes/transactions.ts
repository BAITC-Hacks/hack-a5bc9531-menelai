import { Hono } from "hono";
import { transactions } from "../data/load";

export default new Hono().get("/", (c) => c.json(transactions));
