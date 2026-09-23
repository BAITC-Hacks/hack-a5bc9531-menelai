# -*- coding: utf-8 -*-
"""Граничные случаи и «ломание» входа: пайплайн либо отрабатывает корректно, либо падает с понятной ошибкой."""
import numpy as np
import pandas as pd
import pytest

import pipeline as pl
from conftest import compute_and_write, mini

S, A, B, C, D, E_, X = 100, 201, 202, 203, 204, 205, 999


def ok(R):
    failed = [k for k, v in R["checks"].items() if not v]
    assert not failed, failed
    assert R["N"].role.isin(pl.ROLES).all()
    assert R["N"].evidence.str.len().between(1, 200).all()
    return R


def test_only_seeds_no_edges(tmp_path):
    R = ok(compute_and_write(*mini([(S, 0, True), (S + 1, 0, True), (S + 2, 0, True)], []), tmp_path))
    assert (R["N"].role == "peripheral").all()
    assert (R["N"].cluster_id == 0).all()
    assert R["N"].evidence.str.contains("нет переводов").all()


def test_single_edge(tmp_path):
    R = ok(compute_and_write(*mini([(S, 0, True), (A, 1, False)], [(S, A, 50_000)]), tmp_path))
    assert R["N"].loc[A, "flag_truncated"], "последнее колено без исходящих — обрыв выгрузки"
    assert R["N"].loc[A, "role"] == "peripheral"


def test_no_truncation_if_last_level_sends(tmp_path):
    nodes = [(S, 0, True), (A, 1, False), (B, 2, False)]
    R = ok(compute_and_write(*mini(nodes, [(S, A, 200_000), (A, B, 190_000), (B, S, 10_000)]), tmp_path))
    assert not R["meta"]["truncation_detected"]
    assert not R["N"].flag_truncated.any()


def test_self_loop_duplicates_unknown_gid(tmp_path):
    nodes = [(S, 0, True), (A, 1, False)]
    edges = [(S, S, 10_000), (S, A, 10_000), (S, A, 20_000), (S, X, 30_000)]
    R = ok(compute_and_write(*mini(nodes, edges), tmp_path))
    text = " ".join(R["issues"])
    assert "самому себе" in text and "повторных пар" in text and "нет в nodes" in text
    assert R["N"].loc[A, "in_sum"] == 30_000


def test_nonpositive_and_nan_amounts_dropped(tmp_path):
    nodes = [(S, 0, True), (A, 1, False), (B, 1, False), (C, 1, False)]
    R = ok(compute_and_write(*mini(nodes, [(S, A, 0), (S, B, -5), (S, C, np.nan)]), tmp_path))
    assert "неположительная" in " ".join(R["issues"])
    assert R["N"].in_sum.sum() == 0


def test_float_gid_small_ok(tmp_path):
    n, e, t = mini([(1, 0, True), (2, 1, False)], [(1, 2, 10_000)])
    n["gid"] = n.gid.astype(float)
    e["src"], e["dst"] = e.src.astype(float), e.dst.astype(float)
    R = ok(compute_and_write(n, e, t, tmp_path))
    assert not any("float" in x for x in R["issues"])
    assert pd.api.types.is_integer_dtype(pd.read_csv(tmp_path / "nodes_roles.csv").gid)


def test_float_gid_large_warns():
    g = 100_000_000_000_000_100
    n, e, t = mini([(g, 0, True), (g + 1000, 1, False)], [(g, g + 1000, 10_000)])
    n["gid"] = n.gid.astype(float)
    issues = pl.clean(n, e, t)[3]
    assert any("2^53" in x for x in issues)


def test_fractional_gid_rejected():
    n, e, t = mini([(1, 0, True), (2, 1, False)], [(1, 2, 10_000)])
    n["gid"] = [1.5, 2.0]
    with pytest.raises(ValueError):
        pl.clean(n, e, t)


def test_string_is_seed(tmp_path):
    n, e, t = mini([(S, 0, True), (A, 1, False)], [(S, A, 10_000)])
    n["is_seed"] = ["True", "false"]
    R = ok(compute_and_write(n, e, t, tmp_path))
    assert int(R["N"].is_seed.sum()) == 1


@pytest.mark.parametrize("bad", ["maybe", "?"])
def test_bad_is_seed_rejected(bad):
    n, e, t = mini([(S, 0, True), (A, 1, False)], [(S, A, 10_000)])
    n["is_seed"] = ["True", bad]
    with pytest.raises(ValueError):
        pl.clean(n, e, t)


@pytest.mark.parametrize("frame,col", [("nodes", "is_seed"), ("edges", "sum_kzt"), ("tx", "date")])
def test_missing_column_rejected(frame, col):
    n, e, t = mini([(S, 0, True), (A, 1, False)], [(S, A, 10_000)])
    d = dict(nodes=n, edges=e, tx=t)
    d[frame] = d[frame].drop(columns=[col])
    with pytest.raises(ValueError, match=col):
        pl.clean(d["nodes"], d["edges"], d["tx"])


def test_empty_nodes_rejected():
    n, e, t = mini([], [])
    with pytest.raises(ValueError):
        pl.clean(n, e, t)


def test_duplicate_gid_rejected():
    n, e, t = mini([(S, 0, True), (S, 1, False)], [])
    with pytest.raises(ValueError):
        pl.clean(n, e, t)


def test_nan_depth_rejected():
    n, e, t = mini([(S, 0, True), (A, 1, False)], [(S, A, 10_000)])
    n["depth"] = [0, np.nan]
    with pytest.raises(ValueError):
        pl.clean(n, e, t)


def test_no_transactions_but_edges(tmp_path):
    n, e, _ = mini([(S, 0, True), (A, 1, False), (B, 2, False)], [(S, A, 200_000), (A, B, 190_000)])
    t = pd.DataFrame({"src": pd.Series(dtype="int64"), "dst": pd.Series(dtype="int64"),
                      "date": pd.Series(dtype="datetime64[ns]"), "sum_kzt": pd.Series(dtype=float)})
    R = ok(compute_and_write(n, e, t, tmp_path))
    assert R["N"].fast_share.isna().all()
    assert R["N"].loc[A, "role"] == "transit", "транзит определяется по балансу и без дат"


def test_string_dates_and_bad_dates(tmp_path):
    n, e, _ = mini([(S, 0, True), (A, 1, False)], [(S, A, 20_000)])
    t = pd.DataFrame([(S, A, "2026-07-05", 10_000), (S, A, "не дата", 10_000)],
                     columns=["src", "dst", "date", "sum_kzt"])
    R = ok(compute_and_write(n, e, t, tmp_path))
    assert "дата" in " ".join(R["issues"])


def test_huge_fan_out_is_distributor(tmp_path):
    rec = list(range(1000, 1150))
    nodes = [(S, 0, True)] + [(r, 1, False) for r in rec]
    R = ok(compute_and_write(*mini(nodes, [(S, r, 20_000) for r in rec]), tmp_path))
    assert R["N"].loc[S, "role"] == "distributor"
    assert R["N"].loc[S, "role_score"] == 1.0
    assert (R["N"].loc[rec, "role"] == "peripheral").all(), "получатели на обрезанном колене — не терминалы"


def test_consolidator(tmp_path):
    payers = list(range(1000, 1009))
    nodes = [(S, 0, True), (A, 2, False), (B, 3, False)] + [(p, 1, False) for p in payers]
    edges = [(S, p, 60_000) for p in payers] + [(p, A, 50_000) for p in payers] + [(A, B, 10_000)]
    R = ok(compute_and_write(*mini(nodes, edges), tmp_path))
    r = R["N"].loc[A]
    assert r.role == "consolidator" and r.in_deg == 9
    assert "9 плательщиков" in r.evidence


def test_cycle_detected(tmp_path):
    nodes = [(S, 0, True), (A, 1, False), (B, 2, False), (C, 3, False), (D, 4, False)]
    edges = [(S, A, 100_000), (A, B, 90_000), (B, C, 80_000), (C, S, 70_000), (C, D, 5_000)]
    R = ok(compute_and_write(*mini(nodes, edges), tmp_path))
    assert R["N"].loc[[S, A, B, C], "in_cycle3"].all()
    assert not R["N"].loc[D, "in_cycle3"]


def test_mutual_pair_not_a_cycle3(tmp_path):
    nodes = [(S, 0, True), (A, 1, False), (B, 2, False)]
    R = ok(compute_and_write(*mini(nodes, [(S, A, 50_000), (A, S, 40_000), (A, B, 5_000)]), tmp_path))
    assert not R["N"].in_cycle3.any()
    assert R["N"].loc[A, "n_mutual"] == 1


def test_seed_out_gt_in_not_transit_by_balance(tmp_path):
    nodes = [(S, 0, True), (A, 1, False), (B, 2, False)]
    R = ok(compute_and_write(*mini(nodes, [(S, A, 150_000), (A, B, 900_000)]), tmp_path))
    assert R["N"].loc[A, "flag_out_gt_in"]
    assert not R["N"].loc[A, "inflow_reliable"]


def test_tiny_top_less_than_20(tmp_path):
    ok(compute_and_write(*mini([(S, 0, True), (A, 1, False)], [(S, A, 10_000)]), tmp_path))
    assert len(pd.read_csv(tmp_path / "top_nodes.csv")) == 2


def test_disconnected_components_not_merged(tmp_path):
    nodes = [(S, 0, True), (A, 1, False), (S + 1, 0, True), (B, 1, False)]
    R = ok(compute_and_write(*mini(nodes, [(S, A, 10_000), (S + 1, B, 10_000)]), tmp_path))
    assert R["N"].loc[S, "cluster_id"] != R["N"].loc[S + 1, "cluster_id"]


def test_run_from_parquet_with_messy_data(tmp_path):
    n, e, t = mini([(S, 0, True), (A, 1, False), (B, 2, False)],
                   [(S, A, 200_000), (A, B, 180_000), (A, A, 1), (S, X, 5)])
    d = tmp_path / "data"
    d.mkdir()
    n.to_parquet(d / "nodes.parquet", index=False)
    e.to_parquet(d / "edges.parquet", index=False)
    t.to_parquet(d / "transactions.parquet", index=False)
    R = pl.run(d, tmp_path / "out", params={"cl_runs": 3}, verbose=False)
    assert all(R["checks"].values())
    assert R["issues"]


def test_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        pl.load(tmp_path)
