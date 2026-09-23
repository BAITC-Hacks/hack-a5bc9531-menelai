import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { CheckIcon, CopyIcon, WaypointsIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Eyebrow, GidLink, HypTag, LoadState, PageHeader, Panel, PriorityBar, RoleChip, SeedTag, StatStrip } from '@/components/kit'
import { ROLE } from '@/lib/roles'
import { api, type Edge, type Gid, type Link as MoneyLink, type Metrics } from '@/lib/api'
import { dayMonth, dec, gidTail, kzt, num, pct } from '@/lib/format'
import { useApi } from '@/lib/use-api'

// key={gid}: a new gid remounts the card, so useApi refetches and stale data never shows.
export default function NodePage() {
  const { gid = '' } = useParams()
  const meta = useApi(api.meta).data // fetched once, survives neighbour hops
  return <NodeCard key={gid} gid={gid} thresholds={meta?.thresholds} />
}

function NodeCard({ gid, thresholds }: { gid: Gid; thresholds?: Record<string, number> }) {
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
            карточка узла · колено {node.depth}
            {m && (
              <>
                {' · '}
                <Link to={`/clusters#cluster-${m.cluster_id}`} className="underline decoration-dotted underline-offset-4 hover:text-gold">
                  кластер {m.cluster_id}
                </Link>
              </>
            )}
          </>
        }
        title={<span className="font-mono text-2xl font-semibold tracking-normal break-all tnum md:text-[34px]">{gid}</span>}
        lede={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:grid-rows-[auto_auto_1fr]">
          <WhyPanel m={m} thresholds={thresholds} className="lg:col-start-1 lg:row-start-1" />
          <aside className="grid content-start gap-6 lg:col-start-2 lg:row-span-3 lg:row-start-1">
            <Warnings m={m} />
            <MetricGrid m={m} />
            <Features m={m} />
          </aside>
          <Movement m={m} gid={gid} className="lg:col-start-1 lg:row-start-2" />
          <EdgeLists inEdges={data.in} outEdges={data.out} className="lg:col-start-1 lg:row-start-3" />
        </div>
      ) : (
        <>
          <Panel eyebrow="нет выгрузки пайплайна" title="Роль и метрики не посчитаны">
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
  const copy = () =>
    navigator.clipboard.writeText(gid).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" nativeButton={false} render={<Link to={`/graph?q=${gid}`} />}>
        <WaypointsIcon /> Показать на схеме
      </Button>
      <Button variant="outline" onClick={copy} aria-live="polite">
        {copied ? <CheckIcon /> : <CopyIcon />} {copied ? 'Скопировано' : 'Скопировать gid'}
      </Button>
    </div>
  )
}

function NotFound({ gid }: { gid: Gid }) {
  const tail = gid.replace(/\D/g, '').slice(-10)
  return (
    <>
      <PageHeader
        eyebrow="карточка узла · не найден"
        title="Узел не найден"
        lede={
          <>
            Узла <span className="font-mono text-foreground">{gid}</span> нет в графе. Полный gid — 18 цифр; если известен только хвост номера,
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
function ruleRows(m: Metrics): Row[] {
  const passFact = m.pass_through == null ? 'н/д (вход 0)' : pass(m.pass_through)
  switch (m.role) {
    case 'coordinator':
      return [
        { rule: 'плательщиков ≥', key: 'coord_in_deg', fmt: deg, fact: num(m.in_deg) },
        { rule: 'получателей ≥', key: 'coord_out_deg', fmt: deg, fact: num(m.out_deg) },
        {
          rule: 'seed выше по потоку ≥ (или цикл, или seed ← seed)',
          key: 'coord_seed_up',
          fmt: deg,
          fact: `${num(m.n_seed_upstream)}${m.in_cycle ? ' · цикл' : ''}${m.is_seed ? ' · сам seed' : ''}`,
        },
        { rule: 'посредничество ≥ p95', key: 'coord_betw_thr', fmt: betw, fact: betw(m.betweenness) },
      ]
    case 'consolidator':
      return [
        { rule: 'плательщиков ≥', key: 'cons_in_deg', fmt: deg, fact: num(m.in_deg) },
        { rule: 'пропуск <', key: 'cons_pass_max', fmt: pass, fact: passFact },
        { rule: 'вход ≥', key: 'cons_in_kzt', fmt: kzt, fact: kzt(m.in_kzt) },
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
      ]
    case 'terminal':
      return [
        { rule: 'колено 1–3 (исходящие выгружались)', fact: `колено ${m.depth}` },
        { rule: 'пропуск < (или выхода нет)', key: 'term_pass_max', fmt: pass, fact: passFact },
        { rule: 'вход ≥', key: 'term_in_kzt', fmt: kzt, fact: kzt(m.in_kzt) },
      ]
    case 'peripheral':
      return []
  }
}

function peripheralNote(m: Metrics) {
  if (m.truncated) return 'Нет данных: узел на 4-м колене, исходящие не выгружались — обход оборван (правило 0 каскада).'
  if (m.is_seed && m.in_deg === 0 && m.out_deg === 0) return 'Нет данных: seed без единого ребра в графе (правило 0 каскада).'
  return 'Ни одно правило каскада (координатор → консолидатор → распределитель → транзит → конечный) не сработало. Уверенность тем ниже, чем ближе узел к какой-то роли.'
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

function WhyPanel({ m, thresholds, className }: { m: Metrics; thresholds?: Record<string, number>; className?: string }) {
  const rows = ruleRows(m)
  return (
    <section className={`min-w-0 overflow-hidden rounded-xl border border-l-4 bg-card ${className ?? ''}`} style={{ borderLeftColor: ROLE[m.role].color }}>
      <div className="grid gap-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-2">
            <Eyebrow>почему эта роль</Eyebrow>
            <h2 className="text-xl font-semibold">
              Гипотеза: {ROLE[m.role].sign}
            </h2>
            <div>
              <HypTag />
            </div>
          </div>
          <div className="grid min-w-44 gap-1.5">
            <span className="text-xs text-muted-foreground">уверенность правила (role_score)</span>
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
          <Eyebrow>evidence пайплайна</Eyebrow>
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
          <p className="text-sm text-ink-2">{peripheralNote(m)}</p>
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
  if (m.truncated) notes.push('Колено 4 без исходящих: обход оборван на этом колене, «нет исходящих» ничего не значит.')
  else if (!m.is_seed && m.depth >= 1 && m.depth <= 3 && m.out_deg === 0)
    notes.push(`Колено ${m.depth} без исходящих: исходящие выгружались и их нет — настоящий сток.`)
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
  const w = `${Math.max(3, (link.sum_kzt / max) * 100)}%`
  const right = side === 'in'
  return (
    <li className={`grid gap-1 ${right ? 'md:justify-items-end md:text-right' : ''}`}>
      <div className={`flex flex-wrap items-baseline gap-x-3 ${right ? 'md:justify-end' : ''}`}>
        <GidLink gid={link.gid} short />
        <span className="font-mono text-[13px] tnum">{kzt(link.sum_kzt)}</span>
        <span className="font-mono text-xs text-muted-foreground tnum">{num(link.n_tx)} пер.</span>
      </div>
      <div className={`flex h-2 w-full ${right ? 'md:justify-end' : ''}`}>
        <span className={`h-full rounded-sm ${right ? 'bg-[#78beff]/55' : 'bg-gold/65'}`} style={{ width: w }} />
      </div>
    </li>
  )
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
        <p className={`text-[13px] text-muted-foreground ${s === 'in' ? 'md:text-right' : ''}`}>нет</p>
      )}
    </div>
  )
  return (
    <Panel eyebrow="движение денег" title="Откуда пришли и куда ушли деньги" className={className}>
      <div className="grid gap-6">
        <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          {side(m.top_in, 'in', 'крупнейшие плательщики', m.in_deg)}
          <div className="grid justify-items-center gap-1 rounded-xl border border-line-2 bg-panel-2 px-4 py-3 text-center">
            <span className="font-mono text-[13px] font-medium tnum">{gidTail(gid)}</span>
            <RoleChip role={m.role} />
          </div>
          {side(m.top_out, 'out', 'крупнейшие получатели', m.out_deg)}
        </div>
        <StatStrip
          items={[
            { value: kzt(m.in_kzt), label: `вход · ${num(m.in_tx)} переводов` },
            { value: kzt(m.out_kzt), label: `выход · ${num(m.out_tx)} переводов` },
            { value: m.pass_through == null ? '—' : dec(m.pass_through), label: 'пропуск = выход / вход' },
          ]}
        />
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------- metrics & features

function MetricGrid({ m }: { m: Metrics }) {
  // Tooltips quote pipeline/RULES.md §0.
  const tiles: [string, string, string][] = [
    ['плательщиков', num(m.in_deg), 'in_deg: от скольких разных клиентов получил'],
    ['получателей', num(m.out_deg), 'out_deg: скольким разным клиентам отправил'],
    ['переводов вход', num(m.in_tx), 'in_tx: число входящих переводов'],
    ['переводов выход', num(m.out_tx), 'out_tx: число исходящих переводов'],
    ['пропуск', dec(m.pass_through), 'pass_through = out_kzt / in_kzt — доля полученного, ушедшая дальше (н/д, если вход 0)'],
    ['доля seed-денег', pct(m.seed_share), 'seed_share: модель «окрашенных денег» — доля средств, предположительно пришедших от seed (пропорциональное смешивание; невидимый вход считается «чистым»)'],
    ['seed-деньги на входе', kzt(m.seed_money_in), 'seed_money_in: сумма средств, предположительно пришедших от seed, ₸'],
    ['seed выше по потоку', num(m.n_seed_upstream), 'n_seed_upstream: сколько разных seed достигают узла по направленным путям ≤ 4 шага'],
    ['посредничество', dec(m.betweenness, 5), 'betweenness: посредничество в направленном графе (без весов)'],
    ['PageRank', dec(m.pagerank, 5), 'pagerank: взвешенный по сумме переводов'],
    ['быстрый выход ≤ 2 дн.', pct(m.fast_out_share), 'fast_out_share: доля исходящей суммы, ушедшей в течение ≤ 2 дней после входящего перевода'],
    ['дней синхронных входов', num(m.sync_in_events), 'sync_in_events: число дней, когда ≥ 3 разных плательщиков перевели узлу в один день'],
    ['участие в цикле', m.in_cycle ? 'да' : 'нет', 'in_cycle: участвует в простом цикле длиной ≤ 5'],
  ]
  return (
    <Panel eyebrow="метрики узла" bodyClassName="p-0">
      <dl className="grid grid-cols-2 gap-px bg-border">
        {tiles.map(([label, value, hint]) => (
          <div key={label} title={hint} className="grid cursor-help gap-1 bg-card px-4 py-3 last:odd:col-span-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-mono text-[15px] font-medium tnum">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}

function Features({ m }: { m: Metrics }) {
  const shown = m.cycles.slice(0, 5)
  return (
    <Panel eyebrow="временные и структурные признаки">
      <div className="grid gap-5">
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
            <th scope="col" className="py-2 text-right font-medium">
              колено
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
