// Dates are stored as local 'YYYY-MM-DD' strings so they compare correctly as text
// and never drift across time zones.

const pad = (n) => String(n).padStart(2, '0');

export function toStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parse(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayStr() {
  return toStr(new Date());
}

export function addDays(s, n) {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return toStr(d);
}

export function daysBetween(a, b) {
  return Math.round((parse(b) - parse(a)) / 86400000);
}

export function fmt(s, opts = { month: 'short', day: 'numeric' }) {
  if (!s) return '—';
  return parse(s).toLocaleDateString(undefined, opts);
}

export function fmtLong(s) {
  return fmt(s, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function weekday(s) {
  return parse(s).getDay(); // 0 = Sunday
}

export function isoToLocalDay(iso) {
  return toStr(new Date(iso));
}
