-- Schema for notification hub

create extension if not exists pgcrypto;

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'free',
  created_at timestamptz not null default now()
);

create table if not exists publishers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  api_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists topics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  unique(tenant_id, name)
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

-- Ensure a single user per tenant/email
do $$ begin
  if not exists (
    select 1 from pg_indexes where schemaname = current_schema() and indexname = 'users_tenant_email_unique'
  ) then
    alter table users add constraint users_tenant_email_unique unique (tenant_id, email);
  end if;
exception when others then
  -- ignore if already exists or running on limited permissions
  null;
end $$;

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  topic_id uuid not null references topics(id) on delete cascade,
  wants_push boolean not null default true,
  wants_socket boolean not null default true,
  created_at timestamptz not null default now(),
  unique(user_id, topic_id)
);

-- Channels group a tenant's topic under a friendly name and short id
create table if not exists channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  topic_id uuid not null references topics(id) on delete cascade,
  name text not null,
  short_id text not null,
  allow_public boolean not null default false,
  created_at timestamptz not null default now(),
  unique(tenant_id, short_id)
);

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  token jsonb not null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  topic_id uuid not null references topics(id) on delete cascade,
  publisher_id uuid not null references publishers(id) on delete set null,
  title text not null,
  body text not null,
  payload jsonb,
  ttl_sec integer not null default 86400,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'queued',
  dedupe_key text,
  unique(tenant_id, dedupe_key)
);

create table if not exists deliveries (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  device_id uuid references devices(id) on delete set null,
  channel text not null,
  attempt integer not null default 0,
  status text not null default 'queued',
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists messages_expires_at_idx on messages (expires_at);
create index if not exists deliveries_status_idx on deliveries (status);
