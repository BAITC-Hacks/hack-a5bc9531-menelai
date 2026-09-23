import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, CopyIcon, WaypointsIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Eyebrow, GidLink, HypTag, LoadState, PageHeader, Panel, PriorityBar, RoleChip, SeedTag, StatStrip } from '@/components/kit'
import { ROLE } from '@/lib/roles'
import { api, type Edge, type Gid, type Link as MoneyLink, type Meta, type Metrics } from '@/lib/api'
import { dayMonth, dec, gidTail, kzt, num, pct } from '@/lib/format'
import { useApi } from '@/lib/use-api'

// key={gid}: a new gid remounts the card, so useApi refetches and stale data never shows.
export default function NodePage() {
  const { gid = '' } = useParams()
  const meta = useApi(api.meta).data // fetched once, survives neighbour hops
  return (
    <>
      <Link to="/top" className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md text-sm text-ink-2 hover:text-gold focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        <ArrowLeftIcon className="size-4" aria-hidden /> К приоритетам
      </Link>
      <NodeCard key={gid} gid={gid} meta={meta ?? undefined} />
    </>
  )
}

function NodeCard({ gid, meta }: { gid: Gid; meta?: Meta }) {
  const { data, error, reload } = useApi(() => api.node(gid), [gid])
  // The server answers 404 with {error: "unknown gid …"}; api.get rethrows that text.
  if (error?.startsWith('unknown gid')) return <NotFound gid={gid} />
  if (!data) return <LoadState error={error} reload={reload} />

  const { node, metrics: m } = data
  return (
    <>
      <PageHeader
        eyebrow={
          <>
            досье клиента · колено {node.depth}
            {m && (
              <>
                {' · '}
                <Link to={`/clusters#cluster-${m.cluster_id}`} className="underline decoration-dotted underline-offset-4 hover:text-gold">
                  группа №{m.cluster_id}
                </Link>
              </>
            )}
          </>
        }
        title={<>Клиент <span className="font-mono tracking-normal">{gidTail(gid)}</span></>}
        lede={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="w-full font-mono text-[13px] break-all text-muted-foreground">ID {gid}</span>
            {m && <RoleChip role={m.role} className="text-[13px]" />}
            {node.isSeed && <SeedTag />}
            {m && (
              <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
                приоритет <PriorityBar value={m.priority_score} />
              </span>
            )}
          </span>
        }
        aside={<HeaderActions gid={gid} />}
      />

      {m ? (
        <div className="grid min-w-0 gap-6">
          <StatStrip items={[
            { value: kzt(m.in_kzt), label: m.is_seed ? 'поступило · вход неполон' : 'поступило' },
            { value: kzt(m.out_kzt), label: m.truncated ? 'исходящие не собирались' : 'переведено дальше' },
            { value: num(m.in_deg), label: 'плательщиков' },
            { value: num(m.out_deg), label: 'получателей в выгрузке' },
            { value: num(m.in_tx) + ' / ' + num(m.out_tx), label: 'переводов · вход / выход' },
            { value: num(m.n_seed_upstream), label: 'исходных клиентов выше по цепочке' },
          ]} />
          <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <WhyPanel m={m} meta={meta} />
            <aside className="grid min-w-0 content-start gap-4">
              <Warnings m={m} />
              <MetricGrid m={m} t={meta?.thresholds} />
            </aside>
          </div>
          <Movement m={m} gid={gid} />
          <EdgeLists inEdges={data.in} outEdges={data.out} />
          <Features m={m} />
        </div>
      ) : (
        <>
          <Panel eyebrow="расчёт ещё не выполнен" title="Роль и метрики не посчитаны">
            <p className="text-sm text-ink-2">
              Запустите <code className="font-mono">pipeline/run.py</code>, чтобы появилась папка <code className="font-mono">out/</code>. Ниже —
              сырые рёбра узла.
            </p>
          </Panel>
          <EdgeLists inEdges={data.in} outEdges={data.out} />
        </>
      )}
    </>
  )
}

function HeaderActions({ gid }: { gid: Gid }) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const copy = async () => {
    setCopyFailed(false)
    try {
      await navigator.clipboard.writeText(gid)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
      setCopyFailed(true)
    }
  }
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="min-h-11" nativeButton={false} render={<Link to={`/graph?q=${gid}`} />}>
          <WaypointsIcon aria-hidden /> Показать на схеме
        </Button>
        <Button variant="outline" className="min-h-11" onClick={copy} aria-live="polite">
          {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />} {copied ? 'Скопировано' : 'Скопировать ID'}
        </Button>
      </div>
      {copyFailed && <p role="status" className="max-w-sm text-xs text-ink-2">Не удалось скопировать. Выделите ID в заголовке и скопируйте вручную.</p>}
    </div>
  )
}

function NotFound({ gid }: { gid: Gid }) {
  const tail = gid.replace(/\D/g, '').slice(-10)
  return (
    <>
      <PageHeader
        eyebrow="досье клиента · не найден"
        title="Узел не найден"
        lede={
          <>
            Узла <span className="font-mono text-foreground">{gid}</span> нет в активной выгрузке. Если известен только хвост номера,
            введите его в поиск вверху — хвост ищется по совпадению окончания на схеме сети.
          </>
        }
      />
      {tail && (
        <div>
          <Button variant="outline" nativeButton={false} render={<Link to={`/graph?q=${tail}`} />}>
            Искать хвост {gidTail(tail)} на схеме
          </Button>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- «Почему эта роль»

type Row = { rule: string; key?: string; fmt?: (x: number) => string; fact: ReactNode }

const deg = (x: number) => num(x)
const pass = (x: number) => dec(x)
const betw = (x: number) => dec(x, 5)

/** Rule ↔ fact rows per role: threshold keys mirror pipeline/run.py `T`, rule wording — RULES.md §1. No verdicts here. */
function ruleRows(m: Metrics, t?: Record<string, number>): Row[] {
  const passFact = m.is_seed || m.truncated ? passThroughDisplay(m) : m.pass_through == null ? 'н/д (вход 0)' : pass(m.pass_through)
  const tv = (key: string) => (t?.[key] == null ? '…' : num(t[key]))
  switch (m.role) {
    case 'coordinator':
      return [
        { rule: 'плательщиков ≥', key: 'coord_in_deg', fmt: deg, fact: num(m.in_deg) },
        { rule: 'получателей ≥', key: 'coord_out_deg', fmt: deg, fact: num(m.out_deg) },
        {
          rule: 'seed выше по потоку ≥ (или цикл, или seed ← seed)',
          key: 'coord_seed_up',
          fmt: deg,
          fact: `${num(m.n_seed_upstream)}${m.in_cycle ? ' · цикл' : ''}`,
        },
        { rule: 'посредничество ≥ p95', key: 'coord_betw_thr', fmt: betw, fact: betw(m.betweenness) },
        { rule: 'оборот (больший из входа и выхода) ≥', key: 'coord_min_kzt', fmt: kzt, fact: kzt(Math.max(m.in_kzt, m.out_kzt)) },
      ]
    case 'consolidator':
      return [
        { rule: 'плательщиков ≥', key: 'cons_in_deg', fmt: deg, fact: num(m.in_deg) },
        { rule: 'пропуск <', key: 'cons_pass_max', fmt: pass, fact: passFact },
        { rule: 'вход ≥', key: 'cons_in_kzt', fmt: kzt, fact: kzt(m.in_kzt) },
        {
          rule: 'доля крупнейшего плательщика <',
          key: 'cons_max_payer',
          fmt: pct,
          fact: m.max_payer_share == null ? 'н/д' : pct(m.max_payer_share),
        },
      ]
    case 'distributor':
      return [
        { rule: 'получателей ≥', key: 'dist_out_deg', fmt: deg, fact: num(m.out_deg) },
        { rule: 'получателей ≥ k × плательщиков, k =', key: 'dist_ratio', fmt: deg, fact: `${num(m.out_deg)} получ. / ${num(m.in_deg)} плат.` },
      ]
    case 'transit':
      return [
        { rule: 'пропуск от', key: 'tr_pass_lo', fmt: pass, fact: passFact },
        { rule: 'пропуск до', key: 'tr_pass_hi', fmt: pass, fact: passFact },
        { rule: 'вход ≥', key: 'tr_in_kzt', fmt: kzt, fact: kzt(m.in_kzt) },
        { rule: `вывод ≤ ${tv('fast_days')} дн. после входа ≥`, key: 'tr_fast_min', fmt: pct, fact: pct(m.fast_out_share) },
      ]
    case 'terminal':
      return [
        { rule: `колено 1–${t?.max_depth == null ? '…' : num(t.max_depth - 1)} (исходящие выгружались)`, fact: `колено ${m.depth}` },
        { rule: 'пропуск < (или выхода нет)', key: 'term_pass_max', fmt: pass, fact: passFact },
        { rule: 'вход ≥', key: 'term_in_kzt', fmt: kzt, fact: kzt(m.in_kzt) },
      ]
    case 'peripheral':
      return []
  }
}

function peripheralNote(m: Metrics, meta?: Meta) {
  if (m.truncated) return `Недостаточно данных: узел на колене ${m.depth}, исходящие не собирались — обход оборван. Периферия здесь не означает отсутствие риска.`
  if (m.is_seed && m.in_deg === 0 && m.out_deg === 0) return 'Недостаточно данных: seed без единого ребра в графе. Определить роль по этой выгрузке нельзя; периферия не означает отсутствие риска.'
  const weak = meta != null && m.seed_share < meta.thresholds.weak_seed_share
  const w = meta && (meta.role_weight.peripheral + meta.peripheral_near_bonus * m.near_share) * (weak ? meta.weak_seed_priority_mult : 1)
  const near =
    m.nearest_role && m.nearest_role !== 'peripheral'
      ? ` Ближайшая роль — ${ROLE[m.nearest_role].label}: выполнено ${pct(m.near_share)} её условий.` +
        (meta && w != null
          ? ` Вес в приоритете: (${dec(meta.role_weight.peripheral)} + ${dec(meta.peripheral_near_bonus)} × ${dec(m.near_share)})` +
            (weak ? ` × ${dec(meta.weak_seed_priority_mult)} (seed-денег ${pct(m.seed_share)})` : '') +
            ` = ${dec(w)}.`
          : '')
      : ''
  return `Ни одно правило каскада (координатор → консолидатор → распределитель → транзит → конечный) не сработало. Уверенность в «периферии» тем ниже, чем ближе узел к какой-то роли.${near}`
}

/** Wraps numbers in the verbatim evidence string so they stand out; the text itself is untouched. */
function Evidence({ text }: { text: string }) {
  const parts = text.split(/(\d+(?:[\s ]\d{3})*(?:[.,]\d+)?(?:\s?%)?)/)
  return (
    <p className="text-[14px] leading-relaxed text-ink-2">
      {parts.map((p, i) =>
        i % 2 ? (
          <span key={i} className="font-mono font-medium text-foreground tnum">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </p>
  )
}

function WhyPanel({ m, meta, className }: { m: Metrics; meta?: Meta; className?: string }) {
  const thresholds = meta?.thresholds
  const rows = ruleRows(m, thresholds)
  const insufficientData = m.role === 'peripheral' && (m.truncated || (m.is_seed && m.in_deg === 0 && m.out_deg === 0))
  return (
    <section className={`min-w-0 overflow-hidden rounded-xl border border-l-4 bg-card ${className ?? ''}`} style={{ borderLeftColor: ROLE[m.role].color }}>
      <div className="grid gap-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-2">
            <Eyebrow>почему эта роль</Eyebrow>
            <h2 className="text-xl font-semibold">
              {insufficientData ? 'Недостаточно данных для определения роли' : `Гипотеза: ${ROLE[m.role].sign}`}
            </h2>
            <div>
              <HypTag>{insufficientData ? 'данные ограничены' : 'гипотеза'}</HypTag>
            </div>
          </div>
          <div className="grid min-w-44 gap-1.5">
            <span className="text-xs text-muted-foreground">Оценка по правилу</span>
            <span className="flex items-center gap-3">
              <span className="relative h-2 w-32 overflow-hidden rounded-full bg-panel-2 ring-1 ring-border">
                <span
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${Math.max(2, m.role_score * 100)}%`, background: ROLE[m.role].color }}
                />
              </span>
              <span className="font-mono text-2xl font-medium tnum">{dec(m.role_score)}</span>
            </span>
          </div>
        </div>

        <div className="grid gap-1.5">
          <Eyebrow>Основания роли</Eyebrow>
          <Evidence text={m.evidence} />
        </div>

        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <caption className="sr-only">Правило роли и значения метрик узла</caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    условие правила «{ROLE[m.role].label}»
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    порог
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    факт узла
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const t = r.key ? thresholds?.[r.key] : undefined
                  return (
                    <tr key={r.rule} className="h-9 border-b last:border-b-0">
                      <th scope="row" className="py-2 pr-4 text-left font-normal text-ink-2">
                        {r.rule}
                      </th>
                      <td className="py-2 pr-4 text-right font-mono whitespace-nowrap text-muted-foreground tnum">
                        {r.key ? (t == null ? '…' : r.fmt!(t)) : '—'}
                      </td>
                      <td className="py-2 text-right font-mono font-medium whitespace-nowrap tnum">{r.fact}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-ink-2">{peripheralNote(m, meta)}</p>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- data caveats

function Warnings({ m }: { m: Metrics }) {
  const notes: string[] = []
  if (m.is_seed)
    notes.push('Seed: входящие занижены устройством выгрузки (граф строился от seed наружу) — отношение выход/вход и пропуск недостоверны.')
  if (m.truncated) notes.push(`Колено ${m.depth} без исходящих: обход оборван на этом колене, «нет исходящих» ничего не значит.`)
  else if (!m.is_seed && m.depth >= 1 && m.out_deg === 0)
    notes.push(`Колено ${m.depth} без исходящих: исходящие выгружались и их нет — сток в наблюдаемом графе. Остаток на счёте по этим данным неизвестен.`)
  if (m.weak_seed_link)
    notes.push(
      `Слабая связь с деньгами seed: доля seed-денег ${pct(m.seed_share)} — роль по структуре, но «окраска» денег низкая; возможен легальный контрагент (магазин, работодатель).`,
    )
  if (!notes.length) return null
  return (
    <section className="grid gap-2 rounded-xl border border-l-4 border-l-gold bg-card p-4" aria-label="Предупреждения о данных">
      <Eyebrow>оговорки о данных</Eyebrow>
      {notes.map((n) => (
        <p key={n} className="text-[13px] text-ink-2">
          {n}
        </p>
      ))}
    </section>
  )
}

// ---------------------------------------------------------------- money movement

function FlowRow({ link, max, side }: { link: MoneyLink; max: number; side: 'in' | 'out' }) {
  const width = Math.max(3, (link.sum_kzt / max) * 100) + '%'
  return (
    <li className="min-w-0">
      <Link to={'/nodes/' + link.gid} title={'Клиент ' + link.gid} className="group grid min-w-0 gap-2 rounded-xl border bg-card p-3 transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[13px] font-medium">{gidTail(link.gid)}</span>
          <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden />
        </span>
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-sm tnum">{kzt(link.sum_kzt)}</span>
          <span className="text-xs text-muted-foreground">{num(link.n_tx)} пер.</span>
        </span>
        <span className="h-1.5 overflow-hidden rounded-full bg-panel-2">
          <span className={'block h-full rounded-full ' + (side === 'in' ? 'bg-role-consolidator/70' : 'bg-role-terminal/70')} style={{ width }} />
        </span>
      </Link>
    </li>
  )
}

function passThroughDisplay(m: Metrics) {
  if (m.is_seed) return 'недостоверно для seed'
  if (m.truncated) return 'неизвестно'
  return dec(m.pass_through)
}

function Movement({ m, gid, className }: { m: Metrics; gid: Gid; className?: string }) {
  const max = Math.max(1, ...m.top_in.map((l) => l.sum_kzt), ...m.top_out.map((l) => l.sum_kzt))
  const side = (links: MoneyLink[], s: 'in' | 'out', label: string, total: number) => (
    <div className="grid content-start gap-3">
      <div className={`text-xs text-muted-foreground ${s === 'in' ? 'md:text-right' : ''}`}>
        {label} · топ {links.length} из {num(total)}
      </div>
      {links.length ? (
        <ul className="grid gap-3">
          {links.map((l) => (
            <FlowRow key={l.gid} link={l} max={max} side={s} />
          ))}
        </ul>
      ) : (
        <p className={`text-[13px] text-muted-foreground ${s === 'in' ? 'md:text-right' : ''}`}>{s === 'out' && m.truncated ? 'Исходящие не собирались' : 'нет'}</p>
      )}
    </div>
  )
  return (
    <Panel eyebrow="движение денег" title="Движение средств" className={className}>
      <div className="grid gap-6">
        <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(180px,220px)_minmax(0,1fr)]">
          {side(m.top_in, 'in', 'крупнейшие плательщики', m.in_deg)}
          <div className="grid justify-items-center gap-3 rounded-2xl border-2 bg-card px-4 py-6 text-center" style={{ borderColor: ROLE[m.role].color }}>
            <span className="text-xs text-muted-foreground">поступления → клиент → переводы</span>
            <span className="font-mono text-[13px] font-medium tnum">{gidTail(gid)}</span>
            <RoleChip role={m.role} />
          </div>
          {side(m.top_out, 'out', 'крупнейшие получатели', m.out_deg)}
        </div>
        <StatStrip
          items={[
            { value: kzt(m.in_kzt), label: `вход · ${num(m.in_tx)} переводов` },
            { value: kzt(m.out_kzt), label: m.truncated ? 'выход · исходящие не собирались' : `выход · ${num(m.out_tx)} переводов` },
            {
              value: m.is_seed || m.truncated ? <span className="font-sans text-sm font-medium">{passThroughDisplay(m)}</span> : passThroughDisplay(m),
              label: 'пропуск = выход / вход',
            },
          ]}
        />
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------- metrics & features

function MetricGrid({ m, t }: { m: Metrics; t?: Record<string, number> }) {
  const days = t?.fast_days == null ? '…' : num(t.fast_days)
  const hops = t?.seed_up_hops == null ? '…' : num(t.seed_up_hops)
  // Tooltips quote pipeline/RULES.md §0.
  const tiles: [string, string, string][] = [
    ['плательщиков', num(m.in_deg), 'in_deg: от скольких разных клиентов получил'],
    ['получателей', num(m.out_deg), 'out_deg: скольким разным клиентам отправил'],
    ['переводов вход', num(m.in_tx), 'in_tx: число входящих переводов'],
    ['переводов выход', num(m.out_tx), 'out_tx: число исходящих переводов'],
    ['пропуск', passThroughDisplay(m), 'pass_through = out_kzt / in_kzt — доля полученного, ушедшая дальше (н/д, если вход 0)'],
    ['доля seed-денег', pct(m.seed_share), 'seed_share: модель «окрашенных денег» — доля средств, предположительно пришедших от seed (пропорциональное смешивание; невидимый вход считается «чистым»)'],
    ['seed-деньги на входе', kzt(m.seed_money_in), 'seed_money_in: сумма средств, предположительно пришедших от seed, ₸'],
    ['seed выше по потоку', num(m.n_seed_upstream), `n_seed_upstream: сколько разных seed достигают узла по направленным путям ≤ ${hops} шага`],
    ['посредничество', dec(m.betweenness, 5), 'betweenness: посредничество в направленном графе (без весов)'],
    ['PageRank', dec(m.pagerank, 5), 'pagerank: взвешенный по сумме переводов'],
    [`быстрый выход ≤ ${days} дн.`, pct(m.fast_out_share), `fast_out_share: доля исходящей суммы, ушедшей в течение ≤ ${days} дн. после входящего перевода`],
    ['дней синхронных входов', num(m.sync_in_events), 'sync_in_events: число дней, когда ≥ 3 разных плательщиков перевели узлу в один день'],
    ['участие в цикле', m.in_cycle ? 'да' : 'нет', 'in_cycle: участвует в простом цикле длиной ≤ 5'],
  ]
  return (
    <Panel eyebrow="метрики узла" bodyClassName="p-0">
      <dl className="grid grid-cols-2 gap-px bg-border">
        {tiles.map(([label, value, hint]) => (
          <div key={label} title={hint} className={`grid cursor-help gap-1 bg-card px-4 py-3 last:odd:col-span-2 ${label === 'пропуск' && (m.is_seed || m.truncated) ? 'col-span-2' : ''}`}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-mono text-[15px] font-medium wrap-anywhere tnum">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}

function Features({ m }: { m: Metrics }) {
  const shown = m.cycles.slice(0, 5)
  return (
    <Panel eyebrow="временные и структурные признаки" title="Дополнительные основания">
      <div className="grid gap-5 md:grid-cols-2">
        <div className="grid gap-2">
          <h3 className="text-[13px] font-medium">Циклы ≤ 5 шагов</h3>
          {shown.length ? (
            <ul className="grid gap-2">
              {shown.map((c) => (
                <li key={c.join('>')} className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
                  {[...c, c[0]].map((g, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5">
                      {i > 0 && <span aria-label="переводит">→</span>}
                      <GidLink gid={g} short />
                    </span>
                  ))}
                </li>
              ))}
              {m.cycles.length > 5 && <li className="text-xs text-muted-foreground">ещё {m.cycles.length - 5}</li>}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">не найдено</p>
          )}
        </div>
        <div className="grid gap-2">
          <h3 className="text-[13px] font-medium">Дни синхронных входов (≥ 3 плательщиков в день)</h3>
          {m.sync_days.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {m.sync_days.map((d) => (
                <li key={d} title={d} className="rounded-md border bg-panel-2 px-1.5 py-0.5 font-mono text-xs tnum">
                  {dayMonth(d)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">нет</p>
          )}
        </div>
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------- full edge lists

function EdgeTable({ title, edges, peer }: { title: string; edges: Edge[]; peer: 'src' | 'dst' }) {
  const rows = [...edges].sort((a, b) => b.sumKzt - a.sumKzt)
  const table = (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              {peer === 'src' ? 'плательщик' : 'получатель'}
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              сумма
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              переводов
            </th>
            <th scope="col" className="py-2 text-right font-medium" title="edges.depth: на каком колене обхода найден перевод (колено отправителя + 1)">
              колено ребра
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e[peer]} className="h-9 border-b last:border-b-0 hover:bg-panel-2/60">
              <td className="py-1.5 pr-4">
                <GidLink gid={e[peer]} />
              </td>
              <td className="py-1.5 pr-4 text-right font-mono whitespace-nowrap tnum">{kzt(e.sumKzt)}</td>
              <td className="py-1.5 pr-4 text-right font-mono tnum">{num(e.nTx)}</td>
              <td className="py-1.5 text-right font-mono tnum">{e.depth}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  return (
    <Panel eyebrow={`${title} · ${num(rows.length)}`}>
      {!rows.length ? (
        <p className="text-[13px] text-muted-foreground">нет рёбер</p>
      ) : rows.length > 10 ? (
        <details>
          <summary className="cursor-pointer rounded-md text-[13px] text-ink-2 hover:text-foreground">
            Показать все {num(rows.length)} (по убыванию суммы)
          </summary>
          <div className="mt-3">{table}</div>
        </details>
      ) : (
        table
      )}
    </Panel>
  )
}

function EdgeLists({ inEdges, outEdges, className }: { inEdges: Edge[]; outEdges: Edge[]; className?: string }) {
  return (
    <div className={`grid content-start gap-6 xl:grid-cols-2 ${className ?? ''}`}>
      <EdgeTable title="входящие" edges={inEdges} peer="src" />
      <EdgeTable title="исходящие" edges={outEdges} peer="dst" />
    </div>
  )
}
