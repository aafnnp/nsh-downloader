#!/usr/bin/env bash
# Packages the app after preparing the aria2c sidecar for the target.
#
#   tools/package.sh macos --out dist
#   tools/package.sh windows --app-version 1.1.0
#   SKIP_ARIA2=1 tools/package.sh linux --out dist
#
# `ARIA2_TRIPLE` overrides the detected target (for example macos-x86_64 when
# cross-packaging, as long as that sidecar was prepared earlier).
set -euo pipefail
cd "$(dirname "$0")/.."

usage() {
  cat >&2 <<'EOF'
usage: tools/package.sh <macos|windows|linux|web> [nsh package options...]

Prepares the aria2c sidecar for the target (unless SKIP_ARIA2=1) and then runs
`nsh package App.tsx --target <target>` with the remaining arguments.
EOF
  exit 2
}

target=${1:-}
case "$target" in
  macos | windows | linux | web) ;;
  *) usage ;;
esac
shift

prepare_sidecar() {
  local triple=${ARIA2_TRIPLE:-} host=""
  if [ -z "$triple" ]; then
    case "$target" in
      macos | linux)
        host=$(bash tools/prepare-aria2.sh --host-os) || host=""
        if [ "$host" != "$target" ]; then
          echo "warning: $target packages need a matching host to prepare aria2c; packaging without it" >&2
          return 0
        fi
        triple=$(bash tools/prepare-aria2.sh --host-triple) || return 1
        ;;
      windows)
        # The official build is self-contained and can be fetched anywhere;
        # Windows on Arm runs it through x64 emulation.
        triple=windows-x86_64
        case "$(uname -m)" in
          arm64 | aarch64) triple=windows-arm64 ;;
        esac
        ;;
    esac
  fi
  [ -n "$triple" ] || return 1
  # Only import this package's sidecar; other prepared triples stay out.
  ARIA2_ONLY="$triple" bash tools/prepare-aria2.sh "$triple"
}

reset_assets() {
  ARIA2_ONLY=__none__ ARIA2_LIST_ONLY=1 bash tools/prepare-aria2.sh >/dev/null 2>&1 || true
}

# `lib/extension-asset.ts` names the built archive while packaging; the stub is
# what a checkout commits.
reset_extension() {
  bash tools/build-extension.sh --reset >/dev/null 2>&1 || true
}

# Start from an empty list so a package never absorbs a sidecar prepared for
# another target (or a previous web/skip build). The trap restores the stub
# afterwards: the generated file points at gitignored binaries and must not be
# committed.
reset_assets
reset_extension
trap 'reset_assets; reset_extension' EXIT
if [ "${SKIP_ARIA2:-0}" != 1 ] && [ "$target" != web ]; then
  prepare_sidecar
fi

# nsh package carries the extension archive inside the app; the same file also
# lands beside the package so the release has one download for every platform.
out_dir=.nsh/out
previous=
for arg in "$@"; do
  case "$previous" in
    --out | -o) out_dir=$arg ;;
  esac
  case "$arg" in
    --out=*) out_dir=${arg#--out=} ;;
  esac
  previous=$arg
done
[ -n "$out_dir" ] || out_dir=.nsh/out

bash tools/build-extension.sh
nsh package App.tsx --target "$target" "$@"
mkdir -p "$out_dir"
cp vendor/extension/Downloader-extension.zip "$out_dir/"
