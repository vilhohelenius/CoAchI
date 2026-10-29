// Calendar-date helpers on YYYY-MM-DD strings. UTC math only, so no DST surprises.
const D = 864e5
export const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`)
export const addDays = (d: string, n: number) => new Date(toMs(d) + n * D).toISOString().slice(0, 10)
export const diffDays = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / D)
/** Monday = 0 ... Sunday = 6 */
export const dow = (d: string) => (new Date(toMs(d)).getUTCDay() + 6) % 7
export const weekStart = (d: string) => addDays(d, -dow(d))
export const range = (a: string, b: string) => Array.from({ length: Math.max(0, diffDays(a, b) + 1) }, (_, i) => addDays(a, i))
export const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN)
/** Sample standard deviation. */
export const sd = (xs: number[]) => {
  if (xs.length < 2) return NaN
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}
export const clamp = (x: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x))
export const r2 = (x: number | null | undefined, p = 2) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** p) / 10 ** p)
