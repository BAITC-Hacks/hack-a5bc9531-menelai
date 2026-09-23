#!/usr/bin/env python3
"""
Чувствительность ролей и топ-20 к порогам RULES.md §1: каждый порог ±20 % по одному, затем все сразу
(«все мягче» / «все строже»). Признаки считаются один раз, на каждый вариант пересчитываются только роли и priority.
Запуск: cd pipeline && uv run python sensitivity.py   → out/sensitivity.md
"""
import argparse
import sys
import time
from pathlib import Path

import pandas as pd

import run

# (ключ, целочисленный?, «мягче» = вниз?)  — для «<»-порогов (pass_max) мягче = вверх
KEYS = [
    ("coord_in_deg", True, True), ("coord_out_deg", True, True), ("coord_seed_up", True, True),
    ("coord_betw_thr", False, True), ("coord_min_kzt", False, True),
    ("cons_in_deg", True, True), ("cons_pass_max", False, False), ("cons_in_kzt", False, True),
    ("cons_max_payer", False, False),
    ("dist_out_deg", True, True), ("dist_ratio", False, True),
    ("tr_band", False, False), ("tr_in_kzt", False, True), ("tr_fast_min", False, True),
    ("term_pass_max", False, False), ("term_in_kzt", False, True),
]
# Критерий зафиксирован до прогона: устойчиво, если в каждом одиночном варианте Jaccard топ-20 ≥ 0,8
# и роль меняют ≤ 2 % узлов (44 из 2 248).
MIN_JACCARD, MAX_CHANGED_SHARE = 0.8, 0.02


def scaled(T, key, k, integer):
    """Порог × k. Целочисленные (степени, число seed) — округление, но не меньше чем на ±1, иначе ±20 % от 3 ничего не меняет."""
    T = dict(T)
    if key == "tr_band":                              # коридор 0,8–1,2: полуширина 0,2 × k
        T["tr_pass_lo"], T["tr_pass_hi"] = 1 - 0.2 * k, 1 + 0.2 * k
        return T
    v = T[key]
    nv = v * k
    if integer:
        nv = round(nv)
        if nv == v:
            nv = v + (1 if k > 1 else -1)
    T[key] = nv
    return T


def label(T, key):
    return f"{dec(T['tr_pass_lo'])}–{dec(T['tr_pass_hi'])}" if key == "tr_band" else fmt(T[key])


def fmt(v):
    return f"{v:,.0f}".replace(",", " ") if v >= 1000 else (f"{v:g}" if v >= 0.01 else f"{v:.5f}").replace(".", ",")


def dec(v):
    return f"{v:.2f}".replace(".", ",")


def evaluate(f0, T):
    f = f0.copy()
    run.roles(f, T)
    run.priority(f)
    top = f.reset_index().sort_values(["priority_score", "gid"], ascending=[False, True], kind="mergesort").gid.head(20)
    return f.role, set(top)


def main():
    sys.stdout.reconfigure(encoding="utf-8")     # Windows: консоль/пайп в cp1251 не печатает «≥», «₸»
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="../task/data")
    ap.add_argument("--out", default="../out")
    a = ap.parse_args()
    t0 = time.perf_counter()

    edges, nodes, tx = run.load(Path(a.data))
    f0, T0, *_ = run.compute(edges, nodes, tx)
    base_role, base_top = evaluate(f0, T0)
    n = len(f0)

    variants = [("базовый", "—", T0, "single")]
    for key, integer, _ in KEYS:
        for k in (0.8, 1.2):
            T = scaled(T0, key, k, integer)
            variants.append((f"{key} ×{dec(k)}", f"{label(T0, key)} → {label(T, key)}", T, "single"))
    for name, looser in (("все мягче на 20 %", True), ("все строже на 20 %", False)):
        T = dict(T0)
        for key, integer, down_is_looser in KEYS:
            k = 0.8 if looser == down_is_looser else 1.2
            T = scaled(T, key, k, integer)
        variants.append((name, "все пороги сразу", T, "all"))

    rows = []
    for name, change, T, kind in variants:
        role, top = evaluate(f0, T)
        cnt = role.value_counts().reindex(run.ROLES, fill_value=0)
        dropped = base_top - top
        rows.append(dict(вариант=name, порог=change, **{r: int(cnt[r]) for r in run.ROLES},
                         jaccard_top20=len(top & base_top) / len(top | base_top),
                         сменили_роль=int((role != base_role).sum()), kind=kind,
                         drop=", ".join(f"{base_role[g]}→{role[g]}" for g in sorted(dropped))))
    df = pd.DataFrame(rows)

    single = df[df.kind == "single"].iloc[1:]
    worst_j = single.loc[single.jaccard_top20.idxmin()]
    top_ok = bool((single.jaccard_top20 >= MIN_JACCARD).all())
    bad_roles = single[single.сменили_роль > MAX_CHANGED_SHARE * n]
    stable = top_ok and bad_roles.empty
    allv = df[df.kind == "all"]

    out = df.drop(columns=["kind", "drop"]).copy()
    bad_top = single[single.jaccard_top20 < MIN_JACCARD]
    out["jaccard_top20"] = out.jaccard_top20.map(dec)
    head = "| " + " | ".join(out.columns) + " |\n|" + "---|" * len(out.columns) + "\n"
    body = "".join("| " + " | ".join(str(x) for x in r) + " |\n" for r in out.itertuples(index=False))

    md = f"""# Чувствительность к порогам (RULES.md §1)

Каждый порог каскада ролей меняется на ±20 % (по одному), затем все сразу в одну сторону («мягче»: пороги «≥» ниже,
пороги «<» и коридор транзита шире; «строже» — наоборот). Признаки узлов не пересчитываются, только роли и priority.
Целочисленные пороги (степени, число seed) округляются, но сдвигаются минимум на ±1, иначе ±20 % от 3 ничего не меняет.
Базовые пороги — перцентильные из `run.py` (in_deg ≥ {fmt(T0['cons_in_deg'])}, out_deg ≥ {fmt(T0['dist_out_deg'])},
in_kzt ≥ {fmt(T0['cons_in_kzt'])} ₸, транзит ≥ {fmt(T0['tr_in_kzt'])} ₸).

- `jaccard_top20` — пересечение топ-20 по priority_score с базовым / объединение (1,00 = тот же список).
- `сменили_роль` — сколько из {n} узлов получили другую роль, чем в базовом варианте.

{head}{body}
## Вывод

Критерий (зафиксирован до прогона): устойчиво, если в каждом одиночном варианте Jaccard топ-20 ≥ {dec(MIN_JACCARD)}
и роль меняют ≤ {MAX_CHANGED_SHARE:.0%} узлов ({int(MAX_CHANGED_SHARE * n)}).

**{"Устойчиво" if stable else "Неустойчиво"} по критерию.**
- Топ-20 (кого смотреть первым): {"устойчив" if top_ok else "неустойчив"} — худший Jaccard в одиночных вариантах
  {dec(worst_j.jaccard_top20)} (`{worst_j.вариант}`, {worst_j.порог}).
  {"".join(f"`{r.вариант}` ({r.порог}): Jaccard {dec(r.jaccard_top20)}, выпали из топ-20: {r.drop}. " for r in bad_top.itertuples())}
- Состав ролей: {"устойчив" if bad_roles.empty else "порог 2 % превышен в " + str(len(bad_roles)) + " вариантах — "
  + ", ".join(f"`{r.вариант}` ({r.порог}): {r.сменили_роль}, Jaccard топ-20 {dec(r.jaccard_top20)}" for r in bad_roles.itertuples())}.
  Целочисленный порог сдвигается минимум на 1: 3 → 2 и 3 → 4 плательщиков — шаг ±33 %, не ±20 %.
- Все пороги сразу: мягче — Jaccard {dec(allv.iloc[0].jaccard_top20)}, сменили роль {allv.iloc[0].сменили_роль};
  строже — Jaccard {dec(allv.iloc[1].jaccard_top20)}, сменили роль {allv.iloc[1].сменили_роль}.
"""
    Path(a.out, "sensitivity.md").write_text(md, encoding="utf-8")
    print(md)
    print(f"время {time.perf_counter() - t0:.1f} с")


if __name__ == "__main__":
    main()
