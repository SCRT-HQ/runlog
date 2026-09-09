#!/usr/bin/env bash
# The version the next release becomes: the tag after the latest, bumped by
# what the commits since it say. Used by the dev deploy (so the footer on
# dev says the number) and again by the release (so the number is right
# even when a release cut in between took the one dev was built with).
#
# How big the step is comes from the commits since the last tag, which are
# the squash commits of the pull requests that landed, titled in
# Conventional Commits form (CONTRIBUTING.md, "Releases"): a `!` after the
# type or a "BREAKING CHANGE" footer makes a major, else a `feat` makes a
# minor, else a patch. The first argument may say outright (major, minor,
# patch); its default, auto, reads the titles.
#
# Prints two lines: `tag=vX.Y.Z` and `version=X.Y.Z`.
set -euo pipefail
bump="${1:-auto}"
latest="$(git tag -l 'v[0-9]*' --sort=-v:refname | head -1)"
if [ -z "$latest" ]; then latest="v0.0.0"; fi
if [ "$bump" = "auto" ]; then
  bump=patch
  range="HEAD"
  if git rev-parse -q --verify "refs/tags/${latest}" >/dev/null 2>&1; then range="${latest}..HEAD"; fi
  subjects="$(git log "$range" --format=%s)"
  bodies="$(git log "$range" --format=%B)"
  if grep -qE '^[a-z]+(\([^)]*\))?!:' <<<"$subjects" || grep -q '^BREAKING CHANGE' <<<"$bodies"; then
    bump=major
  elif grep -qE '^feat(\([^)]*\))?:' <<<"$subjects"; then
    bump=minor
  fi
  echo "The titles since ${latest} call for a ${bump} bump" >&2
fi
IFS='.' read -r major minor patch <<< "${latest#v}"
case "$bump" in
  major) major=$((major + 1)); minor=0; patch=0 ;;
  minor) minor=$((minor + 1)); patch=0 ;;
  *)     patch=$((patch + 1)) ;;
esac
next="v${major}.${minor}.${patch}"
echo "Previous ${latest} -> next ${next}" >&2
echo "tag=${next}"
echo "version=${next#v}"
