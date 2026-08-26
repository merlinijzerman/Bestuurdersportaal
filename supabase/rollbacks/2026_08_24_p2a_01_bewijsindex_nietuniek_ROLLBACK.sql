-- ROLLBACK van P2/PR-A #160-correctie — niet-unieke index terug naar uniek.
-- HAND-RUN. Let op: herstelt de uniciteit alleen als er géén duplicaten zijn
-- ontstaan sinds de forward-migratie (anders faalt de unique-create luid — dat is
-- correct: dan is er gebonden bewijs dat onder de oude regel niet mocht bestaan).
begin;
drop index if exists public.idx_procbewijs_req_sleutel;
create unique index idx_procbewijs_req_sleutel
  on public.procedure_bewijs(stap_id, requirement_sleutel)
  where requirement_sleutel is not null;
commit;
