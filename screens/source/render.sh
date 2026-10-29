#!/usr/bin/env bash
# Re-render every mockup in this folder to a PNG one level up.
# Needs Google Chrome and a network connection (the pages pull their fonts
# from Google Fonts; without one they fall back to the system sans).
set -euo pipefail
cd "$(dirname "$0")"
CHROME=${CHROME:-google-chrome}
shopt -s nullglob
for f in *-pc.html;     do "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
                             --force-device-scale-factor=2 --window-size=1440,900 \
                             --screenshot="../${f%.html}.png" "$f" >/dev/null 2>&1 && echo "  ${f%.html}.png"; done
for f in *-mobile.html; do "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
                             --force-device-scale-factor=3 --window-size=390,844 \
                             --screenshot="../${f%.html}.png" "$f" >/dev/null 2>&1 && echo "  ${f%.html}.png"; done
