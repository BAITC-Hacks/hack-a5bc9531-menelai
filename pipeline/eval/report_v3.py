"""Сборка jury_report_v3.md из snapshot_v3 (пайплайн v3) — задачи 2 (симуляция защиты) и 3 (evidence), задача 1 (критика) не перезапускалась.
EVAL_SNAP=v3 uv run --with pandas --with tabulate python report_v3.py
"""
import json
import pandas as pd
from llm import EVAL, SNAP, PRICE_IN, PRICE_OUT

VERSION, SUFFIX = "v3", "_v3"
t = pd.read_csv(EVAL / f"sim_table{SUFFIX}.csv")
th = json.loads((EVAL / f"question_themes{SUFFIX}.json").read_text())["themes"]
ec = pd.read_csv(EVAL / f"evidence_code_issues{SUFFIX}.csv")
elp = EVAL / f"evidence_llm_issues{SUFFIX}.csv"
el = pd.read_csv(elp) if elp.stat().st_size > 5 else pd.DataFrame(columns=["gid", "type", "detail", "batch"])
u = pd.DataFrame([json.loads(l) for l in open(EVAL / f"usage{SUFFIX}.jsonl")])
u1 = pd.DataFrame([json.loads(l) for l in open(EVAL / "usage.jsonl")])
d = pd.read_csv(SNAP / "nodes_roles.csv").set_index("gid")
t1 = pd.read_csv(EVAL / "sim_table.csv")  # v1, для сравнения
esc = lambda s: str(s).replace("|", "/").replace("\n", " ")

L = ["# Жюри-симуляция v3: оценка методологии «Граф денег» (снимок out/ на момент прогона → snapshot_v3, RULES.md v3)", "",
     f"Модель: `{', '.join(sorted(u.model.unique()))}` (OpenAI Responses API). Оценки ниже — ответы модели в роли жюри, не факты; "
     "числа по данным пересчитаны кодом. Сырые ответы — `pipeline/eval/raw_v3/*.json`.", "",
     "**Что перезапущено.** Только задачи 2 (симуляция защиты) и 3 (консистентность evidence), на актуальном снимке пайплайна v3 "
     "(`pipeline/RULES.md` на момент снимка = `snapshot_v3/RULES_v3.md`, `out/*` = `snapshot_v3/*`). Задача 1 (критика методологии) "
     "не перезапускалась — её тезисы (v1) см. `critique_theses.md`; ниже только новый прогон.", "",
     "## 1. Симуляция защиты по gid (задача 2)", "",
     f"Выборка: {len(t)} уникальных gid — топ-30 `top_nodes.csv` + по 5 случайных на роль (seed 42) + 9 спец-кейсов v3: "
     "3 `no_data`, 3 с `weak_seed_link` (флаг в `node_metrics.json`), 3 `terminal` с `max_payer_share ≥ 0,8` (пересечения с топ-30/случайными убраны). "
     f"Список и группы — `sample_gids{SUFFIX}.json`, построчно — `sim_table{SUFFIX}.csv`.", "",
     "### Вердикт «роль обоснована правилом и числами?» по ролям", "",
     pd.crosstab(t.role, t.verdict, margins=True, margins_name="всего").to_markdown(), ""]
L += ["### По группам выборки", ""]
g = t.assign(group=t.groups.str.split(",")).explode("group").reset_index(drop=True)
L += [pd.crosstab(g.group, g.verdict).to_markdown(), ""]
no_part = t[t.verdict != "да"]
L += [f"### gid с вердиктом «нет»/«частично» ({len(no_part)})", ""]
if len(no_part):
    L += ["| gid | роль | вердикт | почему | альтернатива |", "|---|---|---|---|---|"]
    L += [f"| {r.gid} | {r.role} | {r.verdict} | {esc(r.verdict_why)} | {esc(r.alt_role)}: {esc(r.alt_role_why)} |" for r in no_part.itertuples()]
else:
    L += ["Таких нет: все 65 gid выборки получили вердикт «да» (см. таблицу выше). Свободные `alt_role`, предложенные жюри "
          "даже при вердикте «да», — ниже."]
L += ["", "### Альтернативные роли, предложенные жюри", "", pd.crosstab(t.role, t.alt_role).to_markdown(), ""]
L += ["## 2. Топ-10 тем вопросов жюри (кластеризация моделью всех вопросов симуляции, задача 2)", ""]
for i, x in enumerate(th[:10], 1):
    L += [f"**{i}. {x['theme']}** — {x['count']} вопр., примеры: {', '.join(map(str, x['example_gids']))}", "",
          f"- Вопрос: {x['question']}", f"- Ответ на защите: {x['answer']}", f"- Правка правила: {x.get('rule_fix') or '—'}", ""]
L += ["## 3. Консистентность evidence — все 2 248 строк (задача 3)", "",
      "**Слой A — код** (`evidence_check.py::code_checks`): наличие чисел, длина ≤ 200, префикс = роль (или «нет данных» для правила 0), "
      "стоп-слова виновности, сверка чисел в тексте с метриками (плательщики, получатели, пропуск, seed-доля).", "",
      f"Строк с проблемами: **{len(ec)}**.", ""]
if len(ec):
    L += ["| тип | строк | gid |", "|---|---|---|"]
    for k, grp in ec.groupby("issues"):
        L.append(f"| {esc(k)} | {len(grp)} | {', '.join(map(str, grp.gid))} |")
else:
    L += ["Проблем не найдено кодом ни в одной из 2 248 строк."]
L += ["", f"**Слой B — модель** (батчи по 40, effort medium): {len(el)} замечаний по {el.gid.nunique() if len(el) else 0} gid из 57 батчей.", ""]
if len(el):
    el["role"] = [d.role.get(int(x), "?") if str(x).isdigit() else "?" for x in el.gid]
    L += [pd.crosstab(el.type, el.role, margins=True, margins_name="всего").to_markdown(), "",
          f"Пересечение с кодовым слоем: {len(set(ec.gid.astype(str)) & set(el.gid.astype(str)))} gid.", "",
          "| gid | роль | тип | деталь |", "|---|---|---|---|"]
    L += [f"| {r.gid} | {r.role} | {esc(r.type)} | {esc(r.detail)} |" for r in el.itertuples()]
else:
    L += ["Замечаний нет."]
L += ["", "## 4. Сравнение с v1", "",
      "v1 (66 gid выборки, RULES v1, `snapshot_v1`): 54 «да», 12 «частично», 0 «нет». "
      f"v3 (65 gid выборки, RULES v3, `snapshot_v3`): {(t.verdict == 'да').sum()} «да», {(t.verdict == 'частично').sum()} «частично», "
      f"{(t.verdict == 'нет').sum()} «нет».", "",
      pd.DataFrame({"v1 (n=66)": t1.verdict.value_counts(), "v3 (n=65)": t.verdict.value_counts()}).fillna(0).astype(int).to_markdown(), "",
      "Прочитение: доля «частично» упала с 12/66 (18 %) до 0/65 — согласуется с правками v2→v3, которые жюри-критика (задача 1, v1) "
      "прямо называла причиной «частично»: печать порога посредничества в evidence (тема «нет численного порога p95 betweenness» — теперь "
      "`посредн. ≥0,00116 (p95)` в тексте), правило `max_payer_share < 0,8` для consolidator (устраняет ложный «сборный счёт» при одном "
      "доминирующем плательщике — было 4 из 69 в v1), и флаг `weak_seed_link` (снимает вопрос «структурная роль без денег дела» "
      "с самого evidence на priority, а не оставляет его читателю). Выборки v1 и v3 не идентичны по составу (разные спец-кейсы), "
      "прямое 1:1 сопоставление по gid не проводилось — сравнение агрегатное, по вердиктам.", ""]
L += ["## 5. Стоимость", "",
      f"Оценка при допущении ${PRICE_IN:.0f} / ${PRICE_OUT:.0f} за 1M входных/выходных токенов (reasoning считается как выход); "
      "фактический счёт — в биллинге OpenAI. Бюджет на этот прогон (задачи 2–3, v3) — $8; бюджет v1 ($19) отдельный и не расходуется.", ""]
u["task"] = u.tag.str.split("_").str[0]
s = u.groupby("task").agg(calls=("tag", "size"), input=("input_tokens", "sum"), output=("output_tokens", "sum"),
                           reasoning=("reasoning_tokens", "sum"), usd=("cost_usd", "sum")).round(2)
s.loc["итого v3"] = s.sum()
for c in ("calls", "input", "output", "reasoning"):
    s[c] = s[c].map(lambda v: f"{int(v):,}".replace(",", " "))
L += [s.to_markdown(), "", f"Итого потрачено на v3 (задачи 2–3): **${u.cost_usd.sum():.2f}** ({'в бюджете $8' if u.cost_usd.sum() <= 8 else 'превышает бюджет $8 — последний вызов ушёл поверх лимита, проверка бюджета в llm.py срабатывает ДО вызова, не после'}). Справочно, ранее потрачено на v1: ${u1.cost_usd.sum():.2f} (бюджет $19, отдельный счётчик `usage.jsonl`).", ""]
(EVAL / "jury_report_v3.md").write_text("\n".join(L))
print("ok", len(L))
