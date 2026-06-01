#!/usr/bin/env bash
# release.sh — build cross-platform binaries, tarball them, compute SHA256s,
#              and (optionally) upload to a GitHub release.
#
# Usage:
#   ./release.sh <version>           # build + tarball, print SHAs
#   ./release.sh <version> --upload  # also: gh release create + upload assets
#
# Requires: bun, tar, sha256sum (or shasum on macOS), gh (only if --upload).

set -euo pipefail

NAME="pigeon"
VERSION="${1:?usage: $0 <version> [--upload]}"
UPLOAD="${2:-}"

OUT="dist/release"
mkdir -p "$OUT"

TARGETS=(
  "bun-darwin-arm64:darwin-arm64"
  "bun-darwin-x64:darwin-x64"
  "bun-linux-arm64:linux-arm64"
  "bun-linux-x64:linux-x64"
)

sha() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}';
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

echo "Building $NAME v$VERSION for 4 targets…"
for t in "${TARGETS[@]}"; do
  bun_target="${t%%:*}"
  out_suffix="${t##*:}"
  staging="$OUT/staging-$out_suffix"
  rm -rf "$staging" && mkdir -p "$staging"
  bun build src/cli.ts --compile --target "$bun_target" --outfile "$staging/$NAME"
  tar -czf "$OUT/$NAME-$out_suffix.tar.gz" -C "$staging" "$NAME"
  rm -rf "$staging"
done

echo
echo "── SHA256s ──────────────────────────────"
for t in "${TARGETS[@]}"; do
  out_suffix="${t##*:}"
  f="$OUT/$NAME-$out_suffix.tar.gz"
  echo "$(sha "$f")  $f"
done
echo

if [[ "$UPLOAD" == "--upload" ]]; then
  TAG="v$VERSION"
  echo "Creating GitHub release $TAG and uploading assets…"
  gh release create "$TAG" \
    --title "$NAME $TAG" \
    --notes "Release $TAG" \
    "$OUT"/*.tar.gz
  echo "Done. Update the formula's sha256 fields with the SHAs above."
fi
