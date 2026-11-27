---
name: debug-psql
description: Query a Flare Postgres database read-only through carbon/bin/psql-*, to check the data behind a production problem. Use when investigating a production problem.
argument-hint: "<env> <db> <question>"
---

# psql, read-only

From `~/dev/pyro`: `carbon/bin/psql-<env> --db=<db> -- -c '<sql>'` (`<env>`: `production`, `production-eu`, `staging`, `staging-ca`; `<db>`: `pyro`, `leaksdb`, `saturn`, `processing`…). Never `--write` nor `--admin`: without them it is the read-only user.

Each command starts `set default_transaction_read_only = on; set statement_timeout = '30s';`. Only `select`, `explain` (never `explain analyze` on a heavy query), `pg_stat_*`, `pg_locks`. Count first, then fetch with a `limit`. No personal data in what you return: counts, ids, timestamps.

Return the facts with their query.
