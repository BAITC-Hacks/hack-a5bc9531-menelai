import { LoadState, PageHeader, Panel, StatStrip } from '@/components/kit'
import { api } from '@/lib/api'
import { num, pct } from '@/lib/format'
import { useApi } from '@/lib/use-api'

const BUCKETS = ['1', '2', '3+'] as const

async function loadCompleteness() {
  const [analysis, stats] = await Promise.all([api.completeness(), api.stats()])
  return { analysis, stats }
}

export default function CompletenessPage() {
  const { data: result, error, reload } = useApi(loadCompleteness)
  if (!result) return <LoadState error={error} reload={reload} />
  const { analysis: data, stats } = result
  const lastFull = stats.maxDepth - 1

  const requests = [
    {
      what: <>Входящие переводы для {num(data.consolidators)} консолидаторов</>,
      why: 'у консолидаторов виден только вход, посчитанный от seed — их собственные плательщики за пределами обхода не выгружены',
    },
    {
      what: <>Следующее колено ({stats.maxDepth + 1}) для {num(data.truncated)} обрезанных узлов, первыми — получатели {num(data.transitToTruncated)} транзитов</>,
      why: `обход остановлен на глубине ${stats.maxDepth}; получатели транзитных узлов помогут проверить, куда средства могли уйти дальше`,
    },
    {
      what: <>Исходящие {num(data.seedNoOut)} seed-клиентов за расширенный период</>,
      why: 'у этих seed нет исходящих в выгрузке — не ясно, осели деньги или переводы просто не попали в окно',
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow="проверки · полнота данных"
        title="Пробелы в данных"
        lede="Что не видно в выписке и какие данные помогут продолжить проверку. Отсутствие переводов на границе обхода не означает, что средства остались у клиента."
      />

      <StatStrip
        items={[
          { value: num(data.seedNoOut), label: 'seed без исходящих' },
          { value: num(data.truncated), label: `обрыв на колене ${stats.maxDepth}` },
          { value: `≈ ${num(data.expectedContinue)}`, label: 'из них вероятно продолжают', tone: 'var(--gold)' },
          { value: num(data.orphans), label: 'изолированных' },
          { value: '—', label: 'входящие извне — не видны' },
        ]}
      />

      <Panel eyebrow="метод" title="Конечный получатель или граница выгрузки">
        <p className="max-w-[80ch] text-[13px] text-ink-2">
          Для оценки используется предыдущее колено ({lastFull >= 0 ? lastFull : 'не представлено'}): какая доля клиентов с тем или иным числом входящих связей продолжает платить дальше. Эту долю переносим на последнее колено ({stats.maxDepth}), где обход прерван. Это оценка по наблюдаемой выборке, а не подтверждение остатка средств.
        </p>
        <div className="mt-4 overflow-x-auto rounded-lg border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-3 pl-3 font-normal">
                  Входящих связей
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">
                  Доля продолжающих · колено {lastFull >= 0 ? lastFull : '—'}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">
                  Обрыв · колено {stats.maxDepth}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">
                  Ожидаемо продолжают
                </th>
              </tr>
            </thead>
            <tbody>
              {BUCKETS.map((b) => {
                const c = data.pContinue[b]
                const truncated = data.truncatedByIn[b]
                return (
                  <tr key={b} className="border-b transition-colors last:border-b-0 hover:bg-panel-2/60">
                    <td className="py-2 pr-3 pl-3 font-mono tnum">{b}</td>
                    <td className="py-2 pr-3 text-right font-mono tnum">
                      {c.n ? pct(c.share) : 'нет наблюдений'} <span className="text-muted-foreground">· n={num(c.n)}</span>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tnum">{num(truncated)}</td>
                    <td className="py-2 pr-3 text-right font-mono tnum text-gold">{num(Math.round(truncated * c.share))}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel eyebrow="следующий шаг" title="Рекомендуемые запросы в банк">
        <ol className="grid gap-3">
          {requests.map((r, i) => (
            <li key={i} className="grid grid-cols-[1.75rem_1fr] gap-3 rounded-lg border bg-panel-2/40 p-3.5">
              <span className="font-mono text-[13px] font-semibold text-gold tnum">{i + 1}</span>
              <div className="grid gap-1">
                <p className="text-[13px] font-medium">{r.what}</p>
                <p className="text-xs text-muted-foreground">{r.why}</p>
              </div>
            </li>
          ))}
        </ol>
      </Panel>
    </>
  )
}

