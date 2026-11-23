#!/usr/bin/env bash
set -euo pipefail

version=$(jq -er .version desktop/src-tauri/tauri.conf.json)
tag="v$version"
[[ "$GITHUB_REF" == "refs/tags/$tag" ]]
[[ $(gh api "repos/$GITHUB_REPOSITORY/commits/$tag" --jq .sha) == "$GITHUB_SHA" ]]

assets=release-assets
manifest=macos-latest.json
feed=latest-unsigned.json
mac_notes='The macOS DMGs are ad-hoc signed and unnotarized. Choose arm64 for Apple Silicon or x86_64 for Intel.'
for arch in arm64 x86_64; do
  dmg="$assets/WAP-Plus-CRM-$version-macOS-$arch.dmg"
  test -s "$dmg"
  test -s "$assets/ffmpeg-source-$arch.tar.gz"
  if [[ "$NOTARIZE" != true ]]; then
    mv "$dmg" "${dmg%.dmg}-unsigned.dmg"
  fi
done
if [[ "$NOTARIZE" == true ]]; then
  feed=latest-signed.json
  mac_notes='The macOS DMGs are signed and notarized. Choose arm64 for Apple Silicon or x86_64 for Intel.'
fi
node .github/scripts/macos-update-manifest.mjs "$version" "$tag" "$assets" > "$assets/$manifest"

release=$(gh release view "$tag" --json isDraft,assets)
jq -e --arg version "$version" '
  [.assets[] | select(.size > 0) | .name] as $names |
  ($names | index("latest.json")) != null and
  any($names[]; contains($version) and endswith("x64-setup.exe"))
' <<< "$release" > /dev/null

if [[ $(jq -r .isDraft <<< "$release") == true ]]; then
  gh release upload "$tag" "$assets"/* --clobber
fi
release=$(gh release view "$tag" --json isDraft,assets,body)
for asset in "$assets"/*; do
  jq -e --arg name "${asset##*/}" 'any(.assets[]; .name == $name and .size > 0)' <<< "$release" > /dev/null
done
if [[ $(jq -r .isDraft <<< "$release") == true ]]; then
  { printf '%s\n\n' "$mac_notes"; jq -r .body <<< "$release"; } > "$RUNNER_TEMP/desktop-release-notes.md"
  gh release edit "$tag" --draft=false --latest --notes-file "$RUNNER_TEMP/desktop-release-notes.md"
fi

# Older macOS installs read this branch directly.
feed_dir=$(mktemp -d)
trap 'rm -rf -- "$feed_dir"' EXIT
gh auth setup-git
git -C "$feed_dir" init -b macos-updates
git -C "$feed_dir" remote add origin "https://github.com/$GITHUB_REPOSITORY.git"
if git -C "$feed_dir" ls-remote --exit-code --heads origin refs/heads/macos-updates; then
  git -C "$feed_dir" fetch --depth=1 origin refs/heads/macos-updates
  git -C "$feed_dir" switch --detach FETCH_HEAD
else
  [[ $? == 2 ]]
fi
gh release download "$tag" --pattern "$manifest" --dir "$feed_dir"
jq -e --arg version "$version" --arg tag "$tag" '
  .version == $version and
  (.platforms | length == 2 and all(.[]; .url | contains("/releases/download/" + $tag + "/")))
' "$feed_dir/$manifest" > /dev/null
if [[ -s "$feed_dir/$feed" ]]; then
  previous=$(jq -er .version "$feed_dir/$feed")
  newest=$(printf '%s\n' "$previous" "$version" | sort -V | tail -1)
  [[ "$version" == "$newest" ]] || exit 0
fi
mv "$feed_dir/$manifest" "$feed_dir/$feed"
git -C "$feed_dir" add -- "$feed"
if git -C "$feed_dir" diff --cached --quiet; then exit 0; fi
git -C "$feed_dir" -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' commit -m "Update $feed to $version"
git -C "$feed_dir" push origin HEAD:refs/heads/macos-updates
