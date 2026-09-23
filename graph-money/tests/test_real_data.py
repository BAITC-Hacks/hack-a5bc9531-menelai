# -*- coding: utf-8 -*-
"""Проверки на реальной выгрузке (пропускаются, если данных нет рядом).
Цифры — из раздела «Данные» ТЗ; они подтверждают, что данные прочитаны правильно."""
import pandas as pd


def test_tz_facts(real_run):
    N, e = real_run["N"], real_run["e"]
    assert len(N) == 2248
    assert int(N.is_seed.sum()) == 81
    assert len(e) == 3119
    assert len(real_run["tx"]) == 4840
    assert N.depth.value_counts().sort_index().tolist() == [81, 472, 462, 789, 444]
    assert abs(e.sum_kzt.sum() - 365_890_012) < 1
    assert int(N.flag_truncated.sum()) == 444
    seeds = N[N.is_seed]
    assert int((seeds.out_deg == 0).sum()) == 31
    assert int(seeds.no_edges.sum()) == 19
    assert int(((seeds.out_deg == 0) & (seeds.in_deg > 0)).sum()) == 12
    assert real_run["meta"]["n_components"] - int(N.no_edges.sum()) == 16   # 16 слабосвязных компонент


def test_all_roles_present(real_run):
    vc = real_run["N"].role.value_counts()
    for r in ("coordinator", "consolidator", "distributor", "transit", "terminal", "peripheral"):
        assert vc.get(r, 0) >= 1, r


def test_truncated_never_terminal(real_run):
    N = real_run["N"]
    assert not (N.flag_truncated & (N.role == "terminal")).any()


def test_outputs_and_time(real_run):
    assert all(real_run["checks"].values())
    assert real_run["timings"]["итого"] < 300
    assert len(pd.read_csv(real_run["out_dir"] / "top_nodes.csv")) >= 20


def test_multi_seed_clusters_near_tz(real_run):
    cl = real_run["clusters"]
    k = int(((cl.cluster_id != 0) & (cl.n_seed > 1)).sum())
    assert 5 <= k <= 15, k                       # ориентир ТЗ: ≈ 8 сообществ с >1 seed
