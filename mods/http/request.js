export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
export const WRITE = "\n%{http_code} %{time_total} %{size_download} %{num_redirects}";

export function headerLines(text) {
  return String(text ?? "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && /^[^:\s]+\s*:/.test(l));
}

export function curlArgs({ method, url, headerFile, bodyFile, outFile, headersOut, hasBody, follow = true, timeout = 60 }) {
  const args = ["-q", "--proto", "=http,https", "--proto-redir", "=http,https", "-sS", "-X", method, "--max-time", String(timeout), "-o", outFile, "-D", headersOut, "-w", WRITE];
  if (follow) args.push("-L", "--max-redirs", "5");
  if (headerFile) args.push("-H", `@${headerFile}`);
  if (hasBody && method !== "GET" && method !== "HEAD") args.push("--data-binary", `@${bodyFile}`);
  if (method === "HEAD") args.splice(args.indexOf("-X"), 2, "-I");
  args.push("--", url);
  return args;
}

const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export function curlCommand({ method, url, headers, body }) {
  const parts = ["curl", ...(method === "GET" ? [] : ["-X", method]), quote(url)];
  for (const h of headerLines(headers)) parts.push("-H", quote(h));
  if (String(body ?? "").length && method !== "GET" && method !== "HEAD") parts.push("--data-binary", quote(body));
  return parts.join(" ");
}

export function parseWrite(stdout) {
  const last = String(stdout ?? "").trim().split("\n").pop() ?? "";
  const [code, time, size, redirects] = last.split(" ");
  return { status: Number(code) || 0, ms: Math.round(Number(time) * 1000) || 0, size: Number(size) || 0, redirects: Number(redirects) || 0 };
}

export function parseHeaders(raw) {
  const blocks = String(raw ?? "").replace(/\r/g, "").split(/\n\n+/).filter((b) => /^HTTP\//.test(b.trim()));
  const block = (blocks.at(-1) ?? "").trim().split("\n");
  const statusLine = block.shift() ?? "";
  const headers = block.map((l) => { const i = l.indexOf(":"); return i < 0 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }).filter(Boolean);
  return { statusLine, headers };
}

export function pretty(text, contentType = "") {
  const t = String(text ?? "");
  if (/json/i.test(contentType) || /^\s*[[{]/.test(t)) {
    try { return { kind: "json", text: JSON.stringify(JSON.parse(t), null, 2) }; } catch {}
  }
  return { kind: "text", text: t };
}

export const sizeText = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const encode = (s) => encodeURIComponent(s).replace(/%2C/gi, ",").replace(/%3A/gi, ":").replace(/%2F/gi, "/").replace(/%40/gi, "@").replace(/%5B/gi, "[").replace(/%5D/gi, "]");

export function parseQuery(url) {
  const s = String(url ?? "");
  const hashAt = s.indexOf("#");
  const hash = hashAt < 0 ? "" : s.slice(hashAt + 1);
  const head = hashAt < 0 ? s : s.slice(0, hashAt);
  const qAt = head.indexOf("?");
  const base = qAt < 0 ? head : head.slice(0, qAt);
  const pairs = qAt < 0 ? [] : head.slice(qAt + 1).split("&").filter(Boolean).map((p) => {
    const i = p.indexOf("=");
    return i < 0 ? { key: decode(p), value: "", bare: true } : { key: decode(p.slice(0, i)), value: decode(p.slice(i + 1)) };
  });
  return { base, pairs, hash, hasQuery: qAt >= 0 };
}

export function buildUrl(base, pairs, hash = "") {
  const q = pairs.filter((p) => p.key || p.value).map((p) => (p.bare && !p.value ? encode(p.key) : `${encode(p.key)}=${encode(p.value)}`)).join("&");
  return `${base}${q ? `?${q}` : ""}${hash ? `#${hash}` : ""}`;
}

export function rowsOf(headers) {
  if (Array.isArray(headers)) return headers.map((h) => ({ on: h.on !== false, key: String(h.key ?? ""), value: String(h.value ?? "") }));
  return String(headers ?? "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const on = !l.startsWith("#"), line = on ? l : l.replace(/^#\s*/, "");
    const i = line.indexOf(":");
    return i < 0 ? null : { on, key: line.slice(0, i).trim(), value: line.slice(i + 1).trim() };
  }).filter(Boolean);
}

export const linesOf = (rows) => rows.filter((r) => r.on && r.key.trim()).map((r) => `${r.key.trim()}: ${r.value}`);

export const safeName = (s) => String(s ?? "").replace(/[^\p{L}\p{N}._ -]/gu, "-").replace(/^[.\s]+/, "").trim().slice(0, 80);
