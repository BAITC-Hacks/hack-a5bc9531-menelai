import { Eyebrow, GidLink, HypTag, LoadState, PageHeader, Panel, RoleChip } from '@/components/kit'
import { api } from '@/lib/api'
import { dayMonth, dec, kzt, kztShort, num, pct, periodLabel } from '@/lib/format'
import { useApi } from '@/lib/use-api'

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
/** Every calendar day from the first to the last date in the export (UTC). */
const dayRange = (from: string, to: string) => {
  const out: string[] = []
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

export default function TimePage() {
  const { data, error, reload } = useApi(api.time)
  if (!data) return <LoadState error={error} reload={reload} />

  const byDate = new Map(data.daily.map((d) => [d.date, d]))
  const nSorted = [...data.daily].sort((a, b) => a.n - b.n)
  const quintile = new Map(nSorted.map((d, i) => [d.date, Math.min(4, Math.floor((i / nSorted.length) * 5))]))
  const peak = [...data.daily].sort((a, b) => b.n - a.n)[0]
  const maxKzt = Math.max(...data.daily.map((d) => d.kzt))
  const days = data.daily.length ? dayRange(data.daily[0].date, data.daily[data.daily.length - 1].date) : []
  // grid starts on Monday (column 0)
  const startCol = days.length ? (new Date(days[0]).getUTCDay() + 6) % 7 : 0

  return (
    <>
      <PageHeader
        eyebrow="анализ · время"
        title="Переводы по дням"
        lede={
          <>
            Временные паттерны: синхронные переводы — {data.syncPayers}+ плательщиков одному получателю за день, сквозной транзит — деньги уходят
            в течение ≤ {data.fastDays} дн. после поступления.
          </>
        }
      />

      <Panel eyebrow={`календарь · ${days.length ? periodLabel([days[0], days[days.length - 1]]) : '—'}`} title="Активность по дням">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div>
            <div className="mb-2 grid grid-cols-7 gap-1.5">
              {WEEKDAYS.map((w) => (
                <span key={w} className="text-center font-mono text-[11px] text-muted-foreground">
                  {w}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: startCol }, (_, i) => <span key={`pad-${i}`} aria-hidden />)}
              {days.map((date) => {
                const d = byDate.get(date)
                const q = quintile.get(date) ?? 0
                return (
                  <div
                    key={date}
                    title={d ? `${date} · ${kzt(d.kzt)}` : date}
                    className="grid aspect-square min-w-0 place-content-center rounded-md border text-center"
                    style={{ background: `color-mix(in srgb, var(--gold) ${8 + q * 14}%, var(--panel-2))` }}
                  >
                    <span className="font-mono text-[12px] tnum">{Number(date.slice(8, 10))}</span>
                    {d && <span className="font-mono text-[10px] tnum text-ink-2">{num(d.n)}</span>}
                  </div>
                )
              })}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Фон — квинтиль числа переводов за день (светлее = больше). Пиковый день — {dayMonth(peak.date)}: {num(peak.n)} переводов на{' '}
              {kztShort(peak.kzt)}.
            </p>
          </div>

          <div>
            <Eyebrow>сумма переводов по дням</Eyebrow>
            <svg viewBox={`0 0 ${Math.max(10, data.daily.length * 10)} 90`} className="mt-2 w-full" role="img" aria-label="Сумма переводов по дням">
              {data.daily.map((d, i) => {
                const h = maxKzt > 0 ? (d.kzt / maxKzt) * 78 : 0
                return (
                  <g key={d.date}>
                    <title>
                      {dayMonth(d.date)}: {kzt(d.kzt)}
                    </title>
                    <rect x={i * 10} y={80 - h} width={7} height={h} fill="var(--gold)" opacity={d.date === peak.date ? 1 : 0.55} rx={1} />
                  </g>
                )
              })}
              <line x1={0} y1={80.5} x2={310} y2={80.5} stroke="var(--border)" strokeWidth={1} />
            </svg>
          </div>
        </div>
      </Panel>

      <Panel eyebrow={`≥ ${data.syncPayers} плательщиков · один день`} title="Синхронные переводы">
        {data.sync.length === 0 ? (
          <p className="text-sm text-ink-2">Не найдено.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 pl-3 font-normal">
                    Дата
                  </th>
                  <th scope="col" className="py-2 pr-3 font-normal">
                    Получатель
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-normal">
                    Плательщиков
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-normal">
                    Сумма
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.sync.map((s, i) => (
                  <tr key={`${s.date}|${s.dst}|${i}`} className="border-b transition-colors hover:bg-panel-2/60">
                    <td className="py-2 pr-3 pl-3 font-mono tnum">{dayMonth(s.date)}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <GidLink gid={s.dst} short />
                        {s.role ? <RoleChip role={s.role} /> : <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tnum">{num(s.payers)}</td>
                    <td className="py-2 pr-4 text-right font-mono tnum">{kztShort(s.kzt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">Показано {num(data.sync.length)} из {num(data.syncTotal)}.</p>
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <HypTag /> Совпадение по дню — признак координации.
        </p>
      </Panel>

      <Panel eyebrow={`≥ 90 % за ≤ ${data.fastDays} дн.`} title="Сквозной транзит">
        {data.fastTransit.length === 0 ? (
          <p className="text-sm text-ink-2">Транзитных узлов с таким профилем не найдено.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 pl-3 font-normal">
                    gid
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-normal">
                    Получено
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-normal">
                    Отправлено
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-normal">
                    Пропуск
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-normal">
                    Доля ≤ {data.fastDays} дн.
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-normal">
                    Seed выше по потоку
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-normal">
                    Колено
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.fastTransit.map((t) => (
                  <tr key={t.gid} className="border-b transition-colors hover:bg-panel-2/60">
                    <td className="py-2 pr-3 pl-3">
                      <GidLink gid={t.gid} short />
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tnum">{kztShort(t.inKzt)}</td>
                    <td className="py-2 pr-3 text-right font-mono tnum">{kztShort(t.outKzt)}</td>
                    <td className="py-2 pr-3 text-right font-mono tnum">{dec(t.passThrough)}</td>
                    <td className="py-2 pr-3 text-right font-mono tnum">{pct(t.fastShare)}</td>
                    <td className="py-2 pr-3 text-right font-mono tnum">{num(t.seedUp)}</td>
                    <td className="py-2 pr-4 text-right font-mono tnum">{t.depth}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <HypTag /> Сквозной транзит — признак прогона денег.
        </p>
      </Panel>
    </>
  )
}
