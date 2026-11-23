export function parsePages(text) {
  try { return JSON.parse(text); } catch {}
  const out = [];
  let depth = 0, start = -1, inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "[" || c === "{") { if (depth++ === 0) start = i; }
    else if ((c === "]" || c === "}") && --depth === 0) {
      const page = JSON.parse(text.slice(start, i + 1));
      if (Array.isArray(page)) out.push(...page); else out.push(page);
    }
  }
  return out;
}
