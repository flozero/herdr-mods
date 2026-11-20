export function splitDetails(text) {
  const out = [];
  const re = /<details>\s*(?:<summary>([\s\S]*?)<\/summary>)?([\s\S]*?)<\/details>/gi;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ kind: "md", text: text.slice(last, m.index) });
    out.push({ kind: "details", summary: (m[1] ?? "Details").replace(/<[^>]+>/g, "").trim() || "Details", text: m[2].trim() });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ kind: "md", text: text.slice(last) });
  return out.filter((s) => s.kind === "details" || s.text.trim());
}

function outsideCode(text, fn) {
  return text.split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((part, i) => (i % 2 ? part : fn(part))).join("");
}

export function gitlabLinks(text, projectUrl, host = "https://gitlab.com") {
  return outsideCode(text, (s) => s
    .replace(/!\[([^\]]*)\]\((\/uploads\/[^)\s]+)\)/g, (_m, alt, path) => `[🖼 ${alt || "image"}](${projectUrl}${path})`)
    .replace(/\]\((\/uploads\/[^)\s]+)\)/g, (_m, path) => `](${projectUrl}${path})`)
    .replace(/\]\((\/[^)\s]*)\)/g, (_m, path) => `](${host}${path})`)
    .replace(/(^|[\s(,;:])!(\d+)(?![\w\]])/g, (_m, pre, n) => `${pre}[!${n}](${projectUrl}/-/merge_requests/${n})`)
    .replace(/(^|[\s(,;:])#(\d+)(?![\w\]])/g, (_m, pre, n) => `${pre}[#${n}](${projectUrl}/-/issues/${n})`)
    .replace(/(^|[\s(,;:])@([A-Za-z0-9][\w.-]*[\w])(?![\w\]])/g, (_m, pre, user) => `${pre}[@${user}](${host}/${user})`));
}
