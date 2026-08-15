#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${1:-app-report}"
PID="$(pm2 pid "$APP_NAME" | tr -d '[:space:]')"
[[ "$PID" =~ ^[1-9][0-9]*$ ]] || { echo "RSS_GUARD_PID_UNAVAILABLE app=$APP_NAME" >&2; exit 2; }

STATUS="/proc/$PID/status"
[[ -r "$STATUS" ]] || { echo "RSS_GUARD_PROC_UNAVAILABLE pid=$PID" >&2; exit 2; }
TRUE_KIB="$(awk '$1 == "VmRSS:" { print $2; exit }' "$STATUS")"
[[ "$TRUE_KIB" =~ ^[0-9]+$ ]] || { echo "RSS_GUARD_RSS_UNAVAILABLE pid=$PID" >&2; exit 2; }

PM2_BYTES="$(pm2 jlist | jq -r --arg app "$APP_NAME" '.[] | select(.name == $app) | .monit.memory' | head -n1)"
[[ "$PM2_BYTES" =~ ^[0-9]+$ ]] || PM2_BYTES=0
TRUE_BYTES=$((TRUE_KIB * 1024))

printf 'RSS_GUARD app=%s pid=%s true_rss_bytes=%s pm2_rss_bytes=%s source=/proc/%s/status\n' \
  "$APP_NAME" "$PID" "$TRUE_BYTES" "$PM2_BYTES" "$PID"

