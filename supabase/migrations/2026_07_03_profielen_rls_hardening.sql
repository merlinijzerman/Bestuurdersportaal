-- ============================================================================
-- Migratie 2026-07-03 — Security hardening: profielen-RLS (bevinding CR-K1)
-- ----------------------------------------------------------------------------
-- WAAROM: de policy "eigen profiel" (schema.sql §10, r.497–499) was FOR ALL met
-- alleen USING (auth.uid() = id) en zonder WITH CHECK. Bij een UPDATE werd
-- daardoor alleen getoetst wélke rij wordt gewijzigd, niet wat erin komt te
-- staan: fonds_id en rol waren zelf-muteerbaar. Beide kolommen sturen de
-- volledige autorisatie (tenant-isolatie sleutelt vrijwel overal op
-- profielen.fonds_id; rol ontgrendelt beheerfuncties in API-checks).
-- Bevinding CR-K1 uit de code review van 3 juli 2026 — zie BEVINDINGENLOG.md.
--
-- AANPAK (minimaal-invasief, app-gedrag blijft identiek):
--  1. FOR ALL-policy gesplitst in expliciete SELECT- en UPDATE-policies,
--     beide strikt eigen rij; UPDATE mét WITH CHECK. INSERT en DELETE
--     vervallen bewust: inserts lopen via de maak_profiel()-trigger
--     (draait als tabel-eigenaar), deletes via on delete cascade vanuit
--     auth.users.
--  2. BEFORE UPDATE-trigger bevriest fonds_id en rol voor zelfservice-
--     mutaties (auth.uid() = old.id). Service-role en tabel-eigenaar
--     (auth.uid() IS NULL) blijven ongemoeid, zodat back-office-beheer
--     mogelijk blijft. De trigger is een tweede slot naast WITH CHECK
--     (defense in depth, ook bestand tegen toekomstige policy-wijzigingen).
--
-- GECONTROLEERD (3 juli 2026): de app benadert profielen uitsluitend op de
-- eigen rij (alle .from("profielen")-queries gebruiken .eq("id", user.id));
-- RPC profiel_opslaan (security invoker) raakt rol/fonds_id niet aan.
-- Geen breaking change; geen code-deploy nodig.
--
-- Idempotent (drop if exists + create or replace).
-- ROLLBACK: 2026_07_03_profielen_rls_hardening_ROLLBACK.sql
-- ============================================================================

begin;

-- ── 1. Policy-split: SELECT en UPDATE, strikt eigen rij ─────────────────────
drop policy if exists "eigen profiel" on public.profielen;

drop policy if exists "profiel select eigen" on public.profielen;
create policy "profiel select eigen" on public.profielen
  for select using (auth.uid() = id);

drop policy if exists "profiel update eigen" on public.profielen;
create policy "profiel update eigen" on public.profielen
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ── 2. Kolombevriezing fonds_id + rol bij zelfservice-updates ───────────────
create or replace function public.fn_profiel_bevries_kolommen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Alleen zelfservice (ingelogde gebruiker wijzigt de eigen rij) wordt
  -- beperkt; service-role en tabel-eigenaar (auth.uid() IS NULL) blijven vrij.
  if auth.uid() is not null and auth.uid() = old.id and (
       new.fonds_id is distinct from old.fonds_id
    or new.rol      is distinct from old.rol
  ) then
    raise exception 'fonds_id en rol zijn niet via zelfservice te wijzigen'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiel_bevries_kolommen on public.profielen;
create trigger trg_profiel_bevries_kolommen
  before update on public.profielen
  for each row execute function public.fn_profiel_bevries_kolommen();

commit;

-- ── Verificatie (handmatig draaien ná de migratie) ──────────────────────────
-- 1. Policies aanwezig en correct gesplitst:
--      select policyname, cmd from pg_policies where tablename = 'profielen';
--    → verwacht: "profiel select eigen" (SELECT), "profiel update eigen"
--      (UPDATE); géén "eigen profiel" (ALL) meer.
-- 2. Als ingelogde tenant-gebruiker (SQL editor met impersonation of via app):
--      update public.profielen set naam = naam where id = auth.uid();
--        → slaagt (zelfbeheer blijft werken);
--      update public.profielen set rol = 'beheerder' where id = auth.uid();
--        → faalt met 42501 (kolom bevroren).
-- 3. Regressie: profielpagina opslaan in de app (RPC profiel_opslaan)
--    → slaagt ongewijzigd, inclusief profiel_log-regel.
