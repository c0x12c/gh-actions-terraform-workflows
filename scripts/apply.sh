#!/usr/bin/env bash
# Runs terraform apply and, on failure, extracts the error so the notification can carry it.
# Shared by actions/terraform-apply and actions/terraform-apply-gcp (they differ only by PLAN_FILE)
# so a fix cannot land in one and miss the other, and testable outside action.yml like plan.sh.
#
# Reads:  REFRESH, PLAN_FILE (optional), RUNNER_TEMP, GITHUB_OUTPUT
# Writes: error_detail (raw), slack_message (fenced) - both empty when the apply succeeds
set -euo pipefail

# Under gh-actions-slack-notify's 2500-char cap, which would otherwise truncate the closing fence.
MAX_ERROR_BYTES="${MAX_ERROR_BYTES:-2000}"

# Per-job, not a fixed /tmp path: two applies on one self-hosted runner would share the log, and
# the trap would delete it out from under the other.
APPLY_LOG="${RUNNER_TEMP:-/tmp}/apply.out"
trap 'rm -f "${APPLY_LOG}"' EXIT

# terraform renders errors bare or inside a box-drawing frame.
ERROR_ONWARD='/^(│ )?Error: /{found=1} found'

run_apply() {
  local args=(-input=false -auto-approve -no-color -refresh="${REFRESH}")
  [ -n "${PLAN_FILE:-}" ] && args+=("${PLAN_FILE}")

  # tee would create the log world-readable. The apply output is not secret-masked and can carry
  # provider request bodies, so it is created 0600 in a subshell umask - restricting it after the
  # fact would leave a window open on a shared runner.
  (umask 077 && : > "${APPLY_LOG}")

  # PIPESTATUS[0] is terraform's own code; under pipefail the pipeline's could be tee's.
  set +e
  terraform apply "${args[@]}" 2>&1 | tee "${APPLY_LOG}"
  local code=${PIPESTATUS[0]}
  set -e
  return "${code}"
}

extract_error() {
  local escape detail
  escape=$'\033'

  # head -c closes the pipe partway through a long error; the SIGPIPE that sends upstream would
  # kill the script before it publishes anything.
  set +e +o pipefail
  # ANSI is stripped despite -no-color because a caller can force colour via TF_CLI_ARGS_apply.
  # The cap is in bytes, so it can land inside a multi-byte character - terraform's own box-drawing
  # frame is three bytes wide. iconv -c drops the incomplete tail rather than emitting invalid UTF-8.
  detail=$(sed -E "s/${escape}\[[0-9;]*[a-zA-Z]//g" "${APPLY_LOG}" \
    | awk "${ERROR_ONWARD}" \
    | head -c "${MAX_ERROR_BYTES}" \
    | iconv -c -f utf-8 -t utf-8)
  # The CLI died before rendering an error block; the tail beats saying nothing.
  [ -n "${detail}" ] || detail=$(tail -c "${MAX_ERROR_BYTES}" "${APPLY_LOG}" | iconv -c -f utf-8 -t utf-8)
  set -e -o pipefail

  # A fence terminator would close the Slack code block early and let the rest render as mrkdwn.
  printf '%s' "${detail//'```'/"'''"}"
}

# Random delimiter, and any line matching it dropped, so error text cannot forge an output.
publish_output() {
  local name=$1 value=$2
  local delimiter="EOF_${RANDOM}${RANDOM}"
  {
    echo "${name}<<${delimiter}"
    printf '%s\n' "${value}" | { grep -v -x -F "${delimiter}" || true; }
    echo "${delimiter}"
  } >> "${GITHUB_OUTPUT}"
}

apply_code=0
run_apply || apply_code=$?
[ "${apply_code}" -eq 0 ] && exit 0

error=$(extract_error)
publish_output error_detail "${error}"
# An empty fence would post an empty code block, so send nothing instead.
[ -n "${error}" ] && publish_output slack_message '```'"${error}"'```'

exit "${apply_code}"
