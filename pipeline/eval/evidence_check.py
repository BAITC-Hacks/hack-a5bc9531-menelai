"""Задача 3: консистентность evidence на всех 2 248 строках снимка.
Слой A — детерминированные проверки кодом; слой B — модель (батчи по 40, effort=medium); затем пересечение.
uv run --with openai --with python-dotenv --with pandas --with tabulate python evidence_check.py
"""
import json, re
from concurrent.futures import ThreadPoolExecutor
import pandas as pd
from llm import call, parse_json, EVAL, SNAP, ROOT, VERSION, SUFFIX

GUILT = re.compile(r"виновн|преступ|отмыв|наркот|дроп|организатор\b|является|причастен|незаконн", re.I)
num = lambda s: float(s.replace(" ", "").replace(" ", "").replace(",", "."))


def code_checks(d):
    rows = []
    for r in d.itertuples():
        e = r.evidence
        rule0 = bool(r.truncated) or (bool(r.is_seed) and r.in_deg + r.out_deg == 0)
        issues = []
        if not re.search(r"\d", e):
            issues.append("нет чисел")
        if len(e) > 200:
            issues.append(f"длина {len(e)} > 200")
        want = "нет данных" if rule0 else r.role
        if not e.startswith(want):
            issues.append(f"префикс не '{want}'")
        if GUILT.search(e):
            issues.append(f"формулировка: '{GUILT.search(e).group(0)}'")
        fact = e.split("факт:", 1)[1] if "факт:" in e else e.split(";", 1)[-1]
        for pat, col in ((r"(\d+) плат", "in_deg"), (r"(\d+) получ", "out_deg")):
            m = re.search(pat, fact)
            if m and int(m.group(1)) != getattr(r, col):
                issues.append(f"{col}: в тексте {m.group(1)}, в данных {getattr(r, col)}")
        m = re.search(r"пропуск (\d+,\d+)", fact)
        if m and pd.notna(r.pass_through) and abs(num(m.group(1)) - r.pass_through) > 0.006:
            issues.append(f"pass_through: в тексте {m.group(1)}, в данных {r.pass_through:.4f}")
        m = re.search(r"seed-денег (\d+)%", fact)
        if m and abs(int(m.group(1)) - r.seed_share * 100) > 0.51:
            issues.append(f"seed_share: в тексте {m.group(1)}%, в данных {r.seed_share:.4f}")
        if issues:
            rows.append({"gid": r.gid, "role": r.role, "issues": "; ".join(issues), "evidence": e})
    return pd.DataFrame(rows, columns=["gid", "role", "issues", "evidence"])


def llm_checks(d):
    rules = (SNAP / f"RULES_{VERSION}.md").read_text()  # заморожено вместе со снимком
    rules = rules[rules.index("## 1."): rules.index("## 2.")] + rules[rules.index("## 5."):]
    cols = ["gid", "role", "evidence", "in_deg", "out_deg", "in_kzt", "out_kzt", "pass_through", "seed_share",
            "n_seed_upstream", "depth", "truncated", "is_seed", "in_cycle", "betweenness", "fast_out_share"]
    batches = [d[cols].iloc[i:i + 40] for i in range(0, len(d), 40)]

    def one(ib):
        i, b = ib
        prompt = f"""Ты проверяешь поле evidence (обоснование роли, ≤200 символов) в выгрузке AML-пайплайна. Правила ролей команды:
{rules}

Для КАЖДОЙ строки ниже проверь три вещи:
1) evidence содержит конкретные числа;
2) evidence соответствует назначенной роли и её правилу, и числа в тексте согласуются с метриками строки (метрики — источник истины);
3) формулировка — гипотеза/признак, без утверждений о виновности или причастности.
Строки (JSON Lines):
{b.to_json(orient="records", lines=True, force_ascii=False)}

Верни ТОЛЬКО JSON: {{"issues":[{{"gid":"<gid>","type":"нет чисел|не соответствует роли|не соответствует правилу|расхождение чисел|формулировка виновности|другое","detail":"кратко, с числами"}}]}}. Строки без проблем не включай. Если проблем нет — {{"issues":[]}}."""
        try:
            return i, parse_json(call(f"evid_{i:03d}", prompt, effort="medium")).get("issues", []), None
        except Exception as e:
            return i, [], str(e)[:200]

    out, errs = [], []
    with ThreadPoolExecutor(8) as ex:
        for i, iss, err in ex.map(one, enumerate(batches)):
            out += [{**x, "batch": i} for x in iss]
            if err:
                errs.append({"batch": i, "error": err})
    return pd.DataFrame(out), errs, len(batches)


if __name__ == "__main__":
    d = pd.read_csv(SNAP / "nodes_roles.csv")
    a = code_checks(d)
    a.to_csv(EVAL / f"evidence_code_issues{SUFFIX}.csv", index=False)
    print("код:", len(a), "строк с проблемами");  print(a.issues.str.split("; ").explode().str.split(":").str[0].value_counts().to_string())
    b, errs, nb = llm_checks(d)
    b.to_csv(EVAL / f"evidence_llm_issues{SUFFIX}.csv", index=False)
    print(f"модель: {len(b)} замечаний по {b.gid.nunique() if len(b) else 0} gid; батчей {nb}, ошибок {len(errs)} {errs}")
    if len(b):
        b["gid"] = b.gid.astype(str)
        print(b.type.value_counts().to_string())
        both = set(a.gid.astype(str)) & set(b.gid)
        print("пересечение код∩модель:", len(both))
