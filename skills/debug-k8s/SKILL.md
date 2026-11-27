---
name: debug-k8s
description: Read the Kubernetes clusters at Flare through carbon/bin/kubectl-*: pods, restarts, events, logs, resources. Use when investigating a production problem.
argument-hint: "<env> <namespace or service> <question>"
---

# Kubernetes

From `~/dev/pyro`, only through the wrappers: `carbon/bin/kubectl-<env>-developer` (`<env>`: `production`, `production-eu`, `staging`, `staging-ca`). Never `kubectl` alone, never an `-admin` wrapper.

Only read: `get`, `describe`, `logs` (with `--since` and `--tail`), `top`, `get events --sort-by=.lastTimestamp`, `rollout history`. Never `exec`, `delete`, `apply`, `edit`, `patch`, `scale`, `rollout restart`, `port-forward`, `cp`.

Return timestamped facts (UTC): restarts and their reason (OOMKilled, CrashLoopBackOff), events, the image and when it rolled out, resource use against limits; each with its command.
