# -*- coding: utf-8 -*-
"""Общая работоспособность: полный прогон, все выгрузки, просмотрщик, карточка, CLI."""
import json
import re
import time

import pandas as pd

import pipeline as pl
from conftest import FAST

FILES = ["nodes_roles.csv", "clusters.csv", "top_nodes.csv", "nodes_roles_ext.csv", "clusters_ext.csv",
         "top_nodes_ext.csv", "viewer.html", "resilience.csv", "data_requests.csv", "assumptions.csv",
         "run_summary.json"]


def test_all_files_created(synth_run):
    out = synth_run["out_dir"]
    for f in FILES:
        assert (out / f).exists(), f
        assert (out / f).stat().st_size > 0, f


def test_schema_checks_pass(synth_run):
    failed = [k for k, v in synth_run["checks"].items() if not v]
    assert not failed, failed


def test_summary(synth_run):
    s = json.loads((synth_run["out_dir"] / "run_summary.json").read_text(encoding="utf-8"))
    assert s["checks_passed"] is True
    assert s["n_nodes"] == len(synth_run["N"])
    assert sum(s["roles"].values()) == s["n_nodes"]
    assert s["n_clusters"] == int((synth_run["clusters"].cluster_id != 0).sum())   # кластер 0 не считается


def test_csv_readable_as_utf8_with_bom(synth_run):
    for f in ("nodes_roles.csv", "clusters.csv", "top_nodes.csv"):
        raw = (synth_run["out_dir"] / f).read_bytes()
        assert raw.startswith(b"\xef\xbb\xbf"), "BOM нужен, чтобы Excel открыл кириллицу"
        raw.decode("utf-8")


def test_gid_not_float_in_csv(synth_run):
    txt = (synth_run["out_dir"] / "nodes_roles.csv").read_text(encoding="utf-8-sig")
    assert not re.search(r"\d\.\d+e\+\d+", txt), "gid записан в экспоненциальной форме"
    nr = pd.read_csv(synth_run["out_dir"] / "nodes_roles.csv")
    assert set(nr.gid) == set(synth_run["N"].index)


def test_viewer_offline_and_complete(synth_run):
    html = (synth_run["out_dir"] / "viewer.html").read_text(encoding="utf-8")
    assert not re.search(r"<script[^>]+src=", html), "скрипты должны быть встроены — просмотрщик работает офлайн"
    assert not re.search(r"<link[^>]+href=\"http", html)
    assert "vis.Network" in html
    some = str(int(synth_run["top"].gid.iloc[0]))
    assert f'"id":"{some}"' in html, "gid в просмотрщике — строки (18 цифр не помещаются в число JS)"


def test_node_card(synth_run):
    g = int(synth_run["top"].gid.iloc[0])
    card = pl.node_card(synth_run, g)
    assert str(g) in card and "роль:" in card and "почему:" in card
    assert "нет в данных" in pl.node_card(synth_run, 1)


def test_resilience_and_requests(synth_run):
    r = synth_run["resilience"]
    assert {"без изъятия", "топ по priority", "случайные (среднее)"} <= set(r.strategy)
    assert r.largest_component_share.between(0, 1).all()
    base = r[r.strategy == "без изъятия"].reachable_flow_share.iloc[0]
    assert base == 1.0 or base == 0.0
    dr = synth_run["data_requests"]
    assert set(dr.columns) >= {"gid", "request", "reason"}
    assert dr.gid.isin(synth_run["N"].index).all()


def test_cli_returns_zero(synth_dir, tmp_path):
    assert pl.main(["--data", str(synth_dir), "--out", str(tmp_path), "--runs", "5", "--no-viz"]) == 0
    assert (tmp_path / "nodes_roles.csv").exists()


def test_time_budget(synth_dir, tmp_path):
    t = time.time()
    pl.run(synth_dir, tmp_path, verbose=False)            # параметры по умолчанию
    assert time.time() - t < 120


def test_unknown_param_rejected():
    import pytest
    with pytest.raises(ValueError):
        pl.merge_params({"no_such_param": 1})


def test_fast_params_valid():
    pl.merge_params(FAST)
