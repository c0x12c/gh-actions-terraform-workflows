#!/usr/bin/env bash
# Cut a release from the top CHANGELOG version: tag vX.Y.Z and move the vX.Y / vX
# aliases. Driven by the "## [vX.Y.Z]" heading (the declared source of truth), not a
# bump level. Idempotent: a CHANGELOG edit that doesn't introduce a new, un-tagged top
# version is a no-op, so re-runs / unrelated edits never re-cut a release.
#
# Env:
#   CHANGELOG_FILE  path to the changelog (default CHANGELOG.md)
#   DRY_RUN         "true" logs the verdict and pushes nothing (default "false")
#   REMOTE          git remote (default origin)
# Exit: 0 = released or intentional no-op; 1 = malformed / non-increasing version.
set -euo pipefail

CHANGELOG_FILE="${CHANGELOG_FILE:-CHANGELOG.md}"
DRY_RUN="${DRY_RUN:-false}"
REMOTE="${REMOTE:-origin}"

log() { echo "[release-on-changelog] $*"; }

heading="$(grep -m1 -oE '^## \[[^]]+\]' "$CHANGELOG_FILE" || true)"
if [ -z "$heading" ]; then
  log "ERROR: no '## [..]' section found in ${CHANGELOG_FILE}"; exit 1
fi
top="${heading#'## ['}"; top="${top%']'}"
log "Top CHANGELOG section: [${top}]"

# Not finalized yet - the release is cut when the section is stamped with a version.
if [ "$top" = "Unreleased" ]; then
  log "Top section is [Unreleased]; skipping (no-op)."; exit 0
fi

if ! [[ "$top" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  log "ERROR: top section '${top}' is not a vX.Y.Z version."; exit 1
fi
version="$top"

# Remote tags are authoritative (the local clone may be shallow / behind).
remote_tags="$(git ls-remote --tags "$REMOTE" | sed -E 's#.*refs/tags/##; s#\^\{\}$##' | sort -u)"

# Idempotency guard: only cut a version that has never been tagged.
if printf '%s\n' "$remote_tags" | grep -qx "$version"; then
  log "Tag ${version} already exists on ${REMOTE}; already released (no-op)."; exit 0
fi

# Monotonicity guard: numeric (sort -V), so v3.10.0 > v3.9.0 rather than lexical.
latest="$(printf '%s\n' "$remote_tags" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1 || true)"
if [ -n "$latest" ]; then
  highest="$(printf '%s\n%s\n' "$version" "$latest" | sort -V | tail -1)"
  if [ "$highest" != "$version" ]; then
    log "ERROR: ${version} is not strictly greater than the latest released ${latest}."; exit 1
  fi
fi

minor="${version%.*}"    # vX.Y
major="${version%%.*}"   # vX
head_sha="$(git rev-parse --short HEAD)"

if [ "$DRY_RUN" = "true" ]; then
  log "DRY RUN: would tag ${version} at ${head_sha} and move ${minor} + ${major} to it (latest was ${latest:-none}). Nothing pushed."
  exit 0
fi

log "Releasing ${version} at ${head_sha} (latest was ${latest:-none}); moving ${minor} + ${major}."
# Annotated tag for the release (matches tools/semtag); the vX.Y / vX aliases below stay
# lightweight force-moves, matching tools/create_release.sh.
git tag -a "$version" -m "Release ${version}"
git push "$REMOTE" "$version"
git tag -f "$minor" "$version"
git push "$REMOTE" "$minor" --force
git tag -f "$major" "$version"
git push "$REMOTE" "$major" --force
log "Released ${version}."
