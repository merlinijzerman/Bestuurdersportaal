-- ============================================================================
-- Migratie 2026-07-17 — T15: RPC stuurinfo_soli_opslaan (tabs 4/5 invoerlaag)
-- ----------------------------------------------------------------------------
-- WAAROM: T15 bouwt dashboard-tab 4 (Spreidingsbeleid) en tab 5
-- (Solidariteitsbeleid) + hun beheer-invoersecties op het T13-periodemodel
-- (decisions/0074) en het T14-beheerfundament (decisions/0075). Zie
-- decisions/0076. Er komen GEEN nieuwe tabellen: alle tab 4/5-data past in de
-- bestaande fonds_stuurinfo_kpi/-reeks/-reserve (RLS + audittriggers gelden
-- automatisch, incl. het T14-auditlog — geen triggerwijziging nodig).
--
-- ÉÉN WIJZIGING: RPC stuurinfo_soli_opslaan — atomische save van de
-- Solidariteit-invoersectie. Waarom een RPC (en voor Spreiding niet): de
-- soli-save raakt DRIE tabellen (reeks: 4 vullingsbronnen; kpi: uitdeling;
-- reserve: bandgrenzen-update) — losse upserts zouden bij een partiële fout
-- een vulling↔grenzen-desync achterlaten. De Spreiding-save raakt alleen
-- fonds_stuurinfo_kpi en loopt app-side als één batch-upsert (één statement =
-- atomisch); een RPC voegt daar niets toe (decisions/0076).
--
-- DATAMODEL-BESLUITEN (decisions/0076):
--   * De bandbreedte van de solidariteitsreserve blijft UITSLUITEND op de
--     reserve-rij (ondergrens/bovengrens) — dezelfde éne bron die het
--     tab 1-stoplicht voedt. Bewuste afwijking van de werkopdracht-suggestie
--     (kpi-rijen soli_band_*): een kpi-duplicaat zou een tweede waarheid zijn.
--     Deze RPC UPDATE't dus alleen de grenzen op de bestaande soli-rij;
--     stand/pct_waarde blijven van de balans-save (één bron per bedrag).
--   * Micro-langleven = één bron met tab 3 (Biometrische rendementen): het
--     resultaat micro-langleven dat de reserve voedt leeft als reeks-punt
--     soli_vulling.micro_langleven. Het latere tab 3-ticket leest/schrijft
--     DITZELFDE punt — nooit een tweede, losse invoer van hetzelfde bedrag.
--   * Eindstand-consistentie is HARD (bevestigd door Merlin): beginstand
--     (= soli-stand vorige periode) + netto vulling − uitdeling moet exact de
--     soli-stand van deze periode zijn (balans-invoer). Afwijking → weigering
--     (SOLI_EINDSTAND_ONGELIJK, tolerantie 0.005 zoals het balansevenwicht).
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
-- in Supabase draaien, DAN code-deploy (migratie-eerst). Sorteert ná t14b.
-- ROLLBACK: 2026_07_17_t15_stuurinfo_spreiding_soli_ROLLBACK.sql
-- TENANT-IMPACT: additief (alleen een nieuwe functie); geen schema-/data-/
-- policywijziging. Bestaande app-code ongewijzigd.
-- ============================================================================

begin;

-- ── RPC stuurinfo_soli_opslaan — atomische save Solidariteit-sectie ──────────
-- De app-laag (route handler) valideert vóór de call (allowlist 400,
-- waardechecks 422); de checks hier zijn defense-in-depth op DB-niveau
-- (guardrail: governance-logica niet uitsluitend app-side).
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

-- Grant-hygiëne (T14b-les): PUBLIC erft standaard EXECUTE — expliciet intrekken.
revoke execute on function public.stuurinfo_soli_opslaan(
  text, text, jsonb, numeric, numeric, numeric
) from public, anon;
grant execute on function public.stuurinfo_soli_opslaan(
  text, text, jsonb, numeric, numeric, numeric
) to authenticated;

commit;

-- ── Verificatie (handmatig ná de migratie) ──────────────────────────────────
-- 1. RPC bestaat met SECURITY INVOKER (prosecdef = false):
--      select proname, prosecdef from pg_proc where proname = 'stuurinfo_soli_opslaan';
-- 2. anon/PUBLIC hebben geen execute:
--      select has_function_privilege('anon',
--        'public.stuurinfo_soli_opslaan(text,text,jsonb,numeric,numeric,numeric)',
--        'execute');  -- verwacht: false
-- 3. Eindstand-check werkt: aanroep als beheerder met een vulling die niet op
--    de soli-stand sluit → SOLI_EINDSTAND_ONGELIJK; met een niet-bestaande
--    periode → SOLI_RESERVE_ONTBREEKT.
