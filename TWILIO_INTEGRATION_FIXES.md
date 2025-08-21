# Twilio Integration Fixes and Troubleshooting Guide

## Overview
This document details the critical issues encountered with Twilio Verify integration and the fixes applied to resolve them. These issues caused phone verification to fail with "TypeError: Assignment to constant variable" errors.

## The Problems We Fixed

### 1. Backend TypeError in verify.ts (notification-hub)
**Issue**: Variables declared with `const` were being reassigned in the database transaction code.

**Location**: `notification-hub/src/routes/verify.ts`

**Original Problematic Code**:
```typescript
const t = await c.query(`select id from tenants where name=$1 limit 1`, ['system']);
if (t.rows.length === 0) {
  t = await c.query(`insert into tenants...`); // ERROR: Can't reassign const!
}
```

**Fix Applied**: Changed `const` to `let` for all variables that needed reassignment:
```typescript
let t = await c.query(`select id from tenants where name=$1 limit 1`, ['system']);
if (t.rows.length === 0) {
  t = await c.query(`insert into tenants...`); // Now this works!
}
```

### 2. Frontend TypeError in main.js (receiver-app)
**Issue**: Similar const reassignment issue in the Electron app's verify:check handler.

**Location**: `receiver-app/main.js` (line ~1335)

**Original Problematic Code**:
```javascript
const d = loadDev() || {};
// ... later in the code ...
d = loadDev(); // ERROR: Can't reassign const!
```

**Fix Applied**: Changed to `let`:
```javascript
let d = loadDev() || {};
// ... later in the code ...
d = loadDev(); // Now this works!
```

### 3. Wrong Backend URL
**Issue**: Multiple backend URLs were in use causing confusion:
- `https://routed-receiver.onrender.com` (old, non-existent)
- `https://routed.onrender.com` (correct, current)

**Fix**: Ensured all `.env` files and code use `https://routed.onrender.com`

## How Twilio Verify Works in Our System

### Flow:
1. **Start Verification** (`/v1/verify/start`)
   - Accepts phone number
   - Sends SMS via Twilio Verify API
   - Returns success/failure

2. **Check Code** (`/v1/verify/check`)
   - Accepts phone + code
   - Verifies with Twilio
   - Creates/updates user in database
   - Returns user info on success

### Required Environment Variables:
```bash
TWILIO_ACCOUNT_SID=ACxxxxxx  # Your Twilio Account SID
TWILIO_AUTH_TOKEN=xxxxxx     # Your Twilio Auth Token
TWILIO_VERIFY_SERVICE_SID=VAxxxxxx  # Your Verify Service SID
```

### Authentication Methods Supported:
1. Account SID + Auth Token (primary)
2. API Key SID + API Key Secret (preferred for production)

## Common Error Messages and Solutions

### "TypeError: Assignment to constant variable"
**Cause**: Code bug with const reassignment
**Solution**: Update to v1.9.2+ of the app and ensure backend is deployed with fixes

### "The requested resource was not found" (Twilio 20404)
**Cause**: 
- Invalid Verify Service SID
- Code already used or expired
- Phone number format issues

**Solution**:
- Verify TWILIO_VERIFY_SERVICE_SID is correct
- Request a new code
- Ensure phone format is E.164 (+1XXXXXXXXXX)

### "Invalid code"
**Cause**: Wrong code entered or code expired (10 min TTL)
**Solution**: Request a new code via "Resend" link

## Testing the Integration

### Quick Test Command:
```bash
# Test backend directly
curl -X POST https://routed.onrender.com/v1/verify/start \
  -H "Content-Type: application/json" \
  -d '{"phone":"+16505551234"}'

# Check a code
curl -X POST https://routed.onrender.com/v1/verify/check \
  -H "Content-Type: application/json" \
  -d '{"phone":"+16505551234","code":"123456"}'
```

### Expected Responses:
- Success: `{"ok": true}`
- Twilio Error: `{"error": "twilio_error", "details": {...}}`
- Invalid Code: `{"error": "invalid_code"}`

## Version History

### v1.0.3 (Backend) - August 21, 2025
- Fixed const reassignment in verify routes
- Added comprehensive logging
- Added version endpoint

### v1.9.2 (Frontend) - August 21, 2025
- Fixed const reassignment in main.js
- Enhanced error reporting
- Added server version checking

### v1.9.1 (Frontend) - August 21, 2025
- Added version tracking system
- Enhanced logging
- Still had the const bug (use v1.9.2+)

## Debugging Tips

### Check Backend Logs:
Look for these log entries to trace the flow:
- `[VERIFY START] Sending phone to Twilio: +1...`
- `[VERIFY START] Twilio confirmed sent to +1...`
- `[VERIFY CHECK] Sending code to Twilio - phone: +1..., code: ...`
- `[VERIFY CHECK] Twilio confirmed code OK for +1...`
- `[VERIFY CHECK] Twilio could not match code - status: ...`

### Check Frontend Logs:
```bash
tail -f ~/Library/Application\ Support/Routed/routed.log
```

Look for:
- `verify:start → ok for +1...`
- `verify:check received request for phone: +1..., code: ...`
- `verify:check → ok user=...`

## SMS Message Customization

Twilio Verify has limited customization options. To brand your messages:

1. Log into Twilio Console
2. Navigate to Verify > Services
3. Update "Friendly Name" to "Routed"
4. Messages will show: "Your Routed verification code is: 123456"

For full customization, you'd need to switch to Programmable SMS (not recommended due to added complexity).

## Prevention Measures

To prevent similar issues in the future:

1. **Use `let` for reassignable variables**: Always use `let` instead of `const` when a variable might be reassigned
2. **Test locally first**: Run the backend locally before deploying
3. **Version everything**: Use clear version numbers to track deployments
4. **Add logging**: Log all external API interactions
5. **Handle errors gracefully**: Return detailed error info for debugging

## Contact & Support

If you encounter issues with Twilio integration:
1. Check this document first
2. Verify environment variables are set
3. Check backend logs for detailed error messages
4. Ensure you're running v1.9.2+ of the app

---
*Last Updated: August 21, 2025*
*Fixed in: Backend v1.0.3, Frontend v1.9.2*
