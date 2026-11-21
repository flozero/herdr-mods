import { lineWidth } from "./metrics.mjs";

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);
const GAP = 6;
const FONT = 20;

const rint = () => Math.floor(Math.random() * 2 ** 31);
const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);

export function blankDocument() {
  return { type: "excalidraw", version: 2, source: "herdr-excalidraw-mcp", elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {} };
}

export function textSize(text, fontSize = FONT) {
  const lines = String(text).split("\n");
  return { width: Math.ceil(Math.max(...lines.map((l) => lineWidth(l, fontSize)), 1)), height: Math.ceil(lines.length * fontSize * 1.25) };
}

function base(type, o, id) {
  return {
    id, type, x: Number(o.x ?? 0), y: Number(o.y ?? 0), width: Number(o.width ?? 0), height: Number(o.height ?? 0), angle: 0,
    strokeColor: o.color ?? "#1e1e1e", backgroundColor: o.fill ?? "transparent", fillStyle: "solid",
    strokeWidth: 2, strokeStyle: o.dashed ? "dashed" : "solid", roughness: 1, opacity: 100,
    groupIds: [], frameId: null, roundness: SHAPES.has(type) && type !== "ellipse" ? { type: 3 } : type === "arrow" || type === "line" ? { type: 2 } : null,
    seed: rint(), version: 1, versionNonce: rint(), isDeleted: false, boundElements: [], updated: Date.now(), link: null, locked: false,
  };
}

function textElement(text, o, id, container = null) {
  const fontSize = Number(o.fontSize ?? FONT);
  const size = textSize(text, fontSize);
  const at = container ? centerOf(container) : null;
  return {
    ...base("text", { ...o, fill: "transparent" }, id), ...size,
    x: at ? at.x - size.width / 2 : Number(o.x ?? 0), y: at ? at.y - size.height / 2 : Number(o.y ?? 0),
    text: String(text), originalText: String(text), fontSize, fontFamily: 5,
    textAlign: container ? "center" : o.align ?? "left", verticalAlign: container ? "middle" : "top",
    containerId: container?.id ?? null, autoResize: true, lineHeight: 1.25,
  };
}

const centerOf = (e) => (e.type === "arrow" || e.type === "line")
  ? { x: e.x + (e.points?.at(-1)?.[0] ?? 0) / 2, y: e.y + (e.points?.at(-1)?.[1] ?? 0) / 2 }
  : { x: e.x + e.width / 2, y: e.y + e.height / 2 };

export function edgePoint(e, toward) {
  const c = centerOf(e), hw = e.width / 2, hh = e.height / 2;
  const dx = toward.x - c.x, dy = toward.y - c.y;
  if (!dx && !dy) return c;
  let t;
  if (e.type === "ellipse") t = 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2);
  else if (e.type === "diamond") t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  const len = Math.hypot(dx, dy);
  const out = t * len + GAP;
  return { x: c.x + (dx / len) * out, y: c.y + (dy / len) * out };
}

function route(arrow, from, to) {
  const a = from ? edgePoint(from, centerOf(to ?? from)) : { x: arrow.x, y: arrow.y };
  const b = to ? edgePoint(to, centerOf(from ?? to)) : { x: arrow.x + (arrow.points?.at(-1)?.[0] ?? 0), y: arrow.y + (arrow.points?.at(-1)?.[1] ?? 0) };
  arrow.x = a.x;
  arrow.y = a.y;
  arrow.points = [[0, 0], [b.x - a.x, b.y - a.y]];
  arrow.width = Math.abs(b.x - a.x);
  arrow.height = Math.abs(b.y - a.y);
}

const bump = (e) => { e.version = (e.version ?? 1) + 1; e.versionNonce = rint(); e.updated = Date.now(); };
const live = (elements) => elements.filter((e) => !e.isDeleted);
const labelOf = (elements, e) => live(elements).find((x) => x.type === "text" && x.containerId === e.id) ?? null;

export function draw(elements, shapes) {
  const byId = new Map(live(elements).map((e) => [e.id, e]));
  const taken = new Set(elements.map((e) => e.id));
  const fresh = (want) => (want && !taken.has(String(want)) ? String(want) : rid());
  const created = [], out = [...elements];
  const add = (e) => { out.push(e); byId.set(e.id, e); taken.add(e.id); };
  for (const s of shapes.filter((x) => x.type !== "arrow" && x.type !== "line")) {
    const id = fresh(s.id);
    if (s.type === "text") { add(textElement(s.text ?? "", s, id)); created.push(id); continue; }
    if (!SHAPES.has(s.type)) throw new Error(`unknown shape type: ${s.type}`);
    const label = s.text ? textSize(s.text, s.fontSize ?? FONT) : { width: 0, height: 0 };
    const shape = base(s.type, { ...s, width: s.width ?? Math.max(160, label.width + 40), height: s.height ?? Math.max(80, label.height + 30) }, id);
    add(shape);
    if (s.text) {
      const t = textElement(s.text, s, fresh(), shape);
      shape.boundElements.push({ type: "text", id: t.id });
      add(t);
    }
    created.push(id);
  }
  for (const s of shapes.filter((x) => x.type === "arrow" || x.type === "line")) {
    const from = s.from ? byId.get(String(s.from)) : null, to = s.to ? byId.get(String(s.to)) : null;
    if (s.from && !from) throw new Error(`no shape with id ${s.from}`);
    if (s.to && !to) throw new Error(`no shape with id ${s.to}`);
    const id = fresh(s.id);
    const arrow = {
      ...base(s.type, s, id),
      points: [[0, 0], [Number(s.x2 ?? s.x ?? 0) - Number(s.x ?? 0), Number(s.y2 ?? s.y ?? 0) - Number(s.y ?? 0)]],
      lastCommittedPoint: null, startArrowhead: null, endArrowhead: s.type === "arrow" ? "arrow" : null,
      startBinding: from ? { elementId: from.id, focus: 0, gap: GAP } : null, endBinding: to ? { elementId: to.id, focus: 0, gap: GAP } : null,
    };
    route(arrow, from, to);
    if (from) from.boundElements = [...(from.boundElements ?? []), { type: "arrow", id }];
    if (to) to.boundElements = [...(to.boundElements ?? []), { type: "arrow", id }];
    add(arrow);
    if (s.text) {
      const t = textElement(s.text, { ...s, fontSize: s.fontSize ?? 16 }, fresh(), arrow);
      arrow.boundElements.push({ type: "text", id: t.id });
      add(t);
    }
    created.push(id);
  }
  return { elements: out, created };
}

export function update(elements, id, patch) {
  const byId = new Map(live(elements).map((e) => [e.id, e]));
  const e = byId.get(String(id));
  if (!e) throw new Error(`no shape with id ${id}`);
  for (const k of ["x", "y", "width", "height"]) if (patch[k] !== undefined) e[k] = Number(patch[k]);
  if (patch.color !== undefined) e.strokeColor = patch.color;
  if (patch.fill !== undefined) e.backgroundColor = patch.fill;
  bump(e);
  let label = e.type === "text" ? e : labelOf(elements, e);
  if (!label && patch.text !== undefined && patch.text !== "") {
    label = textElement(patch.text, { fontSize: e.type === "arrow" ? 16 : FONT }, rid(), e);
    e.boundElements = [...(e.boundElements ?? []), { type: "text", id: label.id }];
    elements.push(label);
  }
  if (label && patch.text !== undefined) {
    Object.assign(label, { text: String(patch.text), originalText: String(patch.text), ...textSize(patch.text, label.fontSize) });
    bump(label);
  }
  if (label && label !== e) {
    const c = centerOf(e);
    label.x = c.x - label.width / 2;
    label.y = c.y - label.height / 2;
    bump(label);
  }
  for (const a of live(elements).filter((x) => x.startBinding?.elementId === e.id || x.endBinding?.elementId === e.id)) {
    route(a, byId.get(a.startBinding?.elementId), byId.get(a.endBinding?.elementId));
    bump(a);
  }
  return elements;
}

export function remove(elements, ids) {
  const gone = new Set(ids.map(String));
  for (const e of live(elements)) {
    if (e.startBinding && gone.has(e.startBinding.elementId)) gone.add(e.id);
    if (e.endBinding && gone.has(e.endBinding.elementId)) gone.add(e.id);
  }
  for (const e of live(elements)) {
    if (gone.has(e.id) || (e.containerId && gone.has(e.containerId))) { e.isDeleted = true; bump(e); }
  }
  return elements;
}

export function clear(elements) {
  for (const e of live(elements)) { e.isDeleted = true; bump(e); }
  return elements;
}

export function summarize(elements) {
  const all = live(elements);
  return all.filter((e) => !(e.type === "text" && e.containerId)).map((e) => {
    const label = e.type === "text" ? e.text : labelOf(all, e)?.text;
    return {
      id: e.id, type: e.type, x: Math.round(e.x), y: Math.round(e.y), width: Math.round(e.width), height: Math.round(e.height),
      ...(label ? { text: label } : {}),
      ...(e.strokeColor && e.strokeColor !== "#1e1e1e" ? { color: e.strokeColor } : {}),
      ...(e.backgroundColor && e.backgroundColor !== "transparent" ? { fill: e.backgroundColor } : {}),
      ...(e.startBinding ? { from: e.startBinding.elementId } : {}),
      ...(e.endBinding ? { to: e.endBinding.elementId } : {}),
    };
  });
}

const FIELDS = ["x", "y", "width", "height", "text", "color", "fill", "from", "to"];

export function changes(before, after) {
  const was = new Map(before.map((e) => [e.id, e]));
  const now = new Map(after.map((e) => [e.id, e]));
  const added = after.filter((e) => !was.has(e.id));
  const removed = before.filter((e) => !now.has(e.id)).map((e) => ({ id: e.id, type: e.type, ...(e.text ? { text: e.text } : {}) }));
  const changed = [];
  for (const e of after) {
    const old = was.get(e.id);
    if (!old) continue;
    const diff = {};
    for (const k of FIELDS) {
      const a = old[k], b = e[k];
      const moved = typeof a === "number" && typeof b === "number" ? Math.abs(a - b) >= 2 : a !== b;
      if (moved) diff[k] = { was: a ?? null, now: b ?? null };
    }
    if (Object.keys(diff).length) changed.push({ id: e.id, type: e.type, ...(e.text ? { text: e.text } : {}), changes: diff });
  }
  return added.length || removed.length || changed.length ? { added, removed, changed } : null;
}
