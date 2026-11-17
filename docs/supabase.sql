-- The song bank's table in Supabase (run once in the project's SQL Editor). See docs/supabase.md
-- and the layout in DATABASE.md: one row per song, the whole song as the app sent it in song_data
-- (charts, best scores, favourite...), its title, artist and date beside it, and its place in the
-- bank (sort_key, newest first).

create table if not exists public.songs (
  id         text primary key,
  title      text not null default '',
  artist     text not null default '',
  created_at timestamptz,
  song_data  jsonb not null,
  sort_key   bigint not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists songs_sort_key on public.songs (sort_key desc);

-- Row Level Security on, with no policies: nobody but the server's secret (service) key can read
-- or write. The browser never talks to Supabase.
alter table public.songs enable row level security;
