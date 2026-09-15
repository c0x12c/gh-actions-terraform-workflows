#!/usr/bin/env bash
# Render the release notes for the ref being applied, so an approver sees WHAT ships rather than
# only how many resources move.
#
# Generated here rather than by each caller: GitHub already produces this exact list for the
# release page, so every consumer reimplementing the commit walk would reimplement it differently.
#
# Emits nothing and exits 0 on every failure path. A missing changelog must never block the
# approval notice, because the notice is what gates the deploy.
set -euo pipefail

if [ -n "${CHANGELOG_INPUT:-}" ]; then
  printf '%s' "$CHANGELOG_INPUT"
  exit 0
fi

[ -n "${GITHUB_TOKEN:-}" ] || exit 0
[ "${REF_TYPE:-}" = "tag" ] || exit 0

payload=$(REF_NAME="$REF_NAME" python3 -c 'import json, os; print(json.dumps({"tag_name": os.environ["REF_NAME"]}))')

response=$(curl -sS --fail -X POST \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "${GITHUB_API_URL:-https://api.github.com}/repos/${REPO}/releases/generate-notes" \
  --data "$payload") || exit 0

printf '%s' "$response" | python3 -c 'import sys, json
try:
    print(json.load(sys.stdin).get("body", ""), end="")
except Exception:
    pass'
