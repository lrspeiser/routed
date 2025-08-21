# Dev ID Management Documentation

## Overview

The `dev_id` (Developer ID) is a unique identifier assigned to each user for integration with developer tools and external services. This document outlines how dev_id is managed throughout the authentication and user lifecycle.

## Purpose

The dev_id serves as a stable, unique identifier for users that:
- Persists across authentication sessions
- Can be used by external developer tools
- Provides a non-phone-based identifier for privacy
- Enables tracking and analytics without exposing PII

## Database Schema

```sql
-- Column definition in users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS dev_id TEXT NOT NULL DEFAULT gen_random_uuid();
```

The dev_id column:
- Type: TEXT (stores UUID v4)
- Not nullable
- Has a default value of a generated UUID
- Unique per user

## Implementation Details

### 1. First-Time User Verification (`/v1/verify/check`)

When a new user completes phone verification for the first time:

```typescript
// New user - create with dev_id and verified timestamp
devId = uuidv4();
u = await c.query(
  `insert into users (tenant_id, phone, phone_verified_at, dev_id) 
   values ($1,$2, now(), $3) 
   returning id, phone_verified_at, dev_id`, 
  [tenantId, phone, devId]
);
```

**Key Points:**
- A new UUID v4 is generated for dev_id
- The dev_id is created atomically with the user record
- The dev_id is returned in the API response

### 2. Returning User Verification (`/v1/verify/check`)

When an existing user goes through verification again:

```typescript
// Existing user - ensure dev_id exists
if (!devId) {
  devId = uuidv4();
  await c.query(`update users set dev_id=$1 where id=$2`, [devId, userId]);
}
```

**Key Points:**
- Checks if user already has a dev_id
- If missing (legacy user), generates and saves a new one
- Always returns the dev_id in the response

### 3. Authentication Completion (`/auth/complete-sms`)

When a verified user completes authentication:

```typescript
// Ensure dev_id exists for backwards compatibility
if (!user.dev_id) {
  user.dev_id = uuidv4();
  await client.query(`update users set dev_id=$1 where id=$2`, [user.dev_id, user.id]);
  fastify.log.info(`Generated new dev_id for user ${user.id}: ${user.dev_id}`);
}
```

**Key Points:**
- Double-checks dev_id existence
- Generates one if missing (safety net for edge cases)
- Includes dev_id in the authentication response

## API Response Format

All authentication-related endpoints return the dev_id:

### `/v1/verify/check` Response
```json
{
  "ok": true,
  "tenantId": "uuid",
  "userId": "uuid",
  "devId": "uuid",  // <-- Developer ID
  "phone": "+1234567890"
}
```

### `/auth/complete-sms` Response
```json
{
  "user": {
    "id": "uuid",
    "phone": "+1234567890",
    "devId": "uuid"  // <-- Developer ID
  },
  "deviceId": "uuid",
  "accessToken": "jwt",
  "refreshToken": "token"
}
```

## Client Implementation Guidelines

### Storing Dev ID

Clients should:
1. Extract `devId` from authentication responses
2. Store it securely in local storage or keychain
3. Include it in analytics/telemetry if needed
4. Use it for developer tool integrations

### Example Client Code

```javascript
// After successful verification
const verifyResponse = await fetch('/v1/verify/check', {
  method: 'POST',
  body: JSON.stringify({ phone, code })
});
const { devId } = await verifyResponse.json();

// Store for later use
localStorage.setItem('userDevId', devId);

// After authentication completion
const authResponse = await fetch('/auth/complete-sms', {
  method: 'POST',
  body: JSON.stringify({ phone, deviceName })
});
const { user } = await authResponse.json();

// Update stored dev ID
localStorage.setItem('userDevId', user.devId);
```

## Migration and Backwards Compatibility

### For Existing Users Without dev_id

The system handles legacy users gracefully:

1. **Database Default**: The column has a default value, so any direct inserts get a UUID automatically
2. **Runtime Generation**: Code checks and generates dev_id if missing
3. **Logging**: Generation of new dev_ids is logged for monitoring

### Migration Status Monitoring

To check for users without dev_id:

```sql
-- Find users without dev_id (should be none after migration)
SELECT COUNT(*) FROM users WHERE dev_id IS NULL;

-- Find users with default-generated dev_ids
SELECT COUNT(*) FROM users WHERE dev_id = gen_random_uuid();
```

## Troubleshooting

### Common Issues

1. **Missing dev_id in response**
   - Check that backend is running latest code
   - Verify database migration has been applied
   - Check server logs for generation messages

2. **dev_id changes between sessions**
   - Should never happen for same phone number
   - Check if client is properly storing the value
   - Verify tenant consistency ('system' tenant)

3. **Database constraint violations**
   - Ensure migration script has run
   - Check for NULL values in dev_id column
   - Verify UUID generation is working

### Debug Queries

```sql
-- Check specific user's dev_id
SELECT id, phone, dev_id, created_at, phone_verified_at 
FROM users 
WHERE phone = '+1234567890';

-- Find recently generated dev_ids
SELECT id, phone, dev_id, created_at 
FROM users 
WHERE created_at > NOW() - INTERVAL '1 day'
ORDER BY created_at DESC;

-- Verify all users have dev_ids
SELECT COUNT(*) as total_users,
       COUNT(dev_id) as users_with_dev_id,
       COUNT(*) - COUNT(dev_id) as users_missing_dev_id
FROM users;
```

## Security Considerations

1. **Privacy**: dev_id reveals no personal information
2. **Uniqueness**: UUID v4 provides sufficient entropy
3. **Immutability**: Once assigned, dev_id should never change for a user
4. **No External Dependencies**: Generated locally, no external service calls

## Testing Checklist

- [ ] New user registration creates dev_id
- [ ] Existing user login preserves dev_id
- [ ] Legacy user without dev_id gets one generated
- [ ] dev_id is returned in all auth responses
- [ ] dev_id persists across multiple sessions
- [ ] dev_id is same across different devices for same phone

## Related Documentation

- [TWILIO_INTEGRATION_FIXES.md](./TWILIO_INTEGRATION_FIXES.md) - Twilio verification flow
- [Database Migrations](./sql/) - Schema changes
- [API Documentation](./docs/api.md) - Full API reference
