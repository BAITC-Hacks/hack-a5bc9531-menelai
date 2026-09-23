# -*- coding: utf-8 -*-
"""Воспроизводимость: повторный запуск и перестановка входных строк дают побайтно те же файлы."""
import hashlib

import numpy as np
import pandas as pd

import pipeline as pl
from conftest import FAST

FILES = ["nodes_roles.csv", "clusters.csv", "top_nodes.csv", "clusters_ext.csv", "top_nodes_ext.csv",
         "viewer.html", "resilience.csv", "data_requests.csv"]


def digest(d):
    return {f: hashlib.sha256((d / f).read_bytes()).hexdigest() for f in FILES}


def test_two_runs_identical(synth_dir, tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    pl.run(synth_dir, a, params=FAST, verbose=False)
    pl.run(synth_dir, b, params=FAST, verbose=False)
    assert digest(a) == digest(b)


def test_shuffled_input_identical(synth_dir, tmp_path):
    n = pd.read_parquet(synth_dir / "nodes.parquet")
    e = pd.read_parquet(synth_dir / "edges.parquet")
    t = pd.read_parquet(synth_dir / "transactions.parquet")
    shuf = tmp_path / "shuf"
    shuf.mkdir()
    n.sample(frac=1, random_state=1).to_parquet(shuf / "nodes.parquet", index=False)
    e.sample(frac=1, random_state=2).to_parquet(shuf / "edges.parquet", index=False)
    t.sample(frac=1, random_state=3).to_parquet(shuf / "transactions.parquet", index=False)
    a, b = tmp_path / "a", tmp_path / "b"
    pl.run(synth_dir, a, params=FAST, verbose=False)
    pl.run(shuf, b, params=FAST, verbose=False)
    assert digest(a) == digest(b)


def test_extra_columns_ignored(synth_dir, tmp_path):
    src = tmp_path / "extra"
    src.mkdir()
    for f in ("nodes", "edges", "transactions"):
        df = pd.read_parquet(synth_dir / f"{f}.parquet")
        df["junk"] = "x"
        df.to_parquet(src / f"{f}.parquet", index=False)
    a, b = tmp_path / "a", tmp_path / "b"
    pl.run(synth_dir, a, params=FAST, verbose=False, viz=False)
    pl.run(src, b, params=FAST, verbose=False, viz=False)
    for f in ("nodes_roles.csv", "clusters.csv", "top_nodes.csv"):
        assert (a / f).read_bytes() == (b / f).read_bytes()


def test_cluster_consensus_independent_of_randomness(synth_run):
    from sklearn.metrics import adjusted_rand_score
    p = synth_run["params"]
    U, E = synth_run["U"], synth_run["E"]
    base = synth_run["F"].cluster_id
    other = pl.labels_from_agreement(U, E, pl.coassignment(U, E, 30, 500, p["cl_weight"]), p["cl_thr"],
                                     p["cl_attach"]).reindex(base.index)
    ref = pl.labels_from_agreement(U, E, pl.coassignment(U, E, 30, 0, p["cl_weight"]), p["cl_thr"],
                                   p["cl_attach"]).reindex(base.index)
    assert adjusted_rand_score(ref, other) >= 0.9


def test_cluster_ids_canonical(synth_run):
    cl = synth_run["clusters"]
    act = cl[cl.cluster_id != 0]
    assert list(act.cluster_id) == list(range(1, len(act) + 1))
    assert act.n_nodes.is_monotonic_decreasing, "id кластеров упорядочены по размеру"
    zero = synth_run["N"][synth_run["N"].cluster_id == 0]
    assert zero.no_edges.all(), "кластер 0 — только узлы без переводов"


def test_priority_deterministic_tiebreak(synth_run):
    top = synth_run["top"]
    ranks = top.sort_values(["priority_score", "role_score", "gid"], ascending=[False, False, True])
    assert np.array_equal(ranks["rank"].to_numpy(), np.arange(1, len(top) + 1))
