#!/bin/bash
set -euo pipefail

if [[ $(uname -s) != Darwin || $# != 5 ]]; then
  echo "Usage on macOS: bash tools/prepare-ffmpeg-macos.sh <ffmpeg> <sha256> <license> <notice> <arm64|x86_64>" >&2
  exit 1
fi
case "$5" in
  arm64) target=aarch64-apple-darwin ;;
  x86_64) target=x86_64-apple-darwin ;;
  *) exit 1 ;;
esac
if [[ ! "$2" =~ ^[a-f0-9]{64}$ || ! -s "$3" || ! -s "$4" ]]; then
  echo "A trusted SHA-256, license and corresponding source notice are required." >&2
  exit 1
fi
actual=$(/usr/bin/shasum -a 256 < "$1")
[[ ${actual%% *} == "$2" ]] || { echo "FFmpeg SHA-256 mismatch." >&2; exit 1; }
[[ $(/usr/bin/lipo -archs "$1") == "$5" ]] || { echo "FFmpeg architecture mismatch." >&2; exit 1; }
if ! /usr/bin/otool -L "$1" | /usr/bin/awk 'NR > 1 && $1 !~ /^\/(usr\/lib|System\/Library)\// { bad=1 } END { exit bad }'; then
  echo "FFmpeg depends on external libraries and cannot be shipped as a standalone sidecar." >&2
  exit 1
fi
if [[ $(/usr/bin/uname -m) == "$5" ]]; then
  encoders=$("$1" -hide_banner -encoders 2>&1)
  if ! /usr/bin/grep -Eq '[[:space:]]libopus[[:space:]]' <<< "$encoders"; then
    echo "FFmpeg lacks the libopus encoder required for WhatsApp voice notes." >&2
    exit 1
  fi
else
  echo "Run FFmpeg preparation on the matching native Mac architecture." >&2
  exit 1
fi
root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/desktop/src-tauri/binaries"
mkdir -p "$out"
install -m 755 -- "$1" "$out/ffmpeg-$target"
install -m 644 -- "$3" "$out/ffmpeg-LICENSE.txt"
install -m 644 -- "$4" "$out/ffmpeg-NOTICE.txt"
