#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { execFile } from "node:child_process";
import { blankDocument, draw, update, remove, clear, summarize, changes } from "./scene.mjs";
import { projectOf, drawingPath } from "./where.mjs";

const INSTRUCTIONS = `A live Excalidraw canvas in Herdr, beside this terminal. open_canvas first: it shows the drawing next to you and the person sees every change as you make it. A named drawing is kept in ~/.herdr/drawings/<project>/, the project being this repository (its worktrees share it) or the current folder.
Coordinates are pixels, x to the right and y down. Shapes default to 160x80; leave about 80px between shapes and lay them out on a grid.
Give shapes short readable ids ("api", "db") so arrows can join them with from/to; an arrow follows its shapes when they move.
The person draws too and their edits are saved to the same file: read_canvas gives the whole drawing and what the person changed since you last read or drew (added, removed, moved, resized, relabeled, recolored, rewired). Call it before changing a drawing the person may have touched, and when they say they changed something.`;

let current = null;
let seen = [];

const look = async () => summarize((await readDoc(current)).elements ?? []);

const shapeSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["rectangle", "ellipse", "diamond", "text", "arrow", "line"] },
    id: { type: "string", description: "Your id for it, to join arrows or update it later" },
    x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" },
    text: { type: "string", description: "Label inside a shape or on an arrow, or the text of a text element (\\n for new lines)" },
    color: { type: "string", description: "Stroke color, e.g. #1e1e1e, #e03131, #2f9e44, #1971c2" },
    fill: { type: "string", description: "Background color, e.g. #a5d8ff, #b2f2bb, #ffec99, #ffc9c9" },
    dashed: { type: "boolean" },
    fontSize: { type: "number" },
    from: { type: "string", description: "Arrow or line: id of the shape it starts from" },
    to: { type: "string", description: "Arrow or line: id of the shape it ends at" },
    x2: { type: "number", description: "Arrow or line without from/to: end x" },
    y2: { type: "number", description: "Arrow or line without from/to: end y" },
  },
  required: ["type"],
};

const TOOLS = [
  { name: "open_canvas", description: "Open a drawing beside this terminal in Herdr, creating it if needed. Later calls draw in it.",
    inputSchema: { type: "object", properties: {
      name: { type: "string", description: "A name for the drawing, kept in ~/.herdr/drawings/<project>/" },
      path: { type: "string", description: "Or the path of a .excalidraw file (absolute, or relative to the working directory)" },
    } } },
  { name: "read_canvas", description: "What is on the canvas now (one entry per shape: id, position, size, text, colors, arrow ends) and what the person changed since you last read or drew.",
    inputSchema: { type: "object", properties: {} } },
  { name: "draw", description: "Add shapes, text and arrows. Shapes come first in the list, then the arrows that join them.",
    inputSchema: { type: "object", properties: { shapes: { type: "array", items: shapeSchema } }, required: ["shapes"] } },
  { name: "update_shape", description: "Move, resize, recolor or relabel one shape; its label and arrows follow.",
    inputSchema: { type: "object", properties: {
      id: { type: "string" }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" },
      text: { type: "string" }, color: { type: "string" }, fill: { type: "string" },
    }, required: ["id"] } },
  { name: "delete_shapes", description: "Delete shapes by id, with their labels and the arrows bound to them.",
    inputSchema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } }, required: ["ids"] } },
  { name: "clear_canvas", description: "Delete everything on the canvas (undo in the canvas brings it back).",
    inputSchema: { type: "object", properties: {} } },
];

const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024 }, (e, stdout, stderr) => (e ? reject(new Error(String(stderr || e.message).trim())) : resolve(stdout)));
});

async function readDoc(file) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch (e) { if (e.code === "ENOENT") return blankDocument(); throw e; }
}

async function writeDoc(file, doc) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  await fs.rename(tmp, file);
}

async function project() {
  let common = "";
  try { common = (await run("git", ["-C", process.cwd(), "rev-parse", "--path-format=absolute", "--git-common-dir"])).trim(); } catch {}
  return projectOf(common, process.cwd());
}

async function resolvePath({ name, path: p }) {
  if (p) return path.resolve(String(p).replace(/^~(?=\/|$)/, os.homedir()));
  return drawingPath(os.homedir(), await project(), name);
}

async function myPane() {
  const term = process.env.HC_TERMINAL_ID;
  if (!term) return null;
  const ls = JSON.parse(await run("herdr-app", ["ls"]));
  for (const s of ls.spaces ?? []) for (const t of s.tabs ?? []) for (const x of t.terminals ?? []) if (x.terminal === term) return x.pane;
  return null;
}

async function openCanvas(args) {
  const file = await resolvePath(args);
  if (!file.endsWith(".excalidraw")) throw new Error("the file must end in .excalidraw");
  try { await fs.access(file); } catch { await writeDoc(file, blankDocument()); }
  const already = current === file;
  current = file;
  if (!already) seen = await look();
  if (!already) {
    const pane = await myPane();
    await run("herdr-app", ["do", "pane.split", JSON.stringify({ direction: "right", ...(pane ? { pane } : {}), mod: "excalidraw", props: { file } })]);
  }
  return `${already ? "Already open" : "Opened"} beside you: ${file}`;
}

async function change(fn) {
  if (!current) throw new Error("open_canvas first");
  const doc = await readDoc(current);
  const out = fn(doc.elements ?? []);
  doc.elements = out.elements ?? out;
  await writeDoc(current, doc);
  seen = summarize(doc.elements);
  return out;
}

async function call(name, args = {}) {
  if (name === "open_canvas") return openCanvas(args);
  if (name === "read_canvas") {
    if (!current) throw new Error("open_canvas first");
    const shapes = await look();
    const since = changes(seen, shapes);
    seen = shapes;
    return JSON.stringify({ shapes, changedByThePersonSinceYourLastLook: since ?? "nothing" });
  }
  if (name === "draw") { const r = await change((els) => draw(els, args.shapes ?? [])); return `Drew ${r.created.join(", ")}`; }
  if (name === "update_shape") { const { id, ...patch } = args; await change((els) => update(els, id, patch)); return `Updated ${id}`; }
  if (name === "delete_shapes") { await change((els) => remove(els, args.ids ?? [])); return `Deleted ${(args.ids ?? []).join(", ")}`; }
  if (name === "clear_canvas") { await change((els) => clear(els)); return "Cleared"; }
  throw new Error(`unknown tool ${name}`);
}

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return;
  if (method === "initialize") {
    return send({ jsonrpc: "2.0", id, result: {
      protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} },
      serverInfo: { name: "herdr-excalidraw", version: "1" }, instructions: INSTRUCTIONS,
    } });
  }
  if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (method === "tools/call") {
    try {
      const text = await call(params?.name, params?.arguments ?? {});
      return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
    } catch (e) {
      return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(e?.message ?? e) }], isError: true } });
    }
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method ${method}` } });
}

const queue = [];
let busy = false;
async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) await handle(queue.shift()).catch(() => {});
  busy = false;
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  try { queue.push(JSON.parse(line)); } catch { return; }
  pump();
});
