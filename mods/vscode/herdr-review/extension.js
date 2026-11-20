const vscode = require("vscode");
const { execFile } = require("child_process");
const path = require("path");

const run = (command, args, cwd) =>
  new Promise((resolve) => {
    execFile(command, args, { cwd, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) =>
      resolve({ ok: !error, stdout: String(stdout), stderr: String(stderr || error?.message || "") }));
  });

const where = (c) => `${c.path}:${c.start === c.end ? c.start : `${c.start}-${c.end}`}`;
const repoOf = async (folder) => (await run("git", ["rev-parse", "--show-toplevel"], folder)).stdout.trim() || folder;

function prompt(branch, comments) {
  const head = `Review of my local changes on ${branch}: ${comments.length} comment${comments.length > 1 ? "s" : ""}. Address each one, then tell me what you changed.`;
  const parts = comments.map((c, i) => `${i + 1}. ${where(c)}${c.before ? " (before the change)" : ""}\n\`\`\`\n${c.code}\n\`\`\`\n${c.note}`);
  return [head, ...parts].join("\n\n");
}

function filePath(uri) {
  if (uri.scheme === "git") {
    try {
      return JSON.parse(uri.query).path;
    } catch {
      return uri.fsPath;
    }
  }
  return uri.fsPath;
}

class Note {
  constructor(text, thread) {
    this.body = text;
    this.saved = text;
    this.thread = thread;
    this.mode = vscode.CommentMode.Preview;
    this.author = { name: "You" };
    this.contextValue = "note";
  }
}

async function agentsIn(repo) {
  const listed = await run("hc", ["ls", "--json"], repo);
  if (!listed.ok) throw new Error(listed.stderr.trim() || "hc ls failed");
  const agents = (JSON.parse(listed.stdout).terminals ?? []).filter((t) => t.state === "live" && t.status && t.cwd);
  const inRepo = [];
  for (const agent of agents) if ((await repoOf(agent.cwd)) === repo) inRepo.push(agent);
  return inRepo;
}

async function pickAgent(agents) {
  if (agents.length === 1) return agents[0].address;
  const picked = await vscode.window.showQuickPick(
    agents.map((t) => ({ label: t.where || t.address, description: `${t.agent} · ${t.status}`, address: t.address })),
    { placeHolder: "Which agent gets the review?" });
  return picked?.address;
}

async function startAgent(folder, text) {
  const agent = vscode.workspace.getConfiguration("herdrReview").get("agent") ?? ["claude"];
  const shell = process.env.SHELL || "/bin/sh";
  const argv = [shell, "-lc", 'cd "$0" && exec "$@"', folder, ...agent, text];
  const split = await run("herdr-app", ["do", "pane.split", JSON.stringify({ direction: "down", argv })], folder);
  if (split.ok) return agent[0];
  const started = await run("hc", ["run", "--bg", "--json", "--name", `review-${Date.now().toString(36)}`, "--cwd", folder, "--", ...agent, text], folder);
  if (!started.ok) throw new Error(started.stderr.trim() || split.stderr.trim());
  return JSON.parse(started.stdout).address;
}

async function baseOf(repo) {
  const configured = vscode.workspace.getConfiguration("herdrReview").get("base");
  const head = (await run("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], repo)).stdout.trim();
  for (const candidate of [configured, head, "origin/main", "origin/master"].filter(Boolean)) {
    const found = await run("git", ["merge-base", "--end-of-options", "HEAD", candidate], repo);
    if (found.ok && found.stdout.trim()) return { name: candidate, commit: found.stdout.trim() };
  }
  return null;
}

const STATUS = { A: "added", M: "modified", D: "deleted", R: "renamed", C: "copied", T: "type changed" };

class BranchChanges {
  constructor() {
    this.changed = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changed.event;
  }

  refresh() {
    this.changed.fire();
  }

  getTreeItem(item) {
    return item;
  }

  async getChildren() {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!folder) return [];
    const repo = await repoOf(folder);
    const base = await baseOf(repo);
    if (!base) return [new vscode.TreeItem("No base branch found (set herdrReview.base)")];
    const diff = await run("git", ["diff", "--name-status", "-M", base.commit], repo);
    const untracked = await run("git", ["ls-files", "--others", "--exclude-standard"], repo);
    const rows = diff.stdout.split("\n").filter(Boolean).map((line) => {
      const [status, ...paths] = line.split("\t");
      return { status: status[0], from: paths[0], to: paths[paths.length - 1] };
    });
    for (const file of untracked.stdout.split("\n").filter(Boolean)) rows.push({ status: "A", from: file, to: file });
    return rows.map((row) => {
      const right = vscode.Uri.file(path.join(repo, row.to));
      const left = vscode.Uri.file(path.join(repo, row.from)).with({ scheme: "git", query: JSON.stringify({ path: path.join(repo, row.from), ref: base.commit }) });
      const item = new vscode.TreeItem(right, vscode.TreeItemCollapsibleState.None);
      item.description = `${path.dirname(row.to) === "." ? "" : path.dirname(row.to)} · ${STATUS[row.status] ?? row.status}`;
      item.tooltip = `${row.to} (${STATUS[row.status] ?? row.status} since ${base.name})`;
      item.command = { command: "herdrReview.openChange", title: "Open Change", arguments: [row.status, left, right, `${path.basename(row.to)} (${base.name} ↔ branch)`] };
      return item;
    });
  }
}

function activate(context) {
  const log = vscode.window.createOutputChannel("Herdr Review");
  const controller = vscode.comments.createCommentController("herdr-review", "Herdr Review");
  controller.commentingRangeProvider = {
    provideCommentingRanges: (document) =>
      ["file", "git"].includes(document.uri.scheme) ? [new vscode.Range(0, 0, Math.max(document.lineCount - 1, 0), 0)] : [],
  };
  controller.options = { placeHolder: "What should the agent change here?", prompt: "Comment for the agent" };
  const threads = new Set();
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "herdrReview.send";

  const count = () => [...threads].reduce((n, t) => n + t.comments.length, 0);
  const refresh = () => {
    const n = count();
    vscode.commands.executeCommand("setContext", "herdrReview.hasComments", n > 0);
    status.text = `$(send) Send ${n} comment${n > 1 ? "s" : ""} to the agent`;
    n > 0 ? status.show() : status.hide();
  };
  const drop = (thread) => {
    threads.delete(thread);
    thread.dispose();
  };
  const setMode = (note, mode) => {
    note.mode = mode;
    note.thread.comments = [...note.thread.comments];
  };

  const branch = new BranchChanges();
  const watcher = vscode.workspace.createFileSystemWatcher("**/.git/{HEAD,index}");
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("herdrReview.branch", branch),
    watcher,
    watcher.onDidChange(() => branch.refresh()),
    vscode.workspace.onDidSaveTextDocument(() => branch.refresh()),
    vscode.commands.registerCommand("herdrReview.refreshBranch", () => branch.refresh()),
    vscode.commands.registerCommand("herdrReview.openChange", (status, left, right, title) =>
      status === "D" ? vscode.commands.executeCommand("vscode.open", left) : vscode.commands.executeCommand("vscode.diff", left, right, title)),
    log,
    controller,
    status,
    vscode.commands.registerCommand("herdrReview.start", () => vscode.commands.executeCommand("workbench.action.addComment")),
    vscode.commands.registerCommand("herdrReview.add", (reply) => {
      const thread = reply.thread;
      thread.canReply = false;
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
      thread.comments = [...thread.comments, new Note(reply.text, thread)];
      threads.add(thread);
      log.appendLine(`added ${thread.uri.toString()} ${thread.range?.start.line + 1}-${thread.range?.end.line + 1}, ${count()} in all`);
      refresh();
    }),
    vscode.commands.registerCommand("herdrReview.edit", (note) => setMode(note, vscode.CommentMode.Editing)),
    vscode.commands.registerCommand("herdrReview.save", (note) => {
      note.saved = typeof note.body === "string" ? note.body : note.body.value;
      note.body = note.saved;
      setMode(note, vscode.CommentMode.Preview);
    }),
    vscode.commands.registerCommand("herdrReview.cancel", (note) => {
      note.body = note.saved;
      setMode(note, vscode.CommentMode.Preview);
    }),
    vscode.commands.registerCommand("herdrReview.delete", (note) => {
      const thread = note.thread;
      thread.comments = thread.comments.filter((c) => c !== note);
      if (thread.comments.length === 0) drop(thread);
      refresh();
    }),
    vscode.commands.registerCommand("herdrReview.clear", () => {
      [...threads].forEach(drop);
      refresh();
    }),
    vscode.commands.registerCommand("herdrReview.send", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!folder || count() === 0) return;
      try {
        const repo = await repoOf(folder);
        const comments = [];
        for (const thread of threads) {
          const document = await vscode.workspace.openTextDocument(thread.uri);
          const range = thread.range ?? new vscode.Range(0, 0, 0, 0);
          const code = document.getText(new vscode.Range(range.start.line, 0, range.end.line, document.lineAt(range.end.line).text.length));
          for (const note of thread.comments) {
            comments.push({ path: path.relative(repo, filePath(thread.uri)), start: range.start.line + 1, end: range.end.line + 1, code, note: note.saved, before: thread.uri.scheme === "git" });
          }
        }
        const branch = (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], repo)).stdout.trim() || "this branch";
        const text = prompt(branch, comments);
        const agents = await agentsIn(repo);
        log.appendLine(`sending ${comments.length} comments from ${repo}; agents: ${agents.map((a) => `${a.address} (${a.cwd})`).join(", ") || "none"}`);
        let to;
        if (agents.length === 0) {
          to = await startAgent(repo, text);
        } else {
          to = await pickAgent(agents);
          if (!to) return;
          const sent = await run("hc", ["send", to, text], repo);
          if (!sent.ok) throw new Error(sent.stderr.trim() || "hc send failed");
        }
        [...threads].forEach(drop);
        refresh();
        vscode.window.showInformationMessage(`Review sent to ${to}.`);
      } catch (error) {
        log.appendLine(String(error?.stack ?? error));
        vscode.window.showErrorMessage(`Herdr Review: ${error.message}`);
      }
    }),
  );
  refresh();
}

module.exports = { activate, deactivate() {} };
