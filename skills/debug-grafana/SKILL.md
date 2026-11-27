---
name: debug-grafana
description: "Read Grafana at Flare with the gcx CLI: Prometheus metrics, Loki logs, alerts, dashboards, for a service and a time window. Use when investigating a production problem."
argument-hint: "<service> <window> <question>"
---

# Grafana

`gcx` (`gcx help-tree`, `gcx commands` for its commands). Only read: `metrics`, `logs`, `alert`, `dashboards`, `datasources`, `traces`, `profiles` queries; never create, update or delete.

Before a Loki query, use the `grafana-alerts:grafana-search` skill: pin the stream selector first, a narrow window, then filter. Look for the dashboard that already queries this service and reuse its queries.

Return timestamped facts (UTC), each with its query and a Grafana link.
