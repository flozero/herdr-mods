export const HERDR_EDITOR = "Herdr editor";

export const EDITORS = ["Visual Studio Code", "Cursor", "Windsurf", "Zed", "Sublime Text", "PyCharm", "PyCharm CE", "IntelliJ IDEA", "GoLand", "WebStorm", "Nova"];

const slug = (branch) => branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

export function parseWorktrees(porcelain) {
  return porcelain.split(/\n\n+/).map((block) => block.split("\n")).flatMap((lines) => {
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path || lines.some((l) => l === "bare" || l.startsWith("prunable"))) return [];
    const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
    return [{ path, branch }];
  });
}

export async function branchCheckout(exec, top, branch, userHome) {
  const ok = async (cwd, args) => (await exec("git", args, { cwd })).code === 0;
  const git = async (cwd, args) => {
    const r = await exec("git", args, { cwd });
    if (r.code !== 0) throw new Error((r.stderr || r.stdout || "").trim().split("\n").pop() || `git ${args[0]} failed`);
    return r.stdout;
  };
  const list = parseWorktrees(await git(top, ["worktree", "list", "--porcelain"]));
  const have = list.find((w) => w.branch === branch);
  const main = list[0]?.path ?? top;
  if (have) return { path: have.path, created: false, main };
  const local = `${main}/.claude/worktrees`;
  const root = (await exec("test", ["-d", local])).code === 0 ? local : `${userHome}/.herdr/worktrees/${main.split("/").pop()}`;
  const path = `${root}/${slug(branch)}`;
  await git(main, ["fetch", "--quiet", "origin", branch]);
  if (await ok(main, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])) {
    if (await ok(main, ["merge-base", "--is-ancestor", branch, `origin/${branch}`])) await git(main, ["branch", "-f", branch, `origin/${branch}`]);
    await git(main, ["worktree", "add", path, branch]);
  } else {
    await git(main, ["worktree", "add", "--track", "-b", branch, path, `origin/${branch}`]);
  }
  return { path, created: true, main };
}

export async function installedEditors(exec) {
  const found = await Promise.all(EDITORS.map(async (app) => (await exec("open", ["-Ra", app])).code === 0));
  return EDITORS.filter((_, n) => found[n]);
}

export const openIn = (exec, app, path) => exec("open", ["-a", app, path]);

const commands = (value) => (Array.isArray(value) ? value : typeof value === "string" && value.trim() ? [value] : []).map(String);
const readJsonFile = async (readFile, file) => {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return {};
  }
};

export async function worktreeSetup({ exec, readFile, appHome, userHome, main, path, branch }) {
  const mine = (await readJsonFile(readFile, `${appHome}/settings.json`)).worktrees ?? {};
  const project = (await readJsonFile(readFile, `${main}/.herdr/settings.json`)).worktrees ?? {};
  const expand = (p) => p.replace(/^~(?=\/|$)/, userHome).replace(/\/+$/, "");
  const key = Object.keys(mine.repos ?? {}).find((k) => expand(k) === main);
  const here = { ...(key ? mine.repos[key] : {}), ...project };
  const steps = [...commands(mine.setup), ...commands(here.setup)];
  if (!steps.length) return { code: 0, stdout: "", stderr: "" };
  const script = ['export HERDR_WORKTREE_REPO="$1" HERDR_WORKTREE_PATH="$2" HERDR_WORKTREE_BRANCH="$3"; shift 3', ...steps.map((c) => `{\n${c}\n} || exit $?`)].join("\n");
  return exec("/bin/sh", ["-c", script, "sh", main, path, branch], { cwd: path, timeout: 600_000 });
}
