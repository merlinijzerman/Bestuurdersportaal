-- ============================================================================
-- Migratie 2026-07-17 (T14b) — hardening auditlog + RPC stuurinfo-invoerlaag
-- ----------------------------------------------------------------------------
-- WAAROM: verwerkt de subagent-reviewbevindingen op T14 (audit-evidence M1 +
-- should-fixes van de RLS- en code-review; zie decisions/0075). De T14-basis-
-- migratie is al op live gedraaid — conform de repo-regel (nooit bestaande
-- migraties achteraf wijzigen) is dit een NIEUWE, idempotente migratie.
--
-- VIER FIXES:
--   1. VOLLEDIGE kolomdekking in de capture-trigger (audit-M1). De T14-versie
--      logde per tabel een handmatige subset (waarde/label/stand/…); kolommen
--      als delta, toelichting, kleur, populatie_n en invoer_bron vielen erbuiten
--      — een directe UPDATE dáárop was door de no-op-guard ONZICHTBAAR in het
--      log. Ernstigst: een ongelogde populatie_n-mutatie kan de n<10-suppressie
--      beïnvloeden. Nu: oud/nieuw = to_jsonb(rij) minus 'bijgewerkt' — elke
--      inhoudskolom telt mee (ook toekomstige kolommen, automatisch), en de
--      no-op-guard is daarmee wél sluitend ("geen inhoudelijke wijziging =
--      geen regel"). invoer_bron zit nu óók in de vergelijking, zodat een
--      bron-wissel (handmatig→upload) met gelijke waarden traceerbaar is.
--   2. Actor-spoofing dicht (audit-S1): de log-INSERT-policy eist voortaan
--      gebruiker_id = auth.uid() — een privileged gebruiker kan geen logregel
--      op naam van een collega inserten. Het trigger-pad zet auth.uid() en
--      blijft dus werken; owner-/seed-writes passeren RLS (actor null).
--   3. RPC-defense-in-depth aangescherpt (code-S2, audit-S2): alle activa-/
--      passiva-waarden moeten jsonb-type 'number' zijn (JSON-null passeerde de
--      som-check stil); p_bron tegen de vaste bronnenlijst; reserve-labels
--      komen voortaan uit een vaste lijst in de functie (aangeleverde labels
--      worden genegeerd — geen vrije-tekstkanaal via directe aanroep).
--   4. Grant-hygiëne (RLS-S1): revoke execute FROM PUBLIC — de bestaande
--      "revoke from anon" was grotendeels symbolisch omdat PUBLIC standaard
--      EXECUTE op public-functies erft. Ook toegepast op het precedent
--      profiel_opslaan (zelfde euvel, zelfde fix).
--
-- Idempotent (create or replace / drop policy if exists / herhaalbare grants).
-- Transactioneel. Eerst in Supabase draaien, DAN code-deploy (migratie-eerst;
-- de code van T14b verandert overigens geen aanroepsignaturen).
-- ROLLBACK: 2026_07_17_t14b_stuurinfo_audit_hardening_ROLLBACK.sql
--           (zet de T14-versies van functie/policy/RPC terug).
-- TENANT-IMPACT: geen schema-/datawijziging; alleen functie-/policy-vervanging.
-- Logregels worden vanaf nu VOLLEDIGER (bredere jsonb-payload) — bestaande
-- regels blijven zoals ze zijn (append-only).
-- ============================================================================

begin;

-- ── 1. Capture-functie: volledige kolomdekking (to_jsonb minus bijgewerkt) ───
create or replace function public.fn_fonds_stuurinfo_capture()
returns trigger language plpgsql as $f$
declare
  v_tabel text;
  v_veld  text;
  v_oud   jsonb;
  v_nieuw jsonb;
  v_naam  text;
begin
  if tg_table_name = 'fonds_stuurinfo_reeks' then
    v_tabel := 'reeks'; v_veld := new.reeks_key || '.' || new.punt_key;
  elsif tg_table_name = 'fonds_stuurinfo_reserve' then
    v_tabel := 'reserve'; v_veld := new.reserve_key;
  elsif tg_table_name = 'fonds_stuurinfo_kpi' then
    v_tabel := 'kpi'; v_veld := new.kpi_key;
  elsif tg_table_name = 'fonds_stuurinfo_periode' then
    v_tabel := 'periode'; v_veld := 'registratie';
  else
    raise exception 'fn_fonds_stuurinfo_capture: onverwachte tabel %', tg_table_name;
  end if;

  -- Volledige rij minus de mutatie-timestamp: élke inhoudskolom (incl. delta,
  -- toelichting, kleur, populatie_n, invoer_bron én toekomstige kolommen)
  -- telt mee in het log en in de no-op-vergelijking (audit-M1).
  v_nieuw := to_jsonb(new) - 'bijgewerkt';
  v_oud := case when tg_op = 'UPDATE' then to_jsonb(old) - 'bijgewerkt' else null end;

  -- No-op-guard: een upsert die de inhoud niet wijzigt logt niet (voorkomt
  -- ~20 identieke regels per save door on conflict do update).
  if tg_op = 'UPDATE' and v_oud is not distinct from v_nieuw then
    return new;
  end if;

  -- Naam-snapshot bij de actor (null bij owner-/seed-writes).
  select naam into v_naam from public.profielen where id = auth.uid();

  insert into public.fonds_stuurinfo_log (
    fonds_id, periode, tabel, veld_key, oude_waarde, nieuwe_waarde,
    invoer_bron, gebruiker_id, gebruiker_naam
  ) values (
    new.fonds_id, new.periode, v_tabel, v_veld, v_oud, v_nieuw,
    new.invoer_bron, auth.uid(), v_naam
  );
  return new;
end;
$f$;

-- ── 2. Log-INSERT-policy: actor kan alleen zichzelf als gebruiker loggen ─────
drop policy if exists "stuurinfo log schrijven priv" on public.fonds_stuurinfo_log;
create policy "stuurinfo log schrijven priv" on public.fonds_stuurinfo_log
  for insert
  with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
    -- Anti-spoofing (T14b): een authenticated insert draagt altijd de eigen
    -- identiteit; het trigger-pad zet auth.uid() en voldoet per definitie.
    and gebruiker_id is not distinct from auth.uid()
  );

-- ── 3. RPC: waarde-typechecks + bron-allowlist + vaste reserve-labels ────────
create or replace function public.stuurinfo_balans_opslaan(
  p_periode            text,
  p_peildatum          date,
  p_bron               text,
  p_invoer_bron        text,
  p_activa             jsonb,   -- {"belegd": 2400, "overig": 80}
  p_passiva            jsonb,   -- {"ev_toets_mvev": 10, ..., "overig": 4} (8 leaves)
  p_reserves           jsonb,   -- array van exact 8 rijen {reserve_key,stand,pct_waarde,ondergrens,bovengrens,volgorde} (label wordt genegeerd)
  p_financieringsgraad numeric
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_fonds_id uuid;
  v_verschil numeric;
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
  -- T14b: bron-allowlist ook op DB-niveau (was alleen app-side).
  if p_bron is null or p_bron not in ('uitvoerder_kwartaal','uitvoerder_maand','handmatig') then
    raise exception 'ONGELDIGE_BRON';
  end if;

  -- Exhaustieve key-allowlist: exact de leaf-posten, niets meer of minder.
  -- Subtotalen (toetsvermogen, eigen vermogen, totalen) bestaan hier bewust
  -- niet — die worden in de leeslaag afgeleid.
  if (select count(*) from jsonb_object_keys(p_activa)) <> 2
     or not (p_activa ?& array['belegd','overig']) then
    raise exception 'ONGELDIGE_ACTIVA';
  end if;
  if (select count(*) from jsonb_object_keys(p_passiva)) <> 8
     or not (p_passiva ?& array['ev_toets_mvev','ev_toets_oper','ev_toets_overig',
                                'ev_soli','ev_comp','tv','vuk','overig']) then
    raise exception 'ONGELDIGE_PASSIVA';
  end if;
  -- T14b: elke waarde moet een JSON-number zijn — een JSON-null passeerde de
  -- som-check stil (sum() negeert null) en schreef een NULL-waarde weg.
  if exists (select 1 from jsonb_each(p_activa)  where jsonb_typeof(value) <> 'number')
     or exists (select 1 from jsonb_each(p_passiva) where jsonb_typeof(value) <> 'number') then
    raise exception 'ONGELDIGE_WAARDE';
  end if;
  if (select count(*) from jsonb_array_elements(p_reserves)) <> 8
     or exists (
       select 1 from jsonb_to_recordset(p_reserves) as r(reserve_key text)
       where r.reserve_key not in ('solidariteitsreserve','mvev_reserve',
         'operationele_reserve','kostenreserve','ao_reserve','ppwzp_reserve',
         'ppwzp_reserve_eerbiedigend','compensatiedepot')
     ) then
    raise exception 'ONGELDIGE_RESERVES';
  end if;

  -- Balansevenwicht hard op DB-niveau (zelfde tolerantie als de leeslaag).
  select (select sum(value::numeric) from jsonb_each_text(p_activa))
       - (select sum(value::numeric) from jsonb_each_text(p_passiva))
    into v_verschil;
  if v_verschil is null or abs(v_verschil) >= 0.005 then
    raise exception 'BALANS_SLUIT_NIET';
  end if;

  -- Eén bron per bedrag: de gekoppelde reservestanden moeten exact de
  -- balanswaarden zijn (geen reeks↔reserve-desync).
  if exists (
    select 1 from jsonb_to_recordset(p_reserves) as r(reserve_key text, stand numeric)
    where (r.reserve_key = 'solidariteitsreserve' and r.stand is distinct from (p_passiva->>'ev_soli')::numeric)
       or (r.reserve_key = 'mvev_reserve'         and r.stand is distinct from (p_passiva->>'ev_toets_mvev')::numeric)
       or (r.reserve_key = 'operationele_reserve' and r.stand is distinct from (p_passiva->>'ev_toets_oper')::numeric)
       or (r.reserve_key = 'compensatiedepot'     and r.stand is distinct from (p_passiva->>'ev_comp')::numeric)
  ) then
    raise exception 'GEKOPPELDE_STAND_ONGELIJK';
  end if;

  -- (1) Periode-registry: volgorde deterministisch (jaar*4 + kwartaal); het
  --     periode-format wordt door de CHECK-constraint op de tabel geborgd.
  insert into public.fonds_stuurinfo_periode
    (fonds_id, periode, peildatum, bron, volgorde, invoer_bron, bijgewerkt)
  values (
    v_fonds_id, p_periode, p_peildatum, p_bron,
    (substring(p_periode from 1 for 4))::integer * 4
      + (substring(p_periode from 6 for 1))::integer,
    p_invoer_bron, now()
  )
  on conflict (fonds_id, periode) do update set
    peildatum = excluded.peildatum, bron = excluded.bron,
    volgorde = excluded.volgorde, invoer_bron = excluded.invoer_bron,
    bijgewerkt = now();

  -- (2) Balans-leaves: vaste taxonomie (labels/volgorde = T13-seed). Alleen
  --     keys uit deze values-lijst worden geschreven.
  insert into public.fonds_stuurinfo_reeks
    (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde, invoer_bron)
  select v_fonds_id, p_periode, d.reeks_key, d.punt_key, d.label, d.volgorde,
         (case when d.reeks_key = 'balans_activa' then p_activa else p_passiva end ->> d.punt_key)::numeric,
         p_invoer_bron
  from (values
    ('balans_activa','belegd','Belegd vermogen',1),
    ('balans_activa','overig','Overige activa, vorderingen en liquiditeiten',2),
    ('balans_passiva','ev_toets_mvev','MVEV-reserve',1),
    ('balans_passiva','ev_toets_oper','Operationele reserve',2),
    ('balans_passiva','ev_toets_overig','Overig',3),
    ('balans_passiva','ev_soli','Solidariteitsreserve',4),
    ('balans_passiva','ev_comp','Compensatiedepot',5),
    ('balans_passiva','tv','Technische voorziening',6),
    ('balans_passiva','vuk','Voorziening uitvoeringskosten',7),
    ('balans_passiva','overig','Overige voorzieningen en passiva',8)
  ) as d(reeks_key, punt_key, label, volgorde)
  on conflict (fonds_id, periode, reeks_key, punt_key) do update set
    label = excluded.label, volgorde = excluded.volgorde,
    waarde = excluded.waarde, invoer_bron = excluded.invoer_bron,
    bijgewerkt = now();

  -- (3) Reserves: 8 rijen. T14b: label/volgorde komen uit de vaste lijst in
  --     de functie (aangeleverde labels genegeerd — geen vrije-tekstkanaal);
  --     pct_waarde is app-side berekend uit stand/TV, de gekoppelde standen
  --     zijn hierboven al tegen de balans getoetst.
  insert into public.fonds_stuurinfo_reserve
    (fonds_id, periode, reserve_key, label, stand, pct_basis, pct_waarde,
     ondergrens, bovengrens, volgorde, invoer_bron)
  select v_fonds_id, p_periode, r.reserve_key, d.label, r.stand,
         'technische_voorziening', r.pct_waarde, r.ondergrens, r.bovengrens,
         d.volgorde, p_invoer_bron
  from jsonb_to_recordset(p_reserves) as r(
    reserve_key text, stand numeric, pct_waarde numeric,
    ondergrens numeric, bovengrens numeric
  )
  join (values
    ('solidariteitsreserve','Solidariteitsreserve',1),
    ('mvev_reserve','MVEV-reserve',2),
    ('operationele_reserve','Operationele reserve',3),
    ('kostenreserve','Kostenreserve',4),
    ('ao_reserve','AO-reserve',5),
    ('ppwzp_reserve','PP/Wzp-reserve',6),
    ('ppwzp_reserve_eerbiedigend','PP/Wzp-reserve eerbiedigend',7),
    ('compensatiedepot','Compensatiedepot',8)
  ) as d(reserve_key, label, volgorde) on d.reserve_key = r.reserve_key
  on conflict (fonds_id, periode, reserve_key) do update set
    label = excluded.label, stand = excluded.stand,
    pct_basis = excluded.pct_basis, pct_waarde = excluded.pct_waarde,
    ondergrens = excluded.ondergrens, bovengrens = excluded.bovengrens,
    volgorde = excluded.volgorde, invoer_bron = excluded.invoer_bron,
    bijgewerkt = now();

  -- (4) Financieringsgraad-KPI. delta/toelichting blijven null (leeslaag leidt
  --     de delta af uit beide periodes — T13-besluit).
  insert into public.fonds_stuurinfo_kpi
    (fonds_id, periode, kpi_key, label, waarde, eenheid, volgorde, invoer_bron)
  values (v_fonds_id, p_periode, 'financieringsgraad', 'Financieringsgraad',
          p_financieringsgraad, 'pct', 1, p_invoer_bron)
  on conflict (fonds_id, periode, kpi_key) do update set
    label = excluded.label, waarde = excluded.waarde, eenheid = excluded.eenheid,
    delta = null, toelichting = null, volgorde = excluded.volgorde,
    invoer_bron = excluded.invoer_bron, bijgewerkt = now();
end;
$$;

-- ── 4. Grant-hygiëne: PUBLIC erft standaard EXECUTE — expliciet intrekken ────
revoke execute on function public.stuurinfo_balans_opslaan(
  text, date, text, text, jsonb, jsonb, jsonb, numeric
) from public, anon;
grant execute on function public.stuurinfo_balans_opslaan(
  text, date, text, text, jsonb, jsonb, jsonb, numeric
) to authenticated;

-- Zelfde euvel bij het precedent profiel_opslaan (RLS-review): ook daar was
-- alleen anon ingetrokken terwijl PUBLIC EXECUTE erft. Functioneel ongewijzigd
-- (de functie fail-closet op NIET_INGELOGD), puur hygiëne.
revoke execute on function public.profiel_opslaan(
  text, uuid, text, text, text, uuid[], uuid[], uuid[]
) from public, anon;
grant execute on function public.profiel_opslaan(
  text, uuid, text, text, text, uuid[], uuid[], uuid[]
) to authenticated;

commit;

-- ── Verificatie (handmatig ná de migratie) ──────────────────────────────────
-- 1. Capture-functie logt volledige rijen: wijzig als beheerder een
--    toelichting op een kpi-rij → er verschijnt een logregel met beide jsonb's
--    inclusief 'toelichting'; een no-op-upsert logt niets.
-- 2. Policy met actor-check:
--      select polname, pg_get_expr(polwithcheck, polrelid) from pg_policy
--       where polrelid = 'public.fonds_stuurinfo_log'::regclass;
--    -- verwacht: with check bevat "gebruiker_id is not distinct from auth.uid()".
-- 3. PUBLIC heeft geen execute meer:
--      select has_function_privilege('anon',
--        'public.stuurinfo_balans_opslaan(text,date,text,text,jsonb,jsonb,jsonb,numeric)',
--        'execute');  -- verwacht: false
-- 4. RPC weigert null-waarden: aanroep met {"belegd": null, ...} → ONGELDIGE_WAARDE.
