#!/usr/bin/env bash
# Prepares the aria2c sidecar that `nsh package` ships with the app.
#
#   tools/prepare-aria2.sh                  # this machine's target
#   tools/prepare-aria2.sh macos-arm64      # one platform
#   ARIA2_BIN=/path/to/aria2c tools/prepare-aria2.sh linux-x86_64
#
# Binaries land in `vendor/aria2/current/<triple>/`, which is gitignored; the
# generated `lib/aria2-asset.ts` lists what `nsh package` should carry. aria2
# is GPLv2: the source is https://github.com/aria2/aria2, and the app ships
# COPYING/LICENSE.OpenSSL from vendor/aria2/.
set -euo pipefail
cd "$(dirname "$0")/.."

# Every temporary directory is registered here, so a failed run leaves nothing
# behind: finishing a sidecar (or leaving a prepare) calls `cleanup`.
TMP_DIR=""
cleanup() {
  if [ -n "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
    TMP_DIR=""
  fi
}
trap cleanup EXIT

new_tmp() {
  TMP_DIR=$(mktemp -d)
}

host_os() {
  case "$(uname -s)" in
    Darwin) echo macos ;;
    Linux) echo linux ;;
    MINGW* | MSYS* | CYGWIN*) echo windows ;;
    *) return 1 ;;
  esac
}

host_arch() {
  case "$(uname -m)" in
    arm64 | aarch64) echo aarch64 ;;
    x86_64 | amd64) echo x86_64 ;;
    *) return 1 ;;
  esac
}

host_triple() {
  local os arch
  os=$(host_os) || { echo "unsupported host: $(uname -s)" >&2; return 1; }
  arch=$(host_arch) || { echo "unsupported architecture: $(uname -m)" >&2; return 1; }
  case "$os" in
    macos) [ "$arch" = aarch64 ] && echo macos-arm64 || echo macos-x86_64 ;;
    linux) echo "linux-$arch" ;;
    windows) [ "$arch" = aarch64 ] && echo windows-arm64 || echo windows-x86_64 ;;
  esac
}

case "${1:-}" in
  --host-os) host_os; exit 0 ;;
  --host-triple) host_triple; exit 0 ;;
esac

# Windows runners expose Python as `python`, other hosts as `python3`.
PYTHON=$(command -v python3 || command -v python || true)
if [ -z "$PYTHON" ]; then
  echo "python3 is required to prepare the aria2c sidecar" >&2
  exit 1
fi

CURRENT="vendor/aria2/current"
mkdir -p "$CURRENT"

find_aria2c() {
  local src=${ARIA2_BIN:-}
  [ -n "$src" ] || src=$(command -v aria2c || true)
  [ -n "$src" ] || return 1
  "$PYTHON" -c 'import os, shutil, sys; print(os.path.realpath(shutil.which(sys.argv[1]) or sys.argv[1]))' "$src"
}

require_host() {
  local triple=$1 host
  host=$(host_triple) || return 1
  if [ "$triple" != "$host" ]; then
    echo "error: $triple must be prepared on a matching host (this is $host)" >&2
    return 1
  fi
}

deps_of() {
  # A dylib's first dependency line is its own install name, not a dependency.
  if [ "${1##*.}" = dylib ]; then
    otool -L "$1" | tail -n +3 | awk '{print $1}'
  else
    otool -L "$1" | tail -n +2 | awk '{print $1}'
  fi
}

# 0: the dependency is the system's or already relative to the bundle, so it is
# not copied; 1: copy it. `@rpath` cannot be resolved from a build machine, so
# it stops the run instead of shipping a sidecar that will not load.
skip_dep() {
  case "$1" in
    /System/Library/* | /usr/lib/* | @executable_path/* | @loader_path/*) return 0 ;;
    @rpath/*)
      echo "error: $2 links $1 through @rpath; use an aria2c that links absolute paths" >&2
      exit 1
      ;;
    @*) return 0 ;;
    *) return 1 ;;
  esac
}

# The staged binary must be the target's architecture: a stray ARIA2_BIN or a
# mislabelled download would otherwise ship a sidecar that cannot start.
check_arch() {
  local triple=$1 file=$2 expected arch found
  case "$triple" in
    macos-arm64 | linux-arm64) expected="arm64 aarch64" ;;
    macos-x86_64 | linux-x86_64) expected="x86_64 x86-64" ;;
    *) return 0 ;;
  esac
  found=$(lipo -archs "$file" 2>/dev/null || file -b "$file" 2>/dev/null || true)
  [ -n "$found" ] || return 0
  for arch in $expected; do
    case "$found" in
      *"$arch"*) return 0 ;;
    esac
  done
  echo "error: $(basename "$file") is not $triple (found: $found)" >&2
  return 1
}

version_gt() {
  awk -v a="$1" -v b="$2" 'BEGIN {
    na = split(a, x, "."); nb = split(b, y, ".")
    for (i = 1; i <= 3; i += 1) {
      av = (i <= na) ? x[i] + 0 : 0
      bv = (i <= nb) ? y[i] + 0 : 0
      if (av != bv) { exit !(av > bv) }
    }
    exit 1
  }'
}

# Homebrew builds for the machine that runs it: say so when the sidecar needs a
# newer macOS than the app does (nsh's runtime targets macOS 11).
check_macos_target() {
  local minos floor
  minos=$(otool -l "$1" | awk '/LC_BUILD_VERSION/ { found = 1 } found && /minos/ { print $2; exit }')
  [ -n "$minos" ] || return 0
  floor=${MIN_MACOS:-11.0}
  if version_gt "$minos" "$floor"; then
    echo "warning: the prepared aria2c needs macOS $minos, newer than the app's macOS $floor" >&2
    echo "         build it on an older macOS or with MACOSX_DEPLOYMENT_TARGET=$floor for older Macs" >&2
  fi
}

# glibc, its loader and its stubs stay the host's: a bundled libc would be loaded
# by the host's ld.so, a mix that is not supported.
is_host_libc() {
  case "$(basename "$1")" in
    libc.so* | libm.so* | libpthread.so* | libdl.so* | librt.so* | libresolv.so* | libnss_* | ld-linux* | ld64.so*) return 0 ;;
    *) return 1 ;;
  esac
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$1" | awk '{print $NF}'
  else
    return 1
  fi
}

stage_binary() {
  local src=$1 tmp=$2
  mkdir -p "$tmp/lib"
  cp -L "$src" "$tmp/aria2c"
  chmod u+w "$tmp/aria2c"
}

finish_archive() {
  local triple=$1 tmp=$2
  rm -rf "${CURRENT:?}/${triple:?}"
  mkdir -p "$CURRENT/$triple"
  tar -czf "$CURRENT/$triple/aria2.tar.gz" -C "$tmp" .
  echo "✓ $triple aria2c ($(du -h "$CURRENT/$triple/aria2.tar.gz" | cut -f1) archive)"
  cleanup
}

prepare_macos() {
  local triple=$1
  require_host "$triple" || return 1
  local src
  src=$(find_aria2c) || true
  if [ -z "$src" ] && command -v brew >/dev/null 2>&1; then
    echo "==> installing aria2 with Homebrew"
    brew install aria2 >/dev/null
    src=$(find_aria2c) || true
  fi
  if [ -z "$src" ]; then
    echo "aria2c not found; install it (brew install aria2) or set ARIA2_BIN" >&2
    return 1
  fi
  local tmp
  new_tmp
  tmp=$TMP_DIR
  stage_binary "$src" "$tmp"
  check_arch "$triple" "$tmp/aria2c"

  collect() {
    local file=$1 dep base
    deps_of "$file" | while read -r dep; do
      if skip_dep "$dep" "$file"; then continue; fi
      base=$(basename "$dep")
      if [ ! -f "$tmp/lib/$base" ]; then
        cp -L "$dep" "$tmp/lib/$base"
        chmod u+w "$tmp/lib/$base"
        collect "$tmp/lib/$base"
      fi
    done
  }
  collect "$tmp/aria2c"

  deps_of "$tmp/aria2c" | while read -r dep; do
    if skip_dep "$dep" "$tmp/aria2c"; then continue; fi
    # Rewriting install names invalidates the signature; re-signed below.
    install_name_tool -change "$dep" "@executable_path/lib/$(basename "$dep")" "$tmp/aria2c" 2>/dev/null
  done
  for lib in "$tmp"/lib/*.dylib; do
    [ -f "$lib" ] || continue
    install_name_tool -id "@loader_path/$(basename "$lib")" "$lib" 2>/dev/null
    deps_of "$lib" | while read -r dep; do
      if skip_dep "$dep" "$lib"; then continue; fi
      install_name_tool -change "$dep" "@loader_path/$(basename "$dep")" "$lib" 2>/dev/null
    done
  done

  # install_name_tool invalidates the ad-hoc signature; re-sign everything.
  codesign --force --sign - "$tmp/aria2c" >/dev/null 2>&1 || true
  for lib in "$tmp"/lib/*.dylib; do
    [ -f "$lib" ] || continue
    codesign --force --sign - "$lib" >/dev/null 2>&1 || true
  done

  "$tmp/aria2c" --version >/dev/null
  check_macos_target "$tmp/aria2c"
  finish_archive "$triple" "$tmp"
}

prepare_linux() {
  local triple=$1
  require_host "$triple" || return 1
  local src
  src=$(find_aria2c) || true
  if [ -z "$src" ]; then
    echo "aria2c not found; install it (apt install aria2) or set ARIA2_BIN" >&2
    return 1
  fi
  local tmp
  new_tmp
  tmp=$TMP_DIR
  stage_binary "$src" "$tmp"
  check_arch "$triple" "$tmp/aria2c"
  if ldd "$src" 2>/dev/null | grep -q 'not a dynamic executable\|statically linked'; then
    echo "==> using the static aria2c at $src"
  else
    if ! command -v patchelf >/dev/null 2>&1; then
      echo "patchelf is required to make a relocatable Linux aria2c; install it or use a static ARIA2_BIN" >&2
      return 1
    fi
    ldd "$src" | awk '/=> \// {print $3}' | while read -r lib; do
      if [ -f "$lib" ] && ! is_host_libc "$lib"; then
        cp -L "$lib" "$tmp/lib/$(basename "$lib")"
      fi
    done
    echo "==> bundling $(ls "$tmp/lib" | wc -l | tr -d ' ') libraries; glibc stays the host's, so this aria2c needs glibc ≥ this host's"
    patchelf --set-rpath "\$ORIGIN/lib" "$tmp/aria2c"
    # Shared libraries also resolve each other from the same directory.
    for lib in "$tmp"/lib/*.so*; do
      if [ -f "$lib" ]; then patchelf --set-rpath "\$ORIGIN" "$lib"; fi
    done
  fi
  "$tmp/aria2c" --version >/dev/null 2>&1 || echo "warning: the prepared Linux aria2c did not run here" >&2
  finish_archive "$triple" "$tmp"
}

prepare_windows() {
  local triple=$1
  if [ "$triple" != "windows-x86_64" ]; then
    echo "error: only windows-x86_64 has an official aria2c build (asked for $triple)" >&2
    return 1
  fi
  # The one sidecar fetched from the network: the release stays pinned, and so
  # does its SHA-256 (of aria2-1.37.0-win-64bit-build1.zip).
  local url=https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip
  local sha256=67d015301eef0b612191212d564c5bb0a14b5b9c4796b76454276a4d28d9b288
  local tmp
  new_tmp
  tmp=$TMP_DIR
  echo "==> downloading $url"
  curl -fsSL --proto '=https' --retry 3 "$url" -o "$tmp/aria2.zip"
  local actual
  actual=$(sha256_of "$tmp/aria2.zip") || {
    echo "error: checking aria2.zip needs sha256sum, shasum or openssl" >&2
    return 1
  }
  if [ "$actual" != "$sha256" ]; then
    echo "error: aria2.zip does not match the pinned checksum (expected $sha256, got $actual)" >&2
    return 1
  fi
  rm -rf "${CURRENT:?}/${triple:?}"
  mkdir -p "$CURRENT/$triple"
  # Python is already required for the asset list; using it here avoids a
  # dependency on `unzip` in Git Bash on Windows.
  "$PYTHON" - "$tmp/aria2.zip" "$CURRENT/$triple/aria2c.exe" <<'PY'
import sys
import zipfile

archive, target = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(archive) as zf:
    for info in zf.infolist():
        if info.filename.endswith("/aria2c.exe") or info.filename == "aria2c.exe":
            with zf.open(info) as src, open(target, "wb") as dst:
                dst.write(src.read())
            break
    else:
        raise SystemExit("aria2 zip is missing aria2c.exe")
PY
  echo "✓ $triple aria2c.exe ($(du -h "$CURRENT/$triple/aria2c.exe" | cut -f1))"
  cleanup
}

# ARIA2_LIST_ONLY regenerates the asset list without preparing anything; the
# packaging wrapper uses it to start each package from a clean list.
if [ "${ARIA2_LIST_ONLY:-0}" != 1 ]; then
  target=${1:-$(host_triple)}
  case "$target" in
    macos-*) prepare_macos "$target" ;;
    linux-*) prepare_linux "$target" ;;
    windows-*) prepare_windows "$target" ;;
    *) echo "unknown target: $target" >&2; exit 1 ;;
  esac
fi

# List every prepared sidecar for the app. `nsh package` puts imported files
# under `assets/`, and `lib/aria2.ts` finds them relative to its own module.
"$PYTHON" - "$CURRENT" <<'PY'
import os
import sys

root = sys.argv[1]
only = os.environ.get("ARIA2_ONLY", "")
entries = []
imports = []
for triple in sorted(os.listdir(root)):
    platform = triple.split("-", 1)[0]
    if platform not in {"macos", "linux", "windows"}:
        continue
    if only and triple != only:
        continue
    directory = f"{root}/{triple}"
    if not os.path.isdir(directory):
        continue
    arch = "aarch64" if triple.endswith("arm64") else "x86_64"
    for filename, name, archive in (
        ("aria2.tar.gz", "aria2c", True),
        ("aria2c.exe", "aria2c.exe", False),
    ):
        path = f"{directory}/{filename}"
        if not os.path.exists(path):
            continue
        imports.append(f'import {platform}_{arch} from "../{path}?url";')
        entries.append(
            f'  {{ url: {platform}_{arch}, platform: "{platform}", arch: "{arch}", name: "{name}", archive: {str(archive).lower()} }},'
        )
        break

def license_binding(path, name):
    if not os.path.exists(path):
        return "", "null"
    return f'import {name} from "../{path}?url";\n', name

license_import, license_export = license_binding("vendor/aria2/COPYING", "license")
ssl_import, ssl_export = license_binding("vendor/aria2/LICENSE.OpenSSL", "sslLicense")

header_imports = license_import + ssl_import
imports_block = "\n".join(imports)
if imports_block:
    imports_block += "\n\n"
elif header_imports:
    imports_block = "\n"
asset_array = "[\n" + "\n".join(entries) + "\n]" if entries else "[]"

body = (
    "// Generated by tools/prepare-aria2.sh: do not edit.\n"
    "// The empty list in the committed stub keeps a fresh clone buildable.\n"
    + header_imports
    + imports_block
    + "export interface BundledAria2Asset {\n"
    '  url: string;\n'
    '  platform: "macos" | "linux" | "windows";\n'
    '  arch: "aarch64" | "x86_64";\n'
    "  name: string;\n"
    "  archive: boolean;\n"
    "}\n\n"
    "export const bundledAria2Assets: BundledAria2Asset[] = "
    + asset_array
    + ";\n\n"
    f"export const bundledAria2License: string | null = {license_export};\n"
    f"export const bundledAria2SslLicense: string | null = {ssl_export};\n"
)
# Windows decodes Python's stdout as cp1252, so keep this line ASCII.
with open("lib/aria2-asset.ts", "w", encoding="utf-8") as out:
    out.write(body)
print("wrote lib/aria2-asset.ts")
PY
