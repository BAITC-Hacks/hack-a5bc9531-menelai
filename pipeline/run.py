#!/usr/bin/env python3
"""
Пайплайн кейса «Граф денег» (HackAlem AI, AML).

Реализует pipeline/RULES.md v1: метрики → «окрашенные деньги» → временные паттерны →
циклы → каскад ролей → кластеры Louvain → priority → выгрузки → проверки.

Запуск:  uv run python run.py --data ../task/data --out ../out
Никаких LLM и внешних сервисов: всё детерминированным кодом.
"""

import argparse
import json
import time
from collections import defaultdict
from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd

ROLES = ["coordinator", "consolidator", "distributor", "transit", "terminal", "peripheral"]
ROLE_RU = {"coordinator": "координации", "consolidator": "консолидации", "distributor": "веерной раздачи",
           "transit": "транзита", "terminal": "конечного получателя", "peripheral": "периферии"}
ROLE_WEIGHT = {"coordinator": 1.0, "consolidator": 0.9, "distributor": 0.7,
               "transit": 0.6, "terminal": 0.5, "peripheral": 0.2}

# Пороги RULES.md §1 (источник порога — там же)
T = dict(
    coord_in_deg=3, coord_out_deg=3, coord_seed_up=2, coord_betw_pct=0.95,
    cons_in_deg=3, cons_pass_max=0.3, cons_in_kzt=200_000,
    dist_out_deg=15, dist_ratio=3,
    tr_pass_lo=0.8, tr_pass_hi=1.2, tr_in_kzt=100_000,
    term_pass_max=0.3, term_in_kzt=200_000,
    seed_up_hops=4, cycle_len=5, fast_days=2, sync_payers=3,
    louvain_seed=42,
)


# ------------------------------------------------------------------ форматирование

def kzt(x) -> str:
    """4217500 → '4 217 500 ₸'"""
    return f"{x:,.0f}".replace(",", " ") + " ₸"


def dec(x, nd=2) -> str:
    """0.034 → '0,03'; NaN → 'н/д'"""
    return "н/д" if pd.isna(x) else f"{x:.{nd}f}".replace(".", ",")


def pct_str(x) -> str:
    return f"{100 * x:.0f}%"


# ------------------------------------------------------------------ load

def load(data_dir: Path):
    edges = pd.read_parquet(data_dir / "edges.parquet")
    nodes = pd.read_parquet(data_dir / "nodes.parquet")
    tx = pd.read_parquet(data_dir / "transactions.parquet")
    tx["date"] = pd.to_datetime(tx["date"])
    assert nodes.gid.dtype == np.int64 and edges.src.dtype == np.int64 and edges.dst.dtype == np.int64
    assert nodes.gid.nunique() == len(nodes) == 2248
    # edges == Σ transactions (как в starter.sanity_check)
    agg = tx.groupby(["src", "dst"]).agg(s=("sum_kzt", "sum"), c=("sum_kzt", "size")).reset_index()
    m = edges.merge(agg, on=["src", "dst"], how="outer", indicator=True)
    assert (m._merge == "both").all() and ((m.sum_kzt - m.s).abs() < 0.5).all(), "edges ≠ transactions"
    return edges, nodes, tx


def build_graph(edges, nodes) -> nx.DiGraph:
    G = nx.DiGraph()
    G.add_nodes_from(nodes.gid.tolist())          # 19 seed без рёбер тоже в графе
    for r in edges.itertuples(index=False):
        G.add_edge(int(r.src), int(r.dst), sum_kzt=float(r.sum_kzt), n_tx=int(r.n_tx))
    return G


# ------------------------------------------------------------------ features

def features(G, edges, nodes) -> pd.DataFrame:
    f = nodes.set_index("gid")[["depth", "is_seed"]].copy()
    f["is_seed"] = f.is_seed.astype(bool)
    f["in_deg"] = edges.groupby("dst").src.nunique().reindex(f.index, fill_value=0).astype(int)
    f["out_deg"] = edges.groupby("src").dst.nunique().reindex(f.index, fill_value=0).astype(int)
    f["in_kzt"] = edges.groupby("dst").sum_kzt.sum().reindex(f.index, fill_value=0.0)
    f["out_kzt"] = edges.groupby("src").sum_kzt.sum().reindex(f.index, fill_value=0.0)
    f["in_tx"] = edges.groupby("dst").n_tx.sum().reindex(f.index, fill_value=0).astype(int)
    f["out_tx"] = edges.groupby("src").n_tx.sum().reindex(f.index, fill_value=0).astype(int)
    # NaN, если входа нет (у seed вход занижен выгрузкой — pass_through у них недостоверен)
    f["pass_through"] = np.where(f.in_kzt > 0, f.out_kzt / f.in_kzt.replace(0, np.nan), np.nan)
    # ЛОВУШКА: 4-е колено без исходящих — обход оборвался, это не «сток»
    f["truncated"] = (f.depth == 4) & (f.out_deg == 0)
    f["isolated"] = (f.in_deg + f.out_deg) == 0
    seeds = set(f.index[f.is_seed])
    from_seed = edges[edges.src.isin(seeds)]
    f["in_from_seed_deg"] = from_seed.groupby("dst").src.nunique().reindex(f.index, fill_value=0).astype(int)

    f["pagerank"] = pd.Series(nx.pagerank(G, weight="sum_kzt"))
    f["betweenness"] = pd.Series(nx.betweenness_centrality(G))  # точный, без весов

    # сколько разных seed достигают узла по направленным путям ≤ 4 шагов (сам seed не считается)
    up = defaultdict(int)
    for s in sorted(seeds):
        for v in nx.single_source_shortest_path_length(G, s, cutoff=T["seed_up_hops"]):
            if v != s:
                up[v] += 1
    f["n_seed_upstream"] = pd.Series(up).reindex(f.index, fill_value=0).astype(int)
    return f


# ------------------------------------------------------------------ seed_share (логика Даурена, «Пункт 4»)

def seed_share(f, edges):
    """Пропорциональное смешивание: доля «seed-денег» в узле, итерация до сходимости.
    Знаменатель max(in, out): невидимый вход (out > in) считается «чистым» — консервативно."""
    idx = {g: i for i, g in enumerate(f.index)}
    s = edges.src.map(idx).values
    d = edges.dst.map(idx).values
    w = edges.sum_kzt.values
    denom = np.maximum(f.in_kzt.values, f.out_kzt.values)
    seed_arr = f.is_seed.values
    share = seed_arr.astype(float)
    for _ in range(300):
        contrib = np.bincount(d, weights=w * share[s], minlength=len(f))
        new = np.where(denom > 0, np.minimum(contrib / np.where(denom > 0, denom, 1), 1), 0)
        new[seed_arr] = 1.0
        done = np.abs(new - share).max() < 1e-10
        share = new
        if done:
            break
    f["seed_share"] = share
    f["seed_money_in"] = np.bincount(d, weights=w * share[s], minlength=len(f))


# ------------------------------------------------------------------ temporal

def temporal(f, tx):
    """fast_out_share: доля исходящей суммы, у которой был входящий перевод за 0..2 дня до.
    sync_in_events: дни, когда ≥3 разных плательщика перевели узлу в один день."""
    inc = tx[["dst", "date"]].rename(columns={"dst": "gid", "date": "in_date"}).drop_duplicates()
    inc = inc.sort_values("in_date", kind="mergesort")
    out = tx[["src", "date", "sum_kzt"]].rename(columns={"src": "gid"}).sort_values("date", kind="mergesort")
    m = pd.merge_asof(out, inc, left_on="date", right_on="in_date", by="gid",
                      direction="backward", tolerance=pd.Timedelta(days=T["fast_days"]))
    m["fast"] = m.in_date.notna() * m.sum_kzt
    g = m.groupby("gid").agg(fast=("fast", "sum"), tot=("sum_kzt", "sum"))
    fs = (g.fast / g.tot).reindex(f.index)
    # нет входа или выхода → быстрого вывода не было: 0 (а не NaN, чтобы колонка была заполнена)
    f["fast_out_share"] = fs.where((f.in_deg > 0) & (f.out_deg > 0)).fillna(0.0)

    sync = tx.groupby(["dst", "date"]).src.nunique().reset_index()
    sync = sync[sync.src >= T["sync_payers"]]
    f["sync_in_events"] = sync.groupby("dst").size().reindex(f.index, fill_value=0).astype(int)
    sync_days = {int(k): sorted(d.dt.strftime("%Y-%m-%d").tolist()) for k, d in sync.groupby("dst").date}
    return sync_days


# ------------------------------------------------------------------ cycles (логика «Пункт 10»)

def cycles(G, f):
    cyc = list(nx.simple_cycles(G, length_bound=T["cycle_len"]))
    per = defaultdict(list)
    for c in cyc:
        # каноническая форма: начинаем с минимального gid — чтобы вывод не зависел от порядка обхода
        i = c.index(min(c))
        c = c[i:] + c[:i]
        for v in c:
            per[v].append(c)
    per = {v: sorted(cs, key=lambda c: (len(c), c))[:3] for v, cs in per.items()}
    f["in_cycle"] = f.index.isin(list(per))
    f["n_cycles"] = pd.Series({v: sum(1 for c in cyc if v in c) for v in per}).reindex(f.index, fill_value=0).astype(int)
    return per, len(cyc)


# ------------------------------------------------------------------ roles

def margin_ge(v, thr):
    return float(np.clip((v - thr) / thr, 0, 1))


def margin_le(v, thr):
    return float(np.clip((thr - v) / thr, 0, 1))


def roles(f):
    """Каскад RULES.md §1 сверху вниз, первое сработавшее правило даёт роль."""
    both = (f.in_deg > 0) & (f.out_deg > 0)
    betw_thr = float(f.loc[both, "betweenness"].quantile(T["coord_betw_pct"]))
    T["coord_betw_thr"] = betw_thr

    role, score, rule_hit = [], [], []
    for g, r in f.iterrows():
        pt = r.pass_through
        seed_link = r.in_cycle or r.n_seed_upstream >= T["coord_seed_up"] or (r.is_seed and r.in_from_seed_deg > 0)
        # условия каждого правила (для peripheral считаем, насколько узел «почти» подошёл)
        conds = {
            "coordinator": [r.in_deg >= T["coord_in_deg"], r.out_deg >= T["coord_out_deg"], seed_link,
                            r.betweenness >= betw_thr],
            "consolidator": [r.in_deg >= T["cons_in_deg"], pd.notna(pt) and pt < T["cons_pass_max"],
                             r.in_kzt >= T["cons_in_kzt"]],
            "distributor": [r.out_deg >= T["dist_out_deg"], r.out_deg >= T["dist_ratio"] * r.in_deg],
            "transit": [r.in_deg >= 1, r.out_deg >= 1, pd.notna(pt) and T["tr_pass_lo"] <= pt <= T["tr_pass_hi"],
                        r.in_kzt >= T["tr_in_kzt"], not r.is_seed],
            "terminal": [r.depth in (1, 2, 3), (r.out_deg == 0) or (pd.notna(pt) and pt < T["term_pass_max"]),
                         r.in_kzt >= T["term_in_kzt"], not r.is_seed],
        }
        if r.truncated or (r.is_seed and r.isolated):          # правило 0: нет данных
            role.append("peripheral"); score.append(1.0); rule_hit.append("nodata")
            continue
        hit = next((k for k, c in conds.items() if all(c)), None)
        if hit is None:
            # ИНТЕРПРЕТАЦИЯ §2 для peripheral: 1 − 0,6 × (доля выполненных условий ближайшей роли)
            near = max(sum(c) / len(c) for c in conds.values())
            role.append("peripheral"); score.append(1 - 0.6 * near); rule_hit.append("none")
            continue
        # ИНТЕРПРЕТАЦИЯ §2: «на пороге ≈ 0,5» → score = 0,5 + 0,5 × mean(запасов над порогами)
        mg = {
            "coordinator": [margin_ge(r.in_deg, T["coord_in_deg"]), margin_ge(r.out_deg, T["coord_out_deg"]),
                            margin_ge(r.betweenness, betw_thr), margin_ge(r.n_seed_upstream, T["coord_seed_up"])],
            "consolidator": [margin_ge(r.in_deg, T["cons_in_deg"]), margin_le(pt, T["cons_pass_max"]),
                             margin_ge(r.in_kzt, T["cons_in_kzt"])],
            "distributor": [margin_ge(r.out_deg, T["dist_out_deg"]),
                            1.0 if r.in_deg == 0 else margin_ge(r.out_deg, T["dist_ratio"] * r.in_deg)],
            "transit": [float(np.clip(1 - abs(pt - 1) / 0.2, 0, 1)), margin_ge(r.in_kzt, T["tr_in_kzt"])],
            "terminal": [margin_le(0 if pd.isna(pt) else pt, T["term_pass_max"]), margin_ge(r.in_kzt, T["term_in_kzt"])],
        }[hit]
        role.append(hit); score.append(0.5 + 0.5 * float(np.mean(mg))); rule_hit.append(hit)
    f["role"] = role
    f["role_score"] = np.round(score, 4)
    f["rule_hit"] = rule_hit


# ------------------------------------------------------------------ clusters

def clusters(G, f):
    """Louvain на неориентированной проекции, вес = сумма переводов в обе стороны, seed=42."""
    U = nx.Graph()
    U.add_nodes_from(G.nodes)
    for u, v, d in G.edges(data=True):
        if U.has_edge(u, v):
            U[u][v]["w"] += d["sum_kzt"]
        else:
            U.add_edge(u, v, w=d["sum_kzt"])
    comms = nx.community.louvain_communities(U, weight="w", seed=T["louvain_seed"])
    comms = sorted(comms, key=lambda c: (-len(c), min(c)))     # детерминированные id: крупные первыми
    f["cluster_id"] = pd.Series({v: i for i, c in enumerate(comms) for v in c}).reindex(f.index).astype(int)
    return comms


def cluster_table(G, f, comms):
    rows = []
    for i, c in enumerate(comms):
        ff = f.loc[sorted(c)]
        internal = sum(d["sum_kzt"] for _, _, d in G.subgraph(c).edges(data=True))
        top = ff.sort_values(["priority_score", "in_kzt"], ascending=[False, False], kind="mergesort")
        n_seed = int(ff.is_seed.sum())
        rc = ff.role.value_counts()
        rc = rc.reindex([r for r in ROLES if r in rc.index])
        big = ff.assign(v=np.maximum(ff.in_kzt, ff.out_kzt)).sort_values("v", ascending=False, kind="mergesort").iloc[0]
        roles_txt = ", ".join(f"{k} {v}" for k, v in rc.items())
        if len(c) == 1:
            r = ff.iloc[0]
            hyp = ("изолированный seed без переводов в выгрузке — нет данных для гипотезы" if r.isolated
                   else f"одиночный узел ({r.role}), связей внутри кластера нет")
        else:
            n_c = int(rc.get("coordinator", 0)); n_cons = int(rc.get("consolidator", 0))
            n_d = int(rc.get("distributor", 0)); n_t = int(rc.get("transit", 0)); n_term = int(rc.get("terminal", 0))
            # приоритет — от самой информативной роли внутри кластера (как в каскаде ролей)
            if n_c:
                kind = ("признаки координирующего ядра: узлы и собирают, и раздают, стоят между частями сети"
                        + (f"; в кластере {n_seed} seed" if n_seed >= 2 else ""))
            elif n_cons:
                kind = "признаки консолидации: деньги от нескольких плательщиков стекаются и остаются"
            elif n_d:
                kind = "признаки веерной раздачи средств от узла-источника"
            elif n_t >= 2:
                kind = "признаки транзитной цепочки (деньги проходят без задержки)"
            elif n_term:
                kind = "признаки накопления у конечных получателей"
            else:
                kind = "выраженных признаков ролей нет, периферийная группа"
            hyp = (f"Гипотеза: {kind}. {len(c)} узлов, seed {n_seed} ({pct_str(n_seed / len(c))}); роли: {roles_txt}; "
                   f"крупнейший узел {int(big.name)} ({big.role}, оборот {kzt(big.v)}); внутр. оборот {kzt(internal)}")
        rows.append(dict(cluster_id=i, n_nodes=len(c), n_seed=n_seed, sum_kzt_internal=round(internal),
                         top_gids=";".join(str(int(g)) for g in top.index[:5]), hypothesis=hyp))
    return pd.DataFrame(rows)


# ------------------------------------------------------------------ priority

def priority(f):
    """base = mean(pct seed_money_in, pct n_seed_upstream, pct in_kzt (у seed — out_kzt), pct betweenness) × вес роли."""
    pct = lambda s: s.rank(pct=True, method="average")
    p_in = pct(f.in_kzt).where(~f.is_seed, pct(f.out_kzt))    # у seed вход занижен выгрузкой
    base = (pct(f.seed_money_in) + pct(f.n_seed_upstream) + p_in + pct(f.betweenness)) / 4
    f["priority_score"] = np.round(base * f.role.map(ROLE_WEIGHT), 4)


# ------------------------------------------------------------------ evidence / why

def evidence(r) -> str:
    sd = "сам seed" if r.is_seed else f"seed-денег {pct_str(r.seed_share)}"   # у seed доля = 1 по построению
    if r.rule_hit == "nodata":
        if r.isolated:
            return "нет данных: seed без переводов в выгрузке (ни одного ребра)"
        return f"нет данных: колено 4, исходящие не выгружены; вход {kzt(r.in_kzt)} от {r.in_deg} плат."
    if r.role == "coordinator":
        link = "цикл" if r.in_cycle else ""
        link = ", ".join(x for x in [link, f"seed выше {r.n_seed_upstream}"] if x)
        return (f"coordinator: ≥3 плат., ≥3 получ., посредн. ≥p95, связь с ≥2 seed/цикл; факт: {r.in_deg} плат., "
                f"{r.out_deg} получ., betw {dec(r.betweenness, 4)}, {link}, {sd}")
    if r.role == "consolidator":
        return (f"consolidator: ≥3 плат., пропуск <0,3, вход ≥200 тыс.; факт: {r.in_deg} плат., {kzt(r.in_kzt)}, "
                f"пропуск {dec(r.pass_through)}, {sd}")
    if r.role == "distributor":
        return (f"distributor: ≥15 получ., получ. ≥3×плат.; факт: {r.out_deg} получ. от {r.in_deg} плат., "
                f"отдал {kzt(r.out_kzt)}, {sd}")
    if r.role == "transit":
        return (f"transit: пропуск 0,8–1,2, вход ≥100 тыс.; факт: вход {kzt(r.in_kzt)}, выход {kzt(r.out_kzt)}, "
                f"пропуск {dec(r.pass_through)}, вывод ≤2 дн. {pct_str(r.fast_out_share) if pd.notna(r.fast_out_share) else 'н/д'}")
    if r.role == "terminal":
        return (f"terminal: колено 1–3, пропуск <0,3, вход ≥200 тыс.; факт: колено {r.depth}, вход {kzt(r.in_kzt)} "
                f"от {r.in_deg} плат., пропуск {dec(r.pass_through)}, {sd}")
    return (f"peripheral: признаков роли не выявлено; факт: {r.in_deg} плат., вход {kzt(r.in_kzt)}, "
            f"{r.out_deg} получ., выход {kzt(r.out_kzt)}, пропуск {dec(r.pass_through)}")


def why(r, sync_days) -> str:
    parts = [f"Гипотеза: признаки {ROLE_RU[r.role]} ({r.role}, уверенность {dec(r.role_score)})."]
    parts.append(f"Получил {kzt(r.in_kzt)} от {r.in_deg} плат. ({r.in_tx} пер.), отдал {kzt(r.out_kzt)} "
                 f"{r.out_deg} получ. ({r.out_tx} пер.), пропуск {dec(r.pass_through)}.")
    if r.is_seed:
        parts.append("Seed-клиент: вход занижен выгрузкой, масштаб оценён по исходящим.")
    share = "узел сам seed" if r.is_seed else f"доля в узле {pct_str(r.seed_share)}"
    parts.append(f"Выше по потоку (≤4 шага) {r.n_seed_upstream} seed; «красные» (seed) деньги на входе "
                 f"{kzt(r.seed_money_in)}, {share}.")
    extra = []
    if r.in_cycle:
        extra.append(f"участвует в {r.n_cycles} цикл. ≤5 шагов (возвратный поток)")
    if r.sync_in_events:
        extra.append(f"{r.sync_in_events} дн. синхронных входов ≥3 плат. ({', '.join(sync_days.get(r.name, [])[:3])})")
    if pd.notna(r.fast_out_share) and r.fast_out_share > 0:
        extra.append(f"{pct_str(r.fast_out_share)} выхода ушло ≤2 дн. после входа")
    if extra:
        parts.append("Также: " + "; ".join(extra) + ".")
    parts.append(f"Посредничество {dec(r.betweenness, 4)}, кластер {r.cluster_id}, приоритет {dec(r.priority_score, 3)}.")
    return " ".join(parts)


# ------------------------------------------------------------------ outputs

METRICS = ["in_deg", "out_deg", "in_kzt", "out_kzt", "in_tx", "out_tx", "pass_through", "seed_share", "seed_money_in",
           "n_seed_upstream", "betweenness", "pagerank", "in_cycle", "fast_out_share", "sync_in_events",
           "truncated", "depth", "is_seed"]


def jnum(x):
    if isinstance(x, (bool, np.bool_)):
        return bool(x)
    if isinstance(x, (int, np.integer)):
        return int(x)
    if isinstance(x, (float, np.floating)):
        return None if np.isnan(x) else float(round(float(x), 6))
    return x


def top_links(edges, g, side):
    key, other = ("dst", "src") if side == "in" else ("src", "dst")
    e = edges[edges[key] == g].sort_values(["sum_kzt", other], ascending=[False, True], kind="mergesort").head(5)
    # ЛОВУШКА: iterrows на числовом фрейме приводит строку к float64 и портит gid > 2^53 — только itertuples
    return [dict(gid=str(int(getattr(x, other))), sum_kzt=round(float(x.sum_kzt)), n_tx=int(x.n_tx))
            for x in e.itertuples(index=False)]


def outputs(f, edges, ctab, per_cycles, sync_days, out_dir: Path, meta):
    out_dir.mkdir(parents=True, exist_ok=True)
    f = f.sort_values(["priority_score"], ascending=False, kind="mergesort")
    f = f.reset_index().sort_values(["priority_score", "gid"], ascending=[False, True], kind="mergesort")
    assert f.gid.dtype == np.int64 and f.gid.nunique() == 2248

    nr = f[["gid", "role", "role_score", "cluster_id", "priority_score", "evidence"] + METRICS].copy()
    for c in ["in_kzt", "out_kzt", "seed_money_in"]:
        nr[c] = nr[c].round(2)
    for c in ["pass_through", "seed_share", "fast_out_share"]:
        nr[c] = nr[c].round(4)
    nr["betweenness"] = nr.betweenness.round(8)
    nr["pagerank"] = nr.pagerank.round(8)
    nr.to_csv(out_dir / "nodes_roles.csv", index=False)

    ctab.to_csv(out_dir / "clusters.csv", index=False)

    top = f.head(30).copy()
    top.insert(0, "rank", range(1, len(top) + 1))
    tt = top.set_index("gid")
    top["why"] = [why(tt.loc[g], sync_days) for g in top.gid]
    top[["rank", "gid", "role", "priority_score", "why"]].to_csv(out_dir / "top_nodes.csv", index=False)

    nm = {}
    for r in f.itertuples(index=False):
        g = int(r.gid)
        d = {k: jnum(getattr(r, k)) for k in METRICS}
        d.update(role=r.role, role_score=jnum(r.role_score), priority_score=jnum(r.priority_score),
                 cluster_id=int(r.cluster_id), evidence=r.evidence,
                 cycles=[[str(int(v)) for v in c] for c in per_cycles.get(g, [])],
                 sync_days=sync_days.get(g, []),
                 top_in=top_links(edges, g, "in"), top_out=top_links(edges, g, "out"))
        nm[str(g)] = d
    nm["_meta"] = meta
    (out_dir / "node_metrics.json").write_text(json.dumps(nm, ensure_ascii=False, indent=1))
    return nr, top


# ------------------------------------------------------------------ checks

def checks(nr, top, ctab, out_dir: Path):
    assert len(nr) == 2248 and nr.gid.nunique() == 2248 and nr.gid.dtype == np.int64
    assert nr.role.isin(ROLES).all()
    assert nr.role_score.between(0, 1).all() and nr.priority_score.between(0, 1).all()
    ev = nr.evidence.astype(str)
    assert (ev.str.len() > 0).all() and (ev.str.len() <= 200).all(), ev[ev.str.len() > 200].head()
    assert nr.cluster_id.notna().all() and (nr.cluster_id >= 0).all()
    iso_seed = nr[nr.is_seed & (nr.in_deg + nr.out_deg == 0)]
    assert len(iso_seed) == 19 and iso_seed.cluster_id.notna().all()
    assert len(top) >= 20 and list(top["rank"]) == list(range(1, len(top) + 1))
    assert set(nr.cluster_id) == set(ctab.cluster_id) and ctab.cluster_id.is_unique
    assert (ctab.hypothesis.str.len() > 0).all()
    assert int(nr.truncated.sum()) == 444
    # JSON: ключи — все gid строками + _meta; все gid внутри (top_in/top_out/cycles) существуют в nodes
    nm = json.loads((out_dir / "node_metrics.json").read_text())
    gids = set(nr.gid.astype(str))
    assert len(nm) == 2249 and set(nm) - {"_meta"} == gids
    for d in (v for k, v in nm.items() if k != "_meta"):
        ref = [x["gid"] for x in d["top_in"] + d["top_out"]] + [g for c in d["cycles"] for g in c]
        assert set(ref) <= gids, ref
    print("\nПРОВЕРКИ: все assert'ы пройдены")


def review(nr, top):
    print("\n" + "=" * 72 + "\nРЕВЬЮ\n" + "=" * 72)
    print("Роли:", nr.role.value_counts().reindex(ROLES, fill_value=0).to_dict())
    for role in ROLES:
        t = nr[nr.role == role].sort_values(["role_score", "gid"], ascending=[False, True]).head(3)
        print(f"\n[{role}]")
        for r in t.itertuples():
            print(f"  {r.gid}  score {r.role_score:.2f}  | {r.evidence}")
    print("\nТОП-20 по priority_score:")
    for r in top.head(20).itertuples():
        print(f"  {r.rank:>2}. {r.gid} {r.role:<12} {r.priority_score:.3f} | {r.why[:180]}")


# ------------------------------------------------------------------ main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="../task/data")
    ap.add_argument("--out", default="../out")
    a = ap.parse_args()
    t0 = time.perf_counter()

    edges, nodes, tx = load(Path(a.data))
    G = build_graph(edges, nodes)
    f = features(G, edges, nodes)
    seed_share(f, edges)
    sync_days = temporal(f, tx)
    per_cycles, n_cycles = cycles(G, f)
    roles(f)
    comms = clusters(G, f)
    priority(f)
    f["evidence"] = [evidence(r) for _, r in f.iterrows()]
    ctab = cluster_table(G, f, comms)

    meta = dict(
        rules="pipeline/RULES.md v1",
        thresholds={k: (round(v, 8) if isinstance(v, float) else v) for k, v in T.items()},
        role_weight=ROLE_WEIGHT,
        role_counts={r: int((f.role == r).sum()) for r in ROLES},
        n_nodes=len(f), n_edges=len(edges), n_tx=len(tx), n_seed=int(f.is_seed.sum()),
        n_truncated=int(f.truncated.sum()), n_cycles_le5=n_cycles, n_clusters=len(comms),
        n_clusters_multi=int(sum(len(c) > 1 for c in comms)),
        turnover_kzt=round(float(edges.sum_kzt.sum())),
    )
    nr, top = outputs(f, edges, ctab, per_cycles, sync_days, Path(a.out), meta)
    checks(nr, top, ctab, Path(a.out))
    review(nr, top)
    print(f"\nВыгрузки: {Path(a.out).resolve()}  | время {time.perf_counter() - t0:.1f} с")


if __name__ == "__main__":
    main()
