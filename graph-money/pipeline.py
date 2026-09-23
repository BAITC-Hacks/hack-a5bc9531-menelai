#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Граф денег — воспроизводимый пайплайн.

    parquet (nodes, edges, transactions)
      -> проверка и очистка данных (отчёт о качестве)
      -> признаки узлов (объёмы, степени, артефакты выгрузки, seed-деньги, круги, время)
      -> кластеры (консенсус N запусков Louvain)
      -> роли по объяснимым правилам (+ role_score, evidence)
      -> приоритет (по одной метрике от каждой «семьи» признаков)
      -> nodes_roles.csv, clusters.csv, top_nodes.csv
         (+ *_ext.csv, viewer.html, resilience.csv, data_requests.csv, assumptions.csv)

Запуск:   python pipeline.py --data data --out output
Jupyter:  import pipeline as pl; R = pl.run("data", "output"); pl.node_card(R, <gid>)

Главный принцип: РОЛЬ определяют факты и структура графа.
Гипотезы (доля seed-денег, скорость пропуска, вход в конце периода)
меняют только уверенность (role_score), приоритет и текст evidence.
"""
import argparse
import json
import sys
import time
from collections import deque
from itertools import islice, product
from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd

# ============================================================================
# Константы, параметры и реестр допущений
# ============================================================================
ROLES = ["coordinator", "consolidator", "distributor", "transit", "terminal", "peripheral"]
ROLE_RU = {"coordinator": "координатор", "consolidator": "консолидатор", "distributor": "распределитель",
           "transit": "транзит", "terminal": "конечный получатель", "peripheral": "периферия"}
NODES_SCHEMA = ["gid", "role", "role_score", "cluster_id", "priority_score", "evidence"]
CLUSTERS_SCHEMA = ["cluster_id", "n_nodes", "n_seed", "sum_kzt_internal", "top_gids", "hypothesis"]
TOP_SCHEMA = ["rank", "gid", "role", "priority_score", "why"]
MIN_TOP = 20

PARAMS = dict(
    # --- роли ---
    cons_min_in=5, cons_strong_in=8, cons_max_pass=0.5,
    dist_min_out=10,
    band=(0.8, 1.2), min_sum=100_000,
    coord_min_in=5, coord_min_out=10, coord_strong_in=8, coord_min_seed_links=2,
    fast_days=2, fast_min=0.7,
    late_days=3,
    sync_min_payers=3,
    weak_seed_share=0.1, term_seed_share=0.2, weak_penalty=0.75,
    # --- приоритет ---
    role_w=dict(coordinator=1.0, consolidator=0.9, distributor=0.8, transit=0.7, terminal=0.5, peripheral=0.1),
    prio_w=dict(role=0.35, seed_money=0.20, in_deg=0.10, out_deg=0.10, volume=0.10, seed_links=0.10, cycle3=0.05),
    seed_factor=0.85,
    # --- модель seed-денег ---
    seed_denom="max",
    # --- кластеры ---
    cl_runs=30, cl_thr=0.8, cl_attach=0.5, cl_seed0=0, cl_weight="w", cl_resolution=1.0,
    cl_stability=True, cl_stable_min=0.6,
    # --- прочее ---
    max_cycle_len=5, top_n=50, back_flow_share=0.4,
    stability_grid=dict(cons_min_in=[4, 5, 6], dist_min_out=[8, 10, 12], min_sum=[75_000, 100_000, 150_000]),
    resilience_k=(5, 10, 20, 50), resilience_random=20,
)

# Каждое решение, которое не следует из данных напрямую, описано здесь.
# kind: «порог» — числовая граница правила; «гипотеза» — предположение о поведении денег/людей;
#       «методика» — выбор метода; «продукт» — решение о том, что показывать аналитику.
ASSUMPTIONS = {
    "cons_min_in": ("порог", "консолидатор: от 5 разных плательщиков — «несколько участников» из определения ТЗ"),
    "cons_strong_in": ("порог", "от 8 плательщиков консолидация выраженная (ориентир ТЗ: 8–24); на 8 плато чувствительности"),
    "cons_max_pass": ("порог", "консолидатор удерживает: отдаёт дальше не больше половины видимого входа"),
    "dist_min_out": ("порог", "распределитель: от 10 получателей (сильные кандидаты ТЗ — 60–116, 10 — середина плато)"),
    "band": ("порог", "транзит: отдал 80–120% полученного — ориентир ТЗ «коэффициент пропуска 0.8–1.2»"),
    "min_sum": ("порог", "100 тыс. KZT — существенная сумма для транзита и терминала (20× порога выгрузки)"),
    "coord_min_in": ("порог", "координатор собирает: от 5 плательщиков"),
    "coord_min_out": ("порог", "координатор раздаёт: от 10 получателей"),
    "coord_strong_in": ("порог", "координатор: либо 8+ плательщиков (как у сильного консолидатора)…"),
    "coord_min_seed_links": ("порог", "…либо прямая связь с 2+ seed — связующее звено между известными участниками"),
    "fast_days": ("гипотеза", "«сквозной транзит» — ушло в течение 2 дней после входа (ТЗ: 1–2 дня); время внутри дня неизвестно"),
    "fast_min": ("гипотеза", "транзит по скорости (только где баланс не виден): 70%+ исходящих ушло быстро"),
    "late_days": ("гипотеза", "вход в последние 3 дня периода — деньги могли уйти дальше уже после выгрузки"),
    "sync_min_payers": ("порог", "синхронный сбор: 3+ разных плательщика в один день"),
    "weak_seed_share": ("гипотеза", "связь с seed слабая, если seed-денег < 10% и нет прямых связей с seed — возможна легальная активность"),
    "term_seed_share": ("гипотеза", "терминал уверенный при доле seed-денег от 20%"),
    "weak_penalty": ("гипотеза", "при слабой связи с seed уверенность в роли × 0.75 (роль не меняется)"),
    "role_w": ("продукт", "иерархия ролей для приоритета: ближе к управлению деньгами — выше; консолидатор почти равен координатору, т.к. ТЗ ставит фокус на точки консолидации"),
    "prio_w": ("продукт", "приоритет = по одной метрике от каждой семьи признаков, чтобы не учитывать одно и то же дважды"),
    "seed_factor": ("продукт", "seed уже известны правоохранителям — приоритет × 0.85, фокус на новых узлах"),
    "seed_denom": ("гипотеза", "модель смешивания: невидимый вход считается «чистым» (осторожная оценка доли seed-денег)"),
    "cl_runs": ("методика", "консенсус 30 запусков Louvain убирает случайность разбиения"),
    "cl_thr": ("методика", "два узла в одном кластере, если вместе минимум в 80% запусков"),
    "cl_attach": ("методика", "узел без ядра присоединяется к соседу, с которым вместе в 50%+ запусков"),
    "cl_seed0": ("методика", "фиксированная случайность — воспроизводимость"),
    "cl_weight": ("гипотеза", "кластер — группа, между которой ходят крупные суммы (вес = сумма), а не много мелких связей"),
    "cl_resolution": ("методика", "стандартный масштаб модулярности (1.0)"),
    "cl_stability": ("методика", "устойчивость каждого кластера: другая случайность, порог согласия 0.7/0.9, resolution 0.5/2"),
    "cl_stable_min": ("порог", "кластер с устойчивостью ниже 0.6 помечается, сила его гипотезы понижается"),
    "max_cycle_len": ("методика", "круги длиной до 5 шагов — глубина обхода 4 колена"),
    "top_n": ("продукт", "топ-50: ТЗ требует ≥ 20, 50 — рабочий объём проверки для аналитика"),
    "back_flow_share": ("порог", "кластер с возвратными потоками: 40%+ внутреннего оборота идёт назад/вбок по коленам"),
    "stability_grid": ("методика", "устойчивость роли: пороги сдвигаются на ±1 шаг"),
    "resilience_k": ("методика", "сколько узлов изымаем при оценке устойчивости сети"),
    "resilience_random": ("методика", "число случайных изъятий для сравнения"),
}


# ============================================================================
# Вспомогательные функции
# ============================================================================
def sat(x, lo, hi):
    """Плавная шкала 0..1 между порогом lo и уровнем «очень сильно» hi."""
    return np.clip((np.asarray(x, dtype=float) - lo) / (hi - lo), 0, 1)


def pct(x):
    """Перцентильный ранг 0..1; у минимальных значений (в т.ч. нулей) = 0."""
    s = pd.Series(np.asarray(x, dtype=float))
    if len(s) < 2:
        return np.zeros(len(s))
    return ((s.rank(method="min") - 1) / (len(s) - 1)).to_numpy()


def money(x):
    x = float(x)
    if x >= 1e6:
        return f"{x / 1e6:.1f} млн"
    if x >= 1e3:
        return f"{x / 1e3:.0f} тыс"
    return f"{x:.0f}"


def plural(n, one, few, many):
    n = abs(int(n))
    if n % 10 == 1 and n % 100 != 11:
        return one
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return few
    return many


def cnt(n, one, few, many):
    return f"{int(n)} {plural(n, one, few, many)}"


def merge_params(params=None):
    p = {**PARAMS, **(params or {})}
    unknown = set(params or {}) - set(PARAMS)
    if unknown:
        raise ValueError(f"Неизвестные параметры: {sorted(unknown)}")
    return p


# ============================================================================
# 1. Загрузка и очистка
# ============================================================================
def _to_bool(s):
    if s.dtype == bool:
        return s
    if s.dtype == object or pd.api.types.is_string_dtype(s):
        m = s.astype(str).str.strip().str.lower().map(
            {"true": True, "1": True, "yes": True, "да": True, "false": False, "0": False, "no": False,
             "нет": False, "nan": False, "none": False, "": False})
        if m.isna().any():
            raise ValueError(f"is_seed: непонятные значения {sorted(s[m.isna()].astype(str).unique())[:5]}")
        return m.astype(bool)
    return s.fillna(0).astype(bool)


def _to_gid(s, name, issues):
    if pd.api.types.is_float_dtype(s):
        if s.isna().any():
            raise ValueError(f"{name}: пустые идентификаторы")
        if (s.abs() > 2 ** 53).any():
            issues.append(f"{name} хранится как float, gid > 2^53 могли потерять точность — лучше выгрузить как int64")
        if (s != np.round(s)).any():
            raise ValueError(f"{name}: дробные идентификаторы")
    return pd.to_numeric(s, errors="raise").astype("int64")


def clean(nodes, edges, tx):
    """Приводит типы, чистит данные, возвращает (nodes, edges, tx, issues)."""
    issues = []
    need = {"nodes": (nodes, ["gid", "depth", "is_seed"]),
            "edges": (edges, ["src", "dst", "sum_kzt", "n_tx"]),
            "transactions": (tx, ["src", "dst", "date", "sum_kzt"])}
    for name, (df, cols) in need.items():
        miss = set(cols) - set(df.columns)
        if miss:
            raise ValueError(f"{name}: нет колонок {sorted(miss)}")
    nodes, edges, tx = nodes.copy(), edges.copy(), tx.copy()
    if len(nodes) == 0:
        raise ValueError("nodes пуст")

    nodes["gid"] = _to_gid(nodes["gid"], "nodes.gid", issues)
    for c in ("src", "dst"):
        edges[c] = _to_gid(edges[c], f"edges.{c}", issues)
        tx[c] = _to_gid(tx[c], f"transactions.{c}", issues)
    nodes["is_seed"] = _to_bool(nodes["is_seed"])
    if nodes["depth"].isna().any():
        raise ValueError("nodes.depth: есть пропуски")
    nodes["depth"] = nodes["depth"].astype(int)
    if nodes.gid.duplicated().any():
        raise ValueError(f"nodes: повторяющиеся gid ({int(nodes.gid.duplicated().sum())})")
    edges["sum_kzt"] = pd.to_numeric(edges["sum_kzt"], errors="coerce")
    edges["n_tx"] = pd.to_numeric(edges["n_tx"], errors="coerce").fillna(1).astype(int)
    tx["sum_kzt"] = pd.to_numeric(tx["sum_kzt"], errors="coerce")
    tx["date"] = pd.to_datetime(tx["date"], errors="coerce")
    if "depth" not in edges.columns:
        edges["depth"] = np.nan

    def drop(df, mask, name, why):
        k = int(mask.sum())
        if k:
            issues.append(f"{name}: исключено {k} строк — {why}")
        return df[~mask]

    edges = drop(edges, edges.sum_kzt.isna() | (edges.sum_kzt <= 0), "edges", "пустая или неположительная сумма")
    tx = drop(tx, tx.sum_kzt.isna() | (tx.sum_kzt <= 0), "transactions", "пустая или неположительная сумма")
    tx = drop(tx, tx.date.isna(), "transactions", "нераспознанная дата")
    edges = drop(edges, edges.src == edges.dst, "edges", "перевод самому себе")
    tx = drop(tx, tx.src == tx.dst, "transactions", "перевод самому себе")
    known = set(nodes.gid)
    edges = drop(edges, ~(edges.src.isin(known) & edges.dst.isin(known)), "edges", "gid нет в nodes")
    tx = drop(tx, ~(tx.src.isin(known) & tx.dst.isin(known)), "transactions", "gid нет в nodes")
    if edges.duplicated(["src", "dst"]).any():
        issues.append(f"edges: {int(edges.duplicated(['src', 'dst']).sum())} повторных пар src→dst объединены")
        edges = edges.groupby(["src", "dst"], as_index=False).agg(
            sum_kzt=("sum_kzt", "sum"), n_tx=("n_tx", "sum"), depth=("depth", "min"))

    # согласованность edges и transactions (edges — источник структуры)
    if len(tx) and len(edges):
        agg = tx.groupby(["src", "dst"]).sum_kzt.sum()
        m = edges.set_index(["src", "dst"]).sum_kzt
        both = m.index.intersection(agg.index)
        bad = int((np.abs(m.loc[both] - agg.loc[both]) > 1).sum())
        only_e, only_t = len(m.index.difference(agg.index)), len(agg.index.difference(m.index))
        if bad or only_e or only_t:
            issues.append(f"edges и transactions расходятся: суммы {bad}, пар только в edges {only_e}, "
                          f"только в transactions {only_t} (структура берётся из edges)")

    nodes = nodes.sort_values("gid").reset_index(drop=True)
    edges = edges.sort_values(["src", "dst"]).reset_index(drop=True)
    tx = tx.sort_values(["src", "dst", "date", "sum_kzt"]).reset_index(drop=True)
    return nodes, edges, tx, issues


def load(data_dir):
    d = Path(data_dir)
    files = {k: d / f"{k}.parquet" for k in ("nodes", "edges", "transactions")}
    for f in files.values():
        if not f.exists():
            raise FileNotFoundError(f"Нет файла {f}")
    return clean(*(pd.read_parquet(files[k]) for k in ("nodes", "edges", "transactions")))


# ============================================================================
# 2. Признаки
# ============================================================================
def propagate_seed_money(F, e, denom="max", tol=1e-10, max_iter=500):
    """
    Модель «окрашенных денег»: у seed доля = 1; каждый узел передаёт дальше ту же долю,
    какая у него во входе (пропорциональное смешивание).
    denom="max": знаменатель max(вход, выход) — невидимый вход считается «чистым» (осторожная оценка).
    denom="in":  знаменатель — видимый вход (агрессивная оценка).
    """
    idx = pd.Index(F.index)
    s = idx.get_indexer(e.src)
    d = idx.get_indexer(e.dst)
    w = e.sum_kzt.to_numpy(dtype=float)
    ins, outs = F.in_sum.to_numpy(dtype=float), F.out_sum.to_numpy(dtype=float)
    den = np.maximum(ins, outs) if denom == "max" else ins
    is_seed = F.is_seed.to_numpy(dtype=bool)
    share = is_seed.astype(float)
    safe = np.where(den > 0, den, 1.0)
    for _ in range(max_iter):
        contrib = np.bincount(d, weights=w * share[s], minlength=len(idx)) if len(d) else np.zeros(len(idx))
        new = np.where(den > 0, np.minimum(contrib / safe, 1.0), 0.0)
        new[is_seed] = 1.0
        done = np.abs(new - share).max() < tol if len(new) else True
        share = new
        if done:
            break
    contrib = np.bincount(d, weights=w * share[s], minlength=len(idx)) if len(d) else np.zeros(len(idx))
    return share, contrib


def find_cycles(G, max_len=5, limit=500_000):
    try:
        return list(islice(nx.simple_cycles(G, length_bound=max_len), limit))
    except TypeError:  # networkx < 3.1
        return [c for c in islice(nx.simple_cycles(G), limit) if len(c) <= max_len]


def seed_link_features(F, e):
    """Признаки, зависящие от списка seed (пересчитываются в проверке leave-one-seed-out)."""
    seeds = F.index[F.is_seed]
    nb = pd.concat([e[["src", "dst"]].set_axis(["gid", "cp"], axis=1),
                    e[["dst", "src"]].set_axis(["gid", "cp"], axis=1)])
    F["n_seed_links"] = nb[nb.cp.isin(seeds)].groupby("gid").cp.nunique().reindex(F.index).fillna(0).astype(int)
    es = e[e.src.isin(seeds)]
    F["in_from_seed_sum"] = es.groupby("dst").sum_kzt.sum().reindex(F.index).fillna(0.0)
    F["in_from_seed_deg"] = es.groupby("dst").src.nunique().reindex(F.index).fillna(0).astype(int)
    F["flag_out_gt_in"] = (F.out_sum > F.in_sum) & ~F.is_seed
    F["inflow_reliable"] = ~F.is_seed & ~F.flag_out_gt_in
    return F


def build_graph(F, e):
    G = nx.DiGraph()
    G.add_nodes_from(int(x) for x in F.index)            # F отсортирован по gid -> порядок детерминирован
    G.add_edges_from((int(s), int(d), {"sum_kzt": float(w), "n_tx": int(k)})
                     for s, d, w, k in e[["src", "dst", "sum_kzt", "n_tx"]].itertuples(index=False))
    return G


def build_features(nodes, e, tx, p=PARAMS):
    F = nodes.sort_values("gid").set_index("gid")[["depth", "is_seed"]].copy()
    max_depth = int(F.depth.max())

    out_ = e.groupby("src").agg(out_sum=("sum_kzt", "sum"), out_tx=("n_tx", "sum"), out_deg=("dst", "nunique"))
    in_ = e.groupby("dst").agg(in_sum=("sum_kzt", "sum"), in_tx=("n_tx", "sum"), in_deg=("src", "nunique"))
    F = F.join(out_).join(in_)
    for c in ["out_sum", "in_sum"]:
        F[c] = F[c].fillna(0.0).astype(float)
    for c in ["out_tx", "out_deg", "in_tx", "in_deg"]:
        F[c] = F[c].fillna(0).astype(int)

    nb = pd.concat([e[["src", "dst"]].set_axis(["gid", "cp"], axis=1),
                    e[["dst", "src"]].set_axis(["gid", "cp"], axis=1)])
    F["n_counterparties"] = nb.groupby("gid").cp.nunique().reindex(F.index).fillna(0).astype(int)
    F["volume_dedup"] = np.maximum(F.in_sum, F.out_sum)       # деньги через узел без двойного счёта
    F["total_volume"] = F.in_sum + F.out_sum
    F["net_flow"] = F.in_sum - F.out_sum
    F["pass_ratio"] = F.out_sum / F.in_sum.where(F.in_sum > 0)

    F = seed_link_features(F, e)
    # Обрыв выгрузки: последнее колено считается обрезанным, только если ни один его узел не имеет исходящих
    last_level = F.depth == max_depth
    truncation = bool(max_depth > 0 and last_level.any() and (F.loc[last_level, "out_deg"] == 0).all())
    F["flag_truncated"] = truncation & last_level & (F.out_deg == 0)
    F["no_edges"] = (F.in_deg + F.out_deg) == 0

    G = build_graph(F, e)
    comps = sorted(nx.weakly_connected_components(G), key=lambda c: (-len(c), min(c)))
    F["component"] = pd.Series({n: i for i, c in enumerate(comps) for n in c}).reindex(F.index).astype(int)

    share, money_in = propagate_seed_money(F, e, p["seed_denom"])
    F["seed_share"], F["seed_money_in"] = share, money_in

    cycles = find_cycles(G, p["max_cycle_len"])
    F["in_cycle"] = F.index.isin({n for c in cycles for n in c})
    F["in_cycle3"] = F.index.isin({n for c in cycles if len(c) >= 3 for n in c})
    pair_set = set(zip(e.src.tolist(), e.dst.tolist()))
    mutual_src = [s for s, d in pair_set if (d, s) in pair_set]
    F["n_mutual"] = pd.Series(mutual_src, dtype="int64").value_counts().reindex(F.index).fillna(0).astype(int)

    if len(tx):
        out_t = tx[["src", "date", "sum_kzt"]].rename(columns={"src": "gid"}).sort_values(["date", "gid"])
        in_t = tx[["dst", "date"]].rename(columns={"dst": "gid", "date": "in_date"}).sort_values(["in_date", "gid"])
        mm = pd.merge_asof(out_t, in_t, left_on="date", right_on="in_date", by="gid", direction="backward")
        fast = (mm.date - mm.in_date).dt.days.le(p["fast_days"]).to_numpy()
        num = (mm.sum_kzt * fast).groupby(mm.gid).sum()
        F["fast_share"] = (num / mm.groupby("gid").sum_kzt.sum()).reindex(F.index)
        F["max_payers_day"] = (tx.groupby(["dst", tx.date.dt.normalize()]).src.nunique()
                               .groupby(level=0).max().reindex(F.index).fillna(0).astype(int))
        tx_end = tx.date.max()
        last_in = tx.groupby("dst").date.max().reindex(F.index)
        F["late_last_in"] = (last_in >= tx_end - pd.Timedelta(days=p["late_days"])).to_numpy(dtype=bool)
        period = f"{tx.date.min().date()} — {tx_end.date()}"
        has_time = bool((tx.date != tx.date.dt.normalize()).any())
    else:
        F["fast_share"], F["max_payers_day"], F["late_last_in"] = np.nan, 0, False
        period, has_time = "нет транзакций", False

    meta = dict(max_depth=max_depth, truncation_detected=truncation, has_time=has_time, period=period,
                n_cycles=len(cycles), n_components=len(comps))
    return F, G, cycles, meta


# ============================================================================
# 3. Кластеры: консенсус нескольких запусков Louvain
# ============================================================================
def build_undirected(G):
    U = nx.Graph()
    U.add_nodes_from(G)
    for u, v, d in G.edges(data=True):
        if U.has_edge(u, v):
            U[u][v]["w"] += d["sum_kzt"]
        else:
            U.add_edge(u, v, w=d["sum_kzt"])
    for _, _, d in U.edges(data=True):
        d["logw"] = float(np.log1p(d["w"]))
    return U, list(U.edges())


def coassignment(U, E, n_runs=30, seed0=0, weight="w", resolution=1.0):
    """Для каждой связи — доля запусков Louvain, где её концы попали в одно сообщество."""
    together = np.zeros(len(E))
    if not E:
        return together
    for s in range(seed0, seed0 + n_runs):
        comms = nx.community.louvain_communities(U, weight=weight, resolution=resolution, seed=s)
        lab = {x: i for i, c in enumerate(comms) for x in c}
        together += np.fromiter((lab[u] == lab[v] for u, v in E), dtype=bool, count=len(E))
    return together / max(n_runs, 1)


def labels_from_agreement(U, E, agree, thr=0.8, attach=0.5):
    """Ядра = связи с согласием >= thr; одиночек присоединяем к соседу с согласием >= attach.
    0 = узлы без переводов; остальные id по убыванию размера (при равенстве — по минимальному gid)."""
    C = nx.Graph()
    C.add_nodes_from(U)
    C.add_edges_from(ed for ed, a in zip(E, agree) if a >= thr)
    core = {x: i for i, c in enumerate(nx.connected_components(C)) for x in c}
    csize = pd.Series(core).value_counts()
    ag = {}
    for (u, v), a in zip(E, agree):
        ag[(u, v)] = ag[(v, u)] = a
    for x in sorted(U.nodes()):
        if csize[core[x]] == 1 and U.degree(x) > 0:
            best = max(U.neighbors(x), key=lambda y: (ag[(x, y)], -y))
            if ag[(x, best)] >= attach:
                core[x] = core[best]
    lab = pd.Series(core)
    iso = [x for x in U if U.degree(x) == 0]
    grp = lab.drop(iso)
    if len(grp) == 0:
        return pd.Series(0, index=lab.index, dtype=int)
    stats = (pd.DataFrame({"c": grp.to_numpy(), "gid": grp.index.to_numpy()})
             .groupby("c").agg(size=("gid", "size"), first=("gid", "min")))
    order = stats.sort_values(["size", "first"], ascending=[False, True]).index
    mapping = {c: i + 1 for i, c in enumerate(order)}
    return lab.map(mapping).fillna(0).astype(int)


def _best_match(members, other):
    cand = other.loc[list(members)].value_counts().index[:3]
    return max(len(set(members) & set(other.index[other == c])) / len(set(members) | set(other.index[other == c]))
               for c in cand)


def cluster_stability(U, E, agree, base, p):
    """Средний Jaccard кластера с лучшим совпадением в вариантах: другая случайность,
    порог согласия 0.7/0.9, resolution 0.5/2.0. Выбор веса рёбер — методика, здесь не варьируется."""
    variants = [
        labels_from_agreement(U, E, coassignment(U, E, p["cl_runs"], p["cl_seed0"] + 1000, p["cl_weight"],
                                                 p["cl_resolution"]), p["cl_thr"], p["cl_attach"]),
        labels_from_agreement(U, E, agree, 0.7, p["cl_attach"]),
        labels_from_agreement(U, E, agree, 0.9, p["cl_attach"]),
    ]
    for res in (0.5, 2.0):
        variants.append(labels_from_agreement(U, E, coassignment(U, E, p["cl_runs"], p["cl_seed0"], p["cl_weight"],
                                                                 res), p["cl_thr"], p["cl_attach"]))
    variants = [v.reindex(base.index) for v in variants]
    stab = {}
    for cid, mem in base[base != 0].groupby(base[base != 0]):
        stab[int(cid)] = round(float(np.mean([_best_match(mem.index, v) for v in variants])), 3)
    return pd.Series(stab, dtype=float)


def cluster_nodes(G, p):
    U, E = build_undirected(G)
    agree = coassignment(U, E, p["cl_runs"], p["cl_seed0"], p["cl_weight"], p["cl_resolution"])
    lab = labels_from_agreement(U, E, agree, p["cl_thr"], p["cl_attach"])
    return lab, U, E, agree


# ============================================================================
# 4. Роли, уверенность, приоритет, evidence
# ============================================================================
def node_evidence(r, role, weak, p=PARAMS):
    reliable = bool(r.inflow_reliable) and r.in_sum > 0
    pay = cnt(r.in_deg, "плательщик", "плательщика", "плательщиков")
    rec = cnt(r.out_deg, "получатель", "получателя", "получателей")
    from_pay = cnt(r.in_deg, "плательщика", "плательщиков", "плательщиков")
    fs = 0.0 if pd.isna(r.fast_share) else float(r.fast_share)
    parts = []

    if r.no_edges:
        main = "нет переводов в выгрузке: роль определить нельзя"
    elif role == "coordinator":
        main = f"признаки координации: {pay} и {rec}"
    elif role == "consolidator":
        main = f"признаки консолидации: {pay}"
        if r.in_from_seed_deg:
            main += f" (из них seed: {r.in_from_seed_deg})"
        main += f", получил {money(r.in_sum)}"
        parts.append("исходящие не выгружены" if r.flag_truncated
                     else f"отдал дальше {r.pass_ratio:.0%}" if reliable else "видимый вход неполный")
        if r.max_payers_day >= p["sync_min_payers"]:
            parts.append(f"до {r.max_payers_day} плательщиков в день")
    elif role == "distributor":
        main = f"веерная рассылка: {rec}, отправил {money(r.out_sum)}"
        if r.flag_out_gt_in:
            parts.append(f"видимый вход {money(r.in_sum)}, источник вне выгрузки")
    elif role == "transit":
        main = f"признаки транзита: получил {money(r.in_sum)}, отправил {money(r.out_sum)}"
        if reliable:
            main += f" ({r.pass_ratio:.0%})"
        if fs >= 0.5:
            parts.append(f"{fs:.0%} отправлено в течение {p['fast_days']} дней после входа")
    elif role == "terminal":
        main = f"конечная точка в пределах выгрузки: получил {money(r.in_sum)} от {from_pay}, исходящих нет"
        parts.append(f"доля seed-денег ~{r.seed_share:.0%}")
        if r.late_last_in:
            parts.append("вход в конце периода, мог переслать позже")
    elif r.flag_truncated:
        main = (f"обрыв выгрузки на последнем колене: получил {money(r.in_sum)} от {from_pay}, "
                f"исходящие неизвестны")
    else:
        main = f"выраженных признаков нет: {r.in_deg} вх./{r.out_deg} исх., оборот {money(r.volume_dedup)}"

    if not r.no_edges:
        if r.n_seed_links:
            parts.append(f"связан {'ещё ' if r.is_seed else ''}с {r.n_seed_links} seed")
        if r.in_cycle3:
            parts.append("участвует в круговых потоках (3+ участника)")
        elif r.n_mutual:
            parts.append(f"взаимные переводы с {r.n_mutual}")
        if role not in ("peripheral", "terminal"):
            if weak:
                parts.append("связь с seed-деньгами слабая, возможна легальная активность")
            elif r.seed_share >= 0.3:
                parts.append(f"доля seed-денег ~{r.seed_share:.0%}")

    text = ("[seed] " if r.is_seed else "") + main
    for part in parts:                        # по важности, пока влезает в 200 символов
        if len(text) + 2 + len(part) <= 200:
            text += "; " + part
    return text[:200]


def priority_from_components(comps, is_seed, prio_w, seed_factor):
    wsum = sum(prio_w.values())
    prio = sum(prio_w[k] * comps[f"c_{k}"].to_numpy() for k in prio_w) / wsum
    return np.where(np.asarray(is_seed, bool), prio * seed_factor, prio)


def assign_roles(F, p=PARAMS, with_evidence=True):
    g = lambda c: F[c].to_numpy()
    n = len(F)
    pr = np.nan_to_num(g("pass_ratio").astype(float), nan=0.0)
    ind, outd = g("in_deg"), g("out_deg")
    ins, outs = g("in_sum").astype(float), g("out_sum").astype(float)
    trunc, seed, noe, reliable = (g(c).astype(bool) for c in
                                  ("flag_truncated", "is_seed", "no_edges", "inflow_reliable"))
    fast = np.nan_to_num(g("fast_share").astype(float))
    links, sshare = g("n_seed_links"), g("seed_share").astype(float)
    late, cyc3 = g("late_last_in").astype(bool), g("in_cycle3").astype(bool)
    sync = g("max_payers_day") >= p["sync_min_payers"]

    # [гипотеза] слабая связь с seed — меняет только уверенность (и запрещает «координатора»)
    weak = (sshare < p["weak_seed_share"]) & (links == 0)
    hyp = np.where(weak, p["weak_penalty"], 1.0)

    # coordinator: собирает и раздаёт + (8+ плательщиков или 2+ seed) + связь с seed не слабая
    gate_coord = ((ind >= p["coord_min_in"]) & (outd >= p["coord_min_out"])
                  & ((ind >= p["coord_strong_in"]) | (links >= p["coord_min_seed_links"])) & ~weak)
    s_coord = (0.5 + 0.2 * sat(ind, p["coord_min_in"], 3 * p["coord_min_in"])
                   + 0.2 * sat(outd, p["coord_min_out"], 6 * p["coord_min_out"])
                   + 0.1 * sat(links, 0, 3))

    # consolidator: уверенность ступенькой 5 -> 8 -> 16 плательщиков
    keep = np.where(trunc, 0.5, 1 - np.clip(pr / p["cons_max_pass"], 0, 1))
    gate_cons = (ind >= p["cons_min_in"]) & (pr <= p["cons_max_pass"])
    s_cons = (0.45 + 0.15 * sat(ind, p["cons_min_in"], p["cons_strong_in"])
                   + 0.15 * sat(ind, p["cons_strong_in"], 2 * p["cons_strong_in"])
                   + 0.15 * keep + 0.1 * sync)
    s_cons = np.where(trunc, 0.8 * s_cons, s_cons) * hyp

    # distributor
    gate_dist = outd >= p["dist_min_out"]
    s_dist = (0.5 + 0.5 * sat(outd, p["dist_min_out"], 6 * p["dist_min_out"])) * hyp

    # transit: по балансу, где он виден; по скорости [гипотеза] — только где баланс не виден
    lo, hi = p["band"]
    band_ok = reliable & (pr >= lo) & (pr <= hi) & (ins >= p["min_sum"])
    fast_ok = ~reliable & (fast >= p["fast_min"]) & (ins >= p["min_sum"]) & (outs >= p["min_sum"])
    gate_tr = band_ok | fast_ok
    s_tr = np.where(band_ok,
                    0.55 + 0.2 * (1 - np.clip(np.abs(pr - 1) / (hi - 1), 0, 1))
                         + 0.15 * sat(ins, p["min_sum"], 10 * p["min_sum"]) + 0.1 * (fast >= p["fast_min"]),
                    0.45 + 0.35 * sat(fast, p["fast_min"], 1.0)) * hyp

    # terminal: видимый тупик (обрезанные — никогда); гипотезы только снижают уверенность
    gate_term = (outd == 0) & ~trunc & ~seed & (ins >= p["min_sum"])
    s_term = (0.5 + 0.3 * sat(ins, p["min_sum"], 10 * p["min_sum"])
                  + 0.2 * sat(sshare, p["term_seed_share"], 0.8))
    s_term = np.where(late, 0.7 * s_term, s_term)
    s_term = np.where(sshare < p["term_seed_share"], 0.6 * s_term, s_term)

    role = np.full(n, "peripheral", dtype=object)
    score = np.zeros(n)
    for name, gate, s in [("terminal", gate_term, s_term), ("transit", gate_tr, s_tr),
                          ("distributor", gate_dist, s_dist), ("consolidator", gate_cons, s_cons),
                          ("coordinator", gate_coord, s_coord)]:     # последнее правило главнее
        role = np.where(gate, name, role)
        score = np.where(gate, s, score)

    per = role == "peripheral"
    small = (ind + outd <= 2) & (g("volume_dedup") < p["min_sum"])
    score = np.where(per, np.where(small, 0.9, 0.6), score)
    art_trunc = per & trunc
    score = np.where(art_trunc, 0.3, score)
    score = np.where(noe, 0.2, score)
    score = np.clip(score, 0, 1).round(3)

    tier = np.full(n, "B", dtype=object)                                    # B — правило
    tier = np.where(noe | art_trunc, "A", tier)                             # A — артефакт данных
    tier = np.where((role == "transit") & fast_ok & ~band_ok, "C", tier)    # C — гипотеза

    comps = pd.DataFrame({
        "c_role": np.array([p["role_w"][r] for r in role]) * score,
        "c_seed_money": pct(g("seed_money_in")),
        "c_in_deg": pct(ind),
        "c_out_deg": pct(outd),
        "c_volume": pct(g("volume_dedup")),
        "c_seed_links": sat(links, 0, 3),
        "c_cycle3": cyc3.astype(float),
    }, index=F.index)
    prio = priority_from_components(comps, seed, p["prio_w"], p["seed_factor"])

    out = pd.DataFrame({"role": role, "role_score": score, "priority_score": np.round(prio, 4),
                        "tier": tier, "weak_seed_link": weak, "cluster_id": F.cluster_id.to_numpy()},
                       index=F.index)
    out = out.join(comps)
    if with_evidence:
        out["evidence"] = [node_evidence(r, rl, w, p) for r, rl, w in zip(F.itertuples(), role, weak)]
    return out


def role_stability(F, p, base_roles):
    """Доля вариантов порогов (±1 шаг), при которых роль узла не меняется."""
    grid = p["stability_grid"]
    keys = list(grid)
    combos = list(product(*grid.values()))
    agree = np.zeros(len(F))
    for combo in combos:
        over = dict(zip(keys, combo))
        if "cons_min_in" in over:
            over.setdefault("coord_min_in", over["cons_min_in"])
        if "dist_min_out" in over:
            over.setdefault("coord_min_out", over["dist_min_out"])
        agree += assign_roles(F, {**p, **over}, with_evidence=False).role.to_numpy() == np.asarray(base_roles)
    return agree / len(combos)


# ============================================================================
# 5. clusters.csv
# ============================================================================
def _cluster_facts(N, e):
    cl_of = N.cluster_id
    dep = N.depth
    ei = e.assign(c_src=e.src.map(cl_of), c_dst=e.dst.map(cl_of))
    internal = ei[ei.c_src == ei.c_dst].copy()
    cross = ei[ei.c_src != ei.c_dst]
    internal["back"] = internal.dst.map(dep) <= internal.src.map(dep)
    internal["from_seed"] = internal.src.map(N.is_seed).astype(bool)
    return internal, cross


def cluster_hypothesis(cid, grp, st, flows, p=PARAMS):
    """Гипотеза о назначении кластера: тип + ключевой узел + факты. Возвращает (тип, сила, текст)."""
    if cid == 0:
        return ("no_data", "нет данных",
                "Нет данных: узлы без переводов в выгрузке (в т.ч. seed); структуру определить нельзя, "
                "нужны входящие переводы и другие периоды")
    n, ns = st["n_nodes"], st["n_seed"]
    top = grp.sort_values(["priority_score", "role_score"], ascending=False, kind="mergesort")
    first = lambda role: next(iter(top.index[top.role == role]), None)
    c, k, d, t = first("coordinator"), first("consolidator"), first("distributor"), first("transit")
    hub = st["hub"]
    nodes_txt = cnt(n, "узел", "узла", "узлов")
    seed_txt = f", seed в группе: {ns}" if ns else ""

    if n <= 3:
        typ, strength = "fragment", "слабая"
        if len(flows):
            f = flows.iloc[0]
            main = (f"малый фрагмент ({nodes_txt}): основной перевод {int(f.src)} → {int(f.dst)} "
                    f"на {money(f.sum_kzt)}{seed_txt}")
        else:
            main = f"малый фрагмент ({nodes_txt}){seed_txt}"
    elif c is not None:
        typ = "core"
        strength = "сильная" if ns >= 2 else "умеренная"
        main = (f"возможное ядро: узел {c} собирает от "
                f"{cnt(top.loc[c, 'in_deg'], 'плательщика', 'плательщиков', 'плательщиков')} и раздаёт "
                f"{cnt(top.loc[c, 'out_deg'], 'получателю', 'получателям', 'получателям')}{seed_txt}")
    elif k is not None and (ns >= 1 or st["seed_share_internal"] >= 0.3 or top.loc[k, "in_from_seed_deg"] > 0):
        typ = "collection"
        k_seed = int(top.loc[k, "in_from_seed_deg"])
        strength = "сильная" if k_seed >= 2 else "умеренная"
        main = (f"возможный сбор средств: узел {k} получил {money(top.loc[k, 'in_sum'])} от "
                f"{cnt(top.loc[k, 'in_deg'], 'плательщика', 'плательщиков', 'плательщиков')}"
                + (f" (из них seed: {k_seed})" if k_seed else "") + seed_txt)
    elif d is not None:
        typ, strength = "fan_out", ("умеренная" if ns or st["seed_share_internal"] >= 0.3 else "слабая")
        main = (f"веерная раздача: узел {d} отправил {money(top.loc[d, 'out_sum'])} "
                f"{cnt(top.loc[d, 'out_deg'], 'получателю', 'получателям', 'получателям')}{seed_txt}")
    elif t is not None:
        typ, strength = "transit_chain", "умеренная"
        main = (f"возможная транзитная цепочка через узел {t}: получил {money(top.loc[t, 'in_sum'])}, "
                f"отправил {money(top.loc[t, 'out_sum'])}{seed_txt}")
    elif ns:
        typ, strength = "seed_periphery", "слабая"
        main = (f"окружение seed {hub}: {nodes_txt}, преимущественно разовые переводы "
                f"(в среднем {st['tx_per_link']:.1f} перевода на связь), оборот {money(st['sum_kzt_internal'])}")
    else:
        typ, strength = "periphery", "слабая"
        main = (f"группа вокруг узла {hub} ({ROLE_RU[grp.loc[hub, 'role']]}): {nodes_txt}, "
                f"оборот {money(st['sum_kzt_internal'])}, выраженных ролей нет")

    q = []
    if n >= 5 and st["star_share"] >= 0.8:
        q.append("структура «звезда» вокруг одного узла")
    if st["n_in_cycle3"] >= 3:
        q.append(f"{cnt(st['n_in_cycle3'], 'узел', 'узла', 'узлов')} в круговых потоках")
    if n > 3 and st["back_share"] >= p["back_flow_share"]:
        q.append(f"{st['back_share']:.0%} оборота идёт назад по коленам — возможны возвратные потоки")
    if st["seed_share_internal"] >= 0.5:
        q.append(f"{st['seed_share_internal']:.0%} внутреннего оборота исходит от seed")
    if st["n_truncated"] / n >= 0.5:
        q.append("больше половины узлов обрезаны последним коленом, картина неполная")
    lead = next((x for x in (c, k, d, t) if x is not None), None)
    if lead is not None and bool(top.loc[lead, "weak_seed_link"]):
        q.append("связь ключевого узла с seed-деньгами слабая")
        strength = "слабая"
    s = st.get("stability", np.nan)
    if n > 3 and not pd.isna(s) and s < p["cl_stable_min"]:
        q.append(f"границы группы неустойчивы (устойчивость {s:.2f})")
        strength = {"сильная": "умеренная", "умеренная": "слабая"}.get(strength, strength)
    return typ, strength, "Гипотеза: " + main + ("; " + "; ".join(q) if q else "")


def build_clusters(N, e, p=PARAMS, stab=None):
    internal, cross = _cluster_facts(N, e)
    sum_int = internal.groupby("c_src").sum_kzt.sum()
    seed_int = internal[internal.from_seed].groupby("c_src").sum_kzt.sum()
    back_int = internal[internal.back].groupby("c_src").sum_kzt.sum()
    ntx_int = internal.groupby("c_src").n_tx.sum()
    out_ext = cross.groupby("c_src").sum_kzt.sum()
    in_ext = cross.groupby("c_dst").sum_kzt.sum()
    n_int_edges = internal.groupby("c_src").size()
    inc = pd.concat([internal[["c_src", "src", "sum_kzt"]].set_axis(["c", "n", "s"], axis=1),
                     internal[["c_src", "dst", "sum_kzt"]].set_axis(["c", "n", "s"], axis=1)])
    deg_int = inc.groupby(["c", "n"]).size()
    vol_int = inc.groupby(["c", "n"]).s.sum()
    flows_by = {c: g.sort_values(["sum_kzt", "src", "dst"], ascending=[False, True, True])
                for c, g in internal.groupby("c_src")}

    rows = []
    for cid, grp in N.groupby("cluster_id", sort=True):
        grp = grp.sort_index()
        top = grp.sort_values(["priority_score", "role_score"], ascending=False, kind="mergesort")
        rc = grp.role.value_counts()
        si = float(sum_int.get(cid, 0.0))
        ne = int(n_int_edges.get(cid, 0))
        if cid in vol_int.index.get_level_values(0):
            v = vol_int.loc[cid]
            hub = int(v[v == v.max()].index.min())
            star = float(deg_int.loc[cid].max()) / ne if ne else 0.0
        else:
            hub, star = int(top.index[0]), 0.0
        st = dict(
            cluster_id=int(cid), n_nodes=int(len(grp)), n_seed=int(grp.is_seed.sum()),
            sum_kzt_internal=round(si, 2),
            top_gids=";".join(str(int(x)) for x in top.index[:5]),
            sum_in_external=round(float(in_ext.get(cid, 0.0)), 2),
            sum_out_external=round(float(out_ext.get(cid, 0.0)), 2),
            seed_share_internal=round(float(seed_int.get(cid, 0.0)) / si, 3) if si > 0 else 0.0,
            back_share=round(float(back_int.get(cid, 0.0)) / si, 3) if si > 0 else 0.0,
            star_share=round(star, 3), hub=hub, n_internal_edges=ne,
            tx_per_link=float(ntx_int.get(cid, 0)) / ne if ne else 0.0,
            n_in_cycle3=int(grp.in_cycle3.sum()), n_truncated=int(grp.flag_truncated.sum()),
            max_priority=float(top.priority_score.iloc[0]),
            mean_priority=round(float(grp.priority_score.mean()), 4),
            stability=float(stab.get(cid, np.nan)) if stab is not None and cid != 0 else np.nan,
            **{f"n_{r}": int(rc.get(r, 0)) for r in ROLES},
        )
        typ, strength, text = cluster_hypothesis(cid, grp, st, flows_by.get(cid, internal.iloc[:0]), p)
        st.update(cluster_type=typ, hypothesis_strength=strength, hypothesis=text)
        st["tx_per_link"] = round(st["tx_per_link"], 2)
        rows.append(st)
    return pd.DataFrame(rows).sort_values("cluster_id").reset_index(drop=True)


# ============================================================================
# 6. top_nodes.csv
# ============================================================================
def top_why(r, p_seed, p_vol, p=PARAMS):
    ev = r.evidence
    reasons = []
    if p_seed >= 0.9 and r.seed_money_in > 0:
        reasons.append(f"верхние 10% по seed-деньгам (~{money(r.seed_money_in)})")
    if r.n_seed_links >= 2 and "связан" not in ev:
        reasons.append(f"прямые связи с {r.n_seed_links} seed")
    if r.in_cycle3 and "круговых" not in ev:
        reasons.append("круговые потоки из 3+ участников")
    if r.max_payers_day >= p["sync_min_payers"] and "в день" not in ev:
        reasons.append("синхронные поступления от нескольких плательщиков")
    if p_vol >= 0.95:
        reasons.append(f"крупный оборот ({money(r.volume_dedup)})")
    if not reasons:
        reasons.append("совокупность структурных признаков")
    txt = f"{ev}. Приоритет: {', '.join(reasons)}."
    if r.weak_seed_link and "слабая" not in ev:
        txt += " Связь с seed не подтверждена: приоритет за счёт структуры, возможна легальная активность."
    if not pd.isna(r.role_stability):
        txt += f" Роль устойчива в {r.role_stability:.0%} вариантов порогов."
    txt += f" Кластер {r.cluster_id}."
    if r.is_seed:
        txt += " Уже известен (seed)."
    if r.tier == "C":
        txt += " Роль — гипотеза по косвенным признакам."
    return txt + " Требует проверки."


def build_top(N, p=PARAMS):
    ps = pd.Series(pct(N.seed_money_in), index=N.index)
    pv = pd.Series(pct(N.volume_dedup), index=N.index)
    order = N.sort_index().sort_values(["priority_score", "role_score"], ascending=False, kind="mergesort")
    T = order.head(min(p["top_n"], len(N))).copy()
    T["why"] = [top_why(r, ps[r.Index], pv[r.Index], p) for r in T.itertuples()]
    T = T.reset_index()
    T.insert(0, "rank", np.arange(1, len(T) + 1))
    return T


# ============================================================================
# 7. Опциональные блоки ТЗ: устойчивость сети, оценка полноты, карточка узла
# ============================================================================
def _reach_stats(G, removed, seeds, total_flow, n_active):
    H = G.subgraph([x for x in G.nodes if x not in removed])
    active = [x for x in H.nodes if H.degree(x) > 0]
    comps = list(nx.weakly_connected_components(H.subgraph(active))) if active else []
    largest = max((len(c) for c in comps), default=0)
    src = [s for s in seeds if s in H]
    seen, dq = set(src), deque(src)
    while dq:
        u = dq.popleft()
        for v in H.successors(u):
            if v not in seen:
                seen.add(v)
                dq.append(v)
    flow = sum(d["sum_kzt"] for u, v, d in H.edges(data=True) if u in seen)
    return dict(n_components=len(comps), largest_component_share=largest / max(n_active, 1),
                reachable_from_seed=len(seen - set(src)), reachable_flow_share=flow / total_flow if total_flow else 0.0)


def resilience(R, ks=None, n_random=None, seed=0):
    """Что будет с сетью, если изъять топ-k узлов (по приоритету / по числу связей / случайно)."""
    p, G, N = R["params"], R["G"], R["N"]
    ks = [k for k in (ks or p["resilience_k"]) if k < len(N)]
    n_random = n_random if n_random is not None else p["resilience_random"]
    seeds = [int(x) for x in N.index[N.is_seed]]
    total_flow = sum(d["sum_kzt"] for _, _, d in G.edges(data=True))
    n_active = sum(1 for x in G.nodes if G.degree(x) > 0)
    rows = [dict(strategy="без изъятия", k=0, **_reach_stats(G, set(), seeds, total_flow, n_active))]
    by_prio = N.sort_values(["priority_score", "role_score"], ascending=False, kind="mergesort").index
    deg = (N.in_deg + N.out_deg).sort_index().sort_values(ascending=False, kind="mergesort").index
    rng = np.random.default_rng(seed)
    pool = np.array([x for x in N.index if G.degree(x) > 0])
    for k in ks:
        rows.append(dict(strategy="топ по priority", k=k,
                         **_reach_stats(G, set(by_prio[:k]), seeds, total_flow, n_active)))
        rows.append(dict(strategy="топ по числу связей", k=k,
                         **_reach_stats(G, set(deg[:k]), seeds, total_flow, n_active)))
        if len(pool) >= k and n_random:
            rs = [_reach_stats(G, set(rng.choice(pool, k, replace=False)), seeds, total_flow, n_active)
                  for _ in range(n_random)]
            rows.append(dict(strategy="случайные (среднее)", k=k,
                             **{m: float(np.mean([r[m] for r in rs])) for m in rs[0]}))
    df = pd.DataFrame(rows)
    for c in ("largest_component_share", "reachable_flow_share"):
        df[c] = df[c].round(3)
    df["n_components"] = df.n_components.round(1)
    df["reachable_from_seed"] = df.reachable_from_seed.round(1)
    return df


def data_requests(N, p=PARAMS, limit=200):
    """Оценка полноты: каких данных не хватает и какой запрос сделать следующим."""
    rows = []
    add = lambda g, what, why: rows.append(dict(gid=int(g), request=what, reason=why,
                                               priority_score=float(N.loc[g, "priority_score"]),
                                               role=N.loc[g, "role"]))
    for g, r in N.iterrows():
        if r.flag_truncated and r.in_sum >= p["min_sum"]:
            add(g, "исходящие переводы (следующее колено)",
                f"получил {money(r.in_sum)}, исходящие не выгружались — неизвестно, осели ли деньги")
        if r.flag_out_gt_in and r.out_sum - r.in_sum >= p["min_sum"]:
            add(g, "входящие переводы от клиентов вне выборки",
                f"отправил на {money(r.out_sum - r.in_sum)} больше, чем получил по данным — источник не виден")
        if r.role == "terminal" and r.late_last_in:
            add(g, "переводы за следующий месяц",
                "вход в конце периода — деньги могли уйти дальше после выгрузки")
        if r.role in ("terminal", "consolidator") and not r.flag_truncated and r.in_sum >= 5 * p["min_sum"]:
            add(g, "межбанковские переводы и снятие наличных",
                f"получил {money(r.in_sum)} и почти не отдал внутри банка — возможен вывод за пределы банка")
        if r.no_edges and r.is_seed:
            add(g, "входящие переводы и другие периоды", "seed без переводов в выгрузке — роль не определить")
    df = pd.DataFrame(rows, columns=["gid", "request", "reason", "priority_score", "role"])
    return (df.sort_values(["priority_score", "gid"], ascending=[False, True])
              .head(limit).reset_index(drop=True))


def node_card(R, gid, n_cp=5):
    """Карточка узла для аналитика (для Jupyter и демо)."""
    N, e, cl = R["N"], R["e"], R["clusters"]
    gid = int(gid)
    if gid not in N.index:
        return f"gid {gid} нет в данных"
    r = N.loc[gid]
    inc = e[e.dst == gid].sort_values("sum_kzt", ascending=False).head(n_cp)
    out = e[e.src == gid].sort_values("sum_kzt", ascending=False).head(n_cp)
    fmt = lambda df, col: "\n".join(
        f"    {int(x)}  {money(s)} ({ROLE_RU[N.loc[x, 'role']]}{', seed' if N.loc[x, 'is_seed'] else ''})"
        for x, s in zip(df[col], df.sum_kzt)) or "    —"
    hyp = cl.set_index("cluster_id").hypothesis.get(r.cluster_id, "") if cl is not None else ""
    lines = [
        f"gid {gid}" + ("  [SEED]" if r.is_seed else ""),
        f"роль: {ROLE_RU[r.role]} (уверенность {r.role_score:.2f}, уровень {r.tier}"
        + (f", устойчива в {r.role_stability:.0%} вариантов порогов" if not pd.isna(r.role_stability) else "") + ")",
        f"приоритет: {r.priority_score:.3f}" + (f" (место {int(R['rank'][gid])})" if gid in R["rank"] else ""),
        f"колено: {r.depth} | кластер: {r.cluster_id}",
        f"получил {money(r.in_sum)} от {r.in_deg}, отправил {money(r.out_sum)} на {r.out_deg}; "
        f"доля seed-денег ~{r.seed_share:.0%}",
        f"почему: {r.evidence}",
        f"крупнейшие плательщики:\n{fmt(inc, 'src')}",
        f"крупнейшие получатели:\n{fmt(out, 'dst')}",
        f"кластер: {hyp}",
    ]
    watch = []
    if r.flag_truncated:
        watch.append("исходящие не выгружены — запросить следующее колено")
    if r.flag_out_gt_in:
        watch.append("вход виден не полностью — запросить входящие")
    if r.weak_seed_link and r.role != "peripheral":
        watch.append("связь с seed-деньгами слабая — проверить легальный характер деятельности")
    if r.late_last_in and r.role == "terminal":
        watch.append("вход в конце периода — проверить следующий месяц")
    if watch:
        lines.append("на что обратить внимание: " + "; ".join(watch))
    return "\n".join(lines)


# ============================================================================
# 8. Расчёт и проверка выгрузок
# ============================================================================
def compute(nodes, e, tx, params=None, clusters=True, stability=True):
    """Весь расчёт в памяти, без записи файлов."""
    p = merge_params(params)
    F, G, cycles, meta = build_features(nodes, e, tx, p)
    U = E = agree = None
    stab = None
    if clusters:
        lab, U, E, agree = cluster_nodes(G, p)
        F["cluster_id"] = lab.reindex(F.index).to_numpy()
        if p["cl_stability"] and len(E):
            stab = cluster_stability(U, E, agree, F.cluster_id, p)
    else:                                              # быстрый режим для проверок устойчивости
        F["cluster_id"] = np.where(F.no_edges, 0, F.component + 1)
    roles = assign_roles(F, p)
    roles["role_stability"] = role_stability(F, p, roles.role) if stability else np.nan
    N = roles.join(F.drop(columns=["cluster_id"]))
    cl = build_clusters(N, e, p, stab) if clusters else None
    top = build_top(N, p)
    return dict(params=p, nodes=nodes, e=e, tx=tx, F=F, G=G, cycles=cycles, meta=meta, U=U, E=E, agree=agree,
                roles=roles, N=N, clusters=cl, top=top, rank=dict(zip(top.gid, top["rank"])))


def validate_outputs(out_dir, n_nodes, n_seed):
    out = Path(out_dir)
    nr = pd.read_csv(out / "nodes_roles.csv")
    cl = pd.read_csv(out / "clusters.csv")
    tp = pd.read_csv(out / "top_nodes.csv")
    nr_idx = nr.set_index("gid")
    top_in_cluster = all(nr_idx.loc[[int(x) for x in str(s).split(";")], "cluster_id"].eq(c).all()
                         for c, s in zip(cl.cluster_id, cl.top_gids))
    merged = tp.merge(nr, on="gid", suffixes=("", "_n"))
    need_top = min(MIN_TOP, n_nodes)
    return {
        "nodes_roles: колонки по ТЗ": list(nr.columns) == NODES_SCHEMA,
        f"nodes_roles: {n_nodes} строк, gid уникальны": len(nr) == n_nodes and nr.gid.is_unique,
        "nodes_roles: gid целые (int64)": pd.api.types.is_integer_dtype(nr.gid),
        "nodes_roles: роли из словаря": bool(nr.role.isin(ROLES).all()),
        "nodes_roles: role_score и priority в [0,1]": bool(nr.role_score.between(0, 1).all()
                                                           and nr.priority_score.between(0, 1).all()),
        "nodes_roles: нет пропусков": bool(nr.notna().all().all()),
        "nodes_roles: evidence непустой и <= 200": bool(nr.evidence.str.len().between(1, 200).all()),
        "clusters: колонки по ТЗ": list(cl.columns) == CLUSTERS_SCHEMA,
        "clusters: каждый cluster_id узла описан": set(nr.cluster_id) == set(cl.cluster_id),
        f"clusters: сумма n_nodes = {n_nodes}": int(cl.n_nodes.sum()) == n_nodes,
        f"clusters: сумма n_seed = {n_seed}": int(cl.n_seed.sum()) == n_seed,
        "clusters: n_nodes совпадает с nodes_roles":
            nr.cluster_id.value_counts().sort_index().to_dict() == cl.set_index("cluster_id").n_nodes.to_dict(),
        "clusters: top_gids из своего кластера": top_in_cluster,
        "clusters: hypothesis заполнена": bool(cl.hypothesis.str.len().gt(0).all()),
        "top_nodes: колонки по ТЗ": list(tp.columns) == TOP_SCHEMA,
        f"top_nodes: >= {need_top} строк": len(tp) >= need_top,
        "top_nodes: rank = 1..N, priority по убыванию":
            tp["rank"].tolist() == list(range(1, len(tp) + 1)) and tp.priority_score.is_monotonic_decreasing,
        "top_nodes: gid и роли совпадают с nodes_roles":
            len(merged) == len(tp) and bool((merged.role == merged.role_n).all()),
        "top_nodes: why заполнен": bool(tp.why.str.len().gt(0).all()),
    }


def write_outputs(R, out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    N, clusters, top = R["N"], R["clusters"], R["top"]
    csv = dict(index=False, encoding="utf-8-sig", lineterminator="\n")
    N.reset_index()[NODES_SCHEMA].to_csv(out / "nodes_roles.csv", **csv)
    N.reset_index().to_csv(out / "nodes_roles_ext.csv", **csv)
    clusters[CLUSTERS_SCHEMA].to_csv(out / "clusters.csv", **csv)
    clusters.to_csv(out / "clusters_ext.csv", **csv)
    top[TOP_SCHEMA].to_csv(out / "top_nodes.csv", **csv)
    ext_cols = TOP_SCHEMA + ["role_score", "tier", "role_stability", "weak_seed_link", "is_seed", "depth",
                             "cluster_id", "in_deg", "out_deg", "in_sum", "out_sum", "seed_money_in", "seed_share",
                             "n_seed_links", "in_cycle3", "n_mutual"]
    top[ext_cols].to_csv(out / "top_nodes_ext.csv", **csv)
    p = R["params"]
    pd.DataFrame([dict(param=k, value=json.dumps(p[k], ensure_ascii=False, default=list), kind=v[0], why=v[1])
                  for k, v in ASSUMPTIONS.items()]).to_csv(out / "assumptions.csv", **csv)


def run(data_dir="data", out_dir="output", params=None, viz=True, stability=True, verbose=True, extras=True):
    T0 = time.time()
    log = print if verbose else (lambda *a, **k: None)
    out = Path(out_dir)
    timings = {}

    def step(name, t):
        timings[name] = round(time.time() - t, 2)
        log(f"  {name}: {timings[name]} с")

    log("Граф денег: пересчёт")
    t = time.time(); nodes, e, tx, issues = load(data_dir); step("загрузка и проверка данных", t)
    t = time.time()
    R = compute(nodes, e, tx, params, clusters=True, stability=stability)
    step("признаки, кластеры, роли, приоритет", t)
    R.update(data_dir=str(data_dir), out_dir=out, issues=issues, timings=timings)
    t = time.time(); write_outputs(R, out); step("выгрузки", t)
    R["checks"] = validate_outputs(out, len(R["F"]), int(R["F"].is_seed.sum()))

    if extras:
        t = time.time()
        R["resilience"] = resilience(R)
        R["resilience"].to_csv(out / "resilience.csv", index=False, encoding="utf-8-sig", lineterminator="\n")
        R["data_requests"] = data_requests(R["N"], R["params"])
        R["data_requests"].to_csv(out / "data_requests.csv", index=False, encoding="utf-8-sig", lineterminator="\n")
        step("устойчивость сети и запросы данных", t)
    if viz:
        t = time.time()
        import viewer
        viewer.build(R, out / "viewer.html")
        step("просмотрщик", t)

    timings["итого"] = round(time.time() - T0, 2)
    N, cl = R["N"], R["clusters"]
    summary = dict(period=R["meta"]["period"], n_nodes=len(N), n_seed=int(N.is_seed.sum()),
                   roles=N.role.value_counts().reindex(ROLES).fillna(0).astype(int).to_dict(),
                   tiers=N.tier.value_counts().to_dict(),
                   n_clusters=int((cl.cluster_id != 0).sum()),
                   clusters_with_many_seeds=int(((cl.cluster_id != 0) & (cl.n_seed > 1)).sum()),
                   cluster_types=cl.cluster_type.value_counts().to_dict(),
                   n_cycles=R["meta"]["n_cycles"], truncation_detected=R["meta"]["truncation_detected"],
                   dates_have_time=R["meta"]["has_time"], data_quality=issues,
                   checks_passed=all(R["checks"].values()), timings_sec=timings)
    (out / "run_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=str),
                                          encoding="utf-8")
    log("\nКачество данных:" + ("".join(f"\n  - {x}" for x in issues) if issues else " замечаний нет"))
    log("Роли:", summary["roles"])
    log(f"Кластеров: {summary['n_clusters']} (с >1 seed: {summary['clusters_with_many_seeds']}), "
        f"типы: {summary['cluster_types']}")
    log("\nПроверка выгрузок:")
    for k, v in R["checks"].items():
        log(("  OK    " if v else "  FAIL  ") + k)
    log(f"\nГотово за {timings['итого']} с. Файлы в {out.resolve()}")
    return R


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="Граф денег: роли, кластеры и приоритеты по транзакционному графу")
    ap.add_argument("--data", default="data", help="папка с nodes/edges/transactions.parquet")
    ap.add_argument("--out", default="output", help="куда сохранить результаты")
    ap.add_argument("--no-viz", action="store_true", help="не строить viewer.html")
    ap.add_argument("--no-stability", action="store_true", help="не считать устойчивость ролей к порогам")
    ap.add_argument("--runs", type=int, default=None, help="число запусков Louvain для консенсуса")
    ap.add_argument("--card", type=int, default=None, help="после расчёта вывести карточку узла по gid")
    a = ap.parse_args(argv)
    params = {"cl_runs": a.runs} if a.runs else None
    R = run(a.data, a.out, params, viz=not a.no_viz, stability=not a.no_stability)
    if a.card:
        print("\n" + node_card(R, a.card))
    return 0 if all(R["checks"].values()) else 1


if __name__ == "__main__":
    sys.exit(main())
