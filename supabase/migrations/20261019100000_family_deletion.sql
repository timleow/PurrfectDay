create or replace function public.assert_family_delete_allowed(p_family_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_family_member(p_family_id) then
    raise exception 'You must belong to this family to delete it';
  end if;
end;
$$;

revoke all on function public.assert_family_delete_allowed(uuid) from public, anon;
grant execute on function public.assert_family_delete_allowed(uuid) to authenticated;

create or replace function public.delete_family(p_family_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_family_member(p_family_id) then
    raise exception 'You must belong to this family to delete it';
  end if;

  delete from public.families where id = p_family_id;
end;
$$;

revoke all on function public.delete_family(uuid) from public, anon;
grant execute on function public.delete_family(uuid) to authenticated;
