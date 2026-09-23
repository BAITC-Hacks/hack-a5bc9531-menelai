import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Bar, GidLink, HypTag, LoadState, PageHeader, Panel, PriorityBar, RoleChip, RoleDot, StatStrip } from '@/components/kit'
import { ROLE } from '@/lib/roles'
import { api, CSV_FILES, ROLES, type Role } from '@/lib/api'
import { dayMonth, dec, kztShort, num } from '@/lib/format'
import { useApi } from '@/lib/use-api'

const SIGNAL_ROLES = ROLES.filter((r) => r !== 'peripheral')

const CSV_COLUMNS: Record<(typeof CSV_FILES)[number], string[]> = {
  'nodes_roles.csv': ['gid', 'role', 'role_score', 'cluster_id', 'priority_score', 'evidence'],
  'clusters.csv': ['cluster_id', 'n_nodes', 'n_seed', 'sum_kzt_internal', 'top_gids', 'hypothesis'],
  'top_nodes.csv': ['rank', 'gid', 'role', 'priority_score', 'why'],
}

// Same hop colors as the network screen's «Колено» mode.
const DEPTH_COLOR = ['#e66767', '#eda100', '#1baf7a', '#3987e5', '#9085e9']

export default function OverviewPage() {
  const { data: stats, error, reload } = useApi(api.stats)
  if (!stats) return <LoadState error={error} reload={reload} />

  const period = `${dayMonth(stats.period[0])}–${dayMonth(stats.period[1])}.${stats.period[1].slice(0, 4)}`

  return (
    <>
      <PageHeader
        eyebrow="HackAlem AI · кейс финмониторинга · обезличенные данные"
        title={<span className="font-heading text-[clamp(2.5rem,5vw,4rem)]">Граф денег</span>}
        lede={
          <>
            Банк знает {num(stats.seeds)} клиента-seed; от каждого прослежены исходящие переводы на 4 колена за июль 2026 — перед аналитиком{' '}
            {num(stats.nodes)} клиентов. Задача — понять, кто собирает, кто прогоняет и кто распоряжается деньгами, и кого проверять первым.
          </>
        }
      />

      <StatStrip
        items={[
          { value: num(stats.seeds), label: 'seed', tone: 'var(--seed)' },
          { value: num(stats.nodes), label: 'узлов' },
          { value: num(stats.edges), label: 'пар плательщик → получатель' },
          { value: num(stats.transactions), label: 'переводов' },
          { value: kztShort(stats.totalKzt), label: 'оборот' },
          { value: period, label: 'период' },
        ]}
      />

      <div className="flex flex-wrap gap-3">
        <Button nativeButton={false} render={<Link to="/graph" />}>
          Схема сети
        </Button>
        <Button variant="outline" nativeButton={false} render={<Link to="/top" />}>
          Кого смотреть первым
        </Button>
        <Button variant="outline" nativeButton={false} render={<Link to="/rules" />}>
          Правила ролей
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <RolesPanel roles={stats.roles} nodes={stats.nodes} />
        <DepthPanel byDepth={stats.byDepth} />
      </div>

      <TopPanel />

      <Traps byDepth4={stats.byDepth[4]} />

      <Panel eyebrow="выгрузки" title="Три CSV из пайплайна">
        <div className="grid gap-4 sm:grid-cols-3">
          {CSV_FILES.map((file) => (
            <div key={file} className="grid gap-2.5 rounded-lg border bg-panel-2/40 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[13px] font-medium">{file}</span>
                <Button size="sm" variant="outline" nativeButton={false} render={<a href={api.exportUrl(file)} download />}>
                  Скачать
                </Button>
              </div>
              <div className="flex flex-wrap gap-1">
                {CSV_COLUMNS[file].map((col) => (
                  <span key={col} className="rounded-md border bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
                    {col}
                  </span>
                ))}
              </div>
              {file === 'nodes_roles.csv' && <span className="text-xs text-muted-foreground">ровно {num(stats.nodes)} строк</span>}
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-lg border bg-panel-2/60 px-3.5 py-2.5 font-mono text-[13px] text-ink-2">
          cd pipeline &amp;&amp; uv run python run.py --data ../task/data --out ../out
        </div>
      </Panel>
    </>
  )
}

function RolesPanel({ roles, nodes }: { roles: Record<Role, number> | null; nodes: number }) {
  if (!roles)
    return (
      <Panel eyebrow="роли в сети" title="Роли ещё не посчитаны">
        <p className="text-sm text-ink-2">Запустите пайплайн (см. блок «Выгрузки» ниже), чтобы появились роли и приоритет.</p>
      </Panel>
    )
  const max = Math.max(...SIGNAL_ROLES.map((r) => roles[r]))
  const share = (r: Role) => `${dec((roles[r] / nodes) * 100, 1)} %`
  return (
    <Panel eyebrow="роли в сети" title="Каскад ролей">
      <div className="grid gap-3">
        {SIGNAL_ROLES.map((r) => (
          <div key={r} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3">
            <div className="grid gap-1 pr-2">
              <span className="flex items-center gap-1.5 text-[13px] font-medium">
                <RoleDot role={r} /> {ROLE[r].label}
              </span>
              <span className="text-[11px] text-muted-foreground">{ROLE[r].sign}</span>
              <Bar value={roles[r]} max={max} background={ROLE[r].color} />
            </div>
            <span className="justify-self-end text-right font-mono text-[13px] tnum">
              {num(roles[r])} <span className="text-muted-foreground">· {share(r)}</span>
            </span>
          </div>
        ))}
        <div className="mt-1 flex items-center justify-between gap-3 border-t pt-3">
          <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <RoleDot role="peripheral" /> {ROLE.peripheral.label} · вне общей шкалы
          </span>
          <span className="font-mono text-[13px] tnum">
            {num(roles.peripheral)} <span className="text-muted-foreground">· {share('peripheral')}</span>
          </span>
        </div>
      </div>
    </Panel>
  )
}

function DepthPanel({ byDepth }: { byDepth: number[] }) {
  const max = Math.max(...byDepth)
  return (
    <Panel eyebrow="волна обхода по коленам" title="Сколько узлов открылось на каждом шаге">
      <div className="grid gap-3">
        {byDepth.map((count, depth) => (
          <div key={depth} className="grid grid-cols-[4.5rem_minmax(0,1fr)_5.5rem] items-center gap-3">
            <span className="font-mono text-[13px] whitespace-nowrap text-muted-foreground tnum">колено {depth}</span>
            <Bar
              value={count}
              max={max}
              background={depth === 4 ? `repeating-linear-gradient(45deg, ${DEPTH_COLOR[4]} 0 4px, transparent 4px 8px)` : DEPTH_COLOR[depth]}
            />
            <span className="justify-self-end font-mono text-[13px] tnum">{num(count)}</span>
          </div>
        ))}
        <p className="text-[12px] text-muted-foreground">
          Колено 0 — {num(byDepth[0])} seed-узлов. Колено 4 (штриховка): обход остановлен — исходящие переводы для этих узлов не выгружались.
        </p>
      </div>
    </Panel>
  )
}

function TopPanel() {
  const { data: top, error } = useApi(api.top)
  return (
    <Panel eyebrow="первые в очереди" title="Кого смотреть первым" action={
      <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/top" />}>
        Весь топ →
      </Button>
    }>
      {!top ? (
        <p className="text-sm text-ink-2">{error ? error : 'Загрузка…'}</p>
      ) : (
        <ol className="grid gap-2.5">
          {top.slice(0, 5).map((t) => (
            <li key={t.gid} className="flex flex-wrap items-center gap-3">
              <span className="w-5 font-mono text-[13px] text-muted-foreground tnum">{t.rank}</span>
              <GidLink gid={t.gid} short />
              <RoleChip role={t.role} />
              <PriorityBar value={t.priorityScore} className="ml-auto" />
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

function Traps({ byDepth4 }: { byDepth4: number }) {
  const traps: { title: string; text: ReactNode }[] = [
    {
      title: 'нет исходящих ≠ деньги осели',
      text: (
        <>
          {num(byDepth4)} узлов 4-го колена обрезаны обходом — у них нет исходящих переводов просто потому, что обход туда не дошёл. А вот стоки на
          коленах 1–3 без исходящих — настоящие: там переводы выгружались и их действительно нет.
        </>
      ),
    },
    {
      title: 'у seed входящие занижены',
      text: 'Граф построен от seed наружу — во входящие переводы seed попало не всё. Отношение исходящих ко входящим для seed бессмысленно.',
    },
    {
      title: 'сумма и число переводов — разные сигналы',
      text: 'Один крупный перевод и десять мелких на ту же сумму — разное поведение. Не сводить оборот к одному числу.',
    },
    {
      title: 'граф направленный и взвешенный',
      text: 'Кластеры считаются неориентированным методом (Louvain) — он не видит направление денег; это оговорено отдельно в разделе «Правила ролей».',
    },
  ]
  return (
    <Panel eyebrow="ловушки выгрузки" title="Четыре ловушки выгрузки">
      <div className="grid gap-4 sm:grid-cols-2">
        {traps.map((t, i) => (
          <div key={t.title} className="grid gap-2 rounded-lg border bg-panel-2/40 p-4">
            <span className="font-mono text-xs font-medium text-gold uppercase">ловушка {i + 1}</span>
            <h3 className="text-[14px] font-medium">{t.title}</h3>
            <p className="text-[13px] text-ink-2">{t.text}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <HypTag /> Все выводы на этом экране — гипотезы для проверки аналитиком.
      </p>
    </Panel>
  )
}
