#!/usr/bin/env bash
# Runs the server and the app for development. Ctrl-C stops both.
# The app is on http://localhost:5173 and proxies /api to the server on PORT (7478).
set -eu
cd "$(dirname "$0")/.."

[ -d node_modules ] || npm ci

server= app=
stop() {
  trap - EXIT INT TERM
  kill $server $app 2>/dev/null || true
  wait 2>/dev/null || true
}
trap stop EXIT INT TERM

npm run dev -w server &
server=$!
npm run dev -w app &
app=$!

# Ends as soon as either one does, so a crash doesn't leave the other one running.
while kill -0 "$server" 2>/dev/null && kill -0 "$app" 2>/dev/null; do
  sleep 1
done
