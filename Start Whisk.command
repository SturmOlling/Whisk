#!/bin/bash
set -euo pipefail
umask 077

WHISK_PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$WHISK_PROJECT_DIR"

for WHISK_ENV in \
  "$HOME/Library/Application Support/Whisk/vite-plus/env" \
  "$HOME/.vite-plus/env"; do
  if [[ -f "$WHISK_ENV" ]]; then
    source "$WHISK_ENV"
    break
  fi
done

if ! command -v vp >/dev/null 2>&1; then
  echo "Whisk needs Vite+. Install it from https://viteplus.dev/guide/, then try again."
  exit 1
fi

mkdir -p "$WHISK_PROJECT_DIR/.t3"
WHISK_LOCK="$WHISK_PROJECT_DIR/.t3/launcher.lock"
WHISK_LOG="$WHISK_PROJECT_DIR/.t3/launcher.log"

if ! mkdir "$WHISK_LOCK" 2>/dev/null; then
  if [[ ! -f "$WHISK_LOCK/pid" ]]; then
    echo "Whisk is already starting. Check its other Terminal window."
    exit 0
  fi
  WHISK_PID="$(cat "$WHISK_LOCK/pid")"
  if [[ "$WHISK_PID" =~ ^[0-9]+$ ]] && kill -0 "$WHISK_PID" 2>/dev/null; then
    echo "Whisk is already running. Opening it in your browser."
    if [[ -f "$WHISK_LOG" ]]; then
      WHISK_URL="$(awk '/pairingUrl:/ { for (i = 1; i <= NF; i++) if ($i == "pairingUrl:") { url = $(i + 1); sub(/\/pair.*/, "/write", url) } } END { print url }' "$WHISK_LOG")"
      case "$WHISK_URL" in
        http://localhost:*\/write|http://127.0.0.1:*\/write) /usr/bin/open "$WHISK_URL" ;;
        *) echo "The browser will open once startup finishes." ;;
      esac
    fi
    exit 0
  fi
  rm "$WHISK_LOCK/pid"
  rmdir "$WHISK_LOCK"
  mkdir "$WHISK_LOCK"
fi

printf '%s\n' "$$" > "$WHISK_LOCK/pid"
whisk_cleanup() {
  if [[ -f "$WHISK_LOCK/pid" ]] && [[ "$(cat "$WHISK_LOCK/pid")" == "$$" ]]; then
    rm "$WHISK_LOCK/pid"
    rmdir "$WHISK_LOCK"
  fi
}
trap whisk_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "Starting Whisk… Your browser will open when it is ready."
echo "Keep this window open while using Whisk. Press Control+C to stop it."
echo

if [[ ! -d node_modules ]]; then
  vp install
fi

vp run dev --home-dir "$WHISK_PROJECT_DIR/.t3" --no-seed --browser "$@" 2>&1 | tee "$WHISK_LOG"
