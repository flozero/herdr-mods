// A drawing as SVG, for export_png: the shapes, arrows and text of an Excalidraw scene, drawn
// plainly (no hand-drawn strokes). rsvg-convert turns it into a PNG.

const MARGIN = 24;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const paint = (c, fallback) => (!c || c === "transparent" ? fallback : c);

function bounds(els) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const e of els) {
    const pts = e.points?.length ? e.points.map(([px, py]) => [e.x + px, e.y + py]) : [[e.x, e.y], [e.x + (e.width ?? 0), e.y + (e.height ?? 0)]];
    for (const [px, py] of pts) { x1 = Math.min(x1, px); y1 = Math.min(y1, py); x2 = Math.max(x2, px); y2 = Math.max(y2, py); }
  }
  return Number.isFinite(x1) ? { x1, y1, x2, y2 } : { x1: 0, y1: 0, x2: 100, y2: 100 };
}

function stroke(e) {
  const dash = e.strokeStyle === "dashed" ? ' stroke-dasharray="8 6"' : e.strokeStyle === "dotted" ? ' stroke-dasharray="2 5"' : "";
  return `stroke="${esc(paint(e.strokeColor, "#1e1e1e"))}" stroke-width="${e.strokeWidth ?? 2}"${dash}`;
}

function shape(e, byId = {}, bg = "#ffffff") {
  const fill = `fill="${esc(paint(e.backgroundColor, "none"))}"`;
  if (e.type === "rectangle") {
    const r = e.roundness ? Math.min(12, Math.min(e.width, e.height) / 4) : 0;
    return `<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="${r}" ${fill} ${stroke(e)}/>`;
  }
  if (e.type === "ellipse") return `<ellipse cx="${e.x + e.width / 2}" cy="${e.y + e.height / 2}" rx="${e.width / 2}" ry="${e.height / 2}" ${fill} ${stroke(e)}/>`;
  if (e.type === "diamond") {
    const cx = e.x + e.width / 2, cy = e.y + e.height / 2;
    return `<polygon points="${cx},${e.y} ${e.x + e.width},${cy} ${cx},${e.y + e.height} ${e.x},${cy}" ${fill} ${stroke(e)}/>`;
  }
  if (e.type === "arrow" || e.type === "line") {
    const pts = (e.points ?? [[0, 0], [e.width ?? 0, e.height ?? 0]]).map(([px, py]) => [e.x + px, e.y + py]);
    const line = `<polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" ${stroke(e)} stroke-linecap="round" stroke-linejoin="round"/>`;
    if (e.type === "line" || pts.length < 2) return line;
    const heads = [];
    if (e.endArrowhead !== null) heads.push(head(pts.at(-2), pts.at(-1), e));
    if (e.startArrowhead) heads.push(head(pts[1], pts[0], e));
    return [line, ...heads].join("");
  }
  if (e.type === "text") {
    const size = e.fontSize ?? 20, lh = size * (e.lineHeight ?? 1.25);
    const lines = String(e.text ?? "").split("\n");
    const anchor = e.textAlign === "center" ? "middle" : e.textAlign === "right" ? "end" : "start";
    const x = anchor === "middle" ? e.x + e.width / 2 : anchor === "end" ? e.x + e.width : e.x;
    const top = e.y + (lh - size) / 2 + size * 0.85;
    const spans = lines.map((l, i) => `<tspan x="${x}" y="${top + i * lh}">${esc(l) || " "}</tspan>`).join("");
    const onArrow = byId[e.containerId]?.type === "arrow";
    const plate = onArrow ? `<rect x="${e.x - 4}" y="${e.y - 2}" width="${e.width + 8}" height="${e.height + 4}" fill="${esc(bg)}"/>` : "";
    return `${plate}<text font-family="Helvetica, Arial, sans-serif" font-size="${size}" fill="${esc(paint(e.strokeColor, "#1e1e1e"))}" text-anchor="${anchor}">${spans}</text>`;
  }
  return "";
}

// Two strokes back from the tip, 25° off the last segment.
function head([ax, ay], [bx, by], e) {
  const a = Math.atan2(by - ay, bx - ax), len = 14, spread = (25 * Math.PI) / 180;
  const wing = (d) => `${bx - len * Math.cos(a + d)},${by - len * Math.sin(a + d)}`;
  return `<polyline points="${wing(spread)} ${bx},${by} ${wing(-spread)}" fill="none" stroke="${esc(paint(e.strokeColor, "#1e1e1e"))}" stroke-width="${e.strokeWidth ?? 2}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

const ORDER = { rectangle: 0, ellipse: 0, diamond: 0, line: 1, arrow: 1, text: 2 };

export function toSvg(doc) {
  const els = (doc?.elements ?? []).filter((e) => !e.isDeleted && e.type in ORDER);
  const b = bounds(els);
  const w = Math.ceil(b.x2 - b.x1 + MARGIN * 2), h = Math.ceil(b.y2 - b.y1 + MARGIN * 2);
  const bg = paint(doc?.appState?.viewBackgroundColor, "#ffffff");
  const byId = Object.fromEntries(els.map((e) => [e.id, e]));
  const body = [...els].sort((a, c) => ORDER[a.type] - ORDER[c.type]).map((e) => shape(e, byId, bg)).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${b.x1 - MARGIN} ${b.y1 - MARGIN} ${w} ${h}">
<rect x="${b.x1 - MARGIN}" y="${b.y1 - MARGIN}" width="${w}" height="${h}" fill="${esc(bg)}"/>
${body}
</svg>
`;
}
