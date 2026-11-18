#!/bin/bash
set -euo pipefail
[[ $(uname -s) == Darwin ]]
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
cd "$work"

# Source versions and checksums match the upstream tarballs pinned by Homebrew.
fetch() {
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    --max-time 180 --max-filesize 67108864 --output "$2" "$1"
  printf '%s  %s\n' "$3" "$2" | shasum -a 256 -c -
}
fetch https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz ffmpeg-9.0.2.tar.xz \
  8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e
fetch https://github.com/xiph/opus/releases/download/v1.6.1/opus-1.6.1.tar.gz opus-1.6.1.tar.gz \
  6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1
tar -xf opus-1.6.1.tar.gz
tar -xf ffmpeg-9.0.2.tar.xz
cores=$(sysctl -n hw.logicalcpu)
export MACOSX_DEPLOYMENT_TARGET=13.0
(
  cd opus-1.6.1
  ./configure --prefix="$work/opus" --disable-shared --enable-static --disable-doc --disable-extra-programs
  make -j "$cores"
  make install
)
(
  cd ffmpeg-9.0.2
  PKG_CONFIG_PATH= PKG_CONFIG_LIBDIR="$work/opus/lib/pkgconfig" ./configure \
    --disable-autodetect --disable-network --disable-shared --enable-static \
    --disable-ffplay --disable-ffprobe --disable-doc --disable-x86asm \
    --enable-libopus --pkg-config-flags=--static
  make -j "$cores" ffmpeg
)
cat ffmpeg-9.0.2/COPYING.LGPLv2.1 opus-1.6.1/COPYING > LICENSE.txt
printf '%s\n' 'FFmpeg 9.0.2 (LGPL) with Opus 1.6.1 (BSD-3-Clause).' \
  'Corresponding sources, build script and re-linkable object files are in the source archive distributed alongside the DMG.' > NOTICE.txt
binary="$work/ffmpeg-9.0.2/ffmpeg"
digest=$(shasum -a 256 < "$binary")
bash "$root/tools/prepare-ffmpeg-macos.sh" "$binary" "${digest%% *}" "$work/LICENSE.txt" "$work/NOTICE.txt" "$(uname -m)"

if [[ -n ${FFMPEG_SOURCE_BUNDLE:-} ]]; then
  cp "$root/tools/"{build-ffmpeg-macos,prepare-ffmpeg-macos}.sh .
  tar -czf "$FFMPEG_SOURCE_BUNDLE" ffmpeg-9.0.2 opus-1.6.1 opus LICENSE.txt NOTICE.txt \
    build-ffmpeg-macos.sh prepare-ffmpeg-macos.sh
fi
