#!/usr/bin/env bash
# Fails if tracked files contain real Databricks workspace identifiers.
set -euo pipefail

pattern='dbc-[0-9a-f]{8}-[0-9a-f]{4}|projects/clawhouse'

if git grep -nIE "$pattern" -- . ':!package-lock.json' ':!scripts/check-no-workspace-ids.sh'; then
  echo
  echo "Found workspace-specific identifiers. Use placeholders (dbc-xxxxxxxx-xxxx, dbc.example) or a gitignored *.local.yml."
  exit 1
fi
