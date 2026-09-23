# -*- coding: utf-8 -*-
"""Устойчивость: шум в суммах, выпадение переводов, сдвиг порогов, исключение одного seed."""
import numpy as np
import pandas as pd

import pipeline as pl


def jacc(a, b):
    a, b = set(a), set(b)
    return len(a & b) / max(len(a | b), 1)


def top(N, k=20):
    return N.sort_values(["priority_score", "role_score"], ascending=False, kind="mergesort").index[:k]


def base(synth_run):
    return pl.compute(synth_run["nodes"], synth_run["e"], synth_run["tx"], clusters=False, stability=False)["N"]


def test_amount_noise_5pct(synth_run):
    B = base(synth_run)
    e, tx = synth_run["e"].copy(), synth_run["tx"].copy()
    rng = np.random.default_rng(1)
    f = pd.Series(1 + rng.uniform(-0.05, 0.05, len(e)), index=pd.MultiIndex.from_frame(e[["src", "dst"]]))
    e["sum_kzt"] *= f.to_numpy()
    tx["sum_kzt"] *= f.reindex(pd.MultiIndex.from_frame(tx[["src", "dst"]])).to_numpy()
    N = pl.compute(synth_run["nodes"], e, tx, clusters=False, stability=False)["N"]
    assert (N.role == B.role).mean() >= 0.97
    assert jacc(top(N), top(B)) >= 0.6


def test_drop_5pct_edges(synth_run):
    B = base(synth_run)
    e = synth_run["e"]
    keep = np.random.default_rng(2).random(len(e)) >= 0.05
    e2 = e[keep].reset_index(drop=True)
    pairs = set(zip(e2.src, e2.dst))
    tx = synth_run["tx"]
    tx2 = tx[[p in pairs for p in zip(tx.src, tx.dst)]].reset_index(drop=True)
    N = pl.compute(synth_run["nodes"], e2, tx2, clusters=False, stability=False)["N"]
    assert (N.role == B.role).mean() >= 0.95
    assert jacc(top(N), top(B)) >= 0.5


def test_threshold_step_changes_few_roles(synth_run):
    B = base(synth_run)
    for key, vals in {"cons_min_in": [4, 6], "dist_min_out": [8, 12], "band": [(0.85, 1.15), (0.75, 1.25)]}.items():
        for v in vals:
            N = pl.compute(synth_run["nodes"], synth_run["e"], synth_run["tx"], {key: v}, clusters=False,
                           stability=False)["N"]
            active = (N.role != "peripheral") | (B.role != "peripheral")
            share = ((N.role != B.role) & active).sum() / max(active.sum(), 1)
            assert share <= 0.15, (key, v, share)


def test_leave_one_seed_out(synth_run):
    F, p = synth_run["F"], synth_run["params"]
    B = synth_run["roles"]
    t50 = set(top(B, 50))
    drops = []
    for s in F.index[F.is_seed & ~F.no_edges]:
        F2 = F.copy()
        F2.loc[s, "is_seed"] = False
        F2 = pl.seed_link_features(F2, synth_run["e"])
        F2["seed_share"], F2["seed_money_in"] = pl.propagate_seed_money(F2, synth_run["e"], p["seed_denom"])
        drops.append(len(t50 - set(top(pl.assign_roles(F2, p, with_evidence=False), 50))))
    assert np.median(drops) <= 5, "топ не должен держаться на одном seed"


def test_seed_money_bounded(synth_run):
    F = synth_run["F"]
    assert F.seed_share.between(0, 1).all()
    assert (F.seed_money_in <= F.in_sum + 1e-6).all(), "seed-денег не может прийти больше, чем пришло всего"


def test_role_stability_column(synth_run):
    s = synth_run["N"].role_stability
    assert s.between(0, 1).all()
    assert (s[synth_run["N"].no_edges] == 1).all()
