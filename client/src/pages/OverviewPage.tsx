import { Link } from 'react-router'
import { ArrowRightIcon, CheckIcon, DownloadIcon, RefreshCwIcon, UploadIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LoadState, RoleDot, RoleFlow, RoleStackBar, StatStrip } from '@/components/kit'
import ReviewWorkspace from '@/components/ReviewWorkspace'
import { ROLE } from '@/lib/roles'
import { api, CSV_FILES, ROLES, type Role } from '@/lib/api'
import { kzt, kztShort, num, pct, periodLabel } from '@/lib/format'
import { useApi } from '@/lib/use-api'

const EXPORTS = { 'nodes_roles.csv': 'Роли всех клиентов', 'clusters.csv': 'Группы', 'top_nodes.csv': 'Очередь проверки' }
const MEANING: Record<Role, string> = {
  coordinator: 'Признаки координации: клиент связывает разные части сети, принимает и распределяет средства.',
  consolidator: 'Признаки сбора средств от нескольких плательщиков с небольшой долей дальнейших переводов.',
  distributor: 'Признаки веерного распределения средств на большое число получателей.',
  transit: 'Признаки транзита: поступления быстро переводятся дальше в сопоставимом объёме.',
  terminal: 'Признаки конечного получателя в пределах доступной выписки.',
  peripheral: 'Выраженная роль не определена. В эту категорию входят и клиенты с недостаточными данными.',
}
const CHECKS = [
  ['Круговые потоки', '/analysis/routes'],
  ['Синхронные поступления', '/analysis/time'],
  ['Сквозной транзит', '/analysis/time'],
  ['Аномалии', '/analysis/anomalies'],
  ['Устойчивость сети', '/analysis/resilience'],
  ['Пробелы в данных', '/analysis/completeness'],
]

export default function OverviewPage() {
  const { data, error, reload } = useApi(() => Promise.all([api.stats(), api.top(), api.graph(), api.clusters(), api.meta()]))
  if (!data) return <LoadState error={error} reload={reload} />
  const [stats, top, graph, clusters, meta] = data
  const period = stats.period ? periodLabel(stats.period) : 'период не указан'
  const t = meta.thresholds
  const rules: Record<Role, string> = {
    coordinator: `От ${num(t.coord_in_deg)} плательщиков и ${num(t.coord_out_deg)} получателей; посредничество ≥ p95; связь с исходными клиентами или цикл.`,
    consolidator: `От ${num(t.cons_in_deg)} плательщиков, вход ≥ ${kztShort(t.cons_in_kzt)}, дальше ушло < ${pct(t.cons_pass_max)}, доля основного плательщика < ${pct(t.cons_max_payer)}.`,
    distributor: `От ${num(t.dist_out_deg)} получателей, получателей минимум в ${num(t.dist_ratio)} раза больше, чем плательщиков.`,
    transit: `Выход ${pct(t.tr_pass_lo)}–${pct(t.tr_pass_hi)} от входа, вход ≥ ${kztShort(t.tr_in_kzt)}, быстрый выход ≥ ${pct(t.tr_fast_min)} за ${num(t.fast_days)} дня.`,
    terminal: `Шаги 1–3, клиент вне исходного списка, вход ≥ ${kztShort(t.term_in_kzt)}, дальше ушло < ${pct(t.term_pass_max)}.`,
    peripheral: 'Ни одно правило не сработало или данных недостаточно. Отсутствие роли не означает отсутствие риска.',
  }
  return <>
    <section className="grid gap-4">
      <div className="grid max-w-3xl gap-2">
        <h1 className="font-heading text-[24px] leading-tight font-bold tracking-tight sm:text-[28px]">Мои анализы</h1>
        <p className="text-[15px] text-ink-2">Исследуйте структуру переводов, роли участников и очередь проверки. Выберите клиента, чтобы проследить движение средств и проверить основания.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid content-start gap-3 rounded-[14px] border-2 border-primary bg-card px-[18px] py-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">{stats.datasetName}</h2><span className="rounded-full bg-[#e6f5ec] px-2.5 py-0.5 text-xs font-semibold text-[#1a7a42]">Данные загружены</span></div>
          <p className="text-[13.5px] text-ink-2">{num(stats.seeds)} исходный клиент · {num(stats.nodes)} клиентов · {num(stats.transactions)} переводов · {period}</p>
          <div className="flex flex-wrap gap-1.5">{['nodes.parquet', 'edges.parquet', 'transactions.parquet'].map(file => <span key={file} className="rounded-md bg-secondary px-2 py-0.5 font-mono text-[11.5px] text-ink-2">{file}</span>)}</div>
          <a href="#review-queue" className="w-fit text-xs font-medium text-primary">Открыт ниже ↓</a>
        </div>
        <div className="grid content-start gap-2.5 rounded-[14px] border border-dashed border-input bg-card/60 px-[18px] py-4">
          <div className="flex items-center gap-2.5"><span className="grid size-8 place-items-center rounded-lg bg-accent text-primary"><UploadIcon className="size-4" aria-hidden /></span><h2 className="text-base font-semibold">Новая выписка</h2></div>
          <p className="text-[13.5px] text-ink-2">Загрузите три файла .parquet: клиентов, пары плательщик → получатель и отдельные переводы. Система рассчитает роли и очередь проверки.</p>
          <div className="flex flex-wrap items-center gap-3"><Button className="min-h-9" nativeButton={false} render={<Link to="/upload" />}>Загрузить выписку</Button><Link to="/method/architecture" className="text-xs text-primary underline underline-offset-4">Как выполняется расчёт</Link></div>
        </div>
      </div>
    </section>

    <section className="grid gap-3.5 border-t pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="eyebrow mb-1.5">Анализ</p><h2 className="text-[22px] font-semibold">{stats.datasetName}</h2></div>
        <div className="flex flex-wrap gap-1.5">{CSV_FILES.map(file => <a key={file} href={api.exportUrl(file)} download className="inline-flex min-h-9 items-center gap-2 rounded-lg border bg-card px-3 text-[13px] hover:border-primary/40"><span>{EXPORTS[file]}</span><span className="text-xs text-muted-foreground">CSV</span><DownloadIcon className="size-3.5 text-muted-foreground" aria-hidden /></a>)}</div>
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-[14px] border bg-card px-4 py-3">
        <span className="rounded-lg border border-[#1a8f4a]/40 px-2.5 py-1 text-[13px] font-semibold text-[#1a7a42]">Результаты доступны</span>
        <div className="flex flex-1 flex-wrap gap-1.5">{['Профили клиентов', 'Роли', 'Группы', 'Очередь и отчёты'].map(step => <span key={step} className="inline-flex items-center gap-1.5 rounded-full bg-[#eef7f1] px-2.5 py-1 text-xs"><CheckIcon className="size-3 text-[#1a8f4a]" aria-hidden />{step}</span>)}</div>
        <Link to="/method/architecture" className="text-[13px] text-primary">Этапы расчёта</Link>
        <Button variant="outline" className="min-h-9 bg-card" onClick={reload}><RefreshCwIcon aria-hidden />Обновить данные</Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">Не удалось обновить данные: {error}. Показаны ранее загруженные результаты.</p>}
      <StatStrip items={[
        { value: num(top.length), label: 'в очереди на проверку' },
        { value: num(stats.roles?.coordinator ?? 0), label: 'с признаками координации', tone: '#a3285a' },
        { value: num(clusters.length), label: 'групп, включая одиночных клиентов' },
        { value: kztShort(stats.totalKzt), label: 'сумма переводов в сети' },
      ]} />
    </section>

    <section id="review-queue" className="grid min-w-0 gap-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-xl font-semibold">Очередь проверки</h2><Link to="/top" className="inline-flex items-center gap-1 text-[13px] text-primary">Полный список с фильтрами <ArrowRightIcon className="size-3.5" aria-hidden /></Link></div>
      <p className="-mt-2 text-sm text-muted-foreground">Выберите клиента — видно, откуда пришли средства и куда ушли.</p>
      <ReviewWorkspace top={top} graph={graph} meta={meta} stats={stats} />
    </section>

    <section className="grid gap-3.5">
      <div className="flex flex-wrap items-end justify-between gap-2"><div className="grid gap-1"><h2 className="text-xl font-semibold">Группы связанных клиентов</h2><p className="max-w-3xl text-sm text-muted-foreground">{num(clusters.length)} групп по плотности переводов. Разбиение Louvain не учитывает направление; движение денег проверяйте внутри группы.</p></div><Link to="/network" className="text-[13px] font-medium text-primary">Все группы →</Link></div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[...clusters].sort((a,b) => b.nNodes-a.nNodes).slice(0,6).map(c => <Link key={c.clusterId} to={`/clusters#cluster-${c.clusterId}`} className="grid content-start gap-2.5 rounded-[14px] border bg-card p-4 transition-colors hover:border-primary/50">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-[15px] font-semibold">Группа №{c.clusterId}</h3><span className="font-mono text-[13px]">{kztShort(c.sumKztInternal)}</span></div>
        <RoleStackBar counts={c.roles} />
        <p className="text-[13.5px] leading-relaxed text-ink-2">{c.hypothesis.split('. ')[0]}.</p>
        <p className="text-xs text-muted-foreground">{num(c.nNodes)} клиентов · из исходного списка: {num(c.nSeed)}</p>
      </Link>)}</div>
    </section>

    <section className="grid gap-3.5">
      <div className="grid gap-1"><h2 className="text-xl font-semibold">Как определяется роль</h2><p className="text-sm text-muted-foreground">Правила проверяются по порядку. Пороги — из расчёта этой выписки, роль — гипотеза для проверки.</p></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{ROLES.map(role => <div key={role} className="grid content-start gap-2.5 rounded-[14px] border bg-card p-4">
        <RoleFlow role={role} className="rounded-[10px] bg-panel-2 px-2 py-1.5" />
        <div className="flex items-center gap-2"><RoleDot role={role} /><h3 className="text-[15px] font-semibold">{ROLE[role].label}</h3><span className="ml-auto font-mono text-xs text-muted-foreground">{num(meta.role_counts[role])}</span></div>
        <p className="text-[13.5px] leading-relaxed text-ink-2">{MEANING[role]}</p><p className="text-xs leading-relaxed text-muted-foreground">{rules[role]}</p>
      </div>)}</div>
      <Link to="/method/rules" className="w-fit text-[13px] font-medium text-primary">Все правила, исключения и пороги →</Link>
    </section>
    <section className="flex flex-wrap items-center gap-2 text-[13px]" aria-label="Другие проверки"><span className="font-semibold">Другие проверки:</span>{CHECKS.map(([label,to]) => <Link key={label} to={to} className="rounded-full border bg-card px-3 py-1.5 text-ink-2 hover:border-primary/50">{label}</Link>)}</section>
    <p className="text-xs leading-relaxed text-muted-foreground">Минимальный перевод в выписке: {stats.minTxKzt == null ? 'не указан' : kzt(stats.minTxKzt)}. У {num(stats.byDepth[stats.maxDepth] ?? 0)} клиентов на последнем шаге ({stats.maxDepth}) исходящие не собирались; поступления исходных клиентов неполны. <Link to="/analysis/completeness" className="text-primary underline underline-offset-4">Ограничения данных</Link></p>
  </>
}
