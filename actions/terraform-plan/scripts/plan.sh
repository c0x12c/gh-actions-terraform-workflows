#!/usr/bin/env bash
# Run terraform plan, capture ITS OWN exit code, and render the result for the PR comment.
# Extracted from action.yml so it can be shellcheck'd and unit-tested directly.
#
# Any real failure (a plan error, or a failing show/cp) exits non-zero, so the step's
# outcome is 'failure' and the gate catches it. The plan itself is allowed to exit non-zero
# without aborting - an error is reported through the comment, not just crashed.
#
# Reads: REFRESH, GITHUB_OUTPUT. Writes: /tmp/plan.out (kept for the comment step).
set -euo pipefail

trap 'rm -f /tmp/plan.tmp /tmp/plan.raw /tmp/plan.err' EXIT

# Capture terraform's OWN exit code via PIPESTATUS[0] - not the pipeline status, which under
# pipefail could be tee's. set +e so a plan error doesn't abort before we read it.
set +e
terraform plan -input=false -no-color -lock=false -refresh="${REFRESH}" -out=/tmp/plan.tmp 2>&1 | tee /tmp/plan.raw
plan_code=${PIPESTATUS[0]}
set -e
echo "plan_exitcode=${plan_code}" >> "${GITHUB_OUTPUT}"

if [ "${plan_code}" -ne 0 ]; then
  cp /tmp/plan.raw /tmp/plan.out
  exit "${plan_code}"
fi

# Success: render the plan. On the happy path plan.out is the show stdout only (no stderr
# warnings polluting the comment); only if show fails do we append its stderr, so the error
# still surfaces in the comment, then exit non-zero -> outcome=failure -> the gate fires.
show_code=0
terraform show -no-color /tmp/plan.tmp > /tmp/plan.out 2>/tmp/plan.err || show_code=$?
if [ "${show_code}" -ne 0 ]; then
  cat /tmp/plan.err >> /tmp/plan.out
  exit "${show_code}"
fi
