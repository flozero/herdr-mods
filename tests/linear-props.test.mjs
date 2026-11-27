import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDay, isoDay } from "../mods/linear/dates.js";
import { labelsOf, cyclesOf } from "../mods/linear/api.js";

const now = new Date(2026, 10, 26);

test("parseDay reads ISO, day-first and bare days", () => {
  assert.equal(parseDay("2026-12-03", now), "2026-12-03");
  assert.equal(parseDay("3/12", now), "2026-12-03");
  assert.equal(parseDay("3.12.27", now), "2027-12-03");
  assert.equal(parseDay("30", now), "2026-11-30");
  assert.equal(parseDay("31/11", now), null);
  assert.equal(parseDay("tomorrow", now), null);
  assert.equal(isoDay(now), "2026-11-26");
});

test("labelsOf drops groups, retired and archived labels", () => {
  const v = { labels: [
    { id: "a", name: "Bug", color: "#f00" },
    { id: "g", name: "type", isGroup: true },
    { id: "r", name: "old", retiredAt: "2026-01-01" },
    { id: "s", name: "spec", parent: "type" },
  ] };
  assert.deepEqual(labelsOf(v).map((l) => l.id), ["a", "s"]);
});

test("cyclesOf keeps the running and coming cycles, soonest first", () => {
  const v = [
    { id: "past", number: 1, startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-15T00:00:00Z" },
    { id: "next", number: 5, startsAt: "2027-01-03T00:00:00Z", endsAt: "2027-01-17T00:00:00Z" },
    { id: "cur", number: 4, title: "Blitz", startsAt: "2026-11-22T00:00:00Z", endsAt: "2027-01-03T00:00:00Z", isCurrent: true },
  ];
  const out = cyclesOf(v, Date.parse("2026-11-26T00:00:00Z"));
  assert.deepEqual(out.map((c) => c.id), ["cur", "next"]);
  assert.equal(out[0].name, "Blitz");
});
