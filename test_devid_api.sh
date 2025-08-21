#!/bin/bash

# Test script to verify dev_id is returned from API endpoints

BACKEND_URL="https://routed.onrender.com"
PHONE="+15555551234"  # Test phone number

echo "================================================"
echo "Testing dev_id in API responses"
echo "================================================"
echo ""

# Test 1: Start verification (this won't actually send SMS with test number)
echo "1. Testing /v1/verify/start endpoint..."
echo "Request: POST $BACKEND_URL/v1/verify/start"
echo "Body: {\"phone\": \"$PHONE\"}"
echo ""

START_RESPONSE=$(curl -s -X POST "$BACKEND_URL/v1/verify/start" \
  -H "Content-Type: application/json" \
  -d "{\"phone\": \"$PHONE\"}")

echo "Response:"
echo "$START_RESPONSE" | jq '.' || echo "$START_RESPONSE"
echo ""

# Test 2: Check verification (with invalid code to see error response)
echo "2. Testing /v1/verify/check endpoint..."
echo "Request: POST $BACKEND_URL/v1/verify/check"
echo "Body: {\"phone\": \"$PHONE\", \"code\": \"123456\"}"
echo ""

CHECK_RESPONSE=$(curl -s -X POST "$BACKEND_URL/v1/verify/check" \
  -H "Content-Type: application/json" \
  -d "{\"phone\": \"$PHONE\", \"code\": \"123456\"}")

echo "Response:"
echo "$CHECK_RESPONSE" | jq '.' || echo "$CHECK_RESPONSE"
echo ""

# Check if devId is in response
if echo "$CHECK_RESPONSE" | grep -q "devId"; then
    echo "✅ devId field found in response"
else
    echo "❌ devId field NOT found in response"
fi
echo ""

# Test 3: Check auth/complete-sms endpoint structure
echo "3. Testing /auth/complete-sms endpoint (will fail without verification)..."
echo "Request: POST $BACKEND_URL/auth/complete-sms"
echo "Body: {\"phone\": \"$PHONE\", \"deviceName\": \"Test Device\"}"
echo ""

AUTH_RESPONSE=$(curl -s -X POST "$BACKEND_URL/auth/complete-sms" \
  -H "Content-Type: application/json" \
  -d "{\"phone\": \"$PHONE\", \"deviceName\": \"Test Device\"}")

echo "Response:"
echo "$AUTH_RESPONSE" | jq '.' || echo "$AUTH_RESPONSE"
echo ""

# Test 4: Check database directly if we have access
echo "================================================"
echo "Checking database for dev_id column..."
echo "================================================"
echo ""

# Try to connect to database if we have the URL
if [ ! -z "$DATABASE_URL" ]; then
    echo "Checking users table schema..."
    psql "$DATABASE_URL" -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'dev_id';" 2>/dev/null
    
    echo ""
    echo "Sample user records (without PII):"
    psql "$DATABASE_URL" -c "SELECT id, dev_id, created_at, phone_verified_at FROM users ORDER BY created_at DESC LIMIT 5;" 2>/dev/null
else
    echo "DATABASE_URL not set, skipping database checks"
fi

echo ""
echo "================================================"
echo "Summary"
echo "================================================"
echo ""
echo "If dev_id is missing from responses, possible issues:"
echo "1. Backend not running latest code (needs redeploy)"
echo "2. Database migration not applied"
echo "3. Client not parsing response correctly"
echo ""
echo "To check client-side reception:"
echo "1. Open Developer Console in Routed app"
echo "2. Look for network requests to /v1/verify/check"
echo "3. Check the response body for devId field"
echo ""
