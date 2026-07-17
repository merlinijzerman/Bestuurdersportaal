-- ============================================================================
-- ROLLBACK 2026-07-19 — T17: tab 3 (Biometrische rendementen) — RPC-koppeling
-- ----------------------------------------------------------------------------
-- Herstelt de T15-versie van stuurinfo_soli_opslaan (vier vullingsbronnen,
-- incl. micro_langleven als invoer) en de T16-versie van
-- stuurinfo_operationeel_opslaan (check zonder de afgeleide resultaten) —
-- letterlijk overgenomen uit 2026_07_17_t15_stuurinfo_spreiding_soli.sql en
-- 2026_07_18_t16_stuurinfo_oper_premie.sql.
--
-- Volgorde: draai EERST 2026_07_19_t17b_stuurinfo_biometrie_seed_ROLLBACK.sql
-- (herstelt o.a. de soli_vulling.micro_langleven-rijen die de T15-functie
-- verwacht), DAN dit bestand.
-- ============================================================================

begin;

-- ── 1. stuurinfo_soli_opslaan — T15-versie ───────────────────────────────────
create or replace function public.stuurinfo_soli_opslaan(
  p_periode     text,
  p_invoer_bron text,
  p_vulling     jsonb,    -- {"premie": 1.1, "rendement": 4.6, "micro_langleven": -0.6, "overrendementsbijdrage": 4.9}
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

  -- Exhaustieve key-allowlist: exact de vier vullingsbronnen, niets meer of
  -- minder. Afgeleide grootheden (netto vulling, beginstand, eindstand)
  -- bestaan hier bewust niet — die leidt de leeslaag af.
  if (select count(*) from jsonb_object_keys(p_vulling)) <> 4
     or not (p_vulling ?& array['premie','rendement','micro_langleven',
                                'overrendementsbijdrage']) then
    raise exception 'ONGELDIGE_VULLING';
  end if;
  -- Elke waarde moet een JSON-number zijn (JSON-null zou de som-check stil
  -- passeren — T14b-les). Negatief mag: micro-langleven is een ±-resultaat.
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

  select sum(value::numeric) into v_netto from jsonb_each_text(p_vulling);

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
  --     vrije-tekstkanaal — T14b-patroon). micro_langleven = het biometrische
  --     resultaat (tab 3) — één bron, zie de migratieheader.
  insert into public.fonds_stuurinfo_reeks
    (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde, invoer_bron)
  select v_fonds_id, p_periode, 'soli_vulling', d.punt_key, d.label, d.volgorde,
         (p_vulling ->> d.punt_key)::numeric, p_invoer_bron
  from (values
    ('premie','Premie',1),
    ('rendement','Rendement',2),
    ('micro_langleven','Resultaat micro-langleven',3),
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

-- ── 2. stuurinfo_operationeel_opslaan — T16-versie ───────────────────────────
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

-- Grant-hygiëne (T14b-les): herbevestigen na de replace.
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
