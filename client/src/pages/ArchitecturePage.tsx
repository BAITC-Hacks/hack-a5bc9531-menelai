import type { ReactNode } from 'react'
import { ArrowRight, ChevronDown, ChevronRight } from 'lucide-react'
import { Eyebrow, HypTag, LoadState, PageHeader, Panel } from '@/components/kit'
import { api } from '@/lib/api'
import { num } from '@/lib/format'
import { useApi } from '@/lib/use-api'

type Stage = { eyebrow: string; title: string; items: ReactNode[] }

function Arrow() {
  return (
    <div aria-hidden className="flex shrink-0 items-center justify-center text-gold">
      <ChevronRight className="hidden size-5 lg:block" />
      <ChevronDown className="size-5 lg:hidden" />
    </div>
  )
}

function StageCard({ s }: { s: Stage }) {
  return (
    <div className="grid min-w-0 flex-1 content-start gap-2 rounded-lg border bg-panel-2/60 p-3.5">
      <Eyebrow>{s.eyebrow}</Eyebrow>
      <div className="font-mono text-[13px] font-medium">{s.title}</div>
      <ul className="grid gap-1 text-[12.5px] text-ink-2">
        {s.items.map((it, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="text-muted-foreground">·</span>
            {it}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function ArchitecturePage() {
  const { data: stats, error, reload } = useApi(api.stats)
  if (!stats) return <LoadState error={error} reload={reload} />

  const stages: Stage[] = [
    {
      eyebrow: 'данные',
      title: 'task/data/*.parquet',
      items: [
        `edges.parquet — ${num(stats.edges)} пар плательщик→получатель`,
        `nodes.parquet — ${num(stats.nodes)} клиентов, колено обхода, seed`,
        `transactions.parquet — ${num(stats.transactions)} переводов с датами`,
        'сверка: edges = Σ transactions (load() в run.py)',
      ],
    },
    {
      eyebrow: 'пайплайн · Python + uv',
      title: 'pipeline/run.py',
      items: [
        'метрики графа (degree, betweenness, pagerank)',
        '«окрашенные» seed-деньги (пропорциональное смешивание)',
        'временные паттерны (быстрый вывод, синхронные входы)',
        'циклы ≤ 5 шагов',
        'роли — каскад правил сверху вниз',
        'кластеры — Louvain на неориентированной проекции',
        'приоритет · evidence/why',
        'выгрузки в out/',
      ],
    },
    {
      eyebrow: 'выгрузки',
      title: 'out/',
      items: ['nodes_roles.csv', 'clusters.csv', 'top_nodes.csv', 'node_metrics.json'],
    },
    {
      eyebrow: 'сервер · Bun + Hono',
      title: 'server/',
      items: [
        'читает parquet и out/ один раз при старте',
        'раскладка графа — d3-force',
        'аналитика: маршруты, время, аномалии, устойчивость, полнота',
        'инструменты ассистента (детерминированные)',
        '/api/*',
      ],
    },
    {
      eyebrow: 'клиент · React 19 + Vite',
      title: 'client/',
      items: [
        'Обзор, Схема сети (canvas), Карточка узла',
        'Приоритеты, Кластеры',
        'Анализ: маршруты и циклы, время, аномалии, устойчивость, полнота',
        'Ассистент',
        'Метод: правила ролей, схема решения',
      ],
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow="метод · схема решения"
        title="От parquet до экрана"
        lede="Один прогон пайплайна на выгрузке организаторов превращается в четыре CSV/JSON-файла; сервер их читает, а клиент — только показывает. Роли, кластеры и приоритет не пересчитываются ни на сервере, ни в браузере."
      />

      <Panel eyebrow="решение целиком" title="Данные → пайплайн → выгрузки → сервер → интерфейс" bodyClassName="p-4">
        <div className="grid gap-3">
          <div className="flex flex-col items-stretch gap-3 lg:flex-row">
            {stages.map((s, i) => (
              <div key={s.title} className="flex flex-col items-stretch gap-3 lg:flex-row lg:flex-1">
                <StageCard s={s} />
                {i < stages.length - 1 && <Arrow />}
              </div>
            ))}
          </div>

          <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-gold/40 bg-panel-2/30 p-3.5 sm:flex-row sm:items-center">
            <Eyebrow className="text-gold">LLM — только здесь</Eyebrow>
            <p className="flex-1 text-[12.5px] text-ink-2">
              Ассистент (<code className="font-mono">/assistant</code>, OpenAI Responses API) выбирает вызовы инструментов сервера и формулирует ответ
              из их результата. Роли, пороги, приоритет и любые числа он не считает и в выгрузки не пишет.
            </p>
            <div className="flex items-center gap-1.5 self-start font-mono text-[11px] text-muted-foreground sm:self-center">
              <ArrowRight className="size-3.5 shrink-0 text-gold" />
              только к инструментам сервера
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel eyebrow="стек" title="Что реально используется">
          <div className="grid gap-4 text-[12.5px]">
            <div>
              <div className="mb-1 font-mono text-[11px] text-muted-foreground uppercase">pipeline (Python ≥3.12, uv)</div>
              <p className="text-ink-2">pandas, pyarrow, networkx, numpy, scipy</p>
            </div>
            <div>
              <div className="mb-1 font-mono text-[11px] text-muted-foreground uppercase">server (Bun)</div>
              <p className="text-ink-2">hono, hyparquet (чтение parquet), d3-force (раскладка графа)</p>
            </div>
            <div>
              <div className="mb-1 font-mono text-[11px] text-muted-foreground uppercase">client (bun workspace)</div>
              <p className="text-ink-2">
                React 19, React Router 8, Vite, TypeScript, Tailwind CSS v4, shadcn/ui (Base UI), lucide-react, canvas 2D для схемы сети
              </p>
            </div>
          </div>
        </Panel>

        <Panel eyebrow="воспроизводимость" title="Одна команда, детерминированно">
          <div className="grid gap-3 text-[12.5px]">
            <pre className="rounded-md border bg-panel-2 p-2.5 font-mono text-[12px] break-all whitespace-pre-wrap text-ink-2">
              uv run python run.py --data ../task/data --out ../out
            </pre>
            <p className="text-ink-2">
              Без LLM и без сети: только pandas/networkx на локальных parquet. Louvain запускается с фиксированным{' '}
              <code className="font-mono">seed=42</code>, посредничество считается точно (без выборки). Одни и те же входные parquet всегда дают
              одни и те же {num(stats.nodes)} строк <code className="font-mono">nodes_roles.csv</code>.
            </p>
            <p className="text-muted-foreground">
              Время прогона печатается пайплайном в конце каждого запуска (<code className="font-mono">time.perf_counter()</code> в run.py); в
              репозитории оно не зафиксировано как число.
            </p>
          </div>
        </Panel>

        <Panel eyebrow="границы" title="Чего система не делает">
          <ul className="grid gap-2 text-[12.5px] text-ink-2">
            <li className="flex gap-2">
              <HypTag>гипотезы</HypTag>
              <span>Роли и кластеры — предположения для проверки аналитиком, не утверждения о виновности.</span>
            </li>
            <li>— Не использует внешние данные: только исходящие внутрибанковские переводы {num(stats.seeds)} seed-клиентов на 4 колена из выгрузки организаторов.</li>
            <li>— Louvain на кластерах неориентированный: кто в кластере собирает, а кто раздаёт — вопрос интерпретации по составу, не самого разбиения.</li>
            <li>
              — {num(stats.byDepth[4] ?? 0)} узлов на 4-м колене без исходящих — обрыв обхода выгрузкой, а не признак «конечного получателя»; пайплайн
              размечает их отдельно (<code className="font-mono">truncated</code>).
            </li>
            <li>— У seed-клиентов входящие переводы недостоверны (обход шёл только от них), масштаб оценивается по исходящим.</li>
            <li>— В данных виден только порог 5 000 ₸ и переводы внутри одного банка — переводы мимо него в графе не появятся.</li>
          </ul>
        </Panel>
      </div>
    </>
  )
}
