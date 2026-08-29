-- ============================================================================
-- Gedragstoets 2026-08-28 — #214-a1 schrijfpoort (besluit 0194). PRODUCTIEFIX.
-- ----------------------------------------------------------------------------
-- Bewijst onder ÉCHTE RLS, als `authenticated`:
--   A. Een directe PostgREST-UPDATE op procedure_stappen.status / voltooid_door
--      faalt met een privilegefout (42501) — het vervalsbare pad is dicht.
--   B. Het legitieme pad (SECURITY DEFINER-RPC fn_stap_afronden) slaagt en zet
--      voltooid_door = auth.uid() (server-gezet, niet vervalsbaar).
--   C. fn_stap_heropenen (voorzitter) slaagt; een directe status-UPDATE faalt.
--   D. procedure_besluiten: een directe UPDATE én een directe DELETE falen (42501).
--
-- PATROON (gelijk aan 2026_08_05_bb_rolgrenzen.sql): DEEL 2 in één begin…rollback;
-- een VERBODEN statement dat SLAAGT raise't 'LEK (…)'; de handler vangt UITSLUITEND
-- de verwachte weigering (insufficient_privilege), `when others then raise`.
--
-- BEWIJS DAT EEN LEK ROOD WORDT: draai dit vóór migratie p214a1_02 (revoke) →
-- scenario A's UPDATE slaagt → 'LEK (A)' → non-zero exit → rode CI.
--
-- LET OP: seedt in auth.users → TESTdatabase, niet productie. Alles in begin…rollback.
-- Uitvoeren: psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f dit-bestand.
-- ============================================================================

-- DEEL 1 — de drie RPC's bestaan (anders is DEEL 2 zinloos).
do $$
begin
  if to_regprocedure('public.fn_stap_afronden(uuid, uuid)') is null
     or to_regprocedure('public.fn_stap_activeren(uuid, uuid)') is null
     or to_regprocedure('public.fn_stap_heropenen(uuid, uuid, text)') is null then
    raise exception 'FAALT: een van de schrijf-RPC''s ontbreekt — draai p214a1_01.';
  end if;
  raise notice 'OK 1: de drie schrijf-RPC''s bestaan.';
end $$;

-- DEEL 2 — GEDRAG (seed als eigenaar, impersonatie, rollback)
begin;

insert into public.fondsen (id, naam, slug)
values ('a1000000-0000-0000-0000-0000000000f1', 'A1 Testfonds', 'a1-testfonds');

insert into auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at)
values
  ('a1000001-0000-0000-0000-000000000001','authenticated','authenticated','a1-bestuurder@test.local',
   '{"naam":"A1 Bestuurder","fonds_id":"a1000000-0000-0000-0000-0000000000f1"}', now(), now()),
  ('a1000002-0000-0000-0000-000000000002','authenticated','authenticated','a1-voorzitter@test.local',
   '{"naam":"A1 Voorzitter","fonds_id":"a1000000-0000-0000-0000-0000000000f1"}', now(), now());

update public.profielen set rol = 'voorzitter'
 where id = 'a1000002-0000-0000-0000-000000000002';

insert into public.procedures (id, fonds_id, template_code, titel)
values ('a1000000-0000-0000-0000-0000000000e2',
        'a1000000-0000-0000-0000-0000000000f1', 'a1-test', 'A1 Procedure');

insert into public.decision_objects (id, fonds_id, procedure_id, besluit_code, titel, besluitvraag, is_primary_decision)
values ('a1000000-0000-0000-0000-0000000000d1',
        'a1000000-0000-0000-0000-0000000000f1',
        'a1000000-0000-0000-0000-0000000000e2',
        'A1-001', 'A1 Besluit', 'A1 Besluitvraag', true);

-- Een ACTIEVE stap (afrondbaar, geen checklist/bewijs/besluit vereist) en een
-- AFGERONDE stap (heropenbaar).
insert into public.procedure_stappen (id, procedure_id, volgorde, naam, status, vereist_besluit)
values
  ('a1000000-0000-0000-0000-000000000051','a1000000-0000-0000-0000-0000000000e2',1,'A1 Stap actief','actief',false),
  ('a1000000-0000-0000-0000-000000000052','a1000000-0000-0000-0000-0000000000e2',2,'A1 Stap afgerond','afgerond',false),
  ('a1000000-0000-0000-0000-000000000053','a1000000-0000-0000-0000-0000000000e2',3,'A1 Stap afgerond 2','afgerond',false),
  ('a1000000-0000-0000-0000-000000000054','a1000000-0000-0000-0000-0000000000e2',4,'A1 Stap geblokkeerd','geblokkeerd',false);

insert into public.procedure_besluiten (id, procedure_id, formulering, datum)
values ('a1000000-0000-0000-0000-0000000000b1','a1000000-0000-0000-0000-0000000000e2','A1 besluit-formulering', current_date);

-- Tweede fonds voor de fondsgrens-toets (geen gebruiker nodig; de actor is fonds 1).
insert into public.fondsen (id, naam, slug)
values ('a2000000-0000-0000-0000-0000000000f2', 'A2 Testfonds', 'a2-testfonds');
insert into public.procedures (id, fonds_id, template_code, titel)
values ('a2000000-0000-0000-0000-0000000000e3','a2000000-0000-0000-0000-0000000000f2','a2-test','A2 Procedure');
insert into public.procedure_stappen (id, procedure_id, volgorde, naam, status, vereist_besluit)
values ('a2000000-0000-0000-0000-000000000055','a2000000-0000-0000-0000-0000000000e3',1,'A2 Stap actief','actief',false);

do $$ begin
  if (select rol from public.profielen where id='a1000002-0000-0000-0000-000000000002') <> 'voorzitter' then
    raise exception 'SEED FAALT: voorzitter-rol niet gezet.';
  end if;
  raise notice 'OK seed: fonds, twee profielen, procedure, decision, twee stappen, een besluit.';
end $$;

-- ── Impersoneer de bestuurder ─────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000001-0000-0000-0000-000000000001"}';

-- A. Directe UPDATE op status faalt.
do $$ begin
  update public.procedure_stappen set status = 'afgerond'
   where id = 'a1000000-0000-0000-0000-000000000051';
  raise exception 'LEK (A): directe UPDATE op procedure_stappen.status werd geaccepteerd.';
exception
  when insufficient_privilege then raise notice 'OK A: directe UPDATE op status geweigerd (42501).';
  when others then raise;
end $$;

-- A2. Directe UPDATE op voltooid_door faalt (het verantwoordingsfeit).
do $$ begin
  update public.procedure_stappen set voltooid_door = 'a1000002-0000-0000-0000-000000000002'
   where id = 'a1000000-0000-0000-0000-000000000051';
  raise exception 'LEK (A2): directe UPDATE op procedure_stappen.voltooid_door werd geaccepteerd.';
exception
  when insufficient_privilege then raise notice 'OK A2: directe UPDATE op voltooid_door geweigerd (42501).';
  when others then raise;
end $$;

-- B. Legitieme pad: fn_stap_afronden slaagt en zet voltooid_door = auth.uid().
do $$
declare v_door uuid; v_status text;
begin
  perform public.fn_stap_afronden('a1000000-0000-0000-0000-000000000051','a1000000-0000-0000-0000-0000000000e2');
  select status, voltooid_door into v_status, v_door
    from public.procedure_stappen where id = 'a1000000-0000-0000-0000-000000000051';
  if v_status <> 'afgerond' then
    raise exception 'FAALT (B): fn_stap_afronden zette status niet op afgerond (%).', v_status;
  end if;
  if v_door <> 'a1000001-0000-0000-0000-000000000001' then
    raise exception 'FAALT (B): voltooid_door is % , niet de aanroeper (server moet auth.uid() zetten).', v_door;
  end if;
  raise notice 'OK B: fn_stap_afronden slaagt en zet voltooid_door = de aanroeper (server-gezet).';
end $$;

-- D. procedure_besluiten: directe UPDATE en DELETE falen.
do $$ begin
  update public.procedure_besluiten set formulering = 'vervalst'
   where id = 'a1000000-0000-0000-0000-0000000000b1';
  raise exception 'LEK (D-update): directe UPDATE op procedure_besluiten werd geaccepteerd.';
exception
  when insufficient_privilege then raise notice 'OK D-update: directe UPDATE op procedure_besluiten geweigerd (42501).';
  when others then raise;
end $$;
do $$ begin
  delete from public.procedure_besluiten where id = 'a1000000-0000-0000-0000-0000000000b1';
  raise exception 'LEK (D-delete): directe DELETE op procedure_besluiten werd geaccepteerd.';
exception
  when insufficient_privilege then raise notice 'OK D-delete: directe DELETE op procedure_besluiten geweigerd (42501).';
  when others then raise;
end $$;

-- E. INSERT-forging: een nieuwe stap direct als afgerond + met voltooid_door aanmaken faalt.
do $$ begin
  insert into public.procedure_stappen (id, procedure_id, volgorde, naam, status, voltooid_door)
  values (gen_random_uuid(),'a1000000-0000-0000-0000-0000000000e2',9,'Vervalst','afgerond','a1000002-0000-0000-0000-000000000002');
  raise exception 'LEK (E): INSERT van een afgeronde stap met voltooid_door werd geaccepteerd.';
exception
  when insufficient_privilege then raise notice 'OK E: INSERT-forging (afgerond + voltooid_door bij aanmaken) geweigerd.';
  when others then raise;
end $$;

-- F. DELETE van een afgeronde stap faalt (verantwoordingsfeit niet wisbaar).
do $$ begin
  delete from public.procedure_stappen where id = 'a1000000-0000-0000-0000-000000000053';
  raise exception 'LEK (F): directe DELETE van een afgeronde stap werd geaccepteerd.';
exception
  when insufficient_privilege then raise notice 'OK F: directe DELETE van een stap geweigerd (42501).';
  when others then raise;
end $$;

-- H. Fondsgrens: fn_stap_afronden op een stap in een ANDER fonds faalt.
do $$ begin
  perform public.fn_stap_afronden('a2000000-0000-0000-0000-000000000055','a2000000-0000-0000-0000-0000000000e3');
  raise exception 'LEK (H): fn_stap_afronden accepteerde een stap buiten het eigen fonds.';
exception
  when insufficient_privilege then raise notice 'OK H: fondsgrens afgedwongen (afronden buiten eigen fonds geweigerd).';
  when others then raise;
end $$;

-- fn_stap_activeren: een geblokkeerde stap wordt actief via het legitieme pad.
do $$
declare v_status text;
begin
  perform public.fn_stap_activeren('a1000000-0000-0000-0000-000000000054','a1000000-0000-0000-0000-0000000000e2');
  select status into v_status from public.procedure_stappen where id = 'a1000000-0000-0000-0000-000000000054';
  if v_status <> 'actief' then
    raise exception 'FAALT: fn_stap_activeren zette status niet op actief (%).', v_status;
  end if;
  raise notice 'OK: fn_stap_activeren zet een geblokkeerde stap op actief.';
end $$;

-- G. Rolgate: een bestuurder mag GEEN stap heropenen (alleen voorzitter/beheerder).
do $$ begin
  perform public.fn_stap_heropenen('a1000000-0000-0000-0000-000000000053','a1000000-0000-0000-0000-0000000000e2','poging door bestuurder');
  raise exception 'LEK (G): een bestuurder kon fn_stap_heropenen aanroepen.';
exception
  when insufficient_privilege then raise notice 'OK G: rolgate — bestuurder mag niet heropenen (42501).';
  when others then raise;
end $$;

-- ── Impersoneer de voorzitter voor heropenen ──────────────────────────────
set local request.jwt.claims to '{"sub":"a1000002-0000-0000-0000-000000000002"}';

-- C. Directe UPDATE naar heropend faalt; fn_stap_heropenen slaagt.
do $$ begin
  update public.procedure_stappen set status = 'heropend'
   where id = 'a1000000-0000-0000-0000-000000000052';
  raise exception 'LEK (C): directe UPDATE naar heropend werd geaccepteerd.';
exception
  when insufficient_privilege then raise notice 'OK C: directe UPDATE naar heropend geweigerd (42501).';
  when others then raise;
end $$;
do $$
declare v_status text;
begin
  perform public.fn_stap_heropenen('a1000000-0000-0000-0000-000000000052','a1000000-0000-0000-0000-0000000000e2','correctie bindingsfout');
  select status into v_status from public.procedure_stappen where id = 'a1000000-0000-0000-0000-000000000052';
  if v_status <> 'heropend' then
    raise exception 'FAALT (C): fn_stap_heropenen zette status niet op heropend (%).', v_status;
  end if;
  raise notice 'OK C: fn_stap_heropenen (voorzitter) slaagt via het legitieme pad.';
end $$;

rollback;

do $$ begin raise notice 'GROEN: #214-a1 gedragstoets geslaagd (directe PATCH dicht, RPC-pad werkt).'; end $$;
