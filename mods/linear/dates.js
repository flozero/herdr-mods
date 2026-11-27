// Due dates: Linear wants a plain YYYY-MM-DD, in local time.

const pad2 = (n) => String(n).padStart(2, "0");
export const isoDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
// A typed date: 2026-12-03, 3/12 or 3/12/2026 (day first), or a bare day of this month.
export function parseDay(text, now = new Date()) {
  const s = String(text ?? "").trim();
  let y, m, d, r;
  if ((r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [y, m, d] = [r[1], r[2], r[3]].map(Number);
  else if ((r = s.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/))) { d = +r[1]; m = +r[2]; y = r[3] ? (r[3].length === 2 ? 2000 + +r[3] : +r[3]) : now.getFullYear(); }
  else if ((r = s.match(/^(\d{1,2})$/))) { d = +r[1]; m = now.getMonth() + 1; y = now.getFullYear(); }
  else return null;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? isoDay(date) : null;
}
