create or replace function public.remove_family_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family_id uuid;
  v_member_user_id uuid;
begin
  select family_id, user_id
  into v_family_id, v_member_user_id
  from public.family_members
  where id = p_member_id;

  if v_family_id is null then
    raise exception 'Family member not found';
  end if;
  if not private.is_family_member(v_family_id) then
    raise exception 'You must belong to this family to remove a person';
  end if;
  if v_member_user_id = (select auth.uid()) then
    raise exception 'You cannot remove your own family access';
  end if;

  delete from public.family_members where id = p_member_id;
end;
$$;

revoke all on function public.remove_family_member(uuid) from public, anon;
grant execute on function public.remove_family_member(uuid) to authenticated;

alter table public.family_members replica identity full;
