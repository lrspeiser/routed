#!/bin/bash

echo "Testing Routed Phone Verification Setup"
echo "========================================"
echo ""

# Check backend status
echo "1. Checking backend at routed.onrender.com..."
response=$(curl -X POST https://routed.onrender.com/v1/verify/check \
  -H "Content-Type: application/json" \
  -d '{"phone":"+16502079445","code":"test123"}' \
  -s 2>&1)

if [[ $response == *"twilio_error"* ]]; then
  echo "✅ Backend is working correctly (returning Twilio errors as expected)"
elif [[ $response == *"TypeError"* ]]; then
  echo "❌ Backend still has the TypeError bug"
else
  echo "⚠️  Unexpected response: $response"
fi

echo ""
echo "2. Instructions to test the new DMG:"
echo "   a) First, quit any running Routed app (check menu bar)"
echo "   b) Open Finder and navigate to:"
echo "      /Users/leonardspeiser/Projects/routed/receiver-app/dist/"
echo "   c) Double-click on: Routed-0.1.9-mac-arm64.dmg"
echo "   d) In the DMG window, drag Routed to Applications (or run directly)"
echo "   e) Launch the Routed app"
echo "   f) Try phone verification with your real phone number"
echo ""

echo "3. New features in this build:"
echo "   - Enhanced error logging in console"
echo "   - Backend logs show: 'Sent Phone to Twilio', 'Twilio Confirmed', etc."
echo "   - Better error messages for users"
echo "   - Fixed runtime-service bundling"
echo ""

echo "4. To see backend logs, you can run:"
echo "   tail -f ~/Library/Application\\ Support/Routed/routed.log"
echo ""

echo "5. Twilio Customization:"
echo "   Log into Twilio Console and set your Verify Service's"
echo "   Friendly Name to 'Routed' for branded SMS messages"
echo ""

# Test if old app is still running
if pgrep -x "Routed" > /dev/null; then
  echo "⚠️  WARNING: Routed app is currently running!"
  echo "   Please quit it before testing the new version"
fi
