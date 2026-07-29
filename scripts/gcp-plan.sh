#!/usr/bin/env bash
# Plan and render it for the PR comment. Shared by terraform-plan-gcp and terraform-apply-gcp,
# which ran identical copies of this - the apply then applies the saved plan.
#
# Reads: REFRESH, RUNNER_TEMP. Writes: <RUNNER_TEMP>/plan.tmp, <RUNNER_TEMP>/plan.out
set -euo pipefail

# The rendered plan carries resource attributes and is not secret-masked, so it should not be
# readable by other users on a shared runner. Per-job dir for the same reason, and because two
# plans on one runner would otherwise share the path.
umask 077
TMP="${RUNNER_TEMP:-/tmp}"

terraform plan -input=false -no-color -lock=false -refresh="${REFRESH}" -out="${TMP}/plan.tmp"
terraform show -no-color "${TMP}/plan.tmp" > "${TMP}/plan.out"
