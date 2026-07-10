-- ============================================================================
-- Migratie 2026-07-10 — Increment T10: server-side toestandsmachine voor de
--                       GENERIEKE contentlaag (review-/publicatieworkflow).
-- ----------------------------------------------------------------------------
-- T10 bouwt de T6-contentlaag uit tot een beheerd redactieproces. Deze migratie
-- levert de STATUSMACHINE-handhaving; de review-verval-gate op retrieval staat in
-- 2026_07_10_t10_retrieval_review_verval.sql.
--
-- Leidend: werkopdracht T10, beslisnotitie v0.4 §9/§11, besluit 0048 (canonieke
-- generieke status is AFGELEID over status/bronstatus — géén concurrerende kolom)
-- en decisions/0053 (T10-keuzes). De vier canonieke toestanden
-- draft/published/deprecated/withdrawn worden afgeleid via
-- fn_generiek_geldigheidsstatus() — een 1-op-1 SQL-spiegel van
-- lib/generiek-status.ts::generiekGeldigheidsstatus. Bij wijziging: pas BEIDE aan
-- en draai lib/generiek-status.sanity.ts.
--
-- Wat deze migratie doet:
--   1. fn_generiek_geldigheidsstatus(status, bronstatus) — pure/immutable afleiding
--      van de canonieke status (spiegelt lib/generiek-status.ts exact).
--   2. fn_generiek_transitie(van, naar) — de EXPLICIETE toegestane canonieke
--      overgangen (T10). Niet-genoemd = verboden. Reden verplicht waar aangegeven.
--   3. trg_generiek_status_overgang — BEFORE UPDATE op documenten: dwingt voor
--      bibliotheek='generiek' af dat de canonieke oud→nieuw-overgang is toegestaan.
--      Dekt óók bronstatus-wijzigingen (withdrawn via bronstatus='uitgesloten',
--      deprecated via bronstatus='historisch') die de bestaande status-only
--      trigger NIET zag. Honoreert dezelfde bypass-GUC (admin-herstel/backfill).
--   4. fn_document_status_overgang_check() krijgt een GENERIEK-SKIP: de fonds-
--      lifecycle-transitietabel (2026_06_18, TO §3.1) geldt voortaan alléén voor
--      fondsdocumenten. Reden: de canonieke set staat bv. deprecated→published
--      (alleen_historisch→van_kracht) toe — dat verbiedt de fonds-tabel juist.
--      Zo is er precies één autoriteit per bibliotheek, zonder de fonds-flow te
--      verzwakken.
--
-- Toegestane canonieke overgangen (T10):
--   draft→published · published→deprecated · published→withdrawn
--   deprecated→withdrawn · deprecated→published (herpublicatie na review)
--   withdrawn = terminaal (herstel = nieuw document).
--
-- RLS/tenant-isolatie: ONGEWIJZIGD. Geen policywijziging, geen schrijfrecht
-- verruimd; de trigger is puur een extra weigering (defense-in-depth). Geldt óók
-- voor de service-role-curatie (die de generieke mutaties uitvoert).
-- Audit: geen nieuwe logtabel — de curatie-acties schrijven elke overgang al
-- append-only naar document_metadata_log (wijzig_type status/bronstatus + reden).
--
-- Idempotent (create or replace / drop+create trigger). EERST in Supabase draaien,
-- DAN code-deploy. ROLLBACK: 2026_07_10_t10_generiek_transitiepoort_ROLLBACK.sql.
-- ============================================================================

-- ── 1. Canonieke geldigheidsstatus, afgeleid (spiegel van lib/generiek-status.ts)
-- Volgorde is bindend: published eerst (de 0045-gate), dan withdrawn (hardste
-- uitsluiting), dan deprecated, anders draft. coalesce(bronstatus,'actief')
-- spiegelt "NULL ≡ actief" uit de RPC en isPublishedGeneriek.
create or replace function public.fn_generiek_geldigheidsstatus(
  p_status text, p_bronstatus text
)
returns text language sql immutable as $$
  select case
    when p_status = 'van_kracht'
         and coalesce(p_bronstatus, 'actief') = 'actief'      then 'published'
    when p_status = 'gearchiveerd'
         or coalesce(p_bronstatus, 'actief') = 'uitgesloten'  then 'withdrawn'
    when p_status in ('vervangen', 'alleen_historisch')
         or coalesce(p_bronstatus, 'actief') = 'historisch'   then 'deprecated'
    else 'draft'
  end;
$$;

comment on function public.fn_generiek_geldigheidsstatus(text, text) is
  'T10: canonieke generieke geldigheidsstatus (draft/published/deprecated/withdrawn) AFGELEID over status/bronstatus. 1-op-1 spiegel van lib/generiek-status.ts::generiekGeldigheidsstatus (besluit 0048). Bij wijziging: pas beide aan + draai de sanity.';

-- ── 2. Toegestane canonieke overgangen (T10). Niet-genoemd (van,naar) = verboden.
--    van = naar wordt door de trigger afgevangen (geen transitie), niet hier.
create or replace function public.fn_generiek_transitie(
  p_van text, p_naar text
)
returns table (toegestaan boolean, redenplicht boolean)
language sql immutable as $$
  select t.toegestaan::boolean, t.redenplicht::boolean
  from (values
    ('draft',      'published',  true, false),
    ('published',  'deprecated', true, true ),
    ('published',  'withdrawn',  true, true ),
    ('deprecated', 'withdrawn',  true, true ),
    ('deprecated', 'published',  true, true )  -- herpublicatie na review
  ) as t(van, naar, toegestaan, redenplicht)
  where t.van = p_van and t.naar = p_naar;
$$;

comment on function public.fn_generiek_transitie(text, text) is
  'T10: expliciete toegestane canonieke overgangen voor generieke content. withdrawn is terminaal. Spiegelt lib/generiek-status.ts::GENERIEKE_TRANSITIES.';

-- ── 3. Generieke toestandsmachine-trigger (defense-in-depth náást de curatie-
--    server-actions). Dwingt "geen ongeldige canonieke sprong" af, inclusief de
--    bronstatus-as die de status-only trigger niet zag.
create or replace function public.fn_generiek_status_overgang_check()
returns trigger language plpgsql as $$
declare
  v_van        text;
  v_naar       text;
  v_toegestaan boolean;
begin
  -- Alleen generieke content valt onder de canonieke toestandsmachine.
  if new.bibliotheek is distinct from 'generiek' then
    return new;
  end if;

  -- Escape voor admin-herstel + migratie/backfill (zelfde GUC als de fonds-trigger).
  if coalesce(current_setting('app.status_transitie_bypass', true), 'off') = 'on' then
    return new;
  end if;

  v_van  := public.fn_generiek_geldigheidsstatus(old.status, old.bronstatus);
  v_naar := public.fn_generiek_geldigheidsstatus(new.status, new.bronstatus);

  -- Geen canonieke overgang (metadata-edit binnen dezelfde status) → toegestaan.
  if v_van is not distinct from v_naar then
    return new;
  end if;

  select toegestaan into v_toegestaan
    from public.fn_generiek_transitie(v_van, v_naar);

  if not coalesce(v_toegestaan, false) then
    raise exception
      'Ongeldige generieke statusovergang: % → % (niet toegestaan volgens de T10-toestandsmachine)',
      v_van, v_naar;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_generiek_status_overgang on public.documenten;
create trigger trg_generiek_status_overgang
  before update on public.documenten
  for each row execute procedure public.fn_generiek_status_overgang_check();

-- ── 4. De bestaande fonds-lifecycle-statustrigger (2026_06_18, TO §3.1) slaat
--    generiek voortaan over: één autoriteit per bibliotheek. De fonds-flow blijft
--    exact gelijk (identieke body, alleen een generiek-skip vooraan).
create or replace function public.fn_document_status_overgang_check()
returns trigger language plpgsql as $$
declare
  v_toegestaan boolean;
begin
  -- T10: generieke content volgt fn_generiek_status_overgang_check, niet de
  -- fonds-lifecycle-transitietabel (die bv. deprecated→published verbiedt).
  if new.bibliotheek = 'generiek' then
    return new;
  end if;

  if new.status is distinct from old.status then
    if coalesce(current_setting('app.status_transitie_bypass', true), 'off') = 'on' then
      return new;
    end if;
    -- NULL/onbekende oude status (legacy) → laat eerste expliciete zet toe.
    if old.status is null then
      return new;
    end if;
    select toegestaan into v_toegestaan
      from public.fn_document_status_transitie(old.status, new.status);
    if not coalesce(v_toegestaan, false) then
      raise exception
        'Ongeldige documentstatus-overgang: % → % (niet toegestaan volgens transitietabel TO §3.1)',
        old.status, new.status;
    end if;
  end if;
  return new;
end;
$$;

-- ============================================================================
-- Verificatie (SQL Editor):
--   select public.fn_generiek_geldigheidsstatus('van_kracht','actief');   -- published
--   select public.fn_generiek_geldigheidsstatus('van_kracht','uitgesloten'); -- withdrawn
--   select * from public.fn_generiek_transitie('published','deprecated'); -- toegestaan=t
--   select * from public.fn_generiek_transitie('withdrawn','published');  -- 0 rijen (verboden)
--   -- Een generiek document van withdrawn terug naar published UPDATEN moet nu
--   -- door trg_generiek_status_overgang worden geweigerd.
-- ============================================================================
