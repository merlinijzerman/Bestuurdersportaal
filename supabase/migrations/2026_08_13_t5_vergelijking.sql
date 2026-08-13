-- ============================================================================
-- Migratie 2026-08-13 (T5) — comparison_results + atomische schrijffunctie
-- ----------------------------------------------------------------------------
-- WAAROM. T7 legde de header comparison_run (reproduceerbaarheid) en liet de
-- feitelijke bevindingen bewust open voor T5. Deze migratie voegt de detailtabel
-- comparison_results toe (één rij per bevinding van een symmetrische vergelijking)
-- plus één atomische schrijffunctie fn_schrijf_vergelijking (header + details in
-- één transactie). Puur ADDITIEF: geen bestaande tabel, policy of grant wijzigt.
-- Zolang de flag VERGELIJKMODUS uit staat schrijft niets in deze tabel en verandert
-- er geen app-gedrag. Terugdraaibaar via de ROLLBACK-migratie.
--
-- SCHRIJFPAD (besluit T5, sluit aan op T7). De vergelijking wordt getriggerd vanuit
-- de interactieve AI-chat op de app-/publiek-surface (DEPLOY_TARGET=app). Die surface
-- heeft BEWUST geen service-role (Variant-C, besluit 0066); de service-role leeft
-- alleen in het beheer-project. De pijplijn-tabellen comparison_run/comparison_results
-- moeten daarom door de aanroeper (authenticated) beschreven kunnen worden ZONDER dat
-- die client de provenance kan vervalsen. Zelfde oplossing als het bestaande
-- governance-schrijfpad schrijf_ai_interactie(): één SECURITY DEFINER-functie die
-- fonds_id server-side uit auth.uid() bepaalt (niet uit de request), de comparison_run
-- + comparison_results in één transactie wegschrijft, en waarvan EXECUTE breed is
-- ontzegd en alléén aan authenticated is teruggegeven. `authenticated` krijgt op de
-- tabellen zelf GEEN INSERT-grant: schrijven kan uitsluitend via de functie, die als
-- owner draait. Zo is er geen directe client-INSERT en geen service-role op de app.
--
-- WAAROM GEEN service-role hier: CLAUDE.md verbiedt de service-role-key op de app-/
-- client-surface; de interactieve chat kan er niet bij. De DEFINER-functie geeft
-- dezelfde garantie (client kan geen provenance vervalsen, tenant-isolatie server-
-- side afgedwongen) zonder cross-project hop.
--
-- APPEND-ONLY. comparison_results is onveranderlijk: geen UPDATE/DELETE-grant + de
-- gedeelde before-update/delete-trigger public.fn_log_append_only() (borg in de DB,
-- niet alleen in grants — CLAUDE.md). comparison_run had die trigger al (T7).
--
-- GRENSBEWAKING (T5). Deze tabel legt UITSLUITEND ruwe verschillen vast
-- (verschil_type_ruw ∈ gelijk|verschilt|alleen_bron|alleen_doel) en de gebruikte
-- methode (deterministisch|llm). GEEN bestuurlijke classificatie of materialiteit —
-- dat is T9 en hoort hier niet.
--
-- TENANT-ISOLATIE (RLS). comparison_results draagt een eigen fonds_id → gate B-
-- predicaat `fonds_id = (select fonds_id from profielen where id = auth.uid())`,
-- SELECT-only voor authenticated (schrijven via de DEFINER-functie).
--
-- Idempotent (create ... if not exists, drop/create policy+trigger, or replace
-- function). Transactioneel. EERST in Supabase draaien, DÁN code-deploy. Draai na
-- deze migratie de structurele gates (A–H) en de T5-gedragstoets.
-- ROLLBACK: 2026_08_13_t5_vergelijking_ROLLBACK.sql
-- Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
-- ============================================================================

begin;

-- ── 1. Detailtabel: één rij per bevinding ────────────────────────────────────
create table if not exists public.comparison_results (
  id                 uuid primary key default uuid_generate_v4(),
  comparison_run_id  uuid not null references public.comparison_run(id),
  fonds_id           uuid not null references public.fondsen(id),
  finding_key        text not null,          -- stabiele bevindingssleutel (koppelt T10)
  dimensie           text not null,          -- bv. 'solidariteitsreserve.bovengrens'
  concept_id         uuid references public.concepts(id),  -- indien catalogus-concept
  -- Bron-zijde
  bron_document_id   uuid not null references public.documenten(id),
  bron_value         text,                   -- weergavewaarde; null bij 'alleen_doel'
  bron_evidence      text,                   -- verbatim bronpassage (evidence-link)
  bron_page          int,
  -- Doel-zijde
  doel_document_id   uuid not null references public.documenten(id),
  doel_value         text,                   -- weergavewaarde; null bij 'alleen_bron'
  doel_evidence      text,
  doel_page          int,
  -- Ruwe uitkomst (T5-grens: géén bestuurlijke duiding)
  verschil_type_ruw  text not null check (verschil_type_ruw in
                       ('gelijk','verschilt','alleen_bron','alleen_doel')),
  method             text not null check (method in ('deterministisch','llm')),
  created_at         timestamptz not null default now()
);

comment on table public.comparison_results is
  'Ruwe bevindingen van een symmetrische documentvergelijking (T5), één rij per '
  'dimensie. Per fonds geïsoleerd (RLS op fonds_id). Schrijven uitsluitend via '
  'fn_schrijf_vergelijking (SECURITY DEFINER); authenticated is read-only. '
  'Append-only. verschil_type_ruw is bewust RUW: bestuurlijke classificatie en '
  'materialiteit zijn T9 en horen hier niet. method legt vast of het cijfer/datum-'
  'verschil deterministisch (beide zijden een semantic_unit) of via LLM bepaald is.';

alter table public.comparison_results enable row level security;

drop policy if exists "comparison_results eigen fonds lezen" on public.comparison_results;
create policy "comparison_results eigen fonds lezen" on public.comparison_results
  for select using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

-- Expliciete tabelgrants (gate F). anon dicht; authenticated read-only; schrijven
-- gebeurt via de DEFINER-functie (draait als owner, niet als de aanroeper).
revoke all on public.comparison_results from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.comparison_results from authenticated;
grant select on table public.comparison_results to authenticated;

create index if not exists idx_comparison_results_run
  on public.comparison_results (comparison_run_id);
-- T10 koppelt oordelen op (fonds_id, finding_key); zelfde index-vorm als
-- difference_judgements zodat de join goedkoop is.
create index if not exists idx_comparison_results_fonds_finding
  on public.comparison_results (fonds_id, finding_key);

-- ── 2. Append-only-borging (hergebruikt public.fn_log_append_only) ────────────
-- comparison_run kreeg de trigger al in T7; hier alleen comparison_results.
drop trigger if exists trg_comparison_results_no_update on public.comparison_results;
create trigger trg_comparison_results_no_update
  before update on public.comparison_results
  for each row execute procedure public.fn_log_append_only();
drop trigger if exists trg_comparison_results_no_delete on public.comparison_results;
create trigger trg_comparison_results_no_delete
  before delete on public.comparison_results
  for each row execute procedure public.fn_log_append_only();

-- ── 3. Atomische schrijffunctie (append-only run-header + bevindingen) ─────────
-- Schrijft in één transactie: (a) de comparison_run-header (append-only) en (b) de
-- comparison_results-rijen. fonds_id wordt SERVER-SIDE uit auth.uid() bepaald en is
-- GEEN parameter — niet te spoofen vanuit de request (zelfde borging als
-- schrijf_ai_interactie). SECURITY DEFINER: de authenticated-aanroeper heeft geen
-- INSERT-grant op de tabellen; de functie draait als owner en is het enige schrijf-
-- pad. EXECUTE breed ontzegd, alleen aan authenticated teruggegeven (gate H / H-18).
--
-- Defense-in-depth: elk bron-/doel-document_id in p_findings moet tot het eigen
-- fonds behoren (de functie omzeilt RLS, dus dit wordt hier expliciet getoetst) —
-- anders kan een directe aanroep provenance planten die naar andermans documenten
-- verwijst.
create or replace function public.fn_schrijf_vergelijking(
  p_mode               text,     -- 'symmetrisch' | 'coverage'
  p_model              text,
  p_prompt_version     text,
  p_comparator_version text,
  p_findings           jsonb     -- array van bevindingen; mag leeg zijn
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_fonds   uuid;
  v_run_id  uuid;
  v_vreemd  int;
begin
  if v_uid is null then
    raise exception 'niet_geauthenticeerd' using errcode = '28000';
  end if;
  if p_mode not in ('symmetrisch','coverage') then
    raise exception 'fn_schrijf_vergelijking: ongeldige mode %', p_mode using errcode = '22023';
  end if;

  select p.fonds_id into v_fonds
    from public.profielen p
   where p.id = v_uid;
  if v_fonds is null then
    raise exception 'geen_fonds_voor_gebruiker' using errcode = 'P0002';
  end if;

  -- Tenant-guard: geen bevinding mag naar een document buiten het eigen fonds wijzen.
  if p_findings is not null and jsonb_typeof(p_findings) = 'array' then
    select count(*) into v_vreemd
      from jsonb_array_elements(p_findings) as f
     where not exists (
             select 1 from public.documenten d
              where d.id = (f->>'bron_document_id')::uuid and d.fonds_id = v_fonds)
        or not exists (
             select 1 from public.documenten d
              where d.id = (f->>'doel_document_id')::uuid and d.fonds_id = v_fonds);
    if v_vreemd > 0 then
      raise exception 'vergelijking_vreemd_document' using errcode = '42501';
    end if;
  end if;

  insert into public.comparison_run
    (fonds_id, mode, model, prompt_version, comparator_version)
  values
    (v_fonds, p_mode, p_model, p_prompt_version, p_comparator_version)
  returning id into v_run_id;

  if p_findings is not null and jsonb_typeof(p_findings) = 'array' then
    insert into public.comparison_results
      (comparison_run_id, fonds_id, finding_key, dimensie, concept_id,
       bron_document_id, bron_value, bron_evidence, bron_page,
       doel_document_id, doel_value, doel_evidence, doel_page,
       verschil_type_ruw, method)
    select
      v_run_id,
      v_fonds,
      f->>'finding_key',
      f->>'dimensie',
      nullif(f->>'concept_id','')::uuid,
      (f->>'bron_document_id')::uuid,
      nullif(f->>'bron_value','')::text,
      nullif(f->>'bron_evidence','')::text,
      nullif(f->>'bron_page','')::int,
      (f->>'doel_document_id')::uuid,
      nullif(f->>'doel_value','')::text,
      nullif(f->>'doel_evidence','')::text,
      nullif(f->>'doel_page','')::int,
      f->>'verschil_type_ruw',
      f->>'method'
    from jsonb_array_elements(p_findings) as f;
  end if;

  return v_run_id;
end $$;

comment on function public.fn_schrijf_vergelijking(text,text,text,text,jsonb) is
  'T5: atomische schrijf van één comparison_run (append-only header) + de bijhorende '
  'comparison_results. SECURITY DEFINER; fonds_id server-side uit auth.uid() (niet '
  'spoofbaar). Tenant-guard: elk bron-/doel-document moet tot het eigen fonds behoren. '
  'Enige schrijfpad voor beide tabellen (authenticated heeft geen INSERT-grant). '
  'EXECUTE ontzegd aan public/anon, teruggegeven aan authenticated.';

-- Gate-H-hygiëne: EXECUTE breed ontzeggen, dan gericht aan authenticated.
revoke all on function public.fn_schrijf_vergelijking(text,text,text,text,jsonb)
  from public, anon;
grant execute on function public.fn_schrijf_vergelijking(text,text,text,text,jsonb)
  to authenticated;

commit;

-- ── Verificatie (handmatig ná de migratie) ───────────────────────────────────
-- 1. Tabel met RLS aan:
--      select relname, relrowsecurity from pg_class
--       where relnamespace = 'public'::regnamespace and relname = 'comparison_results';
--       -- → 1 rij, relrowsecurity = t
-- 2. Twee append-only triggers op comparison_results:
--      select event_manipulation from information_schema.triggers
--       where event_object_table = 'comparison_results' order by event_manipulation;
--       -- → DELETE, UPDATE
-- 3. anon ziet niets, authenticated schrijft niet direct op de tabel:
--      select has_table_privilege('anon','public.comparison_results','select');        -- → f
--      select has_table_privilege('authenticated','public.comparison_results','insert'); -- → f
-- 4. EXECUTE-hygiëne op de functie:
--      select has_function_privilege('anon',
--        'public.fn_schrijf_vergelijking(text,text,text,text,jsonb)','execute');        -- → f
--      select has_function_privilege('authenticated',
--        'public.fn_schrijf_vergelijking(text,text,text,text,jsonb)','execute');        -- → t
-- 5. verschil_type_ruw / method CHECK dwingt de toegestane waarden af (moet FALEN):
--      insert into public.comparison_results (...) values (..., 'onbekend', 'llm'); -- 23514
-- 6. Structurele gates A–H schoon draaien:
--      supabase/checks/2026_07_31_r1_structurele_gates.sql
-- 7. Gedragstoets: supabase/checks/2026_08_13_t5_vergelijking.sql
