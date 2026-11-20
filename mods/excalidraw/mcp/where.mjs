const last = (p) => String(p ?? "").replace(/\/+$/, "").split("/").pop();

export const safe = (s) => String(s ?? "").replace(/[^\p{L}\p{N}._ -]/gu, "-").replace(/^\.+/, "").trim() || "drawings";

export const drawingsRoot = (home) => `${String(home).replace(/\/+$/, "")}/.herdr/drawings`;

export function projectOf(commonDir, cwd) {
  const dir = String(commonDir ?? "").trim().replace(/\/+$/, "");
  if (dir) {
    const name = last(dir) === ".git" ? last(dir.slice(0, dir.lastIndexOf("/"))) : last(dir).replace(/\.git$/, "");
    if (name) return safe(name);
  }
  return safe(last(cwd) || "drawings");
}

export function drawingPath(home, project, name) {
  const base = safe(name || "sketch");
  return `${drawingsRoot(home)}/${safe(project)}/${base.endsWith(".excalidraw") ? base : `${base}.excalidraw`}`;
}
