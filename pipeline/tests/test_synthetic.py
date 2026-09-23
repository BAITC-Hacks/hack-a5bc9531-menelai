"""
Синтетический тест: на искусственном графе (60 узлов) с заложенными паттернами пайплайн должен восстановить роли.
Запуск: cd pipeline && uv run python -m pytest tests -q    (или uv run python tests/test_synthetic.py)

Пороги идут через тот же resolve_thresholds, что и на реальных данных. На 60 узлах перцентили падают ниже floor,
поэтому действуют floor (= пороги v1): тест проверяет каскад правил, а не калибровку перцентилей.
"""
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


def build():
    depth = {S1: 0, S2: 0, S3: 0, S4: 0, S5: 0, K: 1, C: 1, D: 1, TN: 1, L: 1, C_OUT: 2, E: 2, L_OUT: 2, M: 2, Z: 4}
    depth |= {g: 2 for g in R + F + N + G + FILL} | {g: 3 for g in Y}
    nodes = pd.DataFrame({"gid": list(depth), "depth": list(depth.values()),
                          "is_seed": [g <= 5 for g in depth]}).astype({"gid": "int64", "depth": "int64"})

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
    # фон
    for a, b in zip(FILL[::2], FILL[1::2]):
        add(a, b, 10_000, 3)

    tx = pd.DataFrame(tx, columns=["src", "dst", "date", "sum_kzt"]).astype({"src": "int64", "dst": "int64"})
    edges = tx.groupby(["src", "dst"]).agg(sum_kzt=("sum_kzt", "sum"), n_tx=("sum_kzt", "size")).reset_index()
    return edges, nodes, tx


def result():
    edges, nodes, tx = build()
    assert len(nodes) == 60
    f, Tr, *_ = run.compute(edges, nodes, tx)
    f["evidence"] = [run.evidence(r, Tr) for _, r in f.iterrows()]
    return f, Tr


EXPECT = {K: "coordinator", C: "consolidator", D: "distributor", TN: "transit", E: "terminal",
          Z: "peripheral", L: "peripheral", M: "consolidator"}


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


if __name__ == "__main__":
    f, Tr = result()
    print("Пороги:", {k: Tr[k] for k in run.PCT_THRESHOLDS})
    for g, want in EXPECT.items():
        r = f.loc[g]
        print(f"{g:>3} ожид. {want:<12} получ. {r.role:<12} {'OK ' if r.role == want else 'FAIL'} "
              f"weak={bool(r.weak_seed_link)} | {r.evidence}")
    test_roles_recovered()
    test_pattern_details()
    print("Роли по всему графу:", f.role.value_counts().to_dict())
    print("SYNTHETIC OK")
