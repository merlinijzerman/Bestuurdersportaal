-- ============================================================================
-- Migratie 2026-08-23 — H-04: herkomst van de navigatie in het auditspoor
-- ----------------------------------------------------------------------------
-- WAAROM
-- Vier GET-routes schrijven een auditrecord. Onder een `Lax`-sessiecookie
-- stuurt een top-level navigatie de sessie mee, dus een `<img src="…">` of een
-- vreemde link laat de browser van een ingelogde bestuurder zo'n GET doen. Er
-- ontstaat dan een inzage- of downloadspoor dat die bestuurder nooit heeft
-- veroorzaakt. Dat spoor is geen ruis maar bewijs: document_inzage is de enige
-- registratie van wie welk document inzag.
--
-- De applicatie weigert zo'n aanroep voortaan wanneer `Sec-Fetch-Site` de
-- waarde `cross-site` heeft (core/lib/navigatie-herkomst.ts). Ontbreekt de
-- header — oudere Safari — dan wordt de aanroep WEL verwerkt, maar draagt het
-- record dat het niet te verifiëren was. Fail-closed zou hier op legitieme
-- gebruikers vallen zonder een aanvaller te hinderen: de browser zet de header,
-- niet de pagina.
--
-- Deze migratie maakt PLEK voor die herkomst. Twee van de vier routes hadden al
-- een jsonb-veld (governance_events.nieuwe_waarde, procedure_log.payload) en
-- staan hier dus niet in.
--
--   1. document_inzage krijgt een nullable kolom `herkomst`, met een CHECK op de
--      drie toegestane waarden. Nullable omdat historische rijen er geen hebben:
--      NULL betekent "van vóór H-04", niet "niet te verifiëren". Dat onderscheid
--      is de reden dat er geen default op staat.
--
--   2. aqlab_log_download krijgt een tweede parameter. De signatuur verandert
--      daarmee, dus drop-en-create in plaats van create-or-replace — en de
--      grants worden opnieuw gezet, want een drop neemt ze mee. De allowlist
--      supabase/checks/allowlist-grants.tsv is in dezelfde PR bijgewerkt.
--
-- NA UITROL: de driftmomentopname opnieuw pinnen. De functiehash én de
-- signatuur veranderen; dat is verwacht en hoort niet als drift te blijven staan.
--
-- Additief en idempotent. Raakt geen bestaande rij. RLS/tenant-isolatie
-- ongewijzigd: de RPC bepaalt gebruiker en fonds nog steeds server-side.
-- ROLLBACK: 2026_08_23_h04_herkomst_auditspoor_ROLLBACK.sql
-- ============================================================================

begin;

-- ── 1. document_inzage.herkomst ─────────────────────────────────────────────
alter table public.document_inzage
  add column if not exists herkomst text;

alter table public.document_inzage
  drop constraint if exists document_inzage_herkomst_check;
alter table public.document_inzage
  add constraint document_inzage_herkomst_check check (
    herkomst is null
    or herkomst in ('eigen_surface', 'directe_navigatie', 'niet_verifieerbaar')
  );

comment on column public.document_inzage.herkomst is
  'H-04: wat over de herkomst van de aanroep kon worden vastgesteld uit Sec-Fetch-Site. NULL = rij van vóór 2026-08-23. eigen_surface = same-origin/same-site; directe_navigatie = door de gebruiker zelf gestart (Sec-Fetch-Site: none); niet_verifieerbaar = header ontbrak. cross-site wordt geweigerd en levert dus nooit een rij op.';

-- ── 2. aqlab_log_download krijgt de herkomst mee ────────────────────────────
-- Drop-en-create: een extra parameter is een nieuwe signatuur, en zonder drop
-- zou de oude eenparametervariant blijven bestaan als tweede, ongebruikte
-- SECURITY-DEFINER-functie. Dat is precies het soort restant dat een gate
-- terecht als bevinding opvoert.
drop function if exists public.aqlab_log_download(uuid);
drop function if exists public.aqlab_log_download(uuid, text);

create function public.aqlab_log_download(p_export_id uuid, p_herkomst text default null)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.aqlab_log (gebruiker_id, actie, object_type, object_id, nieuwe_waarde)
  select
    auth.uid(),
    'audit_export_gedownload_fonds',
    'aqlab_audit_exports',
    p_export_id,
    jsonb_build_object(
      'fonds_id', (select p.fonds_id from public.profielen p where p.id = auth.uid()),
      'herkomst', p_herkomst
    )
  where exists (
    select 1 from public.aqlab_release_decisions d
    where d.audit_export_id = p_export_id and d.release_status = 'vrijgegeven'
  );
$$;

comment on function public.aqlab_log_download(uuid, text) is
  'D1b + H-04: append-only downloadspoor in aqlab_log (sessie-actor), alleen voor een vrijgegeven export. Insert-only; append-only-trigger blijft gelden. p_herkomst legt vast wat over de navigatieherkomst kon worden vastgesteld.';

-- Grants opnieuw zetten — een drop neemt ze mee. Identiek aan
-- 2026_07_12_d1b_assurance_rpcs.sql: alleen authenticated, nooit anon.
revoke all on function public.aqlab_log_download(uuid, text) from public;
grant execute on function public.aqlab_log_download(uuid, text) to authenticated;

commit;

-- ── Verificatie — fail-closed ───────────────────────────────────────────────
do $verificatie$
declare
  v_kolom int;
  v_oud   int;
  v_nieuw int;
  v_anon  boolean;
begin
  select count(*) into v_kolom
    from information_schema.columns
   where table_schema = 'public' and table_name = 'document_inzage'
     and column_name = 'herkomst';
  if v_kolom <> 1 then
    raise exception 'FOUT: document_inzage.herkomst ontbreekt.';
  end if;

  -- Vergelijk op de SIGNATUUR (regprocedure), niet op
  -- pg_get_function_identity_arguments: die laatste geeft de parameternamen mee
  -- ('p_export_id uuid, p_herkomst text') en niet alleen de typen. Een check die
  -- daarop matcht faalt op een detail dat er niet toe doet.
  select count(*) into v_oud
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.oid::regprocedure::text = 'aqlab_log_download(uuid)';
  if v_oud <> 0 then
    raise exception 'FOUT: de oude eenparametervariant van aqlab_log_download bestaat nog.';
  end if;

  select count(*) into v_nieuw
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.oid::regprocedure::text = 'aqlab_log_download(uuid,text)'
     and p.prosecdef
     and array_to_string(p.proconfig, ',') like '%pg_temp%';
  if v_nieuw <> 1 then
    raise exception 'FOUT: aqlab_log_download(uuid, text) ontbreekt, is niet SECURITY DEFINER, of mist pg_temp in search_path.';
  end if;

  select has_function_privilege('anon', 'public.aqlab_log_download(uuid, text)', 'EXECUTE')
    into v_anon;
  if v_anon then
    raise exception 'FOUT: anon heeft EXECUTE op aqlab_log_download — dat mag nooit.';
  end if;

  raise notice 'AKKOORD: herkomst-kolom aanwezig, RPC vervangen, anon uitgesloten.';
end $verificatie$;
