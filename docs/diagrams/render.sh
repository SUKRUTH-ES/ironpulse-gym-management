#!/usr/bin/env bash
# Renders an SVG in docs/diagrams to PNG with headless Microsoft Edge.
# usage: bash docs/diagrams/render.sh er-diagram 2600 1960
set -e
here="$(cd "$(dirname "$0")" && pwd -W 2>/dev/null || pwd)"
name="$1"; w="$2"; h="$3"
edge="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
"$edge" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size="$w,$h" --screenshot="$here/$name.png" "file:///$here/$name.svg" >/dev/null 2>&1
echo "rendered $here/$name.png"
