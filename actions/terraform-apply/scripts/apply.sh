#!/usr/bin/env bash
# Run terraform apply, capture ITS OWN exit code, and extract the underlying error so the
# failure notification can carry it. Extracted from action.yml so it can be shellcheck'd and
# unit-tested directly, mirroring actions/terraform-plan/scripts/plan.sh.
#
# Reads: REFRESH, GITHUB_OUTPUT. Writes: error_detail to GITHUB_OUTPUT, /tmp/apply.out.
set -euo pipefail

# 2000 bytes leaves room under gh-actions-slack-notify's 2500-char cap for the code fence and
# the surrounding text; if that cap fired it would cut the closing fence and break the block.
MAX_ERROR_BYTES="${MAX_ERROR_BYTES:-2000}"

# Capture terraform's OWN exit code via PIPESTATUS[0] - not the pipeline status, which under
# pipefail could be tee's. set +e so an apply error doesn't abort before we read it.
set +e
terraform apply -input=false -auto-approve -no-color -refresh="${REFRESH}" 2>&1 | tee /tmp/apply.out
apply_code=${PIPESTATUS[0]}
set -e

if [ "${apply_code}" -eq 0 ]; then
  exit 0
fi

# Extraction runs with -e/pipefail off: `head -c` closes the pipe early on a long error, which
# hands the upstream awk a SIGPIPE that would otherwise kill the script before it writes the
# output - i.e. exactly the errors worth reporting would report nothing.
set +e +o pipefail
# Strip ANSI even though -no-color is passed: a caller can force color through TF_CLI_ARGS_apply.
# terraform prefixes errors with a box-drawing bar when it renders them in a frame.
details=$(sed -E $'s/\033\\[[0-9;]*[a-zA-Z]//g' /tmp/apply.out \
  | awk '/^(│ )?Error: /{found=1} found' \
  | head -c "${MAX_ERROR_BYTES}")
# No Error: block (e.g. the CLI died before rendering one) - fall back to the log tail.
if [ -z "${details}" ]; then
  details=$(tail -c "${MAX_ERROR_BYTES}" /tmp/apply.out)
fi
set -e -o pipefail

# Heredoc delimiter must not occur in the body, or the error text could forge output entries.
delimiter="EOF_apply_error_${RANDOM}${RANDOM}"
{
  echo "error_detail<<${delimiter}"
  printf '%s\n' "${details}" | { grep -v -x -F "${delimiter}" || true; }
  echo "${delimiter}"
} >> "${GITHUB_OUTPUT}"

exit "${apply_code}"
