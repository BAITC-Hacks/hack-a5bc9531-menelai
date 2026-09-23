import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { GidLink, HypTag, LoadState, PageHeader, RoleStackBar, Segmented, StatStrip } from '@/components/kit'
import { api, type Cluster } from '@/lib/api'
import { kztShort, num } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

type SortKey = 'size' | 'seed' | 'turnover'
const SORTS: { value: SortKey; label: string; cmp: (a: Cluster, b: Cluster) => number }[] = [
  { value: 'size', label: 'по размеру', cmp: (a, b) => b.nNodes - a.nNodes },
  { value: 'seed', label: 'по исходным клиентам', cmp: (a, b) => b.nSeed - a.nSeed },
  { value: 'turnover', label: 'по внутреннему обороту', cmp: (a, b) => b.sumKztInternal - a.sumKztInternal },
]

function parseHashClusterId() {
  const m = /^#cluster-(\d+)$/.exec(window.location.hash)
  return m ? Number(m[1]) : null
}

export default function ClustersPage() {
  const { data, error, reload } = useApi(api.clusters)
  const [sort, setSort] = useState<SortKey>('size')
  const [highlightId, setHighlightId] = useState<number | null>(null)

  useEffect(() => {
    if (!data) return
    const id = parseHashClusterId()
    if (id == null) return
    setHighlightId(id)
    // details/cards render on this same tick; wait a frame so the target exists before scrolling.
    requestAnimationFrame(() => document.getElementById(`cluster-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const sorted = useMemo(() => {
    const cmp = SORTS.find((s) => s.value === sort)!.cmp
    return [...(data ?? [])].sort(cmp)
  }, [data, sort])

  if (!data) return <LoadState error={error} reload={reload} />

  const big = sorted.filter((c) => c.nNodes >= 3)
  const small = sorted.filter((c) => c.nNodes < 3)
  const largest = data.reduce((max, c) => Math.max(max, c.nNodes), 0)

  return (
    <>
      <PageHeader
        eyebrow="Сеть · состав и основания"
        title="Группы связанных клиентов"
        lede="Louvain на неориентированной проекции: вес ребра — сумма переводов в обе стороны. Направление денег при разбиении на кластеры теряется — его нужно восстанавливать внутри каждого кластера отдельно."
        aside={
          <Button variant="outline" nativeButton={false} render={<a href={api.exportUrl('clusters.csv')} download />}>
            Скачать группы CSV
          </Button>
        }
      />

      <StatStrip
        items={[
          { value: num(data.length), label: 'Всего групп' },
          { value: num(big.length), label: 'Из них ≥ 3 узлов' },
          { value: num(data.filter((c) => c.nSeed > 0).length), label: 'С исходными клиентами' },
          { value: num(largest), label: 'Крупнейший, узлов' },
        ]}
      />

      <Segmented value={sort} onChange={setSort} options={SORTS.map(({ value, label }) => ({ value, label }))} />

      <div className="grid gap-4 lg:grid-cols-2">
        {big.map((c) => (
          <ClusterCard key={c.clusterId} cluster={c} highlighted={c.clusterId === highlightId} />
        ))}
      </div>

      {small.length > 0 && (
        <details open={small.some((c) => c.clusterId === highlightId) || undefined} className="rounded-xl border bg-card">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink-2 select-none">
            Ещё {small.length} мелких кластеров (изолированные seed и пары)
          </summary>
          <div className="overflow-x-auto border-t">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 pl-4 font-normal">
                    Кластер
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-normal">
                    Узлов
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-normal">
                    Seed
                  </th>
                  <th scope="col" className="py-2 pr-4 font-normal">
                    Топ-gid
                  </th>
                </tr>
              </thead>
              <tbody>
                {small.map((c) => (
                  <tr
                    key={c.clusterId}
                    id={`cluster-${c.clusterId}`}
                    className={cn('border-b transition-colors hover:bg-panel-2/60', c.clusterId === highlightId && 'bg-gold/10')}
                  >
                    <td className="py-2 pr-3 pl-4">
                      <Link to={`/graph?cluster=${c.clusterId}`} className="font-mono text-ink-2 hover:text-gold">
                        #{c.clusterId}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tnum">{c.nNodes}</td>
                    <td className="py-2 pr-3 text-right font-mono tnum">{c.nSeed}</td>
                    <td className="py-2 pr-4">
                      <div className="flex flex-wrap gap-1.5">
                        {c.topGids.map((gid) => (
                          <GidLink key={gid} gid={gid} short />
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </>
  )
}

function ClusterCard({ cluster: c, highlighted }: { cluster: Cluster; highlighted: boolean }) {
  return (
    <div
      id={`cluster-${c.clusterId}`}
      className={cn(
        'grid gap-3 rounded-xl border bg-card p-4 transition-shadow',
        highlighted && 'border-gold ring-2 ring-gold/60',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold">Группа №{c.clusterId}</h3>
        <span className="font-mono text-xs tnum text-muted-foreground">
          {c.nNodes} узлов · {c.nSeed} seed · {kztShort(c.sumKztInternal)} внутр. оборот
        </span>
      </div>
      <RoleStackBar counts={c.roles} />
      <p className="flex items-start gap-2 text-sm text-ink-2">
        <HypTag />
        <span>{c.hypothesis}</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {c.topGids.map((gid) => (
          <GidLink key={gid} gid={gid} short className="rounded-md border px-1.5 py-0.5" />
        ))}
      </div>
      <Button variant="outline" size="sm" nativeButton={false} className="justify-self-start" render={<Link to={`/graph?cluster=${c.clusterId}`} />}>
        На схеме
      </Button>
    </div>
  )
}
