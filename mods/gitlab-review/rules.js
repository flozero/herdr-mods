const WILDCARDS = /[*?[]/;

export async function fetchRules(url) {
  if (!url) return [];
  if (!/^https:\/\//i.test(url)) throw new Error("review rules: rulesUrl must start with https://");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`review rules: HTTP ${res.status}`);
  return JSON.parse(await res.text()).rule_sets ?? [];
}

function segmentPattern(segment) {
  let out = "";
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else if (c === "[") {
      const end = segment.indexOf("]", i + 1);
      if (end < 0) { out += "\\["; continue; }
      out += `[${segment.slice(i + 1, end).replace(/^!/, "^")}]`;
      i = end;
    } else out += c.replace(/[.+^${}()|\\]/g, "\\$&");
  }
  return out;
}

export function globRegex(glob) {
  const parts = glob.split("/").filter(Boolean);
  let re = "";
  parts.forEach((part, n) => {
    const last = n === parts.length - 1;
    if (part === "**") re += last ? ".*" : "(?:[^/]+/)*";
    else re += segmentPattern(part) + (last ? "" : "/");
  });
  return new RegExp(`^${re}$`);
}

function specificity(glob) {
  const parts = glob.split("/").filter(Boolean);
  return [-parts.filter((p) => !WILDCARDS.test(p)).length, parts.filter((p) => p === "**").length, -glob.length];
}

const bySpecificity = (a, b) => {
  const [x, y] = [specificity(a), specificity(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

export function matchRules(rules, paths) {
  return rules.map((rule) => {
    const globs = rule.globs.filter((g) => paths.some((p) => globRegex(g).test(p))).sort(bySpecificity);
    const files = paths.filter((p) => globs.some((g) => globRegex(g).test(p)));
    return { rule, globs, files };
  })
    .filter((m) => m.globs.length)
    .sort((a, b) => bySpecificity(a.globs[0], b.globs[0]) || a.rule.page_title.localeCompare(b.rule.page_title));
}
