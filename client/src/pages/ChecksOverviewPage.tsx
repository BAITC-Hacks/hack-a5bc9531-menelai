import { Link } from 'react-router'
import { ActivityIcon, ArrowRightIcon, CircleAlertIcon, NetworkIcon, Repeat2Icon, RouteIcon, ScanSearchIcon } from 'lucide-react'
import { HypTag, LoadState, PageHeader } from '@/components/kit'
import { api } from '@/lib/api'
import { num } from '@/lib/format'
import { useApi } from '@/lib/use-api'

async function loadChecks() {
  const [routes, time, anomalies, resilience, completeness] = await Promise.all([
    api.routes(), api.time(), api.anomalies(), api.resilience(), api.completeness(),
  ])
  return { routes, time, anomalies, resilience, completeness }
}

export default function ChecksOverviewPage() {
  const { data, error, reload } = useApi(loadChecks)
  if (!data) return <LoadState error={error} reload={reload} />

  const checks = [
    {
      to: '/analysis/routes#cycles', icon: Repeat2Icon, title: 'Круговые потоки',
      value: num(data.routes.cyclesTotal), unit: 'направленных циклов',
      description: `Маршруты, которые возвращаются к исходному клиенту за ${data.routes.cycleMaxLen} шагов или меньше.`,
      detail: 'Распределение по длине, взаимные переводы и треугольники',
    },
    {
      to: '/analysis/routes#chains', icon: RouteIcon, title: 'Устойчивые цепочки',
      value: num(data.routes.chainsTotal), unit: 'повторяющихся цепочек',
      description: `Плательщик → посредник → получатель: повторные переводы с совпадением по времени в пределах ${data.routes.windowDays} дней.`,
      detail: `Показаны ${num(data.routes.chains.length)} цепочек с основаниями`,
    },
    {
      to: '/analysis/time', icon: ActivityIcon, title: 'Временные паттерны',
      value: num(data.time.syncTotal), unit: 'синхронных поступлений',
      description: `От ${data.time.syncPayers} плательщиков одному получателю за день, активность по датам и быстрый транзит.`,
      detail: `${num(data.time.fastTransit.length)} транзитных узлов с быстрым выходом ≥ 90 %`,
    },
    {
      to: '/analysis/anomalies', icon: ScanSearchIcon, title: 'Нетипичные поступления',
      value: num(data.anomalies.profile.length), unit: 'профилей для сравнения',
      description: 'Наибольшие отклонения входящей суммы от профиля клиентов на том же колене обхода.',
      detail: 'Логарифмическая z-оценка и медиана колена',
    },
    {
      to: '/analysis/resilience', icon: NetworkIcon, title: 'Устойчивость сети',
      value: num(data.resilience.length), unit: 'сценариев сравнения',
      description: 'Как меняются связность сети и оборот при исключении клиентов из начала очереди проверки.',
      detail: 'Сценарий «что если», без изменения исходного графа',
    },
    {
      to: '/analysis/completeness', icon: CircleAlertIcon, title: 'Пробелы в данных',
      value: num(data.completeness.truncated), unit: 'клиентов на границе выгрузки',
      description: 'Что не видно в исходящих переводах и какие данные помогут продолжить проверку.',
      detail: `${num(data.completeness.seedNoOut)} исходных клиентов без исходящих переводов`,
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow="аналитические проверки"
        title="Проверки"
        lede="Структура переводов, временные совпадения и пробелы в данных. Выберите проверку, изучите основания и перейдите в досье клиента."
      />
      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {checks.map(({ to, icon: Icon, title, value, unit, description, detail }) => (
          <Link key={to} to={to} className="group grid min-w-0 content-start gap-5 rounded-2xl border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-primary/3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <div className="flex items-center justify-between gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-primary/8 text-primary"><Icon className="size-5" aria-hidden /></span>
              <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
            </div>
            <div className="grid gap-2">
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="text-sm leading-relaxed text-ink-2">{description}</p>
            </div>
            <div className="grid gap-1 border-t pt-4">
              <span className="font-mono text-2xl font-medium tnum">{value}</span>
              <span className="text-sm text-ink-2">{unit}</span>
              <span className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</span>
            </div>
          </Link>
        ))}
      </div>
      <p className="flex flex-wrap items-start gap-2 text-sm text-ink-2">
        <HypTag /> Совпадение по правилу — основание для проверки. Оно не подтверждает происхождение средств или причастность клиента.
      </p>
    </>
  )
}
