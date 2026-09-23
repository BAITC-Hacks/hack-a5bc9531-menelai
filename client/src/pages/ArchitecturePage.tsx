import { Link } from 'react-router'
import { ArrowRightIcon, FileDownIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HypTag, LoadState, PageHeader, Panel } from '@/components/kit'
import { api, CSV_FILES } from '@/lib/api'
import { kzt, num, plural } from '@/lib/format'
import { useApi } from '@/lib/use-api'

const STAGES = [
  { title: 'Загрузка выписки', text: 'Клиенты, пары плательщик → получатель и отдельные переводы. Суммы по парам сверяются с транзакциями.' },
  { title: 'Профиль клиента', text: 'Поступления и переводы, контрагенты, пропуск, скорость выхода средств и позиция посредника.' },
  { title: 'Связь с исходными клиентами', text: 'Направленные пути с ограничением числа шагов и модель пропорционального смешивания средств.' },
  { title: 'Роль и приоритет', text: 'Каскад явных правил определяет роль. Рассчитанный приоритет задаёт очередь проверки.' },
  { title: 'Группы и паттерны', text: 'Louvain, направленные циклы, повторяющиеся маршруты и синхронные поступления.' },
  { title: 'Очередь и отчёты', text: 'Основания по каждому клиенту, связи, досье и три обязательные выгрузки CSV.' },
]

const EXPORTS = {
  'nodes_roles.csv': { label: 'Роли всех клиентов', text: 'ID, роль, оценка правила, кластер, приоритет и численные основания.' },
  'clusters.csv': { label: 'Группы клиентов', text: 'Размер, исходные клиенты, внутренний оборот, ключевые ID и гипотеза.' },
  'top_nodes.csv': { label: 'Очередь проверки', text: 'Ранг, ID, роль, приоритет и объяснение места в очереди.' },
}

export default function ArchitecturePage() {
  const { data: stats, error, reload } = useApi(api.stats)
  if (!stats) return <LoadState error={error} reload={reload} />

  return (
    <>
      <PageHeader
        eyebrow="методика · устройство решения"
        title="Как проходит расчёт"
        lede="От исходных переводов до объяснимой очереди проверки. Роли, кластеры и приоритет рассчитываются пайплайном; интерфейс показывает результаты активной выгрузки."
        aside={<Button variant="outline" className="min-h-11" nativeButton={false} render={<Link to="/method/rules" />}>Правила ролей <ArrowRightIcon aria-hidden /></Button>}
      />

      <ol className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {STAGES.map((stage, i) => (
          <li key={stage.title} className="grid min-w-0 content-start gap-3 rounded-2xl border bg-card p-5">
            <span className="font-mono text-xs font-medium text-primary tnum">{String(i + 1).padStart(2, '0')}</span>
            <h2 className="text-base font-semibold">{stage.title}</h2>
            <p className="text-sm leading-relaxed text-ink-2">{stage.text}</p>
          </li>
        ))}
      </ol>

      <Panel title="Что получается на выходе" eyebrow="воспроизводимый результат">
        <p className="mb-4 text-sm text-ink-2">{num(stats.nodes)} клиентов, {num(stats.edges)} связей, {num(stats.transactions)} переводов. CSV доступны отдельно для дальнейшей работы аналитика.</p>
        <div className="grid min-w-0 gap-3 md:grid-cols-3">
          {CSV_FILES.map(file => (
            <a key={file} href={api.exportUrl(file)} download className="group grid min-w-0 gap-2 rounded-xl border bg-panel-2/40 p-4 transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <span className="flex items-center justify-between gap-3 text-sm font-semibold">{EXPORTS[file].label}<FileDownIcon className="size-4 shrink-0 text-primary" aria-hidden /></span>
              <span className="text-xs leading-relaxed text-ink-2">{EXPORTS[file].text}</span>
              <span className="mt-1 font-mono text-xs text-muted-foreground">{file}</span>
            </a>
          ))}
        </div>
      </Panel>

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
        <Panel title="Локальный пересчёт демонабора" eyebrow="одна команда">
          <div className="grid gap-3 text-sm leading-relaxed text-ink-2">
            <p>Расчёт использует исходные parquet. LLM, внешние данные и платные сервисы для него не нужны.</p>
            <pre className="overflow-x-auto rounded-lg border bg-panel-2 p-3 font-mono text-xs break-words whitespace-pre-wrap text-foreground">cd pipeline &amp;&amp; uv run python run.py --data ../task/data --out ../out</pre>
            <p>Одинаковые входные данные дают одинаковые результаты: начальное значение Louvain фиксировано, посредничество считается без выборки. Пайплайн сохраняет обязательные CSV и подробные метрики в JSON и CSV.</p>
            <p className="text-xs text-muted-foreground">Время полного расчёта печатается после каждого запуска. Требование кейса — не более 5 минут на предоставленных данных.</p>
          </div>
        </Panel>
        <Panel title="Роль AI-ассистента" eyebrow="объяснение результатов">
          <div className="grid gap-3 text-sm leading-relaxed text-ink-2">
            <p>Ассистент через OpenAI Responses API выбирает инструменты сервера и формулирует ответ по их результатам. Роли, пороги, приоритет и числа в выгрузках рассчитываются независимо от LLM.</p>
            <p>Детерминированные инструменты анализа доступны и без ключа LLM.</p>
            <Link to="/assistant" className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md font-medium text-primary">Открыть ассистента <ArrowRightIcon className="size-4" aria-hidden /></Link>
          </div>
        </Panel>
      </div>

      <details className="group min-w-0 rounded-2xl border bg-card p-5">
        <summary className="cursor-pointer rounded-sm text-base font-semibold">Технологии и движение данных</summary>
        <div className="mt-5 grid min-w-0 gap-5 text-sm leading-relaxed md:grid-cols-3">
          <div className="grid content-start gap-2">
            <h2 className="font-semibold">Пайплайн · Python и uv</h2>
            <p className="text-ink-2">pandas, pyarrow, networkx, numpy, scipy. Читает три parquet, считает метрики, роли, кластеры и приоритет, создаёт выгрузки.</p>
          </div>
          <div className="grid content-start gap-2">
            <h2 className="font-semibold">Сервер · Bun и Hono</h2>
            <p className="text-ink-2">hyparquet читает таблицы при загрузке набора. d3-force строит раскладку графа. API отдаёт результаты, аналитические проверки и инструменты ассистента.</p>
          </div>
          <div className="grid content-start gap-2">
            <h2 className="font-semibold">Интерфейс · React 19</h2>
            <p className="text-ink-2">React Router 8, Vite, TypeScript, Tailwind CSS v4, shadcn/ui на Base UI, lucide-react и canvas 2D. Отображает данные API и связи клиентов.</p>
          </div>
        </div>
      </details>

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
        <Panel title="Границы данных" eyebrow="важно при проверке">
          <ul className="grid gap-3 text-sm leading-relaxed text-ink-2">
            <li>В наборе {num(stats.seeds)} исходных клиентов, обход охватывает {stats.maxDepth} {plural(stats.maxDepth, 'колено', 'колена', 'колен')}. Последнее колено включает {num(stats.byDepth[stats.maxDepth] ?? 0)} клиентов; отсутствие исходящих на нём отмечается как граница обхода.</li>
            <li>Входящие seed-клиентов неполны. Анализ ограничен загруженной выпиской, без внешнего обогащения.{stats.minTxKzt != null && <> Минимальный перевод в ней — {kzt(stats.minTxKzt)}.</>}</li>
            <li>Louvain использует неориентированную проекцию; направление потоков исследуется отдельно.</li>
            <li className="flex flex-wrap items-start gap-2"><HypTag /> Выводы помогают выбрать следующую проверку, не подтверждая причастность.</li>
          </ul>
        </Panel>
        <Panel title="При росте сети" eyebrow="подход для большого объёма">
          <ul className="grid gap-3 text-sm leading-relaxed text-ink-2">
            <li>Показывать фрагмент вокруг клиента или группы вместо всей сети.</li>
            <li>Готовить раскладку и агрегаты заранее, загружать данные частями.</li>
            <li>Использовать приближённое посредничество по выборке и отдельно проверять влияние приближения на приоритет.</li>
            <li>Сохранять объяснимые правила и проверять их пороги на новом распределении данных.</li>
          </ul>
        </Panel>
      </div>
    </>
  )
}
