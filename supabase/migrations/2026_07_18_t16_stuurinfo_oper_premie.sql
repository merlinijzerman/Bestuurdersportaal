-- ============================================================================
-- Migratie 2026-07-18 — T16: RPC's tabs 6 (Operationeel) + 7 (Premie & comp.)
-- ----------------------------------------------------------------------------
-- WAAROM: T16 bouwt dashboard-tab 6 (Operationeel beleid) en tab 7
-- (Premie- & compensatiebeleid) + hun beheer-invoersecties op het
-- T13-periodemodel (decisions/0074) en het T14/T15-beheerfundament
-- (decisions/0075/0076). Zie decisions/0077. Er komen GEEN nieuwe tabellen:
-- alle tab 6/7-data past in de bestaande fonds_stuurinfo_kpi/-reeks/-reserve
-- (RLS + audittriggers gelden automatisch, incl. het T14-auditlog).
--
-- TWEE WIJZIGINGEN: RPC's stuurinfo_operationeel_opslaan en
-- stuurinfo_premie_opslaan — atomische saves van de twee invoersecties.
-- Waarom RPC's (T15-afweging): beide saves raken MEERDERE tabellen
-- (operationeel: reeks-mutaties + reeks-kostendetail ×2 + 3 kpi's;
-- premie: reeks-componenten ×2 + reeks-depotmutaties + 3 kpi's) — losse
-- upserts zouden bij een partiële fout een desync achterlaten.
--
-- DATAMODEL-BESLUITEN (decisions/0077):
--   * Mutatiebronnen per periode als reeks-punten (oper_mutatie: 8 bronnen
--     incl. kosten geaggregeerd −; comp_mutatie: 6 bronnen incl.
--     onttrekkingen −). Totaal mutatie, primo en ultimo worden in de
--     leeslaag AFGELEID — nooit opgeslagen (stuurinfo-ontwikkeling.ts).
--   * De ULTIMO = de reservestand uit de balans (reserve-rij
--     operationele_reserve = balans-leaf ev_toets_oper; compensatiedepot =
--     ev_comp) — ÉÉN bron per bedrag, zelfde patroon als de soli (T15).
--   * Norm + band operationele reserve als kpi's in € MLN
--     (oper_norm/oper_band_onder/oper_band_boven — spreiding-patroon).
--     BEWUST niet op de reserve-rij: die band is in % van de TV en zou het
--     tab 1-stoplicht wijzigen (reserve blijft daar "monitoring").
--   * Premiecomponenten: € (premie_component) én % grondslag
--     (premie_component_pct) — beide AANGELEVERD (uitvoerder), totaal premie
--     afgeleid. De KPI-tegel toont het afgeleide kwartaaltotaal (besluit
--     Merlin) — geen aangeleverde jaarpremie-kpi.
--   * De uitputtingsprognose (comp_uitputting_prognose, punt per jaar) is
--     SEED/UPLOAD-only en zit bewust NIET in deze RPC's (werkopdracht:
--     tijdreeksen niet met de hand invoeren).
--   * Mutatie-consistentie is HARD (soli-patroon, bevestigd in de plansessie):
--     vorige stand + som(mutaties) moet exact de stand van deze periode zijn
--     (balans-invoer). Afwijking → weigering (OPER_MUTATIE_ONGELIJK resp.
--     COMP_MUTATIE_ONGELIJK, tolerantie 0.005). Oudste periode: geen check
--     (primo wordt in de leeslaag teruggerekend).
--
-- SECURITY INVOKER (T14b-patroon): alle T13-RLS-policies (schrijven = eigen
-- fonds + voorzitter/beheerder, WITH CHECK) blijven onverkort gelden; fonds_id
-- komt UITSLUITEND uit auth.uid() → profielen (geen parameter). Grants:
-- revoke from PUBLIC én anon (PUBLIC erft standaard EXECUTE — T14b-les).
--
-- HARDE SCOPEGRENS (ongewijzigd): GEEN deelnemer-PII; alles fonds-aggregaat;
-- populatie_n wordt door de invoerlaag nooit gezet (blijft NULL).
--
-- Idempotent (create or replace / herhaalbare grants). Transactioneel. Eerst
-- in Supabase draaien, DAN code-deploy (migratie-eerst). Sorteert ná t15b.
-- ROLLBACK: 2026_07_18_t16_stuurinfo_oper_premie_ROLLBACK.sql
-- TENANT-IMPACT: additief (alleen twee nieuwe functies); geen schema-/data-/
-- policywijziging. Bestaande app-code ongewijzigd.
-- ============================================================================

begin;

-- ── RPC stuurinfo_operationeel_opslaan — atomische save Operationeel (tab 6) ──
-- De app-laag (route handler) valideert vóór de call (allowlist 400,
-- waardechecks 422); de checks hier zijn defense-in-depth op DB-niveau
-- (guardrail: governance-logica niet uitsluitend app-side).
create or replace function public.stuurinfo_operationeel_opslaan(
  p_periode           text,
  p_invoer_bron       text,
  p_mutaties          jsonb,   -- {"premie_kostenopslag": 0, "beschermingsrendement": -0.1, …, "kosten": -0.8}
  p_norm              numeric, -- € mln (verplicht)
  p_band_onder        numeric, -- € mln (null = geen grens)
  p_band_boven        numeric,
  p_kosten_realisatie jsonb,   -- {"uitvoeringskosten": 1.9, "vermogensbeheer": 0.9, "bestuur_overig": 0.3}
  p_kosten_begroot    jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_fonds_id uuid;
  v_totaal   numeric;
  v_stand    numeric;
  v_vorige   numeric;
begin
  if v_uid is null then
    raise exception 'NIET_INGELOGD';
  end if;

  -- fonds_id UITSLUITEND server-side afgeleid — nooit een parameter.
  select fonds_id into v_fonds_id from public.profielen where id = v_uid;
  if v_fonds_id is null then
    raise exception 'GEEN_FONDS';
  end if;

  if p_invoer_bron is null or p_invoer_bron not in ('handmatig','upload') then
    raise exception 'ONGELDIGE_INVOER_BRON';
  end if;

  -- Niet-object-parameters (scalar/array) geven een benoemde weigering
  -- i.p.v. een generieke jsonb_object_keys-fout (RLS-review T16).
  if jsonb_typeof(p_mutaties) is distinct from 'object'
     or jsonb_typeof(p_kosten_realisatie) is distinct from 'object'
     or jsonb_typeof(p_kosten_begroot) is distinct from 'object' then
    raise exception 'ONGELDIGE_WAARDE';
  end if;

  -- Exhaustieve key-allowlist: exact de acht mutatiebronnen, niets meer of
  -- minder. Afgeleide grootheden (totaal mutatie, primo, ultimo) bestaan
  -- hier bewust niet — die leidt de leeslaag af.
  if (select count(*) from jsonb_object_keys(p_mutaties)) <> 8
     or not (p_mutaties ?& array['premie_kostenopslag','beschermingsrendement',
                                 'overrendement','gemist_rendement_twk','twk_invaar',
                                 'verrekening_reserves','overig','kosten']) then
    raise exception 'ONGELDIGE_MUTATIES';
  end if;
  -- Elke waarde moet een JSON-number zijn (JSON-null zou de som-check stil
  -- passeren — T14b-les). Negatief mag: rendement/kosten zijn ±-posten.
  if exists (select 1 from jsonb_each(p_mutaties) where jsonb_typeof(value) <> 'number') then
    raise exception 'ONGELDIGE_WAARDE';
  end if;

  -- Kostendetail: exact de drie kostensoorten, alle waarden numbers ≥ 0.
  if (select count(*) from jsonb_object_keys(p_kosten_realisatie)) <> 3
     or not (p_kosten_realisatie ?& array['uitvoeringskosten','vermogensbeheer','bestuur_overig'])
     or (select count(*) from jsonb_object_keys(p_kosten_begroot)) <> 3
     or not (p_kosten_begroot ?& array['uitvoeringskosten','vermogensbeheer','bestuur_overig']) then
    raise exception 'ONGELDIGE_KOSTEN';
  end if;
  -- Eerst het type toetsen, DAN pas casten (aparte checks: de OR-evaluatie-
  -- volgorde is niet gegarandeerd — een string zou anders een cast-fout geven
  -- i.p.v. de benoemde weigering).
  if exists (select 1 from jsonb_each(p_kosten_realisatie) where jsonb_typeof(value) <> 'number')
     or exists (select 1 from jsonb_each(p_kosten_begroot) where jsonb_typeof(value) <> 'number') then
    raise exception 'ONGELDIGE_WAARDE';
  end if;
  if exists (select 1 from jsonb_each_text(p_kosten_realisatie) where value::numeric < 0)
     or exists (select 1 from jsonb_each_text(p_kosten_begroot) where value::numeric < 0) then
    raise exception 'ONGELDIGE_WAARDE';
  end if;

  if p_norm is null or p_norm < 0 then
    raise exception 'ONGELDIGE_WAARDE';
  end if;
  if p_band_onder is not null and p_band_boven is not null
     and p_band_onder > p_band_boven then
    raise exception 'ONGELDIGE_GRENZEN';
  end if;

  -- De oper-reserve-rij van deze periode moet bestaan: de stand (= ultimo)
  -- komt uit de balans-save (één bron per bedrag). Zonder rij: eerst balans
  -- opslaan.
  select stand into v_stand
  from public.fonds_stuurinfo_reserve
  where fonds_id = v_fonds_id and periode = p_periode
    and reserve_key = 'operationele_reserve';
  if v_stand is null then
    raise exception 'OPER_RESERVE_ONTBREEKT';
  end if;

  select sum(value::numeric) into v_totaal from jsonb_each_text(p_mutaties);

  -- Harde mutatie-consistentie (decisions/0077, soli-patroon): als er een
  -- voorgaande periode met oper-rij bestaat, moet vorige stand + totaal
  -- mutatie exact de huidige stand zijn. Oudste periode: geen check mogelijk
  -- (primo wordt in de leeslaag teruggerekend).
  select r.stand into v_vorige
  from public.fonds_stuurinfo_reserve r
  join public.fonds_stuurinfo_periode p
    on p.fonds_id = r.fonds_id and p.periode = r.periode
  where r.fonds_id = v_fonds_id
    and r.reserve_key = 'operationele_reserve'
    and p.volgorde < (select volgorde from public.fonds_stuurinfo_periode
                      where fonds_id = v_fonds_id and periode = p_periode)
  order by p.volgorde desc
  limit 1;
  if v_vorige is not null
     and abs(v_vorige + v_totaal - v_stand) >= 0.005 then
    raise exception 'OPER_MUTATIE_ONGELIJK';
  end if;

  -- (1) Mutatiebronnen: vaste labels/volgorde in de functie (geen
  --     vrije-tekstkanaal — T14b-patroon). "Premie" betreft de kostenopslag;
  --     de TWK-/verrekeningsposten zijn werkhypothese (decisions/0077).
  insert into public.fonds_stuurinfo_reeks
    (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde, invoer_bron)
  select v_fonds_id, p_periode, 'oper_mutatie', d.punt_key, d.label, d.volgorde,
         (p_mutaties ->> d.punt_key)::numeric, p_invoer_bron
  from (values
    ('premie_kostenopslag','Premie',1),
    ('beschermingsrendement','Beschermingsrendement',2),
    ('overrendement','Overrendement',3),
    ('gemist_rendement_twk','Gemist rendement (a.g.v. TWK)',4),
    ('twk_invaar','TWK-invaarmutaties',5),
    ('verrekening_reserves','Verrekening reserves',6),
    ('overig','Overig',7),
    ('kosten','Kosten (geaggregeerd)',8)
  ) as d(punt_key, label, volgorde)
  on conflict (fonds_id, periode, reeks_key, punt_key) do update set
    label = excluded.label, volgorde = excluded.volgorde,
    waarde = excluded.waarde, invoer_bron = excluded.invoer_bron,
    bijgewerkt = now();

  -- (2) Kostendetail: realisatie (YTD) + begroot per kostensoort — beide
  --     AANGELEVERD; bewust géén harde koppeling met de geaggregeerde
  --     kostenpost in de ontwikkeling (YTD vs. kwartaalmutatie).
  insert into public.fonds_stuurinfo_reeks
    (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde, invoer_bron)
  select v_fonds_id, p_periode, r.reeks_key, d.punt_key, d.label, d.volgorde,
         (case when r.reeks_key = 'oper_kosten_realisatie'
               then p_kosten_realisatie else p_kosten_begroot end ->> d.punt_key)::numeric,
         p_invoer_bron
  from (values
    ('uitvoeringskosten','Uitvoeringskosten',1),
    ('vermogensbeheer','Vermogensbeheer',2),
    ('bestuur_overig','Bestuur & overig',3)
  ) as d(punt_key, label, volgorde)
  cross join (values ('oper_kosten_realisatie'), ('oper_kosten_begroot')) as r(reeks_key)
  on conflict (fonds_id, periode, reeks_key, punt_key) do update set
    label = excluded.label, volgorde = excluded.volgorde,
    waarde = excluded.waarde, invoer_bron = excluded.invoer_bron,
    bijgewerkt = now();

  -- (3) Norm + band als kpi's in € mln (band null = geen grens; de rij wordt
  --     wél geschreven zodat de leeslaag "geen grens" van "nooit ingevoerd"
  --     kan onderscheiden — spreiding-patroon).
  insert into public.fonds_stuurinfo_kpi
    (fonds_id, periode, kpi_key, label, waarde, eenheid, volgorde, invoer_bron)
  select v_fonds_id, p_periode, d.kpi_key, d.label, d.waarde, 'mln', d.volgorde, p_invoer_bron
  from (values
    ('oper_norm','Norm operationele reserve', p_norm, 30),
    ('oper_band_onder','Band operationele reserve — ondergrens', p_band_onder, 31),
    ('oper_band_boven','Band operationele reserve — bovengrens', p_band_boven, 32)
  ) as d(kpi_key, label, waarde, volgorde)
  on conflict (fonds_id, periode, kpi_key) do update set
    label = excluded.label, waarde = excluded.waarde, eenheid = excluded.eenheid,
    delta = null, toelichting = null, volgorde = excluded.volgorde,
    invoer_bron = excluded.invoer_bron, bijgewerkt = now();
end;
$$;

-- ── RPC stuurinfo_premie_opslaan — atomische save Premie & compensatie (tab 7)
create or replace function public.stuurinfo_premie_opslaan(
  p_periode         text,
  p_invoer_bron     text,
  p_componenten_eur jsonb,   -- {"spaarpremie": 15.8, …, "opslag_toekomstige_kosten": 0.4}
  p_componenten_pct jsonb,   -- zelfde keys, % van de premiegrondslag
  p_comp_mutaties   jsonb,   -- {"premie": 0, …, "onttrekkingen": -1.6, "overig": 0.1}
  p_toekenning      numeric, -- compensatietoekenning per jaar (€ mln, ≥ 0)
  p_startomvang     numeric, -- startomvang depot (€ mln; null = onbekend)
  p_ondergrens_pct  numeric  -- ondergrens als % van de startomvang (null = geen)
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_fonds_id uuid;
  v_totaal   numeric;
  v_stand    numeric;
  v_vorige   numeric;
begin
  if v_uid is null then
    raise exception 'NIET_INGELOGD';
  end if;

  -- fonds_id UITSLUITEND server-side afgeleid — nooit een parameter.
  select fonds_id into v_fonds_id from public.profielen where id = v_uid;
  if v_fonds_id is null then
    raise exception 'GEEN_FONDS';
  end if;

  if p_invoer_bron is null or p_invoer_bron not in ('handmatig','upload') then
    raise exception 'ONGELDIGE_INVOER_BRON';
  end if;

  -- Niet-object-parameters geven een benoemde weigering (zie oper-RPC).
  if jsonb_typeof(p_componenten_eur) is distinct from 'object'
     or jsonb_typeof(p_componenten_pct) is distinct from 'object'
     or jsonb_typeof(p_comp_mutaties) is distinct from 'object' then
    raise exception 'ONGELDIGE_WAARDE';
  end if;

  -- Premiecomponenten: exact de zes componenten in BEIDE sets (€ en %);
  -- afgeleide totalen bestaan niet in de payload-vorm. € en % zijn beide
  -- aangeleverd (uitvoerder) — premies kunnen niet negatief zijn.
  if (select count(*) from jsonb_object_keys(p_componenten_eur)) <> 6
     or not (p_componenten_eur ?& array['spaarpremie','risico_ppwzp','risico_aop',
                                        'risico_pvi','opslag_uitvoeringskosten',
                                        'opslag_toekomstige_kosten'])
     or (select count(*) from jsonb_object_keys(p_componenten_pct)) <> 6
     or not (p_componenten_pct ?& array['spaarpremie','risico_ppwzp','risico_aop',
                                        'risico_pvi','opslag_uitvoeringskosten',
                                        'opslag_toekomstige_kosten']) then
    raise exception 'ONGELDIGE_COMPONENTEN';
  end if;
  -- Eerst het type toetsen, DAN pas casten (aparte checks — zie de
  -- oper-RPC-toelichting over de OR-evaluatievolgorde).
  if exists (select 1 from jsonb_each(p_componenten_eur) where jsonb_typeof(value) <> 'number')
     or exists (select 1 from jsonb_each(p_componenten_pct) where jsonb_typeof(value) <> 'number') then
    raise exception 'ONGELDIGE_WAARDE';
  end if;
  if exists (select 1 from jsonb_each_text(p_componenten_eur) where value::numeric < 0)
     or exists (select 1 from jsonb_each_text(p_componenten_pct)
                where value::numeric < 0 or value::numeric > 100) then
    raise exception 'ONGELDIGE_WAARDE';
  end if;

  -- Depot-mutaties: exact de zes bronnen; ± toegestaan (onttrekkingen −).
  if (select count(*) from jsonb_object_keys(p_comp_mutaties)) <> 6
     or not (p_comp_mutaties ?& array['premie','beschermingsrendement','overrendement',
                                      'onttrekkingen','verrekening_reserves','overig']) then
    raise exception 'ONGELDIGE_MUTATIES';
  end if;
  if exists (select 1 from jsonb_each(p_comp_mutaties) where jsonb_typeof(value) <> 'number') then
    raise exception 'ONGELDIGE_WAARDE';
  end if;

  if p_toekenning is null or p_toekenning < 0 then
    raise exception 'ONGELDIGE_WAARDE';
  end if;
  if p_startomvang is not null and p_startomvang <= 0 then
    raise exception 'ONGELDIGE_WAARDE';
  end if;
  if p_ondergrens_pct is not null and (p_ondergrens_pct < 0 or p_ondergrens_pct > 100) then
    raise exception 'ONGELDIGE_GRENZEN';
  end if;

  -- De depot-reserve-rij van deze periode moet bestaan: de stand (= ultimo)
  -- komt uit de balans-save (één bron per bedrag).
  select stand into v_stand
  from public.fonds_stuurinfo_reserve
  where fonds_id = v_fonds_id and periode = p_periode
    and reserve_key = 'compensatiedepot';
  if v_stand is null then
    raise exception 'COMP_RESERVE_ONTBREEKT';
  end if;

  select sum(value::numeric) into v_totaal from jsonb_each_text(p_comp_mutaties);

  -- Harde mutatie-consistentie (decisions/0077, soli-patroon).
  select r.stand into v_vorige
  from public.fonds_stuurinfo_reserve r
  join public.fonds_stuurinfo_periode p
    on p.fonds_id = r.fonds_id and p.periode = r.periode
  where r.fonds_id = v_fonds_id
    and r.reserve_key = 'compensatiedepot'
    and p.volgorde < (select volgorde from public.fonds_stuurinfo_periode
                      where fonds_id = v_fonds_id and periode = p_periode)
  order by p.volgorde desc
  limit 1;
  if v_vorige is not null
     and abs(v_vorige + v_totaal - v_stand) >= 0.005 then
    raise exception 'COMP_MUTATIE_ONGELIJK';
  end if;

  -- (1) Premiecomponenten: € en % grondslag als twee reeksen met dezelfde
  --     punt_keys (long-format; één scalaire waarde per rij).
  insert into public.fonds_stuurinfo_reeks
    (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde, invoer_bron)
  select v_fonds_id, p_periode, r.reeks_key, d.punt_key, d.label, d.volgorde,
         (case when r.reeks_key = 'premie_component'
               then p_componenten_eur else p_componenten_pct end ->> d.punt_key)::numeric,
         p_invoer_bron
  from (values
    ('spaarpremie','Spaarpremie',1),
    ('risico_ppwzp','Risicopremie PP/WZP',2),
    ('risico_aop','Risicopremie AOP',3),
    ('risico_pvi','Risicopremie PVI',4),
    ('opslag_uitvoeringskosten','Opslag uitvoeringskosten',5),
    ('opslag_toekomstige_kosten','Opslag toekomstige kosten',6)
  ) as d(punt_key, label, volgorde)
  cross join (values ('premie_component'), ('premie_component_pct')) as r(reeks_key)
  on conflict (fonds_id, periode, reeks_key, punt_key) do update set
    label = excluded.label, volgorde = excluded.volgorde,
    waarde = excluded.waarde, invoer_bron = excluded.invoer_bron,
    bijgewerkt = now();

  -- (2) Depot-mutatiebronnen.
  insert into public.fonds_stuurinfo_reeks
    (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde, invoer_bron)
  select v_fonds_id, p_periode, 'comp_mutatie', d.punt_key, d.label, d.volgorde,
         (p_comp_mutaties ->> d.punt_key)::numeric, p_invoer_bron
  from (values
    ('premie','Premie',1),
    ('beschermingsrendement','Beschermingsrendement',2),
    ('overrendement','Overrendement',3),
    ('onttrekkingen','Onttrekkingen (compensatietoekenning)',4),
    ('verrekening_reserves','Verrekening reserves',5),
    ('overig','Overig',6)
  ) as d(punt_key, label, volgorde)
  on conflict (fonds_id, periode, reeks_key, punt_key) do update set
    label = excluded.label, volgorde = excluded.volgorde,
    waarde = excluded.waarde, invoer_bron = excluded.invoer_bron,
    bijgewerkt = now();

  -- (3) Kpi's: toekenning/jaar, startomvang en prognose-ondergrens. De
  --     uitputtingsprognose-REEKS zelf is seed/upload-only en wordt hier
  --     bewust niet geraakt.
  insert into public.fonds_stuurinfo_kpi
    (fonds_id, periode, kpi_key, label, waarde, eenheid, volgorde, invoer_bron)
  select v_fonds_id, p_periode, d.kpi_key, d.label, d.waarde, d.eenheid, d.volgorde, p_invoer_bron
  from (values
    ('comp_toekenning_jaar','Compensatietoekenning per jaar', p_toekenning, 'mln', 40),
    ('comp_startomvang','Startomvang compensatiedepot', p_startomvang, 'mln', 41),
    ('comp_ondergrens_pct','Ondergrens compensatiedepot (% van startomvang)', p_ondergrens_pct, 'pct', 42)
  ) as d(kpi_key, label, waarde, eenheid, volgorde)
  on conflict (fonds_id, periode, kpi_key) do update set
    label = excluded.label, waarde = excluded.waarde, eenheid = excluded.eenheid,
    delta = null, toelichting = null, volgorde = excluded.volgorde,
    invoer_bron = excluded.invoer_bron, bijgewerkt = now();
end;
$$;

-- Grant-hygiëne (T14b-les): PUBLIC erft standaard EXECUTE — expliciet intrekken.
revoke execute on function public.stuurinfo_operationeel_opslaan(
  text, text, jsonb, numeric, numeric, numeric, jsonb, jsonb
) from public, anon;
grant execute on function public.stuurinfo_operationeel_opslaan(
  text, text, jsonb, numeric, numeric, numeric, jsonb, jsonb
) to authenticated;

revoke execute on function public.stuurinfo_premie_opslaan(
  text, text, jsonb, jsonb, jsonb, numeric, numeric, numeric
) from public, anon;
grant execute on function public.stuurinfo_premie_opslaan(
  text, text, jsonb, jsonb, jsonb, numeric, numeric, numeric
) to authenticated;

commit;

-- ── Verificatie (handmatig ná de migratie) ──────────────────────────────────
-- 1. RPC's bestaan met SECURITY INVOKER (prosecdef = false):
--      select proname, prosecdef from pg_proc
--       where proname in ('stuurinfo_operationeel_opslaan','stuurinfo_premie_opslaan');
-- 2. anon/PUBLIC hebben geen execute:
--      select has_function_privilege('anon',
--        'public.stuurinfo_operationeel_opslaan(text,text,jsonb,numeric,numeric,numeric,jsonb,jsonb)',
--        'execute');  -- verwacht: false
-- 3. Consistentie-check werkt: aanroep als beheerder met mutaties die niet op
--    de reservestanden sluiten → OPER_MUTATIE_ONGELIJK/COMP_MUTATIE_ONGELIJK;
--    met een niet-bestaande periode → OPER_/COMP_RESERVE_ONTBREEKT.
