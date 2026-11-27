import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { draw, textSize, blankDocument } from "../mods/excalidraw/mcp/scene.mjs";
import { lineWidth } from "../mods/excalidraw/mcp/metrics.mjs";

const mod = join(dirname(fileURLToPath(import.meta.url)), "../mods/excalidraw");

test("lineWidth is Excalifont's, not a flat 0.6 em per character", () => {
  // Measured on fonts/Excalifont-Regular.ttf.
  assert.ok(Math.abs(lineWidth("Herdr (fenêtre)", 18) - 133) < 1);
  assert.ok(Math.abs(lineWidth("terminal 1 : claude", 18) - 155) < 1);
  assert.ok(lineWidth("iiiiiiii", 20) < lineWidth("WWWWWWWW", 20) / 2, "narrow and wide letters differ");
  assert.equal(lineWidth("", 20), 0);
});

test("a glyph Excalifont lacks, or a wide one, is not measured as zero", () => {
  assert.ok(lineWidth("→", 20) >= 0.6 * 20);
  assert.equal(lineWidth("日", 20), 20);
});

test("textSize takes the widest line and counts every line's height", () => {
  const { width, height } = textSize("ab\nabcdef\nabc", 20);
  assert.equal(width, Math.ceil(lineWidth("abcdef", 20)));
  assert.equal(height, 3 * 25);
});

test("a label is centred in its shape and fits inside it", () => {
  const { elements } = draw(blankDocument().elements, [
    { id: "a", type: "rectangle", x: 400, y: 900, width: 210, height: 50, text: "Herdr (fenêtre)", fontSize: 18 },
    { id: "b", type: "ellipse", x: 20, y: 30, text: "two\nlines" },
  ]);
  for (const id of ["a", "b"]) {
    const shape = elements.find((e) => e.id === id);
    const label = elements.find((e) => e.containerId === id);
    assert.ok(label, `${id} has a label`);
    assert.equal(label.x + label.width / 2, shape.x + shape.width / 2);
    assert.equal(label.y + label.height / 2, shape.y + shape.height / 2);
    assert.ok(label.width <= shape.width && label.height <= shape.height);
    assert.equal(label.textAlign, "center");
    assert.equal(label.verticalAlign, "middle");
  }
});

test("a shape sized from its label is no wider than the text needs", () => {
  const text = "terminal 1 : claude";
  const { elements } = draw([], [{ id: "t", type: "rectangle", x: 0, y: 0, text, fontSize: 18 }]);
  const shape = elements.find((e) => e.id === "t");
  assert.equal(shape.width, Math.max(160, Math.ceil(lineWidth(text, 18)) + 40));
});

test("paths are drawn at the canvas zoom only: Herdr zooms a path's lengths itself", () => {
  const src = readFileSync(join(mod, "main.js"), "utf8");
  assert.match(src, /pathScale\(\) \{\s*return this\.vz;\s*\}/);
  // The scale handed to buildLayers (the paths) must not carry Herdr's zoom, or shapes end up
  // zoom times larger than the text on them.
  const body = (name) => src.slice(src.indexOf(`  ${name}(`), src.indexOf("\n  }\n", src.indexOf(`  ${name}(`)));
  for (const fn of ["rebuild", "renderLive"]) {
    assert.match(body(fn), /this\.pathScale\(\)/, `${fn} draws with pathScale()`);
    assert.doesNotMatch(body(fn), /this\.scale\(\)/, `${fn} does not use the pointer scale for paths`);
  }
});

test("export: the shapes, arrows and labels as SVG, a label on an arrow over a plate", async () => {
  const { toSvg } = await import("../mods/excalidraw/mcp/svg.mjs");
  const S = await import("../mods/excalidraw/mcp/scene.mjs");
  const doc = S.blankDocument();
  const r = S.draw([], [{ type: "rectangle", id: "a", x: 0, y: 0, text: "A <b>" }, { type: "diamond", id: "b", x: 300, y: 0, text: "B" },
    { type: "arrow", from: "a", to: "b", text: "yes", dashed: true }]);
  doc.elements = r.elements ?? r;
  const svg = toSvg(doc);
  assert.match(svg, /<rect [^>]*rx=/);
  assert.match(svg, /<polygon /);
  assert.match(svg, /stroke-dasharray/);
  assert.match(svg, /A &lt;b&gt;/);
  assert.equal((svg.match(/<polyline /g) ?? []).length, 2);
  assert.ok(svg.indexOf('fill="#ffffff"/><text') > 0);
});
