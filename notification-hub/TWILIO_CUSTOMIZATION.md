# Twilio Verify Message Customization

## Important Note
Twilio Verify service has **limited customization options** for the SMS message template. The verification messages are standardized for security and compliance reasons.

## What CAN be customized:
1. **Friendly Name**: Set in the Twilio Verify Service settings
   - This appears at the beginning of the message
   - Example: "Your Routed verification code is: 123456"
   - Set via Twilio Console or API when creating the service

2. **Code Length**: Can be 4-10 digits (default is 6)

3. **Code Validity**: How long the code remains valid (default 10 minutes)

## What CANNOT be customized:
- The full message template structure
- The phrase "verification code" or similar wording
- The overall format of the message

## To Update the Friendly Name:

### Via Twilio Console:
1. Log into Twilio Console
2. Navigate to Verify > Services
3. Click on your service
4. Update "Friendly Name" to "Routed"
5. Save changes

### Via API:
```bash
curl -X POST "https://verify.twilio.com/v2/Services/${SERVICE_SID}" \
  --data-urlencode "FriendlyName=Routed" \
  -u $TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN
```

## Current Message Format:
With Friendly Name set to "Routed", users will receive:
```
Your Routed verification code is: 123456
```

## Alternative: Programmable SMS
If you need fully custom messages, you would need to:
1. Switch from Twilio Verify to Programmable SMS
2. Implement your own code generation and validation logic
3. Handle rate limiting and security yourself
4. Store verification codes in your database

This is NOT recommended as Twilio Verify handles many security concerns automatically.
