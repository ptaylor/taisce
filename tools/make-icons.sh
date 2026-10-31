#!/usr/bin/env bash
set -euo pipefail

# Rasterise icons/icon.svg into every PNG the app, the README and the Dropbox
# App Console need. icons/icon.svg is the single source of the artwork: change
# it, run this, and commit both the SVG and the PNGs in one commit.
#
# Requires ImageMagick (`magick`). The SVG deliberately uses flat colours only —
# ImageMagick's built-in renderer ignores gradients.

cd "$(dirname "$0")/.."
SVG="icons/icon.svg"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

magick -background none -density 288 "$SVG" -resize 1024x1024 "$TMP/base.png"

for size in 64 192 256 512 1024; do
  magick "$TMP/base.png" -resize "${size}x${size}" -depth 8 "icons/icon-$size.png"
done

# Store/press icon and the 256 the Dropbox App Console asks for are the same file;
# 64 and 256 are the two sizes Dropbox accepts for app branding.

# Android adaptive icon: full-bleed background, art inside the 80% safe zone.
magick -size 512x512 "xc:#23297a" \
  \( "$TMP/base.png" -resize 512x512 -resize 80% \) -gravity center -composite \
  -depth 8 PNG32:"icons/icon-maskable-512.png"

# iOS applies its own mask, so the touch icon is full-bleed too.
magick -size 180x180 "xc:#23297a" \
  \( "$TMP/base.png" -resize 180x180 -resize 86% \) -gravity center -composite \
  -depth 8 PNG32:"icons/apple-touch-icon.png"

echo "wrote:"
ls -1 icons/*.png
