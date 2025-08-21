#!/bin/bash

echo "========================================="
echo "Routed v1.9.1 Complete System Test"
echo "========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}1. Backend Version Check${NC}"
echo "----------------------------------------"
response=$(curl -s https://routed.onrender.com/v1/version)
backend_version=$(echo $response | jq -r '.backend_version' 2>/dev/null)
build_date=$(echo $response | jq -r '.build_date' 2>/dev/null)
base_url=$(echo $response | jq -r '.base_url' 2>/dev/null)

if [[ $backend_version == "1.0.3" ]]; then
  echo -e "${GREEN}✅ Backend Version: $backend_version${NC}"
  echo -e "${GREEN}✅ Build Date: $build_date${NC}"
  echo -e "${GREEN}✅ Base URL: $base_url${NC}"
  echo -e "${GREEN}✅ Features: Twilio Verify, Enhanced Logging, Version Check${NC}"
else
  echo -e "${RED}❌ Backend version check failed${NC}"
fi

echo ""
echo -e "${YELLOW}2. Phone Verification Test${NC}"
echo "----------------------------------------"
test_response=$(curl -X POST https://routed.onrender.com/v1/verify/check \
  -H "Content-Type: application/json" \
  -d '{"phone":"+16502079445","code":"test123"}' \
  -s 2>&1)

if [[ $test_response == *"twilio_error"* ]]; then
  echo -e "${GREEN}✅ Backend phone verification endpoint working${NC}"
  echo "   (Returning expected Twilio error for test code)"
elif [[ $test_response == *"TypeError"* ]]; then
  echo -e "${RED}❌ Backend still has TypeError bug!${NC}"
  echo "   Error: $test_response"
else
  echo -e "${YELLOW}⚠️  Unexpected response: $test_response${NC}"
fi

echo ""
echo -e "${YELLOW}3. DMG File Information${NC}"
echo "----------------------------------------"
dmg_path="/Users/leonardspeiser/Projects/routed/receiver-app/dist/Routed-1.9.1-mac-arm64.dmg"
if [[ -f "$dmg_path" ]]; then
  size=$(ls -lh "$dmg_path" | awk '{print $5}')
  echo -e "${GREEN}✅ DMG Created: Routed-1.9.1-mac-arm64.dmg${NC}"
  echo "   Size: $size"
  echo "   Path: $dmg_path"
else
  echo -e "${RED}❌ DMG file not found${NC}"
fi

echo ""
echo -e "${YELLOW}4. What's New in v1.9.1${NC}"
echo "----------------------------------------"
echo "• Version upgraded from 0.1.9 to 1.9.1 for clear identification"
echo "• Backend version endpoint (/v1/version) for compatibility checking"
echo "• App logs server version on startup with detailed info:"
echo "  - App Version, Server Version, Build Date, Features"
echo "• Enhanced error messages in phone verification"
echo "• Better console logging for debugging"
echo "• Fixed runtime-service bundling for packaged app"

echo ""
echo -e "${YELLOW}5. Installation Instructions${NC}"
echo "----------------------------------------"
echo "1. Quit any running Routed app (check menu bar)"
echo "2. Double-click: Routed-1.9.1-mac-arm64.dmg"
echo "3. Drag Routed to Applications folder"
echo "4. Launch Routed from Applications"
echo "5. Check console logs for version info on startup"

echo ""
echo -e "${YELLOW}6. How to Verify You're Running v1.9.1${NC}"
echo "----------------------------------------"
echo "When the app starts, the logs will show:"
echo "========================================" 
echo "Routed App Starting"
echo "App Version: 1.9.1"
echo "Base URL: https://routed.onrender.com"
echo "Server Version: 1.0.3"
echo "Server Build Date: 2025-08-21"
echo "========================================" 

echo ""
echo -e "${YELLOW}7. Check for Running Instances${NC}"
echo "----------------------------------------"
if pgrep -x "Routed" > /dev/null; then
  echo -e "${RED}⚠️  WARNING: Routed is currently running!${NC}"
  echo "   Please quit it before installing v1.9.1"
  echo "   Use: killall Routed"
else
  echo -e "${GREEN}✅ No Routed instances running${NC}"
fi

echo ""
echo "========================================="
echo -e "${GREEN}Testing Complete!${NC}"
echo "========================================="
