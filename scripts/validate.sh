#!/usr/bin/env bash
# Validate, keeping the output for the PR comment. Shared by terraform-plan and terraform-plan-gcp.
#
# Reads: RUNNER_TEMP. Writes: <RUNNER_TEMP>/validate_output.txt
set -euo pipefail

# Per-job dir at 0600, for the same reasons as the plan output - see scripts/gcp-plan.sh.
umask 077
terraform validate -no-color > "${RUNNER_TEMP:-/tmp}/validate_output.txt"
