# -*- coding: utf-8 -*-
"""
Синтетические данные той же схемы и формы, что и реальная выгрузка.
Нужны только для тестов: проверить, что код работает на «похожих» данных любого размера.

    python synth.py out_dir [seed] [scale]
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd


def make(out=None, seed=7, scale=1.0, n_seeds=81, depth=4):
    rng = np.random.default_rng(seed)
    n_seeds = max(3, int(n_seeds * scale))
    ids = rng.choice(np.arange(1_000_000, 9_999_999), int(8000 * max(scale, 0.2)) + 1000, replace=False)
    gids = iter(100_000_000_000_000_100 + ids.astype(np.int64) * 1000)
    known = []
    seeds = [next(gids) for _ in range(n_seeds)]
    no_edge = set(seeds[: n_seeds * 19 // 81])
    only_recv = seeds[n_seeds * 19 // 81: n_seeds * 31 // 81]
    active = seeds[n_seeds * 31 // 81:]
    edges = {}

    def add(s, d):
        if s != d:
            edges[(s, d)] = 1

    level, cons = list(active), []
    for d in range(depth):
        nxt = []
        for s in level:
            r = rng.random()
            k = int(rng.integers(60, 117)) if r < 0.01 else int(rng.integers(10, 30)) if r < 0.05 \
                else int(rng.integers(1, 4))
            if d > 0 and k < 10 and rng.random() < 0.45:
                continue
            for _ in range(k):
                u = rng.random()
                if u < 0.18 and len(known) > 50:
                    add(s, known[int(rng.integers(max(0, len(known) - 400), len(known)))])
                elif u < 0.25 and cons:
                    add(s, cons[int(rng.integers(len(cons)))])
                else:
                    n = next(gids)
                    known.append(n)
                    nxt.append(n)
                    add(s, n)
                    if rng.random() < 0.01:
                        cons.append(n)
        level = nxt
    for s in only_recv:
        add(active[int(rng.integers(len(active)))], s)
    for c in cons[:10]:
        for p in rng.choice(known[: max(10, len(known) // 3)], int(rng.integers(8, 20)), replace=False):
            add(int(p), c)

    e = pd.DataFrame(list(edges), columns=["src", "dst"])
    adj = e.groupby("src").dst.apply(list).to_dict()
    dist = {s: 0 for s in seeds}
    frontier, lvl = list(active), 0
    while frontier and lvl < depth:
        lvl += 1
        nf = []
        for s in frontier:
            for t in adj.get(s, []):
                if t not in dist:
                    dist[t] = lvl
                    nf.append(t)
        frontier = nf
    e = e[e.src.isin(dist) & e.dst.isin(dist)]
    e = e[e.src.map(dist) < depth]                      # последнее колено без исходящих, как в выгрузке
    e = e[~(e.dst.isin(no_edge) | e.src.isin(no_edge))]
    used = set(e.src) | set(e.dst) | set(seeds)
    nodes = pd.DataFrame({"gid": sorted(used)})
    nodes["depth"] = nodes.gid.map(dist).astype(int)
    nodes["is_seed"] = nodes.gid.isin(seeds)

    rows = []
    for s, d in e[["src", "dst"]].itertuples(index=False):
        for _ in range(int(rng.choice([1, 1, 1, 2, 2, 3, 5]))):
            amt = float(max(5000, round(rng.lognormal(10.3, 1.1), -3)))
            rows.append((s, d, pd.Timestamp(2026, 7, int(rng.integers(1, 32))), amt))
    tx = pd.DataFrame(rows, columns=["src", "dst", "date", "sum_kzt"])
    ed = tx.groupby(["src", "dst"]).agg(sum_kzt=("sum_kzt", "sum"), n_tx=("sum_kzt", "size")).reset_index()
    ed["depth"] = ed.src.map(dist) + 1
    if out is not None:
        out = Path(out)
        out.mkdir(parents=True, exist_ok=True)
        nodes.to_parquet(out / "nodes.parquet", index=False)
        ed.to_parquet(out / "edges.parquet", index=False)
        tx.to_parquet(out / "transactions.parquet", index=False)
    return nodes, ed, tx


if __name__ == "__main__":
    n, e, t = make(sys.argv[1] if len(sys.argv) > 1 else "data_synth",
                   int(sys.argv[2]) if len(sys.argv) > 2 else 7, float(sys.argv[3]) if len(sys.argv) > 3 else 1.0)
    print(f"nodes={len(n)} seeds={int(n.is_seed.sum())} edges={len(e)} tx={len(t)}")
