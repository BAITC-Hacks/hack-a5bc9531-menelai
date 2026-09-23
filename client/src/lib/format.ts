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
