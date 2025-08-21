# Authentication and Dev ID Summary

## 🎉 Fixed in v1.9.4

### Dev ID Issue - FIXED ✅
The client was not saving the `devId` from the `/v1/verify/check` response. This has been fixed:

1. **Client Fix**: `main.js` lines 1340-1345 now properly save `devId` from server response
2. **Enhanced Logging**: Added logging to track devId reception and storage
3. **Response Updated**: verify:check now returns devId to client

### How Dev ID Works Now:
- **Server Side**: Backend generates and returns devId in `/v1/verify/check` response
- **Client Side**: Client saves devId to `dev.json` and includes in subsequent responses
- **Persistence**: DevId is stored locally and persists across app restarts

## 📱 Authentication Persistence Explained

### Why You Need to Re-Authenticate Sometimes:

The app stores authentication state in: `~/Library/Application Support/Routed/dev.json`

**Authentication DOES persist** across normal app restarts. You only need to re-authenticate when:

1. **Installing a fresh DMG** (if you clean app data)
2. **Using `--clean-start` flag** 
3. **Manually deleting** `~/Library/Application Support/Routed/`
4. **First time setup** on a new machine

### How Authentication Works:

1. **Phone Verification** (`/v1/verify/check`):
   - Sets `verifiedPhone`, `verifiedUserId`, `verifiedTenantId`, `devId`
   - Saves to `dev.json`
   - App considers user "verified" if these exist

2. **Token Management**:
   - Access/Refresh tokens stored in **macOS Keychain** (survives reinstalls)
   - Tokens auto-refresh when needed
   - Session persists until logout or token expiry

3. **App Startup Check**:
   ```javascript
   // Line 628-629 in main.js
   verified = !!(dev && dev.verifiedUserId && dev.verifiedPhone);
   ```
   - If verified → Show main window
   - If not verified → Show verify window

## 🔧 Testing Authentication Persistence

### Test 1: Normal Restart (Should NOT require re-auth)
```bash
1. Open Routed app
2. Complete phone verification
3. Quit app (Cmd+Q)
4. Reopen app
→ Should go straight to main window
```

### Test 2: Check Stored Data
```bash
# View stored authentication data
cat ~/Library/Application\ Support/Routed/dev.json | jq '.'

# Should see:
{
  "verifiedPhone": "+1234567890",
  "verifiedUserId": "uuid",
  "verifiedTenantId": "uuid",
  "devId": "uuid",
  "apiKey": "key",
  "hubUrl": "https://routed.onrender.com"
}
```

### Test 3: Force Re-Authentication
```bash
# Method 1: Clean start flag
open /Applications/Routed.app --args --clean-start

# Method 2: Delete stored data
rm ~/Library/Application\ Support/Routed/dev.json
```

## 📦 DMG Versions

### v1.9.3
- ❌ Dev ID not saved from verify response
- ✅ Twilio integration fixed
- ✅ Authentication works

### v1.9.4 (Latest)
- ✅ Dev ID properly saved and returned
- ✅ Enhanced logging for debugging
- ✅ All authentication features working

**Location**: `/Users/leonardspeiser/Projects/routed/receiver-app/dist/Routed-1.9.4-mac-arm64.dmg`

## 🚀 Installation

```bash
# Mount DMG
hdiutil attach /Users/leonardspeiser/Projects/routed/receiver-app/dist/Routed-1.9.4-mac-arm64.dmg

# Install (will preserve existing auth if not using --clean-start)
cp -R /Volumes/Routed/Routed.app /Applications/

# Unmount
hdiutil detach /Volumes/Routed

# Run (normal - preserves auth)
open /Applications/Routed.app

# Run (clean - requires re-auth)
open /Applications/Routed.app --args --clean-start
```

## 📊 Monitoring

### Check Logs for Dev ID:
```bash
tail -f ~/Library/Application\ Support/Routed/routed.log | grep devId
```

Expected output:
```
[VERIFY CHECK] received devId: 7f3e8d9a-...
verify:check → ok user=abc123 devId=7f3e8d9a-...
```

### Check Server Response:
```bash
# Watch network tab in Developer Console
# Look for /v1/verify/check response
# Should contain: { "devId": "uuid", ... }
```

## 🔍 Troubleshooting

### Issue: No dev_id in responses
**Solution**: Update to v1.9.4 DMG

### Issue: Need to re-auth every time
**Check**:
1. Is `dev.json` being preserved? 
2. Are you reinstalling with clean data?
3. Check logs for "verified" status

### Issue: Authentication expires quickly
**Check**: 
1. Keychain access (tokens stored there)
2. Server token TTL settings
3. Network connectivity

## 📝 Technical Details

### Files Involved:
- **Client**: `/receiver-app/main.js` (lines 1336-1345, 1785-1787)
- **Server**: `/notification-hub/src/routes/verify.ts` (lines 157-195)
- **Storage**: `~/Library/Application Support/Routed/dev.json`
- **Tokens**: macOS Keychain (service: "routed")

### Data Flow:
1. User enters phone → `/v1/verify/start`
2. User enters code → `/v1/verify/check` → Returns devId
3. Client saves to `dev.json`
4. Future auth → `/auth/complete-sms` → Uses stored devId
5. Tokens → Keychain for session management

## ✅ Summary

The authentication system is working correctly:
- **Dev ID**: Now properly saved and managed (v1.9.4)
- **Persistence**: Works across normal app restarts
- **Re-auth needed**: Only for fresh installs or clean starts
- **Tokens**: Securely stored in macOS Keychain

This is the expected behavior for a desktop app that maintains user sessions while allowing clean reinstalls when needed.
