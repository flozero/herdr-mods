---
name: sdlc-create-mr
description: Open the merge request: an Excalidraw schema as PNG, the Linear ref, risk, confidence, claude --resume; Florent previews it unless it is trivial.
disable-model-invocation: true
argument-hint: "<ID>"
---

# Merge request

Conventions: `~/.claude/skills/workflow-linear-build/SKILL.md`, **Conventions**. Follow `~/.claude/skills/sdlc-florent-tone/SKILL.md`.

1. **Schema**: draw what changed with the excalidraw MCP (`open_canvas` named `<ID>-mr`, `draw`): before and after, a flow, a call tree or files, small. `export_png`, then Read the PNG.
2. **Description**, the repository's template first when it has one (`.gitlab/merge_request_templates/`), then:

```markdown
<Linear issue link>

![schema](<uploaded PNG>)

<one to three lines: what changes and why>

**Risk:** <dot and level> · **Confidence:** <level>, <why>
**Check:** <how to see it works>

Resume the session: `claude --resume <$CLAUDE_CODE_SESSION_ID>`
```

Save it to `~/.herdr/workflows/<ID>-description.md`.
3. ✋ Show the PNG and the description; change them until Florent stands behind every line. A sentence he rewrites gives a rule for the tone skill's **Learned**. No preview only when risk is 0-1, the change trivial and confidence high.
4. `git push -u --force-with-lease origin <branch>`; upload the PNG (`glab api -X POST "projects/<group%2Fproject>/uploads" -F "file=@<png>"`; its `markdown` replaces the image link); `glab mr create --draft --title "<what changes>" --description "$(cat <file>)" --target-branch <base> --label "risk::<N>" --yes`, or `glab mr update` when it exists. Risk 3-4 stays a draft for a human review: say so.

Done when the merge request shows the schema and the description, and its link is in the memory file.
