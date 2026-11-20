export const TABS = ["mine", "team", "all"];
export const PERIODS = ["24h", "7d", "14d", "30d", "90d"];
export const SORTS = ["date", "freq", "new", "user"];

export function target(text, webUrl) {
  const s = String(text ?? "").trim();
  if (!s) return null;
  const url = s.match(/^https?:\/\/[^\s]*\/issues\/([^/?#\s]+)/);
  if (url) return { issueUrl: s };
  if (/^\d{6,}$/.test(s)) return { issueUrl: `${webUrl}/issues/${s}/` };
  if (/^[A-Za-z][A-Za-z0-9-]*-[0-9A-Za-z]{1,8}$/.test(s) && /\d/.test(s)) return { issueId: s.toUpperCase() };
  return null;
}

export function shortIdIn(texts, slugs) {
  const keys = [...new Set(slugs.map((x) => String(x).toUpperCase()))].sort((a, b) => b.length - a.length);
  for (const text of texts) {
    const up = String(text ?? "").toUpperCase();
    for (const key of keys) {
      const at = up.search(new RegExp(`(^|[^A-Z0-9])${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-([0-9A-Z]{1,8})(?![A-Z0-9])`));
      if (at < 0) continue;
      const m = up.slice(at).match(new RegExp(`${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-([0-9A-Z]{1,8})`));
      if (m && /\d/.test(m[1])) return `${key}-${m[1]}`;
    }
  }
  return null;
}

export function queryFor(tab, { team, environment }, text = "") {
  const base = ["is:unresolved"];
  if (tab === "mine") base.push("assigned_or_suggested:me");
  if (tab === "team" && team) base.push(`assigned_or_suggested:#${team}`);
  if (environment) base.push(`environment:${environment}`);
  return [...base, String(text).trim()].filter(Boolean).join(" ");
}

export function ago(iso, now = Date.now()) {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / (86400 * 30))}mo`;
}

export const count = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n ?? 0));
