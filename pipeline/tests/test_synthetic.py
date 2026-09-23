"""
Синтетический тест: на искусственном графе (62 узла) с заложенными паттернами пайплайн должен восстановить роли.
Запуск: cd pipeline && uv run python -m pytest tests -q    (или uv run python tests/test_synthetic.py)

Пороги идут через тот же resolve_thresholds, что и на реальных данных. На 62 узлах большинство перцентилей ниже floor
(действуют floor = пороги v1); p80 in_kzt = 300 тыс. и p95 betweenness — из данных. Тест проверяет каскад правил,
а не калибровку перцентилей.
"""
import subprocess
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import run  # noqa: E402

D0 = pd.Timestamp("2026-07-01")

# gid → (depth, is_seed)
S1, S2, S3, S4, S5 = 1, 2, 3, 4, 5                  # seed
K = 10                                               # координатор
R = [11, 12, 13, 14, 15]                             # получатели K
Y = [16, 17, 18, 19, 20]                             # следующее колено после R
C, F, C_OUT = 21, [22, 23, 24], 25                   # сборщик, его «чистые» плательщики, куда он отдал 5 %
D, N = 30, list(range(31, 51))                       # веер и 20 получателей
TN, E = 51, 52                                       # транзит → конечный получатель (depth 2)
L, L_OUT = 53, 54                                    # «медленный транзит»: вывел через 19 дней
Z = 55                                               # колено 4, обход обрезан
M, G = 56, list(range(57, 63))                       # «магазин» и 6 его покупателей без связи с seed
FILL = list(range(63, 69))                           # фоновые мелкие переводы
H = 69                                               # «сборщик» с одним доминирующим плательщиком (90 %)
ISO = 70                                             # seed без единого перевода


def build():
    depth = {S1: 0, S2: 0, S3: 0, S4: 0, S5: 0, ISO: 0, H: 1, K: 1, C: 1, D: 1, TN: 1, L: 1, C_OUT: 2, E: 2, L_OUT: 2, M: 2, Z: 4}
    depth |= {g: 2 for g in R + F + N + G + FILL} | {g: 3 for g in Y}
    nodes = pd.DataFrame({"gid": list(depth), "depth": list(depth.values()),
                          "is_seed": [g <= 5 or g == ISO for g in depth]}).astype({"gid": "int64", "depth": "int64"})

    tx = []
    add = lambda s, d, amt, day: tx.append((s, d, D0 + pd.Timedelta(days=day), float(amt)))
    # координатор: 3 seed → K → 5 получателей → дальше; цикл K → R1 → S1 → K
    for s in (S1, S2, S3):
        add(s, K, 100_000, 1)
    for r, y in zip(R, Y):
        add(K, r, 60_000, 2)
        add(r, y, 20_000, 4)
    add(R[0], S1, 30_000, 3)
    # сборщик: 6 плательщиков (3 seed + 3 чистых) по 100 тыс., отдаёт 5 %
    for p in (S1, S2, S3, *F):
        add(p, C, 100_000, 5)
    add(C, C_OUT, 30_000, 9)
    # веер: 1 плательщик → 20 получателей
    add(S4, D, 500_000, 1)
    for n in N:
        add(D, n, 20_000, 5)
    # транзит: получил 300 тыс. и на следующий день отправил всё; получатель — конечный (out = 0)
    add(S5, TN, 300_000, 10)
    add(TN, E, 300_000, 11)
    # тот же баланс, но вывод через 19 дней — не транзит
    add(S5, L, 300_000, 1)
    add(L, L_OUT, 300_000, 20)
    # колено 4: крупный вход, исходящих нет, потому что обход обрезан
    add(Y[0], Z, 400_000, 6)
    # «магазин»: 6 покупателей без связи с seed по 60 тыс., денег дальше не отправляет
    for g in G:
        add(g, M, 60_000, 7)
    # один плательщик дал 90 % входа, ещё двое — по 5 %: формально ≥ 3 плательщиков, но «несколько участников» нет
    add(S2, H, 900_000, 8)
    add(F[1], H, 50_000, 8)
    add(F[2], H, 50_000, 8)
    # фон
    for a, b in zip(FILL[::2], FILL[1::2]):
        add(a, b, 10_000, 3)

    tx = pd.DataFrame(tx, columns=["src", "dst", "date", "sum_kzt"]).astype({"src": "int64", "dst": "int64"})
    edges = tx.groupby(["src", "dst"]).agg(sum_kzt=("sum_kzt", "sum"), n_tx=("sum_kzt", "size")).reset_index()
    return edges, nodes, tx


def result():
    edges, nodes, tx = build()
    assert len(nodes) == 62
    f, Tr, *_ = run.compute(edges, nodes, tx)
    f["evidence"] = [run.evidence(r, Tr) for _, r in f.iterrows()]
    return f, Tr


EXPECT = {K: "coordinator", C: "consolidator", D: "distributor", TN: "transit", E: "terminal",
          Z: "peripheral", L: "peripheral", M: "consolidator", H: "terminal", ISO: "peripheral"}


def test_roles_recovered():
    f, _ = result()
    got = {g: f.loc[g, "role"] for g in EXPECT}
    assert got == EXPECT, {g: (EXPECT[g], got[g]) for g in EXPECT if got[g] != EXPECT[g]}


def test_pattern_details():
    f, _ = result()
    assert f.loc[K, "in_cycle"] and f.loc[K, "n_seed_upstream"] >= 3
    assert f.loc[TN, "fast_out_share"] == 1.0 and f.loc[L, "fast_out_share"] == 0.0   # отличие транзита от «медленного»
    assert f.loc[Z, "rule_hit"] == "nodata"                                          # обрыв ≠ конечный получатель
    assert f.loc[M, "weak_seed_link"] and f.loc[M, "seed_share"] < 0.01              # магазин: паттерн есть, связи с делом нет
    assert "связь с seed слабая" in f.loc[M, "evidence"]
    assert not f.loc[C, "weak_seed_link"] and abs(f.loc[C, "seed_share"] - 0.5) < 1e-9
    assert not f.loc[[K, D, E], "weak_seed_link"].any()
    assert (f.evidence.str.len() <= 200).all()
    # v3: доминирующий плательщик → не consolidator; остальные сборщики проходят
    assert abs(f.loc[H, "max_payer_share"] - 0.9) < 1e-9 and f.loc[H, "in_deg"] == 3
    assert f.loc[C, "max_payer_share"] < 0.8 and f.loc[M, "max_payer_share"] < 0.8
    assert "макс. плат." in f.loc[C, "evidence"]
    # v3: «нет данных» — отдельный флаг; изолированный seed без денег в графе
    assert f.loc[Z, "no_data"] and f.loc[ISO, "no_data"] and not f.loc[L, "no_data"]
    assert f.loc[Z, "role_score"] == run.NO_DATA_ROLE_SCORE == f.loc[ISO, "role_score"]   # роль-заглушка
    assert f.loc[ISO, "seed_share"] == 0 and f.loc[ISO, "seed_money_in"] == 0
    assert "0 вход., 0 исход." in f.loc[ISO, "evidence"] and "запросить исходящие" in f.loc[Z, "evidence"]


def test_priority_weights():
    f, _ = result()
    plain = f.assign(no_data=False, weak_seed_link=False)      # тот же base, только вес роли
    run.priority(f)
    run.priority(plain)
    k = f.priority_score / plain.priority_score
    # no_data: вес 0,5 вместо 0,2; слабая связь с делом: × WEAK_SEED_PRIORITY_MULT; остальные без изменений
    assert abs(k[Z] - run.NO_DATA_WEIGHT / run.ROLE_WEIGHT["peripheral"]) < 1e-2
    assert abs(k[M] - run.WEAK_SEED_PRIORITY_MULT) < 1e-2
    assert abs(k[C] - 1) < 1e-9
    # seed уже известны: × SEED_PRIORITY_MULT; у не-seed без изменений
    g = f.copy()
    mult, run.SEED_PRIORITY_MULT = run.SEED_PRIORITY_MULT, 1.0
    try:
        run.priority(g)
    finally:
        run.SEED_PRIORITY_MULT = mult
    assert abs(f.priority_score[S1] / g.priority_score[S1] - mult) < 1e-2
    assert f.priority_score[C] == g.priority_score[C]
    # peripheral: вес 0,2 + 0,3 × доля выполненных условий ближайшей роли («медленный транзит» L почти transit)
    far = f.assign(near_share=0.0)
    run.priority(far)
    assert f.loc[L, "near_share"] > 0.5
    want = (0.2 + run.PERIPHERAL_NEAR_BONUS * f.loc[L, "near_share"]) / 0.2
    assert abs(f.priority_score[L] / far.priority_score[L] - want) < 1e-2


def test_coordinator_turnover_floor():
    f, Tr = result()
    g = f.copy()
    g.loc[K, ["in_kzt", "out_kzt"]] = Tr["coord_min_kzt"] / 2      # тот же узел, но мелкие суммы
    run.roles(g, Tr)
    assert f.loc[K, "role"] == "coordinator" and g.loc[K, "role"] != "coordinator"


def test_cli_on_other_dataset(tmp_path):
    """run.py целиком (выгрузки + checks) на выгрузке другого размера: ни одного зашитого числа из ТЗ."""
    edges, nodes, tx = build()
    edges["depth"] = edges.src.map(nodes.set_index("gid").depth) + 1
    for name, df in (("edges", edges), ("nodes", nodes), ("transactions", tx)):
        df.to_parquet(tmp_path / f"{name}.parquet")
    r = subprocess.run([sys.executable, str(Path(run.__file__)), "--data", str(tmp_path), "--out", str(tmp_path / "out")],
                       capture_output=True)
    assert r.returncode == 0, r.stderr.decode("utf-8", "replace")[-2000:]
    assert len(pd.read_csv(tmp_path / "out" / "nodes_roles.csv")) == len(nodes)


if __name__ == "__main__":
    f, Tr = result()
    print("Пороги:", {k: Tr[k] for k in run.PCT_THRESHOLDS})
    for g, want in EXPECT.items():
        r = f.loc[g]
        print(f"{g:>3} ожид. {want:<12} получ. {r.role:<12} {'OK ' if r.role == want else 'FAIL'} "
              f"weak={bool(r.weak_seed_link)} | {r.evidence}")
    test_roles_recovered()
    test_pattern_details()
    test_priority_weights()
    print("Роли по всему графу:", f.role.value_counts().to_dict())
    print("SYNTHETIC OK")
