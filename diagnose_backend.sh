#!/bin/bash

echo "========================================="
echo "Routed Backend Diagnostic"
echo "========================================="
echo ""

# Check Application Support for Routed data
echo "1. Checking for Routed app data..."
echo "-----------------------------------------"
routed_dirs=$(find ~/Library -type d -name "*outed*" 2>/dev/null | grep -v Caches | head -10)
if [ -n "$routed_dirs" ]; then
  echo "Found Routed directories:"
  echo "$routed_dirs"
  echo ""
  
  # Look for dev.json files
  echo "Looking for dev.json files..."
  for dir in $routed_dirs; do
    if [ -f "$dir/dev.json" ]; then
      echo "Found: $dir/dev.json"
      echo "Content:"
      cat "$dir/dev.json" | jq . 2>/dev/null || cat "$dir/dev.json"
      echo ""
    fi
  done
else
  echo "No Routed directories found in ~/Library"
fi

echo ""
echo "2. Checking .env files..."
echo "-----------------------------------------"
if [ -f "/Users/leonardspeiser/Projects/routed/receiver-app/.env" ]; then
  echo "receiver-app/.env:"
  cat /Users/leonardspeiser/Projects/routed/receiver-app/.env
else
  echo "No .env file in receiver-app"
fi

echo ""
echo "3. Testing different backend URLs..."
echo "-----------------------------------------"

# Test routed.onrender.com (correct one)
echo -n "https://routed.onrender.com: "
response=$(curl -X POST https://routed.onrender.com/v1/verify/check \
  -H "Content-Type: application/json" \
  -d '{"phone":"+16502079445","code":"test"}' \
  -s 2>&1)
if [[ $response == *"twilio_error"* ]]; then
  echo "✅ Working (returns Twilio error as expected)"
elif [[ $response == *"TypeError"* ]]; then
  echo "❌ Has TypeError bug"
else
  echo "Status: $response" | head -c 50
fi

# Test routed-receiver.onrender.com (old one)
echo -n "https://routed-receiver.onrender.com: "
response=$(curl -X POST https://routed-receiver.onrender.com/v1/verify/check \
  -H "Content-Type: application/json" \
  -d '{"phone":"+16502079445","code":"test"}' \
  -s 2>&1)
if [[ $response == *"Not Found"* ]]; then
  echo "Not Found (service doesn't exist)"
elif [[ $response == *"TypeError"* ]]; then
  echo "❌ Has TypeError bug - THIS IS THE PROBLEM!"
else
  echo "Status: $response" | head -c 50
fi

# Test localhost
echo -n "http://localhost:8080: "
response=$(curl -X POST http://localhost:8080/v1/verify/check \
  -H "Content-Type: application/json" \
  -d '{"phone":"+16502079445","code":"test"}' \
  -s --connect-timeout 2 2>&1)
if [ -z "$response" ]; then
  echo "No response (not running)"
elif [[ $response == *"TypeError"* ]]; then
  echo "❌ Has TypeError bug - LOCAL SERVER ISSUE!"
else
  echo "Status: $response" | head -c 50
fi

echo ""
echo "4. App Version Check..."
echo "-----------------------------------------"
if [ -d "/Applications/Routed.app" ]; then
  version=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" /Applications/Routed.app/Contents/Info.plist 2>/dev/null)
  echo "Installed version: $version"
else
  echo "Routed not installed in /Applications"
fi

echo ""
echo "5. Running Processes..."
echo "-----------------------------------------"
ps aux | grep -i routed | grep -v grep | grep -v diagnose || echo "No Routed processes running"

echo ""
echo "========================================="
echo "Diagnosis Complete"
echo "========================================="
