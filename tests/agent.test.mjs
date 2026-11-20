import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const COPIES = ["linear", "gitlab-review", "sentry"].map((m) => join(here, "../mods", m, "agent.js"));
const { agentArgv, agentName, askArgv } = await import(COPIES[0]);

test("every mod carries the same agent.js", () => {
  const first = readFileSync(COPIES[0], "utf8");
  for (const file of COPIES) assert.equal(readFileSync(file, "utf8"), first, file);
});

test("Claude is the default agent, read-only when asked", () => {
  assert.deepEqual(agentArgv({}), ["claude"]);
  assert.equal(agentName({}), "Claude");
  const ask = askArgv({}, ["Edit"]);
  assert.deepEqual(ask.slice(0, 3), ["claude", "--permission-mode", "plan"]);
  assert.deepEqual(JSON.parse(ask.at(-1)), { permissions: { deny: ["Edit"] } });
});

test("another agent gets its name from the command and no Claude flags", () => {
  const config = { agent: ["/usr/local/bin/codex", "--full-auto"] };
  assert.equal(agentName(config), "Codex");
  assert.equal(agentName({ ...config, agentName: "Robot" }), "Robot");
  assert.deepEqual(askArgv(config, ["Edit"]), ["/usr/local/bin/codex", "--full-auto"]);
  assert.deepEqual(askArgv({ ...config, agentAskArgs: ["--sandbox", "read-only"] }, ["Edit"]), ["/usr/local/bin/codex", "--full-auto", "--sandbox", "read-only"]);
});
