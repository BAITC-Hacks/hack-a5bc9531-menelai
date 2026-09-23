// Exploratory analytics for the «Анализ» screens. Deterministic, computed once from parquet + pipeline metrics.
// Roles and priority are never computed here — they are read from out/ (results.ts).
import { edges, nodes, transactions } from "./load";
import { results, type Metrics } from "./results";

const DAY = 86_400_000;
const dayNum = (iso: string) => Date.parse(iso) / DAY;
const T = results?.meta.thresholds ?? {};
const SYNC_PAYERS = T.sync_payers ?? 3;
const FAST_DAYS = T.fast_days ?? 2;
const metrics = (gid: string): Metrics | undefined => results?.metrics[gid];
const role = (gid: string) => metrics(gid)?.role ?? null;
const totalKzt = edges.reduce((s, e) => s + e.sumKzt, 0);

// ---------------------------------------------------------------- time

function time() {
  const byDay = new Map<string, { n: number; kzt: number }>();
  for (const t of transactions) {
    const d = byDay.get(t.date) ?? { n: 0, kzt: 0 };
    d.n++; d.kzt += t.sumKzt;
    byDay.set(t.date, d);
  }
  const daily = [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({ date, ...d }));

  // same definition as the pipeline's sync_in_events: ≥ SYNC_PAYERS distinct payers → one receiver on one day
  const groups = new Map<string, { dst: string; date: string; payers: Set<string>; kzt: number }>();
  for (const t of transactions) {
    const k = `${t.dst}|${t.date}`;
    const g = groups.get(k) ?? { dst: t.dst, date: t.date, payers: new Set(), kzt: 0 };
    g.payers.add(t.src); g.kzt += t.sumKzt;
    groups.set(k, g);
  }
  const sync = [...groups.values()]
    .filter((g) => g.payers.size >= SYNC_PAYERS)
    .map((g) => ({ date: g.date, dst: g.dst, role: role(g.dst), payers: g.payers.size, kzt: g.kzt }))
    .sort((a, b) => b.payers - a.payers || b.kzt - a.kzt || a.date.localeCompare(b.date));

  const fastTransit = Object.entries(results?.metrics ?? {})
    .filter(([, m]) => m.role === "transit" && (m.fast_out_share ?? 0) >= 0.9)
    .map(([gid, m]) => ({ gid, inKzt: m.in_kzt, outKzt: m.out_kzt, passThrough: m.pass_through, fastShare: m.fast_out_share, seedUp: m.n_seed_upstream, depth: m.depth }))
    .sort((a, b) => b.inKzt - a.inKzt);

  return { daily, syncTotal: sync.length, sync: sync.slice(0, 60), syncPayers: SYNC_PAYERS, fastDays: FAST_DAYS, fastTransit };
}

// ---------------------------------------------------------------- routes & cycles

function routes() {
  // Chain A→B→C: a transfer A→B followed by B→C within 0..FAST_DAYS days. A "hit" is one A→B transfer
  // that has at least one such follow-up. Kept when hits ≥ 2 and both links have ≥ 2 transfers.
  const inTx = new Map<string, { src: string; d: number }[]>();
  const outTx = new Map<string, { dst: string; d: number }[]>();
  for (const t of transactions) {
    (inTx.get(t.dst) ?? inTx.set(t.dst, []).get(t.dst)!).push({ src: t.src, d: dayNum(t.date) });
    (outTx.get(t.src) ?? outTx.set(t.src, []).get(t.src)!).push({ dst: t.dst, d: dayNum(t.date) });
  }
  const edge = new Map(edges.map((e) => [`${e.src}|${e.dst}`, e]));
  const hits = new Map<string, number>();
  for (const [b, ins] of inTx) {
    const outs = outTx.get(b);
    if (!outs) continue;
    for (const i of ins) {
      const seen = new Set<string>();
      for (const o of outs) if (o.dst !== i.src && o.d >= i.d && o.d - i.d <= FAST_DAYS) seen.add(o.dst);
      for (const c of seen) hits.set(`${i.src}|${b}|${c}`, (hits.get(`${i.src}|${b}|${c}`) ?? 0) + 1);
    }
  }
  const chains = [...hits]
    .map(([k, h]) => {
      const [a, b, c] = k.split("|");
      const ab = edge.get(`${a}|${b}`)!, bc = edge.get(`${b}|${c}`)!;
      return { a, b, c, hits: h, bRole: role(b), abKzt: ab.sumKzt, abN: ab.nTx, bcKzt: bc.sumKzt, bcN: bc.nTx };
    })
    .filter((x) => x.hits >= 2 && x.abN >= 2 && x.bcN >= 2)
    .sort((x, y) => y.hits - x.hits || y.bcKzt - x.bcKzt);

  // Simple directed cycles of length ≤ cycle_len, each found once from its smallest-index node.
  // (node_metrics.json keeps only a sample of cycles per node, so the list is enumerated here; total = _meta.n_cycles_le5.)
  const maxLen = T.cycle_len ?? 5;
  const id = new Map(nodes.map((n, i) => [n.gid, i]));
  const adj: number[][] = nodes.map(() => []);
  for (const e of edges) adj[id.get(e.src)!].push(id.get(e.dst)!);
  const found: string[][] = [];
  for (let s = 0; s < nodes.length; s++) {
    const path = [s], onPath = new Set([s]);
    const dfs = (v: number) => {
      for (const w of adj[v]) {
        if (w === s) found.push(path.map((k) => nodes[k].gid));
        else if (w > s && !onPath.has(w) && path.length < maxLen) {
          path.push(w); onPath.add(w); dfs(w); path.pop(); onPath.delete(w);
        }
      }
    };
    dfs(s);
  }
  const cycles = new Map(found.map((c) => [c.join(">"), c]));
  const withKzt = [...cycles.values()].map((path) => ({
    path,
    minKzt: Math.min(...path.map((g, i) => edge.get(`${g}|${path[(i + 1) % path.length]}`)?.sumKzt ?? 0)),
  }));
  const byLen: Record<number, number> = {};
  for (const c of withKzt) byLen[c.path.length] = (byLen[c.path.length] ?? 0) + 1;
  const top = (len: number) => withKzt.filter((c) => c.path.length === len).sort((a, b) => b.minKzt - a.minKzt).slice(0, 10);

  return { windowDays: FAST_DAYS, chainsTotal: chains.length, chains: chains.slice(0, 40), cyclesTotal: withKzt.length, cycleMaxLen: maxLen, byLen, mutual: top(2), triangles: top(3) };
}

// ---------------------------------------------------------------- anomalies

function anomalies() {
  // z-score of log(in_kzt) within the node's crawl hop, among nodes with inflow
  const byDepth = new Map<number, { gid: string; m: Metrics; v: number }[]>();
  for (const [gid, m] of Object.entries(results?.metrics ?? {}))
    if (m.in_kzt > 0) (byDepth.get(m.depth) ?? byDepth.set(m.depth, []).get(m.depth)!).push({ gid, m, v: Math.log(m.in_kzt) });
  const profile = [...byDepth].flatMap(([depth, xs]) => {
    const mean = xs.reduce((s, x) => s + x.v, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x.v - mean) ** 2, 0) / xs.length);
    const sorted = xs.map((x) => x.m.in_kzt).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return xs.map((x) => ({ gid: x.gid, depth, inKzt: x.m.in_kzt, depthMedian: median, z: (x.v - mean) / sd, role: x.m.role, inDeg: x.m.in_deg, outDeg: x.m.out_deg, passThrough: x.m.pass_through }));
  })
    .sort((a, b) => b.z - a.z)
    .slice(0, 15);

  return { profile };
}

// ---------------------------------------------------------------- resilience

function resilience() {
  const ranked = Object.entries(results?.metrics ?? {}).sort(([ga, a], [gb, b]) => b.priority_score - a.priority_score || ga.localeCompare(gb)).map(([g]) => g);
  const idx = new Map(nodes.map((n, i) => [n.gid, i]));
  return [0, 3, 5, 10, 20, 30, 50, 100].map((N) => {
    const removed = new Set(ranked.slice(0, N));
    const parent = nodes.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    let removedKzt = 0;
    for (const e of edges) {
      if (removed.has(e.src) || removed.has(e.dst)) { removedKzt += e.sumKzt; continue; }
      parent[find(idx.get(e.src)!)] = find(idx.get(e.dst)!);
    }
    const size = new Map<number, number>(), kzt = new Map<number, number>();
    nodes.forEach((n, i) => { if (!removed.has(n.gid)) size.set(find(i), (size.get(find(i)) ?? 0) + 1); });
    for (const e of edges) if (!removed.has(e.src) && !removed.has(e.dst)) { const r = find(idx.get(e.src)!); kzt.set(r, (kzt.get(r) ?? 0) + e.sumKzt); }
    const comps = [...size].filter(([, s]) => s >= 2);
    const [largestRoot, largestNodes] = comps.reduce((a, b) => (b[1] > a[1] ? b : a), [-1, 0]);
    return { N, components: comps.length, largestNodes, largestShare: (kzt.get(largestRoot) ?? 0) / totalKzt, removedShare: removedKzt / totalKzt };
  });
}

// ---------------------------------------------------------------- completeness

function completeness() {
  const M = Object.entries(results?.metrics ?? {});
  const bucket = (d: number) => (d >= 3 ? "3+" : String(d));
  const d3: Record<string, [number, number]> = { "1": [0, 0], "2": [0, 0], "3+": [0, 0] };
  const trunc: Record<string, number> = { "1": 0, "2": 0, "3+": 0 };
  for (const [, m] of M) {
    if (m.depth === 3 && m.in_deg > 0) { const b = d3[bucket(m.in_deg)]; b[1]++; if (m.out_deg > 0) b[0]++; }
    if (m.truncated) trunc[bucket(Math.max(1, m.in_deg))]++;
  }
  const pContinue = Object.fromEntries(Object.entries(d3).map(([k, [c, n]]) => [k, { share: n ? c / n : 0, n }]));
  const expectedContinue = Math.round(Object.keys(trunc).reduce((s, k) => s + trunc[k] * pContinue[k].share, 0));
  const truncated = new Set(M.filter(([, m]) => m.truncated).map(([g]) => g));
  const transitToTruncated = new Set(edges.filter((e) => truncated.has(e.dst) && role(e.src) === "transit").map((e) => e.src)).size;
  return {
    seedNoOut: M.filter(([, m]) => m.is_seed && m.out_deg === 0).length,
    truncated: truncated.size,
    orphans: M.filter(([, m]) => m.in_deg + m.out_deg === 0).length,
    pContinue,
    truncatedByIn: trunc,
    expectedContinue,
    transitToTruncated,
    consolidators: M.filter(([, m]) => m.role === "consolidator").length,
  };
}

export const analytics = results
  ? { time: time(), routes: routes(), anomalies: anomalies(), resilience: resilience(), completeness: completeness() }
  : null;
