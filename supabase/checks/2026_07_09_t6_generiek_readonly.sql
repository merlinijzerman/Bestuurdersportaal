-- ============================================================================
-- T6 — Negatieve read-only-testsuite voor de generieke contentlaag.
-- ----------------------------------------------------------------------------
-- Doel: onder ÉCHTE RLS bewijzen dat een fondsgebruiker generieke content wél
-- kan LEZEN maar NIET kan muteren (INSERT/UPDATE/DELETE geweigerd), en dat de
-- namespace-invariant (generiek ⇒ fonds_id NULL) hard is afgedwongen. Elke
-- overtreding doet `raise exception` → psql exit-code <> 0 → CI faalt.
--
-- Getoetste scenario's (werkopdracht T6, acceptatiecriteria):
--   T6a — SELECT: fonds A leest een generiek document (read-only toegang OK).
--   T6b — INSERT: fonds A mag GEEN generiek document aanmaken (RLS weigert;
--         insert-policy forceert bibliotheek='fonds').
--   T6c — UPDATE: fonds A mag een bestaand generiek document NIET wijzigen.
--   T6d — DELETE: fonds A mag een generiek document NIET verwijderen.
--   T6e — Namespace-CHECK: een generiek document MET fonds_id wordt geweigerd
--         (documenten_generiek_namespace_check).
--
-- Self-seeding (1 fonds + 1 user via auth-trigger maak_profiel) + 1 generiek
-- document. Alles in één transactie met ROLLBACK — laat geen data achter.
-- Assertions toetsen op de SEED-id's, zodat echte data de uitkomst niet raakt.
--
-- Uitvoeren:  psql "$DB" -f dit-bestand
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed als tabel-eigenaar (RLS omzeild). Vaste UUID's voor de test. ────────
insert into public.fondsen (id, naam, slug)
values ('11111111-1111-1111-1111-111111111111', 'T6 Testfonds A', 't6-testfonds-a');

insert into auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','t6-a@test.local',
   '{"naam":"Test A","fonds_id":"11111111-1111-1111-1111-111111111111"}', now(), now());

do $$
begin
  if (select fonds_id from public.profielen where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
       is distinct from '11111111-1111-1111-1111-111111111111'::uuid then
    raise exception 'SEED FAALT: profiel A niet aan fonds A gekoppeld (trigger maak_profiel).';
  end if;
end $$;

-- Eén generiek, published document (fonds_id NULL conform namespace-invariant).
insert into public.documenten (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, actief)
values
  ('09000000-0000-0000-0000-0000000000a1', null, 'generiek', 'DNB',
   'T6 Generiek document', 'van_kracht', 'actief', true);

-- ── Impersoneer user A (fonds A) ────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';

-- POSITIEF T6a (SELECT): A ziet het generieke document (read-only toegang).
do $$
declare n int;
begin
  select count(*) into n from public.documenten
   where id = '09000000-0000-0000-0000-0000000000a1';
  if n <> 1 then
    raise exception 'REGRESSIE T6a: fonds A kan generieke content niet LEZEN (read-only-toegang kapot).';
  end if;
  raise notice 'OK T6a: fonds A leest generieke content (read-only).';
end $$;

-- NEGATIEF T6b (INSERT): A mag GEEN generiek document aanmaken.
do $$
declare gelukt boolean := false;
begin
  begin
    insert into public.documenten (fonds_id, bibliotheek, bron, titel, status, bronstatus, actief)
    values (null, 'generiek', 'DNB', 'T6 poging-insert', 'van_kracht', 'actief', true);
    gelukt := true; -- als we hier komen liet RLS de insert door
  exception when insufficient_privilege or check_violation then
    gelukt := false; -- verwacht: RLS/insert-policy weigert
  end;
  if gelukt then
    raise exception 'LEK T6b: fonds A kon een generiek document INSERTEN (read-only geschonden).';
  end if;
  raise notice 'OK T6b: generieke INSERT geweigerd voor fonds A.';
end $$;

-- NEGATIEF T6c (UPDATE): A mag een bestaand generiek document NIET wijzigen.
-- RLS levert géén fout maar raakt 0 rijen (het generieke doc valt buiten de
-- UPDATE-policy: fonds_id≠eigen fonds). We toetsen dat de waarde ONgewijzigd is.
do $$
declare n_geraakt int; titel_na text;
begin
  with upd as (
    update public.documenten set titel = 'T6 GEHACKT'
     where id = '09000000-0000-0000-0000-0000000000a1'
    returning 1
  )
  select count(*) into n_geraakt from upd;
  select titel into titel_na from public.documenten
   where id = '09000000-0000-0000-0000-0000000000a1';
  if n_geraakt <> 0 or titel_na is distinct from 'T6 Generiek document' then
    raise exception 'LEK T6c: fonds A kon een generiek document UPDATEN (geraakt=%, titel=%).', n_geraakt, titel_na;
  end if;
  raise notice 'OK T6c: generieke UPDATE raakt 0 rijen voor fonds A (ongewijzigd).';
end $$;

-- NEGATIEF T6d (DELETE): A mag een generiek document NIET verwijderen.
do $$
declare n_geraakt int; n_over int;
begin
  with del as (
    delete from public.documenten
     where id = '09000000-0000-0000-0000-0000000000a1'
    returning 1
  )
  select count(*) into n_geraakt from del;
  select count(*) into n_over from public.documenten
   where id = '09000000-0000-0000-0000-0000000000a1';
  if n_geraakt <> 0 or n_over <> 1 then
    raise exception 'LEK T6d: fonds A kon een generiek document DELETEN (geraakt=%, over=%).', n_geraakt, n_over;
  end if;
  raise notice 'OK T6d: generieke DELETE raakt 0 rijen voor fonds A (blijft bestaan).';
end $$;

reset role;

-- NEGATIEF T6e (namespace-CHECK): een generiek document MET fonds_id wordt
-- geweigerd, ongeacht RLS (constraint geldt ook voor de tabel-eigenaar).
do $$
declare gelukt boolean := false;
begin
  begin
    insert into public.documenten (fonds_id, bibliotheek, bron, titel, status, bronstatus, actief)
    values ('11111111-1111-1111-1111-111111111111', 'generiek', 'DNB',
            'T6 generiek-met-fonds', 'van_kracht', 'actief', true);
    gelukt := true;
  exception when check_violation then
    gelukt := false; -- verwacht: documenten_generiek_namespace_check
  end;
  if gelukt then
    raise exception 'LEK T6e: generiek document MET fonds_id toegestaan (namespace-invariant kapot).';
  end if;
  raise notice 'OK T6e: generiek MET fonds_id geweigerd door namespace-CHECK.';
end $$;

rollback;

-- ============================================================================
-- Alles geslaagd als psql exit 0 gaf en je de "OK …"-notices zag (T6a–T6e).
-- Elke "LEK:"/"REGRESSIE"/"FAALT" doet raise exception → non-zero exit → CI faalt.
-- ============================================================================
