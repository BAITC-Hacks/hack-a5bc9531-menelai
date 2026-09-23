#!/usr/bin/env python3
"""
Пайплайн кейса «Граф денег» (HackAlem AI, AML).

Реализует pipeline/RULES.md v3: метрики → «окрашенные деньги» → временные паттерны →
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

# ================================================================== THRESHOLDS (RULES.md §1)
# Степенные/суммовые пороги — перцентили распределения в данных: (перцентиль, совокупность, floor).
#   совокупность: "in" — узлы с in_deg > 0, "out" — out_deg > 0, "both" — in > 0 и out > 0.
#   порог = max(значение перцентиля, floor); перцентиль берётся method="lower" — реально наблюдаемое значение.
#   floor = порог v1 — минимум на случай малых/вырожденных данных, где перцентиль падает ниже разумного.
PCT_THRESHOLDS = dict(
    coord_in_deg=(0.95, "in", "in_deg", 3),
    coord_out_deg=(0.70, "out", "out_deg", 3),
    coord_betw_thr=(0.95, "both", "betweenness", 0.0),
    cons_in_deg=(0.95, "in", "in_deg", 3),
    cons_in_kzt=(0.80, "in", "in_kzt", 200_000),
    dist_out_deg=(0.95, "out", "out_deg", 15),
    tr_in_kzt=(0.60, "in", "in_kzt", 100_000),
    term_in_kzt=(0.80, "in", "in_kzt", 200_000),
)
# Фиксированные: доли/счётчики из ТЗ и структурные параметры (не зависят от распределения)
T = dict(
    coord_seed_up=3,
    cons_pass_max=0.3, cons_max_payer=0.8,
    dist_ratio=3,
    tr_pass_lo=0.8, tr_pass_hi=1.2, tr_fast_min=0.5,
    term_pass_max=0.3,
    weak_seed_share=0.1,
    seed_up_hops=4, cycle_len=5, fast_days=2, sync_payers=3,
    louvain_seed=42,
)
# Приоритет (RULES.md §3): вес для «нет данных» вместо веса peripheral; множитель при слабой связи с делом (1.0 — отключить)
NO_DATA_WEIGHT = 0.5
WEAK_SEED_PRIORITY_MULT = 0.7


def resolve_thresholds(f, spec=PCT_THRESHOLDS) -> dict:
    """Абсолютные значения перцентильных порогов на данных f.
    Возвращает плоский dict чисел: key (итог), key_pct (перцентиль), key_pct_value (значение перцентиля до floor)."""
    pop = {"in": f.in_deg > 0, "out": f.out_deg > 0, "both": (f.in_deg > 0) & (f.out_deg > 0)}
    out = {}
    for k, (q, p, col, floor) in spec.items():
        s = f.loc[pop[p], col]
        v = float(np.quantile(s, q, method="lower")) if len(s) else float(floor)
        out[k] = max(v, floor)
        out[f"{k}_pct"] = q
        out[f"{k}_pct_value"] = v
    return out


# ------------------------------------------------------------------ форматирование

def kzt(x) -> str:
    """4217500 → '4 217 500 ₸'"""
    return f"{x:,.0f}".replace(",", " ") + " ₸"


def dec(x, nd=2) -> str:
    """0.034 → '0,03'; NaN → 'н/д'"""
    return "н/д" if pd.isna(x) else f"{x:.{nd}f}".replace(".", ",")


def pct_str(x, thr=None) -> str:
    """Сначала округление до 4 знаков, как в CSV, затем half-up: 0,875 → 88% (совпадает с метрикой).
    С thr: если строка совпала бы с порогом (0,0996 при пороге 10%), добавляет знак — «9,96%»."""
    v = 100 * round(float(x), 4)
    nd = 0
    while thr is not None and nd < 2 and round(v, nd) == round(100 * thr, nd) and x != thr:
        nd += 1
    return f"{int(np.floor(v + 0.5))}%" if nd == 0 else f"{v:.{nd}f}%".replace(".", ",")


def dec_thr(x, thr, nd=2) -> str:
    """Значение рядом с порогом: добавляет знаки, пока строка значения совпадает со строкой порога
    (0,2988 при пороге 0,3 → «0,299», а не «0,30»)."""
    while nd < 8 and pd.notna(x) and round(float(x), nd) == round(float(thr), nd) and x != thr:
        nd += 1
    return dec(x, nd)


# ------------------------------------------------------------------ load

class InputError(ValueError):
    """Входные данные не по схеме task/README.md — сообщение показывается пользователю как есть."""


def _check(cond, msg):
    if not cond:
        raise InputError(msg)


COLS = {"nodes": ["gid", "depth", "is_seed"], "edges": ["src", "dst", "sum_kzt", "n_tx", "depth"],
        "transactions": ["src", "dst", "date", "sum_kzt"]}


def read_table(data_dir: Path, name: str) -> pd.DataFrame:
    """<name>.parquet по схеме task/README.md. gid-колонки приводятся к int64 — они больше 2⁵³."""
    pq = data_dir / f"{name}.parquet"
    ids = [c for c in ("gid", "src", "dst") if c in COLS[name]]
    _check(pq.exists(), f"нет файла {name}.parquet в {data_dir}")
    df = pd.read_parquet(pq)
    missing = [c for c in COLS[name] if c not in df.columns]
    _check(not missing, f"{name}: нет колонок {missing}; нужны {COLS[name]}")
    df = df[COLS[name]].copy()
    for c in ids:
        _check(df[c].notna().all(), f"{name}: пустые значения в {c}")
        df[c] = df[c].astype("int64")
    return df


def load(data_dir: Path):
    edges = read_table(data_dir, "edges")
    nodes = read_table(data_dir, "nodes")
    tx = read_table(data_dir, "transactions")
    tx["date"] = pd.to_datetime(tx["date"])
    if nodes.is_seed.dtype != bool:
        nodes["is_seed"] = nodes.is_seed.astype(str).str.lower().isin(["true", "1", "t", "yes"])
    nodes["depth"] = nodes.depth.astype(int)
    _check(len(nodes) > 0 and nodes.gid.nunique() == len(nodes), "nodes: gid должны быть уникальны")
    _check(nodes.is_seed.any(), "nodes: нет ни одного seed (is_seed = true)")
    known = set(nodes.gid)
    _check(set(edges.src) <= known and set(edges.dst) <= known, "edges: есть src/dst, которых нет в nodes")
    # edges == Σ transactions (как в starter.sanity_check)
    agg = tx.groupby(["src", "dst"]).agg(s=("sum_kzt", "sum"), c=("sum_kzt", "size")).reset_index()
    m = edges.merge(agg, on=["src", "dst"], how="outer", indicator=True)
    _check((m._merge == "both").all() and ((m.sum_kzt - m.s).abs() < 0.5).all(),
           "edges ≠ Σ transactions: суммы по парам src→dst в edges и transactions не совпадают")
    return edges, nodes, tx


def build_graph(edges, nodes) -> nx.DiGraph:
    G = nx.DiGraph()
    G.add_nodes_from(nodes.gid.tolist())          # 19 seed без рёбер тоже в графе
    for r in edges.itertuples(index=False):
        G.add_edge(int(r.src), int(r.dst), sum_kzt=float(r.sum_kzt), n_tx=int(r.n_tx))
    return G


# ------------------------------------------------------------------ features

def features(G, edges, nodes) -> tuple[pd.DataFrame, int]:
    f = nodes.set_index("gid")[["depth", "is_seed"]].copy()
    max_depth = int(f.depth.max())                              # последнее колено обхода: там out_deg = 0 — артефакт
    f["is_seed"] = f.is_seed.astype(bool)
    f["in_deg"] = edges.groupby("dst").src.nunique().reindex(f.index, fill_value=0).astype(int)
    f["out_deg"] = edges.groupby("src").dst.nunique().reindex(f.index, fill_value=0).astype(int)
    f["in_kzt"] = edges.groupby("dst").sum_kzt.sum().reindex(f.index, fill_value=0.0)
    f["out_kzt"] = edges.groupby("src").sum_kzt.sum().reindex(f.index, fill_value=0.0)
    f["in_tx"] = edges.groupby("dst").n_tx.sum().reindex(f.index, fill_value=0).astype(int)
    f["out_tx"] = edges.groupby("src").n_tx.sum().reindex(f.index, fill_value=0).astype(int)
    # NaN, если входа нет (у seed вход занижен выгрузкой — pass_through у них недостоверен)
    f["pass_through"] = np.where(f.in_kzt > 0, f.out_kzt / f.in_kzt.replace(0, np.nan), np.nan)
    # ЛОВУШКА: последнее колено без исходящих — обход оборвался, это не «сток»
    f["truncated"] = (f.depth == max_depth) & (f.out_deg == 0)
    f["isolated"] = (f.in_deg + f.out_deg) == 0
    f["no_data"] = f.truncated | (f.is_seed & f.isolated)       # правило 0: роль по данным не определить
    # доля крупнейшего плательщика во входе (NaN, если входа нет)
    f["max_payer_share"] = edges.groupby("dst").sum_kzt.max().reindex(f.index) / f.in_kzt.replace(0, np.nan)
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
    return f, max_depth


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
    # seed без единого ребра: денег в графе нет — доля 0, а не 1 по построению
    share[seed_arr & f.isolated.values] = 0.0
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


def roles(f, T):
    """Каскад RULES.md §1 сверху вниз, первое сработавшее правило даёт роль. T — разрешённые пороги."""
    betw_thr = T["coord_betw_thr"]
    role, score, rule_hit, nearest = [], [], [], []
    tr_mid, tr_half = (T["tr_pass_lo"] + T["tr_pass_hi"]) / 2, (T["tr_pass_hi"] - T["tr_pass_lo"]) / 2
    for g, r in f.iterrows():
        pt = r.pass_through
        seed_link = r.in_cycle or r.n_seed_upstream >= T["coord_seed_up"] or (r.is_seed and r.in_from_seed_deg > 0)
        # условия каждого правила (для peripheral считаем, насколько узел «почти» подошёл)
        conds = {
            "coordinator": [r.in_deg >= T["coord_in_deg"], r.out_deg >= T["coord_out_deg"], seed_link,
                            r.betweenness >= betw_thr],
            "consolidator": [r.in_deg >= T["cons_in_deg"], pd.notna(pt) and pt < T["cons_pass_max"],
                             r.in_kzt >= T["cons_in_kzt"],
                            pd.notna(r.max_payer_share) and r.max_payer_share < T["cons_max_payer"]],
            "distributor": [r.out_deg >= T["dist_out_deg"], r.out_deg >= T["dist_ratio"] * r.in_deg],
            "transit": [r.in_deg >= 1, r.out_deg >= 1, pd.notna(pt) and T["tr_pass_lo"] <= pt <= T["tr_pass_hi"],
                        r.in_kzt >= T["tr_in_kzt"], r.fast_out_share >= T["tr_fast_min"], not r.is_seed],
            "terminal": [r.depth in (1, 2, 3), (r.out_deg == 0) or (pd.notna(pt) and pt < T["term_pass_max"]),
                         r.in_kzt >= T["term_in_kzt"], not r.is_seed],
        }
        if r.no_data:                                            # правило 0: нет данных
            role.append("peripheral"); score.append(1.0); rule_hit.append("nodata"); nearest.append("")
            continue
        hit = next((k for k, c in conds.items() if all(c)), None)
        if hit is None:
            # §2 для peripheral: 1 − 0,6 × доля выполненных условий ближайшей роли
            # (ближайшая = первая по каскаду с максимальной долей; max() возвращает первый из равных)
            shares = {k: sum(c) / len(c) for k, c in conds.items()}
            near = max(shares, key=shares.get)
            role.append("peripheral"); score.append(1 - 0.6 * shares[near]); rule_hit.append("none")
            nearest.append(near)
            continue
        # ИНТЕРПРЕТАЦИЯ §2: «на пороге ≈ 0,5» → score = 0,5 + 0,5 × mean(запасов над порогами)
        mg = {
            "coordinator": [margin_ge(r.in_deg, T["coord_in_deg"]), margin_ge(r.out_deg, T["coord_out_deg"]),
                            margin_ge(r.betweenness, betw_thr), margin_ge(r.n_seed_upstream, T["coord_seed_up"])],
            "consolidator": [margin_ge(r.in_deg, T["cons_in_deg"]), margin_le(pt, T["cons_pass_max"]),
                             margin_ge(r.in_kzt, T["cons_in_kzt"]), margin_le(r.max_payer_share, T["cons_max_payer"])],
            "distributor": [margin_ge(r.out_deg, T["dist_out_deg"]),
                            1.0 if r.in_deg == 0 else margin_ge(r.out_deg, T["dist_ratio"] * r.in_deg)],
            "transit": [float(np.clip(1 - abs(pt - tr_mid) / tr_half, 0, 1)), margin_ge(r.in_kzt, T["tr_in_kzt"]),
                        margin_ge(r.fast_out_share, T["tr_fast_min"])],
            "terminal": [margin_le(0 if pd.isna(pt) else pt, T["term_pass_max"]), margin_ge(r.in_kzt, T["term_in_kzt"])],
        }[hit]
        role.append(hit); score.append(0.5 + 0.5 * float(np.mean(mg))); rule_hit.append(hit); nearest.append(hit)
    f["role"] = role
    f["nearest_role"] = nearest
    f["role_score"] = np.round(score, 4)
    f["rule_hit"] = rule_hit
    # RULES.md §5: «подозрительная» роль при малой доле seed-денег — возможен легальный контрагент (магазин, работодатель)
    f["weak_seed_link"] = f.role.isin(["consolidator", "terminal", "distributor", "coordinator"]) & (
        f.seed_share < T["weak_seed_share"])


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
    """base = mean(pct seed_money_in, pct n_seed_upstream, pct in_kzt (у seed — out_kzt), pct betweenness)
    × вес роли (у «нет данных» — NO_DATA_WEIGHT) × WEAK_SEED_PRIORITY_MULT при weak_seed_link."""
    pct = lambda s: s.rank(pct=True, method="average")
    p_in = pct(f.in_kzt).where(~f.is_seed, pct(f.out_kzt))    # у seed вход занижен выгрузкой
    base = (pct(f.seed_money_in) + pct(f.n_seed_upstream) + p_in + pct(f.betweenness)) / 4
    w = np.where(f.no_data, NO_DATA_WEIGHT, f.role.map(ROLE_WEIGHT))
    w = w * np.where(f.weak_seed_link, WEAK_SEED_PRIORITY_MULT, 1.0)
    f["priority_score"] = np.round(base * w, 4)


# ------------------------------------------------------------------ evidence / why

def thr_deg(x) -> str:
    """порог по целочисленной метрике: 16.0 → '16'"""
    return f"{int(np.ceil(x))}"


def thr_k(x) -> str:
    """порог по сумме: 215000 → '215 тыс.'"""
    return f"{x / 1000:.0f} тыс."


def evidence(r, T) -> str:
    """RULES.md §5. При weak_seed_link фрагмент «seed-денег X%» заменяется пометкой (число не дублируется)."""
    e = _evidence(r, T)
    if r.weak_seed_link:
        e = e.replace(f", seed-денег {pct_str(r.seed_share)}", "") + \
            f"; связь с seed слабая ({pct_str(r.seed_share, T['weak_seed_share'])}), возможен легальный контрагент"
    return e


def _evidence(r, T) -> str:
    sd = "сам seed" if r.is_seed else f"seed-денег {pct_str(r.seed_share)}"   # у seed доля = 1 по построению
    if r.rule_hit == "nodata":
        if r.isolated:
            return "нет данных: seed без переводов в выгрузке; 0 вход., 0 исход."
        return (f"нет данных: колено {T['max_depth']}, данные обрезаны: запросить исходящие переводы; "
                f"вход {kzt(r.in_kzt)} от {r.in_deg} плат., seed-денег {pct_str(r.seed_share)}")
    if r.role == "coordinator":
        link = "цикл" if r.in_cycle else ""
        link = ", ".join(x for x in [link, f"seed выше {r.n_seed_upstream}"] if x)
        return (f"coordinator: ≥{thr_deg(T['coord_in_deg'])} плат., ≥{thr_deg(T['coord_out_deg'])} получ., "
                f"посредн. ≥{dec(T['coord_betw_thr'], 5)} (p95), ≥{T['coord_seed_up']} seed/цикл; факт: {r.in_deg} плат., "
                f"{r.out_deg} получ., посредн. {dec_thr(r.betweenness, T['coord_betw_thr'], 5)}, {link}, {sd}")
    if r.role == "consolidator":
        return (f"consolidator: ≥{thr_deg(T['cons_in_deg'])} плат., пропуск <{dec(T['cons_pass_max'], 1)}, "
                f"вход ≥{thr_k(T['cons_in_kzt'])}, макс. плат. <{pct_str(T['cons_max_payer'])}; факт: {r.in_deg} плат., "
                f"{kzt(r.in_kzt)}, пропуск {dec_thr(r.pass_through, T['cons_pass_max'])}, "
                f"макс. плат. {pct_str(r.max_payer_share)}, {sd}")
    if r.role == "distributor":
        return (f"distributor: ≥{thr_deg(T['dist_out_deg'])} получ., получ. ≥{T['dist_ratio']}×плат.; факт: {r.out_deg} получ. "
                f"от {r.in_deg} плат., отдал {kzt(r.out_kzt)}, {sd}")
    if r.role == "transit":
        return (f"transit: пропуск {dec(T['tr_pass_lo'], 1)}–{dec(T['tr_pass_hi'], 1)}, вход ≥{thr_k(T['tr_in_kzt'])}, "
                f"вывод ≤2 дн. ≥{pct_str(T['tr_fast_min'])}; "
                f"факт: вход {kzt(r.in_kzt)}, выход {kzt(r.out_kzt)}, "
                f"пропуск {dec_thr(r.pass_through, T['tr_pass_lo'] if r.pass_through < 1 else T['tr_pass_hi'])}, "
                f"вывод ≤2 дн. {pct_str(r.fast_out_share)}")
    if r.role == "terminal":
        return (f"terminal: колено 1–3, пропуск <{dec(T['term_pass_max'], 1)}, вход ≥{thr_k(T['term_in_kzt'])}; "
                f"факт: колено {r.depth}, вход {kzt(r.in_kzt)} "
                f"от {r.in_deg} плат., пропуск {dec_thr(r.pass_through, T['term_pass_max'])}, {sd}")
    return (f"peripheral: признаков роли не выявлено; факт: {r.in_deg} плат., вход {kzt(r.in_kzt)}, "
            f"{r.out_deg} получ., выход {kzt(r.out_kzt)}, пропуск {dec(r.pass_through)}")


def why(r, sync_days, T) -> str:
    if r.no_data:
        parts = [("Нет данных для роли (правило 0, peripheral): seed без переводов в выгрузке — запросить операции клиента."
                  if r.isolated else f"Нет данных для роли (правило 0, peripheral): колено {T['max_depth']}, "
                  "данные обрезаны: запросить исходящие переводы.")]
    else:
        parts = [f"Гипотеза: признаки {ROLE_RU[r.role]} ({r.role}, уверенность {dec(r.role_score)})."]
    parts.append(f"Получил {kzt(r.in_kzt)} от {r.in_deg} плат. ({r.in_tx} пер.), отдал {kzt(r.out_kzt)} "
                 f"{r.out_deg} получ. ({r.out_tx} пер.), пропуск {dec_thr(r.pass_through, T['cons_pass_max'])}.")
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
    if r.weak_seed_link:
        parts.append(f"Связь с делом слабая (seed-денег {pct_str(r.seed_share, T['weak_seed_share'])} < 10%): приоритет ×{dec(WEAK_SEED_PRIORITY_MULT, 1)}.")
    parts.append(f"Посредничество {dec(r.betweenness, 4)}, кластер {r.cluster_id}, приоритет {dec(r.priority_score, 3)}.")
    return " ".join(parts)


# ------------------------------------------------------------------ outputs

METRICS = ["in_deg", "out_deg", "in_kzt", "out_kzt", "in_tx", "out_tx", "pass_through", "seed_share", "seed_money_in",
           "n_seed_upstream", "betweenness", "pagerank", "in_cycle", "fast_out_share", "sync_in_events",
           "truncated", "depth", "is_seed", "max_payer_share", "no_data", "nearest_role"]


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


def write_csv(df, path):
    """docs/PIPELINE_CONTRACT.md: булевы — true/false строчными, NaN — пустая строка."""
    d = df.copy()
    for c in d.select_dtypes(bool).columns:
        d[c] = d[c].map({True: "true", False: "false"})
    d.to_csv(path, index=False)


NODE_METRICS_COLS = ["gid", "depth", "is_seed", "in_deg", "out_deg", "in_kzt", "out_kzt", "in_tx", "out_tx",
                     "n_counterparties", "first_date", "last_date", "active_days", "pass_through", "truncated_by_depth",
                     "real_sink", "no_edges", "pagerank", "betweenness", "component", "component_size", "in_cycle",
                     "same_day_bursts", "avg_in_tx", "avg_out_tx", "seed_money_in", "seed_share", "cluster_id",
                     # перенесены из nodes_roles.csv (там только 6 колонок схемы жюри)
                     "n_seed_upstream", "fast_out_share", "sync_in_events", "max_payer_share", "no_data",
                     "nearest_role", "role_rule"]
EDGE_METRICS_COLS = ["src", "dst", "sum_kzt", "n_tx", "depth", "src_depth", "dst_depth", "min_tx", "max_tx",
                     "first_date", "last_date", "active_days", "mutual", "back_edge"]


def contract_tables(f, G, edges, tx):
    """node_metrics.csv и edge_metrics.csv по docs/PIPELINE_CONTRACT.md (ветка main). f — отсортирован как nodes_roles."""
    m = f.copy()
    # транзакции с точки зрения узла: (gid, контрагент, направление, дата), узел — src или dst
    both = pd.concat([tx.rename(columns={"src": "gid", "dst": "other"}).assign(dir="out"),
                      tx.rename(columns={"dst": "gid", "src": "other"}).assign(dir="in")])[["gid", "other", "dir", "date"]]
    nb = pd.concat([edges.rename(columns={"src": "gid", "dst": "other"}),
                    edges.rename(columns={"dst": "gid", "src": "other"})])[["gid", "other"]].drop_duplicates()
    m["n_counterparties"] = nb.groupby("gid").size().reindex(m.gid, fill_value=0).values
    d = both.groupby("gid").date
    m["first_date"] = d.min().dt.strftime("%Y-%m-%d").reindex(m.gid).fillna("").values
    m["last_date"] = d.max().dt.strftime("%Y-%m-%d").reindex(m.gid).fillna("").values
    m["active_days"] = d.nunique().reindex(m.gid, fill_value=0).values
    # всплеск: ≥2 перевода одному контрагенту (или от одного) в один день; направления раздельно — как в run.py ветки main
    bursts = both.groupby(["gid", "other", "dir", "date"]).size()
    m["same_day_bursts"] = (bursts >= 2).groupby(level="gid").sum().reindex(m.gid, fill_value=0).values
    m["truncated_by_depth"] = m.truncated
    m["real_sink"] = (m.depth < 4) & ~m.is_seed & (m.out_deg == 0)
    m["no_edges"] = m.isolated
    comps = sorted(nx.weakly_connected_components(G), key=lambda c: (-len(c), min(c)))
    comp = {v: i for i, c in enumerate(comps) for v in c}
    m["component"] = m.gid.map(comp)
    m["component_size"] = m.component.map({i: len(c) for i, c in enumerate(comps)})
    m["avg_in_tx"] = np.where(m.in_tx > 0, m.in_kzt / m.in_tx.clip(lower=1), 0.0).round(2)
    m["avg_out_tx"] = np.where(m.out_tx > 0, m.out_kzt / m.out_tx.clip(lower=1), 0.0).round(2)
    for c in ["in_kzt", "out_kzt", "seed_money_in"]:
        m[c] = m[c].round(2)
    for c in ["pass_through", "seed_share", "fast_out_share", "max_payer_share"]:
        m[c] = m[c].round(4)
    m["pagerank"] = m.pagerank.round(8)
    m["betweenness"] = m.betweenness.round(8)

    e = edges[["src", "dst", "sum_kzt", "n_tx", "depth"]].copy()
    dep = f.set_index("gid").depth
    e["src_depth"] = e.src.map(dep).values
    e["dst_depth"] = e.dst.map(dep).values
    g = tx.groupby(["src", "dst"]).agg(min_tx=("sum_kzt", "min"), max_tx=("sum_kzt", "max"),
                                       first_date=("date", "min"), last_date=("date", "max"),
                                       active_days=("date", "nunique"))
    g["first_date"] = g.first_date.dt.strftime("%Y-%m-%d")
    g["last_date"] = g.last_date.dt.strftime("%Y-%m-%d")
    e = e.join(g, on=["src", "dst"])
    pairs = set(zip(edges.src, edges.dst))
    e["mutual"] = [(d_, s_) in pairs for s_, d_ in zip(e.src, e.dst)]
    e["back_edge"] = e.dst_depth <= e.src_depth
    return m[NODE_METRICS_COLS], e[EDGE_METRICS_COLS]


def outputs(f, G, edges, tx, ctab, per_cycles, sync_days, out_dir: Path, meta, Tr):
    out_dir.mkdir(parents=True, exist_ok=True)
    f = f.sort_values(["priority_score"], ascending=False, kind="mergesort")
    f = f.reset_index().sort_values(["priority_score", "gid"], ascending=[False, True], kind="mergesort")
    assert f.gid.dtype == np.int64 and f.gid.nunique() == len(f)

    # role_rule: id сработавшего правила (контракт main); правило 0 делится на два случая
    f["role_rule"] = np.where(f.rule_hit == "nodata",
                              np.where(f.isolated, "no_data_isolated_seed", "no_data_truncated"),
                              np.where(f.rule_hit == "none", "peripheral", f.rule_hit))
    # nodes_roles.csv — ровно схема жюри; метрики и role_rule — в node_metrics.csv
    nr = f[["gid", "role", "role_score", "cluster_id", "priority_score", "evidence"]].copy()
    write_csv(nr, out_dir / "nodes_roles.csv")

    write_csv(ctab, out_dir / "clusters.csv")
    nmc, emc = contract_tables(f, G, edges, tx)
    write_csv(nmc, out_dir / "node_metrics.csv")
    write_csv(emc, out_dir / "edge_metrics.csv")

    top = f.head(30).copy()
    top.insert(0, "rank", range(1, len(top) + 1))
    tt = top.set_index("gid")
    top["why"] = [why(tt.loc[g], sync_days, Tr) for g in top.gid]
    top[["rank", "gid", "role", "priority_score", "why"]].to_csv(out_dir / "top_nodes.csv", index=False)

    nm = {}
    for r in f.itertuples(index=False):
        g = int(r.gid)
        d = {k: jnum(getattr(r, k)) for k in METRICS}
        d.update(role=r.role, role_score=jnum(r.role_score), priority_score=jnum(r.priority_score),
                 cluster_id=int(r.cluster_id), evidence=r.evidence, weak_seed_link=bool(r.weak_seed_link),
                 cycles=[[str(int(v)) for v in c] for c in per_cycles.get(g, [])],
                 sync_days=sync_days.get(g, []),
                 top_in=top_links(edges, g, "in"), top_out=top_links(edges, g, "out"))
        nm[str(g)] = d
    nm["_meta"] = meta
    (out_dir / "node_metrics.json").write_text(json.dumps(nm, ensure_ascii=False, indent=1))
    return nr, top, nmc, emc


# ------------------------------------------------------------------ checks

def checks(nr, top, ctab, nmc, emc, out_dir: Path, n_nodes: int, n_edges: int):
    assert len(nr) == n_nodes and nr.gid.nunique() == n_nodes and nr.gid.dtype == np.int64
    assert nr.role.isin(ROLES).all()
    assert nr.role_score.between(0, 1).all() and nr.priority_score.between(0, 1).all()
    ev = nr.evidence.astype(str)
    assert (ev.str.len() > 0).all() and (ev.str.len() <= 200).all(), ev[ev.str.len() > 200].head()
    assert nr.cluster_id.notna().all() and (nr.cluster_id >= 0).all()
    iso_seed = nmc[nmc.is_seed & (nmc.in_deg + nmc.out_deg == 0)]
    assert iso_seed.cluster_id.notna().all() and (iso_seed.seed_share == 0).all()
    assert len(top) >= 20 and list(top["rank"]) == list(range(1, len(top) + 1))
    assert set(nr.cluster_id) == set(ctab.cluster_id) and ctab.cluster_id.is_unique
    assert (ctab.hypothesis.str.len() > 0).all()
    # контракт main (docs/PIPELINE_CONTRACT.md)
    assert list(nr.columns) == ["gid", "role", "role_score", "cluster_id", "priority_score", "evidence"]
    assert nmc.role_rule.notna().all()
    assert (nmc.role_rule == "no_data_truncated").sum() == int(nmc.truncated_by_depth.sum())
    assert (nmc.role_rule == "no_data_isolated_seed").sum() == len(iso_seed) == int((nmc.no_edges & nmc.is_seed).sum())
    assert len(nmc) == n_nodes and list(nmc.columns) == NODE_METRICS_COLS and set(nmc.gid) == set(nr.gid)
    assert len(emc) == n_edges and list(emc.columns) == EDGE_METRICS_COLS and emc.first_date.notna().all()
    for fn in ["nodes_roles.csv", "node_metrics.csv", "edge_metrics.csv"]:
        head = (out_dir / fn).read_text().splitlines()[1:]
        assert not any(",True," in l or ",False," in l or l.endswith((",True", ",False")) for l in head), fn
    top_p = nr.set_index("gid").priority_score
    for tg in ctab.top_gids:
        p = [top_p[int(g)] for g in tg.split(";")]
        assert p == sorted(p, reverse=True), tg
    # JSON: ключи — все gid строками + _meta; все gid внутри (top_in/top_out/cycles) существуют в nodes
    nm = json.loads((out_dir / "node_metrics.json").read_text())
    gids = set(nr.gid.astype(str))
    assert len(nm) == n_nodes + 1 and set(nm) - {"_meta"} == gids
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

def compute(edges, nodes, tx, T_base=T):
    """features → seed_share → temporal → cycles → пороги → роли на произвольных DataFrame (без чтения parquet).
    tx["date"] должен быть datetime. Возвращает f, разрешённые пороги Tr, sync_days, per_cycles, n_cycles, G."""
    G = build_graph(edges, nodes)
    f, max_depth = features(G, edges, nodes)
    seed_share(f, edges)
    sync_days = temporal(f, tx)
    per_cycles, n_cycles = cycles(G, f)
    Tr = {**T_base, **resolve_thresholds(f)}
    Tr["coord_betw_pct"] = Tr["coord_betw_thr_pct"]      # ключ v1 в _meta.thresholds — для совместимости
    Tr["max_depth"] = max_depth
    roles(f, Tr)
    return f, Tr, sync_days, per_cycles, n_cycles, G


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="../task/data")
    ap.add_argument("--out", default="../out")
    a = ap.parse_args()
    t0 = time.perf_counter()

    try:
        edges, nodes, tx = load(Path(a.data))
    except InputError as e:
        raise SystemExit(f"ОШИБКА ВХОДНЫХ ДАННЫХ: {e}")
    f, Tr, sync_days, per_cycles, n_cycles, G = compute(edges, nodes, tx)
    comms = clusters(G, f)
    priority(f)
    f["evidence"] = [evidence(r, Tr) for _, r in f.iterrows()]
    ctab = cluster_table(G, f, comms)

    meta = dict(
        rules="pipeline/RULES.md v3",
        thresholds={k: (round(float(v), 8) if isinstance(v, float) else int(v)) for k, v in Tr.items()},
        role_weight=ROLE_WEIGHT, no_data_weight=NO_DATA_WEIGHT, weak_seed_priority_mult=WEAK_SEED_PRIORITY_MULT,
        role_counts={r: int((f.role == r).sum()) for r in ROLES},
        n_nodes=len(f), n_edges=len(edges), n_tx=len(tx), n_seed=int(f.is_seed.sum()),
        n_truncated=int(f.truncated.sum()), n_cycles_le5=n_cycles, n_clusters=len(comms),
        n_clusters_multi=int(sum(len(c) > 1 for c in comms)),
        turnover_kzt=round(float(edges.sum_kzt.sum())),
        # описание выгрузки — интерфейс берёт период и число колен отсюда, а не из констант
        max_depth=Tr["max_depth"], n_by_depth=[int((f.depth == d).sum()) for d in range(Tr["max_depth"] + 1)],
        period=[tx.date.min().strftime("%Y-%m-%d"), tx.date.max().strftime("%Y-%m-%d")] if len(tx) else None,
        min_tx_kzt=round(float(tx.sum_kzt.min())) if len(tx) else None,
    )
    nr, top, nmc, emc = outputs(f, G, edges, tx, ctab, per_cycles, sync_days, Path(a.out), meta, Tr)
    checks(nr, top, ctab, nmc, emc, Path(a.out), len(nodes), len(edges))
    review(nr, top)
    print("\nПороги:", {k: v for k, v in meta["thresholds"].items() if k in PCT_THRESHOLDS})
    print(f"\nВыгрузки: {Path(a.out).resolve()}  | время {time.perf_counter() - t0:.1f} с")


if __name__ == "__main__":
    main()
