import { Hono } from "hono";
import { runTool, toolSchemas } from "../data/tools";

// External LLM (OpenAI Responses API) is used only here: it picks tools and phrases the answer.
// Roles, priorities and every number come from the deterministic tools. Key: OPENAI_API_KEY (never logged).
const MODEL = process.env.OPENAI_MODEL ?? "gpt-5.6-sol";
const SYSTEM = `Ты — ассистент AML-аналитика в инструменте «Граф денег» (обезличенная выгрузка переводов за июль 2026).
Отвечай по-русски, кратко, списком фактов. Любое число и любой gid бери только из результатов инструментов; если данных нет — так и скажи.
Роли и приоритет уже посчитаны пайплайном, не переоценивай их. Все выводы — гипотезы для проверки («признаки консолидации»), никогда не утверждай виновность.
Пиши gid полностью (18 цифр), суммы — в тенге с пробелами между разрядами.`;

type Step = { tool: string; args: unknown; ok: boolean; summary: string };

export default new Hono()
  .get("/status", (c) => c.json({ llm: Boolean(process.env.OPENAI_API_KEY), model: MODEL, tools: toolSchemas.map((t) => t.name) }))
  .post("/tools/:name", async (c) => {
    try {
      return c.json(runTool(c.req.param("name"), await c.req.json().catch(() => ({}))));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  })
  .post("/ask", async (c) => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return c.json({ error: "LLM не настроен: нет OPENAI_API_KEY в .env; инструменты работают без него" }, 503);
    const { question } = await c.req.json<{ question?: string }>().catch(() => ({ question: undefined }));
    if (!question?.trim()) return c.json({ error: "пустой вопрос" }, 400);

    const input: unknown[] = [{ role: "developer", content: SYSTEM }, { role: "user", content: question.slice(0, 2000) }];
    const trace: Step[] = [];
    for (let round = 0; round < 8; round++) {
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: MODEL, input, tools: toolSchemas, reasoning: { effort: "low" } }),
      });
      if (!res.ok) return c.json({ error: `LLM API ${res.status}`, trace }, 502);
      const r = (await res.json()) as { output: { type: string; call_id?: string; name?: string; arguments?: string; content?: { type: string; text?: string }[] }[] };
      const calls = r.output.filter((o) => o.type === "function_call");
      if (!calls.length) {
        const answer = r.output.flatMap((o) => (o.type === "message" ? (o.content ?? []) : [])).map((p) => p.text ?? "").join("\n").trim();
        return c.json({ answer, trace, model: MODEL });
      }
      input.push(...r.output);
      for (const call of calls) {
        let output: string, ok = true, args: unknown = {};
        try {
          args = JSON.parse(call.arguments || "{}");
          output = JSON.stringify(runTool(call.name!, args));
        } catch (e) {
          ok = false;
          output = JSON.stringify({ error: (e as Error).message });
        }
        trace.push({ tool: call.name!, args, ok, summary: output.slice(0, 240) });
        input.push({ type: "function_call_output", call_id: call.call_id, output });
      }
    }
    return c.json({ error: "слишком много шагов без ответа", trace }, 502);
  });
