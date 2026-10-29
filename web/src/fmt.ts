// Pure formatting helpers. Null in, en dash out, so the page never prints "null" or "NaN".
export const DASH = '–'
const ok = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n)
export const num = (n: number | null | undefined, d = 0) => (ok(n) ? n.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }) : DASH)
export const km = (m: number | null | undefined, d = 1) => (ok(m) ? num(m / 1000, d) : DASH)
export const sgn = (n: number | null | undefined, d = 0) => (ok(n) ? (n > 0 ? '+' : n < 0 ? '−' : '') + num(Math.abs(n), d) : DASH)
/** 27000 -> "7 h 30 min", 2700 -> "45 min" */
export function dur(s: number | null | undefined) {
  if (!ok(s)) return DASH
  const m = Math.round(s / 60), h = Math.floor(m / 60)
  return h ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`
}
/** seconds per km as "5:37" */
export function pace(distM: number | null | undefined, durS: number | null | undefined) {
  if (!ok(distM) || !ok(durS) || distM < 100 || durS <= 0) return DASH
  const p = Math.round(durS / (distM / 1000))
  return `${Math.floor(p / 60)}:${String(p % 60).padStart(2, '0')}`
}
export const clock = (ts: number | null | undefined) => (ok(ts) ? new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : DASH)
/** "2030-06-01" or "2030-06-01 07:00:00" to a local date, no timezone shift */
export function day(s: string | null | undefined, opt: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }) {
  const m = s && /^(\d{4})-(\d\d)-(\d\d)/.exec(s)
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-GB', opt) : DASH
}
export const pct = (v: number, lo: number, hi: number) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))

export const sleepLabel = (score: number | null | undefined) => (!ok(score) ? null : score >= 80 ? 'Good' : score >= 60 ? 'Fair' : 'Poor')
/** Garmin stress scale */
export const stressLabel = (s: number) => (s <= 25 ? 'Resting' : s <= 50 ? 'Low' : s <= 75 ? 'Medium' : 'High')
export const paceWord = (s: string | null | undefined) => (s === 'ahead' ? 'ahead of pace' : s === 'on_pace' ? 'on pace' : s === 'behind' ? 'behind pace' : null)
export const readinessWord = (l: string | undefined) => (l === 'high' ? 'High' : l === 'moderate' ? 'Moderate' : l === 'low' ? 'Low' : l === 'poor' ? 'Poor' : DASH)

export const STATUS_KEY: Record<string, string> = { Productive: 'prod', Maintaining: 'maint', Recovery: 'recov', Overreaching: 'over', Detraining: 'detr' }
/** The API sends only a label, so the plain-sentence reason is built here from its numbers. */
export function statusReason(s: { label: string; acwr: number | null; ramp7: number | null; tsb: number | null; warming_up: boolean }) {
  const r = ok(s.acwr) ? num(s.acwr, 2) : null
  if (s.warming_up || s.label === 'Not enough data') return 'There is not enough history yet to judge your training. This fills in after a few weeks of data.'
  switch (s.label) {
    case 'Productive': return `Your fitness is rising${ok(s.ramp7) ? `, up ${num(s.ramp7, 1)} this week` : ''}${r ? ` and your load ratio is ${r}, inside the safe range` : ''}.`
    case 'Maintaining': return `Your fitness is steady${r ? ` and your load ratio is ${r}` : ''}. You are holding what you have built.`
    case 'Recovery': return 'Load is low and your body is catching up.'
    case 'Overreaching': return `Your load ratio${r ? ` of ${r}` : ''} is above the safe range. Ease off for a few days.`
    case 'Detraining': return 'Load has been low for a while and fitness is slipping. Easy sessions will turn it around.'
    default: return ''
  }
}
