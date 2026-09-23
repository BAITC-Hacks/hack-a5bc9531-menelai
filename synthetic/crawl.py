"""Мир → выгрузка по процессу организаторов (SPEC.md §Общий обход).

uv run --project ../pipeline python crawl.py A_llm      # читает A_llm/**/*tx.csv и A_llm/**/*actors.csv, пишет A_llm/data/
"""
import sys
from collections import deque
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

REAL = Path(__file__).resolve().parents[1] / "task" / "data"
LO, HI, MIN_SUM, MAX_HOP = pd.Timestamp("2026-07-01"), pd.Timestamp("2026-07-31"), 5000, 4


def load_world(root: Path):
    tx = pd.concat([pd.read_csv(p, dtype={"src": str, "dst": str}) for p in sorted(root.rglob("*tx.csv"))], ignore_index=True)
    ac = pd.concat([pd.read_csv(p, dtype={"handle": str}) for p in sorted(root.rglob("*actors.csv"))], ignore_index=True)
    tx["src"], tx["dst"] = tx.src.str.strip(), tx.dst.str.strip()
    tx["date"] = pd.to_datetime(tx.date, errors="coerce")
    tx["amount"] = pd.to_numeric(tx.amount, errors="coerce")
    tx["channel"] = tx.channel.str.strip().str.lower()
    bad = tx.date.isna() | tx.amount.isna() | ~tx.channel.isin(["intra", "inter"])
    if bad.any():
        print(f"ВНИМАНИЕ: {bad.sum()} строк мира с битой датой/суммой/каналом отброшены")
    dup = ac.handle.duplicated(keep="first")
    if dup.any():
        print(f"ВНИМАНИЕ: {dup.sum()} повторных описаний участников, оставлено первое: {list(ac.handle[dup])[:10]}")
    ac["is_known"] = ac.is_known.astype(str).str.lower().isin(["true", "1", "yes"])
    return tx[~bad], ac[~dup].set_index("handle")


def crawl(tx, ac, rng_seed=0):
    obs = tx[(tx.channel == "intra") & (tx.amount >= MIN_SUM) & tx.date.between(LO, HI) & (tx.src != tx.dst)]
    out = {s: g for s, g in obs.groupby("src")}
    seeds = list(ac.index[ac.is_known])
    depth = {s: 0 for s in seeds}
    q = deque(seeds)
    while q:
        u = q.popleft()
        if depth[u] >= MAX_HOP or u not in out:
            continue
        for v in out[u].dst.unique():
            if v not in depth:
                depth[v] = depth[u] + 1
                q.append(v)
    t = obs[obs.src.map(depth).lt(MAX_HOP)]          # исходящие колен 0–3; все dst уже в depth по построению BFS

    rng = np.random.default_rng(rng_seed)
    real = set(pd.read_parquet(REAL / "nodes.parquet").gid) if REAL.exists() else set()
    ks = set()
    while len(ks) < len(depth):
        ks |= set(rng.integers(10_000, 9_000_000, len(depth) * 2).tolist())
    gids = [g for g in (10**17 + k * 1000 + 100 for k in sorted(ks)) if g not in real]
    rng.shuffle(gids)
    gid = dict(zip(depth, gids))

    nodes = pd.DataFrame({"gid": [gid[h] for h in depth], "depth": list(depth.values()),
                          "is_seed": [depth[h] == 0 and h in ac.index and ac.at[h, "is_known"] for h in depth]})
    nodes = nodes.astype({"gid": "int64", "depth": "int64", "is_seed": bool}).sort_values(["depth", "gid"], ignore_index=True)
    trans = pd.DataFrame({"src": t.src.map(gid), "dst": t.dst.map(gid), "date": t.date.dt.date,
                          "sum_kzt": t.amount.astype("float64")}).astype({"src": "int64", "dst": "int64"})
    trans = trans.sort_values(["date", "src", "dst"], ignore_index=True)
    edges = trans.groupby(["src", "dst"], as_index=False).agg(sum_kzt=("sum_kzt", "sum"), n_tx=("sum_kzt", "size"))
    edges["depth"] = (edges.src.map(nodes.set_index("gid").depth) + 1).astype("int8")
    edges["n_tx"] = edges.n_tx.astype("int64")

    cols = ["functional_role", "involvement", "archetype", "note"]
    gt = ac.reindex(list(depth))[cols].fillna({"functional_role": "undeclared", "involvement": "undeclared"})
    gt.insert(0, "gid", [gid[h] for h in depth])
    gt.insert(1, "handle", list(depth))
    return nodes, edges, trans, gt


def check(nodes, edges, trans):
    real = pd.read_parquet(REAL / "nodes.parquet") if REAL.exists() else None
    dep = nodes.set_index("gid").depth
    assert nodes.gid.is_unique and set(edges.src) | set(edges.dst) <= set(nodes.gid)
    assert (trans.sum_kzt >= MIN_SUM).all() and trans.date.between(LO.date(), HI.date()).all()
    assert (trans.src != trans.dst).all() and (edges.src.map(dep) < MAX_HOP).all()
    assert (edges.depth == edges.src.map(dep) + 1).all()
    assert np.allclose(trans.groupby(["src", "dst"]).sum_kzt.sum().values,
                       edges.set_index(["src", "dst"]).sum_kzt.sort_index().values)
    assert (nodes[nodes.is_seed].depth == 0).all() and (nodes[~nodes.is_seed].depth > 0).all()
    if real is not None:
        assert not set(nodes.gid) & set(real.gid)
        for mine, ref in [(nodes, real), (edges, pd.read_parquet(REAL / "edges.parquet")),
                          (trans, pd.read_parquet(REAL / "transactions.parquet"))]:
            assert list(mine.columns) == list(ref.columns) and dict(mine.dtypes) == dict(ref.dtypes), (mine.dtypes, ref.dtypes)
        assert isinstance(trans.date.iloc[0], date)


if __name__ == "__main__":
    root = Path(sys.argv[1])
    tx, ac = load_world(root)
    nodes, edges, trans, gt = crawl(tx, ac)
    check(nodes, edges, trans)
    d = root / "data"
    d.mkdir(exist_ok=True)
    nodes.to_parquet(d / "nodes.parquet", index=False)
    edges.to_parquet(d / "edges.parquet", index=False)
    trans.to_parquet(d / "transactions.parquet", index=False)
    gt.to_csv(root / "ground_truth.csv", index=False)
    print(f"мир: {len(tx)} переводов, {len(ac)} описанных участников, seed {int(ac.is_known.sum())}")
    print("выгрузка: узлов", len(nodes), "по коленам", nodes.depth.value_counts().sort_index().to_dict(),
          "| рёбер", len(edges), "| переводов", len(trans), f"| оборот {trans.sum_kzt.sum():,.0f} ₸")
    print("неописанных видимых узлов:", int((gt.functional_role == "undeclared").sum()))
