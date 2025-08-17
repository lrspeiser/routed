-- Auth schema additions (device-bound rotating refresh tokens and user secrets)

-- Per-user API/LLM keys (encrypted at rest)
create table if not exists user_secrets (
  user_id uuid primary key references users(id) on delete cascade,
  default_openai_key_enc bytea not null,
  user_llm_key_enc bytea,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per installed device (auth context), separate from push devices
create table if not exists auth_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text,
  public_jwk jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

-- Rotating refresh tokens (families allow multi-device + revocation)
create table if not exists refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  device_id uuid not null references auth_devices(id) on delete cascade,
  family_id uuid not null,
  token_hash bytea not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  rotated_from uuid,
  used_once boolean not null default false,
  revoked_at timestamptz
);

create index if not exists refresh_tokens_user_device_idx on refresh_tokens (user_id, device_id);
create index if not exists refresh_tokens_family_idx on refresh_tokens (family_id);
create index if not exists refresh_tokens_expires_idx on refresh_tokens (expires_at);
