import { Hono } from "hono";
import { current } from "../data/store";
import { runTool, toolSchemas } from "../data/tools";

// External LLM (OpenAI Responses API) is used only here: it picks tools and phrases the answer.
// Roles, priorities and every number come from the deterministic tools. Key: OPENAI_API_KEY (never logged).
const MODEL = process.env.OPENAI_MODEL ?? "gpt-5.6-sol";
const system = (period: [string, string] | null) => `Ты — ассистент AML-аналитика в инструменте Moneylai (обезличенная выгрузка переводов${period ? ` за ${period[0]} — ${period[1]}` : ""}).
Отвечай по-русски, кратко, списком фактов. Любое число и любой gid бери только из результатов инструментов; если данных нет — так и скажи.
Роли и приоритет уже посчитаны пайплайном, не переоценивай их. Все выводы — гипотезы для проверки («признаки консолидации»), никогда не утверждай виновность.
Пиши gid полностью (18 цифр), суммы — в тенге с пробелами между разрядами.`;

type Step = { tool: string; args: unknown; ok: boolean; summary: string };
const GID = /\d{18}/g;

export default new Hono()
  .get("/status", (c) => c.json({ llm: Boolean(process.env.OPENAI_API_KEY), model: MODEL, tools: toolSchemas.map((t) => t.name) }))
  .post("/tools/:name", async (c) => {
    try {
      return c.json(runTool(current().tools, c.req.param("name"), await c.req.json().catch(() => ({}))));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  })
  .post("/ask", async (c) => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return c.json({ error: "LLM не настроен: нет OPENAI_API_KEY в .env; инструменты работают без него" }, 503);
    const { question } = await c.req.json<{ question?: string }>().catch(() => ({ question: undefined }));
    if (!question?.trim()) return c.json({ error: "пустой вопрос" }, 400);

    const { tools, period } = current(); // pinned for the whole conversation even if the dataset is switched mid-way
    const input: unknown[] = [{ role: "developer", content: system(period) }, { role: "user", content: question.slice(0, 2000) }];
    const trace: Step[] = [];
    const seen = new Set<string>(); // gids some tool output actually contains (a gid typed in the question isn't proof it exists)
    for (let round = 0; round < 8; round++) {
      let res: Response;
      try {
        res = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model: MODEL, input, tools: toolSchemas, reasoning: { effort: "low" } }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (e) {
        return c.json({ error: `LLM API недоступен: ${(e as Error).message}`, trace }, 504);
      }
      if (!res.ok) {
        const detail = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message;
        return c.json({ error: `LLM API ${res.status}${detail ? `: ${detail}` : ""}`, trace }, 502);
      }
      const r = (await res.json()) as { output: { type: string; call_id?: string; name?: string; arguments?: string; content?: { type: string; text?: string }[] }[] };
      const calls = r.output.filter((o) => o.type === "function_call");
      if (!calls.length) {
        const answer = r.output.flatMap((o) => (o.type === "message" ? (o.content ?? []) : [])).map((p) => p.text ?? "").join("\n").trim();
        // gids in the answer that no tool returned: the model made them up or garbled them
        const unverified = [...new Set(answer.match(GID) ?? [])].filter((g) => !seen.has(g));
        return c.json({ answer, trace, model: MODEL, unverified });
      }
      input.push(...r.output);
      for (const call of calls) {
        let output: string, ok = true, args: unknown = {};
        try {
          args = JSON.parse(call.arguments || "{}");
          output = JSON.stringify(runTool(tools, call.name!, args));
        } catch (e) {
          ok = false;
          output = JSON.stringify({ error: (e as Error).message });
        }
        for (const g of output.match(GID) ?? []) seen.add(g);
        trace.push({ tool: call.name!, args, ok, summary: output.slice(0, 240) });
        input.push({ type: "function_call_output", call_id: call.call_id, output });
      }
    }
    return c.json({ error: "слишком много шагов без ответа", trace }, 502);
  });
