-- ============================================================================
--  I7-verificatiefixture — dwing de bevroren-pad-dekking af bij migratieverificatie
-- ----------------------------------------------------------------------------
--  WAAROM (P3-bevinding, #168). De prod-gelijke stub bouwt vanaf een SCHEMA-ONLY
--  baseline: er staan geen rijen in procedure_requirements. Een migratie die
--  row-DML doet op een GEPUBLICEERDE definitie (die I7/P1b bevriest met de trigger
--  trg_req_versievast) wordt dan groen bevonden terwijl hij op productie afbreekt —
--  precies wat er met P3/PR-B's zwaarte-backfill gebeurde. De trigger had niets te
--  bewaken omdat er geen bevroren rijen waren: een vals-negatief.
--
--  DIT BESTAND is de mechanische remedie i.p.v. "eraan denken". Het zet minstens
--  één GEPUBLICEERDE templateversie neer met requirement-rijen (alle drie de
--  zwaartes) + een dossier dat erop pint. Vanaf dat moment raakt elke migratie die
--  je hierna forward/rollback draait het bevroren pad; row-DML op deze rijen valt
--  door I7.
--
--  PROTOCOL (hoort bij het landen van elke tranche):
--    1. Bouw de prod-gelijke DB (scripts/testdb-apply-migrations.sh).
--    2. Pas deze fixture toe:  psql "$DB" -v ON_ERROR_STOP=1 -f scripts/testdb-i7-fixture.sql
--    3. Draai de tranche-FRF (rollback → forward van de nieuwe migraties) tegen
--       deze DB. Breekt een migratie af op 'onveranderlijk (I7)', dan doet hij
--       row-DML op een gepubliceerde procedure_requirements-rij — herstel dat
--       (bv. via tijdelijk-generated + drop expression, zoals p3b_01), niet door
--       I7 uit te zetten.
--
--  Gebruikt de zwaarte-schrijfkolom (P3): verplicht/blokkerend zijn generated.
-- ============================================================================
begin;

insert into public.fondsen (id, naam, slug)
values ('e7f00000-0000-0000-0000-0000000000e7', 'I7 Fixture', 'i7-fixture')
on conflict (id) do nothing;

-- Gepubliceerde template met requirement-rijen (alle drie de zwaartes).
insert into public.procedure_requirements
  (template_code, template_versie, stap_volgorde, requirement_type, label, zwaarte, min_aantal)
values
  ('_i7fix', '1.0.0', 1, 'risk',     'I7-kritiek',   'kritiek',   1),
  ('_i7fix', '1.0.0', 1, 'risk',     'I7-vereist',   'vereist',   1),
  ('_i7fix', '1.0.0', 1, 'document', 'I7-optioneel', 'optioneel', 1)
on conflict do nothing;

-- Publiceren → I7 (trg_req_versievast) bevriest de bovenstaande rijen.
insert into public.procedure_definitie_publicatie (template_code, template_versie)
values ('_i7fix', '1.0.0')
on conflict do nothing;

-- Een dossier dat op de gepubliceerde template pint.
insert into public.procedures (id, fonds_id, template_code, template_versie, titel, status)
values ('e7f00000-0000-0000-0000-0000000000f1', 'e7f00000-0000-0000-0000-0000000000e7',
        '_i7fix', '1.0.0', 'I7-fixture procedure', 'lopend')
on conflict (id) do nothing;

-- decision_objects pint via procedure_id op de procedure (die de template draagt);
-- de tabel heeft zelf geen template_code-kolom.
insert into public.decision_objects
  (id, procedure_id, fonds_id, besluit_code, titel, besluitvraag, is_primary_decision)
values ('e7f00000-0000-0000-0000-0000000000d1', 'e7f00000-0000-0000-0000-0000000000f1',
        'e7f00000-0000-0000-0000-0000000000e7', 'I7-0001', 'I7-fixture besluit', 'Toetsvraag?', true)
on conflict (id) do nothing;

commit;

do $$ begin raise notice 'I7-fixture geplaatst: _i7fix@1.0.0 gepubliceerd (3 requirement-rijen) + dossier.'; end $$;
