#!/bin/sh
# Render a mock-up page to PNG: shot.sh <name> <desktop|mobile> [height]
C=$(command -v google-chrome || command -v chromium)
if [ "$2" = desktop ]; then W=1440; H=${3:-900}; F=2; else W=390; H=${3:-844}; F=3; fi
"$C" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files --virtual-time-budget=4000 \
  --window-size=$W,$H --force-device-scale-factor=$F --screenshot="$PWD/$1.png" "file://$PWD/$1.html" 2>/dev/null
