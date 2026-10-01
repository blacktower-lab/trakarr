#!/usr/bin/env bash
# Builds the release tarball install.sh downloads: the server with
# its production dependencies and the built app, in the layout the server
# expects, under one top-level folder. The dependencies come from the
# workspace's lockfile and sit in its node_modules, at the top, where the
# server finds them.
# Usage: scripts/package.sh <version>   writes trakarr-<version>.tar.gz in the
# repository's root.
set -eu
cd "$(dirname "$0")/.."

version="${1:?usage: scripts/package.sh <version>}"
stage=.package/trakarr

[ -d node_modules ] || npm ci
npm run build -w app

rm -rf .package
mkdir -p "$stage/server" "$stage/app"
cp package.json package-lock.json "$stage/"
cp -R server/src server/package.json "$stage/server/"
# npm checks every workspace against the lockfile, so the app's manifest goes
# too, though only the server's dependencies are installed.
cp -R app/dist app/package.json "$stage/app/"
npm --prefix "$stage" ci --omit=dev -w server

# Without it, macOS's tar adds a ._ file for every file with extended attributes.
COPYFILE_DISABLE=1 tar -czf "trakarr-$version.tar.gz" -C .package trakarr
rm -rf .package
echo "trakarr-$version.tar.gz"
