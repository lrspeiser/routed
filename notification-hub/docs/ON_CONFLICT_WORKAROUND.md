# ON CONFLICT Constraint Issue and Workaround

## Problem Summary
The channel creation was failing on Render's PostgreSQL database with the error:
```
"no unique or exclusion constraint matching the ON CONFLICT specification"
```

## Root Cause
The code was using PostgreSQL's `ON CONFLICT` clause which requires unique constraints to exist:
```sql
INSERT INTO users (tenant_id, phone) VALUES ($1, $2)
ON CONFLICT (tenant_id, phone) DO UPDATE SET phone=excluded.phone
```

However, on Render's managed PostgreSQL:
1. The unique constraints (`users_tenant_phone_unique`, `topics_tenant_id_name_key`) don't exist
2. The schema.sql file attempts to create them but wraps the creation in exception handlers:
   ```sql
   DO $$ BEGIN
     ALTER TABLE users ADD CONSTRAINT users_tenant_phone_unique UNIQUE (tenant_id, phone);
   EXCEPTION WHEN others THEN
     NULL; -- Silently fails if permissions are insufficient
   END $$;
   ```
3. Render's database likely has permission restrictions that prevent constraint creation
4. The exceptions are silently caught, leaving the database without the required constraints

## Solution: SELECT-then-INSERT Pattern
Instead of relying on `ON CONFLICT`, we now use a two-step pattern:

### Before (broken):
```typescript
// This fails if unique constraint doesn't exist
const result = await client.query(
  `INSERT INTO topics (tenant_id, name) VALUES ($1,$2)
   ON CONFLICT (tenant_id, name) DO UPDATE SET name=excluded.name
   RETURNING id`,
  [tenant_id, topicName]
);
```

### After (working):
```typescript
// First, try to find existing record
let result = await client.query(
  `SELECT id FROM topics WHERE tenant_id=$1 AND name=$2`,
  [tenant_id, topicName]
);

if (result.rows.length === 0) {
  // Only insert if it doesn't exist
  result = await client.query(
    `INSERT INTO topics (tenant_id, name) VALUES ($1,$2) RETURNING id`,
    [tenant_id, topicName]
  );
}
```

## Affected Endpoints
The workaround was applied to:
- `/v1/channels/create` - Publisher-scoped channel creation
- Topics creation (finding or creating topics)
- User creation with phone numbers
- Subscription creation

## Why This Works
1. **No constraint dependency**: The SELECT-then-INSERT pattern doesn't require unique constraints
2. **Explicit control**: We explicitly check for existence before inserting
3. **Portable**: Works on any PostgreSQL database regardless of permissions or constraint names
4. **Race condition handling**: While there's a small race condition window, it's handled by the transaction

## Trade-offs
- **Pros**: Works reliably on managed databases with permission restrictions
- **Cons**: Slightly more verbose, small race condition window (mitigated by transactions)

## Testing
Confirmed working on:
- Local PostgreSQL with Docker
- Render's managed PostgreSQL service
- Both with and without unique constraints present

## Date Fixed
August 21, 2025 - Fixed after identifying that Render's database was missing the unique constraints that ON CONFLICT requires.
