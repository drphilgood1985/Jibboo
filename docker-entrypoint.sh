#!/bin/sh
set -eu

YTDLP_AUTO_UPDATE="${YTDLP_AUTO_UPDATE:-1}"
YTDLP_PATH="${YTDLP_PATH:-/usr/local/bin/yt-dlp}"
YTDLP_UPDATE_URL="${YTDLP_UPDATE_URL:-https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux}"

case "$YTDLP_AUTO_UPDATE" in
  0 | false | False | FALSE | no | No | NO)
    echo "yt-dlp auto-update disabled."
    exec "$@"
    ;;
esac

current_version="$("$YTDLP_PATH" --version 2>/dev/null || true)"
tmp_file="$(mktemp)"

cleanup() {
  rm -f "$tmp_file"
}
trap cleanup EXIT INT TERM

if curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 10 "$YTDLP_UPDATE_URL" -o "$tmp_file"; then
  chmod +x "$tmp_file"
  next_version="$("$tmp_file" --version 2>/dev/null || true)"

  if [ -z "$next_version" ]; then
    echo "Downloaded yt-dlp binary did not run; keeping existing yt-dlp." >&2
  elif [ "$next_version" = "$current_version" ]; then
    echo "yt-dlp already current (${current_version:-unknown})."
  elif mv "$tmp_file" "$YTDLP_PATH"; then
    echo "Updated yt-dlp from ${current_version:-missing} to $next_version."
  else
    echo "Failed to replace yt-dlp at $YTDLP_PATH; keeping existing yt-dlp." >&2
  fi
else
  echo "Failed to update yt-dlp at startup; continuing with existing version (${current_version:-unknown})." >&2
fi

exec "$@"
