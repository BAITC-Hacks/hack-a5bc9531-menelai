import { useState } from 'react'
import { LoadState, PageHeader, Segmented, StatStrip } from '@/components/kit'
import { api, type ResiliencePoint } from '@/lib/api'
import { num, pct } from '@/lib/format'
import { useApi } from '@/lib/use-api'

const W = 640
const H = 200
const PAD_L = 40
const PAD_R = 12
const PAD_T = 24
const PAD_B = 24

export default function ResiliencePage() {
  const { data, error, reload } = useApi(api.resilience)
  const [n, setN] = useState<number | null>(10)

  if (!data) return <LoadState error={error} reload={reload} />

  const selected = data.find((p) => p.N === n) ?? data[0]
  const before = data[0]

  return (
    <>
      <PageHeader
        eyebrow="проверки · сценарии"
        title="Устойчивость сети"
        lede="Как изменится связность, если исключить клиентов из начала очереди проверки. Сценарий «что если» использует слабую связность без учёта направления переводов и не является рекомендацией к действию."
      />

      <Segmented
        value={String(selected.N)}
        onChange={(v) => setN(Number(v))}
        options={data.map((p) => ({ value: String(p.N), label: p.N === 0 ? 'вся сеть' : `топ-${p.N}` }))}
      />

      <StatStrip
        items={[
          { value: `${num(before.components)} → ${num(selected.components)}`, label: 'фрагментов (≥ 2 узлов)' },
          { value: `${num(before.largestNodes)} → ${num(selected.largestNodes)}`, label: 'крупнейший фрагмент, узлов' },
          { value: `${pct(before.largestShare)} → ${pct(selected.largestShare)}`, label: 'доля оборота в крупнейшем' },
          { value: pct(selected.removedShare), label: 'оборот исключённых связей', tone: 'var(--gold)' },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <ResilienceChart
          data={data}
          selectedN={selected.N}
          value={(p) => p.largestShare}
          format={pct}
          title="Доля оборота в крупнейшем фрагменте"
        />
        <ResilienceChart
          data={data}
          selectedN={selected.N}
          value={(p) => p.components}
          format={num}
          title="Число фрагментов"
        />
      </div>
    </>
  )
}

function ResilienceChart({
  data,
  selectedN,
  value,
  format,
  title,
}: {
  data: ResiliencePoint[]
  selectedN: number
  value: (p: ResiliencePoint) => number
  format: (n: number) => string
  title: string
}) {
  const max = Math.max(...data.map(value)) || 1
  const x = (i: number) => PAD_L + (i / (data.length - 1)) * (W - PAD_L - PAD_R)
  const y = (v: number) => PAD_T + (1 - v / max) * (H - PAD_T - PAD_B)
  const points = data.map((p, i) => [x(i), y(value(p))] as const)
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ')

  return (
    <div className="rounded-xl border bg-card p-4">
      <h2 className="mb-3 text-[13px] font-semibold">{title}</h2>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}>
        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="var(--border)" />
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="var(--border)" />
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            {t > 0 && <line x1={PAD_L} y1={y(max * t)} x2={W - PAD_R} y2={y(max * t)} stroke="var(--border)" strokeDasharray="2 4" />}
            <text x={PAD_L - 6} y={y(max * t) + 3} textAnchor="end" fontSize="9" fontFamily="var(--font-mono)" fill="var(--muted-foreground)">
              {format(max * t)}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="var(--ink-2)" strokeWidth={1.75} />
        {data.map((p, i) => {
          const isSelected = p.N === selectedN
          return (
            <g key={p.N}>
              <circle cx={x(i)} cy={y(value(p))} r={isSelected ? 5 : 3} fill={isSelected ? 'var(--gold)' : 'var(--ink-2)'}>
                <title>{`топ-${p.N}: ${format(value(p))}`}</title>
              </circle>
              {isSelected && (
                <text x={x(i)} y={y(value(p)) - 10} textAnchor="middle" fontSize="11" fontFamily="var(--font-mono)" fill="var(--gold)">
                  {format(value(p))}
                </text>
              )}
              <text x={x(i)} y={H - PAD_B + 14} textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="var(--muted-foreground)">
                {p.N}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
