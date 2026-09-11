#!/usr/bin/env bash
# Summarise the rendered plan: job-summary rendering plus outputs for callers.
#
# The job summary is the point. It renders on the run page, which is the same page carrying the
# "Review pending deployments" button, so an approver sees what they are approving without
# opening a job. On a tag build the PR comment is skipped entirely (no pull request exists), so
# this is the only place a tag-time plan appears.
#
# ADDRESSES AND COUNTS ONLY IN THE OUTPUTS, never attribute diffs. Callers forward outputs to
# chat and paging systems where a rendered plan's `~ attr = value` lines - database passwords,
# connection strings - would outlive the run and reach a wider audience than repo auth allows.
# The job summary is behind the same auth as the log, so it carries the full rendered plan.
#
# Reads: RUNNER_TEMP, GITHUB_OUTPUT, GITHUB_STEP_SUMMARY, PLAN_MAX_ROWS.
set -euo pipefail

PLAN_OUT="${RUNNER_TEMP:-/tmp}/plan.out"
MAX_ROWS="${PLAN_MAX_ROWS:-20}"

emit() { printf '%s\n' "$1" >> "${GITHUB_OUTPUT:-/dev/null}"; }

# A missing plan must never be why a deploy stalls, so degrade rather than fail.
if [ ! -f "$PLAN_OUT" ]; then
  echo "no plan.out found, skipping summary" >&2
  emit "counts="
  emit "total=0"
  emit "has_destroy=false"
  exit 0
fi

# "must be replaced" as well as "will be ...": terraform renders a replacement with a different
# verb, so a regex matching only "will be" drops the highest-risk rows while has_destroy below
# still reports true - a warning whose offending resources are missing from it.
CHANGE_RE="^  # .*(will be|must be) "

counts=$(grep -E "^(Plan:|No changes\.)" "$PLAN_OUT" | tail -1 || true)
changes=$(grep -E "$CHANGE_RE" "$PLAN_OUT" | sed 's/^  # //' | head -"$MAX_ROWS" || true)
total=$(grep -cE "$CHANGE_RE" "$PLAN_OUT" || true)

# Anchored to the resource-header marker, not a bare file search: an attribute value containing
# "will be destroyed" would otherwise report a destructive plan on a harmless one, and a warning
# that cries wolf trains the reflex to approve past it.
if grep -qE "^  # .*(will be destroyed|must be replaced)" "$PLAN_OUT"; then
  has_destroy=true
else
  has_destroy=false
fi

emit "counts=${counts:-unknown}"
emit "total=${total:-0}"
emit "has_destroy=${has_destroy}"
emit "changes<<PLAN_EOF"
printf '%s\n' "${changes:-(no resource changes)}" >> "${GITHUB_OUTPUT:-/dev/null}"
emit "PLAN_EOF"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    if [ "$has_destroy" = true ]; then
      echo "### Terraform plan - DESTROYS OR REPLACES RESOURCES"
    else
      echo "### Terraform plan"
    fi
    echo
    echo "**${counts:-unknown}**"
    echo
    echo '<details><summary>Full plan</summary>'
    echo
    echo '```terraform'
    cat "$PLAN_OUT"
    echo '```'
    echo
    echo '</details>'
  } >> "$GITHUB_STEP_SUMMARY"
fi
