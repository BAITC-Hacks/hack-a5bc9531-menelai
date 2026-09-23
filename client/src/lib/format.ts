const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })

/** 4217500 → "4 217 500" */
export const num = (x: number) => nf.format(x)
/** 4217500 → "4 217 500 ₸" */
export const kzt = (x: number) => `${nf.format(x)} ₸`
/** 4217500 → "4,2 млн ₸"; below a million → full amount */
export const kztShort = (x: number) =>
  x >= 1e6 ? `${(x / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн ₸` : kzt(x)
/** 0.9917 → "0,99" */
export const dec = (x: number | null | undefined, digits = 2) =>
  x == null || Number.isNaN(x)
    ? '—'
    : x.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits })
/** 0.62 → "62 %" */
export const pct = (x: number | null | undefined) =>
  x == null || Number.isNaN(x) ? '—' : `${Math.round(x * 100)} %`
/** "…3684369100": last ten digits are enough to tell nodes apart visually */
export const gidTail = (gid: string) => `…${gid.slice(-10)}`
/** "2026-07-13" → "13.07" */
export const dayMonth = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`
/** ["2026-07-01","2026-07-31"] → "01.07–31.07.2026" */
export const periodLabel = (p: [string, string]) => `${dayMonth(p[0])}–${dayMonth(p[1])}.${p[1].slice(0, 4)}`
/** Russian plural: plural(4, 'колено', 'колена', 'колен') → "колена" */
export const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10, h = n % 100
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many
}
