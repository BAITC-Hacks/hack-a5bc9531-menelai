import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowUpRightIcon, ChevronDownIcon, DownloadIcon, WaypointsIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GidLink, HypTag, LoadState, PageHeader, PriorityBar, RoleChip, Segmented, SeedTag } from '@/components/kit'
import { ROLE } from '@/lib/roles'
import { api, ROLES, type Role } from '@/lib/api'
import { dec, kzt, num } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

export default function TopPage() {
  const { data, error, reload } = useApi(api.top)
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all')

  if (!data) return <LoadState error={error} reload={reload} />

  const roleCounts = data.reduce<Partial<Record<Role, number>>>((acc, r) => {
    acc[r.role] = (acc[r.role] ?? 0) + 1
    return acc
  }, {})
  const rolesPresent = ROLES.filter((r) => roleCounts[r])
  const rows = roleFilter === 'all' ? data : data.filter((r) => r.role === roleFilter)

  return (
    <>
      <PageHeader
        eyebrow="очередь проверки"
        title="Кого смотреть первым"
        lede="Начните с верхних строк: прочитайте обоснование, проверьте движение денег и связи узла. Роль — гипотеза, приоритет задаёт порядок проверки."
        aside={
          <Button variant="outline" className="min-h-11" nativeButton={false} render={<a href={api.exportUrl('top_nodes.csv')} download />}>
            <DownloadIcon aria-hidden /> Скачать список CSV
          </Button>
        }
      />

      <section aria-label="Фильтр очереди" className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p aria-live="polite" className="text-sm text-ink-2">
            Показано <span className="font-mono font-medium text-foreground tnum">{num(rows.length)}</span> из{' '}
            <span className="font-mono tnum">{num(data.length)}</span>
            <span className="ml-2 text-muted-foreground">· по убыванию приоритета</span>
          </p>
          <span className="text-xs text-muted-foreground">CSV содержит весь список</span>
        </div>
        <Segmented
          value={roleFilter}
          onChange={setRoleFilter}
          className="w-fit max-w-full [&_button]:min-h-11 [&_button]:px-3"
          options={[
            { value: 'all' as const, label: 'Все роли', count: data.length },
            ...rolesPresent.map((r) => ({ value: r, label: ROLE[r].label, count: roleCounts[r] })),
          ]}
        />
      </section>

      {rows.length ? (
        <ol aria-label="Узлы по приоритету проверки" className="min-w-0 divide-y overflow-hidden rounded-xl border bg-card">
          {rows.map((r) => (
            <li key={r.gid} value={r.rank} className="grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)] gap-3 p-4 sm:grid-cols-[2.5rem_minmax(0,1fr)] sm:gap-4 sm:p-5">
              <span
                className={cn('pt-0.5 font-mono text-lg font-semibold tnum sm:text-xl', r.rank <= 3 ? 'text-gold' : 'text-muted-foreground')}
                aria-label={`Место ${r.rank}`}
              >
                {r.rank}
              </span>
              <article className="grid min-w-0 gap-3" aria-labelledby={`node-${r.gid}`}>
                <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                  <div className="grid min-w-0 gap-2">
                    <h2 id={`node-${r.gid}`} className="min-w-0 leading-tight">
                      <GidLink gid={r.gid} className="text-sm font-medium whitespace-normal break-all sm:text-base" />
                    </h2>
                    <div className="flex flex-wrap items-center gap-2">
                      <HypTag>{r.role === 'peripheral' ? 'нет признаков' : 'гипотеза'}</HypTag>
                      <RoleChip role={r.role} />
                      {r.isSeed && <SeedTag />}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:grid sm:justify-items-end">
                    <span className="text-xs text-muted-foreground">Приоритет проверки</span>
                    <PriorityBar value={r.priorityScore} />
                  </div>
                </div>

                <p className="max-w-[90ch] text-[15px] leading-relaxed text-ink-2">{r.why}</p>

                <div className="grid gap-3 border-t pt-1 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                  <details className="group min-w-0">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                      <ChevronDownIcon className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
                      Метрики и основания роли
                    </summary>
                    <div className="grid gap-4 pt-2 pb-1">
                      <dl className="grid min-w-0 gap-x-5 gap-y-4 sm:grid-cols-2">
                        <div className="grid min-w-0 content-start gap-1">
                          <dt className="text-xs text-muted-foreground">Уверенность правила · 0–1</dt>
                          <dd className="font-mono text-sm tnum">{dec(r.roleScore)}</dd>
                        </div>
                        <div className="grid min-w-0 content-start gap-1">
                          <dt className="text-xs text-muted-foreground">Кластер · колено</dt>
                          <dd className="text-sm">
                            <Link to={`/clusters#cluster-${r.clusterId}`} className="rounded-sm font-mono text-foreground underline decoration-line-2 underline-offset-4 hover:text-gold focus-visible:ring-2 focus-visible:ring-ring">
                              #{r.clusterId}
                            </Link>
                            <span className="font-mono text-muted-foreground"> · {r.depth}</span>
                          </dd>
                        </div>
                        <div className="grid min-w-0 content-start gap-1">
                          <dt className="text-xs text-muted-foreground">Входящая сумма</dt>
                          <dd className="font-mono text-sm tnum">{kzt(r.inKzt)}</dd>
                          {r.isSeed && <span className="text-xs text-muted-foreground">У seed входящие неполны</span>}
                        </div>
                        <div className="grid min-w-0 content-start gap-1">
                          <dt className="text-xs text-muted-foreground">Исходящая сумма</dt>
                          <dd className="font-mono text-sm tnum">{kzt(r.outKzt)}</dd>
                          {r.depth === 4 && <span className="text-xs text-muted-foreground">На 4-м колене не выгружалась</span>}
                        </div>
                      </dl>
                      <div className="grid gap-1.5 rounded-lg bg-panel-2/60 p-3">
                        <span className="text-xs font-medium text-muted-foreground">Численные основания гипотезы</span>
                        <p className="text-sm leading-relaxed text-ink-2">{r.evidence}</p>
                      </div>
                    </div>
                  </details>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button variant="outline" className="min-h-11" nativeButton={false} render={<Link to={`/nodes/${r.gid}`} />}>
                      Карточка узла <ArrowUpRightIcon aria-hidden />
                    </Button>
                    <Button variant="ghost" className="min-h-11" nativeButton={false} render={<Link to={`/graph?q=${r.gid}`} />}>
                      <WaypointsIcon aria-hidden /> На схеме
                    </Button>
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ol>
      ) : (
        <div role="status" className="rounded-xl border bg-card p-6 text-sm text-ink-2">
          В очереди пока нет узлов для проверки.
        </div>
      )}

      <details className="group min-w-0 rounded-xl border bg-card px-4 py-1">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          Как рассчитан приоритет
        </summary>
        <div className="grid max-w-[90ch] gap-3 pt-1 pb-4 text-sm leading-relaxed text-ink-2">
          <p>
            Приоритет — среднее перцентилей по seed-деньгам на входе, числу seed выше по потоку, масштабу входа и посредничеству,
            умноженное на вес роли. Значение от 0 до 1 определяет очерёдность проверки и не является вероятностью причастности.
          </p>
          <p>
            Уверенность правила показывает силу признаков роли. Роль и приоритет — разные показатели; основания роли и пороги доступны в{' '}
            <Link to="/method/rules" className="rounded-sm text-foreground underline decoration-line-2 underline-offset-4 hover:text-gold focus-visible:ring-2 focus-visible:ring-ring">
              правилах анализа
            </Link>
            .
          </p>
        </div>
      </details>
    </>
  )
}
