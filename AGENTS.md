# AGENTS.md

Hackathon project (HackAlem AI, 5 hours): **«Граф денег»**, an AML analysis tool. Input is a 4-hop graph of outgoing bank transfers from 81 known clients (2 248 nodes). The tool assigns each node a role, a cluster and a priority, and explains why in words an analyst can follow.

- Case spec (Russian): `task/HackAlem AI_ Граф денег_…pdf`
- Dataset description: `task/README.md`
- README requirements checklist: `docs/README_REQUIREMENTS.md`

## Layout

```
package.json        bun workspaces: client, server
server/             Bun + Hono API, port 3001
  src/index.ts      entry
  src/app.ts        Hono app, /api mount, JSON 404/500
  src/routes/       routes/index.ts registers every resource; one file per resource
  src/data/store.ts registry of datasets + the active one: `demo` from DATA_DIR + OUT_DIR, uploads from DATASETS_DIR (default data/datasets, gitignored)
  src/data/dataset.ts loads one dataset (parquet via load.ts, out/ via results.ts, d3 layout, analytics, tools); routes call current() per request
  src/routes/datasets.ts list / upload (multipart, 3 parquet) / activate / delete; upload runs pipeline/run.py as a subprocess (needs uv in PATH)
client/             Vite + React 19 + TS + Tailwind v4 + shadcn/ui, port 5173
  src/router.tsx    route table (createBrowserRouter)
  src/layouts/      AppLayout: nav + gid search
  src/pages/        one file per route
  src/lib/api.ts    typed fetch helpers, mirrors the server contract
task/data/          edges.parquet, nodes.parquet, transactions.parquet (organizer data, read-only)
docs/               project docs
out/                pipeline CSVs (nodes_roles, clusters, top_nodes, node_metrics, edge_metrics) + node_metrics.json for the demo dataset; server reads node_metrics.json, clusters.csv, top_nodes.csv
Dockerfile          Railway image: bun + uv, pipeline venv pre-synced; railway.json selects it
```

## Commands

```bash
bun install                  # from the repo root
bun run dev                  # starts both client and server
cd server && bun run dev     # API only
cd client && bun run build   # typecheck + production build
cd client && bun run lint    # oxlint
cd server && bunx tsc --noEmit -p .
```

Use `bun` / `bunx` only, never `npm` / `npx`. Inline scripts go through `bun -e`.

## Conventions

- **gids are strings everywhere**: server, JSON and client. Values like `100000003684369100` are larger than `Number.MAX_SAFE_INTEGER`. hyparquet returns int64 as BigInt; convert it with `String()` and never with `Number()`.
- The parquet files are ZSTD-compressed. `data/load.ts` passes `Bun.zstdDecompressSync` to hyparquet, which makes the server Bun-only.
- **Adding an API route:** create `server/src/routes/<name>.ts` exporting `new Hono().get(...)` (chained), mount it in `routes/index.ts` with `.route()`, then add a typed helper in `client/src/lib/api.ts`. Keep the chaining so `AppType` stays inferable.
- **Adding a page:** add a file under `client/src/pages/`, register it in `router.tsx`, and add a nav link in `AppLayout.tsx` if it belongs in the nav.
- **React Router v8:** import from `react-router` (there is no `react-router-dom`). `RouterProvider` comes from `react-router/dom`.
- **shadcn uses the `base-nova` style on Base UI, not Radix.** Compose with the `render` prop instead of `asChild`. A Button that renders a non-button element needs `nativeButton={false}`. Add components with `bunx shadcn@latest add <name>`.
- UI text is in Russian and the theme is dark (`class="dark"` in `client/index.html`). Format numbers with `ru-RU`.
- The `/api` proxy is configured in `client/vite.config.ts`. The server has no CORS.

## Domain rules

These are scored by the jury. Don't break them.

- Roles: `consolidator, transit, distributor, terminal, coordinator, peripheral`. Every role must come from an explicit rule or metric with a threshold. No black-box scores, and no hardcoded gid lists.
- Every conclusion is phrased as a hypothesis for review ("признаки консолидации"), never as a claim of guilt.
- Known data traps:
  - **Hop-4 cutoff:** all 444 hop-4 nodes have no outgoing edges because the crawl stopped there. Nodes at hops 1–3 with no outgoing edges really are sinks and can serve as the reference set.
  - **Seed inflow is understated:** the graph was built outward from the seeds, so out/in ratios are meaningless for seeds.
  - **Only transfers ≥ 5 000 KZT, only intra-bank, only outgoing.**
  - **Amount and count are separate signals.** The graph is directed and weighted. Any undirected method, such as Louvain, must be flagged as undirected.
  - **19 seeds have no edges at all**, but they must still appear in the output.
  - The pipeline must run on any upload with the same schema: no dataset literals (2248, 444, 19, «июль») in code or evidence. The last hop is `max(depth)`; period, hop counts and min amount go into `_meta` and the UI reads them from `/api/stats`.
- Required outputs, with a fixed schema:
  - `nodes_roles.csv`: exactly 2 248 rows. Columns `gid, role, role_score, cluster_id, priority_score, evidence`; evidence is ≤ 200 chars and contains numbers.
  - `clusters.csv`: `cluster_id, n_nodes, n_seed, sum_kzt_internal, top_gids, hypothesis`.
  - `top_nodes.csv`: ≥ 20 rows. `rank, gid, role, priority_score, why`.
- A full recompute from raw parquet to the three CSVs must run in under 5 minutes, locally, with one command.
- No external data enrichment and no invented client attributes. Never commit API keys.

## Working rules

- Make the smallest change that solves the task. Don't add fallbacks or config surface nobody asked for.
- Only call something "works" or "tested" with the command and its output to show.
- Several people and agents work on this repo at once. Running dev servers and uncommitted files may belong to someone else, so check before killing, deleting or reverting.
- The README must only describe what actually exists in the repo. Update it when you change structure, commands or the API.
