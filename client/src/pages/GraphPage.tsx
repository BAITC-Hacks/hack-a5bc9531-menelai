import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { SearchIcon, TriangleAlertIcon, XIcon } from 'lucide-react'
import NetworkCanvas, { type CanvasHandle, type ColorBy, type Model } from '@/components/NetworkCanvas'
import { Eyebrow, HypTag, LoadState, PageHeader, PriorityBar, RoleChip, RoleDot, SeedTag } from '@/components/kit'
import { ROLE } from '@/lib/roles'
import { Button } from '@/components/ui/button'
import { api, ROLES, type Graph, type Role } from '@/lib/api'
import { gidTail, kzt, kztShort, num } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

function buildModel(g: Graph): Model {
  const byGid = new Map(g.nodes.map((n, i) => [n.gid, i]))
  const out: number[][] = g.nodes.map(() => [])
  const inn: number[][] = g.nodes.map(() => [])
  const src = new Int32Array(g.edges.length)
  const dst = new Int32Array(g.edges.length)
  g.edges.forEach((e, i) => {
    src[i] = byGid.get(e.src)!
    dst[i] = byGid.get(e.dst)!
    out[src[i]].push(i)
    inn[dst[i]].push(i)
  })
  const sizes = new Map<number, number>()
  for (const n of g.nodes) if (n.cluster != null) sizes.set(n.cluster, (sizes.get(n.cluster) ?? 0) + 1)
  return {
    nodes: g.nodes,
    edges: g.edges,
    byGid,
    xs: Float32Array.from(g.nodes, (n) => n.x),
    ys: Float32Array.from(g.nodes, (n) => n.y),
    src,
    dst,
    out,
    inn,
    role: g.nodes.map((n) => n.role ?? 'peripheral'),
    rad: Float32Array.from(g.nodes, (n) => 1.4 + Math.min(9, Math.sqrt(n.inDeg + n.outDeg) * 0.75) + (n.isSeed ? 1 : 0)),
    labels: g.nodes
      .map((n, i) => [n.priority ?? -1, i])
      .sort((a, b) => b[0] - a[0])
      .slice(0, 10)
      .map(([, i]) => i),
    topClusters: [...sizes]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id, n]) => ({ id, n })),
  }
}

const COLOR_BY: { key: ColorBy; label: string }[] = [
  { key: 'role', label: 'Роль' },
  { key: 'depth', label: 'Колено' },
  { key: 'cluster', label: 'Кластер' },
]

export default function GraphPage() {
  const { data, error, reload } = useApi(api.graph)
  const model = useMemo(() => data && buildModel(data), [data])
  if (!model) return <LoadState error={error} reload={reload} label="Загрузка схемы сети…" />
  return <GraphView model={model} />
}

function GraphView({ model }: { model: Model }) {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const fromCanvas = (location.state as { fromCanvas?: boolean } | null)?.fromCanvas === true
  const canvas = useRef<CanvasHandle>(null)
  const [colorBy, setColorBy] = useState<ColorBy>('role')
  const [flow, setFlow] = useState(true)
  const [roles, setRoles] = useState<Set<Role>>(() => new Set(ROLES))
  const [seedOnly, setSeedOnly] = useState(false)
  const [term, setTerm] = useState('')
  const reduced = useMemo(() => matchMedia('(prefers-reduced-motion: reduce)').matches, [])

  // ?q= is a full gid or its tail (the header search sends tails here)
  const q = (params.get('q') ?? '').replace(/\D/g, '')
  const sel = useMemo(() => {
    if (!q) return null
    const exact = model.byGid.get(q)
    if (exact !== undefined) return exact
    const i = model.nodes.findIndex((n) => n.gid.endsWith(q))
    return i < 0 ? null : i
  }, [model, q])

  const clusterRaw = params.get('cluster')
  const clusterId = clusterRaw && /^\d+$/.test(clusterRaw) ? Number(clusterRaw) : null
  const clusterNodes = useMemo(
    () => (clusterId == null ? [] : model.nodes.flatMap((n, i) => (n.cluster === clusterId ? [i] : []))),
    [model, clusterId],
  )

  const active = useMemo(() => {
    const a = new Uint8Array(model.nodes.length)
    model.nodes.forEach((n, i) => {
      a[i] = roles.has(model.role[i]) && (!seedOnly || n.isSeed) && (clusterId == null || n.cluster === clusterId) ? 1 : 0
    })
    return a
  }, [model, roles, seedOnly, clusterId])

  const roleCount = useMemo(() => {
    const c = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>
    for (const r of model.role) c[r]++
    return c
  }, [model])

  // declared before the focus effect so ?q= wins when both params are present
  useEffect(() => {
    if (clusterNodes.length) canvas.current?.fit(clusterNodes)
  }, [clusterNodes])
  useEffect(() => {
    if (sel != null && !fromCanvas) canvas.current?.focus(sel)
  }, [sel, fromCanvas])

  // keeps the current location state by default so unrelated param changes don't re-zoom the selection
  const update = (fn: (p: URLSearchParams) => void, state: unknown = location.state) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        fn(next)
        return next
      },
      { replace: true, state },
    )
  const select = (i: number | null, viaCanvas = false) =>
    update((p) => (i == null ? p.delete('q') : p.set('q', model.nodes[i].gid)), viaCanvas ? { fromCanvas: true } : null)

  const onSearch = (e: FormEvent) => {
    e.preventDefault()
    const t = term.replace(/\D/g, '')
    if (t) update((p) => p.set('q', t), null)
  }
  const resetView = () => {
    update((p) => {
      p.delete('q')
      p.delete('cluster')
    })
    setTerm('')
    canvas.current?.fit()
  }
  const toggleRole = (r: Role) =>
    setRoles((prev) => {
      const next = new Set(prev)
      if (!next.delete(r)) next.add(r)
      return next
    })

  const seg = (on: boolean) =>
    cn(
      'rounded-md px-2.5 py-1 text-[13px] transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
      on ? 'bg-panel-2 font-medium text-foreground ring-1 ring-line-2' : 'text-muted-foreground hover:text-foreground',
    )

  return (
    <>
      <PageHeader
        eyebrow={`схема сети · ${num(model.nodes.length)} узлов · ${num(model.edges.length)} связей`}
        title="Схема сети"
        lede="Каждая точка — клиент, линия — переводы ≥ 5 000 ₸ от плательщика к получателю. Роли, кластеры и приоритет посчитаны пайплайном; выберите узел, чтобы увидеть его связи и основания роли."
      />

      <section className="min-w-0 overflow-hidden rounded-xl border bg-card" aria-label="Схема сети">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Eyebrow>Раскраска</Eyebrow>
            <div role="group" aria-label="Раскраска узлов" className="flex gap-0.5 rounded-lg border bg-background p-0.5">
              {COLOR_BY.map((c) => (
                <button key={c.key} type="button" aria-pressed={colorBy === c.key} onClick={() => setColorBy(c.key)} className={seg(colorBy === c.key)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            aria-pressed={flow && !reduced}
            disabled={reduced}
            onClick={() => setFlow((f) => !f)}
            title={reduced ? 'Отключено: в системе включено снижение движения' : undefined}
            className={cn(seg(flow && !reduced), 'border disabled:opacity-50')}
          >
            Потоки денег
          </button>
          <form onSubmit={onSearch} role="search" className="ml-auto flex items-center gap-2">
            <label className="flex h-8 w-56 items-center gap-2 rounded-lg border border-input bg-background px-2.5 focus-within:border-gold/60">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="gid или хвост"
                inputMode="numeric"
                aria-label="Найти узел на схеме по gid или последним цифрам"
                className="w-full bg-transparent font-mono text-[13px] outline-none placeholder:font-sans placeholder:text-muted-foreground"
              />
            </label>
            <Button type="button" variant="outline" onClick={resetView}>
              Сброс вида
            </Button>
          </form>
        </div>

        {(clusterId != null || (q && sel == null)) && (
          <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-panel-2/60 px-4 py-2 text-[13px] text-ink-2">
            {q && sel == null && (
              <span>
                Узел <span className="font-mono">{q}</span> не найден в графе.
              </span>
            )}
            {clusterId != null && (
              <>
                <span>
                  {clusterNodes.length ? (
                    <>
                      Подсвечен кластер <span className="font-mono">#{clusterId}</span> ·{' '}
                      <span className="font-mono tnum">{num(clusterNodes.length)}</span> узлов
                    </>
                  ) : (
                    <>
                      Кластер <span className="font-mono">#{clusterId}</span> не найден.
                    </>
                  )}
                </span>
                <Button variant="ghost" size="xs" onClick={() => update((p) => p.delete('cluster'))}>
                  Снять подсветку
                </Button>
              </>
            )}
          </div>
        )}

        <div className="grid md:grid-cols-[210px_minmax(0,1fr)]">
          <div className="grid content-start gap-4 border-b p-4 md:border-r md:border-b-0">
            <fieldset className="grid gap-2">
              <legend className="eyebrow mb-2">Роли</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 md:grid">
                {ROLES.map((r) => (
                  <label key={r} className="flex cursor-pointer items-center gap-2 text-[13px]">
                    <input type="checkbox" checked={roles.has(r)} onChange={() => toggleRole(r)} className="size-3.5 accent-gold" />
                    <RoleDot role={r} />
                    <span className={roles.has(r) ? 'text-foreground' : 'text-muted-foreground'}>{ROLE[r].label}</span>
                    <span className="ml-auto pl-2 font-mono text-xs text-muted-foreground tnum">{num(roleCount[r])}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input type="checkbox" checked={seedOnly} onChange={(e) => setSeedOnly(e.target.checked)} className="size-3.5 accent-gold" />
              только seed
            </label>
          </div>

          <div className="relative min-w-0">
            <NetworkCanvas
              ref={canvas}
              model={model}
              colorBy={colorBy}
              flow={flow && !reduced}
              active={active}
              selected={sel}
              onSelect={(i) => select(i, true)}
            />
            {sel != null && (
              <NodeCard
                key={model.nodes[sel].gid}
                model={model}
                i={sel}
                onPick={(j) => select(j)}
                onClose={() => select(null)}
              />
            )}
          </div>
        </div>

        <p className="border-t px-4 py-2 font-mono text-[11px] tracking-wide text-muted-foreground">
          колесо — масштаб · перетаскивание — сдвиг · клик — карточка и связи
        </p>
      </section>
    </>
  )
}

function NodeCard({ model, i, onPick, onClose }: { model: Model; i: number; onPick: (j: number) => void; onClose: () => void }) {
  const n = model.nodes[i]
  const { data, error } = useApi(() => api.node(n.gid), [n.gid])
  const m = data?.metrics
  const top = (edges: number[], side: 'in' | 'out') =>
    [...edges]
      .sort((a, b) => model.edges[b].sumKzt - model.edges[a].sumKzt)
      .slice(0, 6)
      .map((e) => ({ j: side === 'in' ? model.src[e] : model.dst[e], edge: model.edges[e] }))

  const warnings = [
    n.isSeed && 'seed: входящие занижены устройством выгрузки — граф строился от seed наружу, соотношение выход/вход некорректно.',
    n.depth >= 4 && n.outDeg === 0 && '4-е колено: исходящие не собирались, обход оборван — «нет исходящих» здесь ничего не значит.',
  ].filter(Boolean) as string[]

  return (
    <aside
      aria-label="Выбранный узел"
      className="grid content-start gap-3 border-t bg-card p-4 text-[13px] md:absolute md:top-3 md:right-3 md:max-h-[calc(100%-1.5rem)] md:w-80 md:overflow-y-auto md:rounded-xl md:border md:border-line-2 md:bg-card/95 md:backdrop-blur-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="grid gap-1.5">
          <Eyebrow>выбранный узел · колено {n.depth}</Eyebrow>
          <div className="font-mono text-[13px] font-medium break-all">{n.gid}</div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Закрыть карточку">
          <XIcon />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <RoleChip role={model.role[i]} />
        {n.isSeed && <SeedTag />}
        {n.priority != null && <PriorityBar value={n.priority} className="ml-auto" />}
      </div>

      <div className="grid gap-1.5 rounded-lg border border-dashed border-line-2 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">основания роли</span>
          <HypTag />
        </div>
        {m ? (
          <p className="font-mono text-xs leading-relaxed text-ink-2">{m.evidence}</p>
        ) : error ? (
          <p className="text-xs text-muted-foreground">Не удалось загрузить: {error}</p>
        ) : (
          <div className="h-8 animate-pulse rounded bg-panel-2" aria-busy />
        )}
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {(
          [
            ['вход', kzt(n.inKzt)],
            ['выход', kzt(n.outKzt)],
            ['плательщиков', num(n.inDeg)],
            ['получателей', num(n.outDeg)],
            ['переводов вход / выход', m ? `${num(m.in_tx)} / ${num(m.out_tx)}` : '…'],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right font-mono tnum">{v}</dd>
          </div>
        ))}
      </dl>

      {warnings.map((w) => (
        <p key={w} className="flex gap-2 rounded-md border border-line-2 bg-panel-2 p-2 text-xs text-ink-2">
          <TriangleAlertIcon className="mt-px size-3.5 shrink-0 text-seed" aria-hidden />
          {w}
        </p>
      ))}

      {(
        [
          ['Крупнейшие плательщики', model.inn[i], 'in'],
          ['Крупнейшие получатели', model.out[i], 'out'],
        ] as const
      ).map(
        ([title, edges, side]) =>
          edges.length > 0 && (
            <div key={side} className="grid gap-1">
              <Eyebrow>
                {title} · {num(edges.length)}
              </Eyebrow>
              <ul className="grid">
                {top(edges, side).map(({ j, edge }) => (
                  <li key={j}>
                    <button
                      type="button"
                      onClick={() => onPick(j)}
                      aria-label={`Выбрать ${side === 'in' ? 'плательщика' : 'получателя'} ${model.nodes[j].gid}`}
                      className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-panel-2/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <span className="text-muted-foreground" aria-hidden>
                        {side === 'in' ? '←' : '→'}
                      </span>
                      <RoleDot role={model.role[j]} className="size-2" />
                      <span className="font-mono text-xs whitespace-nowrap">{gidTail(model.nodes[j].gid)}</span>
                      {model.nodes[j].isSeed && <span className="font-mono text-[10.5px] text-seed uppercase">seed</span>}
                      <span className="ml-auto font-mono text-xs whitespace-nowrap tnum">
                        {kztShort(edge.sumKzt)}
                        {edge.nTx > 1 && <span className="text-muted-foreground"> · {edge.nTx} пер.</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}

      <Button variant="outline" nativeButton={false} render={<Link to={`/nodes/${n.gid}`} />}>
        Открыть карточку узла →
      </Button>
    </aside>
  )
}
