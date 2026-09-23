import { Bar, HypTag, LoadState, PageHeader, Panel, RoleChip, RoleFlow } from '@/components/kit'
import { ROLE } from '@/lib/roles'
import { api, ROLES, type Role } from '@/lib/api'
import { dec, kzt, num } from '@/lib/format'
import { useApi } from '@/lib/use-api'

type Step = {
  n: number
  role: Role
  rule: string
  source: string
  chips?: { label: string; key: string; fmt: (v: number) => string }[]
}

const STEPS: Step[] = [
  {
    n: 0,
    role: 'peripheral',
    rule: 'нет данных: узел обрублен обходом на 4-м колене, или seed без единого ребра в графе',
    source: 'ТЗ §6 — обрыв обхода — артефакт выгрузки, не «сток»',
  },
  {
    n: 1,
    role: 'coordinator',
    rule: 'и собирает, и раздаёт: плательщиков и получателей достаточно, есть связь с seed (цикл, несколько seed выше по потоку или seed от seed), посредничество высокое',
    source: 'ТЗ: кандидат в организаторы; посредничество — перцентиль среди узлов с входом и выходом',
    chips: [
      { label: 'плательщиков ≥', key: 'coord_in_deg', fmt: num },
      { label: 'получателей ≥', key: 'coord_out_deg', fmt: num },
      { label: 'seed выше по потоку ≥', key: 'coord_seed_up', fmt: num },
      { label: 'посредничество ≥', key: 'coord_betw_thr', fmt: (v) => dec(v, 5) },
    ],
  },
  {
    n: 2,
    role: 'consolidator',
    rule: 'от нескольких плательщиков, дальше уходит меньше трети, вход не мелкий',
    source: 'ТЗ: аккумулирует средства от нескольких участников; пороги — p95 in_deg и отсечка мелких «складчин»',
    chips: [
      { label: 'плательщиков ≥', key: 'cons_in_deg', fmt: num },
      { label: 'пропуск <', key: 'cons_pass_max', fmt: (v) => dec(v) },
      { label: 'вход ≥', key: 'cons_in_kzt', fmt: kzt },
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
    ],
  },
  {
    n: 5,
    role: 'terminal',
    rule: 'колено 1–3 (там исходящие точно выгружались), дальше уходит меньше трети или выхода нет вовсе, вход не мелкий, и это не seed',
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

export default function RulesPage() {
  const { data: meta, error, reload } = useApi(api.meta)
  if (!meta) return <LoadState error={error} reload={reload} />

  return (
    <>
      <PageHeader
        eyebrow="правила v1 · pipeline/RULES.md"
        title="Как назначается роль"
        lede="Каскад проверяется сверху вниз — первое сработавшее правило даёт роль. Каждый порог — либо ориентир из ТЗ, либо перцентиль распределения в данных. Никаких чёрных ящиков и зашитых списков gid."
      />

      <Panel eyebrow="каскад ролей" title="Семь шагов, один проход сверху вниз">
        <ol className="grid gap-6">
          {STEPS.map((s) => (
            <li key={s.n} className="grid grid-cols-[2.5rem_1fr] gap-4 border-b pb-6 last:border-b-0 last:pb-0 md:grid-cols-[2.5rem_minmax(0,1fr)_320px]">
              <span className="font-mono text-xl text-muted-foreground tnum">{s.n}</span>
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <RoleChip role={s.role} />
                  {s.n !== 0 && <span className="font-mono text-xs text-muted-foreground tnum">{num(meta.role_counts[s.role])} узлов с этой ролью</span>}
                </div>
                <p className="text-[13px] text-ink-2">{s.rule}</p>
                {s.chips && (
                  <div className="flex flex-wrap gap-1.5">
                    {s.chips.map((c) => {
                      const v = meta.thresholds[c.key]
                      return (
                        <span key={c.label} className="rounded-md border bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] tnum">
                          {c.label} {v == null ? '…' : c.fmt(v)}
                        </span>
                      )
                    })}
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">{s.source}</p>
              </div>
              <RoleFlow role={s.role} className="col-span-2 self-center md:col-span-1" />
            </li>
          ))}
        </ol>
      </Panel>

      <Panel eyebrow="приоритет · RULES.md §3" title="Кого смотреть первым">
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="grid gap-2 rounded-lg border bg-panel-2/60 p-4 font-mono text-[13px] text-ink-2">
            <div>base = mean( pct(seed_money_in), pct(n_seed_upstream), pct(in_kzt), pct(betweenness) )</div>
            <div>priority = base × role_weight</div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              pct — перцентильный ранг среди всех узлов графа. Для seed вместо pct(in_kzt) берётся pct(out_kzt) — вход у seed занижен.
            </p>
          </div>
          <div className="grid gap-2">
            {ROLES.map((r) => (
              <div key={r} className="grid grid-cols-[7.5rem_minmax(0,1fr)_3rem] items-center gap-3">
                <RoleChip role={r} />
                <Bar value={meta.role_weight[r]} max={1} background={ROLE[r].color} />
                <span className="text-right font-mono text-[13px] tnum">{dec(meta.role_weight[r])}</span>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <Panel eyebrow="кластеры · RULES.md §4" title="Louvain на неориентированной проекции">
        <div className="grid gap-2 text-[13px] text-ink-2">
          <p>
            Вес ребра — сумма переводов в обе стороны, <code className="font-mono">seed={meta.thresholds.louvain_seed}</code>. Метод не видит
            направление денег: кто в кластере собирает, а кто раздаёт — вопрос отдельной интерпретации по составу кластера, не самого Louvain.
          </p>
          <p>Разбиение чувствительно к запуску: при весе по сумме переводов оно самое стабильное из проверенных вариантов.</p>
        </div>
      </Panel>

      <Panel eyebrow="формулировки · RULES.md §6">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <HypTag /> Все роли и кластеры на этом экране и во всём инструменте — гипотезы для проверки аналитиком, не утверждения о причастности.
        </p>
      </Panel>
    </>
  )
}
