import { Fragment, useState } from 'react'
import { Link } from 'react-router'
import { ChevronDownIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GidLink, HypTag, LoadState, PageHeader, PriorityBar, RoleChip, RoleStackBar, Segmented, SeedTag } from '@/components/kit'
import { ROLE } from '@/lib/roles'
import { api, ROLES, type Role } from '@/lib/api'
import { dec, kztShort } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

export default function TopPage() {
  const { data, error, reload } = useApi(api.top)
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all')
  const [expanded, setExpanded] = useState<Set<number> | null>(null)

  if (!data) return <LoadState error={error} reload={reload} />

  const expandedRanks = expanded ?? new Set(data.slice(0, 3).map((r) => r.rank))
  const toggle = (rank: number) => {
    const next = new Set(expandedRanks)
    if (next.has(rank)) next.delete(rank)
    else next.add(rank)
    setExpanded(next)
  }

  const roleCounts = data.reduce<Partial<Record<Role, number>>>((acc, r) => {
    acc[r.role] = (acc[r.role] ?? 0) + 1
    return acc
  }, {})
  const rolesPresent = ROLES.filter((r) => roleCounts[r])
  const rows = roleFilter === 'all' ? data : data.filter((r) => r.role === roleFilter)

  return (
    <>
      <PageHeader
        eyebrow="приоритеты · top_nodes.csv"
        title="Кого смотреть первым"
        lede="Приоритет — среднее перцентилей по seed-деньгам на входе, числу seed выше по потоку, масштабу входа и посредничеству, умноженное на вес роли. Это очередь на проверку, а не список виновных."
        aside={
          <Button variant="outline" nativeButton={false} render={<a href={api.exportUrl('top_nodes.csv')} download />}>
            Скачать top_nodes.csv
          </Button>
        }
      />

      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            value={roleFilter}
            onChange={setRoleFilter}
            options={[
              { value: 'all' as const, label: 'Все', count: data.length },
              ...rolesPresent.map((r) => ({ value: r, label: ROLE[r].label, count: roleCounts[r] })),
            ]}
          />
        </div>
        <RoleStackBar counts={roleCounts} />
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-3 pl-4 font-normal">
                №
              </th>
              <th scope="col" className="py-2 pr-3 font-normal">
                gid
              </th>
              <th scope="col" className="py-2 pr-3 font-normal">
                Роль
              </th>
              <th scope="col" className="py-2 pr-3 font-normal">
                Приоритет
              </th>
              <th scope="col" className="py-2 pr-3 font-normal">
                Уверенность роли
              </th>
              <th scope="col" className="py-2 pr-3 font-normal">
                Кластер
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-normal">
                Вход ₸
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-normal">
                Выход ₸
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isExpanded = expandedRanks.has(r.rank)
              const isTop3 = r.rank <= 3
              return (
                <Fragment key={r.gid}>
                  <tr className="border-b transition-colors hover:bg-panel-2/60">
                    <td className="py-2 pr-3 pl-4">
                      <button
                        type="button"
                        onClick={() => toggle(r.rank)}
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? 'Свернуть' : 'Развернуть'} строку ${r.rank}`}
                        className="flex items-center gap-2 rounded-md py-0.5"
                      >
                        <ChevronDownIcon
                          className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', isExpanded && 'rotate-180')}
                          aria-hidden
                        />
                        <span className={cn('font-mono text-base font-semibold tnum', isTop3 && 'text-gold')}>{r.rank}</span>
                      </button>
                    </td>
                    <td className="py-2 pr-3">
                      <span className="hidden lg:inline">
                        <GidLink gid={r.gid} />
                      </span>
                      <span className="lg:hidden">
                        <GidLink gid={r.gid} short />
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <RoleChip role={r.role} />
                        {r.isSeed && <SeedTag />}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <PriorityBar value={r.priorityScore} />
                    </td>
                    <td className="py-2 pr-3 font-mono tnum">{dec(r.roleScore)}</td>
                    <td className="py-2 pr-3">
                      <Link to={`/clusters#cluster-${r.clusterId}`} className="font-mono text-ink-2 hover:text-gold">
                        #{r.clusterId}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tnum">{kztShort(r.inKzt)}</td>
                    <td className="py-2 pr-4 text-right font-mono tnum">{kztShort(r.outKzt)}</td>
                  </tr>
                  {isExpanded && (
                    <tr className="border-b bg-panel-2/40">
                      <td colSpan={8} className="px-4 py-3">
                        <div className="grid max-w-[80ch] gap-1.5">
                          <p className="flex items-start gap-2 text-sm text-ink-2">
                            <HypTag>{r.role === 'peripheral' ? 'нет находки' : 'гипотеза'}</HypTag>
                            <span>{r.why}</span>
                          </p>
                          <p className="font-mono text-[11px] text-muted-foreground">{r.evidence}</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Ранжирование детерминированное, из <code className="font-mono">pipeline/run.py</code>; правила — на странице{' '}
        <Link to="/rules" className="text-ink-2 underline decoration-line-2 decoration-dotted underline-offset-4 hover:text-gold">
          «Правила ролей»
        </Link>
        .
      </p>
    </>
  )
}
