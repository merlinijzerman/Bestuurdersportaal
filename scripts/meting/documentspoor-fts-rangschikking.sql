-- ============================================================================
--  Documentspoor — FTS-rangschikking van vraag vs. restvraag
--  LOKAAL-ALLEEN, SYNTHETISCH, FAIL-CLOSED. Uitsluitend voor een LEGE
--  wegwerp-Postgres-container; nooit tegen Supabase (ook niet lokaal), Preview
--  of Productie. Het guardblok hieronder weigert vóór de eerste opdracht die
--  iets aanmaakt.
-- ----------------------------------------------------------------------------
--  Draaien (alleen zo):
--    docker run -d --rm --name fts-tijdelijk -e POSTGRES_PASSWORD=x postgres:17
--    docker exec -i fts-tijdelijk psql -U postgres -q -v ON_ERROR_STOP=1 \
--      -v documentspoor_lokaal_ok=ja \
--      -v vraag="Welke beheersmaatregelen noemt DNB in de Good practice ESG risicobeheer pensioenfondsen voor ESG-risico’s?" \
--      -v vor="beheersmaatregelen OR noemt OR dnb OR good OR practice OR esg OR risicobeheer OR pensioenfondsen" \
--      -v rest="welke beheersmaatregelen noemt dnb in de voor esg risico s" \
--      -v ror="beheersmaatregelen OR noemt OR dnb OR esg OR risico" \
--      < scripts/meting/documentspoor-fts-rangschikking.sql
--    docker stop fts-tijdelijk
--  `vor`/`ror` = bouwTerugvalFtsQuery(vraag/restvraag); `rest` = bindGenoemdDocument().restvraag.
--
--  De tekst is EIGEN, representatieve formulering (geen kopie van de DNB-
--  publicatie); de contextprefix bootst contextual retrieval na (titel + DNB).
--  Uitkomst 8-10-2026: A/C strikt = 0 rijen; B (volledige vraag, klein corpus):
--  p.5 boven p.1/p.3/GP6 (gelijk); D (restvraag, binnen het document): GP6 op 1,
--  GP7 gelijk met titelpagina's op plek 6, "mitigerende acties"-variant laag.
--  Bewijst de rangschikkingsVORM, niet de Productietekst, niet de RPC onder RLS
--  en niet het modelantwoord.
-- ============================================================================

-- ── LOKAAL-ALLEEN GUARD (fail-closed) ───────────────────────────────────────
-- Stopt bij de eerste fout, ook als de aanroeper -v ON_ERROR_STOP=1 vergat.
\set ON_ERROR_STOP on
-- Weigert tenzij ALLE voorwaarden gelden:
--   1. psql -v documentspoor_lokaal_ok=ja (vertaald naar GUC documentspoor.lokaal_ok);
--   2. geen Supabase/app-database: geen schema auth, geen public.tenant_domains,
--      geen public.document_chunks, geen public.documenten;
--   3. inet_server_addr() is null (unix-socket) of loopback/docker/privé;
--   4. geen PostgREST-sessie (request.jwt.claims leeg).
\if :{?documentspoor_lokaal_ok}
select set_config('documentspoor.lokaal_ok', :'documentspoor_lokaal_ok', false) as documentspoor_lokaal_ok;
\endif
do $documentspoor_guard$
declare
  v_addr inet := inet_server_addr();
begin
  if current_setting('documentspoor.lokaal_ok', true) is distinct from 'ja' then
    raise exception 'DOCUMENTSPOOR-GUARD: zet psql -v documentspoor_lokaal_ok=ja (alleen in een lege wegwerp-Postgres); geweigerd vóór enige wijziging.';
  end if;
  if to_regnamespace('auth') is not null
     or to_regclass('public.tenant_domains') is not null
     or to_regclass('public.document_chunks') is not null
     or to_regclass('public.documenten') is not null then
    raise exception 'DOCUMENTSPOOR-GUARD: Supabase-/appschema aanwezig — dit is geen lege wegwerp-Postgres; geweigerd vóór enige wijziging.';
  end if;
  if v_addr is not null
     and not (v_addr <<= inet '127.0.0.0/8' or v_addr = inet '::1' or v_addr <<= inet '172.16.0.0/12'
              or v_addr <<= inet '10.0.0.0/8' or v_addr <<= inet '192.168.0.0/16') then
    raise exception 'DOCUMENTSPOOR-GUARD: serveradres % is geen loopback-/docker-adres; geweigerd vóór enige wijziging.', v_addr;
  end if;
  if nullif(current_setting('request.jwt.claims', true), '') is not null then
    raise exception 'DOCUMENTSPOOR-GUARD: request.jwt.claims is gezet (PostgREST-sessie?); geweigerd vóór enige wijziging.';
  end if;
end $documentspoor_guard$;
-- ── einde guard ──────────────────────────────────────────────────────────────

create temp table c (id text, doc text, pagina int, prefix text, tekst text,
  zv tsvector generated always as (to_tsvector('dutch', coalesce(prefix || ' ', '') || tekst)) stored);
-- Synthetisch, representatief. Prefix zoals contextual retrieval hem schrijft: documenttitel + uitgever + onderwerp.
insert into c (id, doc, pagina, prefix, tekst) values
 ('esg-p1','esg',1,'Fragment uit de DNB Good practice ESG risicobeheer pensioenfondsen (2023); titelpagina.','Good practice ESG-risicobeheer pensioenfondsen. De Nederlandsche Bank, 2023.'),
 ('esg-p3','esg',3,'Fragment uit de DNB Good practice ESG risicobeheer pensioenfondsen (2023); inhoudsopgave.','Inhoud. Inleiding; ESG-risicobeheer bij pensioenfondsen; good practices per onderdeel van het risicobeheer.'),
 ('esg-p5','esg',5,'Fragment uit de DNB Good practice ESG risicobeheer pensioenfondsen (2023); inleiding over het onderzoek.','Inleiding. DNB heeft bij pensioenfondsen onderzocht hoe ESG-risico''s in het risicobeheer zijn verankerd. Deze good practice beschrijft de bevindingen.'),
 ('esg-p9','esg',9,'Fragment uit de DNB Good practice ESG risicobeheer pensioenfondsen (2023); risico-identificatie.','Risico-identificatie. Het fonds brengt in kaart welke klimaat- en milieurisico''s materieel zijn voor de portefeuille.'),
 ('esg-p17a','esg',17,'Fragment uit de DNB Good practice ESG risicobeheer pensioenfondsen (2023); good practice 6 over mitigatie.','GP6 Beheersmaatregelen. Het fonds legt per materieel ESG-risico vast welke beheersmaatregelen het neemt om het risico te mitigeren, zoals engagement, uitsluiting en limieten in het mandaat.'),
 ('esg-p17b','esg',17,'Fragment uit de DNB Good practice ESG risicobeheer pensioenfondsen (2023); good practice 7 over effectiviteit.','GP7 Effectiviteit. Het fonds toetst periodiek of de beheersmaatregelen effectief zijn en rapporteert de uitkomst aan het bestuur.'),
 ('esg-p17c','esg',17,'Fragment uit de DNB Good practice ESG risicobeheer pensioenfondsen (2023); good practice 6 over mitigatie.','GP6. Het fonds legt per materieel risico vast welke mitigerende acties het neemt.'),
 ('esg-p20','esg',20,'Fragment uit de DNB Good practice ESG risicobeheer pensioenfondsen (2023); rapportage.','Rapportage. Het bestuur ontvangt periodiek informatie over ESG-risico''s en de risicohouding.'),
 ('ren-1','ren',4,'Fragment uit de DNB Good practice beheersing renterisico pensioenfondsen.','Good practice beheersing renterisico pensioenfondsen: beheersmaatregelen voor het renterisico.'),
 ('comp-1','comp',2,'Fragment uit de DNB Good Practice inrichting compliancefunctie bij pensioenfondsen.','Good practice compliancefunctie bij pensioenfondsen: rol van de compliancefunctie.'),
 ('pf-1','pf',6,'Fragment uit Pensioenfederatie Duurzaam en verantwoord beleggen good practice.','Good practice duurzaam beleggen: ESG-integratie door pensioenfondsen.');
\echo '== A strikt, volledige vraag, heel corpus (aantal rijen)'
select count(*) from c where zv @@ websearch_to_tsquery('dutch', :'vraag');
\echo '== B OR-terugval volledige vraag, heel corpus (top 8)'
select id, round(ts_rank_cd(zv, q)::numeric,4) r from c, websearch_to_tsquery('dutch', :'vor') q where zv @@ q order by r desc, id limit 8;
\echo '== C strikt restvraag, binnen ESG (aantal)'
select count(*) from c where doc='esg' and zv @@ websearch_to_tsquery('dutch', :'rest');
\echo '== D OR-terugval restvraag, binnen ESG (alle)'
select id, round(ts_rank_cd(zv, q)::numeric,4) r from c, websearch_to_tsquery('dutch', :'ror') q where doc='esg' and zv @@ q order by r desc, id;
\echo '== tsquery-vormen'
select websearch_to_tsquery('dutch', :'vor') vraag_or, websearch_to_tsquery('dutch', :'ror') rest_or;
