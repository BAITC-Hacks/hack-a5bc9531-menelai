"""Свойства выгрузки (SPEC.md §Проверки п. 2–4) для real / A / B → PROFILE.md.

uv run --project ../pipeline python profile.py
"""
from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd
from scipy.stats import ks_2samp

HERE = Path(__file__).resolve().parent
SETS = {"real": HERE.parent / "task" / "data", "A": HERE / "A_llm" / "data", "B": HERE / "B_abm" / "data"}


def load(d):
    n, e, t = (pd.read_parquet(d / f"{x}.parquet") for x in ("nodes", "edges", "transactions"))
    t["date"] = pd.to_datetime(t.date)
    return n, e, t


def node_table(n, e, t):
    f = n.set_index("gid")
    f["in_deg"] = e.groupby("dst").size().reindex(f.index, fill_value=0)
    f["out_deg"] = e.groupby("src").size().reindex(f.index, fill_value=0)
    f["in_kzt"] = e.groupby("dst").sum_kzt.sum().reindex(f.index, fill_value=0)
    f["out_kzt"] = e.groupby("src").sum_kzt.sum().reindex(f.index, fill_value=0)
    return f


def fast_out_share(t, days=2):
    """Доля исходящей суммы, ушедшей ≤ days дней после какого-либо входящего перевода узлу (узлы с входом и выходом)."""
    first_in = t.groupby("dst").date.apply(np.sort)
    o = t[t.src.isin(first_in.index)]
    ok = [((first_in[s] <= d) & (first_in[s] >= d - pd.Timedelta(days=days))).any() for s, d in zip(o.src, o.date)]
    return float(o.sum_kzt[ok].sum() / o.sum_kzt.sum()) if len(o) else np.nan


def facts(n, e, t):
    f = node_table(n, e, t)
    act = f[f.in_deg + f.out_deg > 0]
    G = nx.DiGraph(list(zip(e.src, e.dst)))
    G.add_nodes_from(f.index)
    comps = sorted((len(c) for c in nx.weakly_connected_components(G)), reverse=True)
    seeds = f[f.is_seed]
    both = f[(f.in_kzt > 0) & (f.out_kzt > 0) & ~f.is_seed]
    pt = both.out_kzt / both.in_kzt
    rev = set(zip(e.dst, e.src))
    UG = nx.Graph()
    for s, d, w in zip(e.src, e.dst, e.sum_kzt):
        UG.add_edge(s, d, weight=UG.get_edge_data(s, d, {"weight": 0})["weight"] + w)
    comms = nx.community.louvain_communities(UG, weight="weight", seed=42)
    seedset = set(seeds.index)
    a = t.sum_kzt
    r = {
        "узлов": len(f), "seed": len(seeds),
        **{f"узлов колено {k}": int((f.depth == k).sum()) for k in range(5)},
        "доля колена 4": (f.depth == 4).mean(),
        "рёбер": len(e), "переводов": len(t), "переводов на ребро (ср.)": len(t) / len(e),
        "рёбер на узел": len(e) / len(f), "оборот, млн ₸": a.sum() / 1e6,
        "seed без рёбер": int((seeds.in_deg + seeds.out_deg == 0).sum()),
        "seed только получатели": int(((seeds.in_deg > 0) & (seeds.out_deg == 0)).sum()),
        "рёбер в seed (доля)": e.dst.isin(seedset).mean(),
        "сумма p10": a.quantile(.1), "сумма p25": a.quantile(.25), "сумма p50": a.median(),
        "сумма p75": a.quantile(.75), "сумма p90": a.quantile(.9), "сумма p99": a.quantile(.99), "сумма max": a.max(),
        "доля сумм кратных 1 000": (a % 1000 == 0).mean(), "доля кратных 10 000": (a % 10000 == 0).mean(),
        "доля с копейками": (a % 1 != 0).mean(), "доля 5–10 тыс.": a.between(5000, 9999.99).mean(),
        "рёбер с 1 переводом (доля)": (e.n_tx == 1).mean(), "n_tx max": int(e.n_tx.max()),
        "переводов в выходные (доля)": (t.date.dt.weekday >= 5).mean(),
        "переводов 1–10 июля (доля)": (t.date.dt.day <= 10).mean(), "переводов 21–31 июля (доля)": (t.date.dt.day >= 21).mean(),
        "in_deg p50 (in>0)": act.in_deg[act.in_deg > 0].median(), "in_deg p99": act.in_deg[act.in_deg > 0].quantile(.99),
        "in_deg max": int(f.in_deg.max()), "узлов с ≥8 плательщиками": int((f.in_deg >= 8).sum()),
        "out_deg p50 (out>0)": act.out_deg[act.out_deg > 0].median(), "out_deg p99": act.out_deg[act.out_deg > 0].quantile(.99),
        "out_deg max": int(f.out_deg.max()), "узлов с веером ≥60": int((f.out_deg >= 60).sum()),
        "узлов с веером ≥16": int((f.out_deg >= 16).sum()),
        "узлов с пропуском 0,8–1,2 (не seed)": int(pt.between(0.8, 1.2).sum()),
        "узлов отдали > получили (все)": int((f.out_kzt > f.in_kzt).sum()),
        "доля быстрого вывода ≤2 дн.": fast_out_share(t),
        "взаимных рёбер (доля)": np.mean([(s, d) in rev for s, d in zip(e.src, e.dst)]),
        "циклов длины ≤5": sum(1 for _ in nx.simple_cycles(G, length_bound=5)),
        "слабых компонент": len(comps), "крупнейшая компонента": comps[0],
        "доля узлов вне крупнейшей": 1 - comps[0] / len(f),
        "сообществ Louvain с ≥2 seed": sum(len(c & seedset) >= 2 for c in comms),
    }
    return r, f, t


def ks(real, other):
    (_, fr, tr), (_, fo, to) = real, other
    lg = lambda x: np.log10(x)
    return {
        "KS log-сумма перевода": ks_2samp(lg(tr.sum_kzt), lg(to.sum_kzt)).statistic,
        "KS день месяца": ks_2samp(tr.date.dt.day, to.date.dt.day).statistic,
        "KS in_deg (in>0)": ks_2samp(fr.in_deg[fr.in_deg > 0], fo.in_deg[fo.in_deg > 0]).statistic,
        "KS out_deg (out>0)": ks_2samp(fr.out_deg[fr.out_deg > 0], fo.out_deg[fo.out_deg > 0]).statistic,
        "KS log-вход узла (in>0)": ks_2samp(lg(fr.in_kzt[fr.in_kzt > 0]), lg(fo.in_kzt[fo.in_kzt > 0])).statistic,
    }


def fmt(v):
    if isinstance(v, (int, np.integer)):
        return f"{v:,}".replace(",", " ")
    if abs(v) >= 1000:
        return f"{v:,.0f}".replace(",", " ")
    return f"{v:.3f}".rstrip("0").rstrip(".") if v != int(v) else f"{int(v)}"


def closeness(rows):
    """Какой набор ближе к real по каждому свойству, не зависящему от масштаба: |log(x/real)|; KS — меньше лучше."""
    scale_free = [i for i in rows.index if not i.startswith(("узлов колено", "узлов", "seed", "рёбер", "переводов", "оборот",
                                                              "циклов", "слабых", "крупнейшая", "сообществ", "n_tx max"))
                  or "(доля)" in i or "на ребро" in i or "на узел" in i or i.startswith("переводов в") or "июля" in i]
    out = []
    for i in scale_free:
        if i.startswith("KS"):
            a, b = rows.at[i, "A"], rows.at[i, "B"]
        else:
            r = rows.at[i, "real"]
            if not r:
                continue
            a, b = (abs(np.log(max(rows.at[i, s], 1e-9) / r)) for s in ("A", "B"))
        out.append((i, "A" if a < b else "B" if b < a else "="))
    return out


if __name__ == "__main__":
    have = {k: d for k, d in SETS.items() if (d / "nodes.parquet").exists()}
    res = {k: facts(*load(d)) for k, d in have.items()}
    rows = pd.DataFrame({k: v[0] for k, v in res.items()})
    for k in have:
        if k != "real":
            for m, s in ks(res["real"], res[k]).items():
                rows.loc[m, k] = s
    for k in rows.columns:                                     # счётчики → доли, чтобы сравнивать наборы разного размера
        for d in range(5):
            rows.loc[f"доля колена {d} (доля)", k] = rows.at[f"узлов колено {d}", k] / rows.at["узлов", k]
        for c in ["seed без рёбер", "seed только получатели"]:
            rows.loc[f"{c} (доля)", k] = rows.at[c, k] / rows.at["seed", k]
        for c in ["узлов с ≥8 плательщиками", "узлов с веером ≥16", "узлов с пропуском 0,8–1,2 (не seed)",
                  "узлов отдали > получили (все)", "циклов длины ≤5"]:
            rows.loc[f"{c} на узел (доля)", k] = rows.at[c, k] / rows.at["узлов", k]
    if {"A", "B"} <= set(rows.columns):
        rows["ближе к real"] = ""
        for i, w in closeness(rows):
            rows.at[i, "ближе к real"] = w
    md = ["# Профиль выгрузок: real vs синтетика", "",
          "Считается `profile.py`. KS — статистика Колмогорова–Смирнова против real (0 — одинаковые распределения, 1 — не пересекаются).", "",
          "| Свойство | " + " | ".join(rows.columns) + " |", "|---|" + "---|" * len(rows.columns)]
    md += [f"| {i} | " + " | ".join("" if isinstance(x, str) or pd.isna(x) else fmt(x) for x in r[:len(have)])
           + ("" if len(r) == len(have) else f" | {r.iloc[-1]}") + " |" for i, r in rows.iterrows()]
    if "ближе к real" in rows:
        md += ["", "Ближе к real по свойствам без масштаба (|log(x/real)|, для KS — меньше): "
               + str(rows["ближе к real"].replace("", pd.NA).dropna().value_counts().to_dict())]
    for k in have:
        gt = HERE / {"A": "A_llm", "B": "B_abm"}.get(k, "-") / "ground_truth.csv"
        if gt.exists():
            g = pd.read_csv(gt).merge(pd.read_parquet(have[k] / "nodes.parquet"), on="gid")
            md += ["", f"## Разметка {k}: роль × вовлечённость (видимые узлы; в скобках — из них на колене 4)", ""]
            ct = pd.crosstab(g.functional_role, g.involvement)
            c4 = pd.crosstab(g[g.depth == 4].functional_role, g[g.depth == 4].involvement).reindex_like(ct).fillna(0).astype(int)
            md += ["| роль | " + " | ".join(ct.columns) + " |", "|---|" + "---|" * len(ct.columns)]
            md += [f"| {i} | " + " | ".join(f"{ct.at[i, c]} ({c4.at[i, c]})" for c in ct.columns) + " |" for i in ct.index]
            md += ["", "seed по вовлечённости: " + str(g[g.is_seed].involvement.value_counts().to_dict())]
            # метка ↔ деньги: видна ли заявленная функция в выгрузке (колена 1–3, не seed; сигнатуры — словами ТЗ, мягкие пороги)
            f = res[k][1].join(g.set_index("gid")[["functional_role", "involvement"]])
            f = f[f.depth.between(1, 3) & ~f.is_seed]
            p = f.out_kzt / f.in_kzt.where(f.in_kzt > 0)
            sig = {"consolidator": (f.in_deg >= 3) & (p.fillna(0) < 0.5), "transit": p.between(0.7, 1.3),
                   "distributor": f.out_deg >= 8, "terminal": (f.in_kzt > 0) & (p.fillna(0) < 0.3),
                   "coordinator": (f.in_deg >= 2) & (f.out_deg >= 2)}
            md += ["", f"Метка ↔ деньги ({k}, колена 1–3, не seed): доля узлов, у которых сигнатура роли видна в выгрузке. "
                   "consolidator: ≥3 плат. и пропуск <0,5; transit: пропуск 0,7–1,3; distributor: ≥8 получ.; "
                   "terminal: пропуск <0,3; coordinator: ≥2 плат. и ≥2 получ.", "",
                   "| роль | criminal | legit |", "|---|---|---|"]
            for role, s in sig.items():
                cells = []
                for inv in ("criminal", "legit"):
                    m = (f.functional_role == role) & (f.involvement == inv)
                    cells.append(f"{s[m].mean():.0%} из {m.sum()}" if m.sum() else "—")
                md += [f"| {role} | " + " | ".join(cells) + " |"]
    (HERE / "PROFILE.md").write_text("\n".join(md) + "\n")
    print("\n".join(md))

