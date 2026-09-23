# -*- coding: utf-8 -*-
"""Тексты: склонения, соответствие чисел данным, отсутствие однотипных и голословных формулировок."""
import re

import pytest

import pipeline as pl


@pytest.mark.parametrize("n,expected", [(1, "плательщик"), (2, "плательщика"), (5, "плательщиков"),
                                        (11, "плательщиков"), (12, "плательщиков"), (21, "плательщик"),
                                        (22, "плательщика"), (111, "плательщиков"), (0, "плательщиков")])
def test_plural(n, expected):
    assert pl.plural(n, "плательщик", "плательщика", "плательщиков") == expected


@pytest.mark.parametrize("x,s", [(999, "999"), (1500, "2 тыс"), (2_500_000, "2.5 млн")])
def test_money(x, s):
    assert pl.money(x) == s


def test_evidence_numbers_match_data(synth_run):
    N = synth_run["N"]
    for g, r in N.iterrows():
        ev = r.evidence
        m = re.search(r"веерная рассылка: (\d+) получател", ev)
        assert not m or int(m.group(1)) == r.out_deg, (g, ev)
        m = re.search(r"признаки (?:консолидации|координации): (\d+) плательщ", ev)
        assert not m or int(m.group(1)) == r.in_deg, (g, ev)
        m = re.search(r"связан (?:ещё )?с (\d+) seed", ev)
        assert not m or int(m.group(1)) == r.n_seed_links, (g, ev)
        assert ("круговых" not in ev) or r.in_cycle3, (g, ev)


def test_evidence_not_templated_for_active_roles(synth_run):
    act = synth_run["N"][synth_run["N"].role != "peripheral"]
    assert act.evidence.nunique() / len(act) >= 0.9


def test_cluster_hypotheses(synth_run):
    cl, N = synth_run["clusters"], synth_run["N"]
    big = cl[(cl.cluster_id != 0) & (cl.n_nodes >= 5)]
    assert big.hypothesis.is_unique, "гипотезы крупных кластеров не должны повторяться дословно"
    assert big.hypothesis.str.contains(r"\d").all(), "каждая гипотеза опирается на конкретные числа"
    assert cl.hypothesis.str.startswith(("Гипотеза:", "Нет данных:")).all(), "формулировки — как гипотезы"
    assert big.cluster_type.isin(["periphery", "fragment", "seed_periphery"]).mean() <= 0.6
    for r in cl.itertuples():
        for g in map(int, re.findall(r"\b\d{12,}\b", r.hypothesis)):
            assert N.loc[g, "cluster_id"] == r.cluster_id, (r.cluster_id, g)
        m = re.search(r"seed в группе: (\d+)", r.hypothesis)
        assert not m or int(m.group(1)) == r.n_seed


def test_no_accusatory_wording(synth_run):
    words = r"\b(?:виновен|преступник|наркоторгов|организатор\b|отмывает)"
    for col in (synth_run["N"].evidence, synth_run["clusters"].hypothesis, synth_run["top"].why):
        assert not col.str.contains(words, case=False).any(), "формулировки должны быть гипотезами (ТЗ)"


def test_why_specific(synth_run):
    t = synth_run["top"]
    assert t.why.str.endswith("Требует проверки.").all()
    generic = t.why.str.contains("совокупность структурных признаков").mean()
    assert generic <= 0.3
    weak = t[t.weak_seed_link]
    assert weak.why.str.contains("слабая|не подтверждена").all(), "слабая связь с seed должна быть видна в why"
