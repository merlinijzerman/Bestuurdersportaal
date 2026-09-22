-- ============================================================================
--  #434 T4-F — gedragstest tegen de WERKELIJK GEÏNSTALLEERDE wrappers.
-- ----------------------------------------------------------------------------
--  Read-only. Toetst de UITKOMST van `meta_basisniveau()`/`meta_bronniveau()`,
--  niet de tekst van een migratiebestand — er is in dit project geen
--  migratierunner, dus een bestand bewijst niets over de database.
--
--  Vier dingen, en de tweede is degene die vier eerdere uitbreidingsrondes
--  nooit hebben gehad: dat ALLE bestaande toegestane sleutels nog terugkomen.
-- ============================================================================
-- ROL: authenticated — dit is de rol die de leesprojectie in productie
-- aanroept. Als superuser meten zou bewijzen dat de functie werkt, niet dat
-- zij werkt voor wie haar werkelijk gebruikt; het `execute`-recht op de nieuwe
-- vormcontrole hoort daar expliciet bij.
\set ON_ERROR_STOP on

begin;
set local role authenticated;

do $$
declare
  v_geldig jsonb := '{"methode":"hybride_rrf","opgehaald":20,"geselecteerd":8,"adapters":[{"naam":"supabase-rag","methode":"hybride_rrf","resultaat":"treffers","netwerkpogingen":1,"latency_ms":12,"downloads":0,"bytes":0,"throttles":0,"retries":0,"kandidaten_voor_poort":20,"kandidaten_na_poort":8,"afwijzing_root":0,"afwijzing_mapping":0,"afwijzing_binding":0,"afwijzing_rechten":0,"afwijzing_versie":0,"afwijzing_download":0,"afwijzing_extractie":0,"afwijzing_lokalisatie":0,"afwijzing_grens":0,"opgenomen_passages":3,"opgenomen_documenten":2}]}'::jsonb;
  v jsonb;
begin
  -- 1. Een geldige `adapters` komt terug, op beide niveaus.
  if public.meta_basisniveau(v_geldig) -> 'adapters' is distinct from v_geldig -> 'adapters' then
    raise exception 'T4-F: geldige adapters verdwijnt uit meta_basisniveau()';
  end if;
  if public.meta_bronniveau(v_geldig) -> 'adapters' is distinct from v_geldig -> 'adapters' then
    raise exception 'T4-F: geldige adapters verdwijnt uit meta_bronniveau()';
  end if;

  -- 2. BESTAANDE sleutels blijven behouden. Deze migratie herdefinieert de
  --    wrappers volledig; een weggevallen sleutel uit een eerdere ronde zou
  --    anders pas opvallen als iemand hem mist.
  if public.meta_basisniveau(v_geldig) ->> 'methode' is distinct from 'hybride_rrf'
     or public.meta_basisniveau(v_geldig) ->> 'opgehaald' is distinct from '20'
     or public.meta_basisniveau(v_geldig) ->> 'geselecteerd' is distinct from '8' then
    raise exception 'T4-F: een bestaande basissleutel is uit de projectie verdwenen';
  end if;

  -- 3. Onbekende sleutels verdwijnen nog steeds.
  if public.meta_basisniveau('{"methode":"geen","geheim":"lek"}'::jsonb) ? 'geheim' then
    raise exception 'T4-F: een onbekende sleutel passeert de projectie';
  end if;

  -- 4. Een afwezige `adapters` is GEEN fout: niet elke beurt kent meer dan
  --    één adapter, en het bestaande pad moet ongemoeid blijven.
  if public.meta_basisniveau('{"methode":"geen"}'::jsonb) ? 'adapters' then
    raise exception 'T4-F: adapters verschijnt terwijl de sleutel afwezig was';
  end if;
end $$;

-- ── Vijandige vormen: HARD FALEN, niet stil verdwijnen ──────────────────────
--  Stil weglaten zou een antwoord volledig ogend maken terwijl juist de
--  informatie over een niet-geraadpleegde bron is verdwenen. Elk van deze
--  vormen moet `adaptermetadata_ongeldig` werpen (SQLSTATE 23514).
do $$
declare v jsonb;
begin
  begin
    v := public.meta_basisniveau('{"adapters":[{"naam":"supabase-rag","methode":"hybride_rrf","resultaat":"treffers","netwerkpogingen":1,"latency_ms":12,"downloads":0,"throttles":0,"retries":0,"kandidaten_voor_poort":20,"kandidaten_na_poort":8,"afwijzing_root":0,"afwijzing_mapping":0,"afwijzing_binding":0,"afwijzing_rechten":0,"afwijzing_versie":0,"afwijzing_download":0,"afwijzing_extractie":0,"afwijzing_lokalisatie":0,"afwijzing_grens":0,"opgenomen_passages":3,"opgenomen_documenten":2,"bytes":null}]}'::jsonb);
    raise exception 'T4-F: vijandige vorm "NaN wordt null" werd NIET geweigerd (uitkomst: %)',
      case when v ? 'adapters' then 'doorgelaten' else 'stil weggevallen' end;
  exception when sqlstate '23514' then null;
  end;
  begin
    v := public.meta_basisniveau('{"adapters":[{"naam":"onbekend","methode":"hybride_rrf","resultaat":"treffers","netwerkpogingen":1,"latency_ms":12,"downloads":0,"bytes":0,"throttles":0,"retries":0,"kandidaten_voor_poort":20,"kandidaten_na_poort":8,"afwijzing_root":0,"afwijzing_mapping":0,"afwijzing_binding":0,"afwijzing_rechten":0,"afwijzing_versie":0,"afwijzing_download":0,"afwijzing_extractie":0,"afwijzing_lokalisatie":0,"afwijzing_grens":0,"opgenomen_passages":3,"opgenomen_documenten":2}]}'::jsonb);
    raise exception 'T4-F: vijandige vorm "onbekende enum" werd NIET geweigerd (uitkomst: %)',
      case when v ? 'adapters' then 'doorgelaten' else 'stil weggevallen' end;
  exception when sqlstate '23514' then null;
  end;
  begin
    v := public.meta_basisniveau('{"adapters":[{"naam":"supabase-rag","methode":"hybride_rrf","resultaat":"treffers","netwerkpogingen":1,"latency_ms":12,"downloads":0,"bytes":0,"throttles":0,"retries":0,"kandidaten_voor_poort":20,"kandidaten_na_poort":8,"afwijzing_root":0,"afwijzing_mapping":0,"afwijzing_binding":0,"afwijzing_rechten":0,"afwijzing_versie":0,"afwijzing_download":0,"afwijzing_extractie":0,"afwijzing_lokalisatie":0,"afwijzing_grens":0,"opgenomen_passages":3,"opgenomen_documenten":2,"extra":1}]}'::jsonb);
    raise exception 'T4-F: vijandige vorm "extra veld" werd NIET geweigerd (uitkomst: %)',
      case when v ? 'adapters' then 'doorgelaten' else 'stil weggevallen' end;
  exception when sqlstate '23514' then null;
  end;
  begin
    v := public.meta_basisniveau('{"adapters":[{"naam":"supabase-rag","methode":"hybride_rrf","resultaat":"treffers","netwerkpogingen":1,"latency_ms":12,"downloads":0,"bytes":0,"throttles":0,"retries":0,"kandidaten_voor_poort":20,"kandidaten_na_poort":8,"afwijzing_root":0,"afwijzing_mapping":0,"afwijzing_binding":0,"afwijzing_rechten":0,"afwijzing_versie":0,"afwijzing_download":0,"afwijzing_extractie":0,"afwijzing_lokalisatie":0,"afwijzing_grens":0,"opgenomen_passages":3,"opgenomen_documenten":2,"bron_id":"https://host/pad/doc.docx"}]}'::jsonb);
    raise exception 'T4-F: vijandige vorm "identifier in extra veld" werd NIET geweigerd (uitkomst: %)',
      case when v ? 'adapters' then 'doorgelaten' else 'stil weggevallen' end;
  exception when sqlstate '23514' then null;
  end;
  begin
    v := public.meta_basisniveau('{"adapters":[{"naam":"supabase-rag","methode":"hybride_rrf","resultaat":"treffers","netwerkpogingen":1,"latency_ms":12,"downloads":0,"bytes":0,"throttles":0,"retries":0,"kandidaten_voor_poort":20,"kandidaten_na_poort":8,"afwijzing_root":0,"afwijzing_mapping":0,"afwijzing_binding":0,"afwijzing_rechten":0,"afwijzing_versie":0,"afwijzing_download":0,"afwijzing_extractie":0,"afwijzing_lokalisatie":0,"afwijzing_grens":0,"opgenomen_passages":3,"opgenomen_documenten":2,"afwijzingen":{"root":1}}]}'::jsonb);
    raise exception 'T4-F: vijandige vorm "genest object" werd NIET geweigerd (uitkomst: %)',
      case when v ? 'adapters' then 'doorgelaten' else 'stil weggevallen' end;
  exception when sqlstate '23514' then null;
  end;
  begin
    v := public.meta_basisniveau('{"adapters":[{"naam":"supabase-rag","methode":"hybride_rrf","resultaat":"treffers","netwerkpogingen":1,"latency_ms":12,"downloads":0,"bytes":-1,"throttles":0,"retries":0,"kandidaten_voor_poort":20,"kandidaten_na_poort":8,"afwijzing_root":0,"afwijzing_mapping":0,"afwijzing_binding":0,"afwijzing_rechten":0,"afwijzing_versie":0,"afwijzing_download":0,"afwijzing_extractie":0,"afwijzing_lokalisatie":0,"afwijzing_grens":0,"opgenomen_passages":3,"opgenomen_documenten":2}]}'::jsonb);
    raise exception 'T4-F: vijandige vorm "negatieve teller" werd NIET geweigerd (uitkomst: %)',
      case when v ? 'adapters' then 'doorgelaten' else 'stil weggevallen' end;
  exception when sqlstate '23514' then null;
  end;
  begin
    v := public.meta_basisniveau('{"adapters":[{"naam":"supabase-rag","methode":"hybride_rrf","resultaat":"treffers","netwerkpogingen":1,"latency_ms":12,"downloads":0,"bytes":1.5,"throttles":0,"retries":0,"kandidaten_voor_poort":20,"kandidaten_na_poort":8,"afwijzing_root":0,"afwijzing_mapping":0,"afwijzing_binding":0,"afwijzing_rechten":0,"afwijzing_versie":0,"afwijzing_download":0,"afwijzing_extractie":0,"afwijzing_lokalisatie":0,"afwijzing_grens":0,"opgenomen_passages":3,"opgenomen_documenten":2}]}'::jsonb);
    raise exception 'T4-F: vijandige vorm "niet-geheel getal" werd NIET geweigerd (uitkomst: %)',
      case when v ? 'adapters' then 'doorgelaten' else 'stil weggevallen' end;
  exception when sqlstate '23514' then null;
  end;
  begin
    v := public.meta_basisniveau('{"adapters":[{"naam":"supabase-rag"}]}'::jsonb);
    raise exception 'T4-F: vijandige vorm "ontbrekend veld" werd NIET geweigerd (uitkomst: %)',
      case when v ? 'adapters' then 'doorgelaten' else 'stil weggevallen' end;
  exception when sqlstate '23514' then null;
  end;
  begin
    v := public.meta_basisniveau('{"adapters":{"naam":"supabase-rag"}}'::jsonb);
    raise exception 'T4-F: vijandige vorm "geen array" werd NIET geweigerd (uitkomst: %)',
      case when v ? 'adapters' then 'doorgelaten' else 'stil weggevallen' end;
  exception when sqlstate '23514' then null;
  end;
  begin
    v := public.meta_basisniveau('{"adapters":[{"naam":"supabase-rag","methode":"hybride_rrf","resultaat":"treffers","netwerkpogingen":1,"latency_ms":12,"downloads":0,"bytes":0,"throttles":0,"retries":0,"kandidaten_voor_poort":20,"kandidaten_na_poort":8,"afwijzing_root":0,"afwijzing_mapping":0,"afwijzing_binding":0,"afwijzing_rechten":0,"afwijzing_versie":0,"afwijzing_download":0,"afwijzing_extractie":0,"afwijzing_lokalisatie":0,"afwijzing_grens":0,"opgenomen_passages":3,"opgenomen_documenten":2},{"naam":"supabase-rag","methode":"hybride_rrf","resultaat":"treffers","netwerkpogingen":1,"latency_ms":12,"downloads":0,"bytes":0,"throttles":0,"retries":0,"kandidaten_voor_poort":20,"kandidaten_na_poort":8,"afwijzing_root":0,"afwijzing_mapping":0,"afwijzing_binding":0,"afwijzing_rechten":0,"afwijzing_versie":0,"afwijzing_download":0,"afwijzing_extractie":0,"afwijzing_lokalisatie":0,"afwijzing_grens":0,"opgenomen_passages":3,"opgenomen_documenten":2},{"naam":"supabase-rag","methode":"hybride_rrf","resultaat":"treffers","netwerkpogingen":1,"latency_ms":12,"downloads":0,"bytes":0,"throttles":0,"retries":0,"kandidaten_voor_poort":20,"kandidaten_na_poort":8,"afwijzing_root":0,"afwijzing_mapping":0,"afwijzing_binding":0,"afwijzing_rechten":0,"afwijzing_versie":0,"afwijzing_download":0,"afwijzing_extractie":0,"afwijzing_lokalisatie":0,"afwijzing_grens":0,"opgenomen_passages":3,"opgenomen_documenten":2},{"naam":"supabase-rag","methode":"hybride_rrf","resultaat":"treffers","netwerkpogingen":1,"latency_ms":12,"downloads":0,"bytes":0,"throttles":0,"retries":0,"kandidaten_voor_poort":20,"kandidaten_na_poort":8,"afwijzing_root":0,"afwijzing_mapping":0,"afwijzing_binding":0,"afwijzing_rechten":0,"afwijzing_versie":0,"afwijzing_download":0,"afwijzing_extractie":0,"afwijzing_lokalisatie":0,"afwijzing_grens":0,"opgenomen_passages":3,"opgenomen_documenten":2},{"naam":"supabase-rag","methode":"hybride_rrf","resultaat":"treffers","netwerkpogingen":1,"latency_ms":12,"downloads":0,"bytes":0,"throttles":0,"retries":0,"kandidaten_voor_poort":20,"kandidaten_na_poort":8,"afwijzing_root":0,"afwijzing_mapping":0,"afwijzing_binding":0,"afwijzing_rechten":0,"afwijzing_versie":0,"afwijzing_download":0,"afwijzing_extractie":0,"afwijzing_lokalisatie":0,"afwijzing_grens":0,"opgenomen_passages":3,"opgenomen_documenten":2},{"naam":"supabase-rag","methode":"hybride_rrf","resultaat":"treffers","netwerkpogingen":1,"latency_ms":12,"downloads":0,"bytes":0,"throttles":0,"retries":0,"kandidaten_voor_poort":20,"kandidaten_na_poort":8,"afwijzing_root":0,"afwijzing_mapping":0,"afwijzing_binding":0,"afwijzing_rechten":0,"afwijzing_versie":0,"afwijzing_download":0,"afwijzing_extractie":0,"afwijzing_lokalisatie":0,"afwijzing_grens":0,"opgenomen_passages":3,"opgenomen_documenten":2},{"naam":"supabase-rag","methode":"hybride_rrf","resultaat":"treffers","netwerkpogingen":1,"latency_ms":12,"downloads":0,"bytes":0,"throttles":0,"retries":0,"kandidaten_voor_poort":20,"kandidaten_na_poort":8,"afwijzing_root":0,"afwijzing_mapping":0,"afwijzing_binding":0,"afwijzing_rechten":0,"afwijzing_versie":0,"afwijzing_download":0,"afwijzing_extractie":0,"afwijzing_lokalisatie":0,"afwijzing_grens":0,"opgenomen_passages":3,"opgenomen_documenten":2},{"naam":"supabase-rag","methode":"hybride_rrf","resultaat":"treffers","netwerkpogingen":1,"latency_ms":12,"downloads":0,"bytes":0,"throttles":0,"retries":0,"kandidaten_voor_poort":20,"kandidaten_na_poort":8,"afwijzing_root":0,"afwijzing_mapping":0,"afwijzing_binding":0,"afwijzing_rechten":0,"afwijzing_versie":0,"afwijzing_download":0,"afwijzing_extractie":0,"afwijzing_lokalisatie":0,"afwijzing_grens":0,"opgenomen_passages":3,"opgenomen_documenten":2},{"naam":"supabase-rag","methode":"hybride_rrf","resultaat":"treffers","netwerkpogingen":1,"latency_ms":12,"downloads":0,"bytes":0,"throttles":0,"retries":0,"kandidaten_voor_poort":20,"kandidaten_na_poort":8,"afwijzing_root":0,"afwijzing_mapping":0,"afwijzing_binding":0,"afwijzing_rechten":0,"afwijzing_versie":0,"afwijzing_download":0,"afwijzing_extractie":0,"afwijzing_lokalisatie":0,"afwijzing_grens":0,"opgenomen_passages":3,"opgenomen_documenten":2}]}'::jsonb);
    raise exception 'T4-F: vijandige vorm "array boven de grens" werd NIET geweigerd (uitkomst: %)',
      case when v ? 'adapters' then 'doorgelaten' else 'stil weggevallen' end;
  exception when sqlstate '23514' then null;
  end;
end $$;

-- ── Ook `meta_bronniveau()` weigert hard ────────────────────────────────────
--  Zij delegeert naar `meta_basisniveau()`, dus in theorie erft zij de weigering.
--  Dat is precies het soort aanname dat gemeten hoort te worden: een latere
--  herdefinitie kan die delegatie wegnemen zonder dat iets het opmerkt.
do $$
declare v jsonb;
begin
  v := public.meta_bronniveau('{"adapters":[{"naam":"onbekend"}]}'::jsonb);
  raise exception 'T4-F: meta_bronniveau weigerde een ongeldige vorm NIET (uitkomst: %)',
    case when v ? 'adapters' then 'doorgelaten' else 'stil weggevallen' end;
exception when sqlstate '23514' then null;
end $$;

select 'T4-F adaptersprojectie: alle gedragstests geslaagd' as uitkomst;

rollback;
