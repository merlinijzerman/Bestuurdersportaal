-- ============================================================================
-- Migratie 2026-07-17 — T14: beheer-invoerlaag stuurinformatie (audit + RPC)
-- ----------------------------------------------------------------------------
-- WAAROM: T14 bouwt de beheer-invoerlaag (handmatig + Excel-upload) op het
-- T13-periodemodel (werkopdracht Beheer-invoerlaag stuurinformatie; zie
-- decisions/0075). De T11/T13-feitentabellen waren bewust mutabel ZONDER
-- change-log (restrisico decisions/0054) — dat gat dicht deze migratie, want
-- vanaf nu schrijven mensen (voorzitter/beheerder) er rechtstreeks in.
--
-- VIER WIJZIGINGEN (alle additief; geen bestaande RLS-policy gewijzigd):
--   1. invoer_bron-kolom op de vier stuurinfo-datatabellen — nullable marker
--      ('handmatig'|'upload') die het schrijfpad meestuurt en de audittrigger
--      naar het log kopieert. Seeds/migraties laten hem leeg (= setup-write).
--      Waarom een kolom en geen sessie-variabele: een Postgres-GUC overleeft
--      PostgREST-requests niet betrouwbaar; app-level log-inserts breken de
--      atomiciteit (T8b-les).
--   2. Volgorde-normalisatie op fonds_stuurinfo_periode: volgorde wordt
--      DETERMINISTISCH (jaar*4 + kwartaal, bv. 2026Q2 → 8106) i.p.v. een
--      oplopende teller. Zo sorteert een later ingevoerde historische periode
--      (bv. 2025Q4) altijd correct. Relatieve volgorde van bestaande rijen
--      blijft gelijk (2026Q1 < 2026Q2); de leeslaag sorteert alleen aflopend.
--   3. fonds_stuurinfo_log — NIEUW append-only auditspoor (wie, wat, wanneer,
--      oud→nieuw, bron) gevuld door een AFTER-trigger op de vier datatabellen
--      (T8b-patroon: atomisch, niet overslaanbaar vanuit code). Immutability
--      via de bestaande fn_log_append_only(). No-op-guard: een upsert die
--      niets wijzigt produceert géén logregel (anders ~20 identieke regels
--      per save door on conflict do update).
--   4. RPC stuurinfo_balans_opslaan — SECURITY INVOKER (profiel_opslaan-
--      precedent, besluit 0017): één save = registry + 10 balans-leaves +
--      8 reserves + FG-KPI in ÉÉN transactie. Losse upserts zouden bij een
--      partiële fout precies de reeks↔reserve-desync achterlaten die het
--      ontwerp "één bron per bedrag" moet uitsluiten. RLS blijft onverkort
--      gelden (geen definer, geen service-role); fonds_id komt UITSLUITEND
--      uit auth.uid() → profielen (geen parameter). Defense-in-depth in de
--      functie: balansevenwicht, key-allowlists en gekoppelde-standen-check
--      worden óók hier afgedwongen (app-laag valideert eerst, 400/422).
--
-- HARDE SCOPEGRENS (ongewijzigd): GEEN deelnemer-PII. Alles fonds-aggregaat;
-- populatie_n wordt door de invoerlaag nooit gezet (blijft NULL).
-- BEKEND RESTPUNT (zelfde vorm als fonds_config_log): een voorzitter/beheerder
-- kan via PostgREST ook direct een logregel inserten (nep-entry). Het log
-- blijft append-only en per fonds; de rolgate op de INSERT-policy beperkt dit
-- tot de rollen die toch al schrijfrechten op de feiten hebben.
--
-- Idempotent (if not exists / create or replace / drop trigger if exists /
-- guarded do-blokken). Transactioneel. Eerst in Supabase draaien, DAN
-- code-deploy (migratie-eerst). Sorteert ná t13b: de T13-seeds produceren
-- géén logregels (het zijn setup-seeds, geen invoerhandelingen).
-- ROLLBACK: 2026_07_17_t14_stuurinfo_invoer_audit_ROLLBACK.sql
-- TENANT-IMPACT: additief (kolommen nullable, nieuwe tabel, triggers, RPC).
-- Bestaande rijen en policies ongewijzigd; volgorde-update wijzigt alleen de
-- absolute waarden, niet de sortering. Oude app-code blijft werken.
-- ============================================================================

begin;

-- ── 1. invoer_bron-marker op de vier datatabellen ────────────────────────────
alter table public.fonds_stuurinfo_periode add column if not exists invoer_bron text;
alter table public.fonds_stuurinfo_kpi     add column if not exists invoer_bron text;
alter table public.fonds_stuurinfo_reeks   add column if not exists invoer_bron text;
alter table public.fonds_stuurinfo_reserve add column if not exists invoer_bron text;

alter table public.fonds_stuurinfo_periode
  drop constraint if exists fonds_stuurinfo_periode_invoer_bron_check;
alter table public.fonds_stuurinfo_periode
  add constraint fonds_stuurinfo_periode_invoer_bron_check
  check (invoer_bron is null or invoer_bron in ('handmatig','upload'));
alter table public.fonds_stuurinfo_kpi
  drop constraint if exists fonds_stuurinfo_kpi_invoer_bron_check;
alter table public.fonds_stuurinfo_kpi
  add constraint fonds_stuurinfo_kpi_invoer_bron_check
  check (invoer_bron is null or invoer_bron in ('handmatig','upload'));
alter table public.fonds_stuurinfo_reeks
  drop constraint if exists fonds_stuurinfo_reeks_invoer_bron_check;
alter table public.fonds_stuurinfo_reeks
  add constraint fonds_stuurinfo_reeks_invoer_bron_check
  check (invoer_bron is null or invoer_bron in ('handmatig','upload'));
alter table public.fonds_stuurinfo_reserve
  drop constraint if exists fonds_stuurinfo_reserve_invoer_bron_check;
alter table public.fonds_stuurinfo_reserve
  add constraint fonds_stuurinfo_reserve_invoer_bron_check
  check (invoer_bron is null or invoer_bron in ('handmatig','upload'));

-- ── 2. Volgorde deterministisch (jaar*4 + kwartaal) ──────────────────────────
-- Vóór het installeren van de audittrigger (stap 4), zodat deze normalisatie
-- geen logregels produceert. Idempotent: de formule is een vast gegeven van de
-- periode-string (format al geborgd door de CHECK-constraint).
update public.fonds_stuurinfo_periode
set volgorde = (substring(periode from 1 for 4))::integer * 4
             + (substring(periode from 6 for 1))::integer
where volgorde is distinct from (substring(periode from 1 for 4))::integer * 4
                               + (substring(periode from 6 for 1))::integer;

-- ── 3. fonds_stuurinfo_log — append-only auditspoor invoer/upload ────────────
create table if not exists public.fonds_stuurinfo_log (
  id             uuid primary key default gen_random_uuid(),
  fonds_id       uuid not null references public.fondsen(id) on delete cascade,
  periode        text not null,
  tabel          text not null check (tabel in ('periode','kpi','reeks','reserve')),
  veld_key       text not null,          -- bv. 'balans_passiva.ev_soli', 'solidariteitsreserve'
  oude_waarde    jsonb,                  -- null bij INSERT (nieuwe rij)
  nieuwe_waarde  jsonb not null,
  invoer_bron    text,                   -- 'handmatig'|'upload'|null (seed/migratie)
  gebruiker_id   uuid,                   -- auth.uid(); null bij owner-/seed-writes
  gebruiker_naam text,                   -- naam-snapshot (T8b-patroon)
  aangemaakt     timestamptz not null default now()
);

create index if not exists idx_stuurinfo_log_fonds_tijd
  on public.fonds_stuurinfo_log(fonds_id, aangemaakt desc);

alter table public.fonds_stuurinfo_log enable row level security;

drop policy if exists "stuurinfo log lezen eigen fonds" on public.fonds_stuurinfo_log;
create policy "stuurinfo log lezen eigen fonds" on public.fonds_stuurinfo_log
  for select
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

-- INSERT met rolgate: de trigger draait security invoker, dus deze policy geldt
-- voor de trigger-insert. Alleen rollen die toch al op de feitentabellen mogen
-- schrijven kunnen (via de trigger of direct) logregels aanmaken. Geen
-- UPDATE-/DELETE-policy → deny-by-default; plus immutability-triggers hieronder.
drop policy if exists "stuurinfo log schrijven priv" on public.fonds_stuurinfo_log;
create policy "stuurinfo log schrijven priv" on public.fonds_stuurinfo_log
  for insert
  with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  );

drop trigger if exists trg_fonds_stuurinfo_log_no_update on public.fonds_stuurinfo_log;
create trigger trg_fonds_stuurinfo_log_no_update
  before update on public.fonds_stuurinfo_log
  for each row execute procedure public.fn_log_append_only();

drop trigger if exists trg_fonds_stuurinfo_log_no_delete on public.fonds_stuurinfo_log;
create trigger trg_fonds_stuurinfo_log_no_delete
  before delete on public.fonds_stuurinfo_log
  for each row execute procedure public.fn_log_append_only();

comment on table public.fonds_stuurinfo_log is
  'TENANT (T14). Append-only auditspoor van stuurinformatie-invoer/upload: '
  'wie, wat, wanneer, oud→nieuw, bron (handmatig/upload; null = seed/migratie). '
  'Gevuld door AFTER-trigger fn_fonds_stuurinfo_capture op de vier '
  'fonds_stuurinfo_*-datatabellen. Nooit UPDATE/DELETE (fn_log_append_only). '
  'Lezen = eigen fonds; insert = eigen fonds + voorzitter/beheerder.';

-- ── 4. Capture-functie + AFTER-triggers (T8b-patroon) ────────────────────────
-- SECURITY INVOKER (default): de RLS-insertpolicy op fonds_stuurinfo_log geldt;
-- new.fonds_id = eigen fonds en de actor heeft per definitie een schrijfrol
-- (anders was de datawrite zelf al geweigerd). Owner-writes (seeds/migraties)
-- passeren RLS en loggen met actor null.
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

drop trigger if exists trg_fonds_stuurinfo_periode_audit on public.fonds_stuurinfo_periode;
create trigger trg_fonds_stuurinfo_periode_audit
  after insert or update on public.fonds_stuurinfo_periode
  for each row execute procedure public.fn_fonds_stuurinfo_capture();

drop trigger if exists trg_fonds_stuurinfo_kpi_audit on public.fonds_stuurinfo_kpi;
create trigger trg_fonds_stuurinfo_kpi_audit
  after insert or update on public.fonds_stuurinfo_kpi
  for each row execute procedure public.fn_fonds_stuurinfo_capture();

drop trigger if exists trg_fonds_stuurinfo_reeks_audit on public.fonds_stuurinfo_reeks;
create trigger trg_fonds_stuurinfo_reeks_audit
  after insert or update on public.fonds_stuurinfo_reeks
  for each row execute procedure public.fn_fonds_stuurinfo_capture();

drop trigger if exists trg_fonds_stuurinfo_reserve_audit on public.fonds_stuurinfo_reserve;
create trigger trg_fonds_stuurinfo_reserve_audit
  after insert or update on public.fonds_stuurinfo_reserve
  for each row execute procedure public.fn_fonds_stuurinfo_capture();

-- ── 5. RPC stuurinfo_balans_opslaan — atomische save van één periode ─────────
-- SECURITY INVOKER: alle T13-RLS-policies (schrijven = eigen fonds +
-- voorzitter/beheerder, WITH CHECK) blijven onverkort gelden. Een bestuurder
-- die deze functie direct aanroept strandt op de insert-policy. De app-laag
-- (route handler) valideert vóór de call (allowlist 400, evenwicht 422); de
-- checks hier zijn defense-in-depth op DB-niveau (guardrail: governance-logica
-- niet uitsluitend app-side).
create or replace function public.stuurinfo_balans_opslaan(
  p_periode            text,
  p_peildatum          date,
  p_bron               text,
  p_invoer_bron        text,
  p_activa             jsonb,   -- {"belegd": 2400, "overig": 80}
  p_passiva            jsonb,   -- {"ev_toets_mvev": 10, ..., "overig": 4} (8 leaves)
  p_reserves           jsonb,   -- array van exact 8 rijen {reserve_key,label,stand,pct_waarde,ondergrens,bovengrens,volgorde}
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
  --     keys uit deze values-lijst worden geschreven — rommel-keys kunnen er
  --     door de allowlist-check hierboven al niet meer in zitten.
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

  -- (3) Reserves: 8 rijen (pct_waarde is app-side berekend uit stand/TV; de
  --     gekoppelde standen zijn hierboven al tegen de balans getoetst).
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

revoke execute on function public.stuurinfo_balans_opslaan(
  text, date, text, text, jsonb, jsonb, jsonb, numeric
) from anon;
grant execute on function public.stuurinfo_balans_opslaan(
  text, date, text, text, jsonb, jsonb, jsonb, numeric
) to authenticated;

commit;

-- ── Verificatie (handmatig ná de migratie) ──────────────────────────────────
-- 1. Logtabel + RLS aan:
--      select tablename, rowsecurity from pg_tables where tablename = 'fonds_stuurinfo_log';
-- 2. Zes triggers aanwezig (4× audit, 2× append-only):
--      select trigger_name, event_object_table from information_schema.triggers
--       where trigger_name like 'trg_fonds_stuurinfo_%';
-- 3. RPC bestaat met SECURITY INVOKER (prosecdef = false):
--      select proname, prosecdef from pg_proc where proname = 'stuurinfo_balans_opslaan';
-- 4. Volgorde genormaliseerd (2026Q1 → 8105, 2026Q2 → 8106):
--      select periode, volgorde from public.fonds_stuurinfo_periode
--       group by periode, volgorde order by volgorde;
-- 5. invoer_bron-kolommen aanwezig (4 rijen):
--      select table_name from information_schema.columns
--       where column_name = 'invoer_bron' and table_name like 'fonds_stuurinfo_%';
