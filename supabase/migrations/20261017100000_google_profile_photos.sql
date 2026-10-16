alter table public.profiles
  add column if not exists avatar_url text;

update public.profiles as profile
set avatar_url = coalesce(
  nullif(auth_user.raw_user_meta_data ->> 'picture', ''),
  nullif(auth_user.raw_user_meta_data ->> 'avatar_url', '')
)
from auth.users as auth_user
where profile.id = auth_user.id
  and profile.avatar_url is distinct from coalesce(
    nullif(auth_user.raw_user_meta_data ->> 'picture', ''),
    nullif(auth_user.raw_user_meta_data ->> 'avatar_url', '')
  );

create or replace function public.sync_profile_avatar_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_avatar text;
begin
  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(coalesce(new.email, ''), '@', 1),
    'Family member'
  );
  v_avatar := coalesce(
    nullif(new.raw_user_meta_data ->> 'picture', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  );

  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, v_name, v_avatar)
  on conflict (id) do update
    set avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
        updated_at = now();

  return new;
end;
$$;

revoke all on function public.sync_profile_avatar_from_auth() from public, anon, authenticated;

drop trigger if exists sync_profile_avatar_on_auth_user_create on auth.users;
create trigger sync_profile_avatar_on_auth_user_create
  after insert on auth.users
  for each row execute function public.sync_profile_avatar_from_auth();

drop trigger if exists sync_profile_avatar_on_metadata_update on auth.users;
create trigger sync_profile_avatar_on_metadata_update
  after update of raw_user_meta_data on auth.users
  for each row execute function public.sync_profile_avatar_from_auth();
