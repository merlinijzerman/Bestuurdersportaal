-- ==========================================================================
-- Gedragstoets p214a1_05 — de BEFORE INSERT-guard grijpt zelf in.
-- --------------------------------------------------------------------------
-- Smalle aanvulling op 2026_08_28_p214a1_gedrag.sql. Deze toets heeft geen
-- auth.users-fixture nodig en onderscheidt de triggerfout expliciet van een
-- eventuele RLS-weigering. Beide inserts zitten in één transactie die altijd
-- wordt teruggerold; er kan dus geen teststap achterblijven.
--
-- Uitvoeren: psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand.
-- ROL: postgres voor de transactionele testopzet; de inserts zelf draaien na
-- SET LOCAL ROLE als authenticated en bewijzen de clientgrens.
-- ==========================================================================

begin;

set local role authenticated;

-- Een overgangsstatus mag nooit als begintoestand worden geïnserteerd.
do $$
declare
  melding text;
begin
  insert into public.procedure_stappen (
    id, procedure_id, volgorde, naam, status, vereist_besluit
  ) values (
    'a1050000-0000-0000-0000-000000000001',
    'a1050000-0000-0000-0000-000000000002',
    21401,
    'p214a1_05 negatieve statusfixture',
    'afgerond',
    false
  );
  raise exception 'LEK p214a1_05-A: INSERT met status afgerond werd geaccepteerd';
exception
  when insufficient_privilege then
    get stacked diagnostics melding = message_text;
    if melding not like 'Een nieuwe stap mag niet als afgerond worden aangemaakt%' then
      raise exception 'FAALT p214a1_05-A: niet de INSERT-guard maar een andere poort weigerde de rij: %', melding;
    end if;
    raise notice 'OK p214a1_05-A: INSERT-guard weigert status afgerond.';
  when others then
    raise;
end $$;

-- Ook een normale status met vervalste voltooiingsmetadata moet door precies
-- dezelfde trigger worden geweigerd.
do $$
declare
  melding text;
begin
  insert into public.procedure_stappen (
    id, procedure_id, volgorde, naam, status, vereist_besluit, voltooid_op
  ) values (
    'a1050000-0000-0000-0000-000000000003',
    'a1050000-0000-0000-0000-000000000004',
    21402,
    'p214a1_05 negatieve voltooiingsfixture',
    'actief',
    false,
    now()
  );
  raise exception 'LEK p214a1_05-B: INSERT met voltooid_op werd geaccepteerd';
exception
  when insufficient_privilege then
    get stacked diagnostics melding = message_text;
    if melding not like 'Voltooiing (voltooid_op/voltooid_door) mag niet bij het aanmaken%' then
      raise exception 'FAALT p214a1_05-B: niet de INSERT-guard maar een andere poort weigerde de rij: %', melding;
    end if;
    raise notice 'OK p214a1_05-B: INSERT-guard weigert vervalste voltooiingsmetadata.';
  when others then
    raise;
end $$;

rollback;

do $$
begin
  raise notice 'GROEN: p214a1_05 INSERT-guardgedrag bewezen; testtransactie teruggerold.';
end $$;
