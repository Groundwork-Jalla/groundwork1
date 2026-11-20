#!/bin/sh
# Render a mock-up HTML page to high-DPI PNG:
#   ./shot.sh <basename> <desktop|mobile> [height]
set -e
C=$(command -v google-chrome || command -v chromium || ls -1 /home/favour-nwachukwu/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null | tail -n 1)
if [ -z "$C" ]; then
  echo "No Chromium binary found" >&2
  exit 1
fi
if [ "$2" = desktop ]; then
  W=1440; H=${3:-900}; F=2
else
  W=390; H=${3:-844}; F=3
fi
mkdir -p /tmp/gw-chrome
HOME=/tmp "$C" \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --disable-crash-reporter \
  --user-data-dir=/tmp/gw-chrome \
  --hide-scrollbars \
  --allow-file-access-from-files \
  --virtual-time-budget=2000 \
  --window-size="$W,$H" \
  --force-device-scale-factor="$F" \
  --screenshot="$PWD/$1.png" \
  "file://$PWD/$1.html" 2>/dev/null
echo "Rendered $PWD/$1.png (${W}x${H} @${F}x)"
