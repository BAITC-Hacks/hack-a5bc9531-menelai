# -*- coding: utf-8 -*-
import os
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import pipeline as pl  # noqa: E402
import synth  # noqa: E402

FAST = dict(cl_runs=8)          # меньше запусков Louvain — тесты быстрее, логика та же


def find_real_data():
    """Реальные данные: переменная окружения GRAPH_DATA, иначе ../task/data (данные организаторов в репо) или data/."""
    cands = [os.environ.get("GRAPH_DATA"), ROOT.parent / "task" / "data", ROOT / "data", ROOT.parent / "data",
             ROOT / "data (1)" / "data",
             ROOT.parent / "data (1)" / "data"]
    for c in cands:
        if c and (Path(c) / "nodes.parquet").exists():
            return Path(c)
    return None


@pytest.fixture(scope="session")
def synth_dir(tmp_path_factory):
    d = tmp_path_factory.mktemp("synth")
    synth.make(d, seed=7, scale=0.5)
    return d


@pytest.fixture(scope="session")
def synth_run(synth_dir, tmp_path_factory):
    out = tmp_path_factory.mktemp("out")
    return pl.run(synth_dir, out, params=FAST, verbose=False)


@pytest.fixture(scope="session")
def real_dir():
    d = find_real_data()
    if d is None:
        pytest.skip("реальные данные не найдены (укажите GRAPH_DATA=путь к папке с parquet)")
    return d


@pytest.fixture(scope="session")
def real_run(real_dir, tmp_path_factory):
    return pl.run(real_dir, tmp_path_factory.mktemp("real_out"), verbose=False)


def mini(nodes, edges, tx=None, date="2026-07-10"):
    """Маленький датасет: nodes = [(gid, depth, is_seed)], edges = [(src, dst, sum)]."""
    n = pd.DataFrame(nodes, columns=["gid", "depth", "is_seed"])
    e = pd.DataFrame(edges, columns=["src", "dst", "sum_kzt"]) if edges else \
        pd.DataFrame({"src": pd.Series(dtype="int64"), "dst": pd.Series(dtype="int64"),
                      "sum_kzt": pd.Series(dtype=float)})
    e["n_tx"] = 1
    e["depth"] = 1
    if tx is None:
        t = e[["src", "dst", "sum_kzt"]].copy()
        t["date"] = pd.Timestamp(date)
    else:
        t = pd.DataFrame(tx, columns=["src", "dst", "date", "sum_kzt"])
    return n, e, t


def compute_and_write(nodes, edges, tx, out, params=None):
    n, e, t, issues = pl.clean(nodes, edges, tx)
    R = pl.compute(n, e, t, {**FAST, **(params or {})})
    pl.write_outputs(R, out)
    R["checks"] = pl.validate_outputs(out, len(R["F"]), int(R["F"].is_seed.sum()))
    R["issues"] = issues
    return R
