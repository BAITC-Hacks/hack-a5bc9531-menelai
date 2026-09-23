"""Общий вызов OpenAI Responses API с логом usage. Ключ из корневого .env, никогда не печатается.
Снимок выбирается переменной окружения EVAL_SNAP (по умолчанию v1, чтобы не ломать прежние результаты);
для не-v1 версий raw/usage/выходные файлы задач получают суффикс _<версия>, чтобы не перезаписывать v1."""
import json, os, pathlib, threading, time
from dotenv import dotenv_values
from openai import OpenAI

ROOT = pathlib.Path(__file__).resolve().parents[2]
EVAL = pathlib.Path(__file__).resolve().parent
VERSION = os.environ.get("EVAL_SNAP", "v1")
SUFFIX = "" if VERSION == "v1" else f"_{VERSION}"
SNAP = EVAL / f"snapshot_{VERSION}"
RAW = EVAL / ("raw" if VERSION == "v1" else f"raw{SUFFIX}"); RAW.mkdir(exist_ok=True)
USAGE = EVAL / f"usage{SUFFIX}.jsonl"

client = OpenAI(api_key=dotenv_values(ROOT / ".env")["OPENAI_API_KEY"])
PRIMARY, FALLBACK = "gpt-5.6-sol", "gpt-5.5"
# ponytail: цена за 1M токенов — допущение (официального прайса gpt-5.6-sol под рукой нет); reasoning считается как output
PRICE_IN, PRICE_OUT = 5.0, 40.0
BUDGET = 19.0 if VERSION == "v1" else 8.0
_lock = threading.Lock()
state = {"model": PRIMARY}


def spent():
    if not USAGE.exists():
        return 0.0
    return sum(json.loads(l)["cost_usd"] for l in USAGE.read_text().splitlines() if l.strip())


def call(tag, prompt, effort="high"):
    """Возвращает текст ответа; сырой ответ пишет в raw/<tag>.json."""
    out = RAW / f"{tag}.json"
    if out.exists():  # идемпотентно: повторный прогон не платит второй раз
        return json.loads(out.read_text())["text"]
    if spent() > BUDGET:
        raise RuntimeError("бюджет исчерпан")
    for attempt in range(4):
        try:
            r = client.responses.create(model=state["model"], reasoning={"effort": effort}, input=prompt)
            break
        except Exception as e:  # 400/404 на основной модели -> фолбэк
            code = getattr(e, "status_code", None)
            if code in (400, 404) and state["model"] == PRIMARY:
                print(f"{PRIMARY} недоступна ({code}): {str(e)[:200]} -> {FALLBACK}")
                state["model"] = FALLBACK
                continue
            if attempt == 3:
                raise
            time.sleep(min(60, 10 * 2 ** attempt))
    u = r.usage
    cost = u.input_tokens / 1e6 * PRICE_IN + u.output_tokens / 1e6 * PRICE_OUT
    rec = {"tag": tag, "model": r.model, "effort": effort, "input_tokens": u.input_tokens,
           "output_tokens": u.output_tokens,
           "reasoning_tokens": getattr(u.output_tokens_details, "reasoning_tokens", None),
           "cost_usd": round(cost, 5), "ts": time.time()}
    with _lock:
        with USAGE.open("a") as f:
            f.write(json.dumps(rec) + "\n")
    out.write_text(json.dumps({"tag": tag, "model": r.model, "text": r.output_text}, ensure_ascii=False, indent=1))
    return r.output_text


def parse_json(text):
    i = min(p for p in (text.find("{"), text.find("[")) if p != -1)
    return json.loads(text[i: max(text.rfind("}"), text.rfind("]")) + 1])


if __name__ == "__main__":
    print(call("probe", "Ответь одним словом по-русски: столица Казахстана?", effort="low"))
    print(USAGE.read_text().splitlines()[-1])
