"""Ручной аудит (SPEC.md §Проверки п. 5): 5 случайных размеченных узлов не-peripheral на коленах 1–3 → сырые переводы выгрузки.
uv run --project ../pipeline python audit.py A_llm
"""
import sys
from pathlib import Path

import pandas as pd

root = Path(sys.argv[1])
n = pd.read_parquet(root / "data/nodes.parquet").set_index("gid")
t = pd.read_parquet(root / "data/transactions.parquet")
g = pd.read_csv(root / "ground_truth.csv").set_index("gid").join(n)
pool = g[g.functional_role.ne("peripheral") & g.functional_role.ne("undeclared") & g.depth.between(1, 3)]
h = g.handle
for gid, r in pool.sample(5, random_state=2026).iterrows():
    i, o = t[t.dst == gid], t[t.src == gid]
    print(f"\n=== {r.handle} | {r.functional_role}/{r.involvement} | колено {r.depth} | {r.archetype}: {r.note}")
    print(f"  вход {i.sum_kzt.sum():,.0f} от {i.src.nunique()} плат. ({len(i)} пер.) | выход {o.sum_kzt.sum():,.0f} к {o.dst.nunique()} получ. ({len(o)} пер.)")
    for lab, d, col in [("  <-", i, "src"), ("  ->", o, "dst")]:
        for x in d.sort_values("date").head(8).itertuples():
            print(f"{lab} {x.date} {x.sum_kzt:>12,.0f}  {h.get(getattr(x, col))}")
        if len(d) > 8:
            print(f"{lab} … ещё {len(d) - 8}")
