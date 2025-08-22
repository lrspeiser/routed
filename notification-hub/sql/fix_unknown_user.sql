-- Fix for removing "unknown" users (users with null phone/email) from channel subscriptions
-- This happens when a user is created without contact information during development

-- First, identify users with no contact info subscribed to channels
SELECT 
  u.id as user_id,
  u.phone,
  u.email,
  c.short_id as channel_short_id,
  c.name as channel_name
FROM users u
JOIN subscriptions s ON s.user_id = u.id
JOIN topics t ON t.id = s.topic_id
JOIN channels c ON c.topic_id = t.id
WHERE u.phone IS NULL AND u.email IS NULL;

-- Remove subscriptions for users with no contact info
-- (Uncomment and run if needed)
-- DELETE FROM subscriptions 
-- WHERE user_id IN (
--   SELECT id FROM users 
--   WHERE phone IS NULL AND email IS NULL
-- );

-- Alternative: Update the user with a phone number if you know it
-- UPDATE users 
-- SET phone = '+1234567890' 
-- WHERE id = '15c8bd4c-42ca-4630-876f-6312d17ba202';
