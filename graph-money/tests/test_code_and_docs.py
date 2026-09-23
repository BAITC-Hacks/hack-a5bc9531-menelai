# -*- coding: utf-8 -*-
"""Код и документация: нет хардкода gid, каждое допущение описано, README синхронен с параметрами."""
import re
from pathlib import Path

import assumption_checks as ac
import pipeline as pl

ROOT = Path(__file__).resolve().parents[1]
CODE = ["pipeline.py", "viewer.py", "assumption_checks.py"]


def test_no_hardcoded_gids():
    for f in CODE:
        txt = (ROOT / f).read_text(encoding="utf-8")
        assert not re.findall(r"\b\d{12,}\b", txt), f"в {f} зашиты длинные идентификаторы"


def test_every_param_documented():
    assert set(pl.PARAMS) == set(pl.ASSUMPTIONS)
    for k, (kind, why) in pl.ASSUMPTIONS.items():
        assert kind in {"порог", "гипотеза", "методика", "продукт"}, k
        assert len(why) > 15, k


def test_every_param_checked():
    assert set(pl.ASSUMPTIONS) <= set(ac.SWEEP) | set(ac.NOT_SWEPT)
    assert not set(ac.SWEEP) & set(ac.NOT_SWEPT)


def test_readme_mentions_every_param_and_role():
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    missing = [k for k in pl.PARAMS if f"`{k}`" not in readme]
    assert not missing, f"в README не описаны параметры: {missing}"
    for r in pl.ROLES:
        assert f"`{r}`" in readme


def test_priority_weights_sum_to_one():
    assert abs(sum(pl.PARAMS["prio_w"].values()) - 1) < 1e-9
    assert set(pl.PARAMS["role_w"]) == set(pl.ROLES)


def test_vis_asset_present():
    assert (ROOT / "assets" / "vis-network.min.js").stat().st_size > 100_000
