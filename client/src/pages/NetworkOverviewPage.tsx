import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ArrowRightIcon, NetworkIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GidLink, LoadState, RoleDot, RoleStackBar, Segmented } from '@/components/kit'
import { api, ROLES, type Cluster, type Graph, type LaidOutNode, type Role } from '@/lib/api'
import { dec, kztShort, num } from '@/lib/format'
import { ROLE } from '@/lib/roles'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

type Group = Cluster & { members: LaidOutNode[]; role: Role; x: number; y: number; r: number }
type Flow = { src: number; dst: number; sum: number; count: number }
type Sort = 'nodes' | 'amount' | 'seeds'

// The colour describes the existing pipeline hypothesis; it does not assign a new role.
function hypothesisRole(hypothesis: string): Role {
  if (/координирующего/.test(hypothesis)) return 'coordinator'
  if (/веерной/.test(hypothesis)) return 'distributor'
  if (/консолидации/.test(hypothesis)) return 'consolidator'
  if (/конечных/.test(hypothesis)) return 'terminal'
  if (/транзитной/.test(hypothesis)) return 'transit'
  return 'peripheral'
}

const shortHypothesis = (group: Cluster) => group.hypothesis.split('. ')[0]
const groupColor = (group: Group) => group.role === 'peripheral' ? '#b8b8b0' : ROLE[group.role].color
const LEGEND: { role: Role; label: string }[] = [
  { role: 'coordinator', label: 'координирующее ядро' },
  { role: 'consolidator', label: 'аккумулирование' },
  { role: 'distributor', label: 'веерная раздача' },
  { role: 'transit', label: 'транзитная цепочка' },
  { role: 'terminal', label: 'конечные получатели' },
  { role: 'peripheral', label: 'без выраженной роли' },
]

function buildGroups(graph: Graph, clusters: Cluster[]) {
  const byGid = new Map(graph.nodes.map((node) => [node.gid, node]))
  const members = new Map<number, LaidOutNode[]>()
  for (const node of graph.nodes) {
    if (node.cluster == null) continue
    const list = members.get(node.cluster) ?? []
    list.push(node)
    members.set(node.cluster, list)
  }
  const groups: Group[] = clusters.map((cluster) => {
    const nodes = (members.get(cluster.clusterId) ?? []).sort((a, b) => (b.priority ?? -1) - (a.priority ?? -1))
    return {
      ...cluster,
      members: nodes,
      role: hypothesisRole(cluster.hypothesis),
      x: nodes.reduce((sum, node) => sum + node.x, 0) / Math.max(1, nodes.length),
      y: nodes.reduce((sum, node) => sum + node.y, 0) / Math.max(1, nodes.length),
      r: 4 + 2.2 * Math.sqrt(cluster.nNodes),
    }
  })
  const flowMap = new Map<string, Flow>()
  for (const edge of graph.edges) {
    const src = byGid.get(edge.src)?.cluster
    const dst = byGid.get(edge.dst)?.cluster
    if (src == null || dst == null || src === dst) continue
    const key = `${src}>${dst}`
    const flow = flowMap.get(key) ?? { src, dst, sum: 0, count: 0 }
    flow.sum += edge.sumKzt
    flow.count += edge.nTx
    flowMap.set(key, flow)
  }

  // Start from client-layout centroids, then separate overlapping circles.
  // Both membership and geometry come from the live graph, with no saved group coordinates.
  const mapped = groups.filter((group) => group.nNodes > 1).map((group) => ({ ...group }))
  if (mapped.length) {
    const x0 = Math.min(...mapped.map((group) => group.x)), x1 = Math.max(...mapped.map((group) => group.x))
    const y0 = Math.min(...mapped.map((group) => group.y)), y1 = Math.max(...mapped.map((group) => group.y))
    for (const group of mapped) {
      group.x = ((group.x - x0) / Math.max(1, x1 - x0) - 0.5) * 600
      group.y = ((group.y - y0) / Math.max(1, y1 - y0) - 0.5) * 430
    }
    for (let step = 0; step < 120; step++) {
      for (let i = 0; i < mapped.length; i++) {
        for (let j = i + 1; j < mapped.length; j++) {
          const a = mapped[i], b = mapped[j]
          let dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy)
          const required = a.r + b.r + 7
          if (distance >= required) continue
          if (distance < 0.001) {
            const angle = (i + j + 1) * 2.399963
            dx = Math.cos(angle); dy = Math.sin(angle); distance = 1
          }
          const push = (required - distance) * 0.51
          a.x -= dx / distance * push; a.y -= dy / distance * push
          b.x += dx / distance * push; b.y += dy / distance * push
        }
      }
    }
  }
  return { groups, mapped, flows: [...flowMap.values()] }
}

export default function NetworkOverviewPage() {
  const graph = useApi(api.graph)
  const clusters = useApi(api.clusters)
  const model = useMemo(() => graph.data && clusters.data ? buildGroups(graph.data, clusters.data) : null, [graph.data, clusters.data])
  if (!model) return <LoadState error={graph.error ?? clusters.error} reload={() => { graph.reload(); clusters.reload() }} label="Загрузка карты групп…" />
  return <NetworkOverview model={model} />
}

function NetworkOverview({ model }: { model: ReturnType<typeof buildGroups> }) {
  const [params, setParams] = useSearchParams()
  const [sort, setSort] = useState<Sort>('nodes')
  const mapSection = useRef<HTMLElement>(null)
  const focusMapAfterRender = useRef(false)
  useLayoutEffect(() => {
    if (!focusMapAfterRender.current) return
    mapSection.current?.focus({ preventScroll: true })
    focusMapAfterRender.current = false
  })
  const raw = params.get('cluster')
  const selectedId = raw != null && /^\d+$/.test(raw) ? Number(raw) : null
  const selected = model.groups.find((group) => group.clusterId === selectedId) ?? null
  const isolated = model.groups.filter((group) => group.nNodes === 1)
  const rows = [...model.groups].sort((a, b) => sort === 'amount'
    ? b.sumKztInternal - a.sumKztInternal
    : sort === 'seeds' ? b.nSeed - a.nSeed || b.nNodes - a.nNodes : b.nNodes - a.nNodes)
  const select = (id: number | null, scroll = false) => {
    if (scroll || id == null) focusMapAfterRender.current = true
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (id == null) next.delete('cluster')
      else next.set('cluster', String(id))
      return next
    }, { replace: true })
    if (scroll) mapSection.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid max-w-[780px] gap-2">
          <h1 className="font-heading text-[28px] leading-tight font-bold tracking-tight">Карта сети</h1>
          <p className="text-[15px] leading-relaxed text-ink-2">
            {num(model.mapped.length)} групп связанных клиентов. Размер круга — число клиентов, цвет — гипотеза о назначении группы, линии — переводы между группами.
          </p>
        </div>
        <Link to="/graph" className="inline-flex min-h-10 items-center gap-2 rounded-lg border bg-card px-3 text-sm font-medium hover:border-gold">
          <NetworkIcon className="size-4" aria-hidden />Клиенты и связи
        </Link>
      </header>

      <section ref={mapSection} id="network-map" tabIndex={-1} aria-label={selected ? `Карта групп. Выбрана группа ${selected.clusterId}` : 'Карта групп'} className="grid min-w-0 overflow-hidden rounded-[14px] border bg-card outline-none lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 bg-[#fcfcfb]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 text-xs text-ink-2" aria-label="Легенда гипотез">
            {LEGEND.map(({ role, label }) => (
              <span key={role} className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-full" style={{ background: role === 'peripheral' ? '#b8b8b0' : ROLE[role].color }} />{label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full border-2 border-foreground bg-card" />есть исходные клиенты</span>
          </div>
          <GroupMap groups={model.mapped} flows={model.flows} selectedId={selected?.clusterId ?? null} onSelect={select} />
          <p className="border-t px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            Группировка Louvain не учитывает направление переводов. Направления сохранены в межгрупповых потоках.
            {isolated.length > 0 && <> Ещё {num(isolated.length)} одиночных групп доступны в таблице ниже.</>}
          </p>
        </div>

        <aside aria-label="Выбранная группа" className="grid max-h-[760px] min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4 overflow-y-auto border-t p-[18px] lg:border-t-0 lg:border-l">
          {selected ? (
            <GroupDetails group={selected} groups={model.groups} flows={model.flows} onSelect={select} onClose={() => select(null)} />
          ) : (
            <div className="grid gap-2 text-sm leading-relaxed text-ink-2">
              <h2 className="text-base font-semibold text-foreground">{selectedId == null ? 'Выберите группу на карте' : 'Группа не найдена'}</h2>
              <p>{selectedId == null ? 'Откроются её состав, ключевые клиенты и потоки в другие группы. Одиночную группу можно выбрать в таблице.' : 'Выберите другую группу на карте или в таблице ниже.'}</p>
            </div>
          )}
        </aside>
      </section>

      <section aria-labelledby="network-groups-heading" className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="network-groups-heading" className="text-xl font-semibold">Все группы <span className="ml-1 font-mono text-sm font-normal text-muted-foreground">{num(rows.length)}</span></h2>
          <Segmented value={sort} onChange={setSort} options={[
            { value: 'nodes', label: 'По размеру' }, { value: 'amount', label: 'По обороту' }, { value: 'seeds', label: 'По исходным клиентам' },
          ]} />
        </div>
        <div className="max-h-[560px] overflow-auto rounded-[14px] border bg-card">
          <table className="w-full min-w-[820px] text-left text-[13px]">
            <caption className="sr-only">Все группы, включая одиночные. Выберите номер, чтобы открыть состав и связи.</caption>
            <thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground">
              <tr className="border-b">
                <th scope="col" className="px-4 py-3 font-medium">Группа</th>
                <th scope="col" className="px-3 py-3 font-medium">Клиентов</th>
                <th scope="col" className="px-3 py-3 font-medium">Исходных</th>
                <th scope="col" className="px-3 py-3 font-medium">Внутренний оборот</th>
                <th scope="col" className="min-w-36 px-3 py-3 font-medium">Состав</th>
                <th scope="col" className="min-w-64 px-4 py-3 font-medium">Гипотеза</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((group) => (
                <tr key={group.clusterId} className={cn('border-t transition-colors hover:bg-muted/60', selected?.clusterId === group.clusterId && 'bg-[#eef4f5]')}>
                  <th scope="row" className="px-4 py-2 font-normal">
                    <button type="button" onClick={() => select(group.clusterId, true)} aria-pressed={selected?.clusterId === group.clusterId} className="min-h-9 rounded px-1 text-sm font-semibold underline decoration-border underline-offset-4 hover:text-gold">
                      #{group.clusterId}
                    </button>
                  </th>
                  <td className="px-3 py-3 font-mono">{num(group.nNodes)}</td>
                  <td className={cn('px-3 py-3 font-mono', group.nSeed ? 'text-seed' : 'text-muted-foreground')}>{num(group.nSeed)}</td>
                  <td className="px-3 py-3 font-mono whitespace-nowrap">{kztShort(group.sumKztInternal)}</td>
                  <td className="px-3 py-3"><RoleStackBar counts={group.roles} /></td>
                  <td className="px-4 py-3 leading-relaxed text-ink-2">
                    {shortHypothesis(group)}
                    {group.nNodes === 1 && <span className="mt-1 block text-xs text-muted-foreground">Одиночная группа · не показана кругом на карте</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function GroupMap({ groups, flows, selectedId, onSelect }: { groups: Group[]; flows: Flow[]; selectedId: number | null; onSelect: (id: number | null) => void }) {
  const stage = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 800, height: 600 })
  useEffect(() => {
    const measure = () => {
      const node = stage.current
      if (node) setSize({ width: node.clientWidth, height: node.clientHeight })
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (stage.current) observer.observe(stage.current)
    return () => observer.disconnect()
  }, [])

  const pad = 24, { width, height } = size
  const x0 = Math.min(...groups.map((group) => group.x - group.r)), x1 = Math.max(...groups.map((group) => group.x + group.r))
  const y0 = Math.min(...groups.map((group) => group.y - group.r)), y1 = Math.max(...groups.map((group) => group.y + group.r))
  const scale = Math.min((width - pad * 2) / Math.max(1, x1 - x0), (height - pad * 2) / Math.max(1, y1 - y0))
  const ox = (width - (x1 - x0) * scale) / 2 - x0 * scale, oy = (height - (y1 - y0) * scale) / 2 - y0 * scale
  const positions = new Map(groups.map((group) => [group.clusterId, { x: group.x * scale + ox, y: group.y * scale + oy, r: Math.max(5, group.r * scale) }]))
  const maxFlow = Math.max(1, ...flows.map((flow) => flow.sum))
  const visibleFlows = flows.filter((flow) => positions.has(flow.src) && positions.has(flow.dst) && (selectedId == null ? flow.sum >= maxFlow * 0.02 : flow.src === selectedId || flow.dst === selectedId))
  const linked = new Set<number>()
  if (selectedId != null) for (const flow of flows) {
    if (flow.src === selectedId) linked.add(flow.dst)
    if (flow.dst === selectedId) linked.add(flow.src)
  }

  return (
    <>
      <div ref={stage} className="relative h-[500px] min-w-0 overflow-hidden sm:h-[600px]">
        {groups.length ? (
          <>
            <svg width={width} height={height} className="pointer-events-none absolute inset-0" aria-hidden>
              {visibleFlows.map((flow) => {
                const a = positions.get(flow.src)!, b = positions.get(flow.dst)!
                const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1
                const ux = dx / length, uy = dy / length
                const sx = a.x + ux * a.r, sy = a.y + uy * a.r, ex = b.x - ux * (b.r + 3), ey = b.y - uy * (b.r + 3)
                const mx = (sx + ex) / 2 - uy * length * 0.12, my = (sy + ey) / 2 + ux * length * 0.12
                const angle = Math.atan2(ey - my, ex - mx)
                const color = selectedId == null ? '#9a9aa2' : flow.src === selectedId ? '#d08a00' : '#3987e5'
                return (
                  <g key={`${flow.src}>${flow.dst}`}>
                    <path d={`M${sx},${sy} Q${mx},${my} ${ex},${ey}`} fill="none" stroke={color} strokeOpacity={selectedId == null ? 0.35 : 0.75} strokeWidth={0.8 + 6 * Math.sqrt(flow.sum / maxFlow)} strokeLinecap="round" />
                    {selectedId != null && <path d={`M${ex - Math.cos(angle - 0.5) * 8},${ey - Math.sin(angle - 0.5) * 8} L${ex},${ey} L${ex - Math.cos(angle + 0.5) * 8},${ey - Math.sin(angle + 0.5) * 8}`} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" />}
                  </g>
                )
              })}
            </svg>
            {groups.map((group) => {
              const position = positions.get(group.clusterId)!
              const chosen = selectedId === group.clusterId
              const faded = selectedId != null && !chosen && !linked.has(group.clusterId)
              return (
                <button key={group.clusterId} type="button" onClick={() => onSelect(chosen ? null : group.clusterId)} aria-pressed={chosen}
                  aria-label={`Группа ${group.clusterId}: ${num(group.nNodes)} клиентов, исходных ${num(group.nSeed)}`}
                  title={`Группа #${group.clusterId}: ${num(group.nNodes)} клиентов, исходных ${num(group.nSeed)}`}
                  className="absolute grid place-items-center rounded-full p-0 text-[11px] font-semibold text-white transition-opacity hover:brightness-110 focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                  style={{ left: position.x - position.r, top: position.y - position.r, width: position.r * 2, height: position.r * 2, background: groupColor(group), opacity: faded ? 0.25 : 1, border: chosen ? '3px solid #18181b' : group.nSeed ? '2px solid #18181b' : '2px solid #ffffff' }}>
                  {position.r >= 11 ? group.clusterId : ''}
                </button>
              )
            })}
          </>
        ) : <p className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground">Нет групп из нескольких клиентов. Все доступные группы приведены в таблице.</p>}
      </div>
      <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-3 text-xs text-muted-foreground">
        <span>Показано {num(visibleFlows.length)} межгрупповых направлений{selectedId == null && ' · выберите группу, чтобы увидеть все её связи'}</span>
        {selectedId != null && <>
          <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[#d08a00]" />исходящие</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[#3987e5]" />входящие</span>
        </>}
      </div>
    </>
  )
}

function GroupDetails({ group, groups, flows, onSelect, onClose }: { group: Group; groups: Group[]; flows: Flow[]; onSelect: (id: number) => void; onClose: () => void }) {
  const byId = new Map(groups.map((item) => [item.clusterId, item]))
  const directions = [
    { label: 'Получает от групп', arrow: '←', flows: flows.filter((flow) => flow.dst === group.clusterId).sort((a, b) => b.sum - a.sum), peer: (flow: Flow) => flow.src },
    { label: 'Переводит в группы', arrow: '→', flows: flows.filter((flow) => flow.src === group.clusterId).sort((a, b) => b.sum - a.sum), peer: (flow: Flow) => flow.dst },
  ]
  return (
    <>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="grid min-w-0 gap-1">
          <h2 className="text-xl font-semibold">Группа #{group.clusterId}</h2>
          <p className="text-[13px] leading-relaxed text-muted-foreground">{num(group.nNodes)} клиентов · исходных {num(group.nSeed)} · внутренний оборот {kztShort(group.sumKztInternal)}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть группу"><XIcon /></Button>
      </div>
      <p className="text-sm leading-relaxed text-ink-2">{shortHypothesis(group)}</p>
      {group.nNodes === 1 && <p className="rounded-lg border bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">Одиночная группа сохранена в результатах. Для проверки доступных данных откройте карточку клиента.</p>}
      <div className="grid min-w-0 gap-2">
        <RoleStackBar counts={group.roles} className="h-2.5" />
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-ink-2">
          {ROLES.filter((role) => group.roles[role]).map((role) => <span key={role} className="inline-flex items-center gap-1.5"><RoleDot role={role} className="size-2" />{ROLE[role].label} {num(group.roles[role]!)}</span>)}
        </div>
      </div>
      <div className="grid min-w-0 gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Ключевые клиенты</h3>
        <p className="text-xs text-muted-foreground">По приоритету проверки · до 8 клиентов</p>
        <ul className="grid min-w-0">
          {group.members.slice(0, 8).map((node) => <li key={node.gid} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-1 py-2 hover:bg-muted/60">
            {node.role && <RoleDot role={node.role} className="size-2" />}
            <GidLink gid={node.gid} short className="text-xs" />
            {node.isSeed && <span className="text-[10px] font-semibold text-seed">seed</span>}
            <span className="ml-auto font-mono text-xs" title="Приоритет проверки">{dec(node.priority)}</span>
            <span className="w-full pl-4 text-xs text-muted-foreground">{node.role ? ROLE[node.role].label : 'Роль не рассчитана'}</span>
          </li>)}
        </ul>
      </div>
      {directions.map((direction) => direction.flows.length > 0 && <div key={direction.label} className="grid min-w-0 gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{direction.label}</h3>
        <ul className="grid min-w-0">
          {direction.flows.slice(0, 5).map((flow) => {
            const id = direction.peer(flow), peer = byId.get(id)
            return <li key={id}><button type="button" onClick={() => onSelect(id)} className="flex min-h-10 w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-1 py-2 text-left text-[13px] hover:bg-muted/60">
              <span aria-hidden className="text-muted-foreground">{direction.arrow}</span>
              {peer && <span className="size-2 shrink-0 rounded-full" style={{ background: groupColor(peer) }} />}
              <span>Группа #{id}</span><span className="ml-auto font-mono text-xs">{kztShort(flow.sum)}</span>
              <span className="w-full pl-4 text-xs text-muted-foreground">{num(flow.count)} переводов</span>
            </button></li>
          })}
        </ul>
        {direction.flows.length > 5 && <p className="text-xs text-muted-foreground">Показаны 5 крупнейших из {num(direction.flows.length)} направлений</p>}
      </div>)}
      {directions.every((direction) => direction.flows.length === 0) && <p className="text-xs text-muted-foreground">Межгрупповых переводов в выгрузке нет.</p>}
      <Button variant="outline" className="min-h-10" nativeButton={false} render={<Link to={`/graph?cluster=${group.clusterId}`} />}>
        Открыть клиентов группы <ArrowRightIcon aria-hidden />
      </Button>
    </>
  )
}
