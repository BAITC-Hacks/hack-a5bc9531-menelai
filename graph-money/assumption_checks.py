#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Проверка допущений, устойчивости и воспроизводимости результатов.

Каждая проверка отвечает на вопрос «что будет, если наше допущение неверно?»:
меняем одно решение (порог, вес, модель, данные) и смотрим, насколько меняется результат.

  A. Кластеры (clusters.csv): случайность, веса, порог согласия, качество, тексты гипотез
  B. Топ-лист (top_nodes.csv): веса приоритета, иерархия ролей, модель seed-денег, leave-one-seed-out
  D. Реестр допущений: чувствительность результата к КАЖДОМУ параметру из pipeline.ASSUMPTIONS
  E. Устойчивость к данным: шум в суммах, выпадение части переводов
  T. Шаблонность текстов: гипотезы, evidence, why
  C. Общее: хардкод gid, время, схема, повторный запуск, перестановка строк входа

Запуск:   python assumption_checks.py --data data --out output
Jupyter:  import assumption_checks as ac; rep = ac.run_all(R)   # R = pipeline.run(...)

Результат: output/assumption_report.csv, assumption_sensitivity.csv, cluster_stability.csv,
           top_stability.csv. Статусы: OK — допущение держится; WARN — результат от него
           зависит (нужно решение или оговорка в README); INFO — справочно.
"""
import argparse
import re
import sys
import tempfile
import time
from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd
from sklearn.metrics import adjusted_rand_score

import pipeline as pl

REPORT = []

# Значения для проверки чувствительности: «один шаг в каждую сторону» от базового
SWEEP = {
    "cons_min_in": [4, 6], "cons_strong_in": [6, 10], "cons_max_pass": [0.3, 0.7],
    "dist_min_out": [8, 15], "band": [(0.85, 1.15), (0.7, 1.3)], "min_sum": [50_000, 200_000],
    "coord_min_in": [4, 6], "coord_min_out": [8, 15], "coord_strong_in": [6, 10],
    "coord_min_seed_links": [1, 3], "fast_days": [1, 3], "fast_min": [0.6, 0.8], "late_days": [1, 5],
    "sync_min_payers": [2, 4], "weak_seed_share": [0.05, 0.2], "term_seed_share": [0.1, 0.3],
    "weak_penalty": [0.6, 0.9], "seed_factor": [0.7, 1.0], "seed_denom": ["in"],
    "role_w": [dict(coordinator=1, consolidator=1, distributor=1, transit=1, terminal=1, peripheral=0.1),
               dict(coordinator=1, consolidator=1, distributor=0.8, transit=0.7, terminal=0.5, peripheral=0.1)],
}
NOT_SWEPT = {  # проверяются в других блоках или не влияют на роли/приоритет
    "prio_w": "блок B1–B2", "cl_runs": "блок A", "cl_thr": "блок A", "cl_attach": "блок A",
    "cl_seed0": "блок A1", "cl_weight": "блок A2", "cl_resolution": "блок A2", "back_flow_share": "только текст гипотез",
    "max_cycle_len": "методика", "top_n": "продукт", "stability_grid": "методика",
    "resilience_k": "опциональный отчёт", "resilience_random": "опциональный отчёт",
    "cl_stability": "блок A3", "cl_stable_min": "блок A3 (только пометка в тексте гипотезы)",
}


def note(block, check, value, status, meaning=""):
    REPORT.append(dict(block=block, check=check, value=str(value), status=status, meaning=meaning))
    mark = {"OK": "  OK  ", "WARN": " WARN ", "INFO": " info "}[status]
    print(f"[{mark}] {check}: {value}" + (f"\n          → {meaning}" if meaning else ""))


def header(t):
    print("\n" + "=" * 90 + f"\n{t}\n" + "=" * 90)


def jacc(a, b):
    a, b = set(a), set(b)
    return len(a & b) / max(len(a | b), 1)


def topk(N, k):
    return list(N.sort_index().sort_values(["priority_score", "role_score"], ascending=False,
                                           kind="mergesort").index[:k])


def cluster_labels(R, **over):
    p = {**R["params"], **over}
    U, E = R["U"], R["E"]
    same = all(p[k] == R["params"][k] for k in ("cl_runs", "cl_seed0", "cl_weight", "cl_resolution"))
    agree = R["agree"] if same else pl.coassignment(U, E, p["cl_runs"], p["cl_seed0"], p["cl_weight"],
                                                    p["cl_resolution"])
    return pl.labels_from_agreement(U, E, agree, p["cl_thr"], p["cl_attach"]).reindex(R["F"].index)


# ============================================================================
# A. Кластеры
# ============================================================================
def check_clusters(R):
    header("A. КЛАСТЕРЫ (clusters.csv)")
    F, U, cl = R["F"], R["U"], R["clusters"]
    base = F.cluster_id
    active = base[base != 0]
    if active.nunique() < 2:
        note("A", "A0 кластеров с переводами меньше двух", active.nunique(), "INFO", "проверки кластеров пропущены")
        return cl.assign(stability=np.nan)

    lab_b = cluster_labels(R, cl_seed0=R["params"]["cl_seed0"] + 1000)
    ari = adjusted_rand_score(base, lab_b)
    note("A", "A1 воспроизводимость: консенсус с другой случайностью, ARI", round(ari, 3),
         "OK" if ari >= 0.95 else "WARN", "" if ari >= 0.95 else "консенсус плавает: увеличить cl_runs")

    variants = {"порог 0.7": dict(cl_thr=0.7), "порог 0.9": dict(cl_thr=0.9),
                "вес log(сумма)": dict(cl_weight="logw"), "без весов": dict(cl_weight=None),
                "resolution 0.5": dict(cl_resolution=0.5), "resolution 2.0": dict(cl_resolution=2.0)}
    labs, rows = {}, []
    vc0 = active.value_counts()
    rows.append(dict(variant="БАЗА", ARI=1.0, n_clusters=len(vc0), n_ge5=int((vc0 >= 5).sum()),
                     largest=int(vc0.max()), multi_seed=int(((cl.cluster_id != 0) & (cl.n_seed > 1)).sum())))
    for name, over in variants.items():
        lab = cluster_labels(R, **over)
        labs[name] = lab
        vc = lab[lab != 0].value_counts()
        sp = F.is_seed.groupby(lab).sum().drop(0, errors="ignore")
        rows.append(dict(variant=name, ARI=round(adjusted_rand_score(base, lab), 3), n_clusters=len(vc),
                         n_ge5=int((vc >= 5).sum()), largest=int(vc.max()), multi_seed=int((sp > 1).sum())))
    var_df = pd.DataFrame(rows)
    print(var_df.to_string(index=False))
    for name in ("порог 0.7", "порог 0.9"):
        a = var_df.set_index("variant").loc[name, "ARI"]
        note("A", f"A2 порог согласия «{name}», ARI к базе", a, "OK" if a >= 0.9 else "WARN")
    for name in ("вес log(сумма)", "без весов", "resolution 0.5", "resolution 2.0"):
        a = var_df.set_index("variant").loc[name, "ARI"]
        note("A", f"A2 методика «{name}», ARI к базе", a, "OK" if a >= 0.8 else "INFO",
             "" if a >= 0.8 else "осознанный выбор методики (описан в README): границы кластеров от него зависят")
    ms = var_df.multi_seed
    note("A", "A2 кластеров с >1 seed во всех вариантах (ориентир ТЗ ≈ 8)", f"{ms.min()}–{ms.max()}",
         "OK" if ms.max() - ms.min() <= max(3, 0.3 * ms.median()) else "WARN",
         "число «многосидовых» групп устойчиво к методике" if ms.max() - ms.min() <= max(3, 0.3 * ms.median())
         else "число групп с несколькими seed зависит от методики")

    cl_st = cl.copy()                    # устойчивость каждого кластера считает пайплайн (pipeline.cluster_stability)
    big = cl_st[(cl_st.cluster_id != 0) & (cl_st.n_nodes >= 5)]
    weak_cl = big[big.stability < 0.6]
    note("A", "A3 кластеров ≥5 узлов с устойчивостью < 0.6", f"{len(weak_cl)} из {len(big)}",
         "OK" if len(weak_cl) <= 0.2 * max(len(big), 1) else "WARN",
         "у них в гипотезе стоит пометка «границы неустойчивы», сила гипотезы понижена" if len(weak_cl) else "")
    strong = big[big.hypothesis_strength == "сильная"]
    if len(strong):
        note("A", "A3 средняя устойчивость кластеров с «сильной» гипотезой", round(strong.stability.mean(), 2),
             "OK" if strong.stability.mean() >= 0.7 else "WARN",
             "" if strong.stability.mean() >= 0.7 else "сильные гипотезы стоят на неустойчивых кластерах")

    parts = [set(active.index[active == c]) for c in active.unique()]
    Uc = U.subgraph(active.index)
    w = R["params"]["cl_weight"]
    mod = nx.community.modularity(Uc, parts, weight=w)
    mod1 = nx.community.modularity(Uc, nx.community.louvain_communities(Uc, weight=w, seed=0), weight=w)
    note("A", "A4 модулярность: консенсус vs одиночный Louvain", f"{mod:.3f} vs {mod1:.3f}",
         "OK" if mod >= mod1 - 0.05 else "WARN")
    cover = cl.sum_kzt_internal.sum() / max(R["e"].sum_kzt.sum(), 1)
    note("A", "A4 доля оборота внутри кластеров", f"{cover:.0%}", "OK" if cover >= 0.5 else "WARN")
    ext = cl.sum_in_external + cl.sum_out_external
    leaky = cl[(cl.cluster_id != 0) & (cl.n_nodes >= 5) & (ext > cl.sum_kzt_internal)]
    note("A", "A4 кластеров ≥5 узлов, где внешний оборот больше внутреннего", len(leaky),
         "OK" if len(leaky) <= 0.3 * max(len(big), 1) else "WARN")
    comp_per = F[F.cluster_id != 0].groupby("cluster_id").component.nunique()
    note("A", "A5 кластеров, объединяющих разные компоненты", int((comp_per > 1).sum()),
         "OK" if (comp_per > 1).sum() == 0 else "WARN", "должно быть 0: между компонентами нет переводов")
    share_largest = vc0.max() / len(F)
    note("A", "A6 доля узлов в крупнейшем кластере", f"{share_largest:.0%}", "OK" if share_largest <= 0.3 else "WARN")
    note("A", "A6 кластеров-одиночек (1 узел с переводами)", int((vc0 == 1).sum()),
         "OK" if (vc0 == 1).sum() <= 0.1 * len(vc0) else "WARN")
    return cl_st


# ============================================================================
# B. Топ-лист
# ============================================================================
def check_top(R, n_mc=500):
    header("B. ТОП-ЛИСТ (top_nodes.csv)")
    p, F, N, roles = R["params"], R["F"], R["N"], R["roles"]
    K = min(p["top_n"], len(N))
    K20 = min(20, len(N))
    base_top, base20 = set(topk(N, K)), set(topk(N, K20))
    comps = roles[[c for c in roles.columns if c.startswith("c_")]]
    seed = F.is_seed.to_numpy()

    def prio_top(w=None, sf=None, cmp=None, k=K20):
        s = pd.Series(pl.priority_from_components(cmp if cmp is not None else comps, seed, w or p["prio_w"],
                                                  p["seed_factor"] if sf is None else sf), index=F.index)
        return list(s.sort_index().sort_values(ascending=False, kind="mergesort").index[:k])

    rows = {}
    for k in p["prio_w"]:
        for mult, tag in [(0.5, "×0.5"), (1.5, "×1.5"), (0.0, "убрать")]:
            w = {**p["prio_w"], k: p["prio_w"][k] * mult}
            rows[f"{k} {tag}"] = (jacc(base20, prio_top(w)), jacc(base_top, prio_top(w, k=K)))
    sens = pd.DataFrame(rows, index=["J_top20", "J_topK"]).T.sort_values("J_top20")
    print(sens.head(8).round(2).to_string())
    scaled = sens[~sens.index.str.endswith("убрать")]
    removed = sens[sens.index.str.endswith("убрать")]
    note("B", "B1 худший случай при изменении одного веса на ±50%: Jaccard топ-20",
         f"{scaled.J_top20.min():.2f} ({scaled.J_top20.idxmin()})", "OK" if scaled.J_top20.min() >= 0.6 else "WARN")
    note("B", "B1 главный «рычаг» приоритета (если убрать компонент целиком)",
         f"{removed.J_top20.idxmin().replace(' убрать', '')}: Jaccard {removed.J_top20.min():.2f}", "INFO")

    rng = np.random.default_rng(0)
    keys = list(p["prio_w"])
    alpha = np.array([p["prio_w"][k] for k in keys]) * 20
    ranks = np.empty((n_mc, len(F)))
    for i in range(n_mc):
        s = pd.Series(pl.priority_from_components(comps, seed, dict(zip(keys, rng.dirichlet(alpha))),
                                                  p["seed_factor"]), index=F.index)
        ranks[i] = s.rank(ascending=False, method="first").to_numpy()
    Rk = pd.DataFrame(ranks, columns=F.index)
    ts = pd.DataFrame({"base_rank": pd.Series({g: i + 1 for i, g in enumerate(topk(N, len(N)))}),
                       "mc_median": Rk.median(), "mc_p05": Rk.quantile(0.05), "mc_p95": Rk.quantile(0.95),
                       "p_in_topK": (Rk <= K).mean(), "p_in_top20": (Rk <= 20).mean()})
    ts = ts.loc[list(base_top)].sort_values("base_rank")
    note("B", "B2 устойчивое ядро: в топ-20 при ≥90% случайных весов", int((ts.p_in_top20 >= 0.9).sum()), "INFO")
    fragile = int((ts.p_in_topK < 0.5).sum())
    note("B", f"B2 узлов топ-{K}, выпадающих из него в >50% наборов весов", fragile,
         "OK" if fragile <= 0.2 * K else "WARN")

    for name, rw in [("все активные роли равны", dict(coordinator=1, consolidator=1, distributor=1, transit=1,
                                                       terminal=1, peripheral=0.1)),
                     ("консолидатор = координатор", {**p["role_w"], "consolidator": p["role_w"]["coordinator"]}),
                     ("роль не влияет на приоритет", {r: 1.0 for r in pl.ROLES})]:
        c2 = comps.copy()
        c2["c_role"] = N.role.map(rw).to_numpy() * N.role_score.to_numpy()
        j = jacc(base20, prio_top(cmp=c2))
        note("B", f"B3 иерархия ролей «{name}»: Jaccard топ-20", f"{j:.2f}",
             "OK" if j >= 0.6 or name == "роль не влияет на приоритет" else "WARN",
             "" if j >= 0.6 else "порядок топа зависит от иерархии ролей — обоснование в README (role_w)")

    def with_seed_model(fn):
        F2 = F.copy()
        fn(F2)
        return pl.assign_roles(F2, p, with_evidence=False)

    def aggressive(F2):
        F2["seed_share"], F2["seed_money_in"] = pl.propagate_seed_money(F2, R["e"], "in")

    def direct(F2):
        F2["seed_money_in"] = F2.in_from_seed_sum
        F2["seed_share"] = (F2.in_from_seed_sum / np.maximum(F2.in_sum, F2.out_sum).where(
            lambda s: s > 0)).fillna(0)
        F2.loc[F2.is_seed, "seed_share"] = 1.0

    for name, fn in [("агрессивная (знаменатель = видимый вход)", aggressive), ("только прямые переводы от seed", direct)]:
        rr = with_seed_model(fn)
        j = jacc(base20, topk(rr, K20))
        ch = int((rr.role != roles.role).sum())
        note("B", f"B4 модель seed-денег «{name}»: Jaccard топ-20 / смена ролей", f"{j:.2f} / {ch}",
             "OK" if j >= 0.6 else "WARN",
             "" if j >= 0.6 else "топ зависит от модели смешивания — это гипотеза (seed_denom), описана в README")

    for sf in (1.0, 0.5):
        t = prio_top(sf=sf, k=K)
        note("B", f"B5 seed_factor={sf}: seed в топ-{K} (сейчас {int(F.loc[list(base_top), 'is_seed'].sum())})",
             int(F.loc[t, "is_seed"].sum()), "INFO")

    seeds_active = F.index[F.is_seed & ~F.no_edges]
    hits = pd.Series(0.0, index=list(base_top))
    for s_ in seeds_active:
        F2 = F.copy()
        F2.loc[s_, "is_seed"] = False
        F2 = pl.seed_link_features(F2, R["e"])
        F2["seed_share"], F2["seed_money_in"] = pl.propagate_seed_money(F2, R["e"], p["seed_denom"])
        top2 = set(topk(pl.assign_roles(F2, p, with_evidence=False), K))
        hits += pd.Series([g in top2 for g in hits.index], index=hits.index, dtype=float)
    loso = hits / max(len(seeds_active), 1)
    ts["loso_keep"] = loso
    dep = int((loso < 0.95).sum())
    note("B", f"B6 узлов топа, выпадающих при исключении одного seed (из {len(seeds_active)})", dep,
         "OK" if dep <= max(2, 0.05 * K) else "WARN")

    T = N.loc[list(base_top)]
    note("B", "B7 средний priority по коленам", N.groupby("depth").priority_score.mean().round(3).to_dict(), "INFO")
    mx = int(T.cluster_id.value_counts().max())
    note("B", f"B7 максимум узлов из одного кластера в топ-{K}", mx, "OK" if mx <= 0.3 * K else "WARN")
    note("B", f"B7 обрезанных / без переводов в топ-{K}", f"{int(T.flag_truncated.sum())} / {int(T.no_edges.sum())}",
         "OK" if not T.no_edges.any() and T.flag_truncated.sum() <= 5 else "WARN")
    weak = int(T.weak_seed_link.sum())
    note("B", f"B7 «слабая связь с seed» в топ-{K}", weak, "OK" if weak <= 0.2 * K else "WARN",
         "в why таких узлов прямо написано, что приоритет за счёт структуры")
    cc = comps.corr("spearman")
    hi = cc.where(~np.eye(len(cc), dtype=bool)).stack()
    pairs = sorted({tuple(sorted(x)) for x in hi[hi > 0.8].index})
    note("B", "B8 пар компонент приоритета с корреляцией > 0.8", pairs or 0, "OK" if not pairs else "WARN")
    srt = N.priority_score.sort_values(ascending=False)
    if len(srt) > K:
        gap = srt.iloc[K - 1] - srt.iloc[K]
        note("B", f"B8 разрыв priority между местами {K} и {K + 1}", f"{gap:.4f}", "OK" if gap > 0 else "WARN",
             "" if gap > 0 else "граница топа решается порядком сортировки (вторичный ключ role_score, затем gid)")
    return ts


# ============================================================================
# D. Реестр допущений: чувствительность к каждому параметру
# ============================================================================
def check_assumptions(R):
    header("D. РЕЕСТР ДОПУЩЕНИЙ (pipeline.ASSUMPTIONS)")
    p, N = R["params"], R["N"]
    missing = sorted(set(pl.PARAMS) - set(pl.ASSUMPTIONS))
    note("D", "D1 параметров без описания в реестре", missing or 0, "OK" if not missing else "WARN")
    uncovered = sorted(set(pl.ASSUMPTIONS) - set(SWEEP) - set(NOT_SWEPT))
    note("D", "D1 параметров без проверки чувствительности", uncovered or 0, "OK" if not uncovered else "WARN")
    kinds = pd.Series({k: v[0] for k, v in pl.ASSUMPTIONS.items()}).value_counts().to_dict()
    note("D", "D2 допущений по типам", kinds, "INFO")

    base_roles, base20 = N.role, set(topk(N, min(20, len(N))))
    K = min(p["top_n"], len(N))
    baseK = set(topk(N, K))
    rows = []
    for key, vals in SWEEP.items():
        for v in vals:
            r2 = pl.compute(R["nodes"], R["e"], R["tx"], {key: v}, clusters=False, stability=False)["N"]
            changed = r2.role != base_roles
            active = (r2.role != "peripheral") | (base_roles != "peripheral")
            rows.append(dict(param=key, kind=pl.ASSUMPTIONS[key][0], base=str(p[key]), test=str(v),
                             role_changes=int(changed.sum()),
                             role_change_share_active=round(changed.sum() / max(active.sum(), 1), 3),
                             J_top20=round(jacc(base20, topk(r2, len(base20))), 2),
                             J_topK=round(jacc(baseK, topk(r2, K)), 2)))
    S = pd.DataFrame(rows)
    S["level"] = np.select([(S.role_change_share_active > 0.15) | (S.J_top20 < 0.5),
                            (S.role_change_share_active > 0.05) | (S.J_top20 < 0.75)], ["высокая", "средняя"], "низкая")
    agg = S.groupby("param").agg(kind=("kind", "first"), worst_role_share=("role_change_share_active", "max"),
                                 worst_J20=("J_top20", "min"))
    agg["level"] = S.groupby("param")["level"].agg(lambda x: "высокая" if (x == "высокая").any()
                                                else "средняя" if (x == "средняя").any() else "низкая")
    print(agg.sort_values(["level", "worst_J20"]).to_string())
    for lvl in ("высокая", "средняя", "низкая"):
        note("D", f"D3 параметров с {lvl} чувствительностью", int((agg.level == lvl).sum()), "INFO")
    risky = agg[(agg.level == "высокая") & (agg.kind == "гипотеза")]
    note("D", "D4 гипотез, от которых результат зависит сильно", list(risky.index) or 0,
         "OK" if not len(risky) else "WARN",
         "" if not len(risky) else "результат держится на непроверяемом предположении — вынести в README как ограничение")
    hi_thr = agg[(agg.level == "высокая") & (agg.kind == "порог")]
    note("D", "D4 порогов с высокой чувствительностью", list(hi_thr.index) or 0, "INFO" if len(hi_thr) else "OK",
         "для них в README нужно обоснование значения (ориентир ТЗ / плато)" if len(hi_thr) else "")
    return S


# ============================================================================
# E. Устойчивость к данным
# ============================================================================
def check_data_robustness(R, reps=3):
    header("E. УСТОЙЧИВОСТЬ К ДАННЫМ (шум, выпадение переводов)")
    N, e, tx, nodes = R["N"], R["e"], R["tx"], R["nodes"]
    base20 = set(topk(N, min(20, len(N))))

    def compare(r2, label, thr_role, thr_j):
        common = N.index.intersection(r2.index)
        agree = float((r2.role.loc[common] == N.role.loc[common]).mean())
        act = (N.role.loc[common] != "peripheral")
        agree_act = float((r2.role.loc[common][act] == N.role.loc[common][act]).mean()) if act.any() else 1.0
        j = jacc(base20, topk(r2, len(base20)))
        return dict(variant=label, role_agree=round(agree, 3), active_role_agree=round(agree_act, 3), J_top20=round(j, 2))

    rows = []
    for rep in range(reps):
        rng = np.random.default_rng(100 + rep)
        for noise in (0.05, 0.10):
            f = pd.Series(1 + rng.uniform(-noise, noise, len(e)), index=pd.MultiIndex.from_frame(e[["src", "dst"]]))
            e2 = e.copy()
            e2["sum_kzt"] = e2.sum_kzt * f.to_numpy()
            key = pd.MultiIndex.from_frame(tx[["src", "dst"]])
            tx2 = tx.copy()
            tx2["sum_kzt"] = tx2.sum_kzt * f.reindex(key).fillna(1).to_numpy()
            r2 = pl.compute(nodes, e2, tx2, clusters=False, stability=False)["N"]
            rows.append(compare(r2, f"шум сумм ±{noise:.0%}", 0.95, 0.7))
        keep = rng.random(len(e)) >= 0.05
        e3 = e[keep]
        pairs = set(zip(e3.src, e3.dst))
        tx3 = tx[[pr in pairs for pr in zip(tx.src, tx.dst)]]
        r3 = pl.compute(nodes, e3.reset_index(drop=True), tx3.reset_index(drop=True), clusters=False,
                        stability=False)["N"]
        rows.append(compare(r3, "выпало 5% связей", 0.9, 0.5))
    D = pd.DataFrame(rows).groupby("variant").agg(["mean", "min"])
    print(D.to_string())
    for variant, thr_role, thr_j in [("шум сумм ±5%", 0.97, 0.7), ("шум сумм ±10%", 0.95, 0.6),
                                     ("выпало 5% связей", 0.9, 0.5)]:
        ra, aa, jj = (D.loc[variant, (c, "min")] for c in ("role_agree", "active_role_agree", "J_top20"))
        ok = ra >= thr_role and jj >= thr_j
        note("E", f"E1 {variant}: совпадение ролей (все / активные), Jaccard топ-20 — худший из {reps}",
             f"{ra:.3f} / {aa:.3f} / {jj:.2f}", "OK" if ok else "WARN",
             "" if ok else "результат чувствителен к неточностям в данных")
    return D


# ============================================================================
# T. Шаблонность текстов
# ============================================================================
def check_texts(R):
    header("T. ШАБЛОННОСТЬ ТЕКСТОВ")
    cl, N, top = R["clusters"], R["N"], R["top"]
    big = cl[(cl.cluster_id != 0) & (cl.n_nodes >= 5)]
    if len(big):
        uniq = big.hypothesis.nunique() / len(big)
        note("T", "T1 доля уникальных гипотез среди кластеров ≥5 узлов", f"{uniq:.0%}", "OK" if uniq >= 0.95 else "WARN")
        weak_types = big.cluster_type.isin(["periphery", "fragment", "seed_periphery"]).mean()
        note("T", "T1 доля кластеров ≥5 узлов со «слабой» гипотезой (периферия/фрагмент)", f"{weak_types:.0%}",
             "OK" if weak_types <= 0.5 else "WARN")
        note("T", "T1 типы гипотез", cl.cluster_type.value_counts().to_dict(), "INFO")
        note("T", "T1 сила гипотез", cl.hypothesis_strength.value_counts().to_dict(), "INFO")
        facts = big.hypothesis.str.contains(r"\d").mean()
        note("T", "T1 гипотез с конкретными фактами (числа, gid)", f"{facts:.0%}", "OK" if facts >= 0.95 else "WARN")

    bad = []
    for r in cl.itertuples():
        h = r.hypothesis
        for g in map(int, re.findall(r"\b\d{12,}\b", h)):
            if g in N.index and N.loc[g, "cluster_id"] != r.cluster_id:
                bad.append((r.cluster_id, f"узел {g} из другого кластера"))
        m = re.search(r"узел (\d{12,}) получил \S+ \S+ от (\d+) плательщ", h)
        if m and int(m.group(2)) != N.loc[int(m.group(1)), "in_deg"]:
            bad.append((r.cluster_id, "число плательщиков"))
        m = re.search(r"узел (\d{12,}) получил .*?\(из них seed: (\d+)\)", h)
        if m and int(m.group(2)) != N.loc[int(m.group(1)), "in_from_seed_deg"]:
            bad.append((r.cluster_id, "число seed-плательщиков"))
        m = re.search(r"узел (\d{12,}) отправил \S+ \S+ (\d+) получател", h)
        if m and int(m.group(2)) != N.loc[int(m.group(1)), "out_deg"]:
            bad.append((r.cluster_id, "число получателей"))
        m = re.search(r"seed в группе: (\d+)", h)
        if m and int(m.group(1)) != r.n_seed:
            bad.append((r.cluster_id, "n_seed"))
        m = re.search(r"узел (\d{12,}) собирает", h)
        if m and N.loc[int(m.group(1)), "role"] != "coordinator":
            bad.append((r.cluster_id, "ядро без координатора"))
    note("T", "T2 утверждений в гипотезах, не подтверждённых данными", len(bad), "OK" if not bad else "WARN",
         "; ".join(f"кластер {c}: {t}" for c, t in bad[:5]))

    act = N[N.role != "peripheral"]
    if len(act):
        u = act.evidence.nunique() / len(act)
        note("T", "T3 доля уникальных evidence у узлов с активной ролью", f"{u:.0%}", "OK" if u >= 0.9 else "WARN")
    reasons = top.why.str.extract(r"Приоритет: ([^.]*)\.")[0].str.replace(r"\(.*?\)", "", regex=True)
    same = reasons.value_counts(normalize=True).iloc[0] if len(reasons.dropna()) else 0
    note("T", "T3 доля самой частой формулировки «Приоритет: …» в топе", f"{same:.0%}", "OK" if same <= 0.5 else "WARN",
         "" if same <= 0.5 else "обоснования в топе однотипны")
    generic = top.why.str.contains("совокупность структурных признаков").mean()
    note("T", "T3 доля why без конкретной причины приоритета", f"{generic:.0%}", "OK" if generic <= 0.2 else "WARN")

    ev_err = 0
    for g, r in N.iterrows():
        ev = r.evidence
        m = re.search(r"веерная рассылка: (\d+) получател", ev)
        ev_err += bool(m and int(m.group(1)) != r.out_deg)
        m = re.search(r"признаки (?:консолидации|координации): (\d+) плательщ", ev)
        ev_err += bool(m and int(m.group(1)) != r.in_deg)
        m = re.search(r"связан (?:ещё )?с (\d+) seed", ev)
        ev_err += bool(m and int(m.group(1)) != r.n_seed_links)
        ev_err += ev.startswith("[seed]") != bool(r.is_seed)
        ev_err += ("круговых" in ev) and not r.in_cycle3
        ev_err += bool(re.search(r"\bnan\b|\binf\b", ev))
    note("T", "T4 расхождений evidence с данными (по всем узлам)", ev_err, "OK" if ev_err == 0 else "WARN")


# ============================================================================
# C. Общие требования
# ============================================================================
def _hash_outputs(d):
    import hashlib
    return {f: hashlib.sha256((Path(d) / f).read_bytes()).hexdigest()
            for f in ("nodes_roles.csv", "clusters.csv", "top_nodes.csv")}


def check_general(R):
    header("C. ОБЩИЕ ТРЕБОВАНИЯ И ВОСПРОИЗВОДИМОСТЬ")
    root = Path(pl.__file__).resolve().parent
    known = {str(g) for g in R["F"].index}
    hard = set()
    for f in ("pipeline.py", "viewer.py", "assumption_checks.py"):
        if (root / f).exists():
            hard |= set(re.findall(r"\b\d{12,}\b", (root / f).read_text(encoding="utf-8"))) & known
    note("C", "C1 gid, зашитые в код", len(hard), "OK" if not hard else "WARN")
    t = R.get("timings", {}).get("итого", np.nan)
    note("C", "C2 время полного пересчёта, с (лимит ТЗ 300)", t, "OK" if t < 120 else "WARN")
    note("C", "C3 все проверки схемы выгрузок", all(R["checks"].values()), "OK" if all(R["checks"].values()) else "WARN")
    with tempfile.TemporaryDirectory() as t1, tempfile.TemporaryDirectory() as t2:
        R1 = pl.compute(R["nodes"], R["e"], R["tx"], R["params"], stability=False)
        pl.write_outputs(R1, t1)
        nodes = R["nodes"].sample(frac=1, random_state=1)
        e = R["e"].sample(frac=1, random_state=2)
        tx = R["tx"].sample(frac=1, random_state=3)
        R2 = pl.compute(*pl.clean(nodes, e, tx)[:3], R["params"], stability=False)
        pl.write_outputs(R2, t2)
        same_run = (R1["N"].role.equals(R["N"].role) and R1["N"].cluster_id.equals(R["N"].cluster_id)
                    and np.allclose(R1["N"].priority_score, R["N"].priority_score))
        note("C", "C4 повторный расчёт даёт те же роли, кластеры и приоритеты", same_run, "OK" if same_run else "WARN")
        same_perm = _hash_outputs(t1) == _hash_outputs(t2)
        note("C", "C5 перемешанные строки входа дают побайтно те же CSV", same_perm, "OK" if same_perm else "WARN")


# ============================================================================
def run_all(R, n_mc=500, reps=3):
    REPORT.clear()
    t0 = time.time()
    out = Path(R["out_dir"])
    cl_st = check_clusters(R)
    ts = check_top(R, n_mc)
    S = check_assumptions(R)
    check_data_robustness(R, reps)
    check_texts(R)
    check_general(R)
    rep = pd.DataFrame(REPORT)
    csv = dict(index=False, encoding="utf-8-sig")
    rep.to_csv(out / "assumption_report.csv", **csv)
    S.to_csv(out / "assumption_sensitivity.csv", **csv)
    cl_st.to_csv(out / "cluster_stability.csv", **csv)
    ts.rename_axis("gid").reset_index().to_csv(out / "top_stability.csv", **csv)
    print(f"\nИтого: OK {int((rep.status == 'OK').sum())}, WARN {int((rep.status == 'WARN').sum())}, "
          f"INFO {int((rep.status == 'INFO').sum())} | {time.time() - t0:.0f} с")
    w = rep[rep.status == "WARN"]
    if len(w):
        print("\nWARN:")
        for r in w.itertuples():
            print(f"  [{r.block}] {r.check}: {r.value}")
    print(f"Отчёт: {out / 'assumption_report.csv'}")
    return rep


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="Проверка допущений, устойчивости и воспроизводимости")
    ap.add_argument("--data", default="data")
    ap.add_argument("--out", default="output")
    ap.add_argument("--mc", type=int, default=500, help="число случайных наборов весов приоритета")
    ap.add_argument("--reps", type=int, default=3, help="повторов для шума и выпадения связей")
    a = ap.parse_args(argv)
    R = pl.run(a.data, a.out, viz=False, verbose=False)
    run_all(R, a.mc, a.reps)


if __name__ == "__main__":
    main()
