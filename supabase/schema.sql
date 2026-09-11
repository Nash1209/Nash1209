-- FX Lot Calculator — Supabase schema
-- Supabase ダッシュボード → SQL Editor に貼り付けて実行する。
--
-- Auth 側の設定（Authentication → Providers → Email）:
--   * Confirm email: ON（メール認証）
--   * Minimum password length: 8
--   * Site URL / Redirect URLs に公開URL（例 https://nash1209.vercel.app）を登録

-- 1. プロフィール（メルマガ許諾など、auth.users に紐づく公開情報）
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  newsletter_opt_in boolean not null default false,
  newsletter_opted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- 登録時に raw_user_meta_data.newsletter_opt_in を profiles に写す
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, newsletter_opt_in, newsletter_opted_at)
  values (
    new.id,
    new.email,
    coalesce((new.raw_user_meta_data ->> 'newsletter_opt_in')::boolean, false),
    case when coalesce((new.raw_user_meta_data ->> 'newsletter_opt_in')::boolean, false) then now() else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2. アプリの状態（設定・保有・記録・レート）をユーザーごとに JSON で保持
create table if not exists public.user_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.user_state enable row level security;

drop policy if exists "user_state: own rows" on public.user_state;
create policy "user_state: own rows" on public.user_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists user_state_user_idx on public.user_state (user_id);
