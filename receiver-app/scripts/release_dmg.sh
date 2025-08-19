#!/usr/bin/env bash
set -euo pipefail
# Routed release helper: sign, build, notarize, staple, and publish DMG
# Prereqs:
# - Xcode command line tools (xcrun)
# - Apple Developer ID Application certificate installed (codesign identity)
# - gh CLI authenticated for releases
# - notarytool profile configured once: xcrun notarytool store-credentials --key /path/to/AuthKey_XXXX.p8 --key-id KEYID --issuer ISSUER-UUID --team-id F25JD2C29Z routed-notary
#   After that, use --keychain-profile routed-notary (no need to re-enter ids/keys)
# Usage:
#   scripts/release_dmg.sh v0.1.7 "Developer ID Application: Leonard Speiser (F25JD2C29Z)"
#   Optionally export APPLE_IDENTITY to override identity argument.

VERSION=${1:?"version tag required, e.g. v0.1.7"}
IDENTITY=${2:-${APPLE_IDENTITY:-"Developer ID Application: Leonard Speiser (F25JD2C29Z)"}}

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
APP_DIR="$ROOT_DIR/dist/mac-arm64/Routed.app"
DMG_PATH="$ROOT_DIR/dist/Routed-$(node -p "require('./package.json').version")-mac-arm64.dmg"
ZIP_PATH="$ROOT_DIR/dist/Routed.app.zip"

# 1) Build DMG
npm run dist

# 2) Verify signature
codesign --verify --deep --strict --verbose=2 "$APP_DIR"

# 3) Zip app for notarization (more stable than DMG for submit)
ditto -c -k --keepParent "$APP_DIR" "$ZIP_PATH"

# 4) Notarize using either a stored profile or direct ASC API key variables
# Option A (preferred): store a profile once
#   xcrun notarytool store-credentials --key /path/to/AuthKey_XXXX.p8 --key-id KEYID --issuer ISSUER-UUID --team-id F25JD2C29Z routed-notary
#   export NOTARY_PROFILE=routed-notary
# Option B: provide variables each run (no profile needed)
#   export NOTARY_KEY=~/Downloads/AuthKey_XXXX.p8
#   export NOTARY_KEY_ID=KEYID12345
#   export NOTARY_ISSUER=ISSUER-UUID
#   export NOTARY_TEAM_ID=F25JD2C29Z
if [[ -n "${NOTARY_PROFILE:-}" ]]; then
  xcrun notarytool submit "$DMG_PATH" --keychain-profile "$NOTARY_PROFILE" --wait
elif [[ -n "${NOTARY_KEY:-}" && -n "${NOTARY_KEY_ID:-}" && -n "${NOTARY_ISSUER:-}" && -n "${NOTARY_TEAM_ID:-}" ]]; then
  xcrun notarytool submit "$DMG_PATH" \
    --key "$NOTARY_KEY" \
    --key-id "$NOTARY_KEY_ID" \
    --issuer "$NOTARY_ISSUER" \
    --team-id "$NOTARY_TEAM_ID" \
    --wait
else
  echo "ERROR: Provide NOTARY_PROFILE or NOTARY_KEY/NOTARY_KEY_ID/NOTARY_ISSUER/NOTARY_TEAM_ID env vars." >&2
  exit 1
fi

# 5) Staple both DMG and app
xcrun stapler staple "$DMG_PATH"
xcrun stapler staple "$APP_DIR"

# 6) Publish to GitHub release (clobber existing asset)
# Ensure the tag exists or create it with the release
if ! gh release view "$VERSION" >/dev/null 2>&1; then
  gh release create "$VERSION" -t "Routed ${VERSION#v}" -n "Release ${VERSION#v}" "$DMG_PATH"
else
  gh release upload "$VERSION" "$DMG_PATH" --clobber
fi

echo "Done. Release $VERSION updated with notarized DMG: $DMG_PATH"

