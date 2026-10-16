create schema if not exists private;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  timezone text not null default 'UTC',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  user_id uuid unique references auth.users (id) on delete set null,
  email text not null,
  display_name text not null default '',
  added_by uuid not null references auth.users (id),
  added_at timestamptz not null default now(),
  constraint family_members_email_format check (email = lower(trim(email)) and email like '%@%'),
  constraint family_members_family_email_key unique (family_id, email)
);

create unique index family_members_one_family_per_email
  on public.family_members (email);
create index family_members_family_id_idx on public.family_members (family_id);
create index family_members_user_id_idx on public.family_members (user_id);

create table public.cats (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  color text not null default '#D494B7',
  photo_path text,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index cats_family_id_idx on public.cats (family_id) where archived_at is null;

create table public.target_rules (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  cat_id uuid not null references public.cats (id) on delete cascade,
  metric text not null check (metric in ('treats', 'kibble', 'wet_food', 'teeth_pawing', 'fountain', 'poop', 'pee', 'ear_cleaning', 'play')),
  cadence text not null check (cadence in ('daily', 'weekly')),
  target_amount numeric(10, 2) not null check (target_amount > 0),
  unit text not null default 'times',
  effective_from date not null default current_date,
  effective_until date,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_until is null or effective_until >= effective_from),
  constraint target_rules_cat_metric_cadence_from_key unique (cat_id, metric, cadence, effective_from)
);
create index target_rules_family_cat_idx on public.target_rules (family_id, cat_id, metric, cadence);

create table public.care_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  cat_id uuid not null references public.cats (id) on delete cascade,
  actor_user_id uuid not null default auth.uid() references auth.users (id),
  metric text not null check (metric in ('treats', 'kibble', 'wet_food', 'teeth_pawing', 'fountain', 'poop', 'pee', 'ear_cleaning', 'play')),
  amount_delta numeric(10, 2) not null check (amount_delta <> 0),
  unit text not null default 'times',
  detail text not null default '',
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  reverses_event_id uuid references public.care_events (id),
  constraint care_events_family_cat_key unique (id, family_id, cat_id)
);
create index care_events_cat_occurred_idx on public.care_events (cat_id, occurred_at desc);
create index care_events_family_occurred_idx on public.care_events (family_id, occurred_at desc);
create index care_events_cat_metric_occurred_idx on public.care_events (cat_id, metric, occurred_at desc);

create or replace function private.is_family_member(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.family_members fm
    where fm.family_id = p_family_id
      and fm.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_family_member(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_family_member(uuid) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(coalesce(new.email, ''), '@', 1),
    'Family member'
  );

  insert into public.profiles (id, display_name)
  values (new.id, v_name)
  on conflict (id) do update set display_name = excluded.display_name, updated_at = now();

  if new.email is not null then
    update public.family_members
    set user_id = new.id
    where email = lower(trim(new.email))
      and user_id is null;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.create_family(p_name text, p_timezone text)
returns public.families
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_email text := lower(trim(coalesce((select auth.jwt() ->> 'email'), '')));
  v_display_name text;
  v_family public.families;
begin
  if v_user_id is null or v_email = '' then
    raise exception 'Sign in before creating a family';
  end if;
  if exists (select 1 from public.family_members where user_id = v_user_id or email = v_email) then
    raise exception 'This account already belongs to a family';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Choose a valid device timezone';
  end if;

  select coalesce(nullif(display_name, ''), split_part(v_email, '@', 1))
  into v_display_name from public.profiles where id = v_user_id;

  insert into public.families (name, timezone, created_by)
  values (trim(p_name), p_timezone, v_user_id)
  returning * into v_family;

  insert into public.family_members (family_id, user_id, email, display_name, added_by)
  values (v_family.id, v_user_id, v_email, coalesce(v_display_name, ''), v_user_id);

  return v_family;
end;
$$;

revoke all on function public.create_family(text, text) from public, anon;
grant execute on function public.create_family(text, text) to authenticated;

create or replace function public.add_family_member(p_family_id uuid, p_email text, p_display_name text default '')
returns public.family_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_email text := lower(trim(p_email));
  v_existing_user uuid;
  v_member public.family_members;
begin
  if v_user_id is null or not private.is_family_member(p_family_id) then
    raise exception 'You must be a family member to add someone';
  end if;
  if v_email = '' or position('@' in v_email) < 2 then
    raise exception 'Enter a valid email address';
  end if;
  if exists (select 1 from public.family_members where email = v_email) then
    raise exception 'That email is already connected to a family';
  end if;

  select id into v_existing_user from auth.users where lower(email) = v_email limit 1;
  insert into public.family_members (family_id, user_id, email, display_name, added_by)
  values (p_family_id, v_existing_user, v_email, trim(coalesce(p_display_name, '')), v_user_id)
  returning * into v_member;
  return v_member;
end;
$$;

revoke all on function public.add_family_member(uuid, text, text) from public, anon;
grant execute on function public.add_family_member(uuid, text, text) to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.validate_family_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Choose a valid IANA timezone';
  end if;
  return new;
end;
$$;

create trigger families_validate_timezone before insert or update of timezone on public.families
  for each row execute function public.validate_family_timezone();

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger families_set_updated_at before update on public.families
  for each row execute function public.set_updated_at();
create trigger cats_set_updated_at before update on public.cats
  for each row execute function public.set_updated_at();
create trigger target_rules_set_updated_at before update on public.target_rules
  for each row execute function public.set_updated_at();

create or replace function public.validate_family_child()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.cats c
    where c.id = new.cat_id and c.family_id = new.family_id
  ) then
    raise exception 'Cat must belong to the same family';
  end if;
  return new;
end;
$$;

create trigger target_rules_validate_family before insert or update of family_id, cat_id on public.target_rules
  for each row execute function public.validate_family_child();
create trigger care_events_validate_family before insert or update of family_id, cat_id on public.care_events
  for each row execute function public.validate_family_child();

create or replace function public.seed_cat_targets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.target_rules (family_id, cat_id, metric, cadence, target_amount, unit, created_by)
  values
    (new.family_id, new.id, 'treats', 'daily', 4, 'treats', new.created_by),
    (new.family_id, new.id, 'kibble', 'daily', 3, 'spoons', new.created_by),
    (new.family_id, new.id, 'wet_food', 'daily', 1, 'cans', new.created_by);
  return new;
end;
$$;

create trigger cats_seed_default_targets after insert on public.cats
  for each row execute function public.seed_cat_targets();

alter table public.profiles enable row level security;
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.cats enable row level security;
alter table public.target_rules enable row level security;
alter table public.care_events enable row level security;

revoke all on public.profiles, public.families, public.family_members, public.cats, public.target_rules, public.care_events from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, update on public.families to authenticated;
grant select on public.family_members to authenticated;
grant select, insert, update, delete on public.cats, public.target_rules to authenticated;
grant select, insert on public.care_events to authenticated;

create policy "profiles read by self or family members" on public.profiles
  for select to authenticated using (
    id = (select auth.uid()) or exists (
      select 1 from public.family_members fm
      where fm.user_id = profiles.id and private.is_family_member(fm.family_id)
    )
  );
create policy "users update own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "family members read family" on public.families
  for select to authenticated using (private.is_family_member(id));
create policy "family members edit family" on public.families
  for update to authenticated using (private.is_family_member(id)) with check (private.is_family_member(id));

create policy "family members read member list" on public.family_members
  for select to authenticated using (private.is_family_member(family_id));

create policy "family members read cats" on public.cats
  for select to authenticated using (private.is_family_member(family_id));
create policy "family members add cats" on public.cats
  for insert to authenticated with check (private.is_family_member(family_id) and created_by = (select auth.uid()));
create policy "family members edit cats" on public.cats
  for update to authenticated using (private.is_family_member(family_id)) with check (private.is_family_member(family_id));
create policy "family members remove cats" on public.cats
  for delete to authenticated using (private.is_family_member(family_id));

create policy "family members read targets" on public.target_rules
  for select to authenticated using (private.is_family_member(family_id));
create policy "family members add targets" on public.target_rules
  for insert to authenticated with check (private.is_family_member(family_id) and created_by = (select auth.uid()));
create policy "family members edit targets" on public.target_rules
  for update to authenticated using (private.is_family_member(family_id)) with check (private.is_family_member(family_id));
create policy "family members remove targets" on public.target_rules
  for delete to authenticated using (private.is_family_member(family_id));

create policy "family members read care events" on public.care_events
  for select to authenticated using (private.is_family_member(family_id));
create policy "members record care as themselves" on public.care_events
  for insert to authenticated with check (
    private.is_family_member(family_id)
    and actor_user_id = (select auth.uid())
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cat-photos', 'cat-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "family members view cat photos" on storage.objects
  for select to authenticated using (
    bucket_id = 'cat-photos'
    and private.is_family_member((storage.foldername(name))[1]::uuid)
  );
create policy "family members upload cat photos" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'cat-photos'
    and private.is_family_member((storage.foldername(name))[1]::uuid)
  );
create policy "family members update cat photos" on storage.objects
  for update to authenticated using (
    bucket_id = 'cat-photos'
    and private.is_family_member((storage.foldername(name))[1]::uuid)
  ) with check (
    bucket_id = 'cat-photos'
    and private.is_family_member((storage.foldername(name))[1]::uuid)
  );
create policy "family members delete cat photos" on storage.objects
  for delete to authenticated using (
    bucket_id = 'cat-photos'
    and private.is_family_member((storage.foldername(name))[1]::uuid)
  );

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'families') then
    alter publication supabase_realtime add table public.families;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'care_events') then
    alter publication supabase_realtime add table public.care_events;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cats') then
    alter publication supabase_realtime add table public.cats;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'target_rules') then
    alter publication supabase_realtime add table public.target_rules;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'family_members') then
    alter publication supabase_realtime add table public.family_members;
  end if;
end;
$$;
