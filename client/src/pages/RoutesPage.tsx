import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { ArrowRightIcon, RotateCcwIcon } from 'lucide-react'
import { Bar, GidLink, HypTag, LoadState, PageHeader, Panel, RoleChip, StatStrip } from '@/components/kit'
import { api, type Cycle } from '@/lib/api'
import { kztShort, num } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

export default function RoutesPage() {
  const { data, error, reload } = useApi(api.routes)
  const { hash } = useLocation()
  useEffect(() => {
    if (data && (hash === '#chains' || hash === '#cycles')) {
      document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' })
    }
  }, [data, hash])
  if (!data) return <LoadState error={error} reload={reload} />

  // most common intermediary among the shown chains (plain count, not a role signal)
  const byB = new Map<string, number>()
  for (const c of data.chains) byB.set(c.b, (byB.get(c.b) ?? 0) + 1)
  const topB = [...byB].sort((a, b) => b[1] - a[1])[0]

  const lens = Object.keys(data.byLen)
    .map(Number)
    .sort((a, b) => a - b)
  const maxLen = Math.max(...Object.values(data.byLen))

  return (
    <>
      <PageHeader
        eyebrow="проверки · структура переводов"
        title="Цепочки и круговые потоки"
        lede={
          <>
            Повторяющаяся цепочка A → B → C: B переводит C в течение 0–{data.windowDays} дн. после поступления от A. Совпадения считаются по
            разным переводам на обоих звеньях (меньшее из двух чисел), нужно ≥ 2 — один перевод B → C не делает цепочку «повторяющейся».
            Циклы — простые направленные, длиной ≤ {data.cycleMaxLen}.
          </>
        }
      />

      <StatStrip
        items={[
          { value: num(data.chainsTotal), label: 'устойчивых цепочек' },
          { value: num(data.cyclesTotal), label: 'циклов' },
          { value: num(data.byLen['2'] ?? 0), label: 'взаимных A⇄B' },
          { value: num(data.byLen['3'] ?? 0), label: 'треугольников' },
        ]}
      />

      <section id="chains" className="min-w-0 scroll-mt-28"><Panel eyebrow="повторяемость маршрута" title="Устойчивые цепочки">
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-3 pl-3 font-normal">
                  Маршрут
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">
                  Совпадений
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">
                  A → B
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">
                  B → C
                </th>
              </tr>
            </thead>
            <tbody>
              {data.chains.map((c, i) => (
                <tr key={`${c.a}|${c.b}|${c.c}`} className="border-b transition-colors hover:bg-panel-2/60">
                  <td className="py-2 pr-3 pl-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <GidLink gid={c.a} short />
                      <ArrowRightIcon className="size-3.5 text-muted-foreground" aria-hidden />
                      <span className="inline-flex items-center gap-1.5 rounded-md border bg-panel-2 px-1.5 py-0.5">
                        <GidLink gid={c.b} short />
                      </span>
                      {c.bRole && <RoleChip role={c.bRole} />}
                      <ArrowRightIcon className="size-3.5 text-muted-foreground" aria-hidden />
                      <GidLink gid={c.c} short />
                    </div>
                  </td>
                  <td className={cn('py-2 pr-3 text-right font-mono text-base font-semibold tnum', i < 3 && 'text-gold')}>{c.hits}</td>
                  <td className="py-2 pr-3 text-right font-mono text-[13px] tnum text-ink-2">
                    {kztShort(c.abKzt)} · {num(c.abN)}
                  </td>
                  <td className="py-2 pr-4 text-right font-mono text-[13px] tnum text-ink-2">
                    {kztShort(c.bcKzt)} · {num(c.bcN)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Показано {num(data.chains.length)} из {num(data.chainsTotal)}.
        </p>
        {topB && (
          <p className="mt-2 flex flex-wrap items-start gap-2 text-[13px] text-ink-2">
            <HypTag />
            <span>
              {num(topB[1])} из {num(data.chains.length)} показанных цепочек идут через самого частого посредника <GidLink gid={topB[0]} short /> —
              повторяемый маршрут, признак устойчивой схемы.
            </span>
          </p>
        )}
      </Panel></section>

      <div id="cycles" className="grid min-w-0 scroll-mt-28 gap-4 lg:grid-cols-3">
        <Panel eyebrow="длина цикла" title="Циклы по длине">
          <div className="grid gap-3">
            {lens.map((len) => (
              <div key={len} className="grid gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[13px] text-muted-foreground tnum">
                    {len}
                    {(len === 2 || len === 3) && <span className="ml-1.5 text-[11px]">{len === 2 ? '· взаимные' : '· треугольники'}</span>}
                  </span>
                  <span className="font-mono text-[13px] tnum">{num(data.byLen[len] ?? 0)}</span>
                </div>
                <Bar value={data.byLen[len] ?? 0} max={maxLen} background="var(--gold)" />
              </div>
            ))}
          </div>
        </Panel>

        <CyclePanel eyebrow="взаимные переводы" title="Взаимные переводы A⇄B" cycles={data.mutual} />
        <CyclePanel eyebrow="простые циклы · длина 3" title="Треугольники A→B→C→A" cycles={data.triangles} />
      </div>
    </>
  )
}

function CyclePanel({ eyebrow, title, cycles }: { eyebrow: string; title: string; cycles: Cycle[] }) {
  return (
    <Panel eyebrow={eyebrow} title={title}>
      {cycles.length === 0 ? (
        <p className="text-sm text-ink-2">Не найдено.</p>
      ) : (
        <ol className="grid gap-2.5">
          {cycles.map((c) => (
            <li key={c.path.join('>')} className="flex flex-wrap items-center gap-3 border-b pb-2.5 last:border-b-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-1.5">
                {c.path.map((gid, i) => (
                  <span key={gid} className="flex items-center gap-1.5">
                    {i > 0 && <ArrowRightIcon className="size-3 text-muted-foreground" aria-hidden />}
                    <GidLink gid={gid} short />
                  </span>
                ))}
                <RotateCcwIcon className="size-3 text-muted-foreground" aria-hidden />
              </div>
              <span className="ml-auto font-mono text-[13px] tnum text-ink-2">{kztShort(c.minKzt)} · мин. по кругу</span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <HypTag /> Цикл — основание для проверки. Минимум сумм по звеньям не доказывает движение одних и тех же средств.
      </p>
    </Panel>
  )
}
