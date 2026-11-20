const WORD = /[\p{L}\p{N}._-]/u;
const fold = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function editPoint(prev, next) {
  let a = 0;
  while (a < prev.length && a < next.length && prev[a] === next[a]) a++;
  let b = 0;
  while (b < prev.length - a && b < next.length - a && prev[prev.length - 1 - b] === next[next.length - 1 - b]) b++;
  return next.length - b;
}

export function mentionAt(text, cursor) {
  const m = text.slice(0, cursor).match(/(?:^|[\s(])@([\p{L}\p{N}._-]{0,40})$/u);
  if (!m) return null;
  let end = cursor;
  while (end < text.length && WORD.test(text[end])) end++;
  return { start: cursor - m[1].length - 1, end, query: m[1] };
}

export function rankPeople(people, query, preferred = new Set(), max = 6) {
  const q = fold(query);
  const scored = [];
  for (const p of people) {
    const names = [fold(p.displayName), fold(p.name), ...`${fold(p.name)} ${fold(p.displayName)}`.split(/[\s._-]+/)];
    const score = !q ? 1 : names.some((n) => n.startsWith(q)) ? 0 : names.some((n) => n.includes(q)) ? 1 : null;
    if (score === null) continue;
    scored.push([score - (preferred.has(p.id) ? 0.5 : 0), p]);
  }
  return scored.sort((a, b) => a[0] - b[0] || String(a[1].name).localeCompare(String(b[1].name))).slice(0, max).map(([, p]) => p);
}

export function insertMention(text, at, displayName) {
  const tail = text.slice(at.end);
  const insert = `@${displayName}${tail.startsWith(" ") ? "" : " "}`;
  return { text: text.slice(0, at.start) + insert + tail, cursor: at.start + insert.length };
}
