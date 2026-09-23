"""Задачи 1–2: критика методологии и симуляция защиты по gid.
uv run --with openai --with python-dotenv --with pandas --with tabulate python jury.py critique|sim|agg
"""
import json, sys, re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import pandas as pd
from llm import call, parse_json, EVAL, SNAP, ROOT, VERSION, SUFFIX

RULES = (SNAP / f"RULES_{VERSION}.md").read_text()  # заморожено вместе со снимком SNAP
TZ = (EVAL / "tz_5_9.txt").read_text()
ROLES = ["coordinator", "consolidator", "distributor", "transit", "terminal", "peripheral"]


def rules_short():
    """RULES §0–3 и §5 (без §4 кластеров и §6): §0 нужен, чтобы жюри понимало имена метрик."""
    parts = re.split(r"(?m)^## ", RULES)
    keep = [p for p in parts[1:] if p[:2] in ("0.", "1.", "2.", "3.", "5.")]
    return parts[0] + "".join("## " + p for p in keep)


ROLE_DICT = TZ[TZ.index("Словарь ролей"): TZ.index("clusters.csv")]

DATA_SUMMARY = """Сводка по результату пайплайна (снимок out/, 2 248 узлов):
- роли: peripheral 1894, terminal 209, consolidator 69, transit 29, coordinator 24, distributor 23;
- 444 узла обрезаны (depth=4, out_deg=0) -> peripheral «нет данных»; ещё 19 seed без единого ребра -> peripheral;
- 335 не-seed узлов отдали больше, чем получили (354 по ТЗ, включая seed) — невидимый вход извне графа;
- 45,8 % всех узлов имеют >= 2 разных seed выше по потоку (пути <= 4 шагов) — признак «связь с >= 2 seed» слабо различает;
- 37 из 69 consolidator имеют seed_share < 0,1 (менее 10 % входа — «окрашенные» seed-деньги);
- распределения: in_deg p95=3, p99=6; out_deg p90=8, p95=16, p99=61; in_kzt p50=50 тыс., p90=416 тыс., p99=1,8 млн ₸."""


def critique():
    prompt = f"""Ты — строгий член жюри хакатона, 12 лет в AML/финмониторинге банка второго уровня Казахстана (типологии, ПОД/ФТ, работа с АФМ). Команда решает кейс «Граф денег»: по выгрузке переводов назначает клиентам роли. Оцени методологию жёстко и предметно, без комплиментов.

=== ТЗ кейса (разделы 5–9) ===
{TZ}

=== Правила команды (RULES.md целиком) ===
{RULES}

=== {DATA_SUMMARY}

Ответь по-русски, структурированно (Markdown, заголовки по пунктам):
1. Где правила необоснованны (конкретный порог/условие -> почему -> чем грозит).
2. Где методология из «общего опыта» AML неприменима к ЭТОЙ выгрузке (только исходящие переводы от seed, 4 колена, 1 месяц, порог 5 000 ₸, только внутрибанковские) — какие роли/метрики от этого искажены и в какую сторону.
3. Какие 5 вопросов задаст жюри на защите (самые неудобные) — и какой ответ был бы сильным.
4. Что бы ты изменил в правилах (конкретно: условие/порог/новая метрика), в порядке приоритета, с учётом что до дедлайна ~2 часа.
5. Итоговая оценка по критерию «соответствие/техника» — 3 предложения."""
    print(call("critique", prompt, effort="high"))


def sample():
    d = pd.read_csv(SNAP / "nodes_roles.csv")
    top = pd.read_csv(SNAP / "top_nodes.csv")
    groups = {}
    add = lambda gids, g: [groups.setdefault(int(x), []).append(g) for x in gids]
    add(top.gid.head(30), "top30")
    for r in ROLES:
        sub = d[d.role == r]
        add(sub.sample(min(5, len(sub)), random_state=42).gid, f"random_{r}")
    if VERSION == "v1":
        add(d[d.truncated].sample(3, random_state=42).gid, "spec_truncated")
        add(d[d.is_seed & (d.in_deg + d.out_deg == 0)].sample(3, random_state=42).gid, "spec_seed_isolated")
        add(d[(d.role == "consolidator") & (d.seed_share < 0.1)].sample(3, random_state=42).gid, "spec_consolidator_lowseed")
        add(d[(d.role == "terminal") & (d.in_deg <= 2)].nlargest(3, "in_kzt").gid, "spec_terminal_1_2_payers")
    else:
        # v3: спец-кейсы по просьбе — no_data, weak_seed_link (флаг в node_metrics.json), terminal с max_payer_share >= 0,8
        metrics = json.loads((SNAP / "node_metrics.json").read_text())
        weak = d.gid.astype(str).map(lambda g: metrics.get(g, {}).get("weak_seed_link", False))
        add(d[d.no_data].sample(3, random_state=42).gid, "spec_no_data")
        add(d[weak].sample(3, random_state=42).gid, "spec_weak_seed_link")
        add(d[(d.role == "terminal") & (d.max_payer_share >= 0.8)].sample(3, random_state=42).gid, "spec_terminal_max_payer")
    return groups


def node_card(gid, d, top, metrics):
    row = d[d.gid == gid].iloc[0].to_dict()
    m = metrics[str(gid)]
    card = {k: (v.item() if hasattr(v, "item") else v) for k, v in row.items()}
    w = top[top.gid == gid]
    if len(w):
        card["why_top_nodes"] = w.iloc[0].why
        card["rank_top_nodes"] = int(w.iloc[0]["rank"])
    for k in ("top_in", "top_out", "cycles", "sync_days"):
        card[k] = m.get(k)
    return card


def sim():
    groups = sample()
    (EVAL / f"sample_gids{SUFFIX}.json").write_text(json.dumps({str(k): v for k, v in groups.items()}, indent=1))
    d = pd.read_csv(SNAP / "nodes_roles.csv")
    top = pd.read_csv(SNAP / "top_nodes.csv")
    metrics = json.loads((SNAP / "node_metrics.json").read_text())
    rs = rules_short()
    print(f"выборка: {len(groups)} уникальных gid")

    def one(gid):
        card = node_card(gid, d, top, metrics)
        prompt = f"""Ты — строгий член жюри хакатона «Граф денег» (AML, опыт в банке второго уровня Казахстана). Проверяется must-have 3: жюри называет gid, команда объясняет роль по своим метрикам. Выгрузка: только исходящие переводы от 81 seed (участники незаконного оборота наркотиков), 4 колена, июль 2026, транзакции < 5 000 ₸ не попали; у seed вход занижен; depth=4 без исходящих = обрыв обхода.

=== Словарь ролей из ТЗ ===
{ROLE_DICT}
=== Правила команды (выдержка) ===
{rs}

=== Карточка узла gid={gid} (строка nodes_roles.csv + top_in/top_out/cycles/sync_days из node_metrics.json) ===
{json.dumps(card, ensure_ascii=False, indent=1)}

Оцени строго по числам карточки и правилам. Верни ТОЛЬКО JSON:
{{"gid": "{gid}", "verdict": "да|частично|нет", "verdict_why": "роль обоснована правилом и числами? почему (1–3 предложения, с числами)", "jury_question": "один самый неудобный вопрос жюри по этому узлу", "alt_role": "одна из ролей словаря или 'нет'", "alt_role_why": "почему возможна альтернативная роль (с числами)"}}"""
        try:
            txt = call(f"sim_{gid}", prompt, effort="high")
        except Exception as e:
            return {"gid": str(gid), "call_error": str(e)[:200]}
        try:
            return parse_json(txt)
        except Exception:
            return {"gid": str(gid), "parse_error": True}

    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(one, groups))
    (EVAL / f"sim_results{SUFFIX}.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
    print("готово", len(res))


def agg():
    groups = {int(k): v for k, v in json.loads((EVAL / f"sample_gids{SUFFIX}.json").read_text()).items()}
    res = json.loads((EVAL / f"sim_results{SUFFIX}.json").read_text())
    d = pd.read_csv(SNAP / "nodes_roles.csv").set_index("gid")
    rows = []
    for r in res:
        g = int(r["gid"])
        rows.append({"gid": g, "role": d.loc[g, "role"], "groups": ",".join(groups.get(g, [])),
                     "verdict": r.get("verdict", "ошибка"), "verdict_why": r.get("verdict_why", ""),
                     "jury_question": r.get("jury_question", ""), "alt_role": r.get("alt_role", ""),
                     "alt_role_why": r.get("alt_role_why", "")})
    t = pd.DataFrame(rows)
    t.to_csv(EVAL / f"sim_table{SUFFIX}.csv", index=False)
    print(pd.crosstab(t.role, t.verdict, margins=True).to_markdown())
    # кластеризация вопросов — моделью (строковое совпадение не агрегирует свободный текст)
    qs = "\n".join(f"- [{r.gid} {r.role}] {r.jury_question}" for r in t.itertuples())
    prompt = f"""Ниже {len(t)} вопросов, которые симулированное жюри AML-хакатона задало бы по конкретным узлам (в скобках gid и роль, назначенная пайплайном).
Правила команды:
{rules_short()}

Вопросы:
{qs}

Сгруппируй вопросы в не более чем 10 тем по опасности для команды (самые опасные первыми). Для каждой темы: сколько вопросов в неё попало, 2–3 примера gid, формулировка вопроса-представителя, предлагаемый ответ команды на защите (опираясь только на правила и метрики выше) и, если ответа нет, — конкретная правка правила. Верни ТОЛЬКО JSON: {{"themes":[{{"theme":"","count":0,"example_gids":[],"question":"","answer":"","rule_fix":""}}]}}"""
    th = parse_json(call("question_themes", prompt, effort="medium"))
    (EVAL / f"question_themes{SUFFIX}.json").write_text(json.dumps(th, ensure_ascii=False, indent=1))
    print(json.dumps(th, ensure_ascii=False, indent=1)[:3000])


if __name__ == "__main__":
    {"critique": critique, "sim": sim, "agg": agg}[sys.argv[1]]()
