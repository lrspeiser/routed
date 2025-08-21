#!/bin/bash

# Test script for Routed v1.9.3 DMG
# Tests the fixed Twilio integration and dev_id management

echo "==================================="
echo "Testing Routed v1.9.3 DMG"
echo "==================================="
echo ""

DMG_PATH="/Users/leonardspeiser/Projects/routed/receiver-app/dist/Routed-1.9.3-mac-arm64.dmg"

if [ ! -f "$DMG_PATH" ]; then
    echo "❌ DMG not found at: $DMG_PATH"
    exit 1
fi

echo "✅ Found DMG: $DMG_PATH"
echo ""

# Get file info
echo "📦 DMG Info:"
ls -lah "$DMG_PATH"
echo ""

# Test backend connection
echo "🌐 Testing backend connection..."
BACKEND_URL="https://routed.onrender.com"

# Check version endpoint
echo "Checking backend version..."
VERSION_RESPONSE=$(curl -s "$BACKEND_URL/v1/version")
if [ $? -eq 0 ]; then
    echo "✅ Backend is reachable"
    echo "Version info:"
    echo "$VERSION_RESPONSE" | jq '.backend_version, .build_date, .features'
else
    echo "❌ Backend is not reachable"
fi
echo ""

# Check if Twilio verify is enabled
TWILIO_ENABLED=$(echo "$VERSION_RESPONSE" | jq -r '.features.twilio_verify')
if [ "$TWILIO_ENABLED" = "true" ]; then
    echo "✅ Twilio Verify is enabled on backend"
else
    echo "⚠️  Twilio Verify might not be enabled"
fi
echo ""

echo "==================================="
echo "Installation Instructions:"
echo "==================================="
echo ""
echo "1. Mount the DMG:"
echo "   hdiutil attach \"$DMG_PATH\""
echo ""
echo "2. Copy to Applications:"
echo "   cp -R /Volumes/Routed/Routed.app /Applications/"
echo ""
echo "3. Unmount the DMG:"
echo "   hdiutil detach /Volumes/Routed"
echo ""
echo "4. Launch Routed:"
echo "   open /Applications/Routed.app"
echo ""
echo "==================================="
echo "What's Fixed in v1.9.3:"
echo "==================================="
echo ""
echo "✅ Twilio Integration:"
echo "   - Fixed 'TypeError: Assignment to constant variable'"
echo "   - Enhanced error handling for Twilio API"
echo "   - Comprehensive logging for debugging"
echo ""
echo "✅ Dev ID Management:"
echo "   - Automatic dev_id generation for all users"
echo "   - Backwards compatibility for legacy users"
echo "   - dev_id returned in all auth responses"
echo ""
echo "✅ Documentation:"
echo "   - TWILIO_INTEGRATION_FIXES.md for troubleshooting"
echo "   - DEV_ID_MANAGEMENT.md for dev_id details"
echo "   - BACKEND_FIXES_SUMMARY.md for all changes"
echo ""
echo "==================================="
echo "Testing Checklist:"
echo "==================================="
echo ""
echo "[ ] Phone verification sends SMS"
echo "[ ] Verification code validates correctly"
echo "[ ] No TypeError in console logs"
echo "[ ] dev_id is returned after verification"
echo "[ ] Authentication completes successfully"
echo "[ ] Can send/receive messages after auth"
echo ""
echo "To monitor logs during testing:"
echo "tail -f ~/Library/Application\\ Support/Routed/routed.log"
echo ""
