import { Bar, HypTag, LoadState, PageHeader, Panel, RoleChip } from '@/components/kit'
import { ROLE } from '@/lib/roles'
import { api, ROLES, type Role } from '@/lib/api'
import { dec, kzt, num, pct } from '@/lib/format'
import { useApi } from '@/lib/use-api'

type Step = {
  n: number
  role: Role
  rule: string
  source: string
  chips?: { label: string | ((t: Record<string, number>) => string); key: string; fmt: (v: number) => string }[]
}

const STEPS: Step[] = [
  {
    n: 0,
    role: 'peripheral',
    rule: 'нет данных: узел без исходящих на последнем колене обхода, или seed без единого ребра в графе',
    source: 'ТЗ §6 — обрыв обхода — артефакт выгрузки, не «сток»',
  },
  {
    n: 1,
    role: 'coordinator',
    rule: 'и собирает, и раздаёт: плательщиков и получателей достаточно, есть связь с seed (несколько seed выше по потоку или seed от seed) или участие в цикле, посредничество высокое, оборот не мелкий',
    source: 'ТЗ: кандидат в организаторы; посредничество — перцентиль среди узлов с входом и выходом; оборот — тот же p80, что у консолидатора',
    chips: [
      { label: 'плательщиков ≥', key: 'coord_in_deg', fmt: num },
      { label: 'получателей ≥', key: 'coord_out_deg', fmt: num },
      { label: 'seed выше по потоку (или цикл) ≥', key: 'coord_seed_up', fmt: num },
      { label: 'посредничество ≥', key: 'coord_betw_thr', fmt: (v) => dec(v, 5) },
      { label: 'оборот ≥', key: 'coord_min_kzt', fmt: kzt },
    ],
  },
  {
    n: 2,
    role: 'consolidator',
    rule: 'средства приходят от нескольких плательщиков, дальше уходит малая доля; вход не мелкий, один плательщик не доминирует',
    source: 'ТЗ: аккумулирует средства от нескольких участников; пороги — p95 in_deg и отсечка мелких «складчин»',
    chips: [
      { label: 'плательщиков ≥', key: 'cons_in_deg', fmt: num },
      { label: 'пропуск <', key: 'cons_pass_max', fmt: (v) => dec(v) },
      { label: 'вход ≥', key: 'cons_in_kzt', fmt: kzt },
      { label: 'крупнейший плательщик <', key: 'cons_max_payer', fmt: pct },
    ],
  },
  {
    n: 3,
    role: 'distributor',
    rule: 'много получателей, и заметно больше получателей, чем плательщиков — веерная раздача, а не транзит через много счетов',
    source: 'ТЗ: веерное распределение на много получателей; порог получателей = p95 out_deg',
    chips: [
      { label: 'получателей ≥', key: 'dist_out_deg', fmt: num },
      { label: 'получателей ≥ k × плательщиков, k =', key: 'dist_ratio', fmt: num },
    ],
  },
  {
    n: 4,
    role: 'transit',
    rule: 'есть и вход, и выход, пропускает почти всё полученное дальше, вход не мелкий, и это не seed (у seed вход недостоверен)',
    source: 'ТЗ и заметка организаторов: коэффициент пропуска в узком диапазоне около 1',
    chips: [
      { label: 'пропуск от', key: 'tr_pass_lo', fmt: (v) => dec(v) },
      { label: 'до', key: 'tr_pass_hi', fmt: (v) => dec(v) },
      { label: 'вход ≥', key: 'tr_in_kzt', fmt: kzt },
      { label: (t) => `вывод ≤ ${t.fast_days} дн. ≥`, key: 'tr_fast_min', fmt: pct },
    ],
  },
  {
    n: 5,
    role: 'terminal',
    rule: 'колено от 1 до предпоследнего (вне границы обрыва обхода), дальше уходит малая доля или выхода нет вовсе, вход не мелкий, и это не seed',
    source: 'ТЗ: деньги приходят и остаются; порог ~p80 отсекает раздувание роли',
    chips: [
      { label: 'вход ≥', key: 'term_in_kzt', fmt: kzt },
      { label: 'пропуск <', key: 'term_pass_max', fmt: (v) => dec(v) },
    ],
  },
  {
    n: 6,
    role: 'peripheral',
    rule: 'всё остальное — признаков роли не выявлено',
    source: '«Периферия» объединяет правило 0 (нет данных) и этот шаг',
  },
]

async function loadMethod() {
  const [meta, stats] = await Promise.all([api.meta(), api.stats()])
  return { meta, stats }
}

export default function RulesPage() {
  const { data, error, reload } = useApi(loadMethod)
  if (!data) return <LoadState error={error} reload={reload} />
  const meta = data.meta

  return (
    <>
      <PageHeader
        eyebrow="методика · правила анализа"
        title="Как система приходит к выводам"
        lede="Только структура переводов, суммы и даты из выгрузки. Каждая роль опирается на явное правило; пороги берутся из распределения данных или задаются в методике."
      />

      <section className="grid min-w-0 gap-3" aria-labelledby="role-cascade">
        <div className="grid gap-1">
          <h2 id="role-cascade" className="text-xl font-semibold">Каскад ролей</h2>
          <p className="text-sm text-ink-2">Правила проверяются сверху вниз. Первое сработавшее правило определяет роль.</p>
        </div>
        <ol className="min-w-0 divide-y overflow-hidden rounded-2xl border bg-card">
          {STEPS.map((s) => {
            const count = s.n === 0 ? null : meta.role_counts[s.role]
            const countLabel = s.n === 6 ? 'включая правило 0' : 'клиентов'
            return (
              <li key={s.n} className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-3 p-4 sm:gap-4 sm:p-5 lg:grid-cols-[2rem_190px_minmax(0,1fr)_5rem]">
                <span className="font-mono text-sm text-muted-foreground tnum">{s.n}</span>
                <div className="grid content-start justify-items-start gap-2">
                  {s.n === 0 ? <span className="text-sm font-semibold">Недостаточно данных</span> : <RoleChip role={s.role} />}
                  <span className="text-xs text-muted-foreground lg:hidden">{count == null ? 'Отдельный итог не передаётся' : `${num(count)} ${countLabel}`}</span>
                </div>
                <div className="col-start-2 grid min-w-0 gap-2 lg:col-start-auto">
                  <p className="text-sm leading-relaxed text-ink-2">{s.rule}</p>
                  {s.chips && <div className="flex flex-wrap gap-1.5">
                    {s.chips.map((c) => {
                      const v = meta.thresholds[c.key]
                      return <span key={c.key} className="rounded-md border bg-panel-2 px-2 py-1 text-xs text-ink-2">{typeof c.label === 'string' ? c.label : c.label(meta.thresholds)} <span className="font-mono font-medium text-foreground tnum">{v == null ? '—' : c.fmt(v)}</span></span>
                    })}
                  </div>}
                  <p className="text-xs leading-relaxed text-muted-foreground">{s.source}</p>
                </div>
                <span className="hidden text-right font-mono text-sm tnum lg:block">{count == null ? '—' : num(count)}<span className="mt-1 block font-sans text-xs text-muted-foreground">{count == null ? 'в составе периферии' : countLabel}</span></span>
              </li>
            )
          })}
        </ol>
      </section>

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
        <Panel title="Оценка по правилу" eyebrow="сила признаков">
          <div className="grid gap-3 text-sm leading-relaxed text-ink-2">
            <p>Для найденной роли оценка учитывает запас относительно порогов: от 0,5 у границы до 1 при выраженных признаках.</p>
            <p>Для периферии оценка тем ниже, чем ближе узел к какой-то роли. При недостатке данных оценка {dec(meta.no_data_role_score)}: роль здесь — заглушка, а не вывод об отсутствии риска.</p>
            <p className="rounded-lg bg-primary/5 p-3 text-primary">Оценка 0,8 не означает вероятность причастности 80 %. Это характеристика правила.</p>
          </div>
        </Panel>
        <Panel title="Приоритет проверки" eyebrow="порядок в очереди">
          <div className="grid gap-4 text-sm leading-relaxed text-ink-2">
            <p>Основа — среднее перцентильных рангов по средствам исходных клиентов на входе, числу исходных клиентов выше по цепочке, входящей сумме и посредничеству. Для seed вместо входа учитывается выход.</p>
            <p>Основа умножается на вес роли:</p>
            <dl className="grid gap-3">
              {ROLES.map((r) => (
                <div key={r} className="grid grid-cols-[minmax(0,1fr)_4rem_2.5rem] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_6rem_2.5rem]">
                  <dt className="text-sm">{ROLE[r].label}</dt>
                  <dd><Bar value={meta.role_weight[r]} max={1} background={ROLE[r].color} /></dd>
                  <dd className="text-right font-mono text-sm text-foreground tnum">{dec(meta.role_weight[r])}</dd>
                </div>
              ))}
            </dl>
            <ul className="grid gap-1.5 border-t pt-3 text-xs leading-relaxed">
              <li>Периферия: {dec(meta.role_weight.peripheral)} + {dec(meta.peripheral_near_bonus)} × доля выполненных условий ближайшей роли (меньше 0,5 — ниже базового веса любой роли). При недостатке данных — {dec(meta.no_data_weight)}.</li>
              <li>Слабая связь со средствами seed (меньше {pct(meta.thresholds.weak_seed_share)}): × {dec(meta.weak_seed_priority_mult)} — у подозрительной роли (возможен легальный контрагент) и у периферии.</li>
              <li>Seed-клиенты: × {dec(meta.seed_priority_mult)} — они уже известны, фокус очереди на новых узлах.</li>
              <li>Эти поправки уже учтены в очереди.</li>
            </ul>
          </div>
        </Panel>
      </div>

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
        <Panel title="Группы связанных клиентов" eyebrow="кластеризация Louvain">
          <div className="grid gap-3 text-sm leading-relaxed text-ink-2">
            <p>Клиенты объединяются по плотности переводов. Вес связи — сумма переводов в обе стороны; для воспроизводимости используется фиксированное начальное значение {meta.thresholds.louvain_seed}.</p>
            <p>Метод не учитывает направление переводов. Кто в группе собирает, а кто распределяет средства, определяется отдельными правилами и исследованием потоков.</p>
          </div>
        </Panel>
        <Panel title="Границы интерпретации" eyebrow="что означает результат">
          <div className="grid gap-3 text-sm leading-relaxed text-ink-2">
            <p>На последнем колене ({data.stats.maxDepth}) отсутствие исходящих отмечается как граница обхода. У исходных клиентов входящие неполны. Отсутствие перевода не подтверждает остаток на счёте.</p>
            <p>Анализ ограничен переводами в загруженной выписке.{data.stats.minTxKzt != null && <> Минимальный перевод в ней — {kzt(data.stats.minTxKzt)}.</>} Сумма и число переводов рассматриваются как разные сигналы.</p>
            <p className="flex flex-wrap items-start gap-2"><HypTag /> Роли, кластеры и приоритет помогают выбрать следующую проверку и не утверждают причастность клиента.</p>
          </div>
        </Panel>
      </div>
    </>
  )
}
