# Testing Guide - User ID Mismatch Fix

## Clean State Achieved
✅ All local app data cleared
✅ Database reset (all tables truncated)
✅ Backend restarted with latest fixes
✅ App rebuilt and launched

## Testing Steps

### 1. Phone Verification
1. Enter your phone number (e.g., +16502079445)
2. Complete SMS verification
3. Verify in logs:
   ```bash
   tail -f notification-hub.log | grep VERIFY
   ```
   - Should see: "Created new user with dev_id" in system tenant
   - Should see: "Returning response with devId"

### 2. Channel Creation
1. Create a new channel with any name
2. Check logs:
   ```bash
   tail -f notification-hub.log | grep CHANNEL_CREATE
   ```
   - Should see: "Looking for verified user with phone"
   - Should see: "Using verified user from system tenant"
   - Should see: "Using tenant for subscription"

### 3. Verify Online Status
**Expected Result**: ✅ Green dot should appear immediately next to your phone number

### 4. Test Real-time Messaging
1. Send a test message to the channel
2. **Expected Result**: Message should appear instantly in the app

### 5. Check WebSocket Connection
```bash
tail -f receiver-app/routed.log | grep -i websocket
```
- Should see: "WebSocket connected"
- Should match the userId from verification

## What Was Fixed

### Before Fix
- Phone verification created user in 'system' tenant
- Channel creation created a DIFFERENT user in publisher's tenant
- WebSocket used system tenant userId
- Subscriptions used publisher tenant userId
- Result: User appeared offline, messages didn't arrive

### After Fix
- Channel creation now checks for verified user in system tenant FIRST
- Uses the same userId for subscriptions
- WebSocket and subscriptions now use matching userId
- Result: User shows online, messages work properly

## Troubleshooting

If user still shows offline:
1. Check that dev.json has correct verifiedUserId:
   ```bash
   cat receiver-app/dev.json | jq '.verifiedUserId'
   ```

2. Verify WebSocket is connected with right userId:
   ```bash
   tail -f receiver-app/routed.log | grep "ws-manager connected"
   ```

3. Check subscription was created with correct userId:
   ```bash
   cd notification-hub && source .env
   psql $DATABASE_URL -c "SELECT u.id, u.phone, u.tenant_id, t.name as tenant_name FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.phone LIKE '%9445';"
   ```

## Database Verification Queries

Check users and their tenants:
```sql
SELECT 
    u.id as user_id,
    u.phone,
    u.dev_id,
    t.name as tenant_name,
    u.phone_verified_at
FROM users u 
JOIN tenants t ON u.tenant_id = t.id 
ORDER BY u.created_at DESC;
```

Check subscriptions:
```sql
SELECT 
    s.user_id,
    u.phone,
    t.name as tenant_name,
    tp.name as topic_name
FROM subscriptions s
JOIN users u ON s.user_id = u.id
JOIN tenants t ON s.tenant_id = t.id
JOIN topics tp ON s.topic_id = tp.id;
```
