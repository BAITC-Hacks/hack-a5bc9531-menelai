import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeftIcon, ArrowUpRightIcon, CheckIcon, MinusIcon } from 'lucide-react'
import { api, type Edge, type Graph, type LaidOutNode, type Meta, type Metrics, type NodeDetails, type Stats, type TopRow } from '@/lib/api'
import { dec, gidTail, kzt, kztShort, num, pct } from '@/lib/format'
import { ROLE } from '@/lib/roles'
import './ReviewWorkspace.css'

type Props = { top: TopRow[]; graph: Graph; meta: Meta; stats: Stats }
type NodeMap = Map<string, LaidOutNode>
type Check = { rule: string; fact: string; passed: boolean | null }
type FlowRow = { gid: string; sum: number; count: number; rest?: number }

/** The queue and the diagram use the same selected gid, including neighbour navigation. */
export default function ReviewWorkspace({ top, graph, meta, stats }: Props) {
  const [trail, setTrail] = useState<string[]>(() => top[0] ? [top[0].gid] : [])
  const selected = trail.at(-1)
  const selectedRow = top.find(row => row.gid === selected)
  const nodes = useMemo(() => new Map(graph.nodes.map(node => [node.gid, node])), [graph.nodes])
  const step = (gid: string) => setTrail(current => {
    const seen = current.indexOf(gid)
    return seen < 0 ? [...current, gid] : current.slice(0, seen + 1)
  })

  return (
    <div className="review-workspace">
      {top.length === 0 ? <p className="rw-empty">Очередь проверки пуста.</p> : (
        <div className="rw-workbench">
          <ol className="rw-queue" aria-label="Клиенты по приоритету проверки">
            {top.map(row => (
              <li key={row.gid}>
                <button type="button" className="rw-queue-item" aria-label={`№ ${row.rank}, ${ROLE[row.role].label}, ID ${row.gid}`} aria-pressed={selected === row.gid} onClick={() => setTrail([row.gid])} title={`ID ${row.gid}`}>
                  <span className="rw-rank">{num(row.rank).padStart(2, '0')}</span>
                  <span className="rw-queue-title">
                    <RoleDot node={nodes.get(row.gid)} />
                    <span>{ROLE[row.role].label}</span>
                    <span className="rw-tail">{gidTail(row.gid)}</span>
                  </span>
                  <span className="rw-queue-summary">Вход {kztShort(row.inKzt)}{nodes.has(row.gid) && <> · {num(nodes.get(row.gid)!.inDeg)} плат. · {num(nodes.get(row.gid)!.outDeg)} получ.</>}</span>
                  <span className="rw-queue-meta">Приоритет {dec(row.priorityScore)}{row.isSeed && ' · seed'}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="rw-detail">
            <nav className="rw-trail" aria-label="История просмотра клиентов">
              {trail.length > 1 && <button className="rw-back" type="button" onClick={() => setTrail(current => current.slice(0, -1))}><ArrowLeftIcon size={13} aria-hidden />Назад</button>}
              <span>Цепочка:</span>
              {trail.map((gid, index) => (
                <button type="button" key={`${gid}-${index}`} className="rw-trail-item" title={`ID ${gid}`} aria-current={gid === selected ? 'location' : undefined} onClick={() => setTrail(current => current.slice(0, index + 1))}>
                  <RoleDot node={nodes.get(gid)} />
                  <span className="rw-tail">{gidTail(gid)}</span>
                </button>
              ))}
            </nav>
            {selected && <SelectedClient key={`${stats.datasetId}:${selected}`} gid={selected} nodes={nodes} meta={meta} stats={stats} rank={selectedRow?.rank} why={selectedRow?.why} onSelect={step} />}
          </div>
        </div>
      )}
    </div>
  )
}

function RoleDot({ node }: { node?: LaidOutNode }) {
  return <span className="rw-role-dot" style={{ background: node?.role ? ROLE[node.role].color : 'var(--role-peripheral)' }} aria-hidden />
}

function SelectedClient({ gid, nodes, meta, stats, rank, why, onSelect }: { gid: string; nodes: NodeMap; meta: Meta; stats: Stats; rank?: number; why?: string; onSelect: (gid: string) => void }) {
  const [result, setResult] = useState<{ nodes: NodeMap; meta: Meta; stats: Stats; data?: NodeDetails; error?: string } | null>(null)
  const current = result?.nodes === nodes && result?.meta === meta && result?.stats === stats ? result : null
  const data = current?.data
  const error = current?.error
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    api.node(gid).then(value => { if (active) setResult({ nodes, meta, stats, data: value }) }).catch((cause: unknown) => {
      if (active) setResult({ nodes, meta, stats, error: cause instanceof Error ? cause.message : String(cause) })
    })
    return () => { active = false }
  }, [gid, attempt, nodes, meta, stats])

  if (error) return (
    <div className="rw-load" role="alert">
      <p>Не удалось загрузить переводы клиента.</p>
      <button type="button" className="rw-back" onClick={() => { setResult(null); setAttempt(value => value + 1) }}>Повторить загрузку</button>
      <details><summary>Подробности ошибки</summary><p>{error}</p></details>
    </div>
  )
  if (!data) return <div className="rw-load" role="status">Загружаем переводы клиента…</div>
  return (
    <>
      <FlowDiagram data={data} nodes={nodes} stats={stats} rank={rank} onSelect={onSelect} />
      {data.metrics ? <Reasons data={data} m={data.metrics} nodes={nodes} meta={meta} stats={stats} why={why} /> : (
        <div className="rw-reasons"><p>Роль и приоритет для этого клиента пока не рассчитаны.</p><Link className="rw-open" to={`/nodes/${gid}`}>Открыть досье клиента <ArrowUpRightIcon size={15} aria-hidden /></Link></div>
      )}
    </>
  )
}

function flowRows(edges: Edge[], direction: 'in' | 'out'): FlowRow[] {
  const all = edges.toSorted((a, b) => b.sumKzt - a.sumKzt)
  const shown: FlowRow[] = all.slice(0, 7).map(edge => ({ gid: direction === 'in' ? edge.src : edge.dst, sum: edge.sumKzt, count: edge.nTx }))
  const rest = all.slice(7)
  if (rest.length) shown.push({ gid: '', sum: rest.reduce((sum, edge) => sum + edge.sumKzt, 0), count: rest.reduce((sum, edge) => sum + edge.nTx, 0), rest: rest.length })
  return shown
}

function FlowDiagram({ data, nodes, stats, rank, onSelect }: { data: NodeDetails; nodes: NodeMap; stats: Stats; rank?: number; onSelect: (gid: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const observer = new ResizeObserver(entries => setWidth(Math.max(760, Math.floor(entries[0].contentRect.width))))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const { node, metrics: m } = data
  const left = flowRows(data.in, 'in'), right = flowRows(data.out, 'out')
  const rows = Math.max(left.length, right.length, 3)
  const cardHeight = 64, pitch = 76, height = rows * pitch - (pitch - cardHeight)
  const cardWidth = Math.min(225, Math.round(width * .26)), centerWidth = Math.min(232, Math.round(width * .27))
  const centerX = (width - centerWidth) / 2, centerHeight = 190, centerY = (height - centerHeight) / 2
  const top = (index: number, count: number) => (height - (count * pitch - (pitch - cardHeight))) / 2 + index * pitch
  const maxSum = Math.max(1, ...left.map(row => row.sum), ...right.map(row => row.sum))
  const color = m ? ROLE[m.role].color : 'var(--role-peripheral)'
  const truncated = m?.truncated ?? (node.depth === stats.maxDepth && data.out.length === 0)
  const incoming = data.in.reduce((sum, edge) => sum + edge.sumKzt, 0)
  const outgoing = data.out.reduce((sum, edge) => sum + edge.sumKzt, 0)

  const drawSide = (list: FlowRow[], side: 'in' | 'out') => list.map((row, index) => {
    const counterpart = nodes.get(row.gid)
    const lineColor = counterpart?.role ? ROLE[counterpart.role].color : 'var(--role-peripheral)'
    const x1 = side === 'in' ? cardWidth + 2 : centerX + centerWidth + 2
    const x2 = side === 'in' ? centerX - 2 : width - cardWidth - 2
    const cy = centerY + centerHeight * (index + .5) / list.length
    const y1 = side === 'in' ? top(index, list.length) + cardHeight / 2 : cy
    const y2 = side === 'in' ? cy : top(index, list.length) + cardHeight / 2
    const mid = (x1 + x2) / 2
    const path = `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`
    return (
      <g key={`${side}-${row.gid || 'rest'}`}>
        <path d={path} fill="none" stroke={lineColor} strokeOpacity={row.rest ? .25 : .4} strokeWidth={1.5 + 10 * Math.sqrt(row.sum / maxSum)} strokeLinecap="round" strokeDasharray={row.rest ? '4 5' : undefined} />
        <path d={`M${x2 - 7},${y2 - 4} L${x2},${y2} L${x2 - 7},${y2 + 4}`} fill="none" stroke={lineColor} strokeWidth={1.5} />
        {!row.rest && <circle className="rw-flow-dot" r={2.6} fill="#d49a1a"><animateMotion dur="2.6s" begin={`-${index * .37}s`} repeatCount="indefinite" path={path} /></circle>}
      </g>
    )
  })
  const cards = (list: FlowRow[], side: 'in' | 'out') => list.map((row, index) => {
    const counterpart = nodes.get(row.gid)
    const title = counterpart?.role ? ROLE[counterpart.role].label : 'Клиент'
    const contents = <>
      <span className="rw-counterparty-title"><RoleDot node={counterpart} /><span>{row.rest ? `Ещё ${num(row.rest)} контрагентов` : title}</span>{counterpart?.isSeed && <span className="rw-seed">seed</span>}</span>
      <span className="rw-counterparty-amount"><strong title={kzt(row.sum)}>{kztShort(row.sum)}</strong><span>{num(row.count)} пер.</span></span>
      <span className="rw-counterparty-id">{row.rest ? 'Все связи — в досье' : gidTail(row.gid)}</span>
    </>
    const style = { top: top(index, list.length), width: cardWidth, height: cardHeight, [side === 'in' ? 'left' : 'right']: 0 }
    return row.rest
      ? <div key={`${side}-rest`} className="rw-counterparty rw-rest" style={style}>{contents}</div>
      : <button type="button" key={`${side}-${row.gid}`} className="rw-counterparty" style={style} title={`${title} · ID ${row.gid}\n${kzt(row.sum)} · ${num(row.count)} переводов`} onClick={() => onSelect(row.gid)} aria-label={`Перейти к клиенту ${row.gid}, ${title}, ${kzt(row.sum)}`}>{contents}</button>
  })

  return (
    <div className="rw-flow-section">
      <p className="rw-mobile-hint">Схему можно прокрутить в сторону →</p>
      <div className="rw-flow-scroll" ref={scrollRef} tabIndex={0} role="region" aria-label="Схема плательщиков и получателей; на узком экране прокрутите по горизонтали">
        <div style={{ width }}>
          <div className="rw-flow-head" style={{ gridTemplateColumns: `${cardWidth}px 1fr ${cardWidth}px` }}><span>Плательщики · {num(data.in.length)}</span><span>движение средств →</span><span>Получатели · {truncated ? 'неизвестно' : num(data.out.length)}</span></div>
          <div className="rw-diagram" style={{ height }}>
            <svg width={width} height={height} aria-hidden className="rw-connectors">{drawSide(left, 'in')}{drawSide(right, 'out')}</svg>
            {cards(left, 'in')}{cards(right, 'out')}
            {!left.length && <div className="rw-no-edges" style={{ left: 0, width: cardWidth, top: height / 2 - 40 }}>{node.isSeed ? 'Вход seed неполон: выгрузка строилась от него наружу.' : 'Входящих переводов в выгрузке нет.'}</div>}
            {!right.length && <div className="rw-no-edges" style={{ right: 0, width: cardWidth, top: height / 2 - 40 }}>{truncated ? `Исходящие не запрашивались: последний шаг обхода — ${num(stats.maxDepth)}.` : 'Исходящих переводов в выгрузке нет. Это не остаток на счёте.'}</div>}
            <div className="rw-selected" style={{ left: centerX, top: centerY, width: centerWidth, height: centerHeight, borderColor: color }} title={`ID ${node.gid}`}>
              <span className="rw-selected-role"><RoleDot node={nodes.get(node.gid)} />{m ? ROLE[m.role].label : 'Роль не рассчитана'}</span>
              <span className="rw-selected-id">ID {gidTail(node.gid)} {node.isSeed && <span className="rw-seed">· seed</span>}</span>
              <div className="rw-selected-amounts"><span>поступило <strong title={kzt(incoming)}>{kztShort(incoming)}</strong></span><span>списано <strong title={truncated ? undefined : kzt(outgoing)}>{truncated ? 'неизвестно' : kztShort(outgoing)}</strong></span></div>
              <span className="rw-selected-rank">{rank ? `№ ${rank} в очереди проверки` : 'Контрагент выбранного клиента'}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="rw-legend"><span>Толщина линии — сумма переводов</span><span>Нажмите на контрагента, чтобы перейти к нему</span></div>
    </div>
  )
}

/** Mirrors pipeline/run.py roles(), with thresholds taken from the current /meta. */
function checksFor(m: Metrics, data: NodeDetails, nodes: NodeMap, t: Meta['thresholds']): Check[] {
  const check = (rule: string, fact: string, passed: boolean | null): Check => ({ rule, fact, passed })
  const threshold = (key: string, format = num) => t[key] == null ? 'не опубликован' : format(t[key])
  const ge = (key: string, value: number) => t[key] == null ? null : value >= t[key]
  const lt = (key: string, value: number | null) => t[key] == null || value == null ? null : value < t[key]
  const pass = m.is_seed ? 'не применимо к seed' : m.truncated ? 'неизвестно' : pct(m.pass_through)
  switch (m.role) {
    case 'coordinator': {
      const seedToSeed = m.is_seed && data.in.some(edge => nodes.get(edge.src)?.isSeed)
      return [
        check(`Плательщиков ≥ ${threshold('coord_in_deg')}`, num(m.in_deg), ge('coord_in_deg', m.in_deg)),
        check(`Получателей ≥ ${threshold('coord_out_deg')}`, num(m.out_deg), ge('coord_out_deg', m.out_deg)),
        check(`Посредничество ≥ ${threshold('coord_betw_thr', value => dec(value, 6))}`, dec(m.betweenness, 6), ge('coord_betw_thr', m.betweenness)),
        check(`Цикл, ≥ ${threshold('coord_seed_up')} seed выше или перевод seed → seed`, `${num(m.n_seed_upstream)} seed${m.in_cycle ? ' · цикл' : ''}${seedToSeed ? ' · seed → seed' : ''}`, m.in_cycle || seedToSeed || ge('coord_seed_up', m.n_seed_upstream)),
      ]
    }
    case 'consolidator': {
      const maxPayer = m.in_kzt > 0 ? Math.max(0, ...data.in.map(edge => edge.sumKzt)) / m.in_kzt : null
      return [
        check(`Плательщиков ≥ ${threshold('cons_in_deg')}`, num(m.in_deg), ge('cons_in_deg', m.in_deg)),
        check(`Поступило ≥ ${threshold('cons_in_kzt', kztShort)}`, kztShort(m.in_kzt), ge('cons_in_kzt', m.in_kzt)),
        check(`Выход / вход < ${threshold('cons_pass_max', pct)}`, pass, m.is_seed || m.truncated ? null : lt('cons_pass_max', m.pass_through)),
        check(`Доля крупнейшего плательщика < ${threshold('cons_max_payer', pct)}`, pct(maxPayer), lt('cons_max_payer', maxPayer)),
      ]
    }
    case 'distributor': return [
      check(`Получателей ≥ ${threshold('dist_out_deg')}`, num(m.out_deg), ge('dist_out_deg', m.out_deg)),
      check(`Получателей ≥ ${threshold('dist_ratio')} × плательщиков`, `${num(m.out_deg)} / ${num(m.in_deg)}`, t.dist_ratio == null ? null : m.out_deg >= t.dist_ratio * m.in_deg),
    ]
    case 'transit': return [
      check('Есть входящие и исходящие', `${num(m.in_deg)} / ${num(m.out_deg)}`, m.in_deg >= 1 && m.out_deg >= 1),
      check(`Выход / вход от ${threshold('tr_pass_lo', pct)} до ${threshold('tr_pass_hi', pct)}`, pass, m.pass_through == null || t.tr_pass_lo == null || t.tr_pass_hi == null ? null : m.pass_through >= t.tr_pass_lo && m.pass_through <= t.tr_pass_hi),
      check(`Поступило ≥ ${threshold('tr_in_kzt', kztShort)}`, kztShort(m.in_kzt), ge('tr_in_kzt', m.in_kzt)),
      check(`За ${threshold('fast_days')} дня выведено ≥ ${threshold('tr_fast_min', pct)}`, pct(m.fast_out_share), m.fast_out_share == null ? null : ge('tr_fast_min', m.fast_out_share)),
      check('Клиент не входит в исходный список seed', m.is_seed ? 'seed' : 'не seed', !m.is_seed),
    ]
    case 'terminal': return [
      check('Правило: шаги 1–3, исходящие наблюдались', `колено ${num(m.depth)}`, [1, 2, 3].includes(m.depth) && !m.truncated),
      check(`Нет исходящих или выход / вход < ${threshold('term_pass_max', pct)}`, m.out_deg === 0 ? 'нет исходящих' : pass, m.out_deg === 0 || lt('term_pass_max', m.pass_through)),
      check(`Поступило ≥ ${threshold('term_in_kzt', kztShort)}`, kztShort(m.in_kzt), ge('term_in_kzt', m.in_kzt)),
      check('Клиент не входит в исходный список seed', m.is_seed ? 'seed' : 'не seed', !m.is_seed),
    ]
    case 'peripheral': return []
  }
}

function Reasons({ m, data, nodes, meta, stats, why }: { m: Metrics; data: NodeDetails; nodes: NodeMap; meta: Meta; stats: Stats; why?: string }) {
  const checks = checksFor(m, data, nodes, meta.thresholds)
  const noData = m.truncated || (m.is_seed && m.in_deg === 0 && m.out_deg === 0)
  const period = stats.period?.map(date => date.split('-').reverse().join('.')).join('–')
  const facts = [
    `Вход в выгрузке: ${kzt(m.in_kzt)}, ${num(m.in_tx)} переводов от ${num(m.in_deg)} плательщиков.`,
    m.truncated ? `Исходящие на последнем шаге обхода (${num(stats.maxDepth)}) не выгружались.` : `Выход в выгрузке: ${kzt(m.out_kzt)}, ${num(m.out_tx)} переводов к ${num(m.out_deg)} получателям.`,
    `Выше по потоку — ${num(m.n_seed_upstream)} seed.`,
  ]
  if (!m.is_seed) facts.push(`Расчётная доля средств seed во входе — ${pct(m.seed_share)}.`)
  if (m.in_cycle) facts.push(`Есть круговой маршрут в пределах ${num(meta.thresholds.cycle_len)} шагов.`)
  if (m.sync_in_events > 0) facts.push(`Дней с поступлениями от ${num(meta.thresholds.sync_payers)} и более плательщиков: ${num(m.sync_in_events)}.`)

  return (
    <div className="rw-reasons">
      <div className="rw-evidence">
        <h3>{noData ? 'Недостаточно данных для определения роли' : `Гипотеза: ${ROLE[m.role].sign}`}</h3>
        <p className="rw-evidence-text">{m.evidence}</p>
        {why && <details className="rw-priority-reason"><summary>Почему клиент в очереди</summary><p>{why}</p></details>}
        <ul>{facts.map(fact => <li key={fact}>{fact}</li>)}</ul>
        {m.is_seed && <p className="rw-warning">Seed — клиент из исходного списка. Его вход неполон: выгрузка строилась от seed наружу. Отношение выхода ко входу для него не интерпретируется.</p>}
        {m.truncated && <p className="rw-warning">Отсутствие исходящих здесь — граница выгрузки. Оно не означает, что средства остались у клиента.</p>}
        {m.weak_seed_link && <p className="rw-warning">Связь со средствами seed слабая ({pct(m.seed_share)} входа). Структура переводов сама по себе не подтверждает причастность.</p>}
        <p className="rw-caveat">Показаны внутрибанковские переводы{period ? ` за ${period}` : '; период в выгрузке не определён'}.{stats.minTxKzt != null && <> Минимальная сумма в выгрузке — {kzt(stats.minTxKzt)}.</>} Вывод — гипотеза для проверки.</p>
      </div>
      <div className="rw-rule-card">
        <h4>Правило и факты</h4>
        {checks.length ? <ul className="rw-checks">{checks.map(check => (
          <li key={check.rule}>
            <span className={`rw-check-mark ${check.passed === true ? 'rw-pass' : ''}`} aria-label={check.passed === true ? 'Условие выполнено' : check.passed === false ? 'Условие не выполнено' : 'Недостаточно данных'}>{check.passed === true ? <CheckIcon size={12} aria-hidden /> : <MinusIcon size={12} aria-hidden />}</span>
            <span>{check.rule}</span><strong>{check.fact}</strong>
          </li>
        ))}</ul> : <p className="rw-rule-note">{noData ? 'Для роли недостаточно наблюдаемых переводов. Оценка правила отражает отсутствие данных, а не низкий риск.' : 'Ни одно правило каскада не сработало. Это не исключает значимость клиента для проверки.'}</p>}
        <p className="rw-rule-meta">Приоритет {dec(m.priority_score)} из 1 · оценка по правилу {dec(m.role_score)} · группа №{m.cluster_id}</p>
        <span className="rw-full-id">ID {data.node.gid}</span>
        <Link className="rw-open" to={`/nodes/${data.node.gid}`}>Открыть досье клиента <ArrowUpRightIcon size={15} aria-hidden /></Link>
        <Link className="rw-network-link" to={`/graph?q=${data.node.gid}`}>Показать в полной сети →</Link>
      </div>
    </div>
  )
}
