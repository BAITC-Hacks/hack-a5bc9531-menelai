# eval/ — симуляция жюри на LLM

Внешняя проверка решения: модель (`gpt-5.6-sol`, запасная `gpt-5.5`, OpenAI Responses API) в роли жюри
критикует методологию, разбирает выборку gid («роль обоснована правилом и числами?») и проверяет evidence всех 2 248 строк.
**LLM используется только здесь, для оценки.** В расчёте ролей (`run.py`, `sensitivity.py`) вызовов LLM нет.

Ключ `OPENAI_API_KEY` берётся из корневого `.env` репозитория (в `.gitignore`), в логи не печатается.
Снимок выбирается переменной `EVAL_SNAP` (`v1` по умолчанию, `v3` — итоговый); для не-v1 файлы получают суффикс `_v3`.

```bash
cd pipeline/eval
D="--with openai --with python-dotenv --with pandas --with tabulate"
EVAL_SNAP=v3 uv run $D python jury.py sim          # также: critique | agg
EVAL_SNAP=v3 uv run $D python evidence_check.py
EVAL_SNAP=v3 uv run $D python report_v3.py         # → jury_report_v3.md (v1: report.py → jury_report.md)
```

Отчёты: `jury_report.md` (v1), `jury_report_v3.md` (v3: 65 «да» / 0 / 0), `critique_theses.md`.
Входы — `snapshot_v1/`, `snapshot_v3/`, `tz_5_9.txt`; сырые ответы — `raw/`, `raw_v3/`; расход токенов — `usage*.jsonl`.
