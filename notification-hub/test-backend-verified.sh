#!/bin/bash

# Credentials from successful verification
TENANT_ID="88726ee0-3137-4459-8dda-30db87c91bdf"
USER_ID="8a35ab54-0085-4626-9b02-7c9b23090697"
PHONE="+16502079445"
BASE_URL="https://routed.onrender.com"

echo "=== Testing Backend with Verified Credentials ==="
echo "Tenant ID: $TENANT_ID"
echo "User ID: $USER_ID"
echo "Phone: $PHONE"
echo ""

# Test 1: Provision a developer sandbox (public endpoint)
echo "1. Creating developer sandbox..."
SANDBOX_RESPONSE=$(curl -s -X POST "$BASE_URL/v1/dev/sandbox/provision" \
  -H "Content-Type: application/json" \
  -d '{}')
echo "Response: $SANDBOX_RESPONSE"

# Extract values from sandbox response
DEV_TENANT_ID=$(echo "$SANDBOX_RESPONSE" | jq -r '.tenantId')
DEV_API_KEY=$(echo "$SANDBOX_RESPONSE" | jq -r '.apiKey')
DEV_USER_ID=$(echo "$SANDBOX_RESPONSE" | jq -r '.userId')
DEV_TOPIC_ID=$(echo "$SANDBOX_RESPONSE" | jq -r '.topicId')

if [ "$DEV_TENANT_ID" != "null" ]; then
  echo "✅ Sandbox created: Tenant=$DEV_TENANT_ID, API Key=$DEV_API_KEY"
else
  echo "❌ Failed to create sandbox"
fi
echo ""

# Test 2: Ensure user by phone in the dev tenant
if [ "$DEV_TENANT_ID" != "null" ]; then
  echo "2. Ensuring user with phone in dev tenant..."
  USER_RESPONSE=$(curl -s -X POST "$BASE_URL/v1/dev/users/ensure" \
    -H "Content-Type: application/json" \
    -d "{\"tenant_id\": \"$DEV_TENANT_ID\", \"phone\": \"$PHONE\"}")
  echo "Response: $USER_RESPONSE"
  
  ENSURED_USER_ID=$(echo "$USER_RESPONSE" | jq -r '.userId')
  if [ "$ENSURED_USER_ID" != "null" ]; then
    echo "✅ User ensured: ID=$ENSURED_USER_ID"
  else
    echo "❌ Failed to ensure user"
  fi
  echo ""
fi

# Test 3: Create a channel
if [ "$DEV_TENANT_ID" != "null" ]; then
  echo "3. Creating channel..."
  CHANNEL_RESPONSE=$(curl -s -X POST "$BASE_URL/v1/dev/channels/create" \
    -H "Content-Type: application/json" \
    -d "{\"tenantId\": \"$DEV_TENANT_ID\", \"name\": \"Test Channel\", \"topic\": \"runs.finished\"}")
  echo "Response: $CHANNEL_RESPONSE"
  
  CHANNEL_ID=$(echo "$CHANNEL_RESPONSE" | jq -r '.short_id')
  if [ "$CHANNEL_ID" != "null" ]; then
    echo "✅ Channel created: ID=$CHANNEL_ID"
  else
    echo "❌ Failed to create channel"
  fi
  echo ""
fi

# Test 4: List channels
if [ "$DEV_TENANT_ID" != "null" ]; then
  echo "4. Listing channels..."
  CHANNELS_RESPONSE=$(curl -s -X GET "$BASE_URL/v1/dev/channels/list?tenant_id=$DEV_TENANT_ID")
  echo "Response: $CHANNELS_RESPONSE"
  
  CHANNEL_COUNT=$(echo "$CHANNELS_RESPONSE" | jq '.channels | length')
  if [ "$CHANNEL_COUNT" -gt 0 ]; then
    echo "✅ Found $CHANNEL_COUNT channel(s)"
  else
    echo "❌ No channels found"
  fi
  echo ""
fi

# Test 5: Send a message using the API key
if [ "$DEV_API_KEY" != "null" ]; then
  echo "5. Sending test message..."
  MESSAGE_RESPONSE=$(curl -s -X POST "$BASE_URL/v1/messages" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $DEV_API_KEY" \
    -d '{
      "topic": "runs.finished",
      "title": "Test Message",
      "body": "This is a test message from the verified backend test",
      "payload": {"test": true}
    }')
  echo "Response: $MESSAGE_RESPONSE"
  
  MESSAGE_ID=$(echo "$MESSAGE_RESPONSE" | jq -r '.message_id')
  if [ "$MESSAGE_ID" != "null" ]; then
    echo "✅ Message sent: ID=$MESSAGE_ID"
    
    # Test 6: Get message details
    echo ""
    echo "6. Getting message details..."
    MESSAGE_DETAILS=$(curl -s -X GET "$BASE_URL/v1/messages/$MESSAGE_ID")
    echo "Response: $MESSAGE_DETAILS"
    
    MESSAGE_TITLE=$(echo "$MESSAGE_DETAILS" | jq -r '.message.title')
    if [ "$MESSAGE_TITLE" = "Test Message" ]; then
      echo "✅ Message retrieved successfully"
    else
      echo "❌ Failed to retrieve message"
    fi
  else
    echo "❌ Failed to send message"
  fi
  echo ""
fi

# Test 7: Check WebSocket sockets snapshot
echo "7. Checking sockets snapshot..."
SOCKETS_RESPONSE=$(curl -s -X GET "$BASE_URL/v1/dev/debug/sockets")
echo "Response: $SOCKETS_RESPONSE"

SOCKETS_COUNT=$(echo "$SOCKETS_RESPONSE" | jq '.sockets | length')
if [ "$SOCKETS_COUNT" != "null" ]; then
  echo "✅ Sockets snapshot retrieved: $SOCKETS_COUNT active socket(s)"
else
  echo "❌ Failed to get sockets snapshot"
fi
echo ""

# Summary
echo "=== Test Summary ==="
echo "Dev Tenant ID: $DEV_TENANT_ID"
echo "Dev API Key: $DEV_API_KEY"
echo "Dev User ID: $DEV_USER_ID"
echo "Channel ID: $CHANNEL_ID"
echo "Message ID: $MESSAGE_ID"
echo ""
echo "These credentials can be used for further testing."
