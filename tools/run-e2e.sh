#!/usr/bin/env bash
# Runs the engine end-to-end tests: real curl (or aria2c) downloads, real HLS
# segments, real files on disk. They need a local HTTP server and a file
# system grant, so this script serves fixtures, patches nsh.json for the run,
# and puts everything back.
#
#   tools/run-e2e.sh            # headless, this machine's engine
#   tools/run-e2e.sh --target macos
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=8123
OUT=/tmp/nshdl-out
FIXTURES=/tmp/nshdl-e2e

rm -rf "$OUT" && mkdir -p "$OUT"

python3 tools/e2e_server.py --port "$PORT" --dir "$FIXTURES" &
SERVER=$!
python3 tools/e2e_proxy.py --port 8127 --log /tmp/nshdl-proxy.log &
PROXY_SERVER=$!
python3 tools/e2e_torrent.py --dir "$FIXTURES/bt" --port 8130 --peer-port 6881 > /tmp/nshdl-torrent.log 2>&1 &
TORRENT_SERVER=$!
cleanup() {
  kill "$SERVER" "$PROXY_SERVER" "$TORRENT_SERVER" 2>/dev/null || true
  if [ -f nsh.json.e2e.bak ]; then mv nsh.json.e2e.bak nsh.json; fi
}
trap cleanup EXIT

for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/small.bin" -o /dev/null 2>/dev/null; then break; fi
  sleep 0.2
done

cp nsh.json nsh.json.e2e.bak
python3 tools/e2e_capabilities.py nsh.json

case "$(uname -s)" in
  Darwin) TARGET="${TARGET:-macos}" ;;
  Linux) TARGET="${TARGET:-linux}" ;;
  MINGW* | MSYS* | CYGWIN*) TARGET="${TARGET:-windows}" ;;
  *) TARGET="${TARGET:-}" ;;
esac
TARGET_ARGS=()
if [ -n "$TARGET" ]; then TARGET_ARGS=(--target "$TARGET"); fi

nsh test .e2e/engine.test.tsx "${TARGET_ARGS[@]}" "$@"
nsh test .e2e/hls.test.tsx "${TARGET_ARGS[@]}" "$@"
nsh test .e2e/proxy.test.tsx "${TARGET_ARGS[@]}" "$@"
if command -v aria2c > /dev/null 2>&1; then
  nsh test .e2e/torrent.test.tsx "${TARGET_ARGS[@]}" "$@"
else
  echo "skip 磁力测试：没有 aria2c"
fi

echo "== checksums =="
shasum -a 256 "$FIXTURES/big.bin" "$OUT/big.bin" | awk '{print $1, $2}'
cat "$FIXTURES"/hls/v0/seg*.ts > "$FIXTURES/expected-clear.ts"
cat "$FIXTURES"/hls/v0/seg*.ts | openssl enc -aes-128-cbc -d -K "$(xxd -p "$FIXTURES/hls/enc/key.bin" | tr -d '\n')" -iv 000102030405060708090a0b0c0d0e0f -out /dev/null 2>/dev/null || true
shasum -a 256 "$FIXTURES/expected-clear.ts" "$OUT/master.m3u8" "$OUT/index.m3u8" | awk '{print $1, $2}'
