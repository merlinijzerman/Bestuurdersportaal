-- ============================================================================
-- ROLLBACK 2026-09-23 — Wetsgeschiedenis A-light foundation terugdraaien
-- ----------------------------------------------------------------------------
-- Verwijdert de combinatie- en waarde-CHECKs, herstelt
-- documenten_documenttype_check naar de lijst zonder 'wetgeving' en
-- 'wetsgeschiedenis', en dropt de kolommen wetsgeschiedenis_subtype en
-- dossiernummer.
--
-- FAIL-CLOSED: de rollback weigert zolang er documenten met een van de nieuwe
-- waarden bestaan. Deactiveer/herclassificeer die eerst via de curatie (met
-- auditspoor); de rollback verwijdert nooit stilzwijgend gecureerde metadata.
-- ============================================================================

begin;

do $$
declare
  v_aantal bigint;
begin
  select count(*) into v_aantal
    from public.documenten
   where documenttype in ('wetgeving','wetsgeschiedenis');
  if v_aantal > 0 then
    raise exception
      'Rollback geweigerd: % document(en) met documenttype wetgeving/wetsgeschiedenis. Herclassificeer eerst.',
      v_aantal;
  end if;
end
$$;

alter table public.documenten drop constraint if exists documenten_wetsgeschiedenis_combinatie_check;
alter table public.documenten drop constraint if exists documenten_juridisch_generiek_check;
alter table public.documenten drop constraint if exists documenten_dossiernummer_check;
alter table public.documenten drop constraint if exists documenten_wetsgeschiedenis_subtype_check;

alter table public.documenten drop constraint if exists documenten_documenttype_check;
alter table public.documenten add  constraint documenten_documenttype_check
  check (documenttype is null or documenttype in (
    'beleid','besluit','besluitdocument','besluitregistratie','bestuursvoorstel',
    'notulen','advies','memo','analyse','rapportage','bijlage','overig'));

alter table public.documenten
  drop column if exists dossiernummer,
  drop column if exists wetsgeschiedenis_subtype;

commit;
