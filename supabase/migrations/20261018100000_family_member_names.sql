update public.family_members as member
set display_name = coalesce(
  nullif(trim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
  nullif(trim(auth_user.raw_user_meta_data ->> 'name'), ''),
  split_part(member.email, '@', 1)
)
from auth.users as auth_user
where member.user_id = auth_user.id
  and (trim(member.display_name) = '' or member.display_name = split_part(member.email, '@', 1));

create or replace function public.sync_family_member_name_from_auth()
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

  update public.family_members
  set display_name = v_name
  where user_id = new.id
    and (trim(display_name) = '' or display_name = split_part(email, '@', 1));

  return new;
end;
$$;

revoke all on function public.sync_family_member_name_from_auth() from public, anon, authenticated;

drop trigger if exists sync_family_member_name_on_auth_user_create on auth.users;
create trigger sync_family_member_name_on_auth_user_create
  after insert on auth.users
  for each row execute function public.sync_family_member_name_from_auth();

drop trigger if exists sync_family_member_name_on_metadata_update on auth.users;
create trigger sync_family_member_name_on_metadata_update
  after update of raw_user_meta_data on auth.users
  for each row execute function public.sync_family_member_name_from_auth();

create or replace function public.fill_family_member_name_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if new.user_id is null or (trim(new.display_name) <> '' and new.display_name <> split_part(new.email, '@', 1)) then
    return new;
  end if;
  select coalesce(
    nullif(trim(raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(raw_user_meta_data ->> 'name'), ''),
    split_part(new.email, '@', 1)
  ) into v_name
  from auth.users
  where id = new.user_id;
  new.display_name := coalesce(v_name, split_part(new.email, '@', 1));
  return new;
end;
$$;

revoke all on function public.fill_family_member_name_from_auth() from public, anon, authenticated;
drop trigger if exists fill_family_member_name_before_save on public.family_members;
create trigger fill_family_member_name_before_save
  before insert or update of user_id on public.family_members
  for each row execute function public.fill_family_member_name_from_auth();

create or replace function public.update_family_member_display_name(p_member_id uuid, p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family_id uuid;
  v_display_name text := trim(coalesce(p_display_name, ''));
begin
  select family_id into v_family_id
  from public.family_members
  where id = p_member_id;

  if v_family_id is null or not private.is_family_member(v_family_id) then
    raise exception 'You must belong to this family to edit member names';
  end if;
  if v_display_name = '' or char_length(v_display_name) > 60 then
    raise exception 'Enter a name between 1 and 60 characters';
  end if;

  update public.family_members
  set display_name = v_display_name
  where id = p_member_id;
end;
$$;

revoke all on function public.update_family_member_display_name(uuid, text) from public, anon;
grant execute on function public.update_family_member_display_name(uuid, text) to authenticated;

alter table public.family_members replica identity full;
