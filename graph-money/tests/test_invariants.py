# -*- coding: utf-8 -*-
"""Инварианты правил ролей: ни один узел не противоречит своим же критериям. Проверяется на синтетике
и, если найдены, на реальных данных."""
import numpy as np
import pytest

P = None


def contradictions(N, p):
    lo, hi = p["band"]
    return {
        "transit с видимым балансом вне полосы":
            (N.role == "transit") & N.inflow_reliable & ~N.pass_ratio.between(lo, hi),
        "transit по скорости, но баланс виден": (N.role == "transit") & (N.tier == "C") & N.inflow_reliable,
        "consolidator отдаёт больше порога": (N.role == "consolidator") & (N.pass_ratio.fillna(0) > p["cons_max_pass"]),
        "consolidator мало плательщиков": (N.role == "consolidator") & (N.in_deg < p["cons_min_in"]),
        "coordinator без 8+ плательщиков и без 2+ seed":
            (N.role == "coordinator") & (N.in_deg < p["coord_strong_in"]) & (N.n_seed_links < p["coord_min_seed_links"]),
        "coordinator со слабой связью с seed": (N.role == "coordinator") & N.weak_seed_link,
        "distributor мало получателей": (N.role == "distributor") & (N.out_deg < p["dist_min_out"]),
        "terminal с исходящими / seed / обрезанный":
            (N.role == "terminal") & ((N.out_deg > 0) | N.is_seed | N.flag_truncated),
        "terminal ниже порога суммы": (N.role == "terminal") & (N.in_sum < p["min_sum"]),
        "обрезанный узел terminal/transit": N.flag_truncated & N.role.isin(["terminal", "transit"]),
        "нет переводов, но роль не peripheral": N.no_edges & (N.role != "peripheral"),
        "метка [seed] не совпадает": N.evidence.str.startswith("[seed]") != N.is_seed,
        "evidence длиннее 200": N.evidence.str.len() > 200,
        "evidence содержит nan/inf": N.evidence.str.contains(r"\bnan\b|\binf\b", case=False),
        "role_score вне [0,1]": ~N.role_score.between(0, 1),
        "priority вне [0,1]": ~N.priority_score.between(0, 1),
        "кластер 0 у узла с переводами": (N.cluster_id == 0) & ~N.no_edges,
    }


@pytest.fixture(params=["synth", "real"])
def run(request, synth_run):
    if request.param == "synth":
        return synth_run
    return request.getfixturevalue("real_run")


def test_no_contradictions(run):
    bad = {k: int(v.sum()) for k, v in contradictions(run["N"], run["params"]).items() if v.sum()}
    assert not bad, bad


def test_tier_semantics(run):
    N = run["N"]
    assert set(N.tier) <= {"A", "B", "C"}
    assert (N[N.tier == "C"].role == "transit").all(), "гипотеза уровня C бывает только у транзита по скорости"
    assert (N[N.tier == "A"].role == "peripheral").all()


def test_seed_factor_applied(run):
    N, p = run["N"], run["params"]
    comps = N[[c for c in N.columns if c.startswith("c_")]]
    import pipeline as pl
    raw = pl.priority_from_components(comps, np.zeros(len(N), bool), p["prio_w"], 1.0)
    seed = N.is_seed.to_numpy()
    assert np.allclose(N.priority_score.to_numpy()[seed], np.round(raw[seed] * p["seed_factor"], 4), atol=1e-4)


def test_weak_link_only_lowers_score(run):
    import pipeline as pl
    F, p = run["F"], run["params"]
    strong = pl.assign_roles(F, {**p, "weak_penalty": 1.0}, with_evidence=False)
    base = run["roles"]
    changed = base.role != strong.role
    # гипотеза «слабой связи» не меняет роль, кроме запрета координатора (он становится другой ролью)
    assert not (changed & (strong.role != "coordinator")).any()
    assert (base.role_score <= strong.role_score + 1e-9).all()
