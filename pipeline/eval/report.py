"""Сборка jury_report.md из raw/, sim_table.csv, question_themes.json, evidence_*.csv, usage.jsonl."""
import json
import pandas as pd
from llm import EVAL, SNAP, PRICE_IN, PRICE_OUT

CRITIQUE = (EVAL / "critique_theses.md").read_text()  # тезисы, сокращённые вручную из raw/critique.json
t = pd.read_csv(EVAL / "sim_table.csv")
th = json.loads((EVAL / "question_themes.json").read_text())["themes"]
ec = pd.read_csv(EVAL / "evidence_code_issues.csv")
el = pd.read_csv(EVAL / "evidence_llm_issues.csv") if (EVAL / "evidence_llm_issues.csv").stat().st_size > 5 else pd.DataFrame(columns=["gid", "type", "detail", "batch"])
u = pd.DataFrame([json.loads(l) for l in open(EVAL / "usage.jsonl")])
d = pd.read_csv(SNAP / "nodes_roles.csv").set_index("gid")
esc = lambda s: str(s).replace("|", "/").replace("\n", " ")

L = ["# Жюри-симуляция: оценка методологии Moneylai (снимок out/ → snapshot_v1)", "",
     f"Модель: `{', '.join(sorted(u.model.unique()))}` (OpenAI Responses API). Все оценки ниже — ответы модели в роли жюри, а не факты; "
     "числа по данным пересчитаны кодом. Сырые ответы — `pipeline/eval/raw/*.json`.", "",
     "**Версии.** Снимок `snapshot_v1` = out/ на 14:58 + правила v1 (`snapshot_v1/RULES_v1.md`). В 15:07 другая сессия переписала "
     "`pipeline/RULES.md` на v2, и первый прогон задач 2–3 получил правила v2 при карточках v1. Этот прогон отбракован "
     "(`raw/mismatch_v2rules/`, в отчёт не входит, но его стоимость учтена); задачи 2–3 перезапущены на замороженных правилах v1. "
     "Критика (задача 1) шла на v1. Что из критики уже закрыто в v2 — в конце раздела 1.", "",
     "## 1. Критика методологии (тезисно)", "", CRITIQUE, "",
     "## 2. Симуляция защиты по gid", "",
     f"Выборка: {len(t)} уникальных gid (топ-30 top_nodes + по 5 случайных на роль, seed 42 + 12 спец-кейсов; пересечения убраны). "
     "Список и группы — `sample_gids.json`, построчно — `sim_table.csv`.", "",
     "### Вердикт «роль обоснована правилом и числами?» по ролям", "",
     pd.crosstab(t.role, t.verdict, margins=True, margins_name="всего").to_markdown(), "",
     "### По группам выборки", ""]
g = t.assign(group=t.groups.str.split(",")).explode("group").reset_index(drop=True)
L += [pd.crosstab(g.group, g.verdict).to_markdown(), ""]
no = t[t.verdict == "нет"]
L += [f"### gid с вердиктом «нет» ({len(no)})", ""] + (["| gid | роль | почему «нет» | альтернатива |", "|---|---|---|---|"] if len(no) else ["Таких нет. Вердикты «частично» — в `sim_table.csv`; их причины сведены ниже."])
L += [f"| {r.gid} | {r.role} | {esc(r.verdict_why)} | {esc(r.alt_role)}: {esc(r.alt_role_why)} |" for r in no.itertuples()]
L += ["", (EVAL / "sim_code_checks.md").read_text(), "", "### Альтернативные роли, предложенные жюри", "", pd.crosstab(t.role, t.alt_role).to_markdown(), "",
      "## 3. Самые опасные вопросы жюри (темы — кластеризация моделью всех вопросов симуляции)", "",
      "Ответы и правки — предложения модели. По теме 1 модель считает порог неизвестным, но кодом он найден: "
      "p95 betweenness = 0,00117, минимум у coordinator 0,00131 (см. «Сверка кодом» в разделе 2) — сильный ответ на защите — назвать эти числа.", ""]
for i, x in enumerate(th[:10], 1):
    L += [f"**{i}. {x['theme']}** — {x['count']} вопр., примеры: {', '.join(map(str, x['example_gids']))}", "",
          f"- Вопрос: {x['question']}", f"- Ответ на защите: {x['answer']}", f"- Правка правила: {x.get('rule_fix') or '—'}", ""]
L += ["## 4. Консистентность evidence (все 2 248 строк)", "",
      "**Слой A — код** (`evidence_check.py::code_checks`): наличие чисел, длина ≤ 200, префикс = роль (или «нет данных» для правила 0), "
      "стоп-слова виновности, сверка чисел в тексте с метриками (плательщики, получатели, пропуск, seed-доля).", "",
      f"Строк с проблемами: **{len(ec)}**.", ""]
if len(ec):
    L += ["| тип | строк | gid |", "|---|---|---|"]
    for k, grp in ec.groupby("issues"):
        L.append(f"| {esc(k)} | {len(grp)} | {', '.join(map(str, grp.gid))} |")
L += ["", f"**Слой B — модель** (батчи по 40, effort medium): {len(el)} замечаний по {el.gid.nunique()} gid.", ""]
if len(el):
    el["role"] = [d.role.get(int(x), "?") if str(x).isdigit() else "?" for x in el.gid]
    L += [pd.crosstab(el.type, el.role, margins=True, margins_name="всего").to_markdown(), "",
          f"Пересечение с кодовым слоем: {len(set(ec.gid.astype(str)) & set(el.gid.astype(str)))} gid. "
          "Полный список — `evidence_llm_issues.csv`.", "", "| gid | роль | тип | деталь |", "|---|---|---|---|"]
    L += [f"| {r.gid} | {r.role} | {esc(r.type)} | {esc(r.detail)} |" for r in el.itertuples()]
L += ["", "## 5. Стоимость", "",
      f"Оценка при допущении ${PRICE_IN:.0f} / ${PRICE_OUT:.0f} за 1M входных/выходных токенов (reasoning считается как выход); "
      "фактический счёт — в биллинге OpenAI.", ""]
u["task"] = u.tag.str.split("_").str[0] + u.get("run", pd.Series("", index=u.index)).fillna("").map(lambda r: f" ({r}, отбракован)" if r else "")
s = u.groupby("task").agg(calls=("tag", "size"), input=("input_tokens", "sum"), output=("output_tokens", "sum"),
                         reasoning=("reasoning_tokens", "sum"), usd=("cost_usd", "sum")).round(2)
s.loc["итого"] = s.sum()
for c in ("calls", "input", "output", "reasoning"):
    s[c] = s[c].map(lambda v: f"{int(v):,}".replace(",", " "))
L += [s.to_markdown(), ""]
(EVAL / "jury_report.md").write_text("\n".join(L))
print("ok", len(L))
