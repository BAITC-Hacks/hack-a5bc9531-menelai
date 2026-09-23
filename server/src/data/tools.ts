// Deterministic query tools over the graph and pipeline results. Used directly by the UI and by the
// assistant's LLM through function calling — every number in an answer comes from one of these calls.
// Built once per dataset (indexes over its edges); routes pick the active dataset's instance.
import type { Edge, GraphData } from "./types";

export function buildTools({ nodes, edges, transactions, results }: GraphData) {
  const out = new Map<string, Edge[]>(), inn = new Map<string, Edge[]>();
  for (const e of edges) {
    (out.get(e.src) ?? out.set(e.src, []).get(e.src)!).push(e);
    (inn.get(e.dst) ?? inn.set(e.dst, []).get(e.dst)!).push(e);
  }
  const gids = nodes.map((n) => n.gid);
  const m = (g: string) => results?.metrics[g];

  /** Full gid, or a unique suffix of one. */
  function resolve(q: string): string {
    const d = String(q).replace(/\D/g, "");
    if (!d) throw new Error(`пустой gid`);
    const hit = gids.filter((g) => g === d || g.endsWith(d));
    if (hit.length !== 1) throw new Error(hit.length ? `хвост ${d} неоднозначен (${hit.length} узлов)` : `gid ${d} не найден`);
    return hit[0];
  }

  const brief = (g: string) => {
    const x = m(g);
    return x ? { gid: g, role: x.role, priority: x.priority_score, cluster: x.cluster_id, is_seed: x.is_seed, depth: x.depth } : { gid: g };
  };

  return {
    node_metrics({ gid }: { gid: string }) {
      const g = resolve(gid), x = m(g);
      if (!x) return { gid: g, note: "нет выгрузки пайплайна" };
      const { top_in, top_out, cycles, ...rest } = x;
      return { gid: g, ...rest, n_cycles_sample: cycles.length };
    },
    neighbors({ gid, direction = "both", limit = 10 }: { gid: string; direction?: "in" | "out" | "both"; limit?: number }) {
      const g = resolve(gid);
      const pick = (list: Edge[], key: "src" | "dst") =>
        [...list].sort((a, b) => b.sumKzt - a.sumKzt).slice(0, limit).map((e) => ({ ...brief(e[key]), sum_kzt: e.sumKzt, n_tx: e.nTx }));
      return {
        gid: g,
        payers: direction !== "out" ? pick(inn.get(g) ?? [], "src") : undefined,
        recipients: direction !== "in" ? pick(out.get(g) ?? [], "dst") : undefined,
        n_payers: inn.get(g)?.length ?? 0,
        n_recipients: out.get(g)?.length ?? 0,
      };
    },
    common_successors({ gids: list }: { gids: string[] }) {
      const src = list.map(resolve);
      const hits = new Map<string, { count: number; kzt: number }>();
      for (const s of src) for (const e of out.get(s) ?? []) {
        const h = hits.get(e.dst) ?? { count: 0, kzt: 0 };
        h.count++; h.kzt += e.sumKzt;
        hits.set(e.dst, h);
      }
      return {
        resolved: src,
        common: [...hits].filter(([, h]) => h.count >= 2).sort((a, b) => b[1].count - a[1].count || b[1].kzt - a[1].kzt).slice(0, 15)
          .map(([g, h]) => ({ ...brief(g), paid_by: h.count, of: src.length, sum_kzt_from_them: h.kzt })),
      };
    },
    paths({ src, dst, max_len = 4 }: { src: string; dst: string; max_len?: number }) {
      const a = resolve(src), b = resolve(dst), L = Math.min(5, Math.max(1, max_len));
      // iterative deepening: all paths of 1 hop, then 2, … — the shortest routes come first and are never cut by the limit
      const found: string[][] = [];
      const walk = (v: string, path: string[], hops: number) => {
        if (found.length >= 20) return;
        if (path.length - 1 === hops) { if (v === b) found.push(path); return; }
        if (v === b) return;
        for (const e of out.get(v) ?? []) if (!path.includes(e.dst)) walk(e.dst, [...path, e.dst], hops);
      };
      for (let hops = 1; hops <= L && found.length < 20; hops++) walk(a, [a], hops);
      const sum = (x: string, y: string) => out.get(x)?.find((e) => e.dst === y)
      return {
        src: a, dst: b, max_len: L, directed: true,
        paths: found.map((p) => ({
          hops: p.length - 1,
          nodes: p.map(brief),
          links: p.slice(1).map((g, i) => ({ from: p[i], to: g, sum_kzt: sum(p[i], g)?.sumKzt ?? 0, n_tx: sum(p[i], g)?.nTx ?? 0 })),
        })),
      };
    },
    sync_events({ dst, date }: { dst?: string; date?: string }) {
      const g = dst ? resolve(dst) : undefined;
      const groups = new Map<string, { dst: string; date: string; payers: Set<string>; kzt: number }>();
      for (const t of transactions) {
        if ((g && t.dst !== g) || (date && t.date !== date)) continue;
        const k = `${t.dst}|${t.date}`;
        const x = groups.get(k) ?? { dst: t.dst, date: t.date, payers: new Set(), kzt: 0 };
        x.payers.add(t.src); x.kzt += t.sumKzt;
        groups.set(k, x);
      }
      const min = results?.meta.thresholds.sync_payers ?? 3;
      return {
        min_payers: min,
        events: [...groups.values()].filter((x) => x.payers.size >= min).sort((a, b) => b.payers.size - a.payers.size).slice(0, 20)
          .map((x) => ({ date: x.date, ...brief(x.dst), payers: x.payers.size, sum_kzt: x.kzt })),
      };
    },
    query_nodes({ role, cluster, is_seed, min_priority = 0, limit = 15 }: { role?: string; cluster?: number; is_seed?: boolean; min_priority?: number; limit?: number }) {
      const rows = Object.entries(results?.metrics ?? {})
        .filter(([, x]) => (!role || x.role === role) && (cluster == null || x.cluster_id === Number(cluster)) && (is_seed == null || x.is_seed === is_seed) && x.priority_score >= min_priority)
        .sort((a, b) => b[1].priority_score - a[1].priority_score);
      return { total: rows.length, nodes: rows.slice(0, Math.min(50, limit)).map(([g, x]) => ({ ...brief(g), in_kzt: x.in_kzt, out_kzt: x.out_kzt, evidence: x.evidence })) };
    },
    cluster_summary({ cluster_id }: { cluster_id: number }) {
      const c = results?.clusters.find((x) => x.clusterId === Number(cluster_id));
      if (!c) throw new Error(`кластер ${cluster_id} не найден`);
      return c;
    },
  };
}

export type Tools = ReturnType<typeof buildTools>;
export type ToolName = keyof Tools;

/** JSON schemas for LLM function calling (OpenAI Responses API format). */
export const toolSchemas = [
  { name: "node_metrics", description: "Метрики, роль, приоритет, кластер и evidence узла. gid — полный или уникальный хвост.", parameters: { type: "object", properties: { gid: { type: "string" } }, required: ["gid"] } },
  { name: "neighbors", description: "Крупнейшие плательщики и/или получатели узла с суммами.", parameters: { type: "object", properties: { gid: { type: "string" }, direction: { type: "string", enum: ["in", "out", "both"] }, limit: { type: "integer" } }, required: ["gid"] } },
  { name: "common_successors", description: "Получатели, которым платят ≥ 2 из переданных узлов.", parameters: { type: "object", properties: { gids: { type: "array", items: { type: "string" } } }, required: ["gids"] } },
  { name: "paths", description: "Направленные простые пути денег от src к dst длиной ≤ max_len (≤ 5), до 20 путей, кратчайшие первыми.", parameters: { type: "object", properties: { src: { type: "string" }, dst: { type: "string" }, max_len: { type: "integer" } }, required: ["src", "dst"] } },
  { name: "sync_events", description: "Синхронные входы: ≥ 3 разных плательщика одному получателю за день. Фильтр по получателю и/или дате YYYY-MM-DD.", parameters: { type: "object", properties: { dst: { type: "string" }, date: { type: "string" } } } },
  { name: "query_nodes", description: "Узлы по фильтру (роль, кластер, seed, мин. приоритет), по убыванию приоритета.", parameters: { type: "object", properties: { role: { type: "string", enum: ["coordinator", "consolidator", "distributor", "transit", "terminal", "peripheral"] }, cluster: { type: "integer" }, is_seed: { type: "boolean" }, min_priority: { type: "number" }, limit: { type: "integer" } } } },
  { name: "cluster_summary", description: "Сводка кластера: размер, seed, внутренний оборот, топ-gid, гипотеза.", parameters: { type: "object", properties: { cluster_id: { type: "integer" } }, required: ["cluster_id"] } },
].map((t) => ({ type: "function" as const, ...t }));

export function runTool(tools: Tools, name: string, args: unknown) {
  if (!Object.hasOwn(tools, name)) throw new Error(`неизвестный инструмент ${name}`);
  return (tools[name as ToolName] as (a: unknown) => unknown)(args ?? {});
}
