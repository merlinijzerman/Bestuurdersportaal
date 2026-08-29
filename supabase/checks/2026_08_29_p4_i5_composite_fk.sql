-- ============================================================================
-- Gedragstoets 2026-08-29 — P4 tranche 8 (I5): composite-FK weigert een
-- cross-fonds referentie (besluit 0194 F). Familie #209/#212.
-- ----------------------------------------------------------------------------
-- Bewijst dat `(bron_id, fonds_id)` → doel `(id, fonds_id)` een verwijzing naar
-- een object in een ANDER fonds hard weigert (23503), en een verwijzing binnen
-- HETZELFDE fonds toelaat. Owner-context volstaat: een FK bijt ongeacht de rol
-- (óók service_role) — dat is juist het punt t.o.v. een trigger.
-- Zelf-seedend, in één begin…rollback. Uitvoeren:
--   psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand.
-- ROL: postgres; een composite FK geldt juist ongeacht de uitvoerende rol,
-- inclusief service_role, dus owner-context toetst de hardste grens.
-- ============================================================================

-- DEEL 1 — de drie composite-FK's bestaan.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pri_decision_zelfde_fonds')
     or not exists (select 1 from pg_constraint where conname = 'pru_decision_zelfde_fonds')
     or not exists (select 1 from pg_constraint where conname = 'pv_procedure_zelfde_fonds')
     or not exists (select 1 from pg_constraint where conname = 'procedures_id_fonds_uniek') then
    raise exception 'FAALT: een I5-composite-FK (of de procedures-uniek) ontbreekt — draai p4_08.';
  end if;
  raise notice 'OK 1: de I5-composite-FK''s bestaan.';
end $$;

-- DEEL 2 — gedrag.
begin;

insert into public.fondsen (id, naam, slug) values
  ('55000000-0000-0000-0000-0000000000fa', 'I5 Fonds A', 'i5-fonds-a'),
  ('55000000-0000-0000-0000-0000000000fb', 'I5 Fonds B', 'i5-fonds-b');
insert into public.procedures (id, fonds_id, template_code, titel) values
  ('55000000-0000-0000-0000-00000000000a', '55000000-0000-0000-0000-0000000000fa', 'i5', 'Proc A');
insert into public.decision_objects (id, fonds_id, procedure_id, besluit_code, titel, besluitvraag) values
  ('55000000-0000-0000-0000-0000000000da', '55000000-0000-0000-0000-0000000000fa',
   '55000000-0000-0000-0000-00000000000a', 'I5-001', 'Besluit A', 'Vraag A');

-- CROSS-FONDS: een instantie in fonds B die het besluit van fonds A noemt → 23503.
-- `approval` houdt deze fixture buiten de aparte P2-sleutelvalidatie voor
-- documentachtige requirements; zo meet deze test uitsluitend de I5-FK.
do $$
begin
  insert into public.procedure_requirement_instance
    (id, decision_id, fonds_id, stap_volgorde, requirement_type, label, zwaarte, actief)
  values (gen_random_uuid(), '55000000-0000-0000-0000-0000000000da',
          '55000000-0000-0000-0000-0000000000fb', 1, 'approval', 'X', 'vereist', true);
  raise exception 'LEK (I5): een requirement_instance in fonds B kon het besluit van fonds A referen.';
exception
  when foreign_key_violation then raise notice 'OK I5: cross-fonds requirement_instance geweigerd (23503).';
  when others then raise;
end $$;

-- HETZELFDE FONDS: mag wél.
do $$
begin
  insert into public.procedure_requirement_instance
    (id, decision_id, fonds_id, stap_volgorde, requirement_type, label, zwaarte, actief)
  values (gen_random_uuid(), '55000000-0000-0000-0000-0000000000da',
          '55000000-0000-0000-0000-0000000000fa', 1, 'approval', 'X', 'vereist', true);
  raise notice 'OK I5: same-fonds requirement_instance toegestaan.';
exception
  when others then raise exception 'FAALT (I5): een legitieme same-fonds instantie werd geweigerd: %', sqlerrm;
end $$;

rollback;

do $$ begin raise notice 'GROEN: I5-composite-FK weigert cross-fonds, laat same-fonds toe.'; end $$;
