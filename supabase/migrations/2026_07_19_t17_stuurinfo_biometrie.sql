-- ============================================================================
-- Migratie 2026-07-19 — T17: tab 3 (Biometrische rendementen) — RPC-koppeling
-- ----------------------------------------------------------------------------
-- WAAROM: T17 bouwt dashboard-tab 3 (Biometrische rendementen) + de beheer-
-- invoersectie "Biometrisch" op het T13-periodemodel (decisions/0074) en het
-- T14–T16-beheerfundament (decisions/0075/0076/0077). Zie decisions/0078.
-- Er komen GEEN nieuwe tabellen én GEEN nieuwe RPC: de biometrische bronnen
-- passen in fonds_stuurinfo_reeks (RLS + audittriggers gelden automatisch)
-- en de biometrie-save raakt uitsluitend die ene tabel → één app-side
-- batch-upsert is al atomisch (spreiding-precedent, decisions/0076-afweging).
--
-- NIEUWE REEKS-PUNTEN (geschreven door de app-laag, geseed in t17b):
--   * langleven:     micro (±), macro (±), vrijval (>= 0, opbrengst).
--     Netto langleven resultaat = micro + macro + vrijval — AFGELEID, nooit
--     opgeslagen.
--   * risicodekking: ppwzp_toegekend (<= 0), aopvi_toegekend (<= 0).
--     Resultaat PP/WZP  = premie_component.risico_ppwzp + ppwzp_toegekend;
--     Resultaat AO/PVI  = premie_component.risico_aop + .risico_pvi
--                         + aopvi_toegekend — AFGELEID, nooit opgeslagen.
--
-- ÉÉN-BRON-KOPPELINGEN (decisions/0078, bevestigd door Merlin):
--   * Tab 5: het NETTO langleven-resultaat is de langleven-post in de
--     solidariteitsreserve-ontwikkeling. Reader-afleiding: het opgeslagen
--     punt soli_vulling.micro_langleven VERVALT (t17b ruimt op — vervangt de
--     0076-formulering "tab 3 schrijft ditzelfde punt"); leeslaag én RPC
--     leiden de post af uit de langleven-reeks. Geen dubbele opslag.
--   * Tab 6: de resultaten PP/WZP en AO/PVI zijn mutatieregels in de
--     operationele-reserve-ontwikkeling — HARD in de RPC-check (soli-patroon):
--     vorige stand + som(8 ingevoerde bronnen) + resultaat PP/WZP
--     + resultaat AO/PVI = stand. Ontbrekende biometrie-/premie-invoer
--     terwijl de check draait → benoemde weigering.
--   * Tab 7: de binnengekomen risicopremies zijn de BESTAANDE
--     premie_component-rijen (risico_ppwzp, risico_aop, risico_pvi) — tab 3
--     en de biometrie-invoer lezen die alleen (read-only referentie).
--
-- TWEE WIJZIGINGEN (create or replace, signaturen ongewijzigd → ACL's blijven):
--   1. stuurinfo_soli_opslaan — p_vulling wordt exact DRIE invoerbronnen
--      (premie, rendement, overrendementsbijdrage); het netto langleven-
--      resultaat leest de functie zelf uit de langleven-reeks
--      (SOLI_LANGLEVEN_ONTBREEKT als die er niet volledig is — "vul eerst
--      Biometrisch in"). Eindstand-check ongewijzigd hard.
--   2. stuurinfo_operationeel_opslaan — de mutatie-consistentiecheck telt de
--      twee afgeleide resultaten mee (OPER_PREMIE_ONTBREEKT /
--      OPER_BIOMETRIE_ONTBREEKT bij ontbrekende bron terwijl de check draait).
--
-- RICHTINGSPATROON (bestaand precedent): elke save checkt tegen z'n ankers;
-- latere edits stroomopwaarts (balans-, premie- of biometrie-save ná een
-- soli-/oper-save) worden door de leeslaag gesignaleerd via `consistent` —
-- de biometrie-save zelf heeft bewust géén cross-check.
--
-- SECURITY INVOKER (T14b-patroon): alle T13-RLS-policies (schrijven = eigen
-- fonds + voorzitter/beheerder, WITH CHECK) blijven onverkort gelden; fonds_id
-- komt UITSLUITEND uit auth.uid() → profielen (geen parameter).
--
-- HARDE SCOPEGRENS (ongewijzigd): GEEN deelnemer-PII; alles fonds-aggregaat;
-- populatie_n wordt door de invoerlaag nooit gezet (blijft NULL).
--
-- Idempotent (create or replace / herhaalbare grants). Transactioneel. Eerst
-- in Supabase draaien, DAN code-deploy (migratie-eerst). Sorteert ná t16b;
-- draai t17b (seed) direct erna — tot die tijd weigert de soli-RPC nieuwe
-- saves met SOLI_LANGLEVEN_ONTBREEKT (bestaande data blijft leesbaar).
-- ROLLBACK: 2026_07_19_t17_stuurinfo_biometrie_ROLLBACK.sql
-- TENANT-IMPACT: geen schema-/data-/policywijziging; twee functie-vervangingen
-- met ongewijzigde signaturen en gelijk security-model.
-- ============================================================================

begin;

-- ── 1. RPC stuurinfo_soli_opslaan v2 — netto langleven uit de langleven-reeks ─
-- De app-laag (route handler) valideert vóór de call (allowlist 400,
-- waardechecks 422); de checks hier zijn defense-in-depth op DB-niveau
-- (guardrail: governance-logica niet uitsluitend app-side).
create or replace function public.stuurinfo_soli_opslaan(
  p_periode     text,
  p_invoer_bron text,
  p_vulling     jsonb,    -- {"premie": 1.1, "rendement": 4.6, "overrendementsbijdrage": 4.9}
  p_uitdeling   numeric,
  p_ondergrens  numeric,  -- band solidariteitsreserve, % van pct_basis (null = geen grens)
  p_bovengrens  numeric
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_fonds_id   uuid;
  v_langleven  numeric;
  v_lang_n     int;
  v_netto      numeric;
  v_stand      numeric;
  v_vorige     numeric;
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

  -- Niet-object-parameter geeft een benoemde weigering (T16-les).
  if jsonb_typeof(p_vulling) is distinct from 'object' then
    raise exception 'ONGELDIGE_WAARDE';
  end if;

  -- Exhaustieve key-allowlist: exact de DRIE invoerbronnen, niets meer of
  -- minder. Afgeleide grootheden (netto vulling, beginstand, eindstand) én
  -- het netto langleven-resultaat (afgeleid uit de langleven-reeks, tab 3)
  -- bestaan hier bewust niet als invoer.
  if (select count(*) from jsonb_object_keys(p_vulling)) <> 3
     or not (p_vulling ?& array['premie','rendement','overrendementsbijdrage']) then
    raise exception 'ONGELDIGE_VULLING';
  end if;
  -- Elke waarde moet een JSON-number zijn (JSON-null zou de som-check stil
  -- passeren — T14b-les). Negatief mag: ±-posten.
  if exists (select 1 from jsonb_each(p_vulling) where jsonb_typeof(value) <> 'number') then
    raise exception 'ONGELDIGE_WAARDE';
  end if;
  if p_uitdeling is null or p_uitdeling < 0 then
    raise exception 'ONGELDIGE_WAARDE';
  end if;
  if p_ondergrens is not null and p_bovengrens is not null
     and p_ondergrens > p_bovengrens then
    raise exception 'ONGELDIGE_GRENZEN';
  end if;

  -- Het netto langleven-resultaat komt uit de langleven-reeks (tab 3 —
  -- decisions/0078, één bron). Alle drie de bronnen moeten er staan: een
  -- halve som zou stil een verkeerd netto geven.
  select sum(waarde), count(*) into v_langleven, v_lang_n
  from public.fonds_stuurinfo_reeks
  where fonds_id = v_fonds_id and periode = p_periode
    and reeks_key = 'langleven'
    and punt_key in ('micro','macro','vrijval')
    and waarde is not null;
  if coalesce(v_lang_n, 0) <> 3 then
    raise exception 'SOLI_LANGLEVEN_ONTBREEKT';
  end if;

  -- De soli-reserve-rij van deze periode moet bestaan: de stand komt uit de
  -- balans-save (één bron per bedrag) en de grenzen kunnen alleen op een
  -- bestaande rij (stand is NOT NULL). Zonder rij: eerst balans opslaan.
  select stand into v_stand
  from public.fonds_stuurinfo_reserve
  where fonds_id = v_fonds_id and periode = p_periode
    and reserve_key = 'solidariteitsreserve';
  if v_stand is null then
    raise exception 'SOLI_RESERVE_ONTBREEKT';
  end if;

  select sum(value::numeric) + v_langleven into v_netto from jsonb_each_text(p_vulling);

  -- Harde eindstand-consistentie (decisions/0076): als er een voorgaande
  -- periode met soli-rij bestaat, moet vorige stand + netto − uitdeling exact
  -- de huidige stand zijn. Oudste periode: geen check mogelijk (beginstand
  -- wordt in de leeslaag teruggerekend).
  select r.stand into v_vorige
  from public.fonds_stuurinfo_reserve r
  join public.fonds_stuurinfo_periode p
    on p.fonds_id = r.fonds_id and p.periode = r.periode
  where r.fonds_id = v_fonds_id
    and r.reserve_key = 'solidariteitsreserve'
    and p.volgorde < (select volgorde from public.fonds_stuurinfo_periode
                      where fonds_id = v_fonds_id and periode = p_periode)
  order by p.volgorde desc
  limit 1;
  if v_vorige is not null
     and abs(v_vorige + v_netto - p_uitdeling - v_stand) >= 0.005 then
    raise exception 'SOLI_EINDSTAND_ONGELIJK';
  end if;

  -- (1) Vullingsbronnen: vaste labels/volgorde in de functie (geen
  --     vrije-tekstkanaal — T14b-patroon). Volgorde 3 blijft gereserveerd
  --     voor de AFGELEIDE langleven-post (leeslaag, tab 3) — hier bewust
  --     geen rij.
  insert into public.fonds_stuurinfo_reeks
    (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde, invoer_bron)
  select v_fonds_id, p_periode, 'soli_vulling', d.punt_key, d.label, d.volgorde,
         (p_vulling ->> d.punt_key)::numeric, p_invoer_bron
  from (values
    ('premie','Premie',1),
    ('rendement','Rendement',2),
    ('overrendementsbijdrage','Overrendementsbijdrage',4)
  ) as d(punt_key, label, volgorde)
  on conflict (fonds_id, periode, reeks_key, punt_key) do update set
    label = excluded.label, volgorde = excluded.volgorde,
    waarde = excluded.waarde, invoer_bron = excluded.invoer_bron,
    bijgewerkt = now();

  -- (2) Uitdeling als KPI (één scalaire waarde per periode).
  insert into public.fonds_stuurinfo_kpi
    (fonds_id, periode, kpi_key, label, waarde, eenheid, volgorde, invoer_bron)
  values (v_fonds_id, p_periode, 'soli_uitdeling',
          'Uitdeling solidariteitsreserve', p_uitdeling, 'mln', 20, p_invoer_bron)
  on conflict (fonds_id, periode, kpi_key) do update set
    label = excluded.label, waarde = excluded.waarde, eenheid = excluded.eenheid,
    delta = null, toelichting = null, volgorde = excluded.volgorde,
    invoer_bron = excluded.invoer_bron, bijgewerkt = now();

  -- (3) Bandgrenzen op de soli-reserve-rij — ALLEEN de grenzen; stand en
  --     pct_waarde blijven van de balans-save (één bron per bedrag).
  update public.fonds_stuurinfo_reserve
  set ondergrens = p_ondergrens, bovengrens = p_bovengrens,
      invoer_bron = p_invoer_bron, bijgewerkt = now()
  where fonds_id = v_fonds_id and periode = p_periode
    and reserve_key = 'solidariteitsreserve';
end;
$$;

-- ── 2. RPC stuurinfo_operationeel_opslaan v2 — resultaten risicodekkingen ────
-- Ongewijzigd t.o.v. T16 behalve de consistentiecheck: die telt nu de twee
-- AFGELEIDE resultaten (PP/WZP en AO/PVI, tab 3) mee — decisions/0078.
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
  v_uid             uuid := auth.uid();
  v_fonds_id        uuid;
  v_totaal          numeric;
  v_stand           numeric;
  v_vorige          numeric;
  v_ppwzp_premie    numeric;
  v_aopvi_premie    numeric;
  v_premie_n        int;
  v_ppwzp_toegekend numeric;
  v_aopvi_toegekend numeric;
  v_dekking_n       int;
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
  -- minder. Afgeleide grootheden (totaal mutatie, primo, ultimo, resultaten
  -- PP/WZP en AO/PVI) bestaan hier bewust niet — die leidt de leeslaag af.
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

  -- Harde mutatie-consistentie (decisions/0077 + 0078, soli-patroon): als er
  -- een voorgaande periode met oper-rij bestaat, moet vorige stand + totaal
  -- ingevoerde mutaties + resultaat PP/WZP + resultaat AO/PVI exact de
  -- huidige stand zijn. De resultaten zijn AFGELEID uit tab 7 (binnengekomen
  -- risicopremies, premie_component) en tab 3 (toegekende dekkingen,
  -- risicodekking) — één bron, nooit hier ingevoerd. Oudste periode: geen
  -- check mogelijk (primo wordt in de leeslaag teruggerekend).
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
  if v_vorige is not null then
    -- Binnengekomen risicopremies (tab 7): alle drie de componenten vereist.
    select sum(waarde) filter (where punt_key = 'risico_ppwzp'),
           sum(waarde) filter (where punt_key in ('risico_aop','risico_pvi')),
           count(*)
    into v_ppwzp_premie, v_aopvi_premie, v_premie_n
    from public.fonds_stuurinfo_reeks
    where fonds_id = v_fonds_id and periode = p_periode
      and reeks_key = 'premie_component'
      and punt_key in ('risico_ppwzp','risico_aop','risico_pvi')
      and waarde is not null;
    if coalesce(v_premie_n, 0) <> 3 then
      raise exception 'OPER_PREMIE_ONTBREEKT';
    end if;
    -- Toegekende dekkingen (tab 3): beide punten vereist.
    select sum(waarde) filter (where punt_key = 'ppwzp_toegekend'),
           sum(waarde) filter (where punt_key = 'aopvi_toegekend'),
           count(*)
    into v_ppwzp_toegekend, v_aopvi_toegekend, v_dekking_n
    from public.fonds_stuurinfo_reeks
    where fonds_id = v_fonds_id and periode = p_periode
      and reeks_key = 'risicodekking'
      and punt_key in ('ppwzp_toegekend','aopvi_toegekend')
      and waarde is not null;
    if coalesce(v_dekking_n, 0) <> 2 then
      raise exception 'OPER_BIOMETRIE_ONTBREEKT';
    end if;

    if abs(v_vorige + v_totaal
           + (v_ppwzp_premie + v_ppwzp_toegekend)
           + (v_aopvi_premie + v_aopvi_toegekend)
           - v_stand) >= 0.005 then
      raise exception 'OPER_MUTATIE_ONGELIJK';
    end if;
  end if;

  -- (1) Mutatiebronnen: vaste labels/volgorde in de functie (geen
  --     vrije-tekstkanaal — T14b-patroon). "Premie" betreft de kostenopslag;
  --     de TWK-/verrekeningsposten zijn werkhypothese (decisions/0077).
  --     De AFGELEIDE resultaatregels PP/WZP en AO/PVI (tab 3) toont de
  --     leeslaag ná 'Verrekening reserves' — hier bewust geen rijen.
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

-- Grant-hygiëne (T14b-les): create or replace met ongewijzigde signatuur
-- behoudt de ACL, maar we herbevestigen expliciet (defensief, idempotent).
revoke execute on function public.stuurinfo_soli_opslaan(
  text, text, jsonb, numeric, numeric, numeric
) from public, anon;
grant execute on function public.stuurinfo_soli_opslaan(
  text, text, jsonb, numeric, numeric, numeric
) to authenticated;

revoke execute on function public.stuurinfo_operationeel_opslaan(
  text, text, jsonb, numeric, numeric, numeric, jsonb, jsonb
) from public, anon;
grant execute on function public.stuurinfo_operationeel_opslaan(
  text, text, jsonb, numeric, numeric, numeric, jsonb, jsonb
) to authenticated;

commit;

-- ── Verificatie (handmatig ná de migratie) ──────────────────────────────────
-- 1. RPC's bestaan met SECURITY INVOKER (prosecdef = false):
--      select proname, prosecdef from pg_proc
--       where proname in ('stuurinfo_soli_opslaan','stuurinfo_operationeel_opslaan');
-- 2. anon/PUBLIC hebben geen execute:
--      select has_function_privilege('anon',
--        'public.stuurinfo_soli_opslaan(text,text,jsonb,numeric,numeric,numeric)',
--        'execute');  -- verwacht: false
-- 3. Nieuwe checks werken (als beheerder, ná t17b):
--    - soli-save met 4 vulling-keys → ONGELDIGE_VULLING;
--    - soli-save op een periode zonder langleven-reeks → SOLI_LANGLEVEN_ONTBREEKT;
--    - oper-save op een periode zonder risicodekking-reeks (met voorgaande
--      periode) → OPER_BIOMETRIE_ONTBREEKT.
