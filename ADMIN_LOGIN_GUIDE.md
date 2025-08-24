# Admin Login Guide - Routed App

## Admin Test Results ✅

Successfully tested the complete admin flow:
1. **Channel Creation**: Created "Admin Test" channel
2. **User Subscription**: Admin user (+16505551212) subscribed
3. **Message Delivery**: "Test 123" message sent and delivered
4. **WebSocket**: Real-time connection established

## Admin Login Without Twilio Verification

The app now includes an admin bypass mode for testing without SMS verification.

### How to Login as Admin:

1. **Open the Routed App**
   - Install the DMG from: `receiver-app/dist/Routed-1.9.9-mac-arm64.dmg`
   - Launch Routed from Applications

2. **Enter Admin Phone Number**
   - When prompted for phone verification, enter one of:
     - `+16505551212`
     - `6505551212`
     - `+1 650 555 1212`

3. **Use Admin Code**
   - The app will display: "Admin mode activated - Enter code: ADMIN"
   - Enter verification code: `ADMIN` (case-insensitive)

4. **Admin Access Granted**
   - You'll be logged in as the admin user
   - Full access to all channels and features
   - Can create channels, send messages, manage subscribers

### Test Channel Details:
- **Channel Name**: Admin Test
- **Channel ID**: Generated dynamically (e.g., `75hkus`)
- **Admin Phone**: +16505551212
- **Test Message**: "Test 123"

### Backend Test Results:
```bash
# Run the admin channel flow test:
node test-admin-channel-flow.js

# Output:
✅ Admin developer provisioned
   - API Key: 00d1w4u44u2q9bi0kjzc8ys7
✅ Channel "Admin Test" created
✅ Admin user subscribed
✅ Message "Test 123" sent successfully
✅ WebSocket connected for real-time delivery
```

### Technical Implementation:

**Frontend (renderer.html)**:
- Detects admin phone number
- Shows "ADMIN" code prompt instead of SMS
- Calls `verify:admin` IPC handler

**Backend (main.js)**:
- `verify:admin` handler provisions admin sandbox
- Sets verified phone without Twilio
- Establishes WebSocket connection
- Returns valid session

### Security Note:
This admin bypass is for **development and testing only**. In production:
- Remove or disable the admin bypass code
- Use environment variables to control bypass availability
- Implement proper authentication for admin access

### Troubleshooting:

If admin login fails:
1. Check the app logs at `~/Library/Logs/routed.log`
2. Ensure the hub is accessible at `https://routed.onrender.com`
3. Verify the admin token is correct: `33925b5f5b9a2bd3d5a01f2b5857ce73`
4. Try logging out first, then logging in again with admin credentials

### Testing Create Channel Button:

Once logged in as admin:
1. Click "Create Channel" button
2. Enter channel name: "Admin Test"
3. Set as private channel
4. Click Submit
5. Verify channel appears in list
6. Click on channel to send messages
7. Messages will be delivered to all subscribers

The admin bypass ensures you can test all functionality without needing actual SMS verification!