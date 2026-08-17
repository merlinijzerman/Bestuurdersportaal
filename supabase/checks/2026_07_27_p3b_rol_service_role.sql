-- ============================================================================
-- Verificatie P3-B — rol zetten via het service-role-pad (besluit 0082, B-4).
-- ----------------------------------------------------------------------------
-- WAAROM EEN CHECK-SCRIPT: het rol-pad van P3-B leunt op DB-invarianten die niet
-- via het tsx-sanity-pad te bewijzen zijn. `auth.admin.createUser` laat de
-- trigger maak_profiel() een profiel op 'bestuurder' maken; een service-role-
-- update zet daarna een hogere rol. Dat werkt ALLEEN doordat:
--   1. de bevriezing-trigger trg_profiel_bevries_kolommen de service-role
--      (auth.uid() IS NULL) vrijlaat — anders zou de rol niet te zetten zijn;
--   2. de profielen.rol-CHECK een ongeldige rolwaarde hard weigert (P3B-4).
-- In de Supabase SQL-editor is auth.uid() NULL (geen JWT-claim), dus een kale
-- UPDATE hier simuleert exact het service-role-pad.
--
-- Plak dit als geheel in de SQL-editor NADAT de basis-migraties zijn gedraaid.
-- Alles staat binnen één begin;…rollback; — non-destructief, laat niets achter.
--
-- DEKT (werkopdracht P3-B §9):
--   • B-4-pad   : service-role kan rol 'voorzitter'/'beheerder' zetten;
--   • P3B-4     : ongeldige rolwaarde → exception (whitelist-CHECK), rol ongewijzigd;
--   • invariant : de bevriezing-trigger blokkeert de service-role NIET.
-- ============================================================================

begin;

do $$
declare
  v_fonds uuid;
  v_user  uuid;
  v_rol   text;
  v_faal  boolean;
begin
  insert into public.fondsen (naam, slug)
  values ('CHECK Testfonds P3B', 'check-testfonds-p3b-' || gen_random_uuid())
  returning id into v_fonds;

  -- Profiel ontstaat op 'bestuurder' via de trigger (metadata zonder rol, B-4).
  v_user := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'p3b@example.test',
          jsonb_build_object('naam', 'P3B Bestuurder', 'fonds_id', v_fonds::text));

  select rol into v_rol from public.profielen where id = v_user;
  assert v_rol = 'bestuurder', 'Setup: nieuw profiel hoort op default bestuurder te staan';

  -- ── B-4: service-role zet een hogere rol (bevriezing-trigger laat dit toe) ──
  update public.profielen set rol = 'voorzitter' where id = v_user and fonds_id = v_fonds;
  select rol into v_rol from public.profielen where id = v_user;
  assert v_rol = 'voorzitter', 'B-4: service-role moet rol voorzitter kunnen zetten';

  update public.profielen set rol = 'beheerder' where id = v_user and fonds_id = v_fonds;
  select rol into v_rol from public.profielen where id = v_user;
  assert v_rol = 'beheerder', 'B-4: service-role moet rol beheerder kunnen zetten';
  raise notice 'B-4 OK — service-role kan voorzitter/beheerder zetten (bevriezing laat vrij)';

  -- ── P3B-4: ongeldige rolwaarde → exception (whitelist-CHECK), rol ongewijzigd ──
  v_faal := false;
  begin
    update public.profielen set rol = 'beheerder-plus' where id = v_user;
  exception when others then
    v_faal := true;
  end;
  assert v_faal, 'P3B-4: ongeldige rolwaarde moet door de CHECK worden geweigerd';
  select rol into v_rol from public.profielen where id = v_user;
  assert v_rol = 'beheerder', 'P3B-4: rol mag na de geweigerde update ongewijzigd zijn';
  raise notice 'P3B-4 OK — ongeldige rol geweigerd door profielen.rol-CHECK, rol ongewijzigd';

  raise notice 'ALLE P3-B ROL-CHECKS GESLAAGD';
end $$;

rollback;
