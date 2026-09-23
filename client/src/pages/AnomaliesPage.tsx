import { GidLink, HypTag, LoadState, PageHeader, Panel, RoleChip } from '@/components/kit'
import { ROLE } from '@/lib/roles'
import { api } from '@/lib/api'
import { dec, kzt, num } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { depthColor } from '@/lib/depth'

export default function AnomaliesPage() {
  const { data, error, reload } = useApi(api.anomalies)
  if (!data) return <LoadState error={error} reload={reload} />

  const peripheralShare = data.profile.length
    ? data.profile.filter((p) => p.role === 'peripheral' || p.role === 'terminal').length
    : 0

  return (
    <>
      <PageHeader
        eyebrow="проверки · профиль клиента"
        title="Нетипичные поступления"
        lede="Клиенты с наибольшим отклонением поступлений от профиля своего колена. Сравнение использует z-оценку логарифма входящей суммы, без изменения присвоенных ролей."
      />

      <Panel eyebrow="z-оценка входа внутри колена" title="Поступления относительно своего колена">
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
                      <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: depthColor(p.depth) }} />
                      {p.depth}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tnum">{kzt(p.inKzt)}</td>
                  <td className="py-2 pr-3 text-right font-mono tnum text-muted-foreground">{kzt(p.depthMedian)}</td>
                  <td className="py-2 pr-3 text-right font-mono tnum text-gold">{dec(p.z)}</td>
                  <td className="py-2 pr-3">{p.role && <RoleChip role={p.role} />}</td>
                  <td className="py-2 pr-3 text-ink-2">
                    {num(p.inDeg)} плат., {num(p.outDeg)} получ., пропуск {p.depth === 0 ? 'недостоверно для seed' : p.depth === 4 ? 'неизвестно' : p.passThrough == null ? '—' : dec(p.passThrough)}
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
