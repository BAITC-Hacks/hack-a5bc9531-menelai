import { Hono } from "hono";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { info, loadDataset, type DatasetInfo } from "../data/dataset";
import { activate, current, DEMO_ID, get, list, register, unregister, uploadPaths } from "../data/store";

const PIPELINE_DIR = resolve(import.meta.dir, "../../../pipeline");
const FILES = ["nodes", "edges", "transactions"] as const;
const MAX_BYTES = 100 * 1024 * 1024;
const tail = (s: string, n: number) => s.trimEnd().split("\n").slice(-n).join("\n");

// Uploads run one at a time: two pipelines writing/activating concurrently would race.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn);
  queue = p.catch(() => {});
  return p;
}

type UploadResult = { status: 200; body: { dataset: DatasetInfo; log: string } } | { status: 400; body: { error: string; log?: string } };

async function ingest(files: File[], name: string | undefined): Promise<UploadResult> {
  const bytes = await Promise.all(files.map((f) => f.arrayBuffer()));
  const hasher = new Bun.CryptoHasher("sha256");
  for (const b of bytes) hasher.update(b);
  const id = hasher.digest("hex").slice(0, 10);

  const existing = get(id);
  if (existing) {
    activate(id);
    return { status: 200, body: { dataset: info(existing), log: "набор уже загружен — активирован без пересчёта" } };
  }

  const p = uploadPaths(id);
  await rm(p.dir, { recursive: true, force: true });
  await mkdir(p.raw, { recursive: true });
  await Promise.all(FILES.map((f, i) => Bun.write(resolve(p.raw, `${f}.parquet`), bytes[i])));

  const proc = Bun.spawn(["uv", "run", "python", "run.py", "--data", p.raw, "--out", p.out], {
    cwd: PIPELINE_DIR, stdout: "pipe", stderr: "pipe", timeout: 5 * 60_000,
  });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) {
    await rm(p.dir, { recursive: true, force: true });
    const msg = stderr.match(/ОШИБКА ВХОДНЫХ ДАННЫХ: (.*)/)?.[1] ?? (tail(stderr, 5) || `пайплайн завершился с кодом ${code}`);
    return { status: 400, body: { error: msg, log: tail(stdout + "\n" + stderr, 40) } };
  }

  const createdAt = new Date().toISOString();
  const meta = { name: name?.trim() || `Загрузка ${createdAt.slice(0, 16).replace("T", " ")}`, createdAt };
  await Bun.write(p.meta, JSON.stringify(meta, null, 2));
  const ds = await loadDataset({ id, ...meta, source: "upload", dataDir: p.raw, outDir: p.out });
  register(ds);
  activate(id);
  return { status: 200, body: { dataset: info(ds), log: tail(stdout, 40) } };
}

export default new Hono()
  .get("/", (c) => c.json({ active: current().id, datasets: list().map(info) }))
  .post("/", async (c) => {
    const form = await c.req.parseBody();
    const files = FILES.map((f) => form[f]);
    if (!files.every((f): f is File => f instanceof File))
      return c.json({ error: `нужны три файла: ${FILES.join(", ")}` }, 400);
    if (!files.every((f) => f.name.toLowerCase().endsWith(".parquet"))) return c.json({ error: "нужны файлы .parquet" }, 400);
    if (files.reduce((s, f) => s + f.size, 0) > MAX_BYTES) return c.json({ error: "файлы больше 100 МБ в сумме" }, 400);
    const name = typeof form.name === "string" ? form.name : undefined;
    const r = await serial(() => ingest(files, name));
    return r.status === 200 ? c.json(r.body, 200) : c.json(r.body, 400);
  })
  .post("/:id/activate", (c) => {
    const id = c.req.param("id");
    return activate(id) ? c.json({ active: id }) : c.json({ error: `нет набора ${id}` }, 404);
  })
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    const d = get(id);
    if (!d) return c.json({ error: `нет набора ${id}` }, 404);
    if (d.source !== "upload") return c.json({ error: "встроенный набор удалить нельзя" }, 400);
    if (current().id === id) activate(DEMO_ID);
    unregister(id);
    await rm(uploadPaths(id).dir, { recursive: true, force: true });
    return c.json({ active: current().id });
  });
