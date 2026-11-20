import { exec, home, appHome, readTextFile } from "herdr";
import * as fs from "fs/promises";
import { ApiError } from "./api.js";


const AUTHORIZE = "https://linear.app/oauth/authorize";
const TOKEN = "https://api.linear.app/oauth/token";
export const REDIRECT = "http://localhost:47821/callback";
export const SCOPES = "read,issues:create,comments:create";
const SKEW_MS = 120000;

const tokenDir = () => `${home()}/.config/herdr-linear`;
const tokenFile = () => `${tokenDir()}/oauth.json`;
const tmpDir = () => `${appHome()}/mods/linear/.cache`;

async function shell(script, ...args) {
  const r = await exec("sh", ["-c", script, "sh", ...args]);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || "command failed");
  return r.stdout.trim();
}

const query = (params) => Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

export function scopesOf(tokens) {
  const s = tokens?.scope;
  return (Array.isArray(s) ? s : String(s ?? "").split(/[,\s]+/)).filter(Boolean);
}

export function parseCallback(text) {
  const s = String(text ?? "").trim();
  const pick = (name) => {
    const m = new RegExp(`[?&#]${name}=([^&#\\s]+)`).exec(s);
    return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : null;
  };
  if (pick("error")) return { error: pick("error_description") ?? pick("error") };
  const code = pick("code") ?? (/^[A-Za-z0-9._~-]{16,}$/.test(s) ? s : null);
  return { code, state: pick("state") };
}

async function tokenRequest(params) {
  let res;
  try {
    res = await fetch(TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: query(params),
    });
  } catch (e) {
    throw new ApiError("network", String(e?.message ?? e));
  }
  let body = null;
  try { body = JSON.parse(await res.text()); } catch {}
  if (!res.ok || !body?.access_token) {
    const why = body?.error_description ?? body?.error ?? `HTTP ${res.status}`;
    throw new ApiError(res.status === 400 || res.status === 401 ? "auth" : "network", why);
  }
  return body;
}

export class OAuth {
  constructor(clientId) {
    this.clientId = clientId;
    this.tokens = null;
    this.pending = null;
    this.refreshing = null;
  }

  async read() {
    try {
      const t = JSON.parse((await readTextFile(tokenFile())) ?? "null");
      return t?.clientId === this.clientId && t.access_token ? t : null;
    } catch { return null; }
  }

  async load() {
    this.tokens = await this.read();
    return this.tokens;
  }

  header() { return this.tokens ? `Bearer ${this.tokens.access_token}` : null; }

  scopes() { return scopesOf(this.tokens); }

  stale() { return !this.tokens || (this.tokens.expiresAt ?? 0) - Date.now() < SKEW_MS; }

  async begin() {
    const verifier = await shell("openssl rand -hex 48");
    const challenge = await shell(`printf %s "$1" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '='`, verifier);
    const state = await shell("openssl rand -hex 16");
    this.pending = { verifier, state };
    return `${AUTHORIZE}?${query({
      client_id: this.clientId, redirect_uri: REDIRECT, response_type: "code", scope: SCOPES,
      state, code_challenge: challenge, code_challenge_method: "S256", prompt: "consent",
    })}`;
  }

  async finish(pasted) {
    const p = this.pending;
    if (!p) throw new Error("no sign-in in progress");
    const { code, state, error } = parseCallback(pasted);
    if (error) throw new Error(error);
    if (!code) throw new Error("no code in what was pasted");
    if (state && state !== p.state) throw new Error("this address belongs to another sign-in");
    const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: this.clientId, code_verifier: p.verifier });
    this.pending = null;
    await this.save(t);
    return this.header();
  }

  async fresh() {
    if (!this.stale()) return this.header();
    return this.refresh();
  }

  refresh() {
    this.refreshing ??= this.renew().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async renew() {
    const disk = await this.read();
    if (disk && disk.access_token !== this.tokens?.access_token && (disk.expiresAt ?? 0) - Date.now() > SKEW_MS) {
      this.tokens = disk;
      return this.header();
    }
    const refreshToken = (disk ?? this.tokens)?.refresh_token;
    if (!refreshToken) throw new ApiError("auth", "signed out");
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: this.clientId });
    await this.save({ refresh_token: refreshToken, ...t });
    return this.header();
  }

  async save(t) {
    const tokens = {
      clientId: this.clientId,
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? null,
      scope: scopesOf(t).join(","),
      expiresAt: Date.now() + (Number(t.expires_in) || 86400) * 1000,
    };
    const tmp = `${tmpDir()}/oauth.tmp`;
    await shell('mkdir -p "$1" && chmod 700 "$1"', tmpDir());
    await fs.writeFile(tmp, JSON.stringify(tokens));
    await shell('umask 077 && mkdir -p "$1" && cat "$2" > "$1/oauth.json.new" && mv -f "$1/oauth.json.new" "$1/oauth.json"; s=$?; rm -f "$2"; exit $s', tokenDir(), tmp);
    this.tokens = tokens;
  }

  async signOut() {
    this.tokens = null;
    this.pending = null;
    await shell('rm -f "$1"', tokenFile());
  }
}
