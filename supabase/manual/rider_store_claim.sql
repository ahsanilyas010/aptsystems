-- Rider adds a store that already exists -> grant the rider access to the existing store
-- instead of creating a duplicate.
--
-- Why this is needed (APT CRM Supabase project):
--   * A rider only sees stores where  created_by = auth.uid()  OR  a store_assignments row exists
--     for them ("rider reads accessible stores" policy).
--   * Riders can't write store_assignments (admin-only), so a rider can't grant themselves access.
--   * So when a rider re-adds a store that someone else created, they would otherwise end up with a
--     duplicate store, and still can't see the original.
--
-- What it does: BEFORE INSERT on public.stores. When the inserting user is a rider (not an admin)
-- and an existing store matches, it adds a store_assignments row for that rider and skips the
-- insert (RETURN NULL) so no duplicate is created. The rider can then see the existing store.
--
-- "Matches" = same name once case/spaces/punctuation are ignored (HBK = H.B.K = h b k)
--             AND (same area ignoring case/punctuation  OR  same phone, last 10 digits).
-- It is deliberately stricter than the CRM's manual "similar stores" review: this runs
-- automatically with nobody reviewing it, so two branches with the same name in different areas
-- and different phones are still created as separate stores.
--
-- Idempotent: safe to run more than once. Apply in the Supabase SQL editor for the APT CRM project.
-- Rollback:  drop trigger stores_claim_existing on public.stores;

create or replace function public.norm_alnum(t text)
returns text language sql immutable as $$
  select lower(regexp_replace(coalesce(t, ''), '[^a-zA-Z0-9]+', '', 'g'))
$$;

create or replace function public.phone_tail(t text)
returns text language sql immutable as $$
  select right(regexp_replace(coalesce(t, ''), '\D', '', 'g'), 10)
$$;

create or replace function public.stores_claim_existing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_id uuid;
begin
  -- Only riders adding a store themselves. Inserts without a creator (CRM/service role) and
  -- admins always create the store they asked for.
  if NEW.created_by is null or public.has_role(NEW.created_by, 'admin'::app_role) then
    return NEW;
  end if;
  if length(public.norm_alnum(NEW.name)) < 2 then
    return NEW;
  end if;

  select s.id into existing_id
  from public.stores s
  where public.norm_alnum(s.name) = public.norm_alnum(NEW.name)
    and (
      (public.norm_alnum(NEW.area) <> '' and public.norm_alnum(s.area) = public.norm_alnum(NEW.area))
      or (length(public.phone_tail(NEW.mobile)) = 10 and public.phone_tail(s.mobile) = public.phone_tail(NEW.mobile))
    )
  order by s.created_at
  limit 1;

  if existing_id is null then
    return NEW;
  end if;

  insert into public.store_assignments (rider_id, store_id, assigned_by)
  select NEW.created_by, existing_id, NEW.created_by
  where not exists (
    select 1 from public.store_assignments sa
    where sa.rider_id = NEW.created_by and sa.store_id = existing_id
  );

  return null; -- skip the insert: the rider now has access to the existing store
end;
$$;

drop trigger if exists stores_claim_existing on public.stores;
create trigger stores_claim_existing
  before insert on public.stores
  for each row execute function public.stores_claim_existing();
