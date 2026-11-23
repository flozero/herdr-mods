import { exec, home, writeTextFile } from "herdr";
import { position } from "./diff.js";
import { where } from "./review.js";
import { parsePages } from "./pages.js";

const BODIES = () => `${home()}/.cache/herdr-code/bodies`;

async function run(command, args, cwd) {
  const result = await exec(command, args, { cwd, timeout: 60000 });
  if (result.code !== 0) throw new Error((result.stderr || result.stdout || "").trim().split("\n").pop() || `${command} exited with ${result.code}`);
  return result.stdout;
}

async function withBody(body, use) {
  await exec("sh", ["-c", 'mkdir -p "$1" && chmod 700 "$1"', "sh", BODIES()]);
  const file = `${BODIES()}/body-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  await writeTextFile(file, JSON.stringify(body));
  try {
    return await use(file);
  } finally {
    await exec("rm", ["-f", file]).catch(() => {});
  }
}

export function forgeOf(url) {
  const match = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/.exec(String(url).trim());
  if (!match) return null;
  const [, host, path] = match;
  return { kind: host === "github.com" || host.startsWith("github.") ? "github" : "gitlab", host, path };
}

export async function findReview(root, branch) {
  if (!branch || branch === "HEAD") return null;
  const remote = await exec("git", ["-C", root, "remote", "get-url", "origin"]);
  const forge = remote.code === 0 ? forgeOf(remote.stdout) : null;
  if (!forge) return null;
  if (forge.kind === "github") {
    if ((await exec("gh", ["auth", "status", "--hostname", forge.host])).code !== 0) return null;
    const [pr] = JSON.parse(await run("gh", ["pr", "list", "--head", branch, "--state", "open", "--json", "number,headRefOid,url,baseRefName", "--repo", `${forge.host}/${forge.path}`], root));
    return pr ? { ...forge, label: "GitHub", number: pr.number, name: `#${pr.number}`, url: pr.url, head: pr.headRefOid, target: pr.baseRefName } : null;
  }
  if ((await exec("glab", ["auth", "status", "--hostname", forge.host])).code !== 0) return null;
  const [mr] = JSON.parse(await run("glab", ["api", `projects/:id/merge_requests?source_branch=${encodeURIComponent(branch)}&state=opened`], root));
  if (!mr) return null;
  const detail = JSON.parse(await run("glab", ["api", `projects/:id/merge_requests/${mr.iid}`], root));
  return { ...forge, label: "GitLab", number: mr.iid, name: `!${mr.iid}`, url: mr.web_url, head: detail.diff_refs?.head_sha ?? mr.sha, refs: detail.diff_refs, target: mr.target_branch };
}

function anchorOf(comment, files) {
  const file = files.find((candidate) => candidate.new_path === comment.path);
  const rowAt = (line) => file?.rows.find((row) => (row.kind === "add" || row.kind === "ctx") && row.new === line);
  const end = rowAt(comment.end);
  if (!end) return null;
  const start = comment.start === comment.end ? null : rowAt(comment.start) ?? null;
  return { file, start, end };
}

const quoted = (comment) => `**${where(comment)}**\n\`\`\`\n${comment.code}\n\`\`\`\n${comment.note}`;

export async function publishReview(root, review, comments, files) {
  const placed = comments.map((comment) => ({ comment, anchor: anchorOf(comment, files) }));
  const inline = placed.filter(({ anchor }) => anchor);
  const general = placed.filter(({ anchor }) => !anchor).map(({ comment }) => quoted(comment)).join("\n\n---\n\n");
  if (review.kind === "github") {
    const body = {
      commit_id: review.head,
      event: "COMMENT",
      body: general,
      comments: inline.map(({ comment, anchor }) => ({
        path: comment.path,
        line: anchor.end.new,
        side: "RIGHT",
        ...(anchor.start ? { start_line: anchor.start.new, start_side: "RIGHT" } : {}),
        body: comment.note,
      })),
    };
    await withBody(body, (file) => run("gh", ["api", "--hostname", review.host, "-X", "POST", "--input", file, `repos/${review.path}/pulls/${review.number}/reviews`], root));
  } else {
    const drafts = `projects/:id/merge_requests/${review.number}/draft_notes`;
    const post = (body, path) => withBody(body, (file) => run("glab", ["api", "-X", "POST", "-H", "Content-Type: application/json", "--input", file, path], root));
    for (const { comment, anchor } of inline) await post({ note: comment.note, position: position(review.refs, anchor.file, anchor.end, anchor.start) }, drafts);
    if (general) await post({ note: general }, drafts);
    await post({}, `${drafts}/bulk_publish`);
  }
  return { inline: inline.length, general: placed.length - inline.length };
}

export async function reviewThreads(root, review) {
  if (review?.kind !== "gitlab") return [];
  const out = await run("glab", ["api", "--paginate", `projects/:id/merge_requests/${review.number}/discussions?per_page=100`], root);
  return parsePages(out.trim() || "[]").flatMap((discussion) => {
    const notes = discussion.notes.filter((note) => !note.system);
    const position = notes[0]?.position;
    if (!notes.length || !position?.new_line || !position.new_path) return [];
    return [{
      id: discussion.id,
      path: position.new_path,
      line: position.new_line,
      resolved: Boolean(notes[0].resolvable) && notes.every((note) => !note.resolvable || note.resolved),
      notes: notes.map((note) => ({ id: note.id, author: note.author?.username ?? "?", body: note.body ?? "" })),
    }];
  });
}

export const replyThread = (root, review, discussionId, body) =>
  run("glab", ["api", "-X", "POST", `projects/:id/merge_requests/${review.number}/discussions/${discussionId}/notes`, "-f", `body=${body}`], root);

export const resolveThread = (root, review, discussionId, resolved) =>
  run("glab", ["api", "-X", "PUT", `projects/:id/merge_requests/${review.number}/discussions/${discussionId}`, "-F", `resolved=${resolved}`], root);
