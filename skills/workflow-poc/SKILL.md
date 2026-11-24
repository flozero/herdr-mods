---
name: workflow-poc
description: Build a throwaway prototype that answers one question (does this logic hold, what should this look like), then capture the answer
disable-model-invocation: true
argument-hint: "The question the prototype answers"
---

# Proof of concept

Based on Matt Pocock's `prototype` skill (github.com/mattpocock/skills, MIT).

Talk to Florent in French, short. A prototype is throwaway code that answers one question; agree on that question first, in one sentence.

- **Logic or state model**: one HTML file he opens directly, with buttons to push the state through the hard cases and the full state shown after each action.
- **UI**: several really different variants on one route of the app, switched with a URL parameter and a small floating bar.

Rules:

1. Work on a throwaway branch in its own worktree (`<prefix>/poc-<few-words>`), next to the code it's for, named so nobody mistakes it for real code.
2. One command or a double-click to run it. No persistence, no tests, no polish.
3. When he has his answer: write the verdict and the question it settled (on the Linear ticket when there is one, else here), push the branch so it can be found, and offer to go on with `workflow-problem` for the real change. The main branch gets only the decision, never the prototype.
