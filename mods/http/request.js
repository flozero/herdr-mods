export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
export const WRITE = "\n%{http_code} %{time_total} %{size_download} %{num_redirects}";

export const BODY_TYPES = [
  { id: "none", label: "None", type: null },
  { id: "json", label: "JSON", type: "application/json" },
  { id: "text", label: "Text", type: "text/plain" },
  { id: "xml", label: "XML", type: "application/xml" },
  { id: "form", label: "Form", type: "application/x-www-form-urlencoded" },
  { id: "multipart", label: "Multipart", type: null },
];
const BODY_IDS = BODY_TYPES.map((b) => b.id);

export const hasBody = (method) => method !== "GET" && method !== "HEAD";

export function bodyTypeOf(req) {
  if (BODY_IDS.includes(req?.bodyType)) return req.bodyType;
  const b = String(req?.body ?? "");
  if (!b.trim()) return "none";
  try { JSON.parse(b); return "json"; } catch {}
  return /^\s*</.test(b) ? "xml" : "text";
}

export function headerLines(text) {
  return String(text ?? "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && /^[^:\s]+\s*:/.test(l));
}

const VAR = /\{\{\s*([\p{L}\p{N}_.-]+)\s*\}\}/gu;
export const safeVar = (s) => String(s ?? "").trim().replace(/[^\p{L}\p{N}_.-]/gu, "_").slice(0, 60);

export function varsIn(text) {
  return [...String(text ?? "").matchAll(VAR)].map((m) => m[1]);
}

export function substitute(text, vars = {}, missing = null) {
  return String(text ?? "").replace(VAR, (m, n) => {
    if (Object.hasOwn(vars, n)) return String(vars[n]);
    missing?.add(n);
    return m;
  });
}

export function resolve(req, vars = {}) {
  const missing = new Set();
  const sub = (s) => substitute(s, vars, missing);
  const method = METHODS.includes(req.method) ? req.method : "GET";
  const headers = rowsOf(req.headers).filter((r) => r.on && r.key.trim()).map((r) => ({ key: sub(r.key).trim(), value: sub(r.value) }));
  const type = bodyTypeOf(req);
  let data = null, parts = null;
  if (hasBody(method)) {
    if (type === "form") data = rowsOf(req.form).filter((r) => r.on && r.key).map((r) => `${encodeURIComponent(sub(r.key))}=${encodeURIComponent(sub(r.value))}`).join("&");
    else if (type === "multipart") parts = rowsOf(req.form).filter((r) => r.on && r.key).map((r) => {
      const value = sub(r.value);
      return value.startsWith("@") ? { key: sub(r.key), file: value.slice(1) } : { key: sub(r.key), value };
    });
    else if (type !== "none") data = sub(req.body);
    const ct = BODY_TYPES.find((b) => b.id === type)?.type;
    if (ct && !headers.some((h) => h.key.toLowerCase() === "content-type")) headers.push({ key: "Content-Type", value: ct });
  }
  return { method, url: sub(req.url).trim(), headers: headers.map((h) => `${h.key}: ${h.value}`), data, parts, missing: [...missing] };
}

const partKey = (k) => String(k).replace(/[=;\n\r]/g, "_");
const partFile = (p) => `"${String(p).replace(/["\\]/g, "\\$&")}"`;

export function curlArgs({ method, url, headerFile, bodyFile, outFile, headersOut, parts = null, home = "", follow = true, timeout = 60 }) {
  const args = ["-q", "--proto", "=http,https", "--proto-redir", "=http,https", "-sS", "-X", method, "--max-time", String(timeout), "-o", outFile, "-D", headersOut, "-w", WRITE];
  if (follow) args.push("-L", "--max-redirs", "5");
  if (headerFile) args.push("-H", `@${headerFile}`);
  if (hasBody(method)) {
    if (parts) for (const p of parts) {
      if (p.file != null) args.push("-F", `${partKey(p.key)}=@${partFile(home ? String(p.file).replace(/^~(?=\/|$)/, home) : p.file)}`);
      else args.push("--form-string", `${partKey(p.key)}=${p.value}`);
    }
    else if (bodyFile) args.push("--data-binary", `@${bodyFile}`);
  }
  if (method === "HEAD") args.splice(args.indexOf("-X"), 2, "-I");
  args.push("--", url);
  return args;
}

const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export function curlCommand({ method, url, headers, data, parts }) {
  const parts_ = ["curl", ...(method === "GET" ? [] : ["-X", method]), quote(url)];
  for (const h of Array.isArray(headers) ? headers : headerLines(headers)) parts_.push("-H", quote(h));
  if (hasBody(method)) {
    if (parts) for (const p of parts) parts_.push(p.file != null ? "-F" : "--form-string", quote(`${partKey(p.key)}=${p.file != null ? `@${p.file}` : p.value}`));
    else if (String(data ?? "").length) parts_.push("--data-binary", quote(data));
  }
  return parts_.join(" ");
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
  if (/xml|html/i.test(contentType)) return { kind: /html/i.test(contentType) ? "html" : "xml", text: t };
  return { kind: "text", text: t };
}

export function extract(expr, res) {
  const e = String(expr ?? "").trim();
  if (e === "status") return String(res.status);
  const h = /^headers?\.(.+)$/i.exec(e);
  if (h) {
    const v = (res.headers ?? []).filter(([k]) => k.toLowerCase() === h[1].trim().toLowerCase()).at(-1);
    if (!v) throw new Error(`no ${h[1]} header`);
    return v[1];
  }
  const b = /^(?:body|\$)(.*)$/.exec(e);
  if (!b) throw new Error(`"${e}": use status, header.<name>, body or body.<path>`);
  if (!b[1]) return String(res.text ?? "");
  let v;
  try { v = JSON.parse(res.text); } catch { throw new Error("the body isn't JSON"); }
  const seg = /\.([^.[\]]+)|\[(\d+)\]|\["([^"]*)"\]|\['([^']*)'\]/gy;
  let at = 0, m, path = "";
  while (at < b[1].length) {
    seg.lastIndex = at;
    if (!(m = seg.exec(b[1]))) throw new Error(`can't read "${b[1].slice(at)}" in ${e}`);
    at = seg.lastIndex;
    const key = m[1] ?? m[3] ?? m[4] ?? Number(m[2]);
    path += m[0];
    if (v == null || typeof v !== "object" || !(key in v)) throw new Error(`nothing at body${path}`);
    v = v[key];
  }
  return v !== null && typeof v === "object" ? JSON.stringify(v) : String(v);
}

export function setFrom(set, res) {
  const values = {}, errors = [];
  for (const r of rowsOf(set).filter((x) => x.on && x.key.trim())) {
    const name = safeVar(r.key);
    try { values[name] = extract(r.value || "body", res); } catch (e) { errors.push(`${name}: ${e.message}`); }
  }
  return { values, errors };
}

export const sizeText = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const encode = (s) => encodeURIComponent(s).replace(/%2C/gi, ",").replace(/%3A/gi, ":").replace(/%2F/gi, "/").replace(/%40/gi, "@").replace(/%5B/gi, "[").replace(/%5D/gi, "]")
  .replace(/%7B%7B(.*?)%7D%7D/gi, (_m, n) => `{{${decode(n)}}}`);

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
  if (headers && typeof headers === "object") return Object.entries(headers).map(([key, value]) => ({ on: true, key, value: String(value ?? "") }));
  return String(headers ?? "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const on = !l.startsWith("#"), line = on ? l : l.replace(/^#\s*/, "");
    const i = line.indexOf(":");
    return i < 0 ? null : { on, key: line.slice(0, i).trim(), value: line.slice(i + 1).trim() };
  }).filter(Boolean);
}

export const linesOf = (rows) => rows.filter((r) => r.on && r.key.trim()).map((r) => `${r.key.trim()}: ${r.value}`);

export const safeName = (s) => String(s ?? "").replace(/[^\p{L}\p{N}._ -]/gu, "-").replace(/^[.\s]+/, "").trim().slice(0, 80);

export function normalize(h = {}) {
  return {
    method: METHODS.includes(String(h.method ?? "").toUpperCase()) ? String(h.method).toUpperCase() : "GET",
    url: String(h.url ?? ""),
    headers: rowsOf(h.headers),
    paramsOff: rowsOf(h.paramsOff).map(({ key, value }) => ({ key, value })),
    bodyType: bodyTypeOf(h),
    body: String(h.body ?? ""),
    form: rowsOf(h.form),
    set: rowsOf(h.set),
    ...(h.notes ? { notes: String(h.notes) } : {}),
  };
}
