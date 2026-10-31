#!/usr/bin/env bash
set -euo pipefail

# Publish Taisce.
#
# Two halves, deliberately separate:
#   1. this script bumps the version, commits it, tags the release, pushes `main`
#      and pushes a fixed whitelist of site files to the `public` branch;
#   2. GitHub Pages serves `public` — that deployment is Pages' own configured
#      pipeline, so this repository has no workflow of its own.
#
# Point Pages at `public` /(root) once:
#   Settings → Pages → Build and deployment → Deploy from a branch → public
#
# Usage:
#   ./publish.sh --no-push   # print the next version, change nothing
#   ./publish.sh             # bump, commit, tag, push main + tag + public

PAGES_BRANCH="public"
SITE_FILES=(
  index.html
  styles.css
  app.js
  js
  vendor
  icons
  manifest.webmanifest
  sw.js
  docs
)

NO_PUSH=false
[[ "${1:-}" == "--no-push" ]] && NO_PUSH=true

# --- Next version from the latest tag -------------------------------------
LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
LATEST_TAG=${LATEST_TAG#v}
IFS='.' read -r MAJOR MINOR _ <<<"$LATEST_TAG"
MAJOR=${MAJOR:-0}
MINOR=${MINOR:-0}
NEXT_VERSION="v${MAJOR}.$((MINOR + 1))"

if $NO_PUSH; then
  echo "Next version: ${NEXT_VERSION}"
  echo "Would stamp it into index.html and sw.js, tag it, and publish:"
  printf '  %s\n' "${SITE_FILES[@]}"
  exit 0
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean — commit or stash before publishing." >&2
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "main" ]]; then
  echo "Publish from main only — currently on ${BRANCH}." >&2
  exit 1
fi

# A half-finished run leaves the tag behind; say so rather than failing later
# with "tag already exists" after the version has been stamped.
if git rev-parse --verify "refs/tags/${NEXT_VERSION}" >/dev/null 2>&1; then
  echo "Tag ${NEXT_VERSION} already exists — a previous publish stopped part-way." >&2
  echo "Delete it (git tag -d ${NEXT_VERSION}) or raise the version, then retry." >&2
  exit 1
fi

# --- Stamp the version -----------------------------------------------------
# The shell cache is network-first, but the cache name still has to change so a
# stale copy cannot be served to an installed device.
sed -i.bak "s|content=\"v[0-9][0-9.]*\"|content=\"${NEXT_VERSION}\"|" index.html
sed -i.bak "s|const CACHE = 'taisce-v[0-9][0-9.]*';|const CACHE = 'taisce-${NEXT_VERSION}';|" sw.js
rm -f index.html.bak sw.js.bak

if ! git diff --quiet -- index.html sw.js; then
  git add index.html sw.js
  git commit -q -m "Bump version to ${NEXT_VERSION}"
fi

git tag -a "$NEXT_VERSION" -m "Release ${NEXT_VERSION}"

# --- Publish the site as a fresh snapshot on the deployment branch ---------
# Stage only the whitelist into a throwaway index: test/, tools/ and .github/
# can never be fetched from the site.
TMP_INDEX="$(mktemp)"
trap 'rm -f "$TMP_INDEX"' EXIT
GIT_INDEX_FILE="$TMP_INDEX" git read-tree --empty

for entry in "${SITE_FILES[@]}"; do
  if [[ -f "$entry" ]]; then
    GIT_INDEX_FILE="$TMP_INDEX" git add "$entry"
  elif [[ -d "$entry" && -n "$(find "$entry" -type f -print -quit)" ]]; then
    GIT_INDEX_FILE="$TMP_INDEX" git add "$entry"
  fi
done

TREE=$(GIT_INDEX_FILE="$TMP_INDEX" git write-tree)
PARENT=""
if git rev-parse --verify "origin/${PAGES_BRANCH}" >/dev/null 2>&1; then
  PARENT="$(git rev-parse "origin/${PAGES_BRANCH}")"
fi

# macOS ships bash 3.2, where an empty array expanded under `set -u` is an
# unbound variable. Keep this branch, not an array.
if [[ -n "$PARENT" ]]; then
  COMMIT=$(git commit-tree "$TREE" -p "$PARENT" -m "Publish ${NEXT_VERSION}")
else
  COMMIT=$(git commit-tree "$TREE" -m "Publish ${NEXT_VERSION}")
fi

git push origin "$COMMIT:refs/heads/${PAGES_BRANCH}"
git push origin "$BRANCH"
git push origin "$NEXT_VERSION"

echo
echo "Published ${NEXT_VERSION} to the ${PAGES_BRANCH} branch."
echo "GitHub Pages serves it at https://ptaylor.github.io/taisce/"
