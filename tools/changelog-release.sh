#!/usr/bin/env bash
# CHANGELOG-driven release. When the top "## [vX.Y.Z]" section is finalized on master,
# tag the version, move the vX.Y / vX aliases (consumers pin @vN), and publish a GitHub
# Release whose body is that section. Idempotent (a CHANGELOG edit that introduces no new,
# un-tagged top version is a no-op) and monotonic. Single-job: it publishes in place, so there
# is no tag-triggered second workflow.
#
# Env:
#   CHANGELOG_FILE  changelog path (default CHANGELOG.md)
#   DRY_RUN         "true" logs the verdict + notes and changes nothing (default "false")
#   REMOTE          git remote (default origin)
#   GH_TOKEN        token for `gh release create` (non-dry-run)
#
# The tags are pushed by git, so it is the REMOTE's credentials - not GH_TOKEN - that must be
# allowed to create them; see the ruleset note in .github/workflows/release.yml.
# Exit: 0 = released or intentional no-op; 1 = malformed / non-increasing / empty body.
set -euo pipefail

CHANGELOG_FILE="${CHANGELOG_FILE:-CHANGELOG.md}"
DRY_RUN="${DRY_RUN:-false}"
REMOTE="${REMOTE:-origin}"

log() { echo "[release] $*"; }

heading="$(grep -m1 -oE '^## \[[^]]+\]' "$CHANGELOG_FILE" || true)"
if [ -z "$heading" ]; then
  log "ERROR: no '## [..]' section found in ${CHANGELOG_FILE}"; exit 1
fi
top="${heading#'## ['}"; top="${top%']'}"
log "Top CHANGELOG section: [${top}]"

# Gate on the heading only; a bottom "[Unreleased]: <url>" link-reference is fine.
if [ "$top" = "Unreleased" ]; then
  log "Top section is [Unreleased]; not finalized (no-op)."; exit 0
fi
if ! [[ "$top" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  log "ERROR: top section '${top}' is not a (v)X.Y.Z version."; exit 1
fi
# Tag is always v-prefixed regardless of how the heading was written.
version="$top"; [[ "$version" == v* ]] || version="v${version}"

# Remote tags are authoritative (the clone may be behind).
remote_tags="$(git ls-remote --tags "$REMOTE" | sed -E 's#.*refs/tags/##; s#\^\{\}$##' | sort -u)"

# Idempotency: only cut a version that has never been tagged.
if printf '%s\n' "$remote_tags" | grep -qx "$version"; then
  log "Tag ${version} already exists on ${REMOTE}; already released (no-op)."; exit 0
fi

# Monotonicity: numeric compare (sort -V), so v3.10.0 > v3.9.0 rather than lexical.
latest="$(printf '%s\n' "$remote_tags" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1 || true)"
if [ -n "$latest" ]; then
  highest="$(printf '%s\n%s\n' "$version" "$latest" | sort -V | tail -1)"
  if [ "$highest" != "$version" ]; then
    log "ERROR: ${version} is not strictly greater than the latest released ${latest}."; exit 1
  fi
fi

# Section body: lines after the matched heading, up to the next "## [" heading or the first
# "[label]: url" link-reference, trailing blanks trimmed. VERSION is regex-escaped so "."
# can't match a wrong heading. (Extractor pattern from c0x12c/secret-keychain.)
ver_re="$(printf '%s' "$top" | sed 's/[][\\.^$*+?(){}|/]/\\&/g')"
body="$(awk -v pat="^## \\\\[${ver_re}\\\\]" '
  {
    if (found && (/^## \[/ || /^\[[^]]+\]:[[:space:]]/)) exit
    if (!found && $0 ~ pat) { found=1; next }
    if (found) print
  }
' "$CHANGELOG_FILE" | sed -e '/./,$!d' | awk 'BEGIN{n=0}{l[n++]=$0}END{e=n;while(e>0&&l[e-1]=="")e--;for(i=0;i<e;i++)print l[i]}')"
if [ -z "$body" ]; then
  log "ERROR: empty changelog body for ${top}."; exit 1
fi

minor="${version%.*}"    # vX.Y
major="${version%%.*}"   # vX
head_sha="$(git rev-parse --short HEAD)"

if [ "$DRY_RUN" = "true" ]; then
  log "DRY RUN: would release ${version} at ${head_sha}; move ${minor} + ${major} (latest was ${latest:-none}); notes:"
  printf '%s\n' "$body" | sed 's/^/  | /'
  exit 0
fi

log "Releasing ${version} at ${head_sha} (latest was ${latest:-none}); moving ${minor} + ${major}."
git tag -a "$version" -m "Release ${version}"
git push "$REMOTE" "$version"
git tag -f "$minor" "$version"
git push "$REMOTE" "$minor" --force
git tag -f "$major" "$version"
git push "$REMOTE" "$major" --force
printf '%s\n' "$body" | gh release create "$version" --title "$version" --notes-file -
log "Released ${version}."
