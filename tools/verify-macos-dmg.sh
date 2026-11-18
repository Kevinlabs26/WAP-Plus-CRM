#!/bin/bash
set -euo pipefail

: "${RUNNER_TEMP:?}"
: "${ARCH:?}"
version=$(node -p "require('./desktop/src-tauri/tauri.conf.json').version")
profile=debug
if [[ ${PUBLISH:-false} == true ]]; then profile=release; fi
shopt -s nullglob
dmgs=(desktop/src-tauri/target/"$profile"/bundle/dmg/*.dmg)
[[ ${#dmgs[@]} == 1 ]]
dmg=${dmgs[0]}
hdiutil verify "$dmg"
mount=$(mktemp -d)
trap 'hdiutil detach "$mount" >/dev/null 2>&1 || true; rmdir "$mount" || true' EXIT
hdiutil attach -quiet -readonly -nobrowse -mountpoint "$mount" "$dmg"
app="$mount/WAP Plus CRM.app"
executables="$app/Contents/MacOS"
for name in wap-plus-crm wap-plus-baileys ffmpeg; do
  test -x "$executables/$name"
  test "$(lipo -archs "$executables/$name")" = "$ARCH"
done
"$executables/ffmpeg" -v error -f lavfi -i sine=duration=0.1 -c:a libopus "$RUNNER_TEMP/bundled-voice.ogg"
test -s "$RUNNER_TEMP/bundled-voice.ogg"
if [[ $profile == release ]]; then
  codesign --verify --deep --strict "$app"
  xcrun stapler validate "$app"
  spctl --assess --type execute "$app"
fi
mkdir -p "$RUNNER_TEMP/macos-release"
cp "$dmg" "$RUNNER_TEMP/macos-release/WAP-Plus-CRM-$version-macOS-$ARCH.dmg"
cp "$RUNNER_TEMP/ffmpeg-source-$ARCH.tar.gz" "$RUNNER_TEMP/macos-release/"
