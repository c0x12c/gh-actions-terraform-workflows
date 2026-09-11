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

# The verb list is explicit and end-anchored, which buys two things a loose "will be" would not.
#
# It excludes "will be read during apply", which terraform emits for data sources. Those are not
# changing resources and do not appear in its add/change/destroy counts, so matching them would
# make total disagree with the plan's own summary line.
#
# It also stops an ADDRESS containing one of these phrases from matching, since the verb must end
# the line - aws_instance.foo["will be destroyed"] will be updated in-place is an update.
CHANGE_RE="^  # .+ (will be (created|destroyed|updated in-place)|must be replaced)\$"

counts=$(grep -E "^(Plan:|No changes\.)" "$PLAN_OUT" | tail -1 || true)
changes=$(grep -E "$CHANGE_RE" "$PLAN_OUT" | sed 's/^  # //' | head -"$MAX_ROWS" || true)
total=$(grep -cE "$CHANGE_RE" "$PLAN_OUT" || true)

# Anchored to the resource header and to end-of-line, not a bare file search: an attribute value -
# or an address embedding the phrase - would otherwise report a destructive plan on a harmless one,
# and a warning that cries wolf trains the reflex to approve past it.
if grep -qE "^  # .+ (will be destroyed|must be replaced)\$" "$PLAN_OUT"; then
  has_destroy=true
else
  has_destroy=false
fi

emit "counts=${counts:-unknown}"
emit "total=${total:-0}"
emit "has_destroy=${has_destroy}"
# Random delimiter, not a fixed word: a line in the payload equal to the delimiter would close
# the heredoc early and let the rest be read as further outputs. Addresses come from the .tf
# under review, so the payload is not fully under this script's control.
delim="PLAN_EOF_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
emit "changes<<${delim}"
# Empty, never a placeholder: the output is documented as addresses only, and a caller rendering
# it as a list would print the placeholder as though it were a resource.
if [ -n "$changes" ]; then
  printf '%s\n' "$changes" >> "${GITHUB_OUTPUT:-/dev/null}"
fi
emit "${delim}"

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
    # Fence one backtick longer than the longest run the plan itself contains. A terraform string
    # or heredoc holding ``` would otherwise close the block and hide the rest of the "full" plan.
    longest=$(grep -oE '^`+' "$PLAN_OUT" | awk '{ if (length($0) > n) n = length($0) } END { print n+0 }' || true)
    fence=$(printf '`%.0s' $(seq 1 $(( longest > 2 ? longest + 1 : 3 ))))
    echo "${fence}terraform"
    cat "$PLAN_OUT"
    echo "${fence}"
    echo
    echo '</details>'
  } >> "$GITHUB_STEP_SUMMARY"
fi
