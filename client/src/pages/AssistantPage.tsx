import { useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRightIcon, ChevronRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Eyebrow, GidLink, HypTag, LoadState, PageHeader, Panel, RoleChip } from '@/components/kit'
import { api, type AssistantAnswer, type Gid, type Role } from '@/lib/api'
import { kzt, kztShort, num } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

const EXAMPLES = [
  'Кто собирает деньги с 0343175100, 0331309100 и 0437046100?',
  'Есть ли путь денег от 3684369100 к 3115284100?',
  'Какие синхронные входы были 19 июля?',
  'Покажи координаторов кластера 0',
]

// Human wording for server/src/data/tools.ts; threshold numbers deliberately left out (they live in the pipeline).
const TOOL_INFO: Record<string, string> = {
  node_metrics: 'метрики, роль, приоритет, кластер и evidence узла',
  neighbors: 'крупнейшие плательщики и получатели узла с суммами',
  common_successors: 'получатели, которым платят несколько из заданных узлов',
  paths: 'направленные пути денег от одного узла к другому',
  sync_events: 'синхронные входы: несколько разных плательщиков одному получателю за день (порог — из пайплайна)',
  query_nodes: 'узлы по роли, кластеру, seed и приоритету',
  cluster_summary: 'сводка кластера: размер, seed, оборот, гипотеза',
}

// ---------------------------------------------------------------- minimal markdown → React (no innerHTML)

type ListItem = { indent: number; ordered: boolean; text: string; children: ListItem[] }
type MdBlock = { type: 'p'; lines: string[] } | { type: 'list'; items: ListItem[] }

const LIST_RE = /^(\s*)(?:[-*•]|(\d+)[.)])\s+(.*)$/

/** Paragraphs (consecutive lines, blank line splits) and lists nested by leading-space indent. */
function parseMd(text: string): MdBlock[] {
  const blocks: MdBlock[] = []
  let stack: ListItem[] = []
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/^#{1,6}\s+/, '')
    const m = LIST_RE.exec(line)
    const last = blocks.at(-1)
    if (m) {
      const item: ListItem = { indent: m[1].length, ordered: m[2] != null, text: m[3], children: [] }
      if (last?.type !== 'list') {
        blocks.push({ type: 'list', items: [] })
        stack = []
      }
      while (stack.length && stack.at(-1)!.indent >= item.indent) stack.pop()
      const list = blocks.at(-1) as Extract<MdBlock, { type: 'list' }>
      ;(stack.at(-1)?.children ?? list.items).push(item)
      stack.push(item)
    } else if (!line.trim()) {
      if (last?.type === 'p' || last?.type === 'list') blocks.push({ type: 'p', lines: [] })
    } else if (last?.type === 'list' && /^\s+/.test(line) && stack.length) {
      stack.at(-1)!.text += ' ' + line.trim() // continuation of an indented list item
    } else if (last?.type === 'p') last.lines.push(line)
    else blocks.push({ type: 'p', lines: [line] })
  }
  return blocks.filter((b) => (b.type === 'p' ? b.lines.length : b.items.length))
}

const GID_RE = /((?<!\d)1000000\d{11}(?!\d))/
const MARK_RE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/

function Inline({ text }: { text: string }) {
  return text.split(MARK_RE).map((part, i): ReactNode => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return <strong key={i} className="font-semibold text-foreground"><Inline text={part.slice(2, -2)} /></strong>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return <code key={i} className="font-mono text-[13px]"><Inline text={part.slice(1, -1)} /></code>
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
      return <em key={i}><Inline text={part.slice(1, -1)} /></em>
    return part.split(GID_RE).map((s, j) => (j % 2 ? <GidLink key={`${i}-${j}`} gid={s} /> : s))
  })
}

function MdList({ items }: { items: ListItem[] }) {
  const Tag = items[0]?.ordered ? 'ol' : 'ul'
  return (
    <Tag className={cn('grid gap-1 pl-5', Tag === 'ol' ? 'list-decimal' : 'list-disc marker:text-muted-foreground')}>
      {items.map((it, i) => (
        <li key={i} className="pl-0.5">
          <Inline text={it.text} />
          {it.children.length > 0 && <div className="mt-1"><MdList items={it.children} /></div>}
        </li>
      ))}
    </Tag>
  )
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="grid gap-3 text-sm leading-relaxed text-ink-2">
      {parseMd(text).map((b, i) =>
        b.type === 'list' ? (
          <MdList key={i} items={b.items} />
        ) : (
          <p key={i}>
            {b.lines.map((l, j) => (
              <span key={j}>
                {j > 0 && <br />}
                <Inline text={l} />
              </span>
            ))}
          </p>
        ),
      )}
    </div>
  )
}

// ---------------------------------------------------------------- chat

type Msg = { id: number; q: string; res?: AssistantAnswer; err?: string }

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)

function Trace({ steps }: { steps: AssistantAnswer['trace'] }) {
  if (!steps.length) return <p className="font-mono text-[11px] text-muted-foreground">инструменты не вызывались</p>
  return (
    <details className="group rounded-md border bg-panel-2/50">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-3 py-2 text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
        цепочка вызовов · <span className="font-mono tnum">{steps.length}</span>
      </summary>
      <ol className="grid gap-2.5 border-t px-3 py-3">
        {steps.map((s, i) => (
          <li key={i} className="grid gap-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
              <span className="font-mono text-muted-foreground tnum">{i + 1}.</span>
              <span className="font-mono font-medium text-foreground">{s.tool}</span>
              <span className="font-mono break-all text-ink-2">{clip(JSON.stringify(s.args), 120)}</span>
              <span className={cn('font-mono', s.ok ? 'text-muted-foreground' : 'text-destructive')}>{s.ok ? 'ok' : 'ошибка'}</span>
            </div>
            <p className="font-mono text-[11px] leading-snug break-all text-muted-foreground">{s.summary}</p>
          </li>
        ))}
      </ol>
    </details>
  )
}

function Waiting() {
  return (
    <div role="status" className="flex items-center gap-2.5 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
      <span className="flex gap-1" aria-hidden>
        {[0, 150, 300].map((d) => (
          <span key={d} className="size-1.5 rounded-full bg-gold motion-safe:animate-bounce" style={{ animationDelay: `${d}ms` }} />
        ))}
      </span>
      вызываю инструменты…
    </div>
  )
}

function Message({ m }: { m: Msg }) {
  return (
    <li className="grid gap-3">
      <div className="ml-auto max-w-[85%] rounded-xl border border-gold/50 px-4 py-2.5 text-sm whitespace-pre-wrap">{m.q}</div>
      {m.err ? (
        <div role="alert" className="max-w-[92%] rounded-xl border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-foreground">
          <Eyebrow className="mb-1 text-destructive">ошибка</Eyebrow>
          {m.err}
        </div>
      ) : m.res ? (
        <div className="grid max-w-[92%] gap-3 rounded-xl border bg-card px-4 py-3.5">
          <Markdown text={m.res.answer || 'Модель вернула пустой ответ.'} />
          <Trace steps={m.res.trace} />
          <div className="flex flex-wrap items-center gap-2">
            <HypTag>гипотеза — проверить</HypTag>
            <span className="font-mono text-[11px] text-muted-foreground">модель: {m.res.model}</span>
          </div>
        </div>
      ) : (
        <Waiting />
      )}
    </li>
  )
}

// ---------------------------------------------------------------- deterministic tools, no LLM

type Brief = { gid: Gid; role?: Role; is_seed?: boolean }
type Common = { resolved: Gid[]; common: (Brief & { paid_by: number; of: number; sum_kzt_from_them: number })[] }
type Paths = { src: Gid; dst: Gid; max_len: number; paths: { hops: number; nodes: Brief[] }[] }

function useTool<T>(name: string) {
  const [state, setState] = useState<{ data?: T; error?: string; busy?: boolean }>({})
  const run = (args: Record<string, unknown>) => {
    setState({ busy: true })
    api
      .tool<T>(name, args)
      .then((data) => setState({ data }))
      .catch((e: unknown) => setState({ error: e instanceof Error ? e.message : String(e) }))
  }
  return { ...state, run }
}

const ToolError = ({ error }: { error?: string }) =>
  error ? <p role="alert" className="font-mono text-xs text-destructive">{error}</p> : null

function CommonForm() {
  const [value, setValue] = useState('0343175100, 0331309100, 0437046100')
  const t = useTool<Common>('common_successors')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    t.run({ gids: value.split(/[,\s;]+/).filter(Boolean) })
  }
  return (
    <form onSubmit={submit} className="grid gap-2">
      <label htmlFor="cs-gids" className="text-sm font-medium">Общие получатели</label>
      <Input id="cs-gids" value={value} onChange={(e) => setValue(e.target.value)} placeholder="gid или хвосты через запятую" className="font-mono" />
      <Button type="submit" variant="outline" size="sm" disabled={t.busy} className="justify-self-start">Найти</Button>
      <ToolError error={t.error} />
      {t.data &&
        (t.data.common.length ? (
          <ul className="grid gap-2 text-[13px]">
            {t.data.common.map((c) => (
              <li key={c.gid} className="grid gap-1 border-t pt-2">
                <div className="flex flex-wrap items-center gap-2">
                  <GidLink gid={c.gid} short />
                  {c.role && <RoleChip role={c.role} />}
                </div>
                <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                  <span>платят <span className="font-mono tnum text-foreground">{c.paid_by}</span> из <span className="font-mono tnum">{c.of}</span></span>
                  <span className="font-mono tnum text-foreground" title={kzt(c.sum_kzt_from_them)}>{kztShort(c.sum_kzt_from_them)}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Общих получателей нет.</p>
        ))}
    </form>
  )
}

function PathsForm() {
  const [src, setSrc] = useState('3684369100')
  const [dst, setDst] = useState('3115284100')
  const t = useTool<Paths>('paths')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    t.run({ src, dst, max_len: 4 })
  }
  return (
    <form onSubmit={submit} className="grid gap-2">
      <span className="text-sm font-medium">Пути денег</span>
      <div className="grid grid-cols-2 gap-2">
        <Input aria-label="Откуда (src)" value={src} onChange={(e) => setSrc(e.target.value)} placeholder="откуда" className="font-mono" />
        <Input aria-label="Куда (dst)" value={dst} onChange={(e) => setDst(e.target.value)} placeholder="куда" className="font-mono" />
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={t.busy} className="justify-self-start">Найти пути</Button>
      <ToolError error={t.error} />
      {t.data &&
        (t.data.paths.length ? (
          <div className="grid gap-2">
            <p className="text-xs text-muted-foreground">
              найдено путей: <span className="font-mono tnum text-foreground">{num(t.data.paths.length)}</span> (длиной ≤ <span className="font-mono tnum">{t.data.max_len}</span>)
            </p>
            <ol className="grid gap-1.5">
              {t.data.paths.map((p, i) => (
                <li key={i} className="flex flex-wrap items-center gap-1 border-t pt-1.5">
                  {p.nodes.map((n, j) => (
                    <span key={j} className="inline-flex items-center gap-1">
                      {j > 0 && <ArrowRightIcon className="size-3.5 text-muted-foreground" aria-label="→" />}
                      <GidLink gid={n.gid} short />
                    </span>
                  ))}
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Направленных путей длиной ≤ {t.data.max_len} не найдено.</p>
        ))}
    </form>
  )
}

// ---------------------------------------------------------------- page

export default function AssistantPage() {
  const { data: status, error, reload } = useApi(api.assistantStatus)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const busy = msgs.some((m) => !m.res && !m.err)

  const send = (question: string) => {
    const q = question.trim()
    if (!q || busy) return
    const id = msgs.length // append-only list: index is a stable id
    const patch = (p: Partial<Msg>) => setMsgs((all) => all.map((m) => (m.id === id ? { ...m, ...p } : m)))
    setMsgs((all) => [...all, { id, q }])
    setInput('')
    api
      .ask(q)
      .then((res) => patch({ res }))
      .catch((e: unknown) => patch({ err: e instanceof Error ? e.message : String(e) }))
  }

  if (!status) return <LoadState error={error} reload={reload} />

  return (
    <>
      <PageHeader
        eyebrow="ассистент · LLM выбирает инструменты, числа — из пайплайна"
        title="Спросите граф"
        lede="Вопрос на естественном языке → модель вызывает детерминированные инструменты над метриками → ответ со ссылками на gid. Модель не назначает роли, не считает числа и не пишет в выгрузки; все выводы — гипотезы."
        aside={
          <p className="text-xs text-muted-foreground">
            модель: <span className="font-mono text-ink-2">{status.model}</span> · инструментов:{' '}
            <span className="font-mono tnum text-ink-2">{status.tools.length}</span>
          </p>
        }
      />

      {!status.llm && (
        <div role="status" className="rounded-xl border border-gold/40 bg-panel-2 px-4 py-3 text-sm text-ink-2">
          LLM не настроен (нет <code className="font-mono">OPENAI_API_KEY</code> в <code className="font-mono">.env</code>) — инструменты
          ниже работают без него.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <section aria-label="Чат с ассистентом" className="grid min-w-0 gap-5">
          {msgs.length > 0 ? (
            <ol aria-live="polite" className="grid gap-6">
              {msgs.map((m) => (
                <Message key={m.id} m={m} />
              ))}
            </ol>
          ) : (
            <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
              Задайте вопрос об узлах, путях денег, синхронных входах или кластерах — или выберите пример ниже.
            </p>
          )}

          <div className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={busy}
                  onClick={() => send(q)}
                  className="rounded-full border bg-card px-3 py-1.5 text-left text-xs text-ink-2 transition-colors hover:border-line-2 hover:text-foreground disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                send(input)
              }}
              className="grid gap-2 rounded-xl border bg-card p-3"
            >
              <label htmlFor="ask" className="sr-only">
                Вопрос ассистенту
              </label>
              <textarea
                id="ask"
                rows={3}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    send(input)
                  }
                }}
                placeholder="Например: кто крупнейшие получатели 3684369100?"
                className="w-full resize-y rounded-lg border border-input bg-input/30 px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Enter — отправить, Shift+Enter — новая строка</span>
                <Button type="submit" disabled={busy || !input.trim()}>
                  Спросить
                </Button>
              </div>
            </form>
          </div>
        </section>

        <aside className="grid gap-4 lg:sticky lg:top-20">
          <Panel eyebrow="инструменты" title="Что может вызвать модель">
            <ul className="grid gap-2.5">
              {status.tools.map((name) => (
                <li key={name} className="grid gap-0.5">
                  <span className="font-mono text-[13px] text-foreground">{name}</span>
                  {TOOL_INFO[name] && <span className="text-xs text-muted-foreground">{TOOL_INFO[name]}</span>}
                </li>
              ))}
            </ul>
          </Panel>
          <Panel eyebrow="без LLM" title="Проверить без LLM" bodyClassName="grid gap-5">
            <CommonForm />
            <PathsForm />
          </Panel>
        </aside>
      </div>

      <p className="text-xs text-muted-foreground">
        Внешний сервис: OpenAI API, используется только на этом экране; ключ хранится в <code className="font-mono">.env</code> и не
        попадает в клиент.
      </p>
    </>
  )
}
