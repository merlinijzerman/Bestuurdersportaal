-- ============================================================================
-- ROLLBACK 2026-07-17 (T14b) — hardening auditlog + RPC stuurinfo-invoerlaag
-- ----------------------------------------------------------------------------
-- Zet de T14-basisversies terug van: de capture-functie (subset-payloads),
-- de log-INSERT-policy (zonder actor-check) en de RPC (zonder waarde-type-/
-- bron-checks, met aangeleverde reserve-labels). De PUBLIC-revokes blijven
-- staan (pure hygiëne; terugdraaien zou de oorspronkelijke lek-status
-- herstellen zonder enige functionele reden).
-- Volledige T14-rollback: draai daarna 2026_07_17_t14_stuurinfo_invoer_audit_ROLLBACK.sql.
-- ============================================================================

begin;

-- ── 1. Capture-functie terug naar de T14-subsetversie ───────────────────────
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
    v_nieuw := jsonb_build_object('waarde', new.waarde, 'label', new.label);
    v_oud := case when tg_op = 'UPDATE'
      then jsonb_build_object('waarde', old.waarde, 'label', old.label) else null end;
  elsif tg_table_name = 'fonds_stuurinfo_reserve' then
    v_tabel := 'reserve'; v_veld := new.reserve_key;
    v_nieuw := jsonb_build_object('stand', new.stand, 'pct_waarde', new.pct_waarde,
                                  'ondergrens', new.ondergrens, 'bovengrens', new.bovengrens);
    v_oud := case when tg_op = 'UPDATE'
      then jsonb_build_object('stand', old.stand, 'pct_waarde', old.pct_waarde,
                              'ondergrens', old.ondergrens, 'bovengrens', old.bovengrens) else null end;
  elsif tg_table_name = 'fonds_stuurinfo_kpi' then
    v_tabel := 'kpi'; v_veld := new.kpi_key;
    v_nieuw := jsonb_build_object('waarde', new.waarde, 'eenheid', new.eenheid);
    v_oud := case when tg_op = 'UPDATE'
      then jsonb_build_object('waarde', old.waarde, 'eenheid', old.eenheid) else null end;
  elsif tg_table_name = 'fonds_stuurinfo_periode' then
    v_tabel := 'periode'; v_veld := 'registratie';
    v_nieuw := jsonb_build_object('peildatum', new.peildatum, 'bron', new.bron,
                                  'volgorde', new.volgorde);
    v_oud := case when tg_op = 'UPDATE'
      then jsonb_build_object('peildatum', old.peildatum, 'bron', old.bron,
                              'volgorde', old.volgorde) else null end;
  else
    raise exception 'fn_fonds_stuurinfo_capture: onverwachte tabel %', tg_table_name;
  end if;

  if tg_op = 'UPDATE' and v_oud is not distinct from v_nieuw then
    return new;
  end if;

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

-- ── 2. Log-INSERT-policy terug zonder actor-check ────────────────────────────
drop policy if exists "stuurinfo log schrijven priv" on public.fonds_stuurinfo_log;
create policy "stuurinfo log schrijven priv" on public.fonds_stuurinfo_log
  for insert
  with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  );

-- ── 3. RPC terug naar de T14-basisversie ─────────────────────────────────────
create or replace function public.stuurinfo_balans_opslaan(
  p_periode            text,
  p_peildatum          date,
  p_bron               text,
  p_invoer_bron        text,
  p_activa             jsonb,
  p_passiva            jsonb,
  p_reserves           jsonb,
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

  select fonds_id into v_fonds_id from public.profielen where id = v_uid;
  if v_fonds_id is null then
    raise exception 'GEEN_FONDS';
  end if;

  if p_invoer_bron is null or p_invoer_bron not in ('handmatig','upload') then
    raise exception 'ONGELDIGE_INVOER_BRON';
  end if;

  if (select count(*) from jsonb_object_keys(p_activa)) <> 2
     or not (p_activa ?& array['belegd','overig']) then
    raise exception 'ONGELDIGE_ACTIVA';
  end if;
  if (select count(*) from jsonb_object_keys(p_passiva)) <> 8
     or not (p_passiva ?& array['ev_toets_mvev','ev_toets_oper','ev_toets_overig',
                                'ev_soli','ev_comp','tv','vuk','overig']) then
    raise exception 'ONGELDIGE_PASSIVA';
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

  select (select sum(value::numeric) from jsonb_each_text(p_activa))
       - (select sum(value::numeric) from jsonb_each_text(p_passiva))
    into v_verschil;
  if v_verschil is null or abs(v_verschil) >= 0.005 then
    raise exception 'BALANS_SLUIT_NIET';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_reserves) as r(reserve_key text, stand numeric)
    where (r.reserve_key = 'solidariteitsreserve' and r.stand is distinct from (p_passiva->>'ev_soli')::numeric)
       or (r.reserve_key = 'mvev_reserve'         and r.stand is distinct from (p_passiva->>'ev_toets_mvev')::numeric)
       or (r.reserve_key = 'operationele_reserve' and r.stand is distinct from (p_passiva->>'ev_toets_oper')::numeric)
       or (r.reserve_key = 'compensatiedepot'     and r.stand is distinct from (p_passiva->>'ev_comp')::numeric)
  ) then
    raise exception 'GEKOPPELDE_STAND_ONGELIJK';
  end if;

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

  insert into public.fonds_stuurinfo_reserve
    (fonds_id, periode, reserve_key, label, stand, pct_basis, pct_waarde,
     ondergrens, bovengrens, volgorde, invoer_bron)
  select v_fonds_id, p_periode, r.reserve_key, r.label, r.stand,
         'technische_voorziening', r.pct_waarde, r.ondergrens, r.bovengrens,
         r.volgorde, p_invoer_bron
  from jsonb_to_recordset(p_reserves) as r(
    reserve_key text, label text, stand numeric, pct_waarde numeric,
    ondergrens numeric, bovengrens numeric, volgorde integer
  )
  on conflict (fonds_id, periode, reserve_key) do update set
    label = excluded.label, stand = excluded.stand,
    pct_basis = excluded.pct_basis, pct_waarde = excluded.pct_waarde,
    ondergrens = excluded.ondergrens, bovengrens = excluded.bovengrens,
    volgorde = excluded.volgorde, invoer_bron = excluded.invoer_bron,
    bijgewerkt = now();

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

commit;

-- ── Verificatie (handmatig ná de rollback) ──────────────────────────────────
-- 1. Policy zonder actor-check:
--      select pg_get_expr(polwithcheck, polrelid) from pg_policy
--       where polrelid = 'public.fonds_stuurinfo_log'::regclass and polcmd = 'a';
-- 2. RPC accepteert weer aangeleverde labels (T14-gedrag).
