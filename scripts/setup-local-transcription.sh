#!/usr/bin/env bash
set -euo pipefail

[[ "$(uname -s)" == Darwin ]] || { echo "This setup helper requires macOS." >&2; exit 1; }
for tool in ffmpeg whisper-cli; do
  if ! command -v "$tool" >/dev/null; then
    echo "Install ffmpeg and whisper.cpp with Homebrew first: brew install ffmpeg whisper.cpp" >&2
    exit 1
  fi
done

MODEL_DIR="$HOME/Library/Application Support/X to Obsidian/Models"
MODEL="$MODEL_DIR/ggml-small-q5_1.bin"
SHA="ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb"
mkdir -p "$MODEL_DIR"
if [[ -e "$MODEL" ]]; then
  printf '%s  %s\n' "$SHA" "$MODEL" | shasum -a 256 -c -
  exit 0
fi
TEMP="$(mktemp "$MODEL_DIR/.model.XXXXXX")"
trap 'rm -f "$TEMP"' EXIT
curl --fail --location --silent --show-error --retry 2 --max-time 300 \
  --proto '=https' --proto-redir '=https' --output "$TEMP" \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin?download=true&request=$(date +%s)"
printf '%s  %s\n' "$SHA" "$TEMP" | shasum -a 256 -c -
mv -n "$TEMP" "$MODEL"
printf 'Installed local Whisper model: %s\n' "$MODEL"
