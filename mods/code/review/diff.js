import { createHash } from "crypto";

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

export function parseDiff(text) {
  const rows = [];
  let old = 0, now = 0;
  for (const raw of String(text ?? "").split("\n")) {
    const h = HUNK.exec(raw);
    if (h) {
      old = Number(h[1]); now = Number(h[3]);
      rows.push({ kind: "hunk", text: raw, title: h[5] ?? "", oldStart: h[2] === "0" ? old + 1 : old, newStart: h[4] === "0" ? now + 1 : now });
      continue;
    }
    if (raw.startsWith("+")) rows.push({ kind: "add", text: raw.slice(1), new: now, oldPos: old, newPos: now++ });
    else if (raw.startsWith("-")) rows.push({ kind: "del", text: raw.slice(1), old, oldPos: old++, newPos: now });
    else if (raw.startsWith(" ")) rows.push({ kind: "ctx", text: raw.slice(1), old, new: now, oldPos: old++, newPos: now++ });
  }
  return rows;
}

function lastLines(rows, at) {
  let old = 0, now = 0;
  for (let i = at - 1; i >= 0 && (!old || !now); i--) {
    const r = rows[i];
    if (r.kind === "hunk") { if (!old) old = r.oldStart - 1; if (!now) now = r.newStart - 1; break; }
    if (!old && r.old !== undefined) old = r.old;
    if (!now && r.new !== undefined) now = r.new;
  }
  return { old, now };
}

export function gapAt(rows, at, total = null) {
  const hunk = rows[at]?.kind === "hunk" ? rows[at] : null;
  const last = lastLines(rows, at);
  const from = last.now + 1;
  const to = hunk ? hunk.newStart - 1 : total;
  const offset = hunk ? hunk.oldStart - hunk.newStart : last.old - last.now;
  return { from, to, offset, count: to === null || to === undefined ? null : Math.max(0, to - from + 1) };
}

export function expandGap(rows, at, how, lines, step = 20) {
  const g = gapAt(rows, at, lines.length);
  if (!g.count) return null;
  const hunk = rows[at]?.kind === "hunk" ? rows[at] : null;
  const k = how === "all" ? g.count : Math.min(step, g.count);
  const first = how === "up" && hunk ? g.to - k + 1 : g.from;
  const insert = [];
  for (let n = first; n < first + k; n++) {
    insert.push({ kind: "ctx", text: lines[n - 1] ?? "", old: n + g.offset, new: n, oldPos: n + g.offset, newPos: n, expanded: true });
  }
  if (hunk && k === g.count) return { index: at, remove: 1, insert };
  if (hunk && how === "up") return { index: at, remove: 1, insert: [{ ...hunk, oldStart: hunk.oldStart - k, newStart: hunk.newStart - k }, ...insert] };
  return { index: at, remove: 0, insert };
}

export function onRow(position, file, row) {
  if (!position || row.kind === "hunk") return false;
  if (position.new_line) return position.new_path === file.new_path && row.new === position.new_line;
  return position.old_path === file.old_path && row.kind === "del" && row.old === position.old_line;
}

export function lineDiff(before, after) {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  const a = before.slice(head, before.length - tail);
  const b = after.slice(head, after.length - tail);
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const v = new Map([[1, 0]]);
  const trace = [];
  let found = n === 0 && m === 0;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1)) ? v.get(k + 1) ?? 0 : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v.set(k, x);
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  const edits = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vd = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && (vd.get(k - 1) ?? -1) < (vd.get(k + 1) ?? -1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = vd.get(prevK) ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      edits.push("ctx");
      x--;
      y--;
    }
    if (d > 0) edits.push(down ? "add" : "del");
    x = prevX;
    y = prevY;
  }
  edits.reverse();
  const rows = [];
  let old = 1;
  let now = 1;
  for (let i = 0; i < head; i++) rows.push({ kind: "ctx", text: before[i], old: old++, new: now, oldPos: old - 1, newPos: now++ });
  for (const kind of edits) {
    if (kind === "ctx") rows.push({ kind, text: before[old - 1], old: old++, new: now, oldPos: old - 1, newPos: now++ });
    else if (kind === "del") rows.push({ kind, text: before[old - 1], old: old++, oldPos: old - 1, newPos: now });
    else rows.push({ kind, text: after[now - 1], new: now, oldPos: old, newPos: now++ });
  }
  for (let i = 0; i < tail; i++) rows.push({ kind: "ctx", text: before[old - 1], old: old++, new: now, oldPos: old - 1, newPos: now++ });
  return rows;
}

export function excerpt(rows, index, around = 4) {
  return rows.slice(Math.max(0, index - around), index + around + 1)
    .filter((r) => r.kind !== "hunk")
    .map((r) => `${r === rows[index] ? ">" : " "}${r.kind === "add" ? "+" : r.kind === "del" ? "-" : " "} ${r.text}`)
    .join("\n");
}

function rangeEnd(sha, row) {
  return {
    line_code: `${sha}_${row.oldPos}_${row.newPos}`,
    type: row.kind === "add" ? "new" : "old",
    old_line: row.old ?? null,
    new_line: row.new ?? null,
  };
}

export function position(refs, file, row, from = null) {
  const sha = from && from !== row ? createHash("sha1").update(file.new_path).digest("hex") : null;
  return {
    position_type: "text",
    base_sha: refs.base_sha,
    start_sha: refs.start_sha,
    head_sha: refs.head_sha,
    old_path: file.old_path,
    new_path: file.new_path,
    ...(row.old !== undefined ? { old_line: row.old } : {}),
    ...(row.new !== undefined ? { new_line: row.new } : {}),
    ...(sha ? { line_range: { start: rangeEnd(sha, from), end: rangeEnd(sha, row) } } : {}),
  };
}

export function splitRows(rows, start = 0, end = rows.length) {
  const out = [];
  let dels = [], adds = [];
  const flush = () => {
    for (let n = 0; n < Math.max(dels.length, adds.length); n++) out.push({ left: dels[n] ?? null, right: adds[n] ?? null });
    dels = []; adds = [];
  };
  for (let i = start; i < end; i++) {
    const kind = rows[i].kind;
    if (kind === "del") { if (adds.length) flush(); dels.push(i); }
    else if (kind === "add") adds.push(i);
    else { flush(); out.push(kind === "hunk" ? { hunk: i } : { left: i, right: i }); }
  }
  flush();
  return out;
}

const unquote = (p) => (p.startsWith('"') && p.endsWith('"') ? JSON.parse(p) : p);
const side = (p) => unquote(p.replace(/\t.*$/, "")).replace(/^[ab]\//, "");

function headerPaths(rest) {
  const at = rest.indexOf(" b/");
  if (rest.startsWith("a/") && at > 0) return [rest.slice(2, at), rest.slice(at + 3)];
  const [a, b] = rest.split(" ");
  return [side(a ?? ""), side(b ?? a ?? "")];
}

export function splitGitDiff(text) {
  const files = [];
  let cur = null, body = null;
  const close = () => { if (cur) { cur.diff = (body ?? []).join("\n"); files.push(cur); } };
  for (const line of String(text ?? "").split("\n")) {
    const head = /^diff --git (.+)$/.exec(line);
    if (head) {
      close();
      const [old_path, new_path] = headerPaths(head[1]);
      cur = { old_path, new_path, new_file: false, deleted_file: false, renamed_file: false, collapsed: false, too_large: false };
      body = null;
    } else if (!cur) {
      continue;
    } else if (body) {
      body.push(line);
    } else if (line.startsWith("@@")) {
      body = [line];
    } else if (line.startsWith("new file mode")) cur.new_file = true;
    else if (line.startsWith("deleted file mode")) cur.deleted_file = true;
    else if (line.startsWith("rename from ")) { cur.renamed_file = true; cur.old_path = unquote(line.slice(12)); }
    else if (line.startsWith("rename to ")) { cur.renamed_file = true; cur.new_path = unquote(line.slice(10)); }
    else if (line.startsWith("--- ") && line !== "--- /dev/null") cur.old_path = side(line.slice(4));
    else if (line.startsWith("+++ ") && line !== "+++ /dev/null") cur.new_path = side(line.slice(4));
    else if (line.startsWith("Binary files ")) cur.collapsed = true;
  }
  close();
  return files;
}
