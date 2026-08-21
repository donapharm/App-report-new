#!/usr/bin/env bash
# Prepare immutable release runtime bindings without copying mutable data.

set -Eeuo pipefail

RELEASE_ROOT="${RELEASE_ROOT:?Thiếu RELEASE_ROOT}"
APP_DATA_DIR="${APP_DATA_DIR:?Thiếu APP_DATA_DIR}"
APP_ENV_FILE="${APP_ENV_FILE:?Thiếu APP_ENV_FILE}"
AUTH_DATA_DIR="${AUTH_DATA_DIR:?Thiếu AUTH_DATA_DIR}"

fail() { echo "❌ $*" >&2; exit 1; }

[ -d "$RELEASE_ROOT/server" ] || fail "release thiếu server/"
[ -d "$APP_DATA_DIR" ] || fail "APP_DATA_DIR không tồn tại"
[ -r "$APP_DATA_DIR/users.json" ] || fail "APP_DATA_DIR thiếu users.json đọc được"
[ -f "$APP_ENV_FILE" ] && [ -r "$APP_ENV_FILE" ] || fail "APP_ENV_FILE không đọc được"
[ -d "$AUTH_DATA_DIR" ] && [ -r "$AUTH_DATA_DIR" ] || fail "AUTH_DATA_DIR không đọc được"

bind_link() {
  local link="$1" target="$2"
  if [ -L "$link" ]; then
    [ "$(readlink -f "$link")" = "$(readlink -f "$target")" ] || fail "$link đang trỏ sai"
    return
  fi
  [ ! -e "$link" ] || fail "$link đã tồn tại nhưng không phải symlink"
  ln -s "$target" "$link"
}

bind_link "$RELEASE_ROOT/.env" "$APP_ENV_FILE"
bind_link "$RELEASE_ROOT/server/data" "$APP_DATA_DIR"

echo "✅ Runtime bindings đã chuẩn bị: .env, server/data; AUTH_DATA_DIR đọc được"
