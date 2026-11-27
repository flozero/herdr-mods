import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as api from "../mods/linear/api.js";
import * as Q from "../mods/linear/query.js";
import { batch, READ_ONLY } from "../mods/linear/cli/linear-me.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const F = JSON.parse(readFileSync(join(here, "fixtures/linear-mcp.json"), "utf8"));

function fake(overrides = {}) {
  const seen = [];
  api.setRunner(async (calls) => {
    seen.push(...calls);
    return calls.map((c) => {
      const o = overrides[c.tool];
      const v = typeof o === "function" ? o(c.args ?? {}) : o ?? { ok: true, value: F[c.tool] };
      return v;
    });
  });
  return seen;
}

test("a listed issue gets the fields the mod reads", () => {
  const i = api.issueOf(F.list_issues.issues[0]);
  assert.equal(i.id, "11111111-1111-4111-8111-111111111111");
  assert.equal(i.identifier, "ENG-42");
  assert.equal(i.number, 42);
  assert.deepEqual(i.team, { id: "t-1", key: "ENG", name: "Engine" });
  assert.deepEqual(i.state, { id: null, name: "In Development", type: "started", color: "#f2c94c", position: 3 });
  assert.deepEqual(i.assignee, { id: "u-1", name: "Ada Example", displayName: "Ada Example" });
  assert.equal(i.priority, 2);
  assert.equal(i.branchName, "ada/eng-42-fix-the-widget");
  assert.deepEqual(i.labels.nodes, [{ id: "bug", name: "bug", color: null }]);
  assert.equal(i.parent.identifier, "ENG-40");
  assert.deepEqual(i.project, { id: "p-1", name: "Widgets" });
  assert.equal(i.attachments, undefined);
  assert.equal(Q.localScore(i, Q.parse("widget s:started l:bug #ENG @me"), "u-1") > 0, true);
});

test("the viewer comes from whoami, get_user and list_teams", async () => {
  fake();
  const me = await api.viewer();
  assert.equal(me.id, "u-1");
  assert.equal(me.displayName, "ada");
  assert.deepEqual(me.teams.nodes, [{ id: "t-1", key: "ENG", name: "Engine" }]);
  assert.deepEqual(me.teamKeys, ["ENG", "OPS"]);
  assert.deepEqual(me.organization, { id: "w-1", name: "Example Co", urlKey: "example" });
});

test("people leaves out inactive users", async () => {
  fake();
  assert.deepEqual(await api.people(), [{ id: "u-1", name: "Ada Example", displayName: "ada" }]);
});

test("my issues ask each open state once, in one batch, and drop finished ones", async () => {
  const seen = fake();
  const mine = await api.myIssues();
  assert.deepEqual(seen.map((c) => c.args.state), ["triage", "backlog", "unstarted", "started"]);
  assert.ok(seen.every((c) => c.tool === "list_issues" && c.args.assignee === "me"));
  assert.deepEqual(mine.map((i) => i.identifier), ["ENG-42"]);
});

test("team issues page per team, the cursor keeps each team's place", async () => {
  const seen = fake();
  const page = await api.teamIssues(["t-1", "t-2"], null);
  assert.deepEqual(seen.map((c) => c.args.team), ["t-1", "t-2"]);
  assert.equal(seen[0].args.limit, 25);
  assert.equal(page.nodes.length, 2);
  assert.deepEqual(page.nodes.map((i) => i.identifier), ["ENG-42", "ENG-41"]);
  assert.equal(page.pageInfo.hasNextPage, true);
  seen.length = 0;
  await api.teamIssues(["t-1", "t-2"], page.pageInfo.endCursor);
  assert.deepEqual(seen.map((c) => [c.args.team, c.args.cursor]), [["t-1", "cursor-1"], ["t-2", "cursor-1"]]);
});

test("an issue's detail: comments in order, relations, children, creator, state changes and the merge request", async () => {
  const seen = fake();
  const d = await api.issueDetail("ENG-42");
  assert.deepEqual(seen.map((c) => c.tool), ["get_issue", "list_comments", "list_issues"]);
  assert.deepEqual(d.comments.map((c) => c.id), ["c-1", "c-2"]);
  assert.deepEqual(d.comments[1].parent, { id: "c-1" });
  assert.equal(d.comments[1].editedAt, "2025-01-04T01:00:00.000Z");
  assert.equal(d.comments[0].user.name, "Ada Example");
  assert.deepEqual(d.relations.blockedBy, [{ id: "OPS-3", identifier: "OPS-3", title: "Unblock the widget", state: null }]);
  assert.deepEqual(d.relations.related.map((x) => x.identifier), ["ENG-7"]);
  assert.equal(d.relations.children.length, 2);
  assert.equal(d.relations.moreChildren, true);
  assert.equal(d.issue.creator.name, "Ada Example");
  assert.deepEqual(d.history, [{ createdAt: "2025-01-03T00:00:00.000Z", fromState: { name: "Backlog" }, toState: { name: "In Development" } }]);
  assert.deepEqual(api.mainPr(d.issue), { url: "https://gitlab.example.com/group/repo/-/merge_requests/7", number: 7, repo: null, status: "open", draft: false, review: null, conflicts: false, at: "" });
});

test("a missing issue is null, a lost session is an auth error", async () => {
  fake({ get_issue: { ok: false, error: '{"error":"invalid_request","message":"Could not find referenced Issue."}' } });
  assert.equal(await api.issueDetail("ENG-999"), null);
  fake({ get_issue: { ok: false, error: "Linear refused the session: run linear-me login" } });
  await assert.rejects(api.issueDetail("ENG-42"), (e) => e.kind === "auth");
  api.setRunner(async () => { throw new Error("not connected: run linear-me login"); });
  await assert.rejects(api.people(), (e) => e.kind === "auth");
  api.setRunner(async () => { throw new Error('https://mcp.linear.app/token: HTTP 400 {"error":"invalid_grant","error_description":"Invalid refresh token"}'); });
  await assert.rejects(api.people(), (e) => e.kind === "auth");
});

test("states come in Linear's order, with a color per type", async () => {
  fake();
  const states = await api.teamStates("t-1");
  assert.deepEqual(states.map((s) => s.name), ["Triage", "Backlog", "Todo", "In Development", "Released"]);
  assert.deepEqual(states.map((s) => s.position), [0, 1, 2, 3, 4]);
  assert.equal(states[0].id, "s-0");
  assert.ok(states.every((s) => /^#[0-9a-f]{6}$/.test(s.color)));
});

test("search: an identifier is fetched directly, single tokens go to the server", () => {
  assert.deepEqual(Q.searchCalls(Q.parse("ENG-12")), [{ tool: "get_issue", args: { id: "ENG-12" } }]);
  assert.deepEqual(Q.searchCalls(Q.parse("widget s:done l:bug #ENG @me p:high")), [{ tool: "list_issues",
    args: { limit: 50, orderBy: "updatedAt", query: "widget", team: "ENG", state: "completed", label: "bug", assignee: "me", priority: 2 } }]);
  assert.deepEqual(Q.searchCalls(Q.parse("s:open -l:bug")), [{ tool: "list_issues", args: { limit: 50, orderBy: "updatedAt" } }]);
});

test("search and lookups by id merge the answers", async () => {
  fake({ get_issue: (args) => (args.id === "ENG-42" ? { ok: true, value: F.get_issue } : { ok: false, error: "Could not find referenced Issue." }) });
  assert.deepEqual((await api.issuesById(["ENG-42", "NOPE-1"])).map((i) => i.identifier), ["ENG-42"]);
  const found = await api.searchIssues(Q.searchCalls(Q.parse("ENG-42 widget")));
  assert.deepEqual(found.map((i) => i.identifier), ["ENG-42", "ENG-41"]);
});

test("views and projects", async () => {
  fake();
  assert.equal(api.viewSlug("https://linear.app/example/view/bugs-a0cdb3863cef"), "a0cdb3863cef");
  const v = await api.customView("a0cdb3863cef");
  assert.equal(v.id, "v-uuid-0000-0000-0000-a0cdb3863cef");
  assert.equal(v.name, "Bugs");
  assert.equal(v.modelName, "Issue");
  const p = await api.project(api.projectSlug("https://linear.app/example/project/widgets-0123456789ab"));
  assert.deepEqual(p, { id: "p-1", slugId: "0123456789ab", name: "Widgets", color: "#5e6ad2", kind: "project", shared: true, team: null, modelName: "Issue" });
  const o = await api.projectOverview("p-1");
  assert.equal(o.content, "# Widgets\nAll of them.");
  assert.equal(o.health, "onTrack");
  assert.equal(o.progress, null);
  assert.deepEqual(o.projectMilestones.nodes, [{ id: "m-1", name: "Beta", targetDate: "2025-02-01" }]);
  assert.equal(o.projectUpdates.nodes[0].user.name, "Ada Example");
  assert.deepEqual(o.history.nodes, []);
  const page = await api.projectIssues("p-1");
  assert.equal(page.pageInfo.endCursor, "cursor-1");
});

test("linear-me batch runs read-only tools only, and keeps going past a failed call", async () => {
  assert.ok(READ_ONLY.test("list_issues") && READ_ONLY.test("whoami") && !READ_ONLY.test("save_issue") && !READ_ONLY.test("delete_comment"));
  await assert.rejects(batch([{ tool: "save_comment" }], async () => ({})), /read-only/);
  const out = await batch([{ tool: "list_teams" }, { tool: "get_issue", args: { id: "X-1" } }], async (_m, p) => {
    if (p.name === "get_issue") return { isError: true, content: [{ type: "text", text: "Could not find referenced Issue." }] };
    return { structuredContent: { teams: [] } };
  });
  assert.deepEqual(out, [{ ok: true, value: { teams: [] } }, { ok: false, error: "Could not find referenced Issue." }]);
});

test("projects are listed by name, a page at a time, keyed by their uuid", async () => {
  const seen = fake({ list_projects: { ok: true, value: { projects: [
    { id: "P-ENG-1", uuid: "uuid-1", name: "Widgets", status: { id: "s", name: "Started", type: "started" }, teams: [{ id: "t-1", key: "ENG", name: "Engine" }], url: "https://linear.app/x/project/widgets" },
  ], hasNextPage: true, cursor: "uuid-1" } } });
  const page = await api.projects("wid", "c-0");
  assert.equal(seen[0].args.query, "wid");
  assert.equal(seen[0].args.cursor, "c-0");
  assert.deepEqual(page.nodes.map((p) => [p.id, p.name, p.kind, p.teams, p.status.name]), [["uuid-1", "Widgets", "project", ["ENG"], "Started"]]);
  assert.equal(page.more, true);
  assert.equal(page.cursor, "uuid-1");
  assert.equal(api.projectOf(page.nodes[0]), page.nodes[0]);
});
