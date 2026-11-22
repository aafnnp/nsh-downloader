#!/usr/bin/env bash
# Signs a macOS .app with a stable identity, so macOS stops asking for the
# Downloads folder after every build.
#
# `nsh package` signs the app ad hoc, and an ad-hoc signature's designated
# requirement is the build's own code hash: each rebuild looks like a different
# app to the system's privacy controls ("Failed to match existing code
# requirement"), so the "wants to access the Downloads folder" prompt returns.
# A certificate makes the requirement
# `identifier "dev.nsh.downloader" and certificate leaf = H"…"`, which survives
# rebuilds. `nsh run` needs none of this: the development host is its own app.
#
#   tools/sign-macos.sh                      # .nsh/out/Downloader.app
#   tools/sign-macos.sh dist/Downloader.app
#   DOWNLOADER_SIGN_IDENTITY="Developer ID Application: …" tools/sign-macos.sh
#
# Without DOWNLOADER_SIGN_IDENTITY a self-signed identity is created once, in a
# keychain of its own under ~/.nsh-signing (never the login keychain).
set -euo pipefail
cd "$(dirname "$0")/.."

app=${1:-.nsh/out/Downloader.app}
identity=${DOWNLOADER_SIGN_IDENTITY:-Downloader Local Signing}
keychain=${DOWNLOADER_SIGNING_KEYCHAIN:-$HOME/.nsh-signing/downloader-signing.keychain-db}
password=${DOWNLOADER_SIGNING_PASSWORD:-downloader}

[ -d "$app" ] || {
  echo "sign-macos: no app bundle at $app" >&2
  exit 2
}

requirement() {
  codesign -d -r- "$app" 2>&1 | sed -n 's/^designated => //p'
}

sign() {
  codesign --force --deep "$@" "$app"
  echo "signed $app"
  echo "  $(requirement)"
}

# A real certificate in a trusted keychain (a Developer ID, an Apple
# Development certificate) is used as it is.
if [ -n "${DOWNLOADER_SIGN_IDENTITY:-}" ]; then
  if security find-identity -v -p codesigning 2>/dev/null | grep -qF "$identity"; then
    sign --sign "$identity"
    exit 0
  fi
  if [ ! -f "$keychain" ]; then
    echo "sign-macos: no identity \"$identity\" in the keychains" >&2
    exit 1
  fi
fi

# The certificate's key and chain, and nothing interactive: `security import`
# needs the p12 exported with the legacy (RC2/3DES) encoding to read it.
create_identity() {
  local work
  work=$(mktemp -d)
  trap 'rm -rf "$work"' RETURN
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout "$work/key.pem" -out "$work/cert.pem" \
    -subj "/CN=$identity" \
    -addext "keyUsage=critical,digitalSignature" \
    -addext "extendedKeyUsage=critical,codeSigning" >/dev/null 2>&1
  openssl pkcs12 -export -inkey "$work/key.pem" -in "$work/cert.pem" \
    -name "$identity" -out "$work/identity.p12" -passout "pass:$password" \
    -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1 >/dev/null 2>&1
  if [ ! -f "$keychain" ]; then
    mkdir -p "$(dirname "$keychain")"
    security create-keychain -p "$password" "$keychain"
    security set-keychain-settings "$keychain"
  fi
  security unlock-keychain -p "$password" "$keychain" >/dev/null 2>&1
  # `-A` lets codesign use the key without asking; the keychain holds this one
  # identity and nothing else.
  security import "$work/identity.p12" -k "$keychain" -P "$password" -T /usr/bin/codesign -A >/dev/null
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain" >/dev/null 2>&1
  echo "created the signing identity \"$identity\" in $keychain" >&2
}

if [ ! -f "$keychain" ] || ! security find-identity -p codesigning "$keychain" 2>/dev/null | grep -qF "$identity"; then
  create_identity
fi
security unlock-keychain -p "$password" "$keychain" >/dev/null 2>&1
sign --sign "$identity" --keychain "$keychain"
