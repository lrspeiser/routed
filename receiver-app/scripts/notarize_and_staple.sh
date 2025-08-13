#!/usr/bin/env bash
set -euo pipefail

# Notarize and staple the Routed app using credentials in .env.
# - Zips the app if needed
# - Submits to Apple notarization
# - Polls status until Accepted or Invalid
# - Staples the ticket to the .app and .dmg
# - Verifies codesign and Gatekeeper assessment
#
# Usage examples (run from receiver-app/):
#   ./scripts/notarize_and_staple.sh
#   ./scripts/notarize_and_staple.sh --id <submission-id>
#   ./scripts/notarize_and_staple.sh --app dist/mac-arm64/Routed.app --dmg dist/Routed-0.1.1-mac-arm64.dmg
#   ./scripts/notarize_and_staple.sh --zip dist/Routed.app.zip
#
# Notes:
# - Requires: xcrun notarytool, xcrun stapler, /usr/bin/python3
# - Reads credentials from .env (APPLE_ID, APPLE_TEAM_ID, APPLE_APP_SPECIFIC_PASSWORD)
# - Will not echo secrets.

HERE=$(cd "$(dirname "$0")" && pwd)
APP_ROOT=$(cd "$HERE/.." && pwd)
cd "$APP_ROOT"

# Load .env quietly if present
if [[ -f .env ]]; then
  set +x
  # shellcheck disable=SC1091
  source .env
  set -x
  set +x
fi

APPLE_ID=${APPLE_ID:-}
APPLE_TEAM_ID=${APPLE_TEAM_ID:-}
APPLE_APP_SPECIFIC_PASSWORD=${APPLE_APP_SPECIFIC_PASSWORD:-}

if [[ -z "$APPLE_ID" || -z "$APPLE_TEAM_ID" || -z "$APPLE_APP_SPECIFIC_PASSWORD" ]]; then
  echo "ERROR: Missing APPLE_ID / APPLE_TEAM_ID / APPLE_APP_SPECIFIC_PASSWORD in .env or environment." >&2
  exit 1
fi

SUBMISSION_ID=""
APP_PATH=""
DMG_PATH=""
ZIP_PATH=""

# Defaults: try to auto-detect common paths
# App (.app)
if compgen -G "dist/mac-arm64/*.app" > /dev/null; then
  # Prefer Routed.app if present
  if [[ -d "dist/mac-arm64/Routed.app" ]]; then
    APP_PATH="dist/mac-arm64/Routed.app"
  else
    APP_PATH=$(ls -d dist/mac-arm64/*.app | head -n 1)
  fi
fi
# DMG (pick most recent)
if compgen -G "dist/*.dmg" > /dev/null; then
  DMG_PATH=$(ls -t dist/*.dmg | head -n 1)
fi
# ZIP
if [[ -f "dist/Routed.app.zip" ]]; then
  ZIP_PATH="dist/Routed.app.zip"
fi

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --id)
      SUBMISSION_ID=${2:-}
      shift 2
      ;;
    --app)
      APP_PATH=${2:-}
      shift 2
      ;;
    --dmg)
      DMG_PATH=${2:-}
      shift 2
      ;;
    --zip)
      ZIP_PATH=${2:-}
      shift 2
      ;;
    -h|--help)
      grep '^# ' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
  echo "ERROR: App path not found. Specify with --app, e.g. --app dist/mac-arm64/Routed.app" >&2
  exit 1
fi

# Ensure ZIP exists; if not, create it
if [[ -z "$ZIP_PATH" || ! -f "$ZIP_PATH" ]]; then
  ZIP_PATH="dist/$(basename "$APP_PATH").zip"
  echo "Zipping app for notarization: $ZIP_PATH"
  mkdir -p dist
  # Create a proper zip with resource forks preserved
  ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$ZIP_PATH"
fi

# Helper to parse JSON field via Python (avoids jq dependency)
json_field() {
  local key="$1"
  /usr/bin/python3 - "$key" <<'PY'
import sys, json
key = sys.argv[1]
obj = json.load(sys.stdin)
# Print empty string if key missing
print(obj.get(key, ""))
PY
}

# If no submission id, submit now
if [[ -z "$SUBMISSION_ID" ]]; then
  echo "Submitting to Apple notarization..."
  # Note: secrets are passed via env; not echoed
  submit_json=$(xcrun notarytool submit "$ZIP_PATH" \
    --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_APP_SPECIFIC_PASSWORD" \
    --output-format json)
  SUBMISSION_ID=$(printf '%s' "$submit_json" | json_field id)
  if [[ -z "$SUBMISSION_ID" ]]; then
    echo "ERROR: Failed to get submission id from notarytool submit output:" >&2
    echo "$submit_json" >&2
    exit 1
  fi
  echo "Submission ID: $SUBMISSION_ID"
fi

# Poll status until Accepted or Invalid
echo "Polling notarization status for $SUBMISSION_ID ..."
status=""
for i in {1..120}; do
  info_json=$(xcrun notarytool info "$SUBMISSION_ID" \
    --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_APP_SPECIFIC_PASSWORD" \
    --output-format json || true)
  status=$(printf '%s' "$info_json" | json_field status)
  echo "Status: ${status:-unknown}"
  if [[ "$status" == "Accepted" || "$status" == "Invalid" ]]; then
    break
  fi
  sleep 10
done

if [[ "$status" != "Accepted" ]]; then
  echo "Notarization not accepted. Final status: $status" >&2
  echo "Full response:" >&2
  echo "$info_json" >&2
  exit 1
fi

echo "Notarization Accepted. Stapling..."
# Staple app
xcrun stapler staple "$APP_PATH"
# Staple dmg if present
if [[ -n "$DMG_PATH" && -f "$DMG_PATH" ]]; then
  xcrun stapler staple "$DMG_PATH"
fi

echo "Verifying signatures..."
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
spctl --assess --type execute --verbose "$APP_PATH"
if [[ -n "$DMG_PATH" && -f "$DMG_PATH" ]]; then
  spctl --assess --type open --context context:primary-signature --verbose "$DMG_PATH"
fi

echo "Done."
echo "App: $APP_PATH"
[[ -n "${DMG_PATH:-}" ]] && echo "DMG: $DMG_PATH"
echo "Submission ID: $SUBMISSION_ID"
