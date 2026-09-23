#!/usr/bin/env python3
"""
«Граф денег» — полный пересчёт: parquet → out/*.csv.

    python3 pipeline/run.py --data task/data --out out

Шаги (каждый возвращает DataFrame):
    load_and_check → node_metrics → edge_metrics → clusters → roles → priority → write

Контракт файлов: docs/PIPELINE_CONTRACT.md.
"""

import argparse
import time
from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd

ROLES = ["consolidator", "transit", "distributor", "terminal", "coordinator", "peripheral"]

# ============================================================================
# ПОРОГИ И ПРАВИЛА РОЛЕЙ — настраивать здесь.
# ============================================================================
# Все пороги явные. Роль = первое сработавшее правило из RULES (порядок важен),
# если ни одно не сработало — FALLBACK (peripheral).
#
# role_score (0–1) — «доля порога»: ratio(x, t) = min(1, x / (2·t)).
#   Узел ровно на пороге получает 0.5, узел на 2× пороге и выше — 1.0.
#   Для правил с несколькими условиями берётся минимум по условиям
#   (уверенность ограничена самым слабым признаком).
#   Для transit: 1 − |pass_through − 1| / (2·TRANSIT_BAND) → 1.0 при pt = 1, 0.5 на краю коридора.
#   Для правил «нет данных» (no_edges, truncated) score фиксирован (см. таблицу).
T = dict(
    CONS_IN_DEG=5,          # consolidator: ≥ 5 разных плательщиков
    CONS_MAX_PT=0.5,        #   и дальше ушло < 50% полученного
    TRANSIT_BAND=0.2,       # transit: pass_through в [0.8, 1.2]
    DIST_OUT_DEG=10,        # distributor: ≥ 10 разных получателей
    COORD_IN_DEG=3,         # coordinator: ≥ 3 плательщиков
    COORD_OUT_DEG=10,       #   и ≥ 10 получателей
    COORD_BTW_Q=0.98,       #   и (в цикле ≤ 5 или betweenness в верхних 2%)
    TERM_IN_KZT=300_000,    # terminal: настоящий сток (колено 1–3, не seed, out=0), вход ≥ 300 000 KZT
                            #   (≈ 90-й перцентиль входа среди 1 079 стоков)
)


def ratio(x, t):
    return float(min(1.0, max(0.0, x / (2.0 * t))))


def fmt(x):
    """Число в формате ru-RU: пробел как разделитель тысяч."""
    return f"{x:,.0f}".replace(",", " ")


def pt_str(r):
    return "—" if pd.isna(r.pass_through) else f"{r.pass_through:.2f}"


# Каждое правило: (rule_id, role, predicate(row, ctx), score(row, ctx), evidence(row, ctx)).
# ctx — пороги, вычисленные по данным (например, перцентиль betweenness).
RULES = [
    # --- артефакты выгрузки: роль по поведению не определяется ---------------
    ("no_edges", "peripheral",
     lambda r, c: r.no_edges,
     lambda r, c: 1.0,
     lambda r, c: f"Нет рёбер в выгрузке: 0 входящих и 0 исходящих переводов ≥5 000 KZT за 07.2026"
                  f"{' (seed)' if r.is_seed else ''}; роль не определяется, нужна проверка вне графа"),

    ("truncated", "peripheral",
     lambda r, c: r.truncated_by_depth,
     lambda r, c: 0.3,   # низкая уверенность: исходящие просто не выгружены
     lambda r, c: f"Колено 4: обрыв 4-го колена, исходящие не выгружены. Получил {fmt(r.in_kzt)} KZT "
                  f"от {r.in_deg} плательщ.; сток это или транзит — по данным не видно"),

    # --- поведенческие роли ----------------------------------------------------
    ("coordinator", "coordinator",
     lambda r, c: r.in_deg >= T["COORD_IN_DEG"] and r.out_deg >= T["COORD_OUT_DEG"]
                  and (r.in_cycle or r.betweenness >= c["btw_q"]),
     lambda r, c: min(ratio(r.in_deg, T["COORD_IN_DEG"]), ratio(r.out_deg, T["COORD_OUT_DEG"])),
     lambda r, c: f"Признаки координатора: {r.in_deg} плательщ. → {r.out_deg} получат., "
                  f"betweenness {r.betweenness:.4f} (порог {c['btw_q']:.4f})"
                  f"{', в цикле ≤5' if r.in_cycle else ''}; вход {fmt(r.in_kzt)} KZT"),

    ("consolidator", "consolidator",
     lambda r, c: r.in_deg >= T["CONS_IN_DEG"] and pd.notna(r.pass_through)
                  and r.pass_through < T["CONS_MAX_PT"],
     lambda r, c: ratio(r.in_deg, T["CONS_IN_DEG"]),
     lambda r, c: f"Признаки консолидации: {fmt(r.in_kzt)} KZT от {r.in_deg} плательщ. "
                  f"({r.in_tx} переводов), дальше ушло {pt_str(r)} полученного (порог <{T['CONS_MAX_PT']})"),

    ("distributor", "distributor",
     # для seed вход занижен, поэтому правило смотрит только на исходящую сторону
     lambda r, c: r.out_deg >= T["DIST_OUT_DEG"],
     lambda r, c: ratio(r.out_deg, T["DIST_OUT_DEG"]),
     lambda r, c: f"Признаки распределения: {fmt(r.out_kzt)} KZT на {r.out_deg} получат. "
                  f"({r.out_tx} переводов, в среднем {fmt(r.avg_out_tx)} KZT)"
                  f"{'; seed, вход занижен' if r.is_seed else ''}"),

    ("transit", "transit",
     # seed исключены: их pass_through не имеет смысла (вход занижен выгрузкой)
     lambda r, c: (not r.is_seed) and r.in_deg >= 1 and r.out_deg >= 1 and pd.notna(r.pass_through)
                  and abs(r.pass_through - 1) <= T["TRANSIT_BAND"],
     lambda r, c: 1.0 - abs(r.pass_through - 1) / (2 * T["TRANSIT_BAND"]),
     lambda r, c: f"Признаки транзита: получил {fmt(r.in_kzt)} KZT, отправил {fmt(r.out_kzt)} KZT "
                  f"(pass-through {pt_str(r)}, коридор 0.8–1.2), {r.in_deg}→{r.out_deg} контрагентов"),

    ("terminal", "terminal",
     lambda r, c: r.real_sink and r.in_kzt >= T["TERM_IN_KZT"],
     lambda r, c: ratio(r.in_kzt, T["TERM_IN_KZT"]),
     lambda r, c: f"Признаки конечного получателя: колено {r.depth}, получил {fmt(r.in_kzt)} KZT "
                  f"от {r.in_deg} плательщ., исходящих ≥5 000 KZT нет (порог входа {fmt(T['TERM_IN_KZT'])})"),
]

FALLBACK = (
    "peripheral", "peripheral",
    # score: чем дальше от порогов consolidator/distributor, тем увереннее «периферия»
    lambda r, c: 1.0 - 0.5 * min(1.0, max(r.in_deg / T["CONS_IN_DEG"], r.out_deg / T["DIST_OUT_DEG"])),
    lambda r, c: f"Периферия: {r.in_deg} вход./{r.out_deg} исх. контрагентов, вход {fmt(r.in_kzt)} KZT, "
                 f"выход {fmt(r.out_kzt)} KZT — ниже порогов ролей",
)

# ============================================================================
# ПРИОРИТЕТ
# ============================================================================
# priority = Σ w_i · minmax(log1p(x_i)) + ROLE_BONUS_W · ROLE_BONUS[role]
#   log1p перед min-max, иначе 1–2 выброса по сумме сжимают всех остальных к нулю.
#   betweenness (~1e-3) перед log1p умножается на 1e6, чтобы логарифм реально сжимал хвост.
#   Веса в сумме = 1.0, поэтому priority ∈ [0, 1].
#   seed_share в приоритет сознательно НЕ входит (только колонка метрик).
#   Узлы с обрывом 4-го колена умножаются на TRUNC_PENALTY, чтобы не забивали топ.
PRIORITY_W = dict(in_kzt=0.20, out_kzt=0.20, in_deg=0.10, out_deg=0.10, betweenness=0.25)
ROLE_BONUS_W = 0.15
ROLE_BONUS = dict(coordinator=1.0, consolidator=0.9, distributor=0.8, transit=0.7, terminal=0.4, peripheral=0.0)
TRUNC_PENALTY = 0.5

LOUVAIN_SEED = 42
CYCLE_LEN = 5


# ============================================================================
# 1. загрузка и проверки
# ============================================================================
def load_and_check(data_dir: Path):
    edges = pd.read_parquet(data_dir / "edges.parquet")
    nodes = pd.read_parquet(data_dir / "nodes.parquet")
    tx = pd.read_parquet(data_dir / "transactions.parquet")
    tx["date"] = pd.to_datetime(tx["date"])
    nodes["is_seed"] = nodes["is_seed"].astype(bool)

    assert len(nodes) == 2248, len(nodes)
    assert len(edges) == 3119, len(edges)
    assert not nodes.gid.duplicated().any()
    assert not edges.duplicated(["src", "dst"]).any()
    agg = tx.groupby(["src", "dst"]).agg(s=("sum_kzt", "sum"), c=("sum_kzt", "size")).reset_index()
    m = edges.merge(agg, on=["src", "dst"], how="outer", indicator=True)
    assert (m._merge == "both").all(), "edges и transactions не сходятся по парам"
    assert ((m.sum_kzt - m.s).abs() <= 1).all(), "суммы edges != transactions"
    print(f"[load] узлов {len(nodes)}, рёбер {len(edges)}, транзакций {len(tx)}, seed {int(nodes.is_seed.sum())}")
    return edges, nodes, tx


# ============================================================================
# 2. метрики узлов
# ============================================================================
def node_metrics(edges, nodes, tx):
    G = nx.from_pandas_edgelist(edges, "src", "dst", edge_attr=["sum_kzt", "n_tx", "depth"],
                                create_using=nx.DiGraph)
    G.add_nodes_from(nodes.gid)

    df = nodes[["gid", "depth", "is_seed"]].set_index("gid")
    out_ = edges.groupby("src").agg(out_kzt=("sum_kzt", "sum"), out_tx=("n_tx", "sum"), out_deg=("dst", "nunique"))
    in_ = edges.groupby("dst").agg(in_kzt=("sum_kzt", "sum"), in_tx=("n_tx", "sum"), in_deg=("src", "nunique"))
    df = df.join([out_, in_])
    for c in ["out_kzt", "in_kzt"]:
        df[c] = df[c].fillna(0.0)
    for c in ["out_tx", "out_deg", "in_tx", "in_deg"]:
        df[c] = df[c].fillna(0).astype(int)

    pairs = pd.concat([edges[["src", "dst"]].set_axis(["gid", "cp"], axis=1),
                       edges[["dst", "src"]].set_axis(["gid", "cp"], axis=1)])
    df["n_counterparties"] = pairs.groupby("gid").cp.nunique().reindex(df.index).fillna(0).astype(int)

    act = pd.concat([tx[["src", "date"]].set_axis(["gid", "date"], axis=1),
                     tx[["dst", "date"]].set_axis(["gid", "date"], axis=1)])
    act = act.groupby("gid").date.agg(first_date="min", last_date="max", active_days="nunique")
    df = df.join(act)
    df["active_days"] = df.active_days.fillna(0).astype(int)

    df["pass_through"] = np.where(df.in_kzt > 0, df.out_kzt / df.in_kzt.where(df.in_kzt > 0), np.nan)
    df["truncated_by_depth"] = (df.depth == 4) & (df.out_deg == 0)
    df["real_sink"] = (df.depth < 4) & ~df.is_seed & (df.out_deg == 0)
    df["no_edges"] = (df.in_deg + df.out_deg) == 0

    df["pagerank"] = pd.Series(nx.pagerank(G, weight="sum_kzt"))
    df["betweenness"] = pd.Series(nx.betweenness_centrality(G))   # точный, невзвешенный

    comps = sorted(nx.weakly_connected_components(G), key=len, reverse=True)
    df["component"] = pd.Series({n: i for i, c in enumerate(comps) for n in c})
    df["component_size"] = df.groupby("component").depth.transform("size")

    cyc_nodes = {n for c in nx.simple_cycles(G, length_bound=CYCLE_LEN) for n in c}
    df["in_cycle"] = df.index.isin(cyc_nodes)

    day = tx.date.dt.date
    burst = tx.groupby(["src", "dst", day]).size()
    burst = burst[burst >= 2].reset_index()
    df["same_day_bursts"] = (burst.src.value_counts().reindex(df.index).fillna(0)
                             + burst.dst.value_counts().reindex(df.index).fillna(0)).astype(int)

    df["avg_in_tx"] = np.where(df.in_tx > 0, df.in_kzt / df.in_tx.where(df.in_tx > 0), 0.0)
    df["avg_out_tx"] = np.where(df.out_tx > 0, df.out_kzt / df.out_tx.where(df.out_tx > 0), 0.0)

    # доля «seed-денег»: итеративное распространение от seed по рёбрам (probe-0, ячейка 11)
    idx = {g: i for i, g in enumerate(df.index)}
    s = edges.src.map(idx).values
    d = edges.dst.map(idx).values
    w = edges.sum_kzt.values
    denom = np.maximum(df.in_kzt.values, df.out_kzt.values)
    seed_arr = df.is_seed.values
    share = seed_arr.astype(float)
    for _ in range(300):
        contrib = np.bincount(d, weights=w * share[s], minlength=len(df))
        new = np.where(denom > 0, np.minimum(contrib / np.where(denom > 0, denom, 1), 1), 0)
        new[seed_arr] = 1.0
        done = np.abs(new - share).max() < 1e-10
        share = new
        if done:
            break
    df["seed_money_in"] = np.bincount(d, weights=w * share[s], minlength=len(df))
    df["seed_share"] = share

    print(f"[node_metrics] компонент {len(comps)}, узлов в циклах ≤{CYCLE_LEN}: {int(df.in_cycle.sum())}")
    return df.reset_index(), G


# ============================================================================
# 3. метрики рёбер
# ============================================================================
def edge_metrics(edges, tx, nm):
    ta = tx.groupby(["src", "dst"]).agg(min_tx=("sum_kzt", "min"), max_tx=("sum_kzt", "max"),
                                        first_date=("date", "min"), last_date=("date", "max"),
                                        active_days=("date", "nunique")).reset_index()
    dep = nm.set_index("gid").depth
    em = edges.merge(ta, on=["src", "dst"], how="left")
    em["src_depth"] = em.src.map(dep)
    em["dst_depth"] = em.dst.map(dep)
    pair_set = set(zip(edges.src, edges.dst))
    em["mutual"] = [(b, a) in pair_set for a, b in zip(em.src, em.dst)]
    em["back_edge"] = em.dst_depth <= em.src_depth
    return em[["src", "dst", "sum_kzt", "n_tx", "depth", "src_depth", "dst_depth", "min_tx", "max_tx",
               "first_date", "last_date", "active_days", "mutual", "back_edge"]]


# ============================================================================
# 4. кластеры (Louvain на НЕОРИЕНТИРОВАННОЙ проекции — направление теряется,
#    вес = сумма sum_kzt в обе стороны; seed зафиксирован)
# ============================================================================
def clusters(G, nm):
    U = nx.Graph()
    for u, v, dd in G.edges(data=True):
        if U.has_edge(u, v):
            U[u][v]["w"] += dd["sum_kzt"]
        else:
            U.add_edge(u, v, w=dd["sum_kzt"])
    comms = nx.community.louvain_communities(U, weight="w", seed=LOUVAIN_SEED)
    comms = sorted(comms, key=lambda c: (-len(c), min(c)))
    lab = {n: i for i, c in enumerate(comms) for n in c}
    nxt = len(comms)
    for g in nm.gid[nm.no_edges]:          # узлы без рёбер — каждый свой кластер после Louvain
        lab[g] = nxt
        nxt += 1
    cl = pd.DataFrame({"gid": nm.gid, "cluster_id": nm.gid.map(lab).astype(int)})
    print(f"[clusters] Louvain: {len(comms)} сообществ + {int(nm.no_edges.sum())} изолированных")
    return cl


# ============================================================================
# 5. роли
# ============================================================================
def roles(nm):
    ctx = {"btw_q": float(nm.betweenness.quantile(T["COORD_BTW_Q"]))}
    out = []
    for r in nm.itertuples(index=False):
        for rule_id, role, pred, score, ev in RULES:
            if pred(r, ctx):
                break
        else:
            rule_id, role, score, ev = FALLBACK
        text = ev(r, ctx)
        assert len(text) <= 200, (r.gid, len(text), text)
        out.append((r.gid, role, round(score(r, ctx), 4), rule_id, text))
    return pd.DataFrame(out, columns=["gid", "role", "role_score", "role_rule", "evidence"])


# ============================================================================
# 6. приоритет
# ============================================================================
def priority(nm, rl):
    df = nm.merge(rl[["gid", "role"]], on="gid")
    p = np.zeros(len(df))
    for col, w in PRIORITY_W.items():
        x = np.log1p(df[col].astype(float) * (1e6 if col == "betweenness" else 1))
        rng = x.max() - x.min()
        p += w * ((x - x.min()) / rng if rng > 0 else 0)
    p += ROLE_BONUS_W * df.role.map(ROLE_BONUS).values
    p = np.where(df.truncated_by_depth, p * TRUNC_PENALTY, p)
    return pd.DataFrame({"gid": df.gid, "priority_score": np.clip(p, 0, 1).round(6)})


CLUSTER_HYP = {
    "consolidator": "признаки сбора средств в узлах-консолидаторах",
    "distributor": "признаки веерной рассылки средств",
    "transit": "признаки транзитной цепочки",
    "coordinator": "признаки узла-координатора между сбором и рассылкой",
    "terminal": "признаки оседания средств у конечных получателей",
}


def cluster_table(cl, nr, edges, nm):
    df = nr.merge(nm[["gid", "is_seed", "in_kzt", "out_kzt"]], on="gid")
    lab = cl.set_index("gid").cluster_id
    e = edges.assign(cs=edges.src.map(lab), cd=edges.dst.map(lab))
    internal = e[e.cs == e.cd].groupby("cs").sum_kzt.sum()
    rows = []
    for cid, g in df.groupby("cluster_id"):
        g = g.sort_values("priority_score", ascending=False)
        n, ns = len(g), int(g.is_seed.sum())
        s = float(internal.get(cid, 0.0))
        rc = g.role.value_counts()
        active = rc.drop("peripheral", errors="ignore")
        if n == 1 and s == 0:
            hyp = f"Изолированный узел{' (seed)' if ns else ''}: 0 рёбер в выгрузке, гипотеза не формируется"
        else:
            roles_txt = ", ".join(f"{k} {v}" for k, v in rc.head(3).items())
            lead = CLUSTER_HYP.get(active.index[0], "") if len(active) else ""
            hyp = (f"Гипотеза для проверки: {n} узлов, {ns} seed, внутренний оборот {fmt(s)} KZT; "
                   f"роли: {roles_txt}"
                   + (f"; {lead} ({active.iloc[0]} узл.)" if lead else "; активных ролей нет, периферийная группа")
                   + ("; несколько seed в одном сообществе — возможна общая схема" if ns > 1 else ""))
        rows.append((cid, n, ns, round(s, 2), ";".join(str(x) for x in g.gid.head(5)), hyp))
    return pd.DataFrame(rows, columns=["cluster_id", "n_nodes", "n_seed", "sum_kzt_internal", "top_gids", "hypothesis"])


def top_table(nr, nm, k=50):
    df = nr.merge(nm[["gid", "betweenness", "in_kzt", "out_kzt"]], on="gid")
    df = df.sort_values("priority_score", ascending=False).head(k).reset_index(drop=True)
    df["rank"] = np.arange(1, len(df) + 1)
    df["why"] = [f"{ev} | приоритет {p:.3f}: вход+выход {fmt(i + o)} KZT, betweenness {b:.4f}, кластер {c}"
                 for ev, p, i, o, b, c in zip(df.evidence, df.priority_score, df.in_kzt, df.out_kzt,
                                              df.betweenness, df.cluster_id)]
    return df[["rank", "gid", "role", "priority_score", "why"]]


# ============================================================================
# 7. запись
# ============================================================================
def _prep(df):
    df = df.copy()
    for c in df.columns:
        if df[c].dtype == bool:
            df[c] = df[c].map({True: "true", False: "false"})
        elif pd.api.types.is_datetime64_any_dtype(df[c]):
            df[c] = df[c].dt.strftime("%Y-%m-%d").fillna("")
    for c in ["gid", "src", "dst"]:
        if c in df.columns:
            df[c] = df[c].astype("int64")
    return df


def write(out_dir: Path, tables: dict):
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, df in tables.items():
        _prep(df).to_csv(out_dir / f"{name}.csv", index=False, encoding="utf-8")
        print(f"[write] {out_dir / name}.csv  {len(df)} строк")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="task/data")
    ap.add_argument("--out", default="out")
    a = ap.parse_args()
    t0 = time.time()

    edges, nodes, tx = load_and_check(Path(a.data))
    nm, G = node_metrics(edges, nodes, tx)
    em = edge_metrics(edges, tx, nm)
    cl = clusters(G, nm)
    nm = nm.merge(cl, on="gid")
    rl = roles(nm)
    pr = priority(nm, rl)

    nr = (nm[["gid"]].merge(rl, on="gid").merge(cl, on="gid").merge(pr, on="gid")
          [["gid", "role", "role_score", "cluster_id", "priority_score", "evidence", "role_rule"]])
    ct = cluster_table(cl, nr, edges, nm)
    tp = top_table(nr, nm)

    nm_cols = ["gid", "depth", "is_seed", "in_deg", "out_deg", "in_kzt", "out_kzt", "in_tx", "out_tx",
               "n_counterparties", "first_date", "last_date", "active_days", "pass_through",
               "truncated_by_depth", "real_sink", "no_edges", "pagerank", "betweenness", "component",
               "component_size", "in_cycle", "same_day_bursts", "avg_in_tx", "avg_out_tx",
               "seed_money_in", "seed_share", "cluster_id"]
    write(Path(a.out), {"nodes_roles": nr, "clusters": ct, "top_nodes": tp,
                        "node_metrics": nm[nm_cols], "edge_metrics": em})
    print(f"[done] {time.time() - t0:.1f} s")


if __name__ == "__main__":
    main()
