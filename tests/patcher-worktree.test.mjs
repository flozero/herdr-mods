import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = process.env.HERDR_APP_HOME ?? join(homedir(), ".config/herdr-app");
const patcherSource = readFileSync(join(here, "../mods/patcher/main.js"), "utf8");
const PATCHES = JSON.parse(patcherSource.match(/const PATCHES = (\[[^\]]*\]);/)[1]);
const ORIGINALS = ["mods/worktree", "mods/menu", "mods/new-menu", "mods/spaces", "mods/tabs", "mods/workspace-status", "layouts/main.json"];
const haveHerdr = ORIGINALS.every((p) => existsSync(join(app, p)));

function patched() {
  const root = mkdtempSync(join(tmpdir(), "patcher-test-"));
  for (const p of ORIGINALS) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    cpSync(join(app, p), join(root, p), { recursive: true });
  }
  for (const name of PATCHES) {
    const r = spawnSync("git", ["apply", join(here, "../mods/patcher/patches", `${name}.patch`)], { cwd: root, encoding: "utf8", env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(root) } });
    if (r.status !== 0) throw new Error(`${name}.patch: ${r.stderr}`);
  }
  return root;
}
const built = haveHerdr ? patched() : null;
process.on("exit", () => built && rmSync(built, { recursive: true, force: true }));
const sourceOf = (mod) => readFileSync(join(built, "mods", mod, "main.js"), "utf8").replace(/^import .*;\n/gm, "").replace(/^export (default )?/gm, "");

function element() {
  const node = { id: "", children: [] };
  const el = new Proxy(node, { get: (_, method) => {
    if (method === "node") return node;
    return (...args) => {
      if (method === "id") node.id = args[0];
      if (method === "child") node.children.push(args[0]?.node ?? args[0]);
      if (method === "children") node.children.push(...args[0].map((child) => child?.node ?? child));
      if (method === "when" && args[0]) args[1](el);
      return el;
    };
  } });
  return el;
}
const textOf = (node) => (typeof node === "string" ? node : (node?.children ?? []).map(textOf).join(" "));

function inputState(value = "") {
  const handlers = {};
  return { on: (event, f) => { handlers[event] = f; }, value: () => value, set_value: (v) => { value = v; }, focus() {}, handlers };
}

const repo = { name: "repo", main: "/home/user/code/repo", top: "/home/user/code/repo", linked: false };

function harness({ settings = null, files = {}, extra = {}, reply = () => undefined, spaceList = [], paneList = [] } = {}) {
  const writes = [];
  const executions = [];
  const notices = [];
  const store = {};
  const globals = {
    View: class {}, div: element, v_flex: element, h_flex: element, svg: element, image: element,
    Input: { new: () => { const el = element(); el.node.input = true; return el; } }, Scrollbar: { vertical: element }, InputState: { new: (o) => inputState(o?.value ?? "") }, theme: () => ({}),
    appHome: () => "/app", home: () => "/home/user",
    readTextFile: async (path) => (path === "/app/settings.json" ? settings && JSON.stringify(settings) : files[path] ?? null),
    spaces: () => structuredClone(spaceList), panes: () => structuredClone(paneList),
    props: () => ({ overlay: "overlay", ...extra }), closeOverlay: () => {},
    run: (command, args) => writes.push([command, args]),
    exec: async (command, args, options) => {
      executions.push({ command, args, ...options });
      const listed = command === "git" && args.includes("worktree") && args.includes("list")
        ? { code: 0, stdout: `worktree ${worktree.repo.top}\nHEAD 0000000\nbranch refs/heads/feature\n` }
        : { code: 0 };
      return { stdout: "", stderr: "", ...(reply(command, args) ?? listed) };
    },
    notice: (n) => notices.push(n), notify: (n) => notices.push(n),
    shared: (k) => store[k], setShared: (k, v) => { store[k] = v; }, checking: () => false,
    window: () => ({ platform: "macos" }), keys: () => [], terminals: () => [], knownAgents: async () => [], openOverlay: () => {},
  };
  const names = ["Worktree", "worktreeSettings", "withSetup", "lockOf", "lockedBy", "branchOf"];
  const loaded = new Function(...Object.keys(globals), `${sourceOf("worktree")}; return { ${names.join(", ")} };`)(...Object.values(globals));
  const worktree = new loaded.Worktree();
  Object.assign(worktree, { opening: false, text: "", at: 0, repo, userHome: "/home/user", root: "/home/user/.herdr/worktrees",
    message: inputState(), spaceName: inputState(), input: inputState(), dirty: false, unpushed: [], locked: null, naming: 0 });
  return { ...loaded, worktree, writes, executions, notices, store, globals };
}
const project = (worktrees) => ({ [`${repo.main}/.herdr/settings.json`]: JSON.stringify({ worktrees }) });
const skip = !haveHerdr && "Herdr's originals aren't installed here";

test("every patch applies in order on this Herdr's originals and the layout stays valid JSON", { skip }, () => {
  assert.ok(PATCHES.length >= 6);
  for (const name of PATCHES) assert.ok(existsSync(join(here, "../mods/patcher/patches", `${name}.md`)), `${name}.md documents it`);
  const layout = JSON.parse(readFileSync(join(built, "layouts/main.json"), "utf8"));
  assert.deepEqual(layout.floating.map((f) => f.content.mod), ["patcher", "worktree-sync"]);
  for (const mod of ["worktree", "menu", "new-menu", "spaces", "tabs"]) {
    const file = join(built, "mods", mod, "main.js");
    writeFileSync(`${file}.mjs`, readFileSync(file));
    const r = spawnSync(process.execPath, ["--check", `${file}.mjs`], { encoding: "utf8" });
    rmSync(`${file}.mjs`);
    assert.equal(r.status, 0, `${mod}: ${r.stderr}`);
  }
  assert.equal(layout.terminal_menu, "my-menu");
  const opened = readdirSync(join(built, "mods")).flatMap((m) => readFileSync(join(built, "mods", m, "main.js"), "utf8").match(/mod: "(?:my-)?(?:worktree|new-menu)"/g) ?? []);
  assert.ok(opened.length >= 4 && opened.every((m) => m.includes("my-")), opened.join(", "));
});

test("the project's .herdr/settings.json wins over the person's worktrees.repos entry, which wins over settings.json worktrees", { skip }, async () => {
  for (const [settings, files, dir, deleteBranch] of [
    [null, {}, "/home/user/.herdr/worktrees/repo", false],
    [{ worktrees: { directory: "/srv/wt", deleteBranch: true } }, {}, "/srv/wt/repo", true],
    [{ worktrees: { repos: { "~/code/repo": { directory: ".claude/worktrees", deleteBranch: false } }, deleteBranch: true } }, {}, "/home/user/code/repo/.claude/worktrees", false],
    [{ worktrees: { repos: { "~/code/repo": { directory: ".claude/worktrees" } } } }, project({ directory: "../repo.worktrees", deleteBranch: true }), "/home/user/code/repo.worktrees", true],
  ]) {
    const { worktreeSettings } = harness({ settings, files });
    const s = await worktreeSettings(repo, "/home/user", null, true);
    assert.equal(s.dir, dir);
    assert.equal(s.deleteBranch, deleteBranch);
  }
  const { worktreeSettings } = harness({ settings: { worktrees: { setup: "mine-setup", teardown: "mine-down", branchPrefix: "me/" } }, files: project({ setup: "repo-setup", teardown: "repo-down" }) });
  const s = await worktreeSettings(repo, "/home/user", null, false);
  assert.deepEqual([s.dir, s.setup, s.teardown, s.branchPrefix], [null, ["mine-setup", "repo-setup"], ["repo-down", "mine-down"], "me/"]);
});

test("broken settings say what is wrong", { skip }, async () => {
  for (const [settings, files, message] of [
    [null, { [`${repo.main}/.herdr/settings.json`]: "{" }, ".herdr/settings.json:"],
    [null, { [`${repo.main}/.herdr/settings.json`]: "[]" }, ".herdr/settings.json must be a JSON object."],
    [null, project({ deleteBranch: "yes" }), ".herdr/settings.json worktrees.deleteBranch must be true or false."],
    [{ worktrees: { setup: ["make"] } }, {}, "worktrees.setup must be a command."],
    [{ worktrees: { repos: { "code/repo": {} } } }, {}, "worktrees.repos key code/repo must be an absolute path"],
    [{ worktrees: { repos: { "~/code/repo": { directory: "" } } } }, {}, 'worktrees.repos["~/code/repo"].directory must be a non-empty path.'],
  ]) {
    const { worktreeSettings } = harness({ settings, files });
    await assert.rejects(worktreeSettings(repo, "/home/user", null, true), (e) => e.message.includes(message));
  }
});

test("New worktree starts from origin's default branch, runs the setup, then Claude with the first message, in a named space", { skip }, async () => {
  const reply = (command, args) => {
    if (args.includes("symbolic-ref")) return { code: 0, stdout: "origin/main\n" };
    if (args.includes("show-ref")) return { code: 1 };
  };
  const h = harness({ settings: { worktrees: { setup: "direnv allow" } }, reply });
  Object.assign(h.worktree, { text: "me/add-thing", worktrees: await h.worktreeSettings(repo, "/home/user", null, true) });
  h.worktree.message.set_value("add the thing");
  h.worktree.spaceName.set_value("Thing");
  assert.equal(await h.worktree.create({}), "");
  const add = h.executions.find((e) => e.args[0] === "worktree");
  assert.deepEqual(add.args, ["worktree", "add", "--no-track", "-b", "me/add-thing", "/home/user/.herdr/worktrees/repo/me-add-thing", "origin/main"]);
  assert.ok(h.executions.some((e) => e.args.join(" ") === "fetch --quiet origin main"));
  const [[command, args]] = h.writes;
  assert.equal(command, "space.new");
  assert.equal(args.name, "Thing");
  assert.equal(args.task, "add the thing");
  assert.deepEqual(args.argv.slice(0, 2), ["/bin/sh", "-c"]);
  assert.ok(args.argv[2].includes("direnv allow"));
  assert.deepEqual(args.argv.slice(3), ["sh", repo.main, "/home/user/.herdr/worktrees/repo/me-add-thing", "me/add-thing", "claude"]);
});

test("without a first message New worktree opens a plain shell, and Linear's props pass through", { skip }, async () => {
  const plain = harness();
  Object.assign(plain.worktree, { text: "x", worktrees: await plain.worktreeSettings(repo, "/home/user", null, true) });
  await plain.worktree.create({});
  assert.equal(plain.writes[0][1].argv, undefined);
  assert.equal(plain.writes[0][1].task, undefined);
  assert.equal(plain.writes[0][1].name, "");

  const linear = harness({ extra: { branch: "me/pla-1-x", argv: ["claude"], task: "Use the linear-work skill", tab: "PLA-1", repoSpace: true },
    spaceList: [{ id: "s0", folder: repo.main, machine: null, tabs: [] }] });
  Object.assign(linear.worktree, { text: "me/pla-1-x", worktrees: await linear.worktreeSettings(repo, "/home/user", null, true) });
  await linear.worktree.create({});
  assert.deepEqual(linear.writes, [["space.new", { name: "", folder: "/home/user/.herdr/worktrees/repo/me-pla-1-x", machine: "", tab: "PLA-1", argv: ["claude"], task: "Use the linear-work skill" }]]);
});

test("the branch is suggested from the first message until it is typed by hand", { skip }, async () => {
  const h = harness({ reply: (command) => (command === "claude" ? { code: 0, stdout: "add-thing\n" } : undefined) });
  Object.assign(h.worktree, { worktrees: { branchPrefix: "me/" } });
  let later;
  const cx = { notify() {}, timer: { after: (_ms, f) => { later = f; } }, spawn: (f) => { later = f; } };
  h.worktree.message.set_value("add the thing please");
  h.worktree.suggest(cx);
  later(cx);
  await later(cx);
  assert.equal(h.worktree.text, "me/add-thing");
  assert.equal(h.worktree.input.value(), "me/add-thing");
  const claude = h.executions.find((e) => e.command === "claude");
  assert.ok(claude.args.includes("haiku"));
  assert.equal(claude.args.at(-1), "add the thing please");

  h.worktree.text = "mine";
  h.executions.length = 0;
  h.worktree.suggest(cx);
  assert.equal(h.executions.length, 0);
});

test("the agent and the branch namer come from worktrees.agent and worktrees.branchAgent", { skip }, async () => {
  const h = harness({ settings: { worktrees: { agent: ["codex"], branchAgent: ["namer", "-q"] } }, reply: (command) => (command === "namer" ? { code: 0, stdout: "fix-it\n" } : undefined) });
  Object.assign(h.worktree, { text: "x", worktrees: await h.worktreeSettings(repo, "/home/user", null, true) });
  h.worktree.message.set_value("fix it");
  await h.worktree.create({});
  assert.deepEqual(h.writes[0][1].argv, ["codex"]);
  assert.equal(h.worktree.namer("fix it").at(-1).endsWith("\n\nfix it"), true);
  assert.deepEqual(h.worktree.namer("fix it").slice(0, 2), ["namer", "-q"]);

  const other = harness({ settings: { worktrees: { agent: ["codex"] } } });
  other.worktree.worktrees = await other.worktreeSettings(repo, "/home/user", null, true);
  assert.equal(other.worktree.namer("fix it"), null);
  const wrong = harness({ settings: { worktrees: { agent: "codex" } } });
  await assert.rejects(wrong.worktreeSettings(repo, "/home/user", null, true), /worktrees.agent must be a list of strings/);
});

test("a locked worktree needs Enter twice, then goes with --force --force and takes its branch along", { skip }, async () => {
  const linked = { ...repo, top: "/home/user/code/repo/.claude/worktrees/x", linked: true };
  const reply = (command, args) => (args.includes("--absolute-git-dir") ? { code: 0, stdout: "/home/user/code/repo/.git/worktrees/x\n" } : undefined);
  const h = harness({ extra: { action: "remove", space: "s1" }, reply, files: { "/home/user/code/repo/.git/worktrees/x/locked": '{"owner":"supacode"}\n' },
    spaceList: [{ id: "s1", name: "x", tabs: [] }] });
  Object.assign(h.worktree, { repo: linked, worktrees: { teardown: [], setup: [] }, branch: { name: "x", unpushed: false } });
  assert.equal(await h.worktree.remove(), "It's locked by supacode. Enter again overrides the lock and removes it.");
  assert.equal(h.writes.length, 0);
  assert.equal(await h.worktree.remove(), "");
  assert.deepEqual(h.executions.at(-1).args, ["worktree", "remove", "--force", "--force", linked.top]);
  assert.deepEqual(h.writes, [["space.close", { id: "s1", confirmed: true }]]);
  await h.worktree.deleteBranch();
  assert.deepEqual(h.executions.at(-1).args, ["branch", "-D", "x"]);
  assert.match(textOf(h.worktree.render({}).node), /Deletes branch x too\..*It's locked by supacode: removing it overrides the lock\./s);
});

test("a failing teardown keeps the checkout until Enter again", { skip }, async () => {
  const linked = { ...repo, top: "/home/user/code/repo/.claude/worktrees/x", linked: true };
  let fail = true;
  const h = harness({ extra: { action: "remove", space: "s1" }, spaceList: [{ id: "s1", name: "x", tabs: [] }],
    reply: (command) => (command === "/bin/sh" && fail ? { code: 2, stderr: "compose: down failed" } : undefined) });
  Object.assign(h.worktree, { repo: linked, worktrees: { teardown: ["docker compose down"], setup: [] } });
  const error = await h.worktree.remove();
  assert.match(error, /^Teardown failed \(exit 2\), nothing was removed\.\ncompose: down failed\nEnter again removes it without the teardown\.$/);
  assert.ok(!h.executions.some((e) => e.args.includes("remove")));
  fail = false;
  assert.equal(await h.worktree.remove(), "");
  assert.deepEqual(h.executions.at(-1).args, ["worktree", "remove", linked.top]);
});

test("New space starts where the focused terminal is, in every menu", { skip }, () => {
  const spaceList = [{ id: "s1", active: true, folder: "/home/user", machine: null, tabs: [{ id: "t1" }] }];
  const paneList = [{ tab: "t1", cwd: "/home/user/code/repo/src", focused: true }];
  const want = { folder: "/home/user/code/repo/src", machine: "" };
  const { globals } = harness({ spaceList, paneList });
  for (const mod of ["menu", "new-menu", "spaces"]) {
    const here = new Function(...Object.keys(globals), `${sourceOf(mod)}; return here;`)(...Object.values(globals));
    assert.deepEqual(here(), want, mod);
  }
  const items = new Function(...Object.keys(globals), `${sourceOf("menu")}; return items;`)(...Object.values(globals));
  assert.deepEqual(items({}).find(([label]) => label === "New space")[2], want);
});

test("statusbar: issue ids from the branch, publishing only on change, merge request mapping", { skip }, () => {
  const source = readFileSync(join(built, "mods/workspace-status/context.js"), "utf8").replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
  const { issueCandidates, shouldPublish, merged, mrOf } = new Function("exec", "appHome", "shared", "setShared", `${source}; return { issueCandidates, shouldPublish, merged, mrOf };`)();
  assert.deepEqual(issueCandidates("florentg/pla-663-dev-data-ids"), ["PLA-663"]);
  assert.deepEqual(issueCandidates("main"), []);
  assert.deepEqual(issueCandidates("eng-12-and-ops-3"), ["ENG-12", "OPS-3"]);
  const entry = { branch: "b", fetchedAt: 1000, mr: null, issue: null, gitlab: null };
  assert.equal(shouldPublish(null, entry, 1000), true);
  assert.equal(shouldPublish(entry, { ...entry, fetchedAt: 5000 }, 5000), false);
  assert.equal(shouldPublish(entry, { ...entry, fetchedAt: 70000 }, 70000), true);
  assert.equal(shouldPublish(entry, { ...entry, issue: { id: "X-1" }, fetchedAt: 2000 }, 2000), true);
  const day = 24 * 60 * 60 * 1000;
  assert.deepEqual(Object.keys(merged({ old: { fetchedAt: 0 }, kept: { fetchedAt: day } }, "/r", entry, day + 10)), ["kept", "/r"]);
  const mr = mrOf({ iid: "58284", title: "t", webUrl: "u", draft: true, sourceBranch: "s", targetBranch: "m", diffHeadSha: "h",
    headPipeline: { status: "RUNNING", path: "/g/p/-/pipelines/1" }, resolvableDiscussionsCount: 3, resolvedDiscussionsCount: 1,
    diffRefs: { baseSha: "b", headSha: "h", startSha: "s" } }, "gitlab.com");
  assert.equal(mr.iid, 58284);
  assert.equal(mr.openThreads, 2);
  assert.deepEqual(mr.pipeline, { status: "running", web_url: "https://gitlab.com/g/p/-/pipelines/1" });
  assert.deepEqual(mr.diff_refs, { base_sha: "b", head_sha: "h", start_sha: "s" });
  assert.equal(mrOf(null, "gitlab.com"), null);
});

test("while it creates, the fields are plain text: nothing can be typed in them", { skip }, async () => {
  const h = harness({ extra: { branch: "me/pla-1-x", name: "PLA-1" } });
  Object.assign(h.worktree, { text: "me/pla-1-x", worktrees: await h.worktreeSettings(repo, "/home/user", null, true) });
  h.worktree.spaceName.set_value("PLA-1");
  h.worktree.input.set_value("me/pla-1-x");
  const inputs = (node) => (node?.input ? 1 : 0) + (node?.children ?? []).reduce((n, c) => n + inputs(c), 0);
  assert.equal(inputs(h.worktree.render({}).node), 3);
  h.worktree.busy = true;
  const busy = h.worktree.render({}).node;
  assert.equal(inputs(busy), 0);
  assert.match(textOf(busy), /me\/pla-1-x/);
  assert.match(textOf(busy), /PLA-1/);
});
