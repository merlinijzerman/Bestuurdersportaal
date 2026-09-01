-- #214-a1 — geen onveilige rollback van de herbevestigde INSERT-poort.
--
-- Functie of trigger verwijderen is geen herstel, maar heropent de
-- INSERT-omzeiling. Bij een deployprobleem blijft deze DB-beveiliging actief en
-- wordt uitsluitend de applicatiecode teruggezet.

begin;

do $$
begin
  raise exception 'ROLLBACK_GEBLOKKEERD: behoud fn_guard_stap_insert en trg_guard_stap_insert; herstel uitsluitend de code-deploy.';
end $$;

rollback;
