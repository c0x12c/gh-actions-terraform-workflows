#!/usr/bin/env bash
# Run terraform plan, capture ITS OWN exit code, and render the result for the PR comment.
# Extracted from action.yml so it can be shellcheck'd and unit-tested directly.
#
# Any real failure (a plan error, or a failing show/cp) exits non-zero, so the step's
# outcome is 'failure' and the gate catches it. The plan itself is allowed to exit non-zero
# without aborting - an error is reported through the comment, not just crashed.
#
# Reads: REFRESH, RUNNER_TEMP, GITHUB_OUTPUT. Writes: ${RUNNER_TEMP}/plan.out (kept for the
# comment step).
set -euo pipefail

# Per-job dir, not a fixed /tmp path: two plans on one self-hosted runner would otherwise share
# these files, and the trap below would delete them out from under the other.
TMP="${RUNNER_TEMP:-/tmp}"
# The rendered plan carries resource attributes and is not secret-masked, so nothing here should
# be readable by other users on a shared runner.
umask 077

trap 'rm -f "${TMP}/plan.tmp" "${TMP}/plan.raw" "${TMP}/plan.err"' EXIT

# Capture terraform's OWN exit code via PIPESTATUS[0] - not the pipeline status, which under
# pipefail could be tee's. set +e so a plan error doesn't abort before we read it.
set +e
terraform plan -input=false -no-color -lock=false -refresh="${REFRESH}" -out="${TMP}/plan.tmp" 2>&1 | tee "${TMP}/plan.raw"
plan_code=${PIPESTATUS[0]}
set -e
echo "plan_exitcode=${plan_code}" >> "${GITHUB_OUTPUT}"

if [ "${plan_code}" -ne 0 ]; then
  cp "${TMP}/plan.raw" "${TMP}/plan.out"
  exit "${plan_code}"
fi

# Success: render the plan. On the happy path plan.out is the show stdout only (no stderr
# warnings polluting the comment); only if show fails do we append its stderr, so the error
# still surfaces in the comment, then exit non-zero -> outcome=failure -> the gate fires.
show_code=0
terraform show -no-color "${TMP}/plan.tmp" > "${TMP}/plan.out" 2>"${TMP}/plan.err" || show_code=$?
if [ "${show_code}" -ne 0 ]; then
  cat "${TMP}/plan.err" >> "${TMP}/plan.out"
  exit "${show_code}"
fi
