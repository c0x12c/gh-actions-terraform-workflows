#!/usr/bin/env bash
# Deliver the approval notice. Payload shape lives in payload.py; this owns delivery only.
set -euo pipefail

if [ -z "${SLACK_WEBHOOK_URL:-}" ]; then
  echo "No webhook configured, skipping notification" >&2
  exit 0
fi

payload=$(python3 "$(dirname "$0")/payload.py")

# URL through --config on stdin rather than argv: a webhook is a credential - anyone holding it
# can post to the channel - and argv is readable by every process on the runner.
#
# No stdout redirect: --fail-with-body prints the response body on failure, and that body is the
# only diagnostic for a rejected webhook. Slack answers "ok" on success, so the noise is one word.
printf 'url = "%s"\n' "$SLACK_WEBHOOK_URL" | \
  curl -sS --fail-with-body -X POST -H 'Content-type: application/json' \
    --data "$payload" --config -
