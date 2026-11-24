---
name: workflow-investigate
description: Investigate a bug, an alert or a slowdown read-only, with a feedback loop that reproduces it, until the cause is proven; then offer a ticket or the fix
disable-model-invocation: true
argument-hint: "What is wrong, a Sentry or Linear link, or an alert"
---

# Investigate

Based on Matt Pocock's `diagnosing-bugs` skill (github.com/mattpocock/skills, MIT).

Talk to Florent in French, short. Redact every secret you show (`<REDACTED>`).

1. **Feedback loop first.** Build one command that goes red on this exact symptom: a failing test, a curl, a CLI run against a fixture, a replayed payload, a log or metric query that shows it. Run it, show the command and its output. If you can't build one, say what you tried and ask for access or a captured artifact. No theory before the loop.
2. **Reproduce and minimise**: it must be Florent's symptom, not a nearby one. Cut inputs one at a time until every remaining piece is needed.
3. **Hypotheses**: 3 to 5, ranked, each with the prediction that would prove it wrong. Show them before testing; he may re-rank them.
4. **Probe** one variable at a time. Debug logs carry a unique prefix (`[DEBUG-xxxx]`) and all go away at the end.
5. **Report**: the cause, the proof (the loop's output before and after), the fix you'd make, and whether a test can lock it.
6. Ask what to do next: create a Linear ticket with the findings (Context, Findings with the commands, Proposed change, Done when; `save_issue` on stdin), go on with `workflow-problem` from these findings, or stop there.
