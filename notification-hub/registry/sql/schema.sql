create table if not exists registry_hosts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  base_url text,
  vapid_public text,
  host_token text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
