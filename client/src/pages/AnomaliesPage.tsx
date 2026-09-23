import { GidLink, HypTag, LoadState, PageHeader, Panel, RoleChip, SeedTag } from '@/components/kit'
import { ROLE } from '@/lib/roles'
import { api } from '@/lib/api'
import { dec, kzt, num } from '@/lib/format'
import { useApi } from '@/lib/use-api'

// same hop colors as the network screen's «Колено» mode
const DEPTH_COLOR = ['#e66767', '#eda100', '#1baf7a', '#3987e5', '#9085e9']

const W = 720
const H = 220
const PAD_L = 32
const PAD_B = 24
const BAR_GAP = 3

export default function AnomaliesPage() {
  const { data, error, reload } = useApi(api.anomalies)
  if (!data) return <LoadState error={error} reload={reload} />

  const max = Math.max(...data.hist.map((b) => b.n), 1)
  const barW = (W - PAD_L) / data.hist.length - BAR_GAP
  const nearBin = data.hist[0]
  const nextBin = data.hist[1]

  const peripheralShare = data.profile.length
    ? data.profile.filter((p) => p.role === 'peripheral' || p.role === 'terminal').length
    : 0

  return (
    <>
      <PageHeader
        eyebrow="анализ · аномалии"
        title="Аномалии"
        lede="Признаки дробления сумм у порога выгрузки 5 000 ₸ и узлы, чей вход выбивается из своего колена. Это сигналы для проверки, не выводы."
      />

      <Panel eyebrow="гистограмма сумм" title="Дробление: переводы у порога">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Гистограмма сумм переводов у порога 5 000 ₸">
          <line x1={PAD_L} y1={H - PAD_B} x2={W} y2={H - PAD_B} stroke="var(--border)" />
          {data.hist.map((b, i) => {
            const isNear = b.from === 5000
            const isRound = b.from === 10000 || b.from === 15000
            const color = isNear ? 'var(--destructive)' : isRound ? 'var(--muted-foreground)' : 'var(--ink-2)'
            const h = (b.n / max) * (H - PAD_B - 16)
            const x = PAD_L + i * (barW + BAR_GAP)
            const y = H - PAD_B - h
            return (
              <g key={b.from}>
                <rect x={x} y={y} width={barW} height={h} fill={color} opacity={isNear ? 1 : isRound ? 0.3 : 0.5} rx={1.5}>
                  <title>{`${num(b.from)}–${num(b.from + 999)} ₸: ${num(b.n)} переводов`}</title>
                </rect>
                <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="var(--muted-foreground)">
                  {num(b.n)}
                </text>
                <text x={x + barW / 2} y={H - PAD_B + 12} textAnchor="middle" fontSize="8" fontFamily="var(--font-mono)" fill="var(--muted-foreground)">
                  {b.from / 1000}
                </text>
                {isNear && (
                  <text x={x + barW / 2} y={H - 2} textAnchor="middle" fontSize="8" fontFamily="var(--font-mono)" fill="var(--destructive)">
                    у порога
                  </text>
                )}
                {isRound && (
                  <text x={x + barW / 2} y={H - 2} textAnchor="middle" fontSize="8" fontFamily="var(--font-mono)" fill="var(--muted-foreground)">
                    круглые суммы, не признак
                  </text>
                )}
              </g>
            )
          })}
        </svg>
        <p className="mt-2 text-[13px] text-ink-2">
          В бин 5 000–5 999 ₸ попало {num(nearBin.n)} переводов — {nextBin ? `в ${dec(nearBin.n / Math.max(1, nextBin.n), 1)} раза больше` : ''}, чем в
          следующий бин 6 000–6 999 ₸ ({num(nextBin?.n ?? 0)}). Скачок именно у отсечки выгрузки в 5 000 ₸ — повод проверить дробление сумм, чтобы
          не выгружать переводы целиком; всплески на круглых суммах (10 000, 15 000 ₸) — обычная бытовая округлённость, не признак.
        </p>
      </Panel>

      <Panel eyebrow={`≥ 3 перевода 5 000–5 999 ₸ · всего ${num(data.structuringTotal)}`} title="Серии у порога">
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-3 pl-3 font-normal">Отправитель</th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">Переводов</th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">Сумма</th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">Получателей</th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">Дней</th>
              </tr>
            </thead>
            <tbody>
              {data.structuring.map((s) => (
                <tr key={s.src} className="border-b transition-colors last:border-b-0 hover:bg-panel-2/60">
                  <td className="py-2 pr-3 pl-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <GidLink gid={s.src} short />
                      {s.isSeed && <SeedTag />}
                      {s.role && <RoleChip role={s.role} />}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tnum">{num(s.n)}</td>
                  <td className="py-2 pr-3 text-right font-mono tnum">{kzt(s.kzt)}</td>
                  <td className="py-2 pr-3 text-right font-mono tnum">{num(s.dsts)}</td>
                  <td className="py-2 pr-3 text-right font-mono tnum">{num(s.days)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel eyebrow="z-оценка входа внутри колена" title="Вход не по колену">
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-3 pl-3 font-normal">gid</th>
                <th scope="col" className="py-2 pr-3 font-normal">Колено</th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">Получено</th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">Медиана колена</th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">z</th>
                <th scope="col" className="py-2 pr-3 font-normal">Роль</th>
                <th scope="col" className="py-2 pr-3 font-normal">Комментарий</th>
              </tr>
            </thead>
            <tbody>
              {data.profile.map((p) => (
                <tr key={p.gid} className="border-b transition-colors last:border-b-0 hover:bg-panel-2/60">
                  <td className="py-2 pr-3 pl-3">
                    <GidLink gid={p.gid} short />
                  </td>
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-1.5 font-mono text-[12px] tnum text-ink-2">
                      <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: DEPTH_COLOR[p.depth] }} />
                      {p.depth}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tnum">{kzt(p.inKzt)}</td>
                  <td className="py-2 pr-3 text-right font-mono tnum text-muted-foreground">{kzt(p.depthMedian)}</td>
                  <td className="py-2 pr-3 text-right font-mono tnum text-gold">{dec(p.z)}</td>
                  <td className="py-2 pr-3">{p.role && <RoleChip role={p.role} />}</td>
                  <td className="py-2 pr-3 text-ink-2">
                    {num(p.inDeg)} плат., {num(p.outDeg)} получ., пропуск {p.passThrough == null ? '—' : dec(p.passThrough)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 flex items-start gap-2 text-[13px] text-ink-2">
          <HypTag>вопрос к правилам</HypTag>
          <span>
            Из {num(data.profile.length)} показанных узлов {num(peripheralShare)} размечены как «{ROLE.peripheral.label.toLowerCase()}» или «
            {ROLE.terminal.label.toLowerCase()}» — то есть выброс по деньгам не привёл к более заметной роли. Возможно, порогам ролей стоит
            учитывать масштаб входа относительно колена, а не только абсолютные суммы.
          </span>
        </p>
      </Panel>
    </>
  )
}
