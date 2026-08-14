


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."procedure_afschriften" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "procedure_id" "uuid" NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "versie" "text" NOT NULL,
    "trigger_status" "text",
    "aanleiding" "text",
    "status" "text" DEFAULT 'bezig'::"text" NOT NULL,
    "poging" integer DEFAULT 0 NOT NULL,
    "lease_tot" timestamp with time zone,
    "laatste_fout" "text",
    "opslag_pad" "text",
    "sha256" "text",
    "bytes" bigint,
    "bestandsaantal" integer,
    "bevat_stemgedrag" boolean DEFAULT false NOT NULL,
    "gebouwd_onder_rol" "text",
    "uitgesloten_items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "waarschuwingen" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "dossier_stand_event_id" "uuid",
    "dossier_stand_op" timestamp with time zone,
    "ai_leeswijzer" boolean DEFAULT false NOT NULL,
    "ai_model" "text",
    "ai_promptversie" "text",
    "ai_tekst_hash" "text",
    "ai_vastgesteld_door" "uuid",
    "ai_vastgesteld_op" timestamp with time zone,
    "ingetrokken_op" timestamp with time zone,
    "ingetrokken_door" "uuid",
    "ingetrokken_reden" "text",
    "aangemaakt_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    "aangemaakt_door" "uuid",
    "ai_leeswijzer_tekst" "jsonb",
    CONSTRAINT "afschrift_gereed_vereist_vaststelling" CHECK ((("status" <> 'gereed'::"text") OR ("ai_leeswijzer" = false) OR ("ai_vastgesteld_door" IS NOT NULL))),
    CONSTRAINT "procedure_afschriften_status_check" CHECK (("status" = ANY (ARRAY['bezig'::"text", 'gereed'::"text", 'mislukt'::"text"]))),
    CONSTRAINT "procedure_afschriften_versie_check" CHECK (("versie" = ANY (ARRAY['actueel'::"text", 'besluitmoment'::"text"])))
);


ALTER TABLE "public"."procedure_afschriften" OWNER TO "postgres";


COMMENT ON TABLE "public"."procedure_afschriften" IS 'TENANT (T6). Permanent vastgelegde auditdossier-afschriften per proces. Append-only: geen delete (fn_log_append_only), intrekken via ingetrokken_*. Bouw door service-role-worker (ADR-5), fonds-gescoopt in code. RLS per fonds_id; SELECT toont de bureau-rol de rij, INSERT + storage-lezen sluiten de bureau-rol uit.';



COMMENT ON COLUMN "public"."procedure_afschriften"."ai_leeswijzer_tekst" IS 'Fase 2: de door een mens vastgestelde §2–4-leeswijzertekst {hoeVerlopen, watVastgelegd, bijzonderheden}. NULL = deterministisch sjabloon (ai_leeswijzer=false).';



CREATE OR REPLACE FUNCTION "public"."afschriften_claim_jobs"("p_worker_id" "text", "p_limit" integer, "p_lease_seconds" integer) RETURNS SETOF "public"."procedure_afschriften"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return query
  with kandidaten as (
    select k.id
      from public.procedure_afschriften k
     where k.status = 'bezig'
       and (k.lease_tot is null or k.lease_tot < now())
       and k.poging < 8                         -- crash-loop-rem (§7)
     order by k.aangemaakt_op
     for update of k skip locked
     limit greatest(p_limit, 0)
  )
  update public.procedure_afschriften j
     set lease_tot = now() + make_interval(secs => greatest(p_lease_seconds, 1)),
         poging    = j.poging + 1
    from kandidaten g
   where j.id = g.id
  returning j.*;
end
$$;


ALTER FUNCTION "public"."afschriften_claim_jobs"("p_worker_id" "text", "p_limit" integer, "p_lease_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."aqlab_add_run_cost"("p_run_id" "uuid", "p_delta" numeric) RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v numeric;
begin
  update public.aqlab_runs
     set totale_kosten = coalesce(totale_kosten, 0) + coalesce(p_delta, 0)
   where id = p_run_id
   returning totale_kosten into v;
  return v;
end
$$;


ALTER FUNCTION "public"."aqlab_add_run_cost"("p_run_id" "uuid", "p_delta" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."aqlab_assurance_meetwaarden"("p_codes" "text"[]) RETURNS TABLE("feature_code" "text", "release_status" "text", "laatste_controle" timestamp with time zone, "kritieke_bevindingen" integer, "aantal_functioneel" integer, "aantal_blokkerend" integer, "openstaande_review" integer, "regressie_status" "text", "brongebondenheid_ratio" numeric, "format_compliance_ratio" numeric, "vrijgegeven_audit_export_id" "uuid", "inhoud_hash" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
  with feat as (
    select c.code, f.id as feature_id
    from unnest(p_codes) as c(code)
    join public.aqlab_ai_features f on f.code = c.code
  ),
  lb as (  -- laatste besluitregel per feature (ongeacht status)
    select ft.code, ft.feature_id,
           d.release_status, d.besluit_op, d.aangemaakt_op,
           d.kritieke_bevindingen_count, d.run_id
    from feat ft
    left join lateral (
      select d.release_status, d.besluit_op, d.aangemaakt_op,
             d.kritieke_bevindingen_count, d.run_id
      from public.aqlab_release_decisions d
      where d.feature_id = ft.feature_id
      order by d.aangemaakt_op desc
      limit 1
    ) d on true
  ),
  vg as (  -- laatst-vrijgegeven besluitregel per feature (downloadbaar rapport)
    select ft.feature_id, d.audit_export_id
    from feat ft
    left join lateral (
      select d.audit_export_id
      from public.aqlab_release_decisions d
      where d.feature_id = ft.feature_id and d.release_status = 'vrijgegeven'
      order by d.aangemaakt_op desc
      limit 1
    ) d on true
  )
  select
    lb.code,
    lb.release_status,
    coalesce(lb.besluit_op, lb.aangemaakt_op),
    coalesce(lb.kritieke_bevindingen_count, 0),
    -- per_testcase-tellingen: null als per_testcase ontbreekt (matcht de TS).
    case when jsonb_typeof(r.aggregatie->'regressie'->'per_testcase') = 'array'
      then (select count(*)::int from jsonb_array_elements(r.aggregatie->'regressie'->'per_testcase') e
            where e->>'soort' = 'functioneel')
      else null end,
    case when jsonb_typeof(r.aggregatie->'regressie'->'per_testcase') = 'array'
      then (select count(*)::int from jsonb_array_elements(r.aggregatie->'regressie'->'per_testcase') e
            where e->>'soort' = 'security_blocking')
      else null end,
    coalesce((r.aggregatie->'regressie'->'tellingen'->>'openstaande_reviews')::int, 0),
    case
      when r.aggregatie->'regressie'->'tellingen' is null then null
      when coalesce((r.aggregatie->'regressie'->'tellingen'->>'regressies')::int, 0) > 0
        or coalesce((r.aggregatie->'regressie'->'tellingen'->>'nieuwe_blokkades')::int, 0) > 0 then 'regressie'
      when coalesce((r.aggregatie->'regressie'->'tellingen'->>'verbeteringen')::int, 0) > 0 then 'verbeterd'
      else 'gelijk'
    end,
    case when jsonb_typeof(r.aggregatie->'consistency') = 'object'
      then (select avg((v->>'source_correctness_rate')::numeric)
            from jsonb_each(r.aggregatie->'consistency') as x(k, v)
            where jsonb_typeof(v) = 'object' and (v->>'source_correctness_rate') ~ '^-?[0-9.]+$')
      else null end,
    case when jsonb_typeof(r.aggregatie->'consistency') = 'object'
      then (select avg((v->>'format_pass_rate')::numeric)
            from jsonb_each(r.aggregatie->'consistency') as x(k, v)
            where jsonb_typeof(v) = 'object' and (v->>'format_pass_rate') ~ '^-?[0-9.]+$')
      else null end,
    vg.audit_export_id,
    ae.inhoud_hash
  from lb
  left join public.aqlab_runs r on r.id = lb.run_id
  left join vg on vg.feature_id = lb.feature_id
  left join public.aqlab_audit_exports ae on ae.id = vg.audit_export_id;
$_$;


ALTER FUNCTION "public"."aqlab_assurance_meetwaarden"("p_codes" "text"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."aqlab_assurance_meetwaarden"("p_codes" "text"[]) IS 'D1b: gecureerde, geaggregeerde assurance-meetwaarden per feature-code (curatie in SQL; het rauwe aggregatie-blob verlaat de DB niet). Productbreed.';



CREATE OR REPLACE FUNCTION "public"."aqlab_audit_export_bron"("p_export_id" "uuid") RETURNS TABLE("feature_code" "text", "opslag_ref" "text", "is_vrijgegeven" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select
    case when v.is_vrijgegeven then f.code else null end,
    case when v.is_vrijgegeven
      then coalesce(ae.opslag_ref, ae.run_id::text || '/' || ae.id::text || '.html')
      else null end,
    v.is_vrijgegeven
  from public.aqlab_audit_exports ae
  left join public.aqlab_ai_features f on f.id = ae.feature_id
  cross join lateral (
    select exists (
      select 1 from public.aqlab_release_decisions d
      where d.audit_export_id = ae.id and d.release_status = 'vrijgegeven'
    ) as is_vrijgegeven
  ) v
  where ae.id = p_export_id;
$$;


ALTER FUNCTION "public"."aqlab_audit_export_bron"("p_export_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."aqlab_audit_export_bron"("p_export_id" "uuid") IS 'D1b: feature-code + opslag_ref van een VRIJGEGEVEN auditexport (embargo → null). TS toetst fonds-gebruikt-feature via het manifest.';



CREATE TABLE IF NOT EXISTS "public"."aqlab_run_jobs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "test_case_id" "uuid",
    "iteratie" integer DEFAULT 1 NOT NULL,
    "status" "text" DEFAULT 'wachtend'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 2 NOT NULL,
    "lease_expires_at" timestamp with time zone,
    "worker_id" "text",
    "foutcode" "text",
    "aangemaakt_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    "bijgewerkt_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "aqlab_run_jobs_status_check" CHECK (("status" = ANY (ARRAY['wachtend'::"text", 'bezig'::"text", 'klaar'::"text", 'mislukt'::"text", 'overgeslagen'::"text"])))
);


ALTER TABLE "public"."aqlab_run_jobs" OWNER TO "postgres";


COMMENT ON TABLE "public"."aqlab_run_jobs" IS 'AQLab GLOBAAL. Async werk-queue per (run×testcase×iteratie); claim via FOR UPDATE SKIP LOCKED + lease. Operationele state (muteerbaar), geen fonds_id.';



CREATE OR REPLACE FUNCTION "public"."aqlab_claim_run_jobs"("p_worker_id" "text", "p_limit" integer, "p_lease_seconds" integer) RETURNS SETOF "public"."aqlab_run_jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  return query
  update public.aqlab_run_jobs j
     set status = 'bezig',
         worker_id = p_worker_id,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         attempts = j.attempts + 1,
         bijgewerkt_op = now()
   where j.id in (
     select k.id
       from public.aqlab_run_jobs k
      where k.status = 'wachtend'
         or (k.status = 'bezig' and k.lease_expires_at is not null and k.lease_expires_at < now())
      order by k.aangemaakt_op
      for update skip locked
      limit greatest(p_limit, 0)
   )
  returning j.*;
end
$$;


ALTER FUNCTION "public"."aqlab_claim_run_jobs"("p_worker_id" "text", "p_limit" integer, "p_lease_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."aqlab_log_download"("p_export_id" "uuid") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  insert into public.aqlab_log (gebruiker_id, actie, object_type, object_id, nieuwe_waarde)
  select
    auth.uid(),
    'audit_export_gedownload_fonds',
    'aqlab_audit_exports',
    p_export_id,
    jsonb_build_object('fonds_id', (select p.fonds_id from public.profielen p where p.id = auth.uid()))
  where exists (
    select 1 from public.aqlab_release_decisions d
    where d.audit_export_id = p_export_id and d.release_status = 'vrijgegeven'
  );
$$;


ALTER FUNCTION "public"."aqlab_log_download"("p_export_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."aqlab_log_download"("p_export_id" "uuid") IS 'D1b: append-only downloadspoor in aqlab_log (sessie-actor), alleen voor een vrijgegeven export. Insert-only; append-only-trigger blijft gelden.';



CREATE OR REPLACE FUNCTION "public"."contact_aanvraag_insert"("p_naam" "text", "p_organisatie" "text", "p_rol" "text", "p_email" "text", "p_telefoon" "text", "p_type_verzoek" "text", "p_bericht" "text", "p_herkomst_pagina" "text", "p_privacy_version" "text", "p_ip_hash" "text") RETURNS TABLE("id" "uuid", "aangemaakt_op" timestamp with time zone, "status" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_count int;
  v_id uuid;
  v_ts timestamptz;
begin
  if p_ip_hash is not null then
    select count(*) into v_count
    from public.contact_aanvragen
    where ip_hash = p_ip_hash
      and aangemaakt_op >= now() - interval '10 minutes';
    if v_count >= 3 then
      return query select null::uuid, null::timestamptz, 'rate_limited'::text;
      return;
    end if;
  end if;

  insert into public.contact_aanvragen (
    naam, organisatie, rol, email, telefoon, type_verzoek, bericht,
    herkomst_pagina, privacy_version, ip_hash
  ) values (
    p_naam, p_organisatie, p_rol, p_email, p_telefoon, p_type_verzoek, p_bericht,
    p_herkomst_pagina, p_privacy_version, p_ip_hash
  )
  returning contact_aanvragen.id, contact_aanvragen.aangemaakt_op into v_id, v_ts;

  return query select v_id, v_ts, 'ok'::text;
end;
$$;


ALTER FUNCTION "public"."contact_aanvraag_insert"("p_naam" "text", "p_organisatie" "text", "p_rol" "text", "p_email" "text", "p_telefoon" "text", "p_type_verzoek" "text", "p_bericht" "text", "p_herkomst_pagina" "text", "p_privacy_version" "text", "p_ip_hash" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."contact_aanvraag_insert"("p_naam" "text", "p_organisatie" "text", "p_rol" "text", "p_email" "text", "p_telefoon" "text", "p_type_verzoek" "text", "p_bericht" "text", "p_herkomst_pagina" "text", "p_privacy_version" "text", "p_ip_hash" "text") IS 'D1: publieke contactinsert met ingebouwde rate-limit voor de gedeelde surface met de anon-key. SECURITY DEFINER (contact_aanvragen blijft deny-by-default). status ok|rate_limited.';



CREATE OR REPLACE FUNCTION "public"."contact_notificatie_status"("p_id" "uuid", "p_verzonden" boolean, "p_error" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  update public.contact_aanvragen
  set notificatie_verzonden = p_verzonden,
      mail_error = p_error
  where id = p_id;
$$;


ALTER FUNCTION "public"."contact_notificatie_status"("p_id" "uuid", "p_verzonden" boolean, "p_error" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."contact_notificatie_status"("p_id" "uuid", "p_verzonden" boolean, "p_error" "text") IS 'D1: markeert notificatie_verzonden/mail_error na de mailstap (gedeelde surface, anon-key). SECURITY DEFINER; raakt alleen ops-velden.';



CREATE TABLE IF NOT EXISTS "public"."document_processing_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "document_id" "uuid" NOT NULL,
    "versie_id" "uuid",
    "stap" "text" NOT NULL,
    "status" "text" DEFAULT 'wachtend'::"text" NOT NULL,
    "start" timestamp with time zone,
    "eind" timestamp with time zone,
    "foutcode" "text",
    "retry_count" integer DEFAULT 0 NOT NULL,
    "worker_id" "text",
    "correlatie_id" "uuid",
    "aangemaakt" timestamp with time zone DEFAULT "now"() NOT NULL,
    "lease_expires_at" timestamp with time zone,
    "verwerkt_chunks" integer,
    "fonds_id" "uuid",
    "extern_batch_id" "text",
    CONSTRAINT "document_processing_jobs_stap_check" CHECK (("stap" = ANY (ARRAY['validatie'::"text", 'scan'::"text", 'extractie'::"text", 'ocr'::"text", 'chunking'::"text", 'embedding'::"text", 'indexering'::"text", 'semantische_extractie'::"text"]))),
    CONSTRAINT "document_processing_jobs_status_check" CHECK (("status" = ANY (ARRAY['wachtend'::"text", 'bezig'::"text", 'geslaagd'::"text", 'mislukt'::"text", 'overgeslagen'::"text"])))
);


ALTER TABLE "public"."document_processing_jobs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."document_processing_jobs"."lease_expires_at" IS 'Claim-lease én backoff-klok. Verlopen ⇒ herclaimbaar. Toekomst ná providerfout ⇒ backoff.';



COMMENT ON COLUMN "public"."document_processing_jobs"."verwerkt_chunks" IS 'Optionele voortgangsteller (telemetrie). De echte voortgang is chunks met embedding is null.';



COMMENT ON COLUMN "public"."document_processing_jobs"."fonds_id" IS 'Denorm van documenten.fonds_id: auditspoor + eerlijke verdeling (p_max_per_fonds). Geen RLS-grens.';



COMMENT ON COLUMN "public"."document_processing_jobs"."extern_batch_id" IS 'Anthropic Message Batches API-id (besluit D, batch-baan). NULL op de live-baan.';



CREATE OR REPLACE FUNCTION "public"."documenten_claim_ingest_jobs"("p_worker_id" "text", "p_limit" integer, "p_lease_seconds" integer, "p_max_per_fonds" integer) RETURNS SETOF "public"."document_processing_jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return query
  with kandidaten as (
    select k.id,
           k.fonds_id,
           k.aangemaakt,
           (d.agendapunt_id is not null) as prioriteit
      from public.document_processing_jobs k
      join public.documenten d on d.id = k.document_id
     where k.status = 'wachtend'
        or (k.status = 'bezig'
            and k.lease_expires_at is not null
            and k.lease_expires_at < now())
     order by (d.agendapunt_id is not null) desc, k.aangemaakt
     for update of k skip locked
     limit greatest(p_limit, 0) * greatest(coalesce(p_max_per_fonds, 1), 1)
           + greatest(p_limit, 0)
  ),
  gerangschikt as (
    select id, prioriteit, aangemaakt,
           row_number() over (
             partition by fonds_id
             order by prioriteit desc, aangemaakt
           ) as rn_fonds
      from kandidaten
  ),
  geselecteerd as (
    select id
      from gerangschikt
     where rn_fonds <= greatest(coalesce(p_max_per_fonds, 1), 1)
     order by prioriteit desc, aangemaakt
     limit greatest(p_limit, 0)
  )
  update public.document_processing_jobs j
     set status           = 'bezig',
         worker_id        = p_worker_id,
         lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 1)),
         start            = now()
    from geselecteerd g
   where j.id = g.id
  returning j.*;
end
$$;


ALTER FUNCTION "public"."documenten_claim_ingest_jobs"("p_worker_id" "text", "p_limit" integer, "p_lease_seconds" integer, "p_max_per_fonds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_afschrift_bevries_kolommen"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is null then
    return new;  -- service-role / owner: vrij (worker-bouw)
  end if;
  if (
       new.procedure_id           is distinct from old.procedure_id
    or new.fonds_id               is distinct from old.fonds_id
    or new.versie                 is distinct from old.versie
    or new.trigger_status         is distinct from old.trigger_status
    or new.aanleiding             is distinct from old.aanleiding
    or new.status                 is distinct from old.status
    or new.poging                 is distinct from old.poging
    or new.lease_tot              is distinct from old.lease_tot
    or new.laatste_fout           is distinct from old.laatste_fout
    or new.opslag_pad             is distinct from old.opslag_pad
    or new.sha256                 is distinct from old.sha256
    or new.bytes                  is distinct from old.bytes
    or new.bestandsaantal         is distinct from old.bestandsaantal
    or new.bevat_stemgedrag       is distinct from old.bevat_stemgedrag
    or new.gebouwd_onder_rol      is distinct from old.gebouwd_onder_rol
    or new.uitgesloten_items      is distinct from old.uitgesloten_items
    or new.waarschuwingen         is distinct from old.waarschuwingen
    or new.dossier_stand_event_id is distinct from old.dossier_stand_event_id
    or new.dossier_stand_op       is distinct from old.dossier_stand_op
    or new.ai_leeswijzer          is distinct from old.ai_leeswijzer
    or new.ai_model               is distinct from old.ai_model
    or new.ai_promptversie        is distinct from old.ai_promptversie
    or new.ai_tekst_hash          is distinct from old.ai_tekst_hash
    or new.ai_vastgesteld_door    is distinct from old.ai_vastgesteld_door
    or new.ai_vastgesteld_op      is distinct from old.ai_vastgesteld_op
    or new.aangemaakt_op          is distinct from old.aangemaakt_op
    or new.aangemaakt_door        is distinct from old.aangemaakt_door
    or new.id                     is distinct from old.id
  ) then
    raise exception
      'procedure_afschriften: vanuit een gebruikerssessie is alleen intrekken (ingetrokken_*) toegestaan'
      using errcode = '42501';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_afschrift_bevries_kolommen"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_app_error_log"("p_label" "text", "p_categorie" "text", "p_severity" "text", "p_http_status" integer DEFAULT NULL::integer, "p_fouttype" "text" DEFAULT NULL::"text", "p_foutcode" "text" DEFAULT NULL::"text", "p_melding_kort" "text" DEFAULT NULL::"text", "p_context_sleutels" "text"[] DEFAULT NULL::"text"[], "p_correlatie_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_fonds_id uuid;
  v_limiet   jsonb;
begin
  -- ── Volumeklep ────────────────────────────────────────────────────────────
  -- Deze functie is via PostgREST rechtstreeks aanroepbaar door ELKE ingelogde
  -- gebruiker (`POST /rest/v1/rpc/fn_app_error_log`). Zonder rem kan iemand de
  -- tabel vullen en signaal 5 (rate-limit-incidenten) naar believen op rood
  -- zetten of juist in de ruis laten verdwijnen. Een detectie-control die de
  -- gecontroleerde zelf kan vullen is geen control.
  --
  -- Hergebruikt de bestaande primitief uit 2026_06_10_rate_limiting.sql: die
  -- sleutelt op auth.uid(), schoont zichzelf op, en introduceert dus geen nieuw
  -- oppervlak. Boven de limiet wordt de regel STIL genegeerd — een foutlogger
  -- die zelf een fout gooit maakt het probleem erger. Het verlies is zichtbaar:
  -- de betrokken gebruiker zit dan al ver boven een normaal foutvolume.
  begin
    v_limiet := public.fn_rate_limit_check('app_error_log', 120, interval '1 minute');
    if v_limiet is not null and (v_limiet->>'toegestaan')::boolean is false then
      return;
    end if;
  exception when others then
    -- Geen sessie of teller onbereikbaar: doorgaan. Fail-open is hier juist,
    -- want de klep beschermt tegen vervuiling, niet tegen verlies.
    null;
  end;

  -- Server-side fondsafleiding. Geen sessie (machine-/publiek pad) -> null.
  select p.fonds_id into v_fonds_id
    from public.profielen p
   where p.id = auth.uid();

  insert into public.app_errors (
    fonds_id, label, categorie, severity, http_status,
    fouttype, foutcode, melding_kort, context_sleutels, correlatie_id, bron
  ) values (
    v_fonds_id,
    left(p_label, 120),
    p_categorie,
    p_severity,
    p_http_status,
    left(p_fouttype, 80),
    left(p_foutcode, 40),
    left(p_melding_kort, 200),
    -- [1:20] begrenst het AANTAL elementen; left() per element begrenst de
    -- LENGTE. Zonder dat tweede is 20 elementen van 1 MB een rij van 20 MB —
    -- een directe RPC-aanroeper is niet gebonden aan de afkapping in de TS-laag.
    (select array_agg(left(x, 60)) from unnest(p_context_sleutels[1:20]) as x),
    p_correlatie_id,
    'rpc'
  );
end;
$$;


ALTER FUNCTION "public"."fn_app_error_log"("p_label" "text", "p_categorie" "text", "p_severity" "text", "p_http_status" integer, "p_fouttype" "text", "p_foutcode" "text", "p_melding_kort" "text", "p_context_sleutels" "text"[], "p_correlatie_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_app_error_log"("p_label" "text", "p_categorie" "text", "p_severity" "text", "p_http_status" integer, "p_fouttype" "text", "p_foutcode" "text", "p_melding_kort" "text", "p_context_sleutels" "text"[], "p_correlatie_id" "uuid") IS 'P5: enige schrijfpad naar app_errors vanaf de gedeelde (tenant/publieke) surface, die sinds variant C geen service-role meer heeft. SECURITY DEFINER (app_errors blijft deny-by-default); fonds_id wordt server-side uit auth.uid() afgeleid en is geen parameter. NIET aan anon gegeven.';



CREATE OR REPLACE FUNCTION "public"."fn_bron_whitelist_log_hash"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.tijdstip is null then new.tijdstip := now(); end if;
  new.hash := encode(
    digest(
      coalesce(new.whitelist_id::text,'') || '|' ||
      coalesce(new.domein_snapshot,'')    || '|' ||
      coalesce(new.handeling,'')          || '|' ||
      coalesce(new.gewijzigd_door::text,'')|| '|' ||
      coalesce(new.oud::text,'')          || '|' ||
      coalesce(new.nieuw::text,'')        || '|' ||
      coalesce(new.reden,'')              || '|' ||
      new.tijdstip::text,
      'sha256'
    ), 'hex'
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_bron_whitelist_log_hash"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_bron_whitelist_log_immutable"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  raise exception 'bron_whitelist_log is append-only';
end;
$$;


ALTER FUNCTION "public"."fn_bron_whitelist_log_immutable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_build_decision_dossier"("p_decision_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    AS $$
  select jsonb_build_object(
    'decision', to_jsonb(d.*),
    'procedure', (select to_jsonb(p.*) from public.procedures p where p.id = d.procedure_id),
    'assumptions', coalesce((select jsonb_agg(to_jsonb(a.*) order by a.aangemaakt_op)
                              from public.decision_assumptions a where a.decision_id = d.id), '[]'::jsonb),
    'risks',       coalesce((select jsonb_agg(to_jsonb(r.*) order by r.aangemaakt_op)
                              from public.decision_risks r where r.decision_id = d.id), '[]'::jsonb),
    'dissent',     coalesce((select jsonb_agg(to_jsonb(x.*) order by x.aangemaakt_op)
                              from public.decision_dissent x where x.decision_id = d.id), '[]'::jsonb),
    'conditions',  coalesce((select jsonb_agg(to_jsonb(c.*) order by c.aangemaakt_op)
                              from public.decision_conditions c where c.decision_id = d.id), '[]'::jsonb),
    'actions',     coalesce((select jsonb_agg(to_jsonb(ac.*) order by ac.aangemaakt_op)
                              from public.decision_actions ac where ac.decision_id = d.id), '[]'::jsonb),
    'evaluations', coalesce((select jsonb_agg(to_jsonb(e.*) order by e.geplande_datum)
                              from public.decision_evaluations e where e.decision_id = d.id), '[]'::jsonb),
    'aiOutputs',   coalesce((select jsonb_agg(to_jsonb(ai.*) order by ai.aangemaakt_op)
                              from public.decision_ai_interactions ai where ai.decision_id = d.id), '[]'::jsonb),
    'events',      coalesce((select jsonb_agg(to_jsonb(g.*) order by g.tijdstip)
                              from public.governance_events g where g.decision_id = d.id), '[]'::jsonb),
    -- Nieuw: gesloten/ingetrokken stemmingen (open uitgesloten — geen vaste uitslag)
    'stemverslagen', coalesce((select jsonb_agg(to_jsonb(s.*) order by s.geopend_op desc)
                              from public.stemmingen s
                             where s.decision_id = d.id
                               and s.status in ('gesloten','ingetrokken')), '[]'::jsonb)
  )
    from public.decision_objects d
   where d.id = p_decision_id;
$$;


ALTER FUNCTION "public"."fn_build_decision_dossier"("p_decision_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_chunk_denorm"("p_document_id" "uuid") RETURNS TABLE("procesmodel_id" "uuid", "procesinstantie_id" "uuid", "vergadering_id" "uuid", "agendapunt_id" "uuid", "documenttype" "text", "documentstatus" "text", "documentdatum" "date", "periode" "text", "bronstatus" "text", "geldig_vanaf" "date", "geldig_tot" "date", "bibliotheek" "text", "bronorganisatie" "text", "normgewicht" "text", "extern_url" "text", "wettelijk_regime" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select
    pr.procesmodel_id,
    d.procesinstantie_id,
    d.vergadering_id,
    d.agendapunt_id,
    d.documenttype,
    d.status as documentstatus,
    d.documentdatum,
    case
      when pr.periode_jaar is not null then pr.periode_jaar::text
      when d.documentdatum is not null then extract(year from d.documentdatum)::text
      else null
    end as periode,
    d.bronstatus,
    d.geldig_vanaf,
    d.geldig_tot,
    d.bibliotheek,
    d.bronorganisatie,
    d.normgewicht,
    d.extern_url,
    d.wettelijk_regime
  from public.documenten d
  left join public.procedures pr on pr.id = d.procesinstantie_id
  where d.id = p_document_id;
$$;


ALTER FUNCTION "public"."fn_chunk_denorm"("p_document_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_chunk_denorm_before_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v record;
begin
  select * into v from public.fn_chunk_denorm(new.document_id);
  if found then
    new.procesmodel_id     := v.procesmodel_id;
    new.procesinstantie_id := v.procesinstantie_id;
    new.agendapunt_id      := coalesce(new.agendapunt_id, v.agendapunt_id);
    new.vergadering_id     := coalesce(new.vergadering_id, v.vergadering_id);
    new.documenttype       := v.documenttype;
    new.documentstatus     := v.documentstatus;
    new.documentdatum      := v.documentdatum;
    new.periode            := v.periode;
    new.bronstatus         := v.bronstatus;
    new.geldig_vanaf       := v.geldig_vanaf;
    new.geldig_tot         := v.geldig_tot;
    new.bibliotheek        := v.bibliotheek;
    new.bronorganisatie    := v.bronorganisatie;
    new.normgewicht        := v.normgewicht;
    new.extern_url         := v.extern_url;
    new.wettelijk_regime   := v.wettelijk_regime;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_chunk_denorm_before_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_chunk_denorm_refresh"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  update public.document_chunks dc
     set procesmodel_id     = v.procesmodel_id,
         procesinstantie_id = v.procesinstantie_id,
         vergadering_id     = v.vergadering_id,
         agendapunt_id      = v.agendapunt_id,
         documenttype       = v.documenttype,
         documentstatus     = v.documentstatus,
         documentdatum      = v.documentdatum,
         periode            = v.periode,
         bronstatus         = v.bronstatus,
         geldig_vanaf       = v.geldig_vanaf,
         geldig_tot         = v.geldig_tot,
         bibliotheek        = v.bibliotheek,
         bronorganisatie    = v.bronorganisatie,
         normgewicht        = v.normgewicht,
         extern_url         = v.extern_url,
         wettelijk_regime   = v.wettelijk_regime
    from public.fn_chunk_denorm(new.id) v
   where dc.document_id = new.id;
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_chunk_denorm_refresh"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_contact_aanvragen_no_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  raise exception 'contact_aanvragen is append-only — gebruik status i.p.v. delete';
end;
$$;


ALTER FUNCTION "public"."fn_contact_aanvragen_no_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_decision_code"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  jaar text := to_char(now(), 'YYYY');
  vol  int  := nextval('public.decision_seq');
begin
  if new.besluit_code is null or new.besluit_code = '' then
    new.besluit_code := 'BSL-' || jaar || '-' || lpad(vol::text, 4, '0');
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_decision_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_decision_readiness_check"("p_decision_id" "uuid", "p_target" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    AS $$
#variable_conflict use_column
declare
  v_dec       record;
  v_proc      record;
  ontbrekend  jsonb := '[]'::jsonb;
  blokkerend  boolean := false;
  rij         record;
  relevante_types text[];
begin
  select * into v_dec from public.decision_objects where id = p_decision_id;
  if not found then
    return jsonb_build_object('error', 'decision_not_found');
  end if;
  select * into v_proc from public.procedures where id = v_dec.procedure_id;

  relevante_types := case p_target
    when 'onderbouwing_compleet' then array['document','field']
    when 'reviewrijp'            then array['document','field','ai_validation','risk']
    when 'bespreekrijp'          then array['document','field','ai_validation','risk','assumption']
    when 'besluitrijp'           then array['document','field','ai_validation','risk','assumption','mandate_check','approval','consultation']
    when 'verantwoordingsrijp'   then array['document','field','ai_validation','risk','assumption','mandate_check','approval','dissent_review','consultation','external_submission']
    when 'evaluatierijp'         then array['kpi','evaluation']
    else array['document']
  end;

  -- UNIE van template-requirements en actieve instantie-requirements.
  -- Beide armen leveren dezelfde kolomvorm; de classificatie-conditionals
  -- gelden alleen op de template-arm (instantie-items hebben geen triggers).
  for rij in
    select requirement_type, stap_volgorde, label, documenttype, veld_pad,
           blokkerend, min_aantal, vereist_validatie_domein
      from public.procedure_requirements
     where template_code = v_proc.template_code
       and verplicht = true
       and requirement_type = any (relevante_types)
       and (triggert_bij_complexiteit       is null or v_dec.complexiteit       = any (triggert_bij_complexiteit))
       and (triggert_bij_risiconiveau       is null or v_dec.risiconiveau       = any (triggert_bij_risiconiveau))
       and (triggert_bij_mandaatgevoelig    is null or v_dec.mandaatgevoelig    = triggert_bij_mandaatgevoelig)
       and (triggert_bij_toezichtgevoelig   is null or v_dec.toezichtgevoelig   = triggert_bij_toezichtgevoelig)
       and not exists (
         select 1 from public.procedure_requirement_uitsluiting u
          where u.decision_id      = p_decision_id
            and u.stap_volgorde    = procedure_requirements.stap_volgorde
            and u.requirement_type = procedure_requirements.requirement_type
            and u.match_sleutel    = coalesce(procedure_requirements.documenttype, procedure_requirements.label)
            and u.actief
       )
    union all
    select requirement_type, stap_volgorde, label, documenttype, veld_pad,
           blokkerend, min_aantal, vereist_validatie_domein
      from public.procedure_requirement_instance
     where decision_id = p_decision_id
       and actief = true
       and verplicht = true
       and requirement_type = any (relevante_types)
  loop
    declare
      vervuld    boolean := false;
      v_count    int;
      v_drempel  int;
      -- external_submission/consultation delen de document-afhandeling.
      v_type     text := case
                           when rij.requirement_type in ('external_submission','consultation')
                             then 'document'
                           else rij.requirement_type
                         end;
    begin
      case v_type
        when 'document' then
          vervuld := exists (
            select 1
              from public.procedure_stappen ps
              join public.procedure_bewijs pb on pb.stap_id = ps.id
             where ps.procedure_id = v_proc.id
               and ps.volgorde = rij.stap_volgorde
               and (
                    rij.documenttype is null
                 or pb.documenttype = rij.documenttype
                 or lower(coalesce(pb.titel,'')) like '%' || lower(rij.documenttype) || '%'
               )
          );

        when 'ai_validation' then
          vervuld := exists (
            select 1 from public.decision_ai_interactions ai
             where ai.decision_id = p_decision_id
               and ai.validatiestatus in ('gevalideerd','aangepast')
               and (
                    rij.vereist_validatie_domein is null
                 or ai.validatie_domein = rij.vereist_validatie_domein
               )
          );

        when 'assumption' then
          v_drempel := coalesce(rij.min_aantal, 1);
          select count(*) into v_count
            from public.decision_assumptions
           where decision_id = p_decision_id
             and status in ('gevalideerd','gewijzigd');
          vervuld := v_count >= v_drempel;

        when 'risk' then
          vervuld := exists (
            select 1 from public.decision_risks where decision_id = p_decision_id
          );

        when 'mandate_check' then
          vervuld := exists (
            select 1 from public.governance_events
             where decision_id = p_decision_id and event_type = 'mandate_check_passed'
          );

        when 'approval' then
          vervuld := v_dec.status in ('besloten','voorwaardelijk_besloten','in_uitvoering','in_evaluatie','afgesloten');

        when 'kpi' then
          vervuld := exists (
            select 1 from public.decision_conditions where decision_id = p_decision_id and kpi is not null
          );

        when 'evaluation' then
          vervuld := exists (
            select 1 from public.decision_evaluations where decision_id = p_decision_id
          );

        when 'dissent_review' then
          vervuld := not exists (
            select 1 from public.decision_dissent
             where decision_id = p_decision_id
               and zichtbaarheid in ('formele_dissent','minderheidsnotitie')
               and not formeel_vastgesteld
          );

        when 'field' then
          if rij.veld_pad = 'decision.besluitvraag' then
            vervuld := v_dec.besluitvraag is not null
                   and v_dec.besluitvraag !~ '^Aanvullen na auto-upgrade';
          elsif rij.veld_pad = 'decision.scope' then
            vervuld := v_dec.scope is not null and length(trim(v_dec.scope)) > 0;
          else
            vervuld :=
              exists (select 1 from public.governance_events
                       where decision_id = p_decision_id
                         and event_type = 'classificatie_bevestigd')
              or v_dec.complexiteit <> 'complicated'
              or v_dec.risiconiveau <> 'middel';
          end if;

        else
          vervuld := false;
      end case;

      if not vervuld then
        ontbrekend := ontbrekend || jsonb_build_object(
          'requirement_type', rij.requirement_type,
          'stap_volgorde',    rij.stap_volgorde,
          'label',            rij.label,
          'documenttype',     rij.documenttype,
          'blokkerend',       rij.blokkerend
        );
        if rij.blokkerend then blokkerend := true; end if;
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'decision_id',    p_decision_id,
    'target',         p_target,
    'voldoet',        not blokkerend,
    'blokkerend',     blokkerend,
    'kan_overrulen',  array['voorzitter','beheerder'],
    'ontbrekend',     ontbrekend
  );
end;
$$;


ALTER FUNCTION "public"."fn_decision_readiness_check"("p_decision_id" "uuid", "p_target" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_decision_readiness_overview"("p_decision_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    AS $$
  select jsonb_build_object(
    'onderbouwing_compleet', public.fn_decision_readiness_check(p_decision_id, 'onderbouwing_compleet'),
    'reviewrijp',            public.fn_decision_readiness_check(p_decision_id, 'reviewrijp'),
    'bespreekrijp',          public.fn_decision_readiness_check(p_decision_id, 'bespreekrijp'),
    'besluitrijp',           public.fn_decision_readiness_check(p_decision_id, 'besluitrijp'),
    'verantwoordingsrijp',   public.fn_decision_readiness_check(p_decision_id, 'verantwoordingsrijp'),
    'evaluatierijp',         public.fn_decision_readiness_check(p_decision_id, 'evaluatierijp')
  );
$$;


ALTER FUNCTION "public"."fn_decision_readiness_overview"("p_decision_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_decision_snapshot"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_doc jsonb;
begin
  if new.status in ('besloten','voorwaardelijk_besloten','in_evaluatie','afgesloten')
     and (old.status is null or old.status <> new.status) then
    select public.fn_build_decision_dossier(new.id) into v_doc;
    insert into public.decision_audit_snapshots(decision_id, trigger_status, snapshot, hash)
    values (
      new.id,
      new.status,
      v_doc,
      encode(digest(v_doc::text, 'sha256'), 'hex')
    );
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_decision_snapshot"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_decision_status_check"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  toegestaan jsonb := jsonb_build_object(
    'concept',                    jsonb_build_array('in_onderbouwing','geannuleerd'),
    'in_onderbouwing',            jsonb_build_array('in_validatie','teruggezet','geannuleerd'),
    'in_validatie',               jsonb_build_array('in_review','teruggezet','geescaleerd'),
    'in_review',                  jsonb_build_array('geagendeerd','teruggezet','geescaleerd'),
    'geagendeerd',                jsonb_build_array('in_bespreking','aangehouden'),
    'in_bespreking',              jsonb_build_array('besloten','voorwaardelijk_besloten','aangehouden','teruggezet','afgewezen'),
    'besloten',                   jsonb_build_array('in_uitvoering','afgesloten'),
    'voorwaardelijk_besloten',    jsonb_build_array('in_uitvoering','heropend'),
    'in_uitvoering',              jsonb_build_array('in_evaluatie','geescaleerd'),
    'in_evaluatie',               jsonb_build_array('afgesloten','heropend'),
    'afgesloten',                 jsonb_build_array('heropend'),
    'teruggezet',                 jsonb_build_array('in_onderbouwing','in_validatie'),
    'geescaleerd',                jsonb_build_array('in_validatie','in_review','aangehouden'),
    'aangehouden',                jsonb_build_array('in_review','geagendeerd','geannuleerd'),
    'heropend',                   jsonb_build_array('in_onderbouwing','in_validatie'),
    'afgewezen',                  jsonb_build_array(),
    'geannuleerd',                jsonb_build_array()
  );
  toegestane_arr text[];
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  toegestane_arr := array(
    select jsonb_array_elements_text(coalesce(toegestaan -> old.status, '[]'::jsonb))
  );
  if not (new.status = any (toegestane_arr)) then
    raise exception
      'Ongeldige statusovergang van % naar %. Toegestaan: %',
      old.status, new.status, toegestane_arr;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_decision_status_check"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_decision_touch"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.laatst_gewijzigd := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_decision_touch"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_doc_meta_log_hash"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.tijdstip is null then new.tijdstip := now(); end if;
  new.hash := encode(
    digest(
      coalesce(new.document_id::text,'') || '|' ||
      coalesce(new.veld_naam,'')         || '|' ||
      coalesce(new.oude_waarde,'')       || '|' ||
      coalesce(new.nieuwe_waarde,'')     || '|' ||
      coalesce(new.wijzig_reden,'')      || '|' ||
      coalesce(new.wijzig_type,'')       || '|' ||
      coalesce(new.rag_impact::text,'')  || '|' ||
      new.tijdstip::text,
      'sha256'
    ), 'hex'
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_doc_meta_log_hash"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_doc_meta_log_immutable"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  raise exception 'document_metadata_log is append-only';
end;
$$;


ALTER FUNCTION "public"."fn_doc_meta_log_immutable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_document_agendapunt_validatie"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_doc_fonds   uuid;
  v_doc_primair uuid;
  v_ap_verg     uuid;
  v_verg_fonds  uuid;
begin
  select fonds_id, agendapunt_id into v_doc_fonds, v_doc_primair
    from public.documenten where id = new.document_id;
  if v_doc_fonds is null then
    raise exception
      'Generiek document (fonds_id NULL) kan geen vergaderkoppeling krijgen (document %)', new.document_id;
  end if;

  select vergadering_id into v_ap_verg
    from public.agendapunten where id = new.agendapunt_id;
  if v_ap_verg is null then
    raise exception 'Agendapunt % bestaat niet of heeft geen vergadering', new.agendapunt_id;
  end if;
  if new.vergadering_id is distinct from v_ap_verg then
    raise exception
      'vergadering_id (%) hoort niet bij agendapunt % (verwacht %).',
      new.vergadering_id, new.agendapunt_id, v_ap_verg;
  end if;

  select fonds_id into v_verg_fonds
    from public.vergaderingen where id = new.vergadering_id;
  if not (v_doc_fonds = v_verg_fonds and v_doc_fonds = new.fonds_id) then
    raise exception
      'Fondsconsistentie geschonden: document-fonds %, vergadering-fonds %, koppel-fonds %',
      v_doc_fonds, v_verg_fonds, new.fonds_id;
  end if;

  if v_doc_primair is not null and new.agendapunt_id = v_doc_primair then
    raise exception
      'Secundaire koppeling mag niet gelijk zijn aan de primaire agendapunt-koppeling (%).',
      v_doc_primair;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."fn_document_agendapunt_validatie"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_document_agendapunt_vergadering_check"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_verg uuid;
begin
  if new.agendapunt_id is not null then
    select vergadering_id into v_verg
      from public.agendapunten where id = new.agendapunt_id;
    if v_verg is null then
      raise exception 'Agendapunt % bestaat niet', new.agendapunt_id;
    end if;
    if new.vergadering_id is distinct from v_verg then
      raise exception
        'Agendapunt % hoort niet bij de opgegeven vergadering % (maar bij %).',
        new.agendapunt_id, new.vergadering_id, v_verg;
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_document_agendapunt_vergadering_check"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_document_primair_vs_secundair_check"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.procesinstantie_id is not null
     and new.procesinstantie_id is distinct from old.procesinstantie_id
     and exists (
       select 1 from public.document_procesinstanties
        where document_id = new.id
          and procesinstantie_id = new.procesinstantie_id
     ) then
    raise exception
      'Nieuwe primaire procesinstantie % is al een secundaire koppeling van dit document. Verwijder eerst de secundaire koppeling.',
      new.procesinstantie_id;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_document_primair_vs_secundair_check"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_document_procesinstantie_fonds_check"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_proc_fonds uuid;
begin
  if new.procesinstantie_id is null then
    return new;
  end if;
  select fonds_id into v_proc_fonds
    from public.procedures
   where id = new.procesinstantie_id;
  if v_proc_fonds is null then
    raise exception 'Procesinstantie % bestaat niet', new.procesinstantie_id;
  end if;
  if new.fonds_id is distinct from v_proc_fonds then
    raise exception
      'Fondsconsistentie geschonden: document-fonds % ≠ procesinstantie-fonds %',
      new.fonds_id, v_proc_fonds;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_document_procesinstantie_fonds_check"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_document_procesinstantie_validatie"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_doc_fonds    uuid;
  v_doc_primair  uuid;
  v_proc_fonds   uuid;
begin
  select fonds_id, procesinstantie_id into v_doc_fonds, v_doc_primair
    from public.documenten where id = new.document_id;
  if v_doc_fonds is null then
    raise exception
      'Generiek document (fonds_id NULL) kan geen secundaire dossierkoppeling krijgen (document %)', new.document_id;
  end if;

  select fonds_id into v_proc_fonds
    from public.procedures where id = new.procesinstantie_id;
  if v_proc_fonds is null then
    raise exception 'Procesinstantie % bestaat niet', new.procesinstantie_id;
  end if;

  if not (v_doc_fonds = v_proc_fonds and v_doc_fonds = new.fonds_id) then
    raise exception
      'Fondsconsistentie geschonden: document-fonds %, procesinstantie-fonds %, koppel-fonds %',
      v_doc_fonds, v_proc_fonds, new.fonds_id;
  end if;

  if new.procesinstantie_id = v_doc_primair then
    raise exception
      'Secundaire koppeling mag niet gelijk zijn aan de primaire procesinstantie (%).',
      v_doc_primair;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."fn_document_procesinstantie_validatie"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_document_status_overgang_check"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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


ALTER FUNCTION "public"."fn_document_status_overgang_check"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_document_status_transitie"("p_van" "text", "p_naar" "text") RETURNS TABLE("toegestaan" boolean, "redenplicht" boolean, "vereist_vervangen_door" boolean, "herindexering" boolean, "bruikbaar_actueel" boolean)
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select t.toegestaan::boolean,
         t.redenplicht::boolean,
         t.vereist_vervangen_door::boolean,
         t.herindexering::boolean,
         t.bruikbaar_actueel::boolean
  from (values
    -- Ingest-verklaringen (besluit 0136). `upload` is een pseudo-herkomst.
    ('upload',      'concept',      true,  false, false, true,  false),
    ('upload',      'vastgesteld',  true,  true,  false, true,  true ),
    ('upload',      'van_kracht',   true,  true,  false, true,  true ),
    -- Portaal-keten zonder tussenstaten (0154).
    ('concept',     'vastgesteld',  true,  true,  false, true,  true ),
    ('vastgesteld', 'van_kracht',   true,  false, false, true,  true ),
    -- Afvoeren naar historisch (merge; vervangen_door optioneel).
    ('vastgesteld', 'historisch',   true,  true,  false, true,  false),
    ('van_kracht',  'historisch',   true,  true,  false, true,  false),
    -- Archiveren vanaf elke levende status.
    ('concept',     'gearchiveerd', true,  true,  false, true,  false),
    ('vastgesteld', 'gearchiveerd', true,  true,  false, true,  false),
    ('van_kracht',  'gearchiveerd', true,  true,  false, true,  false),
    ('historisch',  'gearchiveerd', true,  true,  false, true,  false)
  ) as t(van, naar, toegestaan, redenplicht, vereist_vervangen_door, herindexering, bruikbaar_actueel)
  where t.van = p_van and t.naar = p_naar;
$$;


ALTER FUNCTION "public"."fn_document_status_transitie"("p_van" "text", "p_naar" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_dossierstatus_van_decision"("p_status" "text") RETURNS TABLE("dossierstatus" "text", "sublabel" "text")
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select
    case p_status
      when 'concept'                 then 'lopend'
      when 'in_onderbouwing'         then 'lopend'
      when 'in_validatie'            then 'lopend'
      when 'in_review'               then 'lopend'
      when 'teruggezet'              then 'lopend'
      when 'geescaleerd'             then 'lopend'
      when 'aangehouden'             then 'lopend'
      when 'geagendeerd'             then 'ter_besluitvorming'
      when 'in_bespreking'           then 'ter_besluitvorming'
      when 'besloten'                then 'besloten'
      when 'voorwaardelijk_besloten' then 'besloten'
      when 'in_uitvoering'           then 'in_implementatie'
      when 'in_evaluatie'            then 'in_implementatie'
      when 'afgesloten'              then 'afgerond'
      when 'afgewezen'               then 'afgerond'
      when 'geannuleerd'             then 'afgerond'
      when 'heropend'                then 'heropend'
      else null   -- onbekende status → geen afleiding
    end as dossierstatus,
    case p_status
      when 'voorwaardelijk_besloten' then 'voorwaardelijk'
      when 'teruggezet'              then 'teruggezet'
      when 'geescaleerd'             then 'geëscaleerd'
      when 'aangehouden'             then 'aangehouden'
      when 'in_evaluatie'            then 'in evaluatie'
      when 'afgewezen'               then 'afgewezen'
      when 'geannuleerd'             then 'geannuleerd'
      else null
    end as sublabel;
$$;


ALTER FUNCTION "public"."fn_dossierstatus_van_decision"("p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_export_log_immutable"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  raise exception 'governance_export_log is append-only';
end;
$$;


ALTER FUNCTION "public"."fn_export_log_immutable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_fonds_config_capture"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_type    text;
  v_sleutel text;
  v_oude    jsonb;
  v_nieuwe  jsonb;
  v_naam    text;
begin
  if tg_table_name = 'fonds_theming' then
    v_type := 'theming'; v_sleutel := 'tokens';
    v_nieuwe := new.tokens;
    v_oude := case when tg_op = 'UPDATE' then old.tokens else null end;
  elsif tg_table_name = 'fonds_module_manifest' then
    v_type := 'manifest'; v_sleutel := new.module_key;
    v_nieuwe := to_jsonb(new.actief);
    v_oude := case when tg_op = 'UPDATE' then to_jsonb(old.actief) else null end;
  elsif tg_table_name = 'fonds_feature_flags' then
    v_type := 'flag'; v_sleutel := new.flag_key;
    v_nieuwe := new.waarde;
    v_oude := case when tg_op = 'UPDATE' then old.waarde else null end;
  elsif tg_table_name = 'fonds_content_overrides' then
    v_type := 'override'; v_sleutel := new.sleutel;
    v_nieuwe := to_jsonb(new.waarde);
    v_oude := case when tg_op = 'UPDATE' then to_jsonb(old.waarde) else null end;
  else
    raise exception 'fn_fonds_config_capture: onverwachte tabel %', tg_table_name;
  end if;

  -- Naam-snapshot bij de actor (nullable: seeds zetten geen bijgewerkt_door).
  select naam into v_naam from public.profielen where id = new.bijgewerkt_door;

  insert into public.fonds_config_log (
    fonds_id, gebruiker_id, gebruiker_naam, config_type, config_sleutel,
    oude_waarde, nieuwe_waarde, versie
  ) values (
    new.fonds_id, new.bijgewerkt_door, v_naam, v_type, v_sleutel,
    v_oude, v_nieuwe, new.versie
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_fonds_config_capture"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_fonds_stuurinfo_capture"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."fn_fonds_stuurinfo_capture"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_generiek_geldigheidsstatus"("p_status" "text", "p_bronstatus" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case
    when p_status = 'van_kracht'
         and coalesce(p_bronstatus, 'actief') = 'actief'      then 'published'
    when p_status = 'gearchiveerd'
         or coalesce(p_bronstatus, 'actief') = 'uitgesloten'  then 'withdrawn'
    when p_status = 'historisch'
         or coalesce(p_bronstatus, 'actief') = 'historisch'   then 'deprecated'
    else 'draft'
  end;
$$;


ALTER FUNCTION "public"."fn_generiek_geldigheidsstatus"("p_status" "text", "p_bronstatus" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_generiek_geldigheidsstatus"("p_status" "text", "p_bronstatus" "text") IS 'T10: canonieke generieke geldigheidsstatus (draft/published/deprecated/withdrawn) AFGELEID over status/bronstatus. 1-op-1 spiegel van lib/generiek-status.ts::generiekGeldigheidsstatus (besluit 0048). Bij wijziging: pas beide aan + draai de sanity.';



CREATE OR REPLACE FUNCTION "public"."fn_generiek_status_overgang_check"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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


ALTER FUNCTION "public"."fn_generiek_status_overgang_check"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_generiek_transitie"("p_van" "text", "p_naar" "text") RETURNS TABLE("toegestaan" boolean, "redenplicht" boolean)
    LANGUAGE "sql" IMMUTABLE
    AS $$
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


ALTER FUNCTION "public"."fn_generiek_transitie"("p_van" "text", "p_naar" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_generiek_transitie"("p_van" "text", "p_naar" "text") IS 'T10: expliciete toegestane canonieke overgangen voor generieke content. withdrawn is terminaal. Spiegelt lib/generiek-status.ts::GENERIEKE_TRANSITIES.';



CREATE OR REPLACE FUNCTION "public"."fn_govevent_hash"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.tijdstip is null then new.tijdstip := now(); end if;
  new.hash := encode(
    digest(
      coalesce(new.event_type,'')        || '|' ||
      coalesce(new.decision_id::text,'') || '|' ||
      coalesce(new.object_type,'')       || '|' ||
      coalesce(new.object_id::text,'')   || '|' ||
      coalesce(new.oude_waarde::text,'') || '|' ||
      coalesce(new.nieuwe_waarde::text,'')|| '|' ||
      new.tijdstip::text,
      'sha256'
    ), 'hex'
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_govevent_hash"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_govevent_immutable"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  raise exception 'governance_events is append-only';
end;
$$;


ALTER FUNCTION "public"."fn_govevent_immutable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_log_append_only"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  raise exception '% is append-only (geen UPDATE/DELETE toegestaan)', tg_table_name;
end;
$$;


ALTER FUNCTION "public"."fn_log_append_only"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_notulen_segment_audit"("p_document_id" "uuid", "p_veld" "text", "p_oud" "text", "p_nieuw" "text", "p_reden" "text", "p_rag_impact" boolean) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_titel text;
  v_fonds uuid;
  v_naam  text;
begin
  select titel, fonds_id into v_titel, v_fonds from public.documenten where id = p_document_id;
  select naam into v_naam from public.profielen where id = auth.uid();
  insert into public.document_metadata_log (
    document_id, document_titel_snapshot, fonds_id,
    gewijzigd_door, gewijzigd_door_naam,
    veld_naam, oude_waarde, nieuwe_waarde, wijzig_reden, wijzig_type, rag_impact
  ) values (
    p_document_id, v_titel, v_fonds,
    auth.uid(), v_naam,
    p_veld, p_oud, p_nieuw, p_reden, 'notulen_segment', p_rag_impact
  );
end;
$$;


ALTER FUNCTION "public"."fn_notulen_segment_audit"("p_document_id" "uuid", "p_veld" "text", "p_oud" "text", "p_nieuw" "text", "p_reden" "text", "p_rag_impact" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_notulen_segment_bevestig"("p_segment_id" "uuid", "p_chunks" "jsonb", "p_reden" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_seg      record;
  v_status   text;
  v_base     int;
begin
  -- Segment laden (RLS filtert op fonds; not found = geen toegang).
  select id, document_id, vergadering_id, agendapunt_id, bevestigd
    into v_seg
    from public.notulen_segmenten
   where id = p_segment_id;
  if not found then
    raise exception 'Notulensegment % niet gevonden (of geen toegang).', p_segment_id;
  end if;

  -- Actieve-besluitbron-gate (§11.1): alleen vastgestelde notulen indexeren.
  select status into v_status from public.documenten where id = v_seg.document_id;
  if v_status is distinct from 'vastgesteld' then
    raise exception 'Notulen % zijn niet vastgesteld (status=%); indexering geweigerd.',
      v_seg.document_id, coalesce(v_status, '(null)');
  end if;

  -- Lege-segment-guard: nooit de whole-document-chunks weggooien zonder vervanging.
  if p_chunks is null or jsonb_array_length(p_chunks) = 0 then
    raise exception 'Notulensegment % levert geen chunks op; indexering geweigerd.', p_segment_id;
  end if;

  -- Bevestiging vastleggen.
  update public.notulen_segmenten
     set bevestigd = true, bevestigd_door = auth.uid(), bevestigd_op = now()
   where id = p_segment_id;

  -- Eerste-bevestiging-vervanging: whole-document-chunks weg (idempotent), dan dit
  -- segment opnieuw.
  delete from public.document_chunks
   where document_id = v_seg.document_id and notulen_segment_id is null;
  delete from public.document_chunks
   where notulen_segment_id = p_segment_id;

  -- chunk_index-offset zodat segmenten elkaar niet overschrijven.
  select coalesce(max(chunk_index), -1) + 1 into v_base
    from public.document_chunks where document_id = v_seg.document_id;

  -- Nieuwe segmentchunks. agendapunt_id/vergadering_id van het SEGMENT; de BEFORE
  -- INSERT-trigger (met COALESCE-fix) behoudt ze en vult de overige denorm.
  insert into public.document_chunks (
    document_id, chunk_index, tekst, pagina, paragraaf,
    embedding, embedding_model, notulen_segment_id, vergadering_id, agendapunt_id
  )
  select
    v_seg.document_id,
    v_base + (c->>'chunk_index')::int,
    c->>'tekst',
    (c->>'pagina')::int,
    c->>'paragraaf',
    case when coalesce(c->>'embedding', '') <> '' then (c->>'embedding')::vector else null end,
    nullif(c->>'embedding_model', ''),
    p_segment_id,
    v_seg.vergadering_id,
    v_seg.agendapunt_id
  from jsonb_array_elements(p_chunks) as c;

  -- Append-only audit in dezelfde transactie.
  perform public.fn_notulen_segment_audit(
    v_seg.document_id, 'segment_bevestigd',
    case when v_seg.bevestigd then 'true' else 'false' end, 'true',
    p_reden, true
  );
end;
$$;


ALTER FUNCTION "public"."fn_notulen_segment_bevestig"("p_segment_id" "uuid", "p_chunks" "jsonb", "p_reden" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_notulen_segment_bevestig"("p_segment_id" "uuid", "p_chunks" "jsonb", "p_reden" "text") IS 'Increment D — bevestigen + transactioneel (her)indexeren van één notulensegment (vervangt whole-document-chunks, keuze 2) + append-only audit, alles in één transactie. Vereist documenten.status=''vastgesteld''.';



CREATE OR REPLACE FUNCTION "public"."fn_notulen_segment_check"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_doc_type   text;
  v_doc_fonds  uuid;
  v_verg_fonds uuid;
  v_ap_verg    uuid;
begin
  -- Regel 1: document moet bestaan en documenttype='notulen' dragen.
  select documenttype, fonds_id into v_doc_type, v_doc_fonds
    from public.documenten where id = new.document_id;
  if not found then
    raise exception 'Notulensegment verwijst naar onbekend document %', new.document_id;
  end if;
  if v_doc_type is distinct from 'notulen' then
    raise exception 'Notulensegment mag alleen bij een document met documenttype=''notulen'' (document % heeft type %).',
      new.document_id, coalesce(v_doc_type, '(null)');
  end if;

  -- Regel 2: als agendapunt gezet — het moet bij DEZE vergadering horen (C-regel 3b).
  if new.agendapunt_id is not null then
    select vergadering_id into v_ap_verg
      from public.agendapunten where id = new.agendapunt_id;
    if v_ap_verg is null then
      raise exception 'Agendapunt % bestaat niet', new.agendapunt_id;
    end if;
    if new.vergadering_id is distinct from v_ap_verg then
      raise exception 'Agendapunt % hoort niet bij de opgegeven vergadering % (maar bij %).',
        new.agendapunt_id, new.vergadering_id, v_ap_verg;
    end if;
  end if;

  -- Regel 3: fondsconsistentie segment ↔ document ↔ vergadering.
  select fonds_id into v_verg_fonds
    from public.vergaderingen where id = new.vergadering_id;
  if v_verg_fonds is null then
    raise exception 'Vergadering % bestaat niet', new.vergadering_id;
  end if;
  if new.fonds_id is distinct from v_doc_fonds then
    raise exception 'Notulensegment-fonds % wijkt af van documentfonds %.', new.fonds_id, v_doc_fonds;
  end if;
  if new.fonds_id is distinct from v_verg_fonds then
    raise exception 'Notulensegment-fonds % wijkt af van vergaderingfonds %.', new.fonds_id, v_verg_fonds;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."fn_notulen_segment_check"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_notulen_segment_ontbevestig"("p_segment_id" "uuid", "p_reden" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_seg record;
begin
  select id, document_id, bevestigd into v_seg
    from public.notulen_segmenten where id = p_segment_id;
  if not found then
    raise exception 'Notulensegment % niet gevonden (of geen toegang).', p_segment_id;
  end if;

  update public.notulen_segmenten
     set bevestigd = false, bevestigd_door = null, bevestigd_op = null
   where id = p_segment_id;

  delete from public.document_chunks where notulen_segment_id = p_segment_id;

  perform public.fn_notulen_segment_audit(
    v_seg.document_id, 'segment_bevestigd', 'true', 'false', p_reden, true
  );
end;
$$;


ALTER FUNCTION "public"."fn_notulen_segment_ontbevestig"("p_segment_id" "uuid", "p_reden" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_notulen_segment_verwijder"("p_segment_id" "uuid", "p_reden" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_seg record;
begin
  select id, document_id, titel, bevestigd into v_seg
    from public.notulen_segmenten where id = p_segment_id;
  if not found then
    raise exception 'Notulensegment % niet gevonden (of geen toegang).', p_segment_id;
  end if;

  delete from public.notulen_segmenten where id = p_segment_id;

  perform public.fn_notulen_segment_audit(
    v_seg.document_id, 'segment_verwijderd', v_seg.titel, null, p_reden, v_seg.bevestigd
  );
end;
$$;


ALTER FUNCTION "public"."fn_notulen_segment_verwijder"("p_segment_id" "uuid", "p_reden" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_organisatie_profielen_touch"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.bijgewerkt_op := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_organisatie_profielen_touch"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_platform_event_hash"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.tijdstip is null then new.tijdstip := now(); end if;

  -- Serialiseer de ketenkop: één globale keten, geen vertakking.
  perform pg_advisory_xact_lock(hashtext('platform_event_log_chain'));

  new.prev_hash := (
    select hash from public.platform_event_log
    order by tijdstip desc, id desc
    limit 1
  );

  new.hash := encode(
    digest(
      coalesce(new.correlatie_id::text,'') || '|' ||
      new.fase                             || '|' ||
      coalesce(new.identity_id::text,'')   || '|' ||
      new.capability                       || '|' ||
      new.handeling                        || '|' ||
      coalesce(new.doel_fonds_id::text,'') || '|' ||
      coalesce(new.doel_object,'')         || '|' ||
      coalesce(new.reden,'')               || '|' ||
      coalesce(new.uitkomst,'')            || '|' ||
      coalesce(new.foutcode,'')            || '|' ||
      coalesce(new.effect::text,'')        || '|' ||
      new.tijdstip::text                   || '|' ||
      coalesce(new.prev_hash,''),
      'sha256'
    ), 'hex'
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_platform_event_hash"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_platform_event_immutable"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  raise exception 'platform_event_log is append-only';
end;
$$;


ALTER FUNCTION "public"."fn_platform_event_immutable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_profiel_bevries_kolommen"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  -- Alleen zelfservice (ingelogde gebruiker wijzigt de eigen rij) wordt
  -- beperkt; service-role en tabel-eigenaar (auth.uid() IS NULL) blijven vrij,
  -- zodat back-officebeheer van rollen mogelijk blijft.
  if auth.uid() is not null and auth.uid() = old.id and (
       new.fonds_id is distinct from old.fonds_id
    or new.rol      is distinct from old.rol
  ) then
    raise exception 'fonds_id en rol zijn niet via zelfservice te wijzigen'
      using errcode = '42501';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_profiel_bevries_kolommen"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_rate_limit_check"("p_endpoint" "text", "p_limiet" integer, "p_venster" interval) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_uid     uuid := auth.uid();
  v_aantal  int;
  v_oudste  timestamptz;
  v_reset   timestamptz;
begin
  -- Alleen geauthenticeerde requests; ongeauthenticeerd hoort hier niet te komen.
  if v_uid is null then
    raise exception 'rate limit check vereist een geauthenticeerde gebruiker'
      using errcode = '28000';
  end if;

  -- Snoei verlopen events van deze gebruiker/endpoint — houdt de tabel klein
  -- en zorgt dat de telling exact het sliding window weerspiegelt.
  delete from public.rate_limit_events
   where gebruiker_id = v_uid
     and endpoint = p_endpoint
     and tijdstip < now() - p_venster;

  -- Tel resterende (= geldige) events binnen het venster.
  select count(*), min(tijdstip)
    into v_aantal, v_oudste
    from public.rate_limit_events
   where gebruiker_id = v_uid
     and endpoint = p_endpoint;

  if v_aantal >= p_limiet then
    -- Geweigerd: geen nieuw event vastleggen. Ruimte komt vrij zodra het
    -- oudste event uit het venster schuift.
    v_reset := coalesce(v_oudste, now()) + p_venster;
    return jsonb_build_object(
      'toegestaan', false,
      'resterend', 0,
      'reset_at', v_reset
    );
  end if;

  -- Toegestaan: leg het event vast en geef het resterende budget terug.
  insert into public.rate_limit_events (gebruiker_id, endpoint)
  values (v_uid, p_endpoint);

  v_reset := coalesce(v_oudste, now()) + p_venster;
  return jsonb_build_object(
    'toegestaan', true,
    'resterend', p_limiet - v_aantal - 1,
    'reset_at', v_reset
  );
end;
$$;


ALTER FUNCTION "public"."fn_rate_limit_check"("p_endpoint" "text", "p_limiet" integer, "p_venster" interval) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_schrijf_semantische_extractie"("p_fonds_id" "uuid", "p_document_id" "uuid", "p_model" "text", "p_prompt_version" "text", "p_extractor_version" "text", "p_catalog_version" "text", "p_status" "text", "p_units" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_run_id uuid;
begin
  if p_status not in ('geslaagd','mislukt') then
    raise exception 'fn_schrijf_semantische_extractie: ongeldige status %', p_status;
  end if;

  insert into public.extraction_run
    (fonds_id, document_id, model, prompt_version, extractor_version,
     catalog_version, status, finished_at)
  values
    (p_fonds_id, p_document_id, p_model, p_prompt_version, p_extractor_version,
     p_catalog_version, p_status, now())
  returning id into v_run_id;

  -- Alleen bij een geslaagde run de units vervangen. Een mislukte run laat de
  -- bestaande (mogelijk goede) units met rust en is puur provenance van de mislukking.
  if p_status = 'geslaagd' then
    delete from public.semantic_units where document_id = p_document_id;

    if p_units is not null and jsonb_typeof(p_units) = 'array' then
      insert into public.semantic_units
        (fonds_id, document_id, chunk_id, concept_id, type, statement, value_raw,
         value_num, value_date, value_text, value_unit, page, section, evidence,
         evidence_verified, confidence_signals, document_status, extraction_run_id)
      select
        p_fonds_id,
        p_document_id,
        nullif(u->>'chunk_id','')::uuid,
        (u->>'concept_id')::uuid,
        u->>'type',
        u->>'statement',
        u->>'value_raw',
        nullif(u->>'value_num','')::numeric,
        nullif(u->>'value_date','')::date,
        nullif(u->>'value_text','')::text,
        nullif(u->>'value_unit','')::text,
        nullif(u->>'page','')::int,
        nullif(u->>'section','')::text,
        u->>'evidence',
        coalesce((u->>'evidence_verified')::boolean, false),
        coalesce(u->'confidence_signals', '{}'::jsonb),
        nullif(u->>'document_status','')::text,
        v_run_id
      from jsonb_array_elements(p_units) as u;
    end if;
  end if;

  return v_run_id;
end $$;


ALTER FUNCTION "public"."fn_schrijf_semantische_extractie"("p_fonds_id" "uuid", "p_document_id" "uuid", "p_model" "text", "p_prompt_version" "text", "p_extractor_version" "text", "p_catalog_version" "text", "p_status" "text", "p_units" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_schrijf_semantische_extractie"("p_fonds_id" "uuid", "p_document_id" "uuid", "p_model" "text", "p_prompt_version" "text", "p_extractor_version" "text", "p_catalog_version" "text", "p_status" "text", "p_units" "jsonb") IS 'T8: atomische schrijf van één extraction_run (append-only) + vervanging van de semantic_units van dit document. SECURITY INVOKER, alleen door service_role aanroepbaar (EXECUTE ontzegd aan public/anon/authenticated).';



CREATE OR REPLACE FUNCTION "public"."fn_schrijf_vergelijking"("p_mode" "text", "p_model" "text", "p_prompt_version" "text", "p_comparator_version" "text", "p_findings" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."fn_schrijf_vergelijking"("p_mode" "text", "p_model" "text", "p_prompt_version" "text", "p_comparator_version" "text", "p_findings" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_schrijf_vergelijking"("p_mode" "text", "p_model" "text", "p_prompt_version" "text", "p_comparator_version" "text", "p_findings" "jsonb") IS 'T5: atomische schrijf van één comparison_run (append-only header) + de bijhorende comparison_results. SECURITY DEFINER; fonds_id server-side uit auth.uid() (niet spoofbaar). Tenant-guard: elk bron-/doel-document moet tot het eigen fonds behoren. Enige schrijfpad voor beide tabellen (authenticated heeft geen INSERT-grant). EXECUTE ontzegd aan public/anon, teruggegeven aan authenticated.';



CREATE OR REPLACE FUNCTION "public"."fn_snapshot_immutable"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  raise exception 'decision_audit_snapshots is append-only';
end;
$$;


ALTER FUNCTION "public"."fn_snapshot_immutable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_zelfde_fonds"("p_gebruiker" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1
    from public.profielen actor
    join public.profielen doel on doel.fonds_id = actor.fonds_id
    where actor.id = auth.uid()
      and doel.id = p_gebruiker
      and actor.fonds_id is not null
  );
$$;


ALTER FUNCTION "public"."fn_zelfde_fonds"("p_gebruiker" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_zelfde_fonds"("p_gebruiker" "uuid") IS 'True als p_gebruiker in hetzelfde fonds zit als auth.uid(). SECURITY DEFINER omdat profielen eigen-rij-only leesbaar is; geeft alleen een boolean terug (geen ledenlijst). Gebruikt door de RLS-policy op notificaties.';



CREATE OR REPLACE FUNCTION "public"."mag_audit"("p_fonds" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1 from public.governance_audit_grants g
     where g.gebruiker_id = auth.uid()
       and g.fonds_id     = p_fonds
       and g.capability   = 'governance_audit_read'
       and now() between coalesce(g.geldig_van, '-infinity'::timestamptz)
                     and coalesce(g.geldig_tot,  'infinity'::timestamptz)
  );
$$;


ALTER FUNCTION "public"."mag_audit"("p_fonds" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mag_audit_bronnen"("p_fonds" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1 from public.governance_audit_grants g
     where g.gebruiker_id = auth.uid()
       and g.fonds_id     = p_fonds
       and g.capability   = 'governance_audit_read_sources'
       and now() between coalesce(g.geldig_van, '-infinity'::timestamptz)
                     and coalesce(g.geldig_tot,  'infinity'::timestamptz)
  );
$$;


ALTER FUNCTION "public"."mag_audit_bronnen"("p_fonds" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."meta_basisniveau"("p_meta" "jsonb") RETURNS "jsonb"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select public.meta_projectie(p_meta, false);
$$;


ALTER FUNCTION "public"."meta_basisniveau"("p_meta" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."meta_bronniveau"("p_meta" "jsonb") RETURNS "jsonb"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select public.meta_projectie(p_meta, true);
$$;


ALTER FUNCTION "public"."meta_bronniveau"("p_meta" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."governance_log" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "gebruiker_id" "uuid",
    "gebruiker_naam" "text",
    "fonds_id" "uuid",
    "modus" "text" DEFAULT 'documenten'::"text",
    "model" "text" DEFAULT 'claude-sonnet-4-5'::"text",
    "aangemaakt" timestamp with time zone DEFAULT "now"(),
    "retrieval_meta" "jsonb",
    "gesprek_audit_id" "uuid",
    "inhoud_hmac" "text",
    "hmac_schema_versie" smallint,
    "hmac_sleutel_versie" smallint,
    CONSTRAINT "governance_log_modus_check" CHECK (("modus" = ANY (ARRAY['documenten'::"text", 'combineren'::"text", 'algemeen'::"text"])))
);


ALTER TABLE "public"."governance_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."governance_log" IS 'Append-only auditspoor van AI-interacties. Draagt GEEN chatinhoud meer: vraag, antwoord en bronnen leven sinds plateau A in public.governance_log_inhoud en zijn daar verwijderbaar. retrieval_meta bevat uitsluitend spoorsleutels (allowlist: core/lib/audit-meta.ts); de leesprojectie meta_basisniveau()/meta_bronniveau() schermt historische rijen af die die splitsing nog niet hadden.';



COMMENT ON COLUMN "public"."governance_log"."retrieval_meta" IS 'RAG-diagnostiek per vraag: {methode, opgehaald, geselecteerd, chunks:[{id,document_id,rang}]}. Insert-only, append-only-discipline blijft.';



COMMENT ON COLUMN "public"."governance_log"."gesprek_audit_id" IS 'Correlatie-ID naar het gesprek waarin deze interactie plaatsvond. BEWUST GEEN foreign key: ON DELETE SET NULL wordt door PostgreSQL als UPDATE uitgevoerd en botst met fn_log_append_only(); ON DELETE CASCADE zou het auditspoor verwijderen. De waarde blijft na verwijdering van het gesprek bestaan en geeft geen toegang tot verwijderde inhoud. Null voor interacties van vóór plateau A — die zijn daardoor niet door de gebruiker te verwijderen.';



COMMENT ON COLUMN "public"."governance_log"."inhoud_hmac" IS 'HMAC-SHA-256 over de canonieke vorm {schema_version, question, answer}, berekend in de applicatielaag (core/lib/audit-hmac.ts) met een geheime serversleutel. Blijft bestaan als de inhoud is verwijderd, zodat een voorgelegde tekst achteraf toetsbaar blijft. Genuanceerde bewijswaarde: hij bevestigt een AANGEBODEN tekst, reconstrueert niets, en bewijst niets tegen wie de sleutel heeft. Null wanneer geen sleutel is geconfigureerd.';



CREATE TABLE IF NOT EXISTS "public"."governance_log_inhoud" (
    "log_id" "uuid" NOT NULL,
    "vraag" "text" NOT NULL,
    "antwoord" "text",
    "bronnen" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "retrieval_meta_inhoud" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."governance_log_inhoud" OWNER TO "postgres";


COMMENT ON TABLE "public"."governance_log_inhoud" IS 'Chatinhoud bij een auditregel. VERWIJDERBAAR — bewust GEEN append-only trigger (dat zou het ontwerp breken). Verwijdering loopt uitsluitend via public.verwijder_gesprek(); er is geen delete-policy. Het spoor zelf blijft in public.governance_log en blijft append-only.';



COMMENT ON COLUMN "public"."governance_log_inhoud"."retrieval_meta_inhoud" IS 'Inhoudsdragende sleutels uit retrieval_meta (zoekvraag, sources, terugval, jargon_expansie, scope.titels, invoer.historie_hash). Classificatie in core/lib/audit-meta.ts; gespiegeld door meta_basisniveau()/meta_bronniveau().';



CREATE OR REPLACE VIEW "public"."vw_governance_audit" WITH ("security_invoker"='false') AS
 SELECT "gl"."id",
    "gl"."gebruiker_id",
    "gl"."gebruiker_naam",
    "gl"."fonds_id",
    "gl"."modus",
    "gl"."model",
    "gl"."aangemaakt",
    "gl"."inhoud_hmac",
    "gl"."hmac_schema_versie",
    "gl"."hmac_sleutel_versie",
    ("gli"."log_id" IS NOT NULL) AS "inhoud_aanwezig",
        CASE
            WHEN (("gl"."gebruiker_id" = "auth"."uid"()) OR "public"."mag_audit_bronnen"("gl"."fonds_id")) THEN "public"."meta_bronniveau"("gl"."retrieval_meta")
            ELSE "public"."meta_basisniveau"("gl"."retrieval_meta")
        END AS "retrieval_meta"
   FROM ("public"."governance_log" "gl"
     LEFT JOIN "public"."governance_log_inhoud" "gli" ON (("gli"."log_id" = "gl"."id")))
  WHERE (("gl"."gebruiker_id" = "auth"."uid"()) OR "public"."mag_audit"("gl"."fonds_id"));


ALTER VIEW "public"."vw_governance_audit" OWNER TO "postgres";


COMMENT ON VIEW "public"."vw_governance_audit" IS 'Auditweergave van governance_log met metadata-projectie op twee niveaus. Definer-semantiek: de WHERE reproduceert de autorisatie volledig (zelfde constructie en zelfde risico als vw_fondsleden, besluit 0102). Bevat bewust GEEN gesprek_audit_id en geen vraag/antwoord/bronnen.';



CREATE OR REPLACE FUNCTION "public"."lees_governance_audit"("p_fonds" "uuid", "p_filters" "jsonb" DEFAULT '{}'::"jsonb", "p_motivering" "text" DEFAULT NULL::"text", "p_limiet" integer DEFAULT 50, "p_bronniveau" boolean DEFAULT false) RETURNS SETOF "public"."vw_governance_audit"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_bron   boolean;
  v_limiet int := least(greatest(coalesce(p_limiet, 50), 1), 500);
begin
  if auth.uid() is null then
    raise exception 'niet_geauthenticeerd' using errcode = '28000';
  end if;

  -- Zonder auditcapability: alleen de eigen regels, en géén inzageregel — je
  -- eigen spoor inzien is geen inzage in dat van een ander.
  if not public.mag_audit(p_fonds) then
    return query
      select * from public.vw_governance_audit v
       where v.gebruiker_id = auth.uid()
         and v.fonds_id = p_fonds
       order by v.aangemaakt desc
       limit v_limiet;
    return;
  end if;

  v_bron := coalesce(p_bronniveau, false) and public.mag_audit_bronnen(p_fonds);

  if v_bron and (p_motivering is null or length(btrim(p_motivering)) = 0) then
    raise exception 'motivering_verplicht_bij_bronniveau' using errcode = '22023';
  end if;

  insert into public.governance_audit_inzage
    (gebruiker_id, fonds_id, scope, bronniveau, motivering)
  values
    (auth.uid(), p_fonds, coalesce(p_filters, '{}'::jsonb), v_bron,
     case when v_bron then p_motivering else null end);

  return query
    select v.id, v.gebruiker_id, v.gebruiker_naam, v.fonds_id, v.modus, v.model,
           v.aangemaakt, v.inhoud_hmac, v.hmac_schema_versie, v.hmac_sleutel_versie,
           v.inhoud_aanwezig,
           -- Eigen regels houden hun volledige projectie; die van een ander
           -- zakken terug naar basisniveau tenzij bronniveau is gevraagd én
           -- toegekend.
           case
             when v_bron or v.gebruiker_id = auth.uid() then v.retrieval_meta
             else public.meta_basisniveau(v.retrieval_meta)
           end
      from public.vw_governance_audit v
     where v.fonds_id = p_fonds
     order by v.aangemaakt desc
     limit v_limiet;
end;
$$;


ALTER FUNCTION "public"."lees_governance_audit"("p_fonds" "uuid", "p_filters" "jsonb", "p_motivering" "text", "p_limiet" integer, "p_bronniveau" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_word_export"("p_gesprek_audit_id" "uuid" DEFAULT NULL::"uuid", "p_stuksoort" "text" DEFAULT NULL::"text", "p_promptvariant" "text" DEFAULT NULL::"text", "p_bronnen" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_fonds uuid;
  v_naam  text;
  v_rol   text;
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'niet_geauthenticeerd' using errcode = '28000';
  end if;

  select p.fonds_id, coalesce(p.naam, u.email), p.rol
    into v_fonds, v_naam, v_rol
    from public.profielen p
    join auth.users u on u.id = p.id
   where p.id = v_uid;

  if v_fonds is null then
    raise exception 'geen_fonds_voor_gebruiker' using errcode = 'P0002';
  end if;

  -- Backstop: spiegelt ROL_CAPABILITIES (ai.stukvoorbereiding → bestuursbureau).
  if v_rol is distinct from 'bestuursbureau' then
    raise exception 'geen_stukvoorbereiding' using errcode = '42501';
  end if;

  insert into public.governance_export_log (
    gebruiker_id, gebruiker_naam, fonds_id, gesprek_audit_id,
    taak, stuksoort, promptvariant, bronnen
  ) values (
    v_uid, v_naam, v_fonds, p_gesprek_audit_id,
    'stukvoorbereiding', p_stuksoort, p_promptvariant,
    coalesce(p_bronnen, '[]'::jsonb)
  ) returning id into v_id;

  return v_id;
end;
$$;


ALTER FUNCTION "public"."log_word_export"("p_gesprek_audit_id" "uuid", "p_stuksoort" "text", "p_promptvariant" "text", "p_bronnen" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."maak_profiel"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_fonds_tekst text;
  v_fonds_id    uuid;
begin
  -- 3b-guard (2026-06-23b, ongewijzigd): platform-back-office-accounts krijgen
  -- bewust GEEN tenant-profiel. Markeer zo'n account met {"platform": true}.
  if coalesce(new.raw_user_meta_data->>'platform', '') = 'true' then
    return new;
  end if;

  -- R1: het fonds komt uitsluitend uit de user-metadata. Geen limit 1/default.
  v_fonds_tekst := new.raw_user_meta_data->>'fonds_id';

  -- Fail-closed #1 — geen fonds meegegeven.
  if v_fonds_tekst is null or btrim(v_fonds_tekst) = '' then
    raise exception
      'maak_profiel: geen fonds_id in user-metadata. Een tenant-account vereist een expliciet fonds (raw_user_meta_data.fonds_id); er is bewust geen default/eerste-fonds. Zie decisions/0044.'
      using errcode = 'check_violation';
  end if;

  -- Fail-closed #2 — geen geldige UUID (duidelijke boodschap i.p.v. de kale
  -- cast-fout "invalid input syntax for type uuid").
  begin
    v_fonds_id := v_fonds_tekst::uuid;
  exception
    when others then
      raise exception
        'maak_profiel: fonds_id in user-metadata (%) is geen geldige UUID.', v_fonds_tekst
        using errcode = 'check_violation';
  end;

  -- Fail-closed #3 — geldige UUID, maar het fonds bestaat niet.
  if not exists (select 1 from public.fondsen f where f.id = v_fonds_id) then
    raise exception
      'maak_profiel: fonds_id % bestaat niet in public.fondsen.', v_fonds_id
      using errcode = 'foreign_key_violation';
  end if;

  -- Deterministisch profiel op het expliciet meegegeven fonds.
  insert into public.profielen (id, naam, fonds_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'naam', new.email),
    v_fonds_id
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."maak_profiel"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mag_audit_redacties"("p_fonds" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1 from public.governance_audit_grants g
     where g.gebruiker_id = auth.uid()
       and g.fonds_id     = p_fonds
       and g.capability   = 'governance_redacties_read'
       and now() between coalesce(g.geldig_van, '-infinity'::timestamptz)
                     and coalesce(g.geldig_tot,  'infinity'::timestamptz)
  );
$$;


ALTER FUNCTION "public"."mag_audit_redacties"("p_fonds" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."meta_projectie"("p_meta" "jsonb", "p_bron" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  -- Operationele telemetrie: geen inhoud, geen bronidentiteit.
  -- T3: 'selectie' toegevoegd (intent/regime/constraints + geselecteerd- en
  -- afgevallen-tellingen — pure telemetrie, geen document-identiteit).
  c_basis constant text[] := array[
    'methode','opgehaald','geselecteerd','embedding_query_success','fallback_reason',
    'rerank','drempel','zwakke_bronbasis','parent',
    'toegepaste_fonds_filter','namespace_conventie','fondsdiscipline_gedropt',
    'body_fonds_id_genegeerd',
    'antwoordmodus','transformatie','bronbasis','inline_meldingen','citaties',
    'source_summary',
    'bron_intent','bron_vertrouwen','bron_modus_auto','alleen_fondsdocumenten',
    'bron_intent_override','bron_intent_bron','bron_intent_herkomst',
    'portaalstand_gebruikt',
    'profielsturing','profielsturing_aspecten','organisatieprofiel',
    'organisatieprofiel_aspecten',
    'startvraag_bron','niet_vastgesteld','verduidelijking','geen_modelcall',
    'context_geneutraliseerd','gereformuleerd',
    'duur_ms','duur_model_ms','tokens','tokendekking',
    'selectie',
    'scope','invoer','filters','web','markeringen'
  ];
  -- BronIDENTITEIT (welk document, welke versie) — geen letterlijke tekst.
  -- T2: 'bureau' toegevoegd. T3: 'selectie_kandidaten' toegevoegd (per kandidaat
  -- document_id + bibliotheek + rang + status/reden — bronidentiteit, geen tekst).
  c_bron constant text[] := array[
    'chunks','bronversie_audit','besluitbronnen','mogelijk_gerelateerd',
    'doorgrond','bureau','herkomst',
    'selectie_kandidaten'
  ];
  v_toegestaan text[];
  v_uit jsonb;
  v_deel jsonb;
begin
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' then
    return '{}'::jsonb;
  end if;

  v_toegestaan := case when p_bron then c_basis || c_bron else c_basis end;

  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    into v_uit
    from jsonb_each(p_meta) e
   where e.key = any(v_toegestaan);

  -- Gemengde objecten: subsleutels van een hoger niveau alsnog verwijderen.
  -- Spiegel van SUB_NIVEAUS in core/lib/audit-meta.ts. T3 voegt géén gemengd
  -- object toe: 'selectie' is volledig basis en 'selectie_kandidaten' is een
  -- schone top-level bron-sleutel — geen extra strip-stap nodig.
  if v_uit ? 'scope' and jsonb_typeof(v_uit->'scope') = 'object' then
    v_deel := (v_uit->'scope') - 'titels';            -- titels = documenttitels
    if not p_bron then v_deel := v_deel - 'document_ids'; end if;
    v_uit := jsonb_set(v_uit, '{scope}', v_deel);
  end if;

  if v_uit ? 'invoer' and jsonb_typeof(v_uit->'invoer') = 'object' then
    v_uit := jsonb_set(v_uit, '{invoer}', (v_uit->'invoer') - 'historie_hash');
  end if;

  if v_uit ? 'filters' and jsonb_typeof(v_uit->'filters') = 'object' then
    v_deel := v_uit->'filters';
    if not p_bron then v_deel := v_deel - 'procesinstantie_ids'; end if;
    v_uit := jsonb_set(v_uit, '{filters}', v_deel);
  end if;

  if v_uit ? 'web' and jsonb_typeof(v_uit->'web') = 'object' then
    v_deel := v_uit->'web';
    if not p_bron then
      v_deel := v_deel - 'gebruikte_bronnen' - 'bevraagde_domeinen';
    end if;
    v_uit := jsonb_set(v_uit, '{web}', v_deel);
  end if;

  if v_uit ? 'markeringen' and jsonb_typeof(v_uit->'markeringen') = 'object' then
    v_deel := v_uit->'markeringen';
    if not p_bron then v_deel := v_deel - 'instanties'; end if;
    v_uit := jsonb_set(v_uit, '{markeringen}', v_deel);
  end if;

  return v_uit;
end;
$$;


ALTER FUNCTION "public"."meta_projectie"("p_meta" "jsonb", "p_bron" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."profiel_opslaan"("p_naam" "text", "p_bestuurlijke_rol" "text", "p_primaire_expertise_id" "uuid", "p_antwoordvoorkeur" "text", "p_standaard_ai_modus" "text", "p_detailniveau" "text", "p_secundaire_expertise_ids" "uuid"[], "p_gremium_ids" "uuid"[], "p_focusgebied_ids" "uuid"[], "p_reflectie_uitnodiging" boolean DEFAULT NULL::boolean) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid      uuid := auth.uid();
  v_fonds_id uuid;
begin
  if v_uid is null then
    raise exception 'NIET_INGELOGD';
  end if;

  -- RLS laat alleen de eigen profielrij lezen; fonds_id stuurt de composite-FK's.
  select fonds_id into v_fonds_id from public.profielen where id = v_uid;
  if v_fonds_id is null then
    raise exception 'GEEN_FONDS';
  end if;

  -- (1) Profielvelden. RLS dwingt id = auth.uid() af; de composite-FK weigert een
  --     primaire expertise van een ander fonds of een globale template. De naam
  --     valt bij leeg/whitespace terug op de bestaande naam (nooit leeg maken).
  update public.profielen set
    naam                  = coalesce(nullif(trim(p_naam), ''), naam),
    bestuurlijke_rol      = p_bestuurlijke_rol,
    primaire_expertise_id = p_primaire_expertise_id,
    antwoordvoorkeur      = p_antwoordvoorkeur,
    standaard_ai_modus    = p_standaard_ai_modus,
    detailniveau          = p_detailniveau,
    reflectie_uitnodiging = coalesce(p_reflectie_uitnodiging, reflectie_uitnodiging)
  where id = v_uid;

  -- (2) Koppeling-sets vervangen (delete + insert in dezelfde transactie).
  delete from public.profiel_expertises    where profiel_id = v_uid;
  delete from public.profiel_gremia         where profiel_id = v_uid;
  delete from public.profiel_focusgebieden  where profiel_id = v_uid;

  if coalesce(array_length(p_secundaire_expertise_ids, 1), 0) > 0 then
    insert into public.profiel_expertises (fonds_id, profiel_id, expertise_id)
    select v_fonds_id, v_uid, x from unnest(p_secundaire_expertise_ids) as x;
  end if;
  if coalesce(array_length(p_gremium_ids, 1), 0) > 0 then
    insert into public.profiel_gremia (fonds_id, profiel_id, gremium_id)
    select v_fonds_id, v_uid, x from unnest(p_gremium_ids) as x;
  end if;
  if coalesce(array_length(p_focusgebied_ids, 1), 0) > 0 then
    insert into public.profiel_focusgebieden (fonds_id, profiel_id, focusgebied_id)
    select v_fonds_id, v_uid, x from unnest(p_focusgebied_ids) as x;
  end if;

  -- (3) Append-only audit — in dezelfde transactie. Faalt deze insert, dan rolt
  --     ook (1)+(2) terug: een wijziging zonder auditregel is onmogelijk.
  --     Payload = metadata + gekozen ids (reconstrueerbaar); de naam-wijziging
  --     leggen we vast als boolean + de feitelijk gezette naam.
  --
  --     `reflectie_uitnodiging` staat hier bij naam, net als de andere
  --     voorkeuren. Zie de header voor de afweging tegenover besluit 0112.
  --     NULL (ongewijzigd) landt als NULL in de payload en is dus te
  --     onderscheiden van een expliciete false.
  insert into public.profiel_log (fonds_id, profiel_id, event_type, actor_id, payload)
  values (
    v_fonds_id, v_uid, 'profiel_gewijzigd', v_uid,
    jsonb_build_object(
      'velden', jsonb_build_object(
        'naam',              nullif(trim(p_naam), '') is not null,
        'bestuurlijke_rol',  p_bestuurlijke_rol is not null,
        'primaire_expertise', p_primaire_expertise_id is not null,
        'antwoordvoorkeur',  p_antwoordvoorkeur,
        'standaard_ai_modus', p_standaard_ai_modus,
        'detailniveau',      p_detailniveau,
        'reflectie_uitnodiging', p_reflectie_uitnodiging
      ),
      'naam', nullif(trim(p_naam), ''),
      'aantallen', jsonb_build_object(
        'secundaire_expertises', coalesce(array_length(p_secundaire_expertise_ids, 1), 0),
        'gremia',                coalesce(array_length(p_gremium_ids, 1), 0),
        'focusgebieden',         coalesce(array_length(p_focusgebied_ids, 1), 0)
      ),
      'ids', jsonb_build_object(
        'primaire_expertise',    p_primaire_expertise_id,
        'secundaire_expertises', to_jsonb(coalesce(p_secundaire_expertise_ids, array[]::uuid[])),
        'gremia',                to_jsonb(coalesce(p_gremium_ids, array[]::uuid[])),
        'focusgebieden',         to_jsonb(coalesce(p_focusgebied_ids, array[]::uuid[]))
      )
    )
  );
end;
$$;


ALTER FUNCTION "public"."profiel_opslaan"("p_naam" "text", "p_bestuurlijke_rol" "text", "p_primaire_expertise_id" "uuid", "p_antwoordvoorkeur" "text", "p_standaard_ai_modus" "text", "p_detailniveau" "text", "p_secundaire_expertise_ids" "uuid"[], "p_gremium_ids" "uuid"[], "p_focusgebied_ids" "uuid"[], "p_reflectie_uitnodiging" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reflectie_bronset_hash"("p_retrieval_meta" "jsonb") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  with paren as (
    select distinct (c->>'document_id') || ':' || (c->>'id') as paar
      from jsonb_array_elements(
             case
               when jsonb_typeof(coalesce(p_retrieval_meta->'chunks', 'null'::jsonb)) = 'array'
               then p_retrieval_meta->'chunks'
               else '[]'::jsonb
             end
           ) as c
     where nullif(c->>'id', '') is not null
       and nullif(c->>'document_id', '') is not null
  ),
  scope as (
    select distinct s as doc_id
      from jsonb_array_elements_text(
             case
               when jsonb_typeof(coalesce(p_retrieval_meta#>'{scope,document_ids}', 'null'::jsonb)) = 'array'
               then p_retrieval_meta#>'{scope,document_ids}'
               else '[]'::jsonb
             end
           ) as s
     where nullif(s, '') is not null
  )
  select case
           when (select count(*) from paren) = 0 then null
           else encode(
                  digest(
                    coalesce((select string_agg(paar, '|' order by paar collate "C") from paren), '')
                    || '#' ||
                    coalesce((select string_agg(doc_id, ',' order by doc_id collate "C") from scope), ''),
                    'sha256'
                  ),
                  'hex'
                )
         end;
$$;


ALTER FUNCTION "public"."reflectie_bronset_hash"("p_retrieval_meta" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reflectie_bronset_hash"("p_retrieval_meta" "jsonb") IS 'Versiehash over de bevroren reflectiebronset. Gesorteerd en ontdubbeld, dus ongevoelig voor de rangorde waarin de retrieval de chunks teruggaf. NULL bij nul bruikbare chunks. Exact gespiegeld in core/lib/bronset.ts en vastgepind in core/lib/bronset.sanity.ts — wijkt een van beide af, dan is dat een bug.';



CREATE TABLE IF NOT EXISTS "public"."gesprek_reflectie_state" (
    "gesprek_id" "uuid" NOT NULL,
    "gebruiker_id" "uuid" NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'niet_actief'::"text" NOT NULL,
    "ingang" "text",
    "beurt" smallint DEFAULT 0 NOT NULL,
    "bronset_log_id" "uuid",
    "reflectie_bronset_versie" "text",
    "gestart_op" timestamp with time zone,
    "bijgewerkt_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "gesprek_reflectie_state_beurt_check" CHECK ((("beurt" >= 0) AND ("beurt" <= 3))),
    CONSTRAINT "gesprek_reflectie_state_ingang_check" CHECK ((("ingang" IS NULL) OR ("ingang" = ANY (ARRAY['mis_iets'::"text", 'twijfel'::"text", 'risico'::"text", 'overtuigt'::"text"])))),
    CONSTRAINT "gesprek_reflectie_state_status_check" CHECK (("status" = ANY (ARRAY['niet_actief'::"text", 'ingang_gekozen'::"text", 'verdieping_1'::"text", 'verdieping_2'::"text", 'verdieping_3'::"text", 'conceptweergave'::"text", 'afgerond'::"text"])))
);


ALTER TABLE "public"."gesprek_reflectie_state" OWNER TO "postgres";


COMMENT ON TABLE "public"."gesprek_reflectie_state" IS 'Server-controlled status van de reflectiedialoog (plateau B, besluit 0110). AUTEUR-ONLY leesbaar; muteren uitsluitend via public.reflectie_transitie(). Verdwijnt met het gesprek (cascade). Staat in geen enkele fondsbreed leesbare projectie — besluit 0112 verbiedt elke reflectiemarkering.';



COMMENT ON COLUMN "public"."gesprek_reflectie_state"."reflectie_bronset_versie" IS 'sha256 over de gesorteerde, ontdubbelde lijst <document_id>:<chunk_id> uit governance_log.retrieval_meta.chunks, plus "#" en de gesorteerde scope.document_ids. NULL = geen bronset; de assistent reflecteert dan uitsluitend op het antwoord en de woorden van de gebruiker (FR-55). Verlaat de privéchat nooit (FR-69) en is iets anders dan publicatie_bronset_versie uit plateau C. Spiegel: core/lib/bronset.ts.';



CREATE OR REPLACE FUNCTION "public"."reflectie_transitie"("p_gesprek_id" "uuid", "p_actie" "text", "p_ingang" "text" DEFAULT NULL::"text", "p_bronset_log_id" "uuid" DEFAULT NULL::"uuid") RETURNS "public"."gesprek_reflectie_state"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_uid          uuid := auth.uid();
  v_eigenaar     uuid;
  v_fonds        uuid;
  v_status       text;
  v_beurt        smallint;
  v_bijgewerkt   timestamptz;
  v_nieuw_status text;
  v_nieuwe_beurt smallint;
  v_meta         jsonb;
  v_versie       text;
  v_bestaat      boolean;
  v_rij          public.gesprek_reflectie_state;
begin
  if v_uid is null then
    raise exception 'niet_geauthenticeerd' using errcode = '28000';
  end if;

  -- B-opt tranche 2d: `verdiepen` toegevoegd aan de allowlist (naast
  -- `herformuleren` uit tranche 1a).
  if p_actie is null or p_actie not in
     ('start','antwoord','concept','afronden','afbreken','herformuleren','verdiepen') then
    raise exception 'ongeldige_actie' using errcode = '22023';
  end if;

  select g.gebruiker_id, g.fonds_id into v_eigenaar, v_fonds
    from public.gesprekken g
   where g.id = p_gesprek_id
   for update;

  if not found then
    raise exception 'gesprek_niet_gevonden' using errcode = 'P0002';
  end if;
  if v_eigenaar is distinct from v_uid then
    raise exception 'geen_eigenaar' using errcode = '42501';
  end if;

  select s.status, s.beurt, s.bijgewerkt_op
    into v_status, v_beurt, v_bijgewerkt
    from public.gesprek_reflectie_state s
   where s.gesprek_id = p_gesprek_id
   for update;

  v_bestaat := found;
  if not v_bestaat then
    v_status     := 'niet_actief';
    v_beurt      := 0;
    v_bijgewerkt := now();
  end if;

  if p_actie = 'afbreken' and not v_bestaat then
    v_rij.gesprek_id    := p_gesprek_id;
    v_rij.gebruiker_id  := v_uid;
    v_rij.fonds_id      := v_fonds;
    v_rij.status        := 'niet_actief';
    v_rij.beurt         := 0;
    v_rij.bijgewerkt_op := now();
    return v_rij;
  end if;

  if v_status <> 'niet_actief' and v_bijgewerkt < now() - interval '24 hours' then
    v_status := 'niet_actief';
    v_beurt  := 0;
  end if;

  v_nieuwe_beurt := v_beurt;

  if p_actie = 'afbreken' then
    v_nieuw_status := 'niet_actief';
    v_nieuwe_beurt := 0;

  elsif p_actie = 'start' then
    if v_status <> 'niet_actief' then
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    -- B-opt tranche 2a: de vier nieuwe ingangwaarden.
    if p_ingang is null or p_ingang not in ('mis_iets','twijfel','risico','overtuigt') then
      raise exception 'ongeldige_ingang' using errcode = '22023';
    end if;
    v_nieuw_status := 'ingang_gekozen';
    v_nieuwe_beurt := 0;

  elsif p_actie = 'antwoord' then
    -- Beurtplafond leidend (zie de correctie op TO §6.1 uit B1): het derde
    -- antwoord landt in verdieping_3, een vierde bestaat niet.
    if v_status not in ('ingang_gekozen','verdieping_1','verdieping_2') then
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    v_nieuwe_beurt := (v_beurt + 1)::smallint;
    if v_nieuwe_beurt > 3 then
      raise exception 'beurtplafond_bereikt' using errcode = '22023';
    end if;
    if v_status = 'ingang_gekozen' then
      v_nieuw_status := 'verdieping_1';
    elsif v_status = 'verdieping_1' then
      v_nieuw_status := 'verdieping_2';
    else
      v_nieuw_status := 'verdieping_3';
    end if;

  elsif p_actie = 'concept' then
    -- De chatroute roept dit ná ELK reflectieantwoord aan (tranche 2c), niet
    -- meer alleen bij het bereikte plafond. Verhoogt de beurt niet.
    if v_status not in ('verdieping_1','verdieping_2','verdieping_3') then
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    v_nieuw_status := 'conceptweergave';

  elsif p_actie = 'herformuleren' then
    -- B-opt tranche 1a: eigen overweging aanscherpen; blijft conceptweergave,
    -- beurt/ingang/bronset ongemoeid.
    if v_status <> 'conceptweergave' then
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    v_nieuw_status := 'conceptweergave';

  elsif p_actie = 'verdiepen' then
    -- ── B-opt tranche 2d ──────────────────────────────────────────────────
    -- "Nog een stap verdiepen": vanuit de conceptweergave terug naar de
    -- verdiepingsstatus die bij de HUIDIGE beurt hoort (verdieping_1 bij beurt 1,
    -- verdieping_2 bij beurt 2), zodat het volgende `antwoord` doortelt naar
    -- verdieping_2 resp. verdieping_3. De beurt verandert NIET; ingang en bronset
    -- blijven behouden (p_actie <> 'start'). Bij beurt >= 3 is het plafond bereikt
    -- en wordt geweigerd — het beurtplafond blijft een hard vangnet.
    if v_status <> 'conceptweergave' then
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    if v_beurt >= 3 then
      raise exception 'beurtplafond_bereikt' using errcode = '22023';
    end if;
    if v_beurt < 1 then
      -- Conceptweergave impliceert minstens één gegeven antwoord; defensief.
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    v_nieuw_status := 'verdieping_' || v_beurt::text;

  elsif p_actie = 'afronden' then
    if v_status <> 'conceptweergave' then
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    v_nieuw_status := 'afgerond';
  end if;

  if p_actie = 'start' and p_bronset_log_id is not null then
    select gl.retrieval_meta into v_meta
      from public.governance_log gl
     where gl.id               = p_bronset_log_id
       and gl.gebruiker_id     = v_uid
       and gl.gesprek_audit_id = p_gesprek_id;

    if not found then
      raise exception 'bronset_niet_van_dit_gesprek' using errcode = '42501';
    end if;

    v_versie := public.reflectie_bronset_hash(coalesce(v_meta, '{}'::jsonb));
  end if;

  insert into public.gesprek_reflectie_state as s
    (gesprek_id, gebruiker_id, fonds_id, status, ingang, beurt,
     bronset_log_id, reflectie_bronset_versie, gestart_op, bijgewerkt_op)
  values
    (p_gesprek_id, v_uid, v_fonds, v_nieuw_status,
     case when p_actie = 'start' then p_ingang else null end,
     v_nieuwe_beurt,
     case when p_actie = 'start' then p_bronset_log_id else null end,
     case when p_actie = 'start' then v_versie else null end,
     case when p_actie = 'start' then now() else null end,
     now())
  on conflict (gesprek_id) do update
     set status                   = excluded.status,
         beurt                    = excluded.beurt,
         bijgewerkt_op            = now(),
         -- Ingang en bronset worden UITSLUITEND bij `start` gezet en bij
         -- `afbreken` gewist. Vervolgacties (antwoord/concept/herformuleren/
         -- verdiepen) laten ze onaangeroerd — dat houdt de bevriezing intact.
         ingang                   = case
                                      when excluded.status = 'niet_actief' then null
                                      when p_actie = 'start' then excluded.ingang
                                      else s.ingang
                                    end,
         bronset_log_id           = case
                                      when excluded.status = 'niet_actief' then null
                                      when p_actie = 'start' then excluded.bronset_log_id
                                      else s.bronset_log_id
                                    end,
         reflectie_bronset_versie = case
                                      when excluded.status = 'niet_actief' then null
                                      when p_actie = 'start' then excluded.reflectie_bronset_versie
                                      else s.reflectie_bronset_versie
                                    end,
         gestart_op               = case
                                      when excluded.status = 'niet_actief' then null
                                      when p_actie = 'start' then excluded.gestart_op
                                      else s.gestart_op
                                    end
  returning * into v_rij;

  return v_rij;
end;
$$;


ALTER FUNCTION "public"."reflectie_transitie"("p_gesprek_id" "uuid", "p_actie" "text", "p_ingang" "text", "p_bronset_log_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reflectie_transitie"("p_gesprek_id" "uuid", "p_actie" "text", "p_ingang" "text", "p_bronset_log_id" "uuid") IS 'DE ENIGE schrijfweg naar gesprek_reflectie_state (besluit 0110, AC-18). Valideert de gevraagde ACTIE tegen de opnieuw uitgelezen actuele status (FR-67). B-opt tranche 2: vier ingangwaarden (mis_iets/twijfel/risico/overtuigt) bij `start`; nieuwe actie `verdiepen` (conceptweergave → verdieping_{beurt}, geweigerd bij beurt >= 3). `herformuleren` (tranche 1a) blijft. Beurtteller alleen omhoog; bronset alleen bij `start`; fail-safe 24u.';



CREATE OR REPLACE FUNCTION "public"."resolve_tenant_host"("p_host" "text") RETURNS TABLE("host" "text", "fonds_id" "uuid", "actief" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select td.host, td.fonds_id, td.actief
  from public.tenant_domains td
  where td.actief = true
    and td.host = p_host
  limit 1;
$$;


ALTER FUNCTION "public"."resolve_tenant_host"("p_host" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."resolve_tenant_host"("p_host" "text") IS 'D1: host->fonds-resolutie voor de gedeelde surface met de anon-key. SECURITY DEFINER (tenant_domains blijft deny-by-default). Geeft 0/1 actieve rij; caller levert een genormaliseerde host.';



CREATE OR REPLACE FUNCTION "public"."schrijf_ai_interactie"("p_vraag" "text", "p_antwoord" "text" DEFAULT NULL::"text", "p_bronnen" "jsonb" DEFAULT '[]'::"jsonb", "p_modus" "text" DEFAULT 'documenten'::"text", "p_model" "text" DEFAULT NULL::"text", "p_retrieval_meta" "jsonb" DEFAULT '{}'::"jsonb", "p_retrieval_meta_inhoud" "jsonb" DEFAULT '{}'::"jsonb", "p_gesprek_audit_id" "uuid" DEFAULT NULL::"uuid", "p_inhoud_hmac" "text" DEFAULT NULL::"text", "p_hmac_schema_versie" smallint DEFAULT NULL::smallint, "p_hmac_sleutel_versie" smallint DEFAULT NULL::smallint) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_fonds uuid;
  v_naam  text;
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'niet_geauthenticeerd' using errcode = '28000';
  end if;
  if p_vraag is null or length(btrim(p_vraag)) = 0 then
    raise exception 'vraag_leeg' using errcode = '22023';
  end if;

  select p.fonds_id, coalesce(p.naam, u.email)
    into v_fonds, v_naam
    from public.profielen p
    join auth.users u on u.id = p.id
   where p.id = v_uid;

  if v_fonds is null then
    raise exception 'geen_fonds_voor_gebruiker' using errcode = 'P0002';
  end if;

  insert into public.governance_log (
    gebruiker_id, gebruiker_naam, fonds_id, modus, model, retrieval_meta,
    gesprek_audit_id, inhoud_hmac, hmac_schema_versie, hmac_sleutel_versie
  ) values (
    v_uid, v_naam, v_fonds, p_modus, p_model, coalesce(p_retrieval_meta, '{}'::jsonb),
    p_gesprek_audit_id, p_inhoud_hmac, p_hmac_schema_versie, p_hmac_sleutel_versie
  ) returning id into v_id;

  insert into public.governance_log_inhoud (
    log_id, vraag, antwoord, bronnen, retrieval_meta_inhoud
  ) values (
    v_id, p_vraag, p_antwoord, coalesce(p_bronnen, '[]'::jsonb),
    coalesce(p_retrieval_meta_inhoud, '{}'::jsonb)
  );

  return v_id;
end;
$$;


ALTER FUNCTION "public"."schrijf_ai_interactie"("p_vraag" "text", "p_antwoord" "text", "p_bronnen" "jsonb", "p_modus" "text", "p_model" "text", "p_retrieval_meta" "jsonb", "p_retrieval_meta_inhoud" "jsonb", "p_gesprek_audit_id" "uuid", "p_inhoud_hmac" "text", "p_hmac_schema_versie" smallint, "p_hmac_sleutel_versie" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."stuurinfo_balans_opslaan"("p_periode" "text", "p_peildatum" "date", "p_bron" "text", "p_invoer_bron" "text", "p_activa" "jsonb", "p_passiva" "jsonb", "p_reserves" "jsonb", "p_financieringsgraad" numeric) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."stuurinfo_balans_opslaan"("p_periode" "text", "p_peildatum" "date", "p_bron" "text", "p_invoer_bron" "text", "p_activa" "jsonb", "p_passiva" "jsonb", "p_reserves" "jsonb", "p_financieringsgraad" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."stuurinfo_operationeel_opslaan"("p_periode" "text", "p_invoer_bron" "text", "p_mutaties" "jsonb", "p_norm" numeric, "p_band_onder" numeric, "p_band_boven" numeric, "p_kosten_realisatie" "jsonb", "p_kosten_begroot" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."stuurinfo_operationeel_opslaan"("p_periode" "text", "p_invoer_bron" "text", "p_mutaties" "jsonb", "p_norm" numeric, "p_band_onder" numeric, "p_band_boven" numeric, "p_kosten_realisatie" "jsonb", "p_kosten_begroot" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."stuurinfo_premie_opslaan"("p_periode" "text", "p_invoer_bron" "text", "p_componenten_eur" "jsonb", "p_componenten_pct" "jsonb", "p_comp_mutaties" "jsonb", "p_toekenning" numeric, "p_startomvang" numeric, "p_ondergrens_pct" numeric) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."stuurinfo_premie_opslaan"("p_periode" "text", "p_invoer_bron" "text", "p_componenten_eur" "jsonb", "p_componenten_pct" "jsonb", "p_comp_mutaties" "jsonb", "p_toekenning" numeric, "p_startomvang" numeric, "p_ondergrens_pct" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."stuurinfo_soli_opslaan"("p_periode" "text", "p_invoer_bron" "text", "p_vulling" "jsonb", "p_uitdeling" numeric, "p_ondergrens" numeric, "p_bovengrens" numeric) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."stuurinfo_soli_opslaan"("p_periode" "text", "p_invoer_bron" "text", "p_vulling" "jsonb", "p_uitdeling" numeric, "p_ondergrens" numeric, "p_bovengrens" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verwijder_gesprek"("p_gesprek_id" "uuid", "p_request_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_uid      uuid := auth.uid();
  v_eigenaar uuid;
  v_fonds    uuid;
  v_aantal   int  := 0;
  v_bestaand jsonb;
begin
  if v_uid is null then
    raise exception 'niet_geauthenticeerd' using errcode = '28000';
  end if;
  if p_gesprek_id is null or p_request_id is null then
    raise exception 'ongeldige_parameters' using errcode = '22023';
  end if;

  -- Serialiseer op request_id: twee gelijktijdige aanroepen met hetzelfde id
  -- leveren één redactieregel (AC-8). De unieke constraint is het vangnet, deze
  -- lock voorkomt dat de tweede aanroep überhaupt werk doet.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  select jsonb_build_object('status', 'reeds_uitgevoerd', 'aantal_regels', r.aantal_regels)
    into v_bestaand
    from public.governance_redacties r
   where r.request_id = p_request_id;
  if v_bestaand is not null then
    return v_bestaand;                            -- idempotent
  end if;

  select g.gebruiker_id, g.fonds_id
    into v_eigenaar, v_fonds
    from public.gesprekken g
   where g.id = p_gesprek_id
     for update;                                  -- row lock

  if not found then
    raise exception 'gesprek_niet_gevonden' using errcode = 'P0002';
  end if;
  -- Eigenaarschap uit de RIJ, niet uit de request.
  if v_eigenaar is distinct from v_uid then
    raise exception 'geen_eigenaar' using errcode = '42501';
  end if;

  with te_verwijderen as (
    select gl.id
      from public.governance_log gl
     where gl.gesprek_audit_id = p_gesprek_id
       and gl.gebruiker_id     = v_uid
  )
  delete from public.governance_log_inhoud gli
   using te_verwijderen t
   where gli.log_id = t.id;
  get diagnostics v_aantal = row_count;

  -- Cascade ruimt alles op wat aan het gesprek hangt.
  delete from public.gesprekken where id = p_gesprek_id;

  insert into public.governance_redacties
    (fonds_id, uitgevoerd_door, request_id, aanleiding, aantal_regels, scope)
  values
    (v_fonds, v_uid, p_request_id, 'gesprek_verwijderd', v_aantal,
     jsonb_build_object('gesprek_audit_id', p_gesprek_id));

  return jsonb_build_object('status', 'verwijderd', 'aantal_regels', v_aantal);
end;
$$;


ALTER FUNCTION "public"."verwijder_gesprek"("p_gesprek_id" "uuid", "p_request_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."zoek_chunks"("p_query" "text", "p_limit" integer DEFAULT 20, "p_document_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_bronstatus" "text"[] DEFAULT NULL::"text"[], "p_documentstatus" "text"[] DEFAULT NULL::"text"[], "p_procesinstantie_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_modus" "text" DEFAULT 'alles'::"text", "p_peildatum" "date" DEFAULT CURRENT_DATE, "p_bronsoort" "text"[] DEFAULT NULL::"text"[], "p_fonds_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id" "uuid", "document_id" "uuid", "tekst" "text", "pagina" integer, "paragraaf" "text", "chunk_index" integer, "titel" "text", "bron" "text", "bibliotheek" "text", "opslag_pad" "text", "rang" real, "documentstatus" "text", "bronstatus" "text", "documentdatum" "date", "geldig_vanaf" "date", "geldig_tot" "date", "procesinstantie_id" "uuid", "bronorganisatie" "text", "normgewicht" "text", "extern_url" "text", "fonds_id" "uuid", "volgende_review" "date", "wettelijk_regime" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select
    c.id,
    c.document_id,
    c.tekst,
    c.pagina,
    c.paragraaf,
    c.chunk_index,
    d.titel,
    d.bron,
    d.bibliotheek,
    d.opslag_pad,
    ts_rank_cd(c.zoek_vector, q.query) as rang,
    c.documentstatus,
    c.bronstatus,
    c.documentdatum,
    c.geldig_vanaf,
    c.geldig_tot,
    c.procesinstantie_id,
    c.bronorganisatie,
    c.normgewicht,
    c.extern_url,
    d.fonds_id,
    d.volgende_review,
    c.wettelijk_regime
  from public.document_chunks c
  join public.documenten d on d.id = c.document_id
  cross join websearch_to_tsquery('dutch', p_query) as q(query)
  where d.actief = true
    -- 0154 §3: gearchiveerd universeel uit (NULL-veilig).
    and c.documentstatus is distinct from 'gearchiveerd'
    and c.zoek_vector @@ q.query
    and (p_document_ids is null or c.document_id = any(p_document_ids))
    and (
      p_modus is distinct from 'actueel'
      or (
        c.documentstatus in ('vastgesteld','van_kracht')
        and coalesce(c.bronstatus,'actief') = 'actief'
        and (c.geldig_vanaf is null or c.geldig_vanaf <= p_peildatum)
        and (c.geldig_tot   is null or c.geldig_tot   >= p_peildatum)
      )
    )
    and (p_bronstatus          is null or coalesce(c.bronstatus,'actief') = any(p_bronstatus))
    and (p_documentstatus      is null or c.documentstatus     = any(p_documentstatus))
    and (p_procesinstantie_ids is null or c.procesinstantie_id = any(p_procesinstantie_ids))
    and (p_bronsoort           is null or c.bibliotheek         = any(p_bronsoort))
    and (p_fonds_id is null or d.fonds_id = p_fonds_id or c.bibliotheek = 'generiek')
    and (
      c.bibliotheek is distinct from 'generiek'
      or (
        c.documentstatus = 'van_kracht'
        and coalesce(c.bronstatus,'actief') = 'actief'
        and (d.volgende_review is null or d.volgende_review >= p_peildatum)
      )
    )
  order by rang desc, c.chunk_index asc
  limit greatest(p_limit, 1);
$$;


ALTER FUNCTION "public"."zoek_chunks"("p_query" "text", "p_limit" integer, "p_document_ids" "uuid"[], "p_bronstatus" "text"[], "p_documentstatus" "text"[], "p_procesinstantie_ids" "uuid"[], "p_modus" "text", "p_peildatum" "date", "p_bronsoort" "text"[], "p_fonds_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."zoek_chunks"("p_query" "text", "p_limit" integer, "p_document_ids" "uuid"[], "p_bronstatus" "text"[], "p_documentstatus" "text"[], "p_procesinstantie_ids" "uuid"[], "p_modus" "text", "p_peildatum" "date", "p_bronsoort" "text"[], "p_fonds_id" "uuid") IS 'RAG-retrieval (ts_rank_cd) met documentscope + Increment G-filters + T4 expliciete fondsfilter en published-only generiek (van_kracht+actief), aangevuld met de T10 review-verval-gate (volgende_review >= p_peildatum OR NULL) en (0154 §3) de universele gearchiveerd-uitsluiting. Returnt d.fonds_id + d.volgende_review + (T4/regime-borging) c.wettelijk_regime voor de app-side demotie. Filter is ADDITIEF op RLS (defense-in-depth). SECURITY INVOKER: RLS blijft primair. Defaults = huidig gedrag.';



CREATE OR REPLACE FUNCTION "public"."zoek_chunks_hybride"("p_query" "text", "p_embedding" "public"."vector", "p_limit" integer DEFAULT 10, "p_kandidaten" integer DEFAULT 40, "p_k" integer DEFAULT 60, "p_document_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_bronstatus" "text"[] DEFAULT NULL::"text"[], "p_documentstatus" "text"[] DEFAULT NULL::"text"[], "p_procesinstantie_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_modus" "text" DEFAULT 'alles'::"text", "p_peildatum" "date" DEFAULT CURRENT_DATE, "p_bronsoort" "text"[] DEFAULT NULL::"text"[], "p_fonds_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id" "uuid", "document_id" "uuid", "tekst" "text", "pagina" integer, "paragraaf" "text", "chunk_index" integer, "titel" "text", "bron" "text", "bibliotheek" "text", "opslag_pad" "text", "rang" real, "fts_rang" integer, "vec_rang" integer, "documentstatus" "text", "bronstatus" "text", "documentdatum" "date", "geldig_vanaf" "date", "geldig_tot" "date", "procesinstantie_id" "uuid", "bronorganisatie" "text", "normgewicht" "text", "extern_url" "text", "fonds_id" "uuid", "volgende_review" "date", "wettelijk_regime" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  with q as (
    select websearch_to_tsquery('dutch', p_query) as tsq
  ),
  fts as (
    select dc.id,
           row_number() over (order by ts_rank_cd(dc.zoek_vector, q.tsq) desc, dc.id) as r
    from public.document_chunks dc
    join public.documenten d on d.id = dc.document_id
    cross join q
    where d.actief = true
      and dc.documentstatus is distinct from 'gearchiveerd'   -- 0154 §3 (NULL-veilig)
      and dc.zoek_vector @@ q.tsq
      and (p_document_ids is null or dc.document_id = any(p_document_ids))
      and (
        p_modus is distinct from 'actueel'
        or (
          dc.documentstatus in ('vastgesteld','van_kracht')
          and coalesce(dc.bronstatus,'actief') = 'actief'
          and (dc.geldig_vanaf is null or dc.geldig_vanaf <= p_peildatum)
          and (dc.geldig_tot   is null or dc.geldig_tot   >= p_peildatum)
        )
      )
      and (p_bronstatus          is null or coalesce(dc.bronstatus,'actief') = any(p_bronstatus))
      and (p_documentstatus      is null or dc.documentstatus     = any(p_documentstatus))
      and (p_procesinstantie_ids is null or dc.procesinstantie_id = any(p_procesinstantie_ids))
      and (p_bronsoort           is null or dc.bibliotheek         = any(p_bronsoort))
      and (p_fonds_id is null or d.fonds_id = p_fonds_id or dc.bibliotheek = 'generiek')
      and (
        dc.bibliotheek is distinct from 'generiek'
        or (
          dc.documentstatus = 'van_kracht'
          and coalesce(dc.bronstatus,'actief') = 'actief'
          and (d.volgende_review is null or d.volgende_review >= p_peildatum)
        )
      )
    order by ts_rank_cd(dc.zoek_vector, q.tsq) desc, dc.id
    limit p_kandidaten
  ),
  vec as (
    select dc.id,
           row_number() over (order by dc.embedding <=> p_embedding, dc.id) as r
    from public.document_chunks dc
    join public.documenten d on d.id = dc.document_id
    where d.actief = true
      and dc.documentstatus is distinct from 'gearchiveerd'   -- 0154 §3 (NULL-veilig)
      and dc.embedding is not null
      and (p_document_ids is null or dc.document_id = any(p_document_ids))
      and (
        p_modus is distinct from 'actueel'
        or (
          dc.documentstatus in ('vastgesteld','van_kracht')
          and coalesce(dc.bronstatus,'actief') = 'actief'
          and (dc.geldig_vanaf is null or dc.geldig_vanaf <= p_peildatum)
          and (dc.geldig_tot   is null or dc.geldig_tot   >= p_peildatum)
        )
      )
      and (p_bronstatus          is null or coalesce(dc.bronstatus,'actief') = any(p_bronstatus))
      and (p_documentstatus      is null or dc.documentstatus     = any(p_documentstatus))
      and (p_procesinstantie_ids is null or dc.procesinstantie_id = any(p_procesinstantie_ids))
      and (p_bronsoort           is null or dc.bibliotheek         = any(p_bronsoort))
      and (p_fonds_id is null or d.fonds_id = p_fonds_id or dc.bibliotheek = 'generiek')
      and (
        dc.bibliotheek is distinct from 'generiek'
        or (
          dc.documentstatus = 'van_kracht'
          and coalesce(dc.bronstatus,'actief') = 'actief'
          and (d.volgende_review is null or d.volgende_review >= p_peildatum)
        )
      )
    order by dc.embedding <=> p_embedding, dc.id
    limit p_kandidaten
  ),
  samen as (
    select coalesce(fts.id, vec.id) as id,
           fts.r as fts_rang,
           vec.r as vec_rang,
           coalesce(1.0 / (p_k + fts.r), 0) + coalesce(1.0 / (p_k + vec.r), 0) as rrf
    from fts
    full outer join vec on fts.id = vec.id
  )
  select dc.id, dc.document_id, dc.tekst, dc.pagina, dc.paragraaf, dc.chunk_index,
         d.titel, d.bron, d.bibliotheek, d.opslag_pad,
         s.rrf::real as rang, s.fts_rang, s.vec_rang,
         dc.documentstatus, dc.bronstatus, dc.documentdatum,
         dc.geldig_vanaf, dc.geldig_tot, dc.procesinstantie_id,
         dc.bronorganisatie, dc.normgewicht, dc.extern_url,
         d.fonds_id,
         d.volgende_review,
         dc.wettelijk_regime
  from samen s
  join public.document_chunks dc on dc.id = s.id
  join public.documenten d on d.id = dc.document_id
  where d.actief = true
  order by s.rrf desc, dc.id
  limit p_limit;
$$;


ALTER FUNCTION "public"."zoek_chunks_hybride"("p_query" "text", "p_embedding" "public"."vector", "p_limit" integer, "p_kandidaten" integer, "p_k" integer, "p_document_ids" "uuid"[], "p_bronstatus" "text"[], "p_documentstatus" "text"[], "p_procesinstantie_ids" "uuid"[], "p_modus" "text", "p_peildatum" "date", "p_bronsoort" "text"[], "p_fonds_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."zoek_chunks_hybride"("p_query" "text", "p_embedding" "public"."vector", "p_limit" integer, "p_kandidaten" integer, "p_k" integer, "p_document_ids" "uuid"[], "p_bronstatus" "text"[], "p_documentstatus" "text"[], "p_procesinstantie_ids" "uuid"[], "p_modus" "text", "p_peildatum" "date", "p_bronsoort" "text"[], "p_fonds_id" "uuid") IS 'Hybride RAG-retrieval (FTS+vector via RRF) met documentscope + Increment G-filters + T4 fondsfilter + published-only generiek + T10 review-verval-gate, in BEIDE armen vóór de fusion, aangevuld met (0154 §3) de universele gearchiveerd-uitsluiting. Besluit 0139: deterministische tiebreaker (, dc.id) op alle order-by-clausules. Returnt (T4/regime-borging) dc.wettelijk_regime voor de app-side demotie (geen WHERE-filter). hnsw.ef_search NIET op de functie gezet (Supabase weigert dit, 42501) — blijft default 40, apart belegd. Additief op RLS (defense-in-depth). SECURITY INVOKER: RLS blijft primair. Defaults = huidig gedrag.';



CREATE TABLE IF NOT EXISTS "public"."agendapunt_inbreng" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "agendapunt_id" "uuid",
    "gebruiker_id" "uuid",
    "gebruiker_naam" "text",
    "tekst" "text" NOT NULL,
    "aangemaakt" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."agendapunt_inbreng" OWNER TO "postgres";


COMMENT ON TABLE "public"."agendapunt_inbreng" IS 'Inbreng vooraf op een agendapunt. Fondsbreed leesbaar voor bestuurlijke rollen; NIET voor rol bestuursbureau (G9, migratie 2026_08_05). Tenantgrens loopt via agendapunten -> vergaderingen.fonds_id (gate A-register).';



CREATE TABLE IF NOT EXISTS "public"."agendapunt_log" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "agendapunt_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "actor_id" "uuid" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "aangemaakt" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "agendapunt_log_event_type_check" CHECK (("event_type" = ANY (ARRAY['agendapunt_gewijzigd'::"text", 'agendapunt_verplaatst'::"text", 'agendapunt_verwijderd'::"text", 'agendapunt_hersteld'::"text"])))
);


ALTER TABLE "public"."agendapunt_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."agendapunt_log" IS 'Append-only mutatie-log voor agendapunten. Apart van governance_events (besluit-gericht).';



CREATE TABLE IF NOT EXISTS "public"."agendapunten" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "vergadering_id" "uuid",
    "volgorde" integer DEFAULT 0 NOT NULL,
    "titel" "text" NOT NULL,
    "beschrijving" "text",
    "categorie" "text" DEFAULT 'informatie'::"text",
    "tijdsduur_minuten" integer,
    "verantwoordelijke" "text",
    "aangemaakt" timestamp with time zone DEFAULT "now"(),
    "procedure_stap_id" "uuid",
    "aangemaakt_door" "uuid",
    "verwijderd_op" timestamp with time zone,
    "verwijderd_door" "uuid",
    "verwijder_reden" "text",
    "gewijzigd_op" timestamp with time zone,
    "gewijzigd_door" "uuid",
    CONSTRAINT "agendapunten_categorie_check" CHECK (("categorie" = ANY (ARRAY['beeldvorming'::"text", 'oordeelsvorming'::"text", 'besluitvorming'::"text", 'informatie'::"text"])))
);


ALTER TABLE "public"."agendapunten" OWNER TO "postgres";


COMMENT ON COLUMN "public"."agendapunten"."aangemaakt_door" IS 'Eigenaar (= aanmaker). Voor bestaande rijen null; daar gelden alleen voorzitter/beheerder als wijzig-/verwijderrechten.';



COMMENT ON COLUMN "public"."agendapunten"."verwijderd_op" IS 'Soft-delete tijdstempel. Rij blijft staan met alle gekoppelde inbreng en voorbereiding intact.';



CREATE TABLE IF NOT EXISTS "public"."app_errors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tijdstip" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fonds_id" "uuid",
    "label" "text" NOT NULL,
    "categorie" "text" NOT NULL,
    "severity" "text" NOT NULL,
    "http_status" integer,
    "fouttype" "text",
    "foutcode" "text",
    "melding_kort" "text",
    "context_sleutels" "text"[],
    "correlatie_id" "uuid",
    "bron" "text" DEFAULT 'rpc'::"text" NOT NULL,
    CONSTRAINT "app_errors_bron_check" CHECK (("bron" = ANY (ARRAY['rpc'::"text", 'service'::"text"]))),
    CONSTRAINT "app_errors_categorie_check" CHECK (("categorie" = ANY (ARRAY['auth_sessie'::"text", 'autorisatie'::"text", 'validatie'::"text", 'upload_bestandsveiligheid'::"text", 'extractie_ocr'::"text", 'embedding_indexering'::"text", 'retrieval_ai'::"text", 'rate_limiting'::"text", 'database_integriteit'::"text", 'externe_afhankelijkheid'::"text"]))),
    CONSTRAINT "app_errors_melding_kort_check" CHECK ((("melding_kort" IS NULL) OR ("char_length"("melding_kort") <= 200))),
    CONSTRAINT "app_errors_severity_check" CHECK (("severity" = ANY (ARRAY['laag'::"text", 'middel'::"text", 'hoog'::"text", 'kritiek'::"text"])))
);


ALTER TABLE "public"."app_errors" OWNER TO "postgres";


COMMENT ON TABLE "public"."app_errors" IS 'GLOBAAL + OPERATIONEEL (T3-register). Gestructureerde API-foutregels (FO §18.1). RLS aan, GEEN policy: alleen de service-role leest; schrijven uitsluitend via fn_app_error_log (gedeelde surface) of de service-role (beheer-surface). NIET append-only en bewust GEEN auditspoor — retentie 90 dagen, opgeschoond door de snapshot-cron (besluit 0104). Bevat per constructie geen prompt-, document- of deelnemergegevens.';



COMMENT ON COLUMN "public"."app_errors"."fonds_id" IS 'Server-side afgeleid uit auth.uid() in fn_app_error_log; nooit door de caller aangeleverd. NULL = platformcontext of geen sessie.';



COMMENT ON COLUMN "public"."app_errors"."melding_kort" IS 'AFGELEIDE, geredigeerde melding (max 200 tekens). Nooit error.message rauw; nooit details/hint van een PostgrestError.';



COMMENT ON COLUMN "public"."app_errors"."context_sleutels" IS 'Alleen de SLEUTELS van de logcontext — nooit de waarden.';



COMMENT ON COLUMN "public"."app_errors"."correlatie_id" IS 'Verwijst naar platform_event_log.correlatie_id waar een platformhandeling de fout veroorzaakte. Geen FK omdat correlatie_id daar NIET uniek is: de unique index staat op (correlatie_id, fase), want elke handeling levert een attempt- en een result-rij.';



COMMENT ON COLUMN "public"."app_errors"."bron" IS 'rpc = aangeleverd door een ingelogde gebruiker via fn_app_error_log (beïnvloedbaar); service = geschreven door de beheer-surface of een cron.';



CREATE TABLE IF NOT EXISTS "public"."aqlab_ai_features" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "code" "text" NOT NULL,
    "naam" "text" NOT NULL,
    "doel" "text",
    "geraakt_proces" "text",
    "risicocategorie" "text" DEFAULT 'nader_beoordelen'::"text" NOT NULL,
    "human_in_the_loop_maatregel" "text",
    "status" "text" DEFAULT 'ontwerp'::"text" NOT NULL,
    "eigenaar" "text",
    "aangemaakt_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    "aangemaakt_door" "uuid",
    CONSTRAINT "aqlab_ai_features_risicocategorie_check" CHECK (("risicocategorie" = ANY (ARRAY['minimaal'::"text", 'beperkt'::"text", 'hoog'::"text", 'nader_beoordelen'::"text"]))),
    CONSTRAINT "aqlab_ai_features_status_check" CHECK (("status" = ANY (ARRAY['ontwerp'::"text", 'pilot'::"text", 'productie'::"text", 'retired'::"text"])))
);


ALTER TABLE "public"."aqlab_ai_features" OWNER TO "postgres";


COMMENT ON TABLE "public"."aqlab_ai_features" IS 'AQLab GLOBAAL (provider-owned, synthetisch). Register van te toetsen AI-features. Deny-by-default RLS; toegang via platform-wrapper (decision 0058).';



CREATE TABLE IF NOT EXISTS "public"."aqlab_audit_exports" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "run_id" "uuid",
    "feature_id" "uuid",
    "inhoud_hash" "text" NOT NULL,
    "formaat" "text" DEFAULT 'html'::"text" NOT NULL,
    "opslag_ref" "text",
    "besluit" "text",
    "besluit_door" "uuid",
    "besluit_op" timestamp with time zone,
    "gegenereerd_door" "uuid",
    "gegenereerd_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "aqlab_audit_exports_besluit_check" CHECK (("besluit" = ANY (ARRAY['vrijgegeven'::"text", 'geblokkeerd'::"text"]))),
    CONSTRAINT "aqlab_audit_exports_formaat_check" CHECK (("formaat" = ANY (ARRAY['html'::"text", 'pdf'::"text"])))
);


ALTER TABLE "public"."aqlab_audit_exports" OWNER TO "postgres";


COMMENT ON TABLE "public"."aqlab_audit_exports" IS 'AQLab GLOBAAL, APPEND-ONLY. Bevroren auditrapport per run/release (inhoud_hash); bron van de read-only fonds-download (AQL-4).';



CREATE TABLE IF NOT EXISTS "public"."aqlab_findings" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "score_id" "uuid",
    "run_output_id" "uuid",
    "type" "text",
    "ernst" "text" DEFAULT 'middel'::"text" NOT NULL,
    "omschrijving" "text",
    "fragment" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "aangemaakt_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "aqlab_findings_ernst_check" CHECK (("ernst" = ANY (ARRAY['kritiek'::"text", 'hoog'::"text", 'middel'::"text", 'laag'::"text"]))),
    CONSTRAINT "aqlab_findings_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'geaccepteerd'::"text", 'opgelost'::"text"]))),
    CONSTRAINT "aqlab_findings_type_check" CHECK (("type" = ANY (ARRAY['hallucinatie'::"text", 'bron_ontbreekt'::"text", 'format'::"text", 'autorisatie'::"text", 'herkomstlabel'::"text", 'overig'::"text"])))
);


ALTER TABLE "public"."aqlab_findings" OWNER TO "postgres";


COMMENT ON TABLE "public"."aqlab_findings" IS 'AQLab GLOBAAL. Bevinding/afwijking per score (audit-detail).';



CREATE TABLE IF NOT EXISTS "public"."aqlab_fixture_documents" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "code" "text" NOT NULL,
    "titel" "text" NOT NULL,
    "documenttype" "text",
    "feature_id" "uuid",
    "versie" integer DEFAULT 1 NOT NULL,
    "opslag_ref" "text",
    "repo_path" "text",
    "content_hash" "text",
    "synthetic" boolean DEFAULT true NOT NULL,
    "aangemaakt_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    "aangemaakt_door" "uuid",
    CONSTRAINT "aqlab_fixture_documents_synthetic_check" CHECK (("synthetic" = true))
);


ALTER TABLE "public"."aqlab_fixture_documents" OWNER TO "postgres";


COMMENT ON TABLE "public"."aqlab_fixture_documents" IS 'AQLab GLOBAAL. Register synthetische demodocumenten (demofonds Horizon). synthetic=true CHECK afgedwongen; reproduceerbare bronref = code + versie + content_hash.';



CREATE TABLE IF NOT EXISTS "public"."aqlab_human_reviews" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "run_output_id" "uuid" NOT NULL,
    "reviewer_id" "uuid",
    "oordeel" "text" NOT NULL,
    "score_override" numeric,
    "motivatie" "text",
    "beoordeeld_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "aqlab_human_reviews_oordeel_check" CHECK (("oordeel" = ANY (ARRAY['bevestigd'::"text", 'overruled'::"text", 'geblokkeerd'::"text"])))
);


ALTER TABLE "public"."aqlab_human_reviews" OWNER TO "postgres";


COMMENT ON TABLE "public"."aqlab_human_reviews" IS 'AQLab GLOBAAL. Menselijke aftekening/overrule (light: geen toewijzing/SLA/queue).';



CREATE TABLE IF NOT EXISTS "public"."aqlab_log" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "gebruiker_id" "uuid",
    "gebruiker_naam" "text",
    "actie" "text" NOT NULL,
    "object_type" "text",
    "object_id" "uuid",
    "oude_waarde" "jsonb",
    "nieuwe_waarde" "jsonb",
    "aangemaakt_op" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."aqlab_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."aqlab_log" IS 'AQLab GLOBAAL, APPEND-ONLY (fn_log_append_only). Auditspoor van Lab-acties (run/besluit/seed). Geen fonds_id (provider-acties).';



CREATE TABLE IF NOT EXISTS "public"."aqlab_model_configurations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "naam" "text" NOT NULL,
    "model_provider" "text" DEFAULT 'anthropic'::"text" NOT NULL,
    "model_name" "text" NOT NULL,
    "model_version" "text",
    "temperature_requested" numeric,
    "max_tokens_requested" integer,
    "top_p_requested" numeric,
    "retrieval_settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "guardrails" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_baseline" boolean DEFAULT false NOT NULL,
    "aangemaakt_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    "aangemaakt_door" "uuid",
    "config_hash" "text",
    "reasoning_effort_requested" "text"
);


ALTER TABLE "public"."aqlab_model_configurations" OWNER TO "postgres";


COMMENT ON TABLE "public"."aqlab_model_configurations" IS 'AQLab GLOBAAL. Benoemde modelinstelling (variant-as); reproduceerbaarheid via gevraagd vs effectief (effectief bevroren op run_outputs).';



COMMENT ON COLUMN "public"."aqlab_model_configurations"."config_hash" IS 'AQL-5: sha256 over (model + temperature + max_tokens + top_p + retrieval), berekend in lib/aqlab/modellen.ts. Uniek → dedup-op-hash bij append-only pinnen van challenger-instellingen (§2B).';



COMMENT ON COLUMN "public"."aqlab_model_configurations"."reasoning_effort_requested" IS 'AQL-6: gevraagde reasoning-effort voor reasoning-modellen (minimal/low/medium/high). NULL = provider-default of niet-reasoning-model.';



CREATE TABLE IF NOT EXISTS "public"."aqlab_prompt_versions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "feature_id" "uuid" NOT NULL,
    "soort" "text" NOT NULL,
    "versie" integer NOT NULL,
    "inhoud" "text" NOT NULL,
    "checksum" "text",
    "actief_in_productie" boolean DEFAULT false NOT NULL,
    "notitie" "text",
    "aangemaakt_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    "aangemaakt_door" "uuid",
    CONSTRAINT "aqlab_prompt_versions_soort_check" CHECK (("soort" = ANY (ARRAY['user_prompt'::"text", 'system_prompt'::"text", 'answer_template'::"text", 'guardrail'::"text"])))
);


ALTER TABLE "public"."aqlab_prompt_versions" OWNER TO "postgres";


COMMENT ON TABLE "public"."aqlab_prompt_versions" IS 'AQLab GLOBAAL. Versiebeheer prompts/system-prompts per feature; append-only aanbevolen (nieuwe versie i.p.v. edit).';



CREATE TABLE IF NOT EXISTS "public"."aqlab_release_decisions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "run_id" "uuid",
    "feature_id" "uuid",
    "prompt_version_id" "uuid",
    "model_configuration_id" "uuid",
    "release_status" "text" DEFAULT 'concept'::"text" NOT NULL,
    "release_advies" "text",
    "besluit" "text",
    "besluit_door" "uuid",
    "besluit_op" timestamp with time zone,
    "motivatie" "text",
    "kritieke_bevindingen_count" integer DEFAULT 0 NOT NULL,
    "assurance_scope" "text" DEFAULT 'productbreed'::"text" NOT NULL,
    "audit_export_id" "uuid",
    "aangemaakt_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "aqlab_release_decisions_assurance_scope_check" CHECK (("assurance_scope" = ANY (ARRAY['productbreed'::"text", 'fonds_specifiek'::"text"]))),
    CONSTRAINT "aqlab_release_decisions_besluit_check" CHECK (("besluit" = ANY (ARRAY['vrijgegeven'::"text", 'geblokkeerd'::"text"]))),
    CONSTRAINT "aqlab_release_decisions_release_advies_check" CHECK (("release_advies" = ANY (ARRAY['accepteren'::"text", 'aanpassen'::"text", 'blokkeren'::"text"]))),
    CONSTRAINT "aqlab_release_decisions_release_status_check" CHECK (("release_status" = ANY (ARRAY['concept'::"text", 'getest'::"text", 'review_vereist'::"text", 'aangepast'::"text", 'vrijgegeven'::"text", 'geblokkeerd'::"text", 'gearchiveerd'::"text"]))),
    CONSTRAINT "aqlab_release_kritiek_blokkeert" CHECK ((("kritieke_bevindingen_count" = 0) OR (("besluit" IS DISTINCT FROM 'vrijgegeven'::"text") AND ("release_advies" IS DISTINCT FROM 'accepteren'::"text")))),
    CONSTRAINT "aqlab_release_vrijgegeven_volledig" CHECK ((("release_status" <> 'vrijgegeven'::"text") OR (("besluit" = 'vrijgegeven'::"text") AND ("besluit_door" IS NOT NULL) AND ("besluit_op" IS NOT NULL))))
);


ALTER TABLE "public"."aqlab_release_decisions" OWNER TO "postgres";


COMMENT ON TABLE "public"."aqlab_release_decisions" IS 'AQLab GLOBAAL, APPEND-ONLY. Bron van waarheid voor vrijgave; kritieke bevinding blokkeert (CHECK). Statuswijziging = nieuwe regel.';



CREATE TABLE IF NOT EXISTS "public"."aqlab_run_outputs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "test_case_id" "uuid",
    "iteratie" integer DEFAULT 1 NOT NULL,
    "inputvraag" "text",
    "gebruikte_context" "jsonb",
    "gegenereerd_antwoord" "text",
    "gebruikte_bronnen" "jsonb",
    "herkomstlabels" "jsonb",
    "snapshot_refs" "jsonb",
    "snapshot_hash" "text",
    "retrieval_filter" "jsonb",
    "model_name" "text",
    "model_version" "text",
    "temperature_effective" numeric,
    "max_tokens_effective" integer,
    "top_p_effective" numeric,
    "provider_default_used" boolean,
    "retrieval_settings_effective" "jsonb",
    "prompt_version_id" "uuid",
    "tokengebruik" "jsonb",
    "latency_ms" integer,
    "kosten_indicatie" numeric,
    "foutmelding" "text",
    "tijdstip" timestamp with time zone DEFAULT "now"() NOT NULL,
    "gestart_door" "uuid",
    "quality_score" numeric,
    "gate_status" "text",
    "model_provider" "text",
    "reasoning_effort_effective" "text",
    CONSTRAINT "aqlab_run_outputs_gate_status_check" CHECK ((("gate_status" IS NULL) OR ("gate_status" = ANY (ARRAY['pass'::"text", 'geblokkeerd'::"text", 'review_vereist'::"text"]))))
);


ALTER TABLE "public"."aqlab_run_outputs" OWNER TO "postgres";


COMMENT ON TABLE "public"."aqlab_run_outputs" IS 'AQLab GLOBAAL. AI-resultaat per iteratie + snapshot-refs (refs_only) + effectieve modelinstellingen bevroren. Synthetische content in MVP.';



COMMENT ON COLUMN "public"."aqlab_run_outputs"."quality_score" IS 'Gewogen kwaliteitsscore 0-100 (gradueel). STRIKT gescheiden van gate_status.';



COMMENT ON COLUMN "public"."aqlab_run_outputs"."gate_status" IS 'Blokkade-uitkomst (categorisch): pass / geblokkeerd / review_vereist. Onafhankelijk van quality_score.';



COMMENT ON COLUMN "public"."aqlab_run_outputs"."model_provider" IS 'AQL-6: effectieve generatie-provider bevroren per iteratie (anthropic=baseline/productie; openai/mistral=challenger). NULL op oudere rijen van vóór AQL-6.';



COMMENT ON COLUMN "public"."aqlab_run_outputs"."reasoning_effort_effective" IS 'AQL-6: effectieve reasoning-effort bevroren per iteratie. NULL = provider-default of niet-reasoning-model (klassiek chat-model, sampling via temperature).';



CREATE TABLE IF NOT EXISTS "public"."aqlab_runs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "run_type" "text" DEFAULT 'full_regression'::"text" NOT NULL,
    "test_set_id" "uuid",
    "prompt_version_id" "uuid",
    "model_configuration_id" "uuid",
    "baseline_run_id" "uuid",
    "rol" "text",
    "soort" "text" DEFAULT 'functioneel'::"text" NOT NULL,
    "subset_filter" "jsonb",
    "selected_test_case_ids" "uuid"[],
    "ad_hoc_question" "text",
    "promoted_to_testcase" boolean DEFAULT false NOT NULL,
    "promoted_testcase_id" "uuid",
    "gewijzigde_as" "text",
    "atomair" boolean,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "persist_mode" "text" DEFAULT 'full_synthetic'::"text" NOT NULL,
    "aggregatie" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "kostenplafond" numeric,
    "totale_kosten" numeric,
    "notitie" "text",
    "gestart_door" "uuid",
    "gestart_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    "voltooid_op" timestamp with time zone,
    "naam" "text",
    CONSTRAINT "aqlab_runs_gewijzigde_as_check" CHECK (("gewijzigde_as" = ANY (ARRAY['prompt'::"text", 'model'::"text", 'temperature'::"text", 'max_tokens'::"text", 'retrieval'::"text", 'geen'::"text", 'meerdere'::"text"]))),
    CONSTRAINT "aqlab_runs_persist_mode_check" CHECK (("persist_mode" = ANY (ARRAY['full_synthetic'::"text", 'none'::"text", 'metadata_only'::"text"]))),
    CONSTRAINT "aqlab_runs_rol_check" CHECK (("rol" = ANY (ARRAY['baseline'::"text", 'challenger'::"text"]))),
    CONSTRAINT "aqlab_runs_run_type_check" CHECK (("run_type" = ANY (ARRAY['full_regression'::"text", 'subset'::"text", 'ad_hoc'::"text"]))),
    CONSTRAINT "aqlab_runs_soort_check" CHECK (("soort" = ANY (ARRAY['functioneel'::"text", 'security_blocking'::"text"]))),
    CONSTRAINT "aqlab_runs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'running'::"text", 'done'::"text", 'failed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."aqlab_runs" OWNER TO "postgres";


COMMENT ON TABLE "public"."aqlab_runs" IS 'AQLab GLOBAAL. Uitvoering + aggregatie (regressie/performance/consistency-JSON). Consistentie-aggregaat gereserveerd (ADR 0056), berekend in AQL-3.';



COMMENT ON COLUMN "public"."aqlab_runs"."naam" IS 'AQL-5: door de gebruiker gekozen run-naam/label (terugvindbaarheid). Los van notitie (vrije toelichting).';



CREATE TABLE IF NOT EXISTS "public"."aqlab_scores" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "run_output_id" "uuid" NOT NULL,
    "criterium_code" "text" NOT NULL,
    "methode" "text" NOT NULL,
    "score" numeric,
    "pass" boolean,
    "motivatie" "text",
    "bewijs" "jsonb",
    "judge_model" "text",
    "beoordeeld_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    "beoordeeld_door" "uuid",
    CONSTRAINT "aqlab_scores_methode_check" CHECK (("methode" = ANY (ARRAY['deterministisch'::"text", 'heuristisch'::"text", 'llm_judge'::"text", 'human'::"text"])))
);


ALTER TABLE "public"."aqlab_scores" OWNER TO "postgres";


COMMENT ON TABLE "public"."aqlab_scores" IS 'AQLab GLOBAAL. Score per output×criterium; criterium_code → lib/aqlab/criteria.ts (code-seed, geen tabel in MVP).';



CREATE TABLE IF NOT EXISTS "public"."aqlab_test_case_fixtures" (
    "test_case_id" "uuid" NOT NULL,
    "fixture_document_id" "uuid" NOT NULL,
    "rol" "text" DEFAULT 'required'::"text" NOT NULL,
    CONSTRAINT "aqlab_test_case_fixtures_rol_check" CHECK (("rol" = ANY (ARRAY['required'::"text", 'excluded'::"text"])))
);


ALTER TABLE "public"."aqlab_test_case_fixtures" OWNER TO "postgres";


COMMENT ON TABLE "public"."aqlab_test_case_fixtures" IS 'AQLab GLOBAAL. n-n koppeling testcase ↔ synthetische fixture (rol: required/excluded).';



CREATE TABLE IF NOT EXISTS "public"."aqlab_test_cases" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "test_set_id" "uuid" NOT NULL,
    "feature_id" "uuid",
    "code" "text" NOT NULL,
    "titel" "text" NOT NULL,
    "gebruikersvraag" "text",
    "gebruikersrol" "text",
    "broncontext_ref" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "verwachte_outputvorm" "text",
    "verplichte_onderdelen" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "blokkadecriteria" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "minimale_acceptatiescore" integer,
    "soort" "text" DEFAULT 'functioneel'::"text" NOT NULL,
    "kritikaliteit" "text" DEFAULT 'middel'::"text" NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "review_verplicht" boolean DEFAULT false NOT NULL,
    "herhalingen" integer DEFAULT 3 NOT NULL,
    "consistency_required" boolean DEFAULT false NOT NULL,
    "consistency_iterations" integer DEFAULT 3 NOT NULL,
    "spec" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "actief" boolean DEFAULT true NOT NULL,
    "aangemaakt_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    "aangemaakt_door" "uuid",
    CONSTRAINT "aqlab_test_cases_consistency_iterations_check" CHECK (("consistency_iterations" = ANY (ARRAY[3, 5]))),
    CONSTRAINT "aqlab_test_cases_kritikaliteit_check" CHECK (("kritikaliteit" = ANY (ARRAY['kritiek'::"text", 'hoog'::"text", 'middel'::"text", 'laag'::"text"]))),
    CONSTRAINT "aqlab_test_cases_minimale_acceptatiescore_check" CHECK ((("minimale_acceptatiescore" >= 0) AND ("minimale_acceptatiescore" <= 100))),
    CONSTRAINT "aqlab_test_cases_soort_check" CHECK (("soort" = ANY (ARRAY['functioneel'::"text", 'security_blocking'::"text"])))
);


ALTER TABLE "public"."aqlab_test_cases" OWNER TO "postgres";


COMMENT ON TABLE "public"."aqlab_test_cases" IS 'AQLab GLOBAAL. Reproduceerbaar testgeval; broncontext = uitsluitend synthetische fixtures. consistency_* stuurt de consistentiemeting (AQL-3, ADR 0056).';



CREATE TABLE IF NOT EXISTS "public"."aqlab_test_sets" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "feature_id" "uuid",
    "code" "text" NOT NULL,
    "naam" "text" NOT NULL,
    "omschrijving" "text",
    "versie" integer DEFAULT 1 NOT NULL,
    "status" "text" DEFAULT 'actief'::"text" NOT NULL,
    "aangemaakt_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    "aangemaakt_door" "uuid",
    CONSTRAINT "aqlab_test_sets_status_check" CHECK (("status" = ANY (ARRAY['actief'::"text", 'verouderd'::"text", 'gearchiveerd'::"text"])))
);


ALTER TABLE "public"."aqlab_test_sets" OWNER TO "postgres";


COMMENT ON TABLE "public"."aqlab_test_sets" IS 'AQLab GLOBAAL. Golden set (verzameling testcases) per feature. Provider-globaal/synthetisch, geen fonds_id/scope in MVP.';



CREATE TABLE IF NOT EXISTS "public"."bron_whitelist" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "domein" "text" NOT NULL,
    "matchtype" "text" DEFAULT 'domein'::"text" NOT NULL,
    "pad" "text",
    "normgewicht" "text" NOT NULL,
    "categorie" "text",
    "tier" "text",
    "status" "text" DEFAULT 'in_review'::"text" NOT NULL,
    "toelichting" "text" NOT NULL,
    "toegevoegd_door" "uuid",
    "gewijzigd_door" "uuid",
    "toegevoegd_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    "gewijzigd_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    "review_datum" "date",
    CONSTRAINT "bron_whitelist_matchtype_check" CHECK (("matchtype" = ANY (ARRAY['domein'::"text", 'domein_subdomeinen'::"text", 'padprefix'::"text"]))),
    CONSTRAINT "bron_whitelist_normgewicht_check" CHECK (("normgewicht" = ANY (ARRAY['bindend'::"text", 'toezichtverwachting'::"text", 'sector_guidance'::"text", 'informatief'::"text", 'onbekend'::"text"]))),
    CONSTRAINT "bron_whitelist_pad_check" CHECK (((("matchtype" = 'padprefix'::"text") AND ("pad" IS NOT NULL) AND ("pad" <> ''::"text")) OR ("matchtype" <> 'padprefix'::"text"))),
    CONSTRAINT "bron_whitelist_status_check" CHECK (("status" = ANY (ARRAY['actief'::"text", 'inactief'::"text", 'in_review'::"text"])))
);


ALTER TABLE "public"."bron_whitelist" OWNER TO "postgres";


COMMENT ON TABLE "public"."bron_whitelist" IS '0072/Scenario A: beheerde whitelist van gezaghebbende domeinen voor live web-retrieval. Generieke platformconfiguratie (fonds_id-loos), read-only voor tenants, curatie via platform.config.manage. Weging op normgewicht.';



COMMENT ON COLUMN "public"."bron_whitelist"."matchtype" IS '''domein'' = exact dit domein; ''domein_subdomeinen'' = domein + alle subdomeinen; ''padprefix'' = domein beperkt tot het pad in kolom pad.';



COMMENT ON COLUMN "public"."bron_whitelist"."normgewicht" IS 'Hergebruik van de documenten-normgewicht-enum; leidend voor de bron-weging (bindend > toezichtverwachting > sector_guidance > informatief). Geen parallel tier-veld.';



COMMENT ON COLUMN "public"."bron_whitelist"."tier" IS 'Puur beheerlabel voor het curatie-scherm (1/2/3/context). De feitelijke weging loopt via normgewicht.';



CREATE TABLE IF NOT EXISTS "public"."bron_whitelist_log" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "whitelist_id" "uuid",
    "domein_snapshot" "text",
    "handeling" "text" NOT NULL,
    "gewijzigd_door" "uuid",
    "gewijzigd_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    "oud" "jsonb",
    "nieuw" "jsonb",
    "reden" "text",
    "hash" "text",
    "tijdstip" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bron_whitelist_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."bron_whitelist_log" IS '0072/Scenario A: append-only auditlog van whitelist-wijzigingen (naast platform_event_log). Immutable + hash per event.';



CREATE TABLE IF NOT EXISTS "public"."catalogus_log" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "entiteit" "text" NOT NULL,
    "entiteit_id" "uuid",
    "event_type" "text" NOT NULL,
    "actor_id" "uuid",
    "payload" "jsonb" DEFAULT '{}'::"jsonb",
    "tijdstip" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."catalogus_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."classificatie_voorstellen" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "document_id" "uuid" NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "voorgestelde_procesinstantie_id" "uuid",
    "voorgesteld_documenttype" "text",
    "confidence" "text" NOT NULL,
    "bron" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "toelichting" "text",
    "toegepast_op" timestamp with time zone,
    "teruggedraaid_op" timestamp with time zone,
    "beoordeeld_door" "uuid",
    "aangemaakt" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "classificatie_voorstellen_bron_check" CHECK (("bron" = ANY (ARRAY['titel'::"text", 'inhoud'::"text", 'periode'::"text", 'synoniem'::"text"]))),
    CONSTRAINT "classificatie_voorstellen_confidence_check" CHECK (("confidence" = ANY (ARRAY['hoog'::"text", 'middel'::"text", 'laag'::"text", 'geen_match'::"text"]))),
    CONSTRAINT "classificatie_voorstellen_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'bevestigd'::"text", 'afgewezen'::"text", 'auto_toegepast'::"text", 'teruggedraaid'::"text"])))
);


ALTER TABLE "public"."classificatie_voorstellen" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."comparison_results" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "comparison_run_id" "uuid" NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "finding_key" "text" NOT NULL,
    "dimensie" "text" NOT NULL,
    "concept_id" "uuid",
    "bron_document_id" "uuid" NOT NULL,
    "bron_value" "text",
    "bron_evidence" "text",
    "bron_page" integer,
    "doel_document_id" "uuid" NOT NULL,
    "doel_value" "text",
    "doel_evidence" "text",
    "doel_page" integer,
    "verschil_type_ruw" "text" NOT NULL,
    "method" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "comparison_results_method_check" CHECK (("method" = ANY (ARRAY['deterministisch'::"text", 'llm'::"text"]))),
    CONSTRAINT "comparison_results_verschil_type_ruw_check" CHECK (("verschil_type_ruw" = ANY (ARRAY['gelijk'::"text", 'verschilt'::"text", 'alleen_bron'::"text", 'alleen_doel'::"text"])))
);


ALTER TABLE "public"."comparison_results" OWNER TO "postgres";


COMMENT ON TABLE "public"."comparison_results" IS 'Ruwe bevindingen van een symmetrische documentvergelijking (T5), één rij per dimensie. Per fonds geïsoleerd (RLS op fonds_id). Schrijven uitsluitend via fn_schrijf_vergelijking (SECURITY DEFINER); authenticated is read-only. Append-only. verschil_type_ruw is bewust RUW: bestuurlijke classificatie en materialiteit zijn T9 en horen hier niet. method legt vast of het cijfer/datum-verschil deterministisch (beide zijden een semantic_unit) of via LLM bepaald is.';



CREATE TABLE IF NOT EXISTS "public"."comparison_run" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "mode" "text" NOT NULL,
    "model" "text" NOT NULL,
    "prompt_version" "text" NOT NULL,
    "comparator_version" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "comparison_run_mode_check" CHECK (("mode" = ANY (ARRAY['symmetrisch'::"text", 'coverage'::"text"])))
);


ALTER TABLE "public"."comparison_run" OWNER TO "postgres";


COMMENT ON TABLE "public"."comparison_run" IS 'Reproduceerbaarheid van de vergelijking (T7-header). De feitelijke comparison_results komen in T5. Append-only (geen UPDATE/DELETE).';



CREATE TABLE IF NOT EXISTS "public"."concepts" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "type" "text" NOT NULL,
    "status" "text" NOT NULL,
    "normalization" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "concepts_status_check" CHECK (("status" = ANY (ARRAY['actief'::"text", 'conditioneel'::"text", 'uitgesteld'::"text"]))),
    CONSTRAINT "concepts_type_check" CHECK (("type" = ANY (ARRAY['percentage'::"text", 'date'::"text", 'amount'::"text", 'policy_choice'::"text"])))
);


ALTER TABLE "public"."concepts" OWNER TO "postgres";


COMMENT ON TABLE "public"."concepts" IS 'Canonieke, sectorbrede conceptcatalogus voor de semantische laag (T7). Platform-globaal: geen fonds_id, `for select using(true)` voor authenticated, schrijven uitsluitend via de service-role (catalogus-eigenaar). Global-by-design (T3-registerpatroon, zie de globale lijst in de structurele gates). ⚠ GOVERNANCE: de catalogus-eigenaar moet vóór productie benoemd zijn — zonder eigenaar is er geen beheerde catalogus (openstaand risico T7).';



CREATE TABLE IF NOT EXISTS "public"."contact_aanvragen" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "aangemaakt_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    "naam" "text" NOT NULL,
    "organisatie" "text" NOT NULL,
    "rol" "text" NOT NULL,
    "email" "text" NOT NULL,
    "telefoon" "text",
    "type_verzoek" "text" NOT NULL,
    "bericht" "text" NOT NULL,
    "herkomst_pagina" "text",
    "privacy_version" "text" NOT NULL,
    "ip_hash" "text",
    "user_agent_hash" "text",
    "status" "text" DEFAULT 'nieuw'::"text" NOT NULL,
    "notificatie_verzonden" boolean DEFAULT false NOT NULL,
    "mail_error" "text",
    "opgevolgd_door" "text",
    "afgehandeld_op" timestamp with time zone,
    CONSTRAINT "contact_aanvragen_lengtes" CHECK ((("char_length"("naam") <= 200) AND ("char_length"("organisatie") <= 200) AND ("char_length"("rol") <= 200) AND ("char_length"("email") <= 254) AND (("telefoon" IS NULL) OR ("char_length"("telefoon") <= 50)) AND ("char_length"("bericht") <= 5000) AND (("herkomst_pagina" IS NULL) OR ("char_length"("herkomst_pagina") <= 255)) AND ("char_length"("privacy_version") <= 50))),
    CONSTRAINT "contact_aanvragen_status_check" CHECK (("status" = ANY (ARRAY['nieuw'::"text", 'in_behandeling'::"text", 'afgehandeld'::"text"]))),
    CONSTRAINT "contact_aanvragen_type_verzoek_check" CHECK (("type_verzoek" = ANY (ARRAY['demo'::"text", 'pilot'::"text", 'vraag'::"text", 'samenwerking'::"text"])))
);


ALTER TABLE "public"."contact_aanvragen" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."decision_actions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "decision_id" "uuid" NOT NULL,
    "voorwaarde_id" "uuid",
    "actie" "text" NOT NULL,
    "eigenaar_naam" "text",
    "deadline" "date",
    "status" "text" DEFAULT 'open'::"text",
    "afhankelijk_van" "uuid",
    "aangemaakt_op" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "decision_actions_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'in_behandeling'::"text", 'afgerond'::"text", 'vervallen'::"text", 'escalatie'::"text"])))
);


ALTER TABLE "public"."decision_actions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."decision_ai_interactions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "decision_id" "uuid" NOT NULL,
    "procedure_stap_id" "uuid",
    "type" "text" NOT NULL,
    "prompt" "text" NOT NULL,
    "bronnen" "jsonb" DEFAULT '[]'::"jsonb",
    "model" "text" DEFAULT 'claude-sonnet-4-5'::"text",
    "modelversie" "text",
    "output" "text" NOT NULL,
    "validatiestatus" "text" DEFAULT 'concept'::"text",
    "gevalideerd_door" "uuid",
    "gevalideerd_op" timestamp with time zone,
    "aangepaste_output" "text",
    "gebruikt_in_dossier" boolean DEFAULT false,
    "gebruik_context" "text",
    "verworpen_reden" "text",
    "validatie_domein" "text" DEFAULT 'algemeen'::"text",
    "aangemaakt_op" timestamp with time zone DEFAULT "now"(),
    "aangemaakt_door" "uuid",
    CONSTRAINT "chk_bronnen_array" CHECK (("jsonb_typeof"("bronnen") = 'array'::"text")),
    CONSTRAINT "decision_ai_interactions_type_check" CHECK (("type" = ANY (ARRAY['samenvatting'::"text", 'aannamedetectie'::"text", 'scenario'::"text", 'kritische_vraag'::"text", 'vergelijking'::"text"]))),
    CONSTRAINT "decision_ai_interactions_validatie_domein_check" CHECK (("validatie_domein" = ANY (ARRAY['algemeen'::"text", 'risk'::"text", 'compliance'::"text", 'beleggingen'::"text", 'governance'::"text"]))),
    CONSTRAINT "decision_ai_interactions_validatiestatus_check" CHECK (("validatiestatus" = ANY (ARRAY['concept'::"text", 'gevalideerd'::"text", 'aangepast'::"text", 'afgekeurd'::"text", 'gearchiveerd'::"text"])))
);


ALTER TABLE "public"."decision_ai_interactions" OWNER TO "postgres";


COMMENT ON CONSTRAINT "chk_bronnen_array" ON "public"."decision_ai_interactions" IS 'Bronnen-veld moet altijd een JSON-array zijn. Element-shape (document_id, titel, paragraaf, fragment) wordt server-side gevalideerd in de API-routes.';



CREATE TABLE IF NOT EXISTS "public"."decision_assumptions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "decision_id" "uuid" NOT NULL,
    "tekst" "text" NOT NULL,
    "type" "text" DEFAULT 'overig'::"text",
    "bron_document_id" "uuid",
    "ai_gedetecteerd" boolean DEFAULT false,
    "status" "text" DEFAULT 'concept'::"text",
    "onzekerheid" "text",
    "evaluatiecriterium" "text",
    "aangemaakt_op" timestamp with time zone DEFAULT "now"(),
    "gewijzigd_door" "uuid",
    CONSTRAINT "decision_assumptions_onzekerheid_check" CHECK (("onzekerheid" = ANY (ARRAY['laag'::"text", 'middel'::"text", 'hoog'::"text"]))),
    CONSTRAINT "decision_assumptions_status_check" CHECK (("status" = ANY (ARRAY['concept'::"text", 'gevalideerd'::"text", 'gewijzigd'::"text", 'verwijderd'::"text"]))),
    CONSTRAINT "decision_assumptions_type_check" CHECK (("type" = ANY (ARRAY['macro'::"text", 'beleggingsinhoudelijk'::"text", 'risico'::"text", 'kosten'::"text", 'governance'::"text", 'overig'::"text"])))
);


ALTER TABLE "public"."decision_assumptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."decision_audit_snapshots" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "decision_id" "uuid" NOT NULL,
    "trigger_status" "text" NOT NULL,
    "snapshot" "jsonb" NOT NULL,
    "hash" "text" NOT NULL,
    "aangemaakt_op" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."decision_audit_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."decision_conditions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "decision_id" "uuid" NOT NULL,
    "voorwaarde" "text" NOT NULL,
    "eigenaar_naam" "text",
    "kpi" "text",
    "drempelwaarde" "text",
    "monitorfrequentie" "text",
    "deadline" "date",
    "heroverwegingstrigger" "text",
    "status" "text" DEFAULT 'open'::"text",
    "aangemaakt_op" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "decision_conditions_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'op_schema'::"text", 'afwijking'::"text", 'vervuld'::"text", 'overschreden'::"text"])))
);


ALTER TABLE "public"."decision_conditions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."decision_dissent" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "decision_id" "uuid" NOT NULL,
    "bestuurder_id" "uuid",
    "bestuurder_naam" "text" NOT NULL,
    "zichtbaarheid" "text" DEFAULT 'gedeelde_zorg'::"text" NOT NULL,
    "formeel_vastgesteld" boolean DEFAULT false,
    "standpunt" "text" NOT NULL,
    "argument" "text",
    "gekoppeld_risico_id" "uuid",
    "gekoppeld_aanname_id" "uuid",
    "gekoppeld_voorwaarde_id" "uuid",
    "aangemaakt_op" timestamp with time zone DEFAULT "now"(),
    "stemming_id" "uuid",
    CONSTRAINT "decision_dissent_zichtbaarheid_check" CHECK (("zichtbaarheid" = ANY (ARRAY['prive'::"text", 'gedeelde_zorg'::"text", 'formele_dissent'::"text", 'minderheidsnotitie'::"text"])))
);


ALTER TABLE "public"."decision_dissent" OWNER TO "postgres";


COMMENT ON TABLE "public"."decision_dissent" IS 'TENANT via decision_objects (T3-register). Beide policies dragen sinds 2026-07-31 een fondsclausule (reviewbevinding K-01); de strengere zichtbaarheidsregel per dissenttype blijft daar bovenop gelden.';



COMMENT ON COLUMN "public"."decision_dissent"."stemming_id" IS 'Optionele koppeling naar de stem waaruit deze dissent is ontstaan (tegen-stem met motivering).';



CREATE TABLE IF NOT EXISTS "public"."decision_evaluations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "decision_id" "uuid" NOT NULL,
    "geplande_datum" "date" NOT NULL,
    "uitgevoerd_op" timestamp with time zone,
    "verwachte_effecten" "text",
    "realisatie" "text",
    "afwijkingsanalyse" "text",
    "conclusie" "text",
    "lessons_learned" "text",
    "uitgevoerd_door" "uuid",
    "aangemaakt_op" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."decision_evaluations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."decision_objects" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "procedure_id" "uuid" NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "besluit_code" "text" NOT NULL,
    "titel" "text" NOT NULL,
    "besluitvraag" "text" NOT NULL,
    "aanleiding" "text",
    "scope" "text",
    "governance_orgaan" "text",
    "vertrouwelijkheid" "text" DEFAULT 'intern'::"text" NOT NULL,
    "complexiteit" "text" DEFAULT 'complicated'::"text" NOT NULL,
    "risiconiveau" "text" DEFAULT 'middel'::"text" NOT NULL,
    "mandaatgevoelig" boolean DEFAULT false NOT NULL,
    "toezichtgevoelig" boolean DEFAULT false NOT NULL,
    "beleidsafwijking" boolean DEFAULT false NOT NULL,
    "ai_risicoklasse" "text" DEFAULT 'laag'::"text" NOT NULL,
    "status" "text" DEFAULT 'concept'::"text" NOT NULL,
    "is_primary_decision" boolean DEFAULT true NOT NULL,
    "eigenaar_id" "uuid",
    "eigenaar_naam" "text",
    "template_versie" "text",
    "gewenste_besluitdatum" "date",
    "aangemaakt_op" timestamp with time zone DEFAULT "now"(),
    "laatst_gewijzigd" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "decision_objects_ai_risicoklasse_check" CHECK (("ai_risicoklasse" = ANY (ARRAY['laag'::"text", 'middel'::"text", 'hoog'::"text"]))),
    CONSTRAINT "decision_objects_complexiteit_check" CHECK (("complexiteit" = ANY (ARRAY['routine'::"text", 'complicated'::"text", 'complex'::"text"]))),
    CONSTRAINT "decision_objects_risiconiveau_check" CHECK (("risiconiveau" = ANY (ARRAY['laag'::"text", 'middel'::"text", 'hoog'::"text"]))),
    CONSTRAINT "decision_objects_status_check" CHECK (("status" = ANY (ARRAY['concept'::"text", 'in_onderbouwing'::"text", 'in_validatie'::"text", 'in_review'::"text", 'geagendeerd'::"text", 'in_bespreking'::"text", 'besloten'::"text", 'voorwaardelijk_besloten'::"text", 'afgewezen'::"text", 'aangehouden'::"text", 'geescaleerd'::"text", 'teruggezet'::"text", 'in_uitvoering'::"text", 'in_evaluatie'::"text", 'afgesloten'::"text", 'heropend'::"text", 'geannuleerd'::"text"]))),
    CONSTRAINT "decision_objects_vertrouwelijkheid_check" CHECK (("vertrouwelijkheid" = ANY (ARRAY['publiek'::"text", 'intern'::"text", 'vertrouwelijk'::"text", 'strikt_vertrouwelijk'::"text"])))
);


ALTER TABLE "public"."decision_objects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."decision_risks" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "decision_id" "uuid" NOT NULL,
    "risicomatrix_id" "uuid",
    "categorie" "text",
    "beschrijving" "text" NOT NULL,
    "impact" integer,
    "kans" integer,
    "eigenaar_naam" "text",
    "mitigatie" "text",
    "residual_risk" "text",
    "status" "text" DEFAULT 'open'::"text",
    "aangemaakt_op" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "decision_risks_categorie_check" CHECK (("categorie" = ANY (ARRAY['financieel'::"text", 'operationeel'::"text", 'juridisch'::"text", 'reputatie'::"text", 'liquiditeit'::"text", 'compliance'::"text", 'overig'::"text"]))),
    CONSTRAINT "decision_risks_impact_check" CHECK ((("impact" >= 1) AND ("impact" <= 5))),
    CONSTRAINT "decision_risks_kans_check" CHECK ((("kans" >= 1) AND ("kans" <= 5))),
    CONSTRAINT "decision_risks_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'gemitigeerd'::"text", 'geaccepteerd'::"text"])))
);


ALTER TABLE "public"."decision_risks" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."decision_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."decision_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."difference_judgements" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "finding_key" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "judgement" "text" NOT NULL,
    "rationale" "text",
    "evidence_ref" "text",
    "private" boolean DEFAULT true NOT NULL,
    "promoted_to_dossier" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "difference_judgements_judgement_check" CHECK (("judgement" = ANY (ARRAY['begrepen'::"text", 'twijfel'::"text", 'oneens'::"text", 'mis_info'::"text", 'risico'::"text", 'verklaard_geaccepteerd'::"text"])))
);


ALTER TABLE "public"."difference_judgements" OWNER TO "postgres";


COMMENT ON TABLE "public"."difference_judgements" IS 'Menselijke oordelen over vergelijkingsbevindingen (T7, voedt T10). Bevindings-agnostisch (finding_key is een generieke sleutel) zodat T10 vooruit kan. Auteur-scoped + private-aware RLS (besluit 0112-lijn): lezen als user_id=auth.uid() OF (private=false EN eigen fonds). Append-only — promotie (promoted_to_dossier) wordt in T10 een NIEUWE rij, geen UPDATE.';



CREATE TABLE IF NOT EXISTS "public"."document_agendapunten" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "document_id" "uuid" NOT NULL,
    "agendapunt_id" "uuid" NOT NULL,
    "vergadering_id" "uuid" NOT NULL,
    "aangemaakt_door" "uuid",
    "aangemaakt" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."document_agendapunten" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_chunks" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "document_id" "uuid",
    "chunk_index" integer NOT NULL,
    "tekst" "text" NOT NULL,
    "pagina" integer,
    "paragraaf" "text",
    "aangemaakt" timestamp with time zone DEFAULT "now"(),
    "embedding" "public"."vector"(1024),
    "embedding_model" "text",
    "procesmodel_id" "uuid",
    "procesinstantie_id" "uuid",
    "vergadering_id" "uuid",
    "agendapunt_id" "uuid",
    "documenttype" "text",
    "documentstatus" "text",
    "documentdatum" "date",
    "periode" "text",
    "bronstatus" "text",
    "geldig_vanaf" "date",
    "geldig_tot" "date",
    "notulen_segment_id" "uuid",
    "bibliotheek" "text",
    "bronorganisatie" "text",
    "normgewicht" "text",
    "extern_url" "text",
    "structuur_type" "text",
    "structuur_label" "text",
    "context_prefix" "text",
    "prefix_model" "text",
    "indexering_versie" "text",
    "zoek_vector" "tsvector" GENERATED ALWAYS AS ("to_tsvector"('"dutch"'::"regconfig", (COALESCE(("context_prefix" || ' '::"text"), ''::"text") || "tekst"))) STORED,
    "wettelijk_regime" "text"
);


ALTER TABLE "public"."document_chunks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_inzage" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "document_id" "uuid",
    "document_titel_snapshot" "text" NOT NULL,
    "fonds_id" "uuid",
    "gebruiker_id" "uuid",
    "gebruiker_naam" "text",
    "actie" "text" NOT NULL,
    "reden" "text",
    "aangemaakt" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "document_inzage_actie_check" CHECK (("actie" = ANY (ARRAY['inzage'::"text", 'download'::"text", 'gedeactiveerd'::"text", 'gereactiveerd'::"text"])))
);


ALTER TABLE "public"."document_inzage" OWNER TO "postgres";


COMMENT ON TABLE "public"."document_inzage" IS 'HYBRIDE (T3-register). Leespolicy "fonds inzage lezen" = eigen fonds OR (fonds_id IS NULL én het document is generiek). Schrijven: eigen logregel (gebruiker_id = auth.uid()) EN gekoppeld aan een onder RLS zichtbaar document EN eigen fonds (of NULL bij een generiek document). Aangescherpt 2026-07-31 (reviewbevinding H-02).';



CREATE TABLE IF NOT EXISTS "public"."document_metadata_log" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "document_id" "uuid",
    "document_titel_snapshot" "text",
    "fonds_id" "uuid",
    "gewijzigd_door" "uuid",
    "gewijzigd_door_naam" "text",
    "gewijzigd_op" timestamp with time zone DEFAULT "now"(),
    "veld_naam" "text" NOT NULL,
    "oude_waarde" "text",
    "nieuwe_waarde" "text",
    "wijzig_reden" "text",
    "wijzig_type" "text",
    "rag_impact" boolean DEFAULT false,
    "hash" "text",
    "tijdstip" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."document_metadata_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."document_metadata_log" IS 'HYBRIDE + APPEND-ONLY (T3-register). Leespolicy = eigen fonds OR (fonds_id IS NULL én het document is generiek). Schrijven: gewijzigd_door = auth.uid() EN gekoppeld aan een onder RLS zichtbaar document EN eigen fonds (of NULL bij een generiek document). De sha256-hashketen borgt onveranderlijkheid, niet de herkomst — daarvoor is deze WITH CHECK nodig. Aangescherpt 2026-07-31 (reviewbevinding H-02).';



COMMENT ON COLUMN "public"."document_metadata_log"."document_id" IS 'Verwijzing naar het gewijzigde document. Bewust GEEN FK (besluit 0024): het append-only auditlog overleeft een hard-delete van het document; de id blijft als historische verwijzing staan, ook als het document niet meer bestaat.';



CREATE TABLE IF NOT EXISTS "public"."document_metadata_review_queue" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "document_id" "uuid" NOT NULL,
    "reden" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "aangemaakt" timestamp with time zone DEFAULT "now"(),
    "beoordeeld_door" "uuid",
    "beoordeeld_op" timestamp with time zone,
    "opmerking" "text",
    CONSTRAINT "document_metadata_review_queue_reden_check" CHECK (("reden" = ANY (ARRAY['backfill'::"text", 'ontbrekende_metadata'::"text", 'onzekere_status'::"text", 'handmatig'::"text"]))),
    CONSTRAINT "document_metadata_review_queue_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'in_behandeling'::"text", 'gecontroleerd'::"text", 'afgewezen'::"text"])))
);


ALTER TABLE "public"."document_metadata_review_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_procesinstanties" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "document_id" "uuid" NOT NULL,
    "procesinstantie_id" "uuid" NOT NULL,
    "aangemaakt_door" "uuid",
    "aangemaakt" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."document_procesinstanties" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."documenten" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid",
    "bibliotheek" "text" NOT NULL,
    "bron" "text" NOT NULL,
    "titel" "text" NOT NULL,
    "bestandsnaam" "text",
    "paginas" integer,
    "gepubliceerd" "date",
    "geindexeerd" boolean DEFAULT false,
    "opgeslagen_door" "uuid",
    "aangemaakt" timestamp with time zone DEFAULT "now"(),
    "agendapunt_id" "uuid",
    "samenvatting_ai" "text",
    "samengevat_op" timestamp with time zone,
    "vergadering_id" "uuid",
    "bestandstype" "text" DEFAULT 'pdf'::"text" NOT NULL,
    "opslag_pad" "text",
    "actief" boolean DEFAULT true NOT NULL,
    "gedeactiveerd_op" timestamp with time zone,
    "gedeactiveerd_door" "uuid",
    "deactivatie_reden" "text",
    "procesinstantie_id" "uuid",
    "context" "text" DEFAULT 'algemeen'::"text" NOT NULL,
    "documenttype" "text",
    "status" "text" DEFAULT 'concept'::"text",
    "bronstatus" "text",
    "documentdatum" "date",
    "geldig_vanaf" "date",
    "geldig_tot" "date",
    "vervangt_document_id" "uuid",
    "vervangen_door_document_id" "uuid",
    "metadata_te_controleren" boolean DEFAULT false NOT NULL,
    "metadata_review_status" "text" DEFAULT 'niet_nodig'::"text" NOT NULL,
    "metadata_gecontroleerd_door" "uuid",
    "metadata_gecontroleerd_op" timestamp with time zone,
    "bronorganisatie" "text",
    "extern_url" "text",
    "normgewicht" "text",
    "ocr_toegepast" boolean DEFAULT false NOT NULL,
    "ocr_engine" "text",
    "toepassingsgebied" "text",
    "regelingstype" "text",
    "doelgroep" "text",
    "thema" "text",
    "statusinterpretatie" "text",
    "verwerkingsstatus" "text",
    "scan_resultaat" "jsonb",
    "bestand_hash" "text",
    "mime_gedetecteerd" "text",
    "eigenaar" "text",
    "volgende_review" "date",
    "versie" "text",
    "ai_ondersteund_voorbereid" boolean DEFAULT false NOT NULL,
    "wettelijk_regime" "text",
    CONSTRAINT "documenten_agendapunt_vergadering_check" CHECK ((("agendapunt_id" IS NULL) OR ("vergadering_id" IS NOT NULL))),
    CONSTRAINT "documenten_bestandstype_check" CHECK (("bestandstype" = ANY (ARRAY['pdf'::"text", 'docx'::"text", 'pptx'::"text", 'xlsx'::"text"]))),
    CONSTRAINT "documenten_bibliotheek_check" CHECK (("bibliotheek" = ANY (ARRAY['generiek'::"text", 'fonds'::"text"]))),
    CONSTRAINT "documenten_bron_check" CHECK (("bron" = ANY (ARRAY['DNB'::"text", 'AFM'::"text", 'Pensioenfederatie'::"text", 'Intern'::"text", 'Extern'::"text"]))),
    CONSTRAINT "documenten_bronstatus_check" CHECK ((("bronstatus" IS NULL) OR ("bronstatus" = ANY (ARRAY['actief'::"text", 'historisch'::"text", 'uitgesloten'::"text", 'actief_na_vaststelling'::"text"])))),
    CONSTRAINT "documenten_context_check" CHECK (("context" = ANY (ARRAY['dossier'::"text", 'vergadering'::"text", 'algemeen'::"text"]))),
    CONSTRAINT "documenten_context_dossier_check" CHECK ((("context" <> 'dossier'::"text") OR ("procesinstantie_id" IS NOT NULL))),
    CONSTRAINT "documenten_context_vergadering_check" CHECK ((("context" <> 'vergadering'::"text") OR ("vergadering_id" IS NOT NULL))),
    CONSTRAINT "documenten_documenttype_check" CHECK ((("documenttype" IS NULL) OR ("documenttype" = ANY (ARRAY['beleid'::"text", 'besluit'::"text", 'besluitdocument'::"text", 'besluitregistratie'::"text", 'bestuursvoorstel'::"text", 'notulen'::"text", 'advies'::"text", 'memo'::"text", 'analyse'::"text", 'rapportage'::"text", 'bijlage'::"text", 'overig'::"text"])))),
    CONSTRAINT "documenten_generiek_namespace_check" CHECK (((("bibliotheek" = 'generiek'::"text") AND ("fonds_id" IS NULL)) OR (("bibliotheek" = 'fonds'::"text") AND ("fonds_id" IS NOT NULL)))),
    CONSTRAINT "documenten_normgewicht_check" CHECK ((("normgewicht" IS NULL) OR ("normgewicht" = ANY (ARRAY['bindend'::"text", 'toezichtverwachting'::"text", 'sector_guidance'::"text", 'informatief'::"text", 'onbekend'::"text"])))),
    CONSTRAINT "documenten_regelingstype_check" CHECK ((("regelingstype" IS NULL) OR ("regelingstype" = ANY (ARRAY['FTK'::"text", 'SPR'::"text", 'FPR'::"text", 'CVP'::"text", 'algemeen'::"text"])))),
    CONSTRAINT "documenten_review_status_check" CHECK (("metadata_review_status" = ANY (ARRAY['niet_nodig'::"text", 'te_controleren'::"text", 'gecontroleerd'::"text", 'afgewezen'::"text"]))),
    CONSTRAINT "documenten_status_check" CHECK ((("status" IS NULL) OR ("status" = ANY (ARRAY['concept'::"text", 'vastgesteld'::"text", 'van_kracht'::"text", 'historisch'::"text", 'gearchiveerd'::"text"])))),
    CONSTRAINT "documenten_verwerkingsstatus_check" CHECK ((("verwerkingsstatus" IS NULL) OR ("verwerkingsstatus" = ANY (ARRAY['ontvangen'::"text", 'gevalideerd'::"text", 'gescand'::"text", 'extractie'::"text", 'chunking'::"text", 'embedding'::"text", 'beschikbaar'::"text", 'geweigerd'::"text", 'gequarantineerd'::"text", 'mislukt'::"text"])))),
    CONSTRAINT "documenten_wettelijk_regime_check" CHECK ((("wettelijk_regime" IS NULL) OR ("wettelijk_regime" = ANY (ARRAY['pw'::"text", 'wvb'::"text", 'beide'::"text", 'algemeen'::"text"]))))
);


ALTER TABLE "public"."documenten" OWNER TO "postgres";


COMMENT ON TABLE "public"."documenten" IS 'HYBRIDE (T3-register). Leespolicy "documenten select" = eigen fonds OR bibliotheek=''generiek''. De generieke bibliotheek is fondsoverstijgend leesbaar (gedeelde kennisbasis); fonds-documenten strikt geïsoleerd. Inserts alleen bibliotheek=''fonds'' + eigen fonds (WITH CHECK).';



COMMENT ON COLUMN "public"."documenten"."ocr_toegepast" IS 'True als de inhoud via OCR-fallback is verkregen i.p.v. de PDF-tekstlaag (besluit 0020).';



COMMENT ON COLUMN "public"."documenten"."ocr_engine" IS 'OCR-engine indien toegepast bij extractie, bv. mistral:mistral-ocr-latest. NULL = tekstlaag gebruikt (geen OCR).';



COMMENT ON COLUMN "public"."documenten"."eigenaar" IS 'T6/§7: functioneel of team-eigenaar van een generieke bron (vrije tekst, geen persoonsnaam/FK). Alleen zinvol voor bibliotheek=''generiek''.';



COMMENT ON COLUMN "public"."documenten"."volgende_review" IS 'T6/§7: datum eerstvolgende inhoudelijke review van een generieke bron. Handhaving van periodieke review is T10; T6 levert alleen het veld.';



COMMENT ON COLUMN "public"."documenten"."versie" IS 'T6/§7: menselijk leesbaar versielabel (bv. ''2024.1''). Puur beheerkenmerk; de VERSIE-LINEAGE loopt onveranderd via vervangt_/vervangen_door_document_id (self-FK, decisions/0022).';



COMMENT ON COLUMN "public"."documenten"."ai_ondersteund_voorbereid" IS 'T2/B-6 — zelfverklaarde markering dat dit stuk AI-ondersteund is voorbereid (bureau-stand). Zichtbaar voor het bestuur op de agendapuntkaart. Zetten valt onder documents.metadata.update; het is een herkomstmarkering, geen besluit.';



CREATE TABLE IF NOT EXISTS "public"."expertises" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid",
    "naam" "text" NOT NULL,
    "omschrijving" "text",
    "actief" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0,
    "gekopieerd_van_id" "uuid",
    "aangemaakt" timestamp with time zone DEFAULT "now"(),
    "bijgewerkt" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."expertises" OWNER TO "postgres";


COMMENT ON TABLE "public"."expertises" IS 'HYBRIDE (T3-register). Leespolicy "lees expertises" = fonds_id IS NULL (template) OR eigen fonds. Zie public.gremia voor het patroon.';



CREATE TABLE IF NOT EXISTS "public"."extraction_run" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "document_id" "uuid" NOT NULL,
    "model" "text" NOT NULL,
    "prompt_version" "text" NOT NULL,
    "extractor_version" "text" NOT NULL,
    "catalog_version" "text" NOT NULL,
    "status" "text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    CONSTRAINT "extraction_run_status_check" CHECK (("status" = ANY (ARRAY['gestart'::"text", 'geslaagd'::"text", 'mislukt'::"text"])))
);


ALTER TABLE "public"."extraction_run" OWNER TO "postgres";


COMMENT ON TABLE "public"."extraction_run" IS 'Reproduceerbaarheid van de extractie (T7): model/prompt/versie/catalogus-snapshot per run; elke semantic_unit hangt via extraction_run_id aan een run. Append-only (geen UPDATE/DELETE) — T8 schrijft de rij ÉÉN keer bij afronding.';



CREATE TABLE IF NOT EXISTS "public"."fonds_config_log" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "gebruiker_id" "uuid",
    "gebruiker_naam" "text",
    "config_type" "text" NOT NULL,
    "config_sleutel" "text" NOT NULL,
    "oude_waarde" "jsonb",
    "nieuwe_waarde" "jsonb",
    "versie" integer NOT NULL,
    "aangemaakt" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "fonds_config_log_config_type_check" CHECK (("config_type" = ANY (ARRAY['theming'::"text", 'manifest'::"text", 'flag'::"text", 'override'::"text"])))
);


ALTER TABLE "public"."fonds_config_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."fonds_config_log" IS 'TENANT + APPEND-ONLY (T8-config-audit). Onveranderlijk auditspoor van elke config-wijziging: wie/wanneer/fonds (server-side afgeleid)/config_type/sleutel/oud→nieuw/versie. Triggers blokkeren UPDATE/DELETE. Lezen = eigen fonds; insert = eigen fonds. Hergebruikt fn_log_append_only (geen tweede logmechanisme).';



CREATE TABLE IF NOT EXISTS "public"."fonds_content_overrides" (
    "fonds_id" "uuid" NOT NULL,
    "sleutel" "text" NOT NULL,
    "waarde" "text" NOT NULL,
    "versie" integer DEFAULT 1 NOT NULL,
    "bijgewerkt" timestamp with time zone DEFAULT "now"() NOT NULL,
    "bijgewerkt_door" "uuid"
);


ALTER TABLE "public"."fonds_content_overrides" OWNER TO "postgres";


COMMENT ON TABLE "public"."fonds_content_overrides" IS 'TENANT (T8-config). Minimale per-fonds copy-overrides (sleutel→waarde). Volledige redactie-/publicatieworkflow = T10. Lezen = eigen fonds; schrijven = voorzitter/beheerder.';



CREATE TABLE IF NOT EXISTS "public"."fonds_feature_flags" (
    "fonds_id" "uuid" NOT NULL,
    "flag_key" "text" NOT NULL,
    "waarde" "jsonb" NOT NULL,
    "versie" integer DEFAULT 1 NOT NULL,
    "bijgewerkt" timestamp with time zone DEFAULT "now"() NOT NULL,
    "bijgewerkt_door" "uuid"
);


ALTER TABLE "public"."fonds_feature_flags" OWNER TO "postgres";


COMMENT ON TABLE "public"."fonds_feature_flags" IS 'TENANT (T8-config). Sleutel→waarde feature flags per fonds (waarde jsonb). Generalisatie van fonds_instellingen; hybride_zoeken is de eerste gemigreerde flag. Env-default blijft fallback. Lezen = eigen fonds; schrijven = voorzitter/beheerder.';



CREATE TABLE IF NOT EXISTS "public"."fonds_instellingen" (
    "fonds_id" "uuid" NOT NULL,
    "hybride_zoeken" boolean DEFAULT false NOT NULL,
    "bijgewerkt" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."fonds_instellingen" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fonds_klantbeeld_cohort" (
    "fonds_id" "uuid" NOT NULL,
    "leeftijd" integer NOT NULL,
    "aantal" integer DEFAULT 0 NOT NULL,
    "actief_p" numeric DEFAULT 0 NOT NULL,
    "slapend_p" numeric DEFAULT 0 NOT NULL,
    "uitkerend_p" numeric DEFAULT 0 NOT NULL,
    "salaris" numeric DEFAULT 0 NOT NULL,
    "maand_premie" numeric DEFAULT 0 NOT NULL,
    "maand_uitkering" numeric DEFAULT 0 NOT NULL,
    "invaar_kapitaal" numeric DEFAULT 0 NOT NULL,
    "doel_op67" numeric DEFAULT 0 NOT NULL,
    "over_weight" numeric DEFAULT 0 NOT NULL,
    "bescherm_weight" numeric DEFAULT 0 NOT NULL,
    "duration_jr" numeric DEFAULT 0 NOT NULL,
    "uitvoering_mult" numeric DEFAULT 1 NOT NULL,
    "bijgewerkt" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "fonds_klantbeeld_cohort_leeftijd_check" CHECK ((("leeftijd" >= 0) AND ("leeftijd" <= 120)))
);


ALTER TABLE "public"."fonds_klantbeeld_cohort" OWNER TO "postgres";


COMMENT ON TABLE "public"."fonds_klantbeeld_cohort" IS 'TENANT (T11). Cohort-AGGREGAAT per fonds/leeftijd — GEEN deelnemer-PII, geen individu-rijen. aantal = populatie_n voor kleine-populatie-suppressie (n<10). Reproduceert de klantbeeld-visuals deterministisch. Lezen = eigen fonds; schrijven = eigen fonds + voorzitter/beheerder (WITH CHECK).';



CREATE TABLE IF NOT EXISTS "public"."fonds_module_manifest" (
    "fonds_id" "uuid" NOT NULL,
    "module_key" "text" NOT NULL,
    "actief" boolean DEFAULT true NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "versie" integer DEFAULT 1 NOT NULL,
    "bijgewerkt" timestamp with time zone DEFAULT "now"() NOT NULL,
    "bijgewerkt_door" "uuid"
);


ALTER TABLE "public"."fonds_module_manifest" OWNER TO "postgres";


COMMENT ON TABLE "public"."fonds_module_manifest" IS 'TENANT (T8-config). Per fonds welke modules beschikbaar zijn. module_key wordt getoetst tegen de code-registry (lib/module-registry.ts); onbekend = genegeerd = niet beschikbaar. Lezen = eigen fonds; schrijven = eigen fonds + voorzitter/beheerder. BESCHIKBAARHEID, GEEN AUTORISATIE: capability-/RLS-gate blijft gelden.';



CREATE TABLE IF NOT EXISTS "public"."fonds_stuurinfo_kpi" (
    "fonds_id" "uuid" NOT NULL,
    "kpi_key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "waarde" numeric,
    "delta" numeric,
    "eenheid" "text" DEFAULT 'getal'::"text" NOT NULL,
    "toelichting" "text",
    "volgorde" integer DEFAULT 0 NOT NULL,
    "populatie_n" integer,
    "bijgewerkt" timestamp with time zone DEFAULT "now"() NOT NULL,
    "periode" "text" NOT NULL,
    "invoer_bron" "text",
    CONSTRAINT "fonds_stuurinfo_kpi_invoer_bron_check" CHECK ((("invoer_bron" IS NULL) OR ("invoer_bron" = ANY (ARRAY['handmatig'::"text", 'upload'::"text"]))))
);


ALTER TABLE "public"."fonds_stuurinfo_kpi" OWNER TO "postgres";


COMMENT ON TABLE "public"."fonds_stuurinfo_kpi" IS 'TENANT (T11). Headline stuurinformatie-KPI''s per fonds (aggregaat, GEEN deelnemer-PII). populatie_n draagt de celgrootte voor kleine-populatie-suppressie (n<10, app-leeslaag). Lezen = eigen fonds; schrijven = eigen fonds + voorzitter/beheerder (WITH CHECK). Beschikbaarheid/autorisatie blijven manifest + requireCapability().';



CREATE TABLE IF NOT EXISTS "public"."fonds_stuurinfo_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "periode" "text" NOT NULL,
    "tabel" "text" NOT NULL,
    "veld_key" "text" NOT NULL,
    "oude_waarde" "jsonb",
    "nieuwe_waarde" "jsonb" NOT NULL,
    "invoer_bron" "text",
    "gebruiker_id" "uuid",
    "gebruiker_naam" "text",
    "aangemaakt" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "fonds_stuurinfo_log_tabel_check" CHECK (("tabel" = ANY (ARRAY['periode'::"text", 'kpi'::"text", 'reeks'::"text", 'reserve'::"text"])))
);


ALTER TABLE "public"."fonds_stuurinfo_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."fonds_stuurinfo_log" IS 'TENANT (T14). Append-only auditspoor van stuurinformatie-invoer/upload: wie, wat, wanneer, oud→nieuw, bron (handmatig/upload; null = seed/migratie). Gevuld door AFTER-trigger fn_fonds_stuurinfo_capture op de vier fonds_stuurinfo_*-datatabellen. Nooit UPDATE/DELETE (fn_log_append_only). Lezen = eigen fonds; insert = eigen fonds + voorzitter/beheerder.';



CREATE TABLE IF NOT EXISTS "public"."fonds_stuurinfo_periode" (
    "fonds_id" "uuid" NOT NULL,
    "periode" "text" NOT NULL,
    "peildatum" "date" NOT NULL,
    "bron" "text" DEFAULT 'seed_synthetisch'::"text" NOT NULL,
    "volgorde" integer DEFAULT 0 NOT NULL,
    "bijgewerkt" timestamp with time zone DEFAULT "now"() NOT NULL,
    "invoer_bron" "text",
    CONSTRAINT "fonds_stuurinfo_periode_invoer_bron_check" CHECK ((("invoer_bron" IS NULL) OR ("invoer_bron" = ANY (ARRAY['handmatig'::"text", 'upload'::"text"])))),
    CONSTRAINT "fonds_stuurinfo_periode_periode_format" CHECK (("periode" ~ '^\d{4}Q[1-4]$'::"text"))
);


ALTER TABLE "public"."fonds_stuurinfo_periode" OWNER TO "postgres";


COMMENT ON TABLE "public"."fonds_stuurinfo_periode" IS 'TENANT (T13). Periode-registry voor stuurinformatie: welke rapportageperiodes bestaan per fonds (periode, peildatum, bron, volgorde). Bron van waarheid voor de paginabrede periodefilter; de invoerlaag (vervolgticket) bouwt hierop voort. Lezen = eigen fonds; schrijven = eigen fonds + voorzitter/beheerder (WITH CHECK).';



CREATE TABLE IF NOT EXISTS "public"."fonds_stuurinfo_reeks" (
    "fonds_id" "uuid" NOT NULL,
    "reeks_key" "text" NOT NULL,
    "punt_key" "text" NOT NULL,
    "label" "text",
    "volgorde" integer DEFAULT 0 NOT NULL,
    "waarde" numeric,
    "delta" numeric,
    "kleur" "text",
    "populatie_n" integer,
    "bijgewerkt" timestamp with time zone DEFAULT "now"() NOT NULL,
    "periode" "text" NOT NULL,
    "invoer_bron" "text",
    CONSTRAINT "fonds_stuurinfo_reeks_invoer_bron_check" CHECK ((("invoer_bron" IS NULL) OR ("invoer_bron" = ANY (ARRAY['handmatig'::"text", 'upload'::"text"]))))
);


ALTER TABLE "public"."fonds_stuurinfo_reeks" OWNER TO "postgres";


COMMENT ON TABLE "public"."fonds_stuurinfo_reeks" IS 'TENANT (T11). Long-format stuurinformatie-reeksen per fonds (trend/balans/deelnemer-status; aggregaat, GEEN deelnemer-PII). populatie_n draagt de celgrootte voor kleine-populatie-suppressie. Lezen = eigen fonds; schrijven = eigen fonds + voorzitter/beheerder (WITH CHECK).';



CREATE TABLE IF NOT EXISTS "public"."fonds_stuurinfo_reserve" (
    "fonds_id" "uuid" NOT NULL,
    "periode" "text" NOT NULL,
    "reserve_key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "stand" numeric NOT NULL,
    "pct_basis" "text",
    "pct_waarde" numeric,
    "ondergrens" numeric,
    "bovengrens" numeric,
    "volgorde" integer DEFAULT 0 NOT NULL,
    "bijgewerkt" timestamp with time zone DEFAULT "now"() NOT NULL,
    "invoer_bron" "text",
    CONSTRAINT "fonds_stuurinfo_reserve_invoer_bron_check" CHECK ((("invoer_bron" IS NULL) OR ("invoer_bron" = ANY (ARRAY['handmatig'::"text", 'upload'::"text"]))))
);


ALTER TABLE "public"."fonds_stuurinfo_reserve" OWNER TO "postgres";


COMMENT ON TABLE "public"."fonds_stuurinfo_reserve" IS 'TENANT (T13). Reservestanden per fonds/periode met optionele ABTN-band (ondergrens/bovengrens in dezelfde eenheid als pct_waarde). Stoplichtstatus wordt in de leeslaag AFGELEID (geen band = monitoring) — bewust geen status-kolom. Fonds-aggregaat, GEEN deelnemer-PII. Lezen = eigen fonds; schrijven = eigen fonds + voorzitter/beheerder (WITH CHECK).';



CREATE TABLE IF NOT EXISTS "public"."fonds_theming" (
    "fonds_id" "uuid" NOT NULL,
    "tokens" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "versie" integer DEFAULT 1 NOT NULL,
    "bijgewerkt" timestamp with time zone DEFAULT "now"() NOT NULL,
    "bijgewerkt_door" "uuid"
);


ALTER TABLE "public"."fonds_theming" OWNER TO "postgres";


COMMENT ON TABLE "public"."fonds_theming" IS 'TENANT (T8-config). Design-tokens per fonds (jsonb, allowlist-gevalideerd; logo als storage-referentie, geen binaries). Lezen = eigen fonds (alle leden); schrijven = eigen fonds + rol voorzitter/beheerder (WITH CHECK). Fail-safe: geen rij = generiek default-thema uit code. Cosmetisch, geen securitygrens.';



CREATE TABLE IF NOT EXISTS "public"."fondsen" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "naam" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "aangemaakt" timestamp with time zone DEFAULT "now"(),
    "fondstype" "text",
    "primair_wettelijk_regime" "text",
    CONSTRAINT "fondsen_fondstype_check" CHECK ((("fondstype" IS NULL) OR ("fondstype" = ANY (ARRAY['bedrijfstak'::"text", 'onderneming'::"text", 'beroeps'::"text", 'apf'::"text", 'algemeen'::"text"])))),
    CONSTRAINT "fondsen_primair_wettelijk_regime_check" CHECK ((("primair_wettelijk_regime" IS NULL) OR ("primair_wettelijk_regime" = ANY (ARRAY['pw'::"text", 'wvb'::"text", 'beide'::"text", 'algemeen'::"text"]))))
);


ALTER TABLE "public"."fondsen" OWNER TO "postgres";


COMMENT ON TABLE "public"."fondsen" IS 'GLOBAAL (T3-register). Leespolicy "fondsen lezen" = using(true): de fondsenlijst is voor elke ingelogde gebruiker leesbaar (tenant-keuze/host-resolutie). Bevat geen tenant-inhoud. Schrijven gebeurt platform-/service-role-kant.';



CREATE TABLE IF NOT EXISTS "public"."gesprekken" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "gebruiker_id" "uuid" NOT NULL,
    "fonds_id" "uuid",
    "titel" "text",
    "berichten" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "gearchiveerd" boolean DEFAULT false NOT NULL,
    "aangemaakt" timestamp with time zone DEFAULT "now"(),
    "bijgewerkt" timestamp with time zone DEFAULT "now"(),
    "document_scope" "jsonb",
    "actieve_antwoordmodus" "text"
);


ALTER TABLE "public"."gesprekken" OWNER TO "postgres";


COMMENT ON COLUMN "public"."gesprekken"."document_scope" IS 'Actieve documentscope van het gesprek: {type, document_ids[], titels[], gezet_op}. NULL = hele bibliotheek.';



COMMENT ON COLUMN "public"."gesprekken"."actieve_antwoordmodus" IS 'Door de gebruiker vastgezette antwoordmodus van het gesprek (feitelijk|bronoverzicht|historisch|duiding|besluitrijpheid|sparring|persoonlijke_voorbereiding). NULL = auto-detectie per vraag.';



CREATE TABLE IF NOT EXISTS "public"."governance_audit_grants" (
    "gebruiker_id" "uuid" NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "capability" "text" NOT NULL,
    "toegekend_door" "uuid",
    "toegekend_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    "geldig_van" timestamp with time zone,
    "geldig_tot" timestamp with time zone,
    "motivering" "text",
    CONSTRAINT "governance_audit_grants_capability_check" CHECK (("capability" = ANY (ARRAY['governance_audit_read'::"text", 'governance_audit_read_sources'::"text", 'governance_redacties_read'::"text"])))
);


ALTER TABLE "public"."governance_audit_grants" OWNER TO "postgres";


COMMENT ON TABLE "public"."governance_audit_grants" IS 'Deny-by-default: RLS staat aan en er is BEWUST geen policy. Uitsluitend leesbaar binnen mag_audit()/mag_audit_bronnen()/mag_audit_redacties().';



CREATE TABLE IF NOT EXISTS "public"."governance_audit_inzage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "gebruiker_id" "uuid" NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "tijdstip" timestamp with time zone DEFAULT "now"() NOT NULL,
    "scope" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "bronniveau" boolean DEFAULT false NOT NULL,
    "motivering" "text",
    CONSTRAINT "motivering_bij_bronniveau" CHECK ((("bronniveau" = false) OR ("motivering" IS NOT NULL)))
);


ALTER TABLE "public"."governance_audit_inzage" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."governance_events" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "decision_id" "uuid",
    "event_type" "text" NOT NULL,
    "actor_id" "uuid",
    "actor_naam" "text",
    "object_type" "text",
    "object_id" "uuid",
    "oude_waarde" "jsonb",
    "nieuwe_waarde" "jsonb",
    "reden" "text",
    "hash" "text",
    "tijdstip" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."governance_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."governance_export_log" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "gebruiker_id" "uuid",
    "gebruiker_naam" "text",
    "fonds_id" "uuid",
    "gesprek_audit_id" "uuid",
    "taak" "text" DEFAULT 'stukvoorbereiding'::"text" NOT NULL,
    "stuksoort" "text",
    "promptvariant" "text",
    "bronnen" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "aangemaakt" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."governance_export_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."governance_redacties" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "uitgevoerd_door" "uuid",
    "uitgevoerd_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    "request_id" "uuid" NOT NULL,
    "aanleiding" "text" NOT NULL,
    "aantal_regels" integer DEFAULT 0 NOT NULL,
    "scope" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "motivering" "text",
    CONSTRAINT "governance_redacties_aanleiding_check" CHECK (("aanleiding" = ANY (ARRAY['gesprek_verwijderd'::"text", 'retentie'::"text", 'betrokkenenverzoek'::"text", 'beheerinterventie'::"text"]))),
    CONSTRAINT "motivering_bij_interventie" CHECK ((("aanleiding" <> 'beheerinterventie'::"text") OR ("motivering" IS NOT NULL)))
);


ALTER TABLE "public"."governance_redacties" OWNER TO "postgres";


COMMENT ON TABLE "public"."governance_redacties" IS 'Append-only tegenhanger van elke verwijdering van chatinhoud. Legt vast DAT er is verwijderd, door wie en met welke aanleiding — nooit WAT er stond.';



CREATE TABLE IF NOT EXISTS "public"."gremia" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid",
    "naam" "text" NOT NULL,
    "type" "text",
    "omschrijving" "text",
    "actief" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0,
    "is_template" boolean GENERATED ALWAYS AS (("fonds_id" IS NULL)) STORED,
    "gekopieerd_van_id" "uuid",
    "aangemaakt" timestamp with time zone DEFAULT "now"(),
    "bijgewerkt" timestamp with time zone DEFAULT "now"(),
    "categorie" "text",
    CONSTRAINT "gremia_categorie_check" CHECK ((("categorie" IS NULL) OR ("categorie" = ANY (ARRAY['fondsorgaan'::"text", 'bestuurscommissie'::"text", 'extern_ketenpartner'::"text"])))),
    CONSTRAINT "gremia_type_check" CHECK (("type" = ANY (ARRAY['besluitvormend'::"text", 'adviserend'::"text", 'toezichthoudend'::"text", 'uitvoerend'::"text"])))
);


ALTER TABLE "public"."gremia" OWNER TO "postgres";


COMMENT ON TABLE "public"."gremia" IS 'HYBRIDE (T3-register). Leespolicy "lees gremia" = fonds_id IS NULL (template) OR eigen fonds. Template-rijen (fonds_id NULL) zijn fondsoverstijgend leesbaar; fonds-eigen rijen zijn strikt geïsoleerd. Schrijven "schrijf gremia" is eigen-fonds met WITH CHECK.';



CREATE TABLE IF NOT EXISTS "public"."kritische_focusgebieden" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid",
    "naam" "text" NOT NULL,
    "omschrijving" "text",
    "actief" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0,
    "gekopieerd_van_id" "uuid",
    "aangemaakt" timestamp with time zone DEFAULT "now"(),
    "bijgewerkt" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."kritische_focusgebieden" OWNER TO "postgres";


COMMENT ON TABLE "public"."kritische_focusgebieden" IS 'HYBRIDE (T3-register). Leespolicy "lees focusgebieden" = fonds_id IS NULL (template) OR eigen fonds. Zie public.gremia voor het patroon.';



CREATE TABLE IF NOT EXISTS "public"."notificaties" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "ontvanger_id" "uuid" NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "gerelateerd_aan_type" "text",
    "gerelateerd_aan_id" "uuid",
    "actor_id" "uuid",
    "actor_naam" "text",
    "aangemaakt" timestamp with time zone DEFAULT "now"(),
    "gelezen_op" timestamp with time zone,
    CONSTRAINT "notificaties_type_check" CHECK (("type" = ANY (ARRAY['inbreng_geplaatst'::"text", 'ai_validatie_wacht'::"text", 'procedure_afgerond'::"text", 'besluit_geregistreerd'::"text", 'dissent_formeel_vastgelegd'::"text", 'agendapunt_gewijzigd'::"text", 'agendapunt_verplaatst'::"text", 'agendapunt_verwijderd'::"text", 'stemronde_geopend'::"text", 'volmachtstem_uitgebracht'::"text", 'stemronde_gesloten'::"text", 'stemronde_ingetrokken'::"text"])))
);


ALTER TABLE "public"."notificaties" OWNER TO "postgres";


COMMENT ON TABLE "public"."notificaties" IS 'In-app notificaties per gebruiker. Geen e-mail. RLS strict op ontvanger_id.';



COMMENT ON COLUMN "public"."notificaties"."payload" IS 'jsonb met type-specifieke velden: bv. {agendapunt_titel, actor_naam, vergadering_id} voor inbreng_geplaatst.';



COMMENT ON COLUMN "public"."notificaties"."gerelateerd_aan_id" IS 'Doelwit van de deeplink. UI gebruikt (gerelateerd_aan_type, id) om de juiste URL te bouwen.';



CREATE TABLE IF NOT EXISTS "public"."notulen_segmenten" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "document_id" "uuid" NOT NULL,
    "vergadering_id" "uuid" NOT NULL,
    "agendapunt_id" "uuid",
    "fonds_id" "uuid" NOT NULL,
    "segment_index" integer NOT NULL,
    "titel" "text",
    "tekst" "text" NOT NULL,
    "bevestigd" boolean DEFAULT false NOT NULL,
    "bevestigd_door" "uuid",
    "bevestigd_op" timestamp with time zone,
    "aangemaakt" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notulen_segmenten" OWNER TO "postgres";


COMMENT ON TABLE "public"."notulen_segmenten" IS 'Increment D — half-automatische notulensegmenten per agendapunt. Alleen bevestigd=true wordt geïndexeerd (document_chunks) en door de AI als agendapuntbron gebruikt.';



CREATE TABLE IF NOT EXISTS "public"."organisatie_profielen" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "organisatietype" "text",
    "uitvoerende_partijen" "text",
    "omvang" "text",
    "kernfeiten" "text",
    "missie" "text",
    "visie" "text",
    "strategische_speerpunten" "text",
    "risicohouding" "text",
    "peildatum" "date",
    "bijgewerkt_door" "text",
    "bijgewerkt_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    "aangemaakt_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organisatie_profielen_missie_check" CHECK ((("missie" IS NULL) OR ("char_length"("missie") <= 600))),
    CONSTRAINT "organisatie_profielen_risicohouding_check" CHECK ((("risicohouding" IS NULL) OR ("char_length"("risicohouding") <= 600))),
    CONSTRAINT "organisatie_profielen_strategische_speerpunten_check" CHECK ((("strategische_speerpunten" IS NULL) OR ("char_length"("strategische_speerpunten") <= 600))),
    CONSTRAINT "organisatie_profielen_visie_check" CHECK ((("visie" IS NULL) OR ("char_length"("visie") <= 600)))
);


ALTER TABLE "public"."organisatie_profielen" OWNER TO "postgres";


COMMENT ON TABLE "public"."organisatie_profielen" IS 'Generiek contextprofiel per organisatie (1-op-1 met fondsen). Grondt AI-duiding; geen autorisatie/vaststelling/gating. FO Organisatieprofiel v0.4.';



CREATE TABLE IF NOT EXISTS "public"."platform_capabilities" (
    "capability" "text" NOT NULL,
    "actief" boolean DEFAULT true NOT NULL,
    "omschrijving" "text"
);


ALTER TABLE "public"."platform_capabilities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."platform_event_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "correlatie_id" "uuid" NOT NULL,
    "fase" "text" NOT NULL,
    "identity_id" "uuid",
    "capability" "text" NOT NULL,
    "handeling" "text" NOT NULL,
    "doel_fonds_id" "uuid",
    "doel_object" "text",
    "reden" "text",
    "bron_ip" "inet",
    "verwachte_scope" "jsonb",
    "uitkomst" "text",
    "foutcode" "text",
    "effect" "jsonb",
    "tijdstip" timestamp with time zone DEFAULT "now"() NOT NULL,
    "prev_hash" "text",
    "hash" "text" NOT NULL,
    CONSTRAINT "platform_event_log_fase_check" CHECK (("fase" = ANY (ARRAY['attempt'::"text", 'result'::"text"]))),
    CONSTRAINT "platform_event_log_uitkomst_check" CHECK (("uitkomst" = ANY (ARRAY['succes'::"text", 'fout'::"text", 'geweigerd'::"text", 'geannuleerd'::"text"])))
);


ALTER TABLE "public"."platform_event_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."platform_identities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "naam" "text" NOT NULL,
    "actief" boolean DEFAULT true NOT NULL,
    "mfa_enrolled" boolean DEFAULT false NOT NULL,
    "aangemaakt_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    "laatste_login" timestamp with time zone
);


ALTER TABLE "public"."platform_identities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."platform_identity_capabilities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "identity_id" "uuid" NOT NULL,
    "capability" "text" NOT NULL,
    "toegekend_door" "uuid" NOT NULL,
    "vier_ogen_door" "uuid",
    "toegekend_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ingetrokken_op" timestamp with time zone,
    CONSTRAINT "chk_pic_geen_self_approval" CHECK ((("vier_ogen_door" IS NULL) OR ("vier_ogen_door" <> "toegekend_door"))),
    CONSTRAINT "chk_pic_geen_self_grant" CHECK (("toegekend_door" <> "identity_id"))
);


ALTER TABLE "public"."platform_identity_capabilities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."platform_signaal_config" (
    "signaal" "text" NOT NULL,
    "label" "text" NOT NULL,
    "eenheid" "text" NOT NULL,
    "interval_minuten" integer NOT NULL,
    "venster_minuten" integer NOT NULL,
    "drempel_oranje" numeric,
    "drempel_rood" numeric,
    "richting" "text" NOT NULL,
    "n_drempel" integer,
    "actief" boolean DEFAULT true NOT NULL,
    "toelichting" "text",
    "bijgewerkt" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_signaal_n_drempel" CHECK ((("signaal" <> ALL (ARRAY['ai_latency_p95'::"text", 'lege_antwoord_ratio'::"text", 'tokenverbruik'::"text"])) OR (("n_drempel" IS NOT NULL) AND ("n_drempel" >= 10)))),
    CONSTRAINT "platform_signaal_config_eenheid_check" CHECK (("eenheid" = ANY (ARRAY['percentage'::"text", 'aantal'::"text", 'milliseconden'::"text", 'trend_percentage'::"text"]))),
    CONSTRAINT "platform_signaal_config_interval_minuten_check" CHECK (("interval_minuten" > 0)),
    CONSTRAINT "platform_signaal_config_richting_check" CHECK (("richting" = ANY (ARRAY['hoger_is_slechter'::"text", 'lager_is_slechter'::"text"]))),
    CONSTRAINT "platform_signaal_config_venster_minuten_check" CHECK (("venster_minuten" >= 0))
);


ALTER TABLE "public"."platform_signaal_config" OWNER TO "postgres";


COMMENT ON TABLE "public"."platform_signaal_config" IS 'GLOBAAL (T3-register). Drempel- en frequentieconfiguratie per monitoringsignaal. RLS aan, GEEN policy: gelezen door de snapshot-cron (service-role); wijzigen gebeurt in de SQL-editor. Dit is de haak waar de latere alerting-tranche op landt — een hardcoded drempel zou dan opnieuw verplaatst moeten worden (besluit 0105).';



COMMENT ON COLUMN "public"."platform_signaal_config"."venster_minuten" IS '0 = momentopname (geen tijdvenster), bv. de extractie-achterstand.';



COMMENT ON COLUMN "public"."platform_signaal_config"."richting" IS 'hoger_is_slechter: waarde >= drempel is slechter. lager_is_slechter: waarde <= drempel is slechter (uptime).';



COMMENT ON COLUMN "public"."platform_signaal_config"."n_drempel" IS 'NULL = geen n-drempel. Anders: onder dit aantal waarnemingen wordt de waarde onderdrukt (status "onbekend"), wegens her-identificatierisico bij kleine fondsen (FO §17, besluit 0055).';



CREATE TABLE IF NOT EXISTS "public"."platform_signal_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tijdstip" timestamp with time zone DEFAULT "now"() NOT NULL,
    "signaal" "text" NOT NULL,
    "fonds_id" "uuid",
    "waarde" numeric,
    "n" integer,
    "status" "text" NOT NULL,
    "drempel_oranje" numeric,
    "drempel_rood" numeric,
    "meta" "jsonb",
    CONSTRAINT "platform_signal_snapshots_status_check" CHECK (("status" = ANY (ARRAY['groen'::"text", 'oranje'::"text", 'rood'::"text", 'onbekend'::"text"])))
);


ALTER TABLE "public"."platform_signal_snapshots" OWNER TO "postgres";


COMMENT ON TABLE "public"."platform_signal_snapshots" IS 'GLOBAAL (T3-register). Tijdreeks per signaal per fonds (FO §19, signalen 1-7 en 14). RLS aan, GEEN policy: gevuld door de snapshot-cron met de service-role, gelezen achter withPlatformRead + platform.observability.read. Uitsluitend AGGREGATEN — geen individu-herleidbare gegevens; onder de n-drempel (n<10, besluit 0055) is de status "onbekend". Retentie 180 dagen (besluit 0104).';



COMMENT ON COLUMN "public"."platform_signal_snapshots"."fonds_id" IS 'NULL = platformbreed signaal (bv. uptime). Anders het fonds waarop het aggregaat slaat.';



COMMENT ON COLUMN "public"."platform_signal_snapshots"."n" IS 'Aantal waarnemingen achter de waarde; voedt de n-drempel bij gebruikssignalen.';



COMMENT ON COLUMN "public"."platform_signal_snapshots"."meta" IS 'Aanvullende AGGREGATEN (bv. status per healthcheck-component). Nooit fondsinhoud of gebruikersgegevens.';



CREATE TABLE IF NOT EXISTS "public"."procedure_besluiten" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "procedure_id" "uuid" NOT NULL,
    "stap_id" "uuid",
    "vergadering_id" "uuid",
    "agendapunt_id" "uuid",
    "formulering" "text" NOT NULL,
    "motivering" "text",
    "datum" "date" NOT NULL,
    "vastgelegd_door" "uuid",
    "vastgelegd_door_naam" "text",
    "vastgelegd_op" timestamp with time zone DEFAULT "now"(),
    "decision_id" "uuid",
    "verworpen_alternatieven" "text"[] DEFAULT '{}'::"text"[]
);


ALTER TABLE "public"."procedure_besluiten" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."procedure_bewijs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "stap_id" "uuid" NOT NULL,
    "document_id" "uuid",
    "titel" "text" NOT NULL,
    "beschrijving" "text",
    "toegevoegd_op" timestamp with time zone DEFAULT "now"(),
    "toegevoegd_door" "uuid",
    "toegevoegd_door_naam" "text",
    "documenttype" "text",
    "stemming_id" "uuid"
);


ALTER TABLE "public"."procedure_bewijs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."procedure_bewijs"."stemming_id" IS 'Expliciete koppeling naar de stemming waaruit dit stemverslag-bewijs is ontstaan (documenttype stemverslag).';



CREATE TABLE IF NOT EXISTS "public"."procedure_checklist" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "stap_id" "uuid" NOT NULL,
    "volgorde" integer NOT NULL,
    "label" "text" NOT NULL,
    "bewijs_vereist" boolean DEFAULT false,
    "voldaan" boolean DEFAULT false,
    "voldaan_op" timestamp with time zone,
    "voldaan_door" "uuid",
    "voldaan_door_naam" "text",
    "opmerking" "text",
    "bron" "text" DEFAULT 'template'::"text" NOT NULL,
    "actief" boolean DEFAULT true NOT NULL,
    "governance_event_id" "uuid",
    "aangemaakt_door" "uuid",
    "aangemaakt_op" timestamp with time zone DEFAULT "now"(),
    "toelichting" "text",
    CONSTRAINT "procedure_checklist_bron_check" CHECK (("bron" = ANY (ARRAY['template'::"text", 'handmatig'::"text"])))
);


ALTER TABLE "public"."procedure_checklist" OWNER TO "postgres";


COMMENT ON COLUMN "public"."procedure_checklist"."bron" IS 'template = meegesnapshot bij start; handmatig = tijdens de rit toegevoegd (D7).';



COMMENT ON COLUMN "public"."procedure_checklist"."actief" IS 'false = soft-deactivated (append-only; audit overleeft). Deactiveren via de route, gelogd.';



COMMENT ON COLUMN "public"."procedure_checklist"."toelichting" IS 'OB-E10: toelichting bij dit checklistpunt (meegesnapshot uit de definitie bij start).';



CREATE TABLE IF NOT EXISTS "public"."procedure_eigenaars" (
    "procedure_id" "uuid" NOT NULL,
    "gebruiker_id" "uuid",
    "gebruiker_naam" "text" NOT NULL,
    "toegevoegd_op" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."procedure_eigenaars" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."procedure_fase_beschrijving_override" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "template_code" "text" NOT NULL,
    "fase_code" "text" NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "beschrijving" "text" NOT NULL,
    "aangepast_door" "uuid",
    "aangepast_op" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."procedure_fase_beschrijving_override" OWNER TO "postgres";


COMMENT ON TABLE "public"."procedure_fase_beschrijving_override" IS 'Fonds-specifieke override van een fasebeschrijving (D8). Fonds-RLS + WITH CHECK; schrijven door voorzitter/beheerder. Fallback naar procedure_template_fasen.generieke_beschrijving bij ontbreken.';



CREATE TABLE IF NOT EXISTS "public"."procedure_fase_toelichting" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "procedure_id" "uuid" NOT NULL,
    "fase_code" "text" NOT NULL,
    "toelichting" "text",
    "fonds_id" "uuid" NOT NULL,
    "aangepast_door" "uuid",
    "aangepast_op" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."procedure_fase_toelichting" OWNER TO "postgres";


COMMENT ON TABLE "public"."procedure_fase_toelichting" IS 'Per-proces bestuurlijke toelichting per fase (WO-2-vervolg). Los van de gedeelde D8-fasebeschrijving. Fonds-RLS + WITH CHECK; schrijven voorzitter/beheerder.';



CREATE TABLE IF NOT EXISTS "public"."procedure_log" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "procedure_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "actor_id" "uuid",
    "actor_naam" "text",
    "payload" "jsonb" DEFAULT '{}'::"jsonb",
    "tijdstip" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."procedure_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."procedure_requirement_instance" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "decision_id" "uuid" NOT NULL,
    "stap_volgorde" integer NOT NULL,
    "requirement_type" "text" NOT NULL,
    "label" "text" NOT NULL,
    "documenttype" "text",
    "veld_pad" "text",
    "verplicht" boolean DEFAULT true NOT NULL,
    "blokkerend" boolean DEFAULT false NOT NULL,
    "min_aantal" integer DEFAULT 1,
    "vereist_validatie_domein" "text",
    "bron" "text" DEFAULT 'handmatig'::"text" NOT NULL,
    "actief" boolean DEFAULT true NOT NULL,
    "governance_event_id" "uuid",
    "aangemaakt_door" "uuid",
    "aangemaakt_op" timestamp with time zone DEFAULT "now"(),
    "fonds_id" "uuid" NOT NULL,
    CONSTRAINT "procedure_requirement_instance_bron_check" CHECK (("bron" = 'handmatig'::"text")),
    CONSTRAINT "procedure_requirement_instance_min_aantal_check" CHECK (("min_aantal" >= 1)),
    CONSTRAINT "procedure_requirement_instance_requirement_type_check" CHECK (("requirement_type" = ANY (ARRAY['document'::"text", 'field'::"text", 'assumption'::"text", 'risk'::"text", 'ai_validation'::"text", 'approval'::"text", 'mandate_check'::"text", 'kpi'::"text", 'evaluation'::"text", 'dissent_review'::"text", 'external_submission'::"text", 'consultation'::"text"])))
);


ALTER TABLE "public"."procedure_requirement_instance" OWNER TO "postgres";


COMMENT ON TABLE "public"."procedure_requirement_instance" IS 'Instantie-scoped bewijslast (D7): op een lopende procedure toegevoegde requirements. Fonds-RLS + WITH CHECK; schrijven voorzitter/beheerder; append-only via soft-deactivate (actief=false). procedure_requirements blijft de TEMPLATE-bron.';



CREATE TABLE IF NOT EXISTS "public"."procedure_requirement_uitsluiting" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "decision_id" "uuid" NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "stap_volgorde" integer NOT NULL,
    "requirement_type" "text" NOT NULL,
    "label" "text" NOT NULL,
    "match_sleutel" "text" NOT NULL,
    "reden" "text" NOT NULL,
    "actief" boolean DEFAULT true NOT NULL,
    "governance_event_id" "uuid",
    "uitgesloten_door" "uuid",
    "uitgesloten_op" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."procedure_requirement_uitsluiting" OWNER TO "postgres";


COMMENT ON TABLE "public"."procedure_requirement_uitsluiting" IS 'Per-proces overlay (WO-3-vervolg): markeert een TEMPLATE-vereiste als niet van toepassing voor één Decision Object. Raakt de generieke procedure_requirements NOOIT. Fonds-RLS + WITH CHECK; schrijven voorzitter/beheerder; append-only (actief=false = terugdraaien).';



CREATE TABLE IF NOT EXISTS "public"."procedure_requirements" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "template_code" "text" NOT NULL,
    "stap_volgorde" integer NOT NULL,
    "requirement_type" "text" NOT NULL,
    "label" "text" NOT NULL,
    "documenttype" "text",
    "veld_pad" "text",
    "verplicht" boolean DEFAULT true,
    "blokkerend" boolean DEFAULT true,
    "validatieregel" "text",
    "triggert_bij_complexiteit" "text"[],
    "triggert_bij_risiconiveau" "text"[],
    "triggert_bij_mandaatgevoelig" boolean,
    "triggert_bij_toezichtgevoelig" boolean,
    "vereist_validatie_domein" "text",
    "min_aantal" integer DEFAULT 1 NOT NULL,
    "toelichting" "text",
    CONSTRAINT "procedure_requirements_min_aantal_check" CHECK (("min_aantal" >= 1)),
    CONSTRAINT "procedure_requirements_requirement_type_check" CHECK (("requirement_type" = ANY (ARRAY['document'::"text", 'field'::"text", 'assumption'::"text", 'risk'::"text", 'ai_validation'::"text", 'approval'::"text", 'mandate_check'::"text", 'kpi'::"text", 'evaluation'::"text", 'dissent_review'::"text", 'external_submission'::"text", 'consultation'::"text"]))),
    CONSTRAINT "procedure_requirements_vereist_validatie_domein_check" CHECK (("vereist_validatie_domein" = ANY (ARRAY['algemeen'::"text", 'risk'::"text", 'compliance'::"text", 'beleggingen'::"text", 'governance'::"text"])))
);


ALTER TABLE "public"."procedure_requirements" OWNER TO "postgres";


COMMENT ON TABLE "public"."procedure_requirements" IS 'GLOBALE TEMPLATE (T3-register). Leespolicy "req read all" = using(auth.uid() is not null): proces-vereisten zijn fondsoverstijgende templateconfiguratie zonder fonds_id. Schrijven alleen door rol=beheerder ("req write beheerder", mét WITH CHECK sinds T3).';



COMMENT ON COLUMN "public"."procedure_requirements"."toelichting" IS 'OB-E10: bestuurlijke toelichting bij dit bewijsstuk (uit de definitie/standaardset).';



CREATE TABLE IF NOT EXISTS "public"."procedure_stappen" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "procedure_id" "uuid" NOT NULL,
    "volgorde" integer NOT NULL,
    "naam" "text" NOT NULL,
    "beschrijving" "text",
    "vereist_besluit" boolean DEFAULT false,
    "geschatte_dagen" integer,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "eigenaar_naam" "text",
    "deadline" "date",
    "voltooid_op" timestamp with time zone,
    "voltooid_door" "uuid",
    "blokkerende_afhankelijkheden" integer[] DEFAULT '{}'::integer[] NOT NULL,
    "herbevestiging_nodig" boolean DEFAULT false NOT NULL,
    "heropend_op" timestamp with time zone,
    "fase_code" "text",
    CONSTRAINT "procedure_stappen_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'geblokkeerd'::"text", 'actief'::"text", 'afgerond'::"text", 'heropend'::"text"])))
);


ALTER TABLE "public"."procedure_stappen" OWNER TO "postgres";


COMMENT ON COLUMN "public"."procedure_stappen"."blokkerende_afhankelijkheden" IS 'D6: stap-volgordes die eerst afgerond moeten zijn. Leeg = geen gate (parallel-by-default).';



COMMENT ON COLUMN "public"."procedure_stappen"."herbevestiging_nodig" IS 'D6: niet-blokkerend signaal dat een afhankelijke stap is heropend; controleer of dit nog klopt.';



CREATE TABLE IF NOT EXISTS "public"."procedure_template_fasen" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "template_code" "text" NOT NULL,
    "fase_code" "text" NOT NULL,
    "volgorde" integer NOT NULL,
    "titel" "text" NOT NULL,
    "generieke_beschrijving" "text"
);


ALTER TABLE "public"."procedure_template_fasen" OWNER TO "postgres";


COMMENT ON TABLE "public"."procedure_template_fasen" IS 'Globale, gedeelde fase-defaults per template_code (D8). Geen fonds_id: global-by-design, geregistreerd in de A1-lijst van de structurele gates. Schrijven: beheerder.';



CREATE TABLE IF NOT EXISTS "public"."procedures" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "template_code" "text" NOT NULL,
    "titel" "text" NOT NULL,
    "beschrijving" "text",
    "status" "text" DEFAULT 'lopend'::"text" NOT NULL,
    "gestart_op" timestamp with time zone DEFAULT "now"(),
    "gestart_door" "uuid",
    "deadline" "date",
    "afgerond_op" timestamp with time zone,
    "decision_id" "uuid",
    "procesmodel_id" "uuid",
    "periode_type" "text",
    "periode_start" "date",
    "periode_eind" "date",
    "periode_jaar" integer,
    CONSTRAINT "procedures_periode_type_check" CHECK (("periode_type" = ANY (ARRAY['jaar'::"text", 'kwartaal'::"text", 'maand'::"text", 'projectperiode'::"text", 'ad_hoc'::"text", 'doorlopend'::"text", 'versiegedreven'::"text"]))),
    CONSTRAINT "procedures_status_check" CHECK (("status" = ANY (ARRAY['gepland'::"text", 'lopend'::"text", 'ter_besluitvorming'::"text", 'besloten'::"text", 'in_implementatie'::"text", 'afgerond'::"text", 'heropend'::"text", 'gearchiveerd'::"text"])))
);


ALTER TABLE "public"."procedures" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."procesmodel_expertises" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "procesmodel_id" "uuid" NOT NULL,
    "expertise_id" "uuid" NOT NULL,
    "aangemaakt" timestamp with time zone DEFAULT "now"(),
    "aangemaakt_door" "uuid"
);


ALTER TABLE "public"."procesmodel_expertises" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."procesmodel_focusgebieden" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "procesmodel_id" "uuid" NOT NULL,
    "focusgebied_id" "uuid" NOT NULL,
    "aangemaakt" timestamp with time zone DEFAULT "now"(),
    "aangemaakt_door" "uuid"
);


ALTER TABLE "public"."procesmodel_focusgebieden" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."procesmodel_gremia" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "procesmodel_id" "uuid" NOT NULL,
    "gremium_id" "uuid" NOT NULL,
    "aangemaakt" timestamp with time zone DEFAULT "now"(),
    "aangemaakt_door" "uuid"
);


ALTER TABLE "public"."procesmodel_gremia" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."procesmodellen" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "generiek_procestype" "text" NOT NULL,
    "naam" "text" NOT NULL,
    "domein" "text",
    "omschrijving" "text",
    "frequentie" "text",
    "verwachte_documenttypen" "text"[] DEFAULT '{}'::"text"[],
    "synoniemen" "text"[] DEFAULT '{}'::"text"[],
    "default_tijdlijnfases" "text"[] DEFAULT '{}'::"text"[],
    "default_bronstatus_regels" "jsonb" DEFAULT '{}'::"jsonb",
    "actief" boolean DEFAULT true NOT NULL,
    "aangemaakt" timestamp with time zone DEFAULT "now"(),
    "bijgewerkt" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "procesmodellen_frequentie_check" CHECK (("frequentie" = ANY (ARRAY['jaarlijks'::"text", 'kwartaal'::"text", 'maandelijks'::"text", 'ad_hoc'::"text", 'projectmatig'::"text", 'doorlopend'::"text"])))
);


ALTER TABLE "public"."procesmodellen" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiel_expertises" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "profiel_id" "uuid" NOT NULL,
    "expertise_id" "uuid" NOT NULL,
    "aangemaakt" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."profiel_expertises" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiel_focusgebieden" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "profiel_id" "uuid" NOT NULL,
    "focusgebied_id" "uuid" NOT NULL,
    "aangemaakt" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."profiel_focusgebieden" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiel_gremia" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "profiel_id" "uuid" NOT NULL,
    "gremium_id" "uuid" NOT NULL,
    "aangemaakt" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."profiel_gremia" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiel_log" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "profiel_id" "uuid",
    "event_type" "text" NOT NULL,
    "actor_id" "uuid",
    "payload" "jsonb" DEFAULT '{}'::"jsonb",
    "tijdstip" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."profiel_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profielen" (
    "id" "uuid" NOT NULL,
    "fonds_id" "uuid",
    "naam" "text",
    "rol" "text" DEFAULT 'bestuurder'::"text",
    "aangemaakt" timestamp with time zone DEFAULT "now"(),
    "bestuurlijke_rol" "text",
    "primaire_expertise_id" "uuid",
    "antwoordvoorkeur" "text",
    "standaard_ai_modus" "text",
    "detailniveau" "text",
    "reflectie_uitnodiging" boolean DEFAULT true NOT NULL,
    CONSTRAINT "profielen_rol_check" CHECK (("rol" = ANY (ARRAY['bestuurder'::"text", 'voorzitter'::"text", 'beheerder'::"text", 'bestuursbureau'::"text"])))
);


ALTER TABLE "public"."profielen" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profielen"."rol" IS 'Tenant-rol. Vier waarden (CHECK): bestuurder | voorzitter | beheerder | bestuursbureau. Default blijft bestuurder — maak_profiel() zet de rol niet, verhoging loopt uitsluitend via het service-role-pad in het platform-gebruikersscherm. Zelfservice-mutatie is geblokkeerd door fn_profiel_bevries_kolommen(). Rol -> capabilities staat in code (core/lib/capabilities.ts), niet in de DB (besluit 0006/B11).';



COMMENT ON COLUMN "public"."profielen"."reflectie_uitnodiging" IS 'Mag de PROACTIEVE reflectie-uitnodiging (T1-T5) verschijnen? Permanente opt-out uit FR-15, strikt zelfbeheerd (besluit 0017). Uit betekent NIET dat de reflectiefunctie weg is: de handmatige actie "Reflecteer op dit antwoord" blijft altijd bereikbaar (v1.0 §9.1 A). De frequentiebegrenzing per browsersessie staat bewust in sessionStorage en niet hier (besluit 0121).';



CREATE TABLE IF NOT EXISTS "public"."rate_limit_events" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "gebruiker_id" "uuid" NOT NULL,
    "endpoint" "text" NOT NULL,
    "tijdstip" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."rate_limit_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reindex_runs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid",
    "bibliotheek" "text",
    "prefix_model" "text",
    "prompt_versie" "text",
    "indexering_versie" "text",
    "aantal_documenten" integer,
    "aantal_chunks" integer,
    "gestart_door" "uuid",
    "aangemaakt" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."reindex_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."risico_log" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "risico_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "actor_id" "uuid",
    "actor_naam" "text",
    "payload" "jsonb" DEFAULT '{}'::"jsonb",
    "tijdstip" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."risico_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."risico_maatregelen" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "risico_id" "uuid" NOT NULL,
    "beschrijving" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "verantwoordelijke" "text",
    "procedure_id" "uuid",
    "volgorde" integer DEFAULT 0,
    "aangemaakt" timestamp with time zone DEFAULT "now"(),
    "aangemaakt_door" "uuid",
    "bijgewerkt_op" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "risico_maatregelen_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'in_voorbereiding'::"text", 'genomen'::"text"])))
);


ALTER TABLE "public"."risico_maatregelen" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."risicos" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "categorie" "text" NOT NULL,
    "titel" "text" NOT NULL,
    "toelichting" "text",
    "kans" integer NOT NULL,
    "impact" integer NOT NULL,
    "niveau" "text" DEFAULT 'middel'::"text" NOT NULL,
    "niveau_handmatig" boolean DEFAULT false,
    "type_risico" "text" DEFAULT 'structureel'::"text" NOT NULL,
    "status" "text" DEFAULT 'actief'::"text" NOT NULL,
    "eigenaar_id" "uuid",
    "eigenaar_naam" "text",
    "volgende_beoordeling" "date",
    "aangemaakt" timestamp with time zone DEFAULT "now"(),
    "aangemaakt_door" "uuid",
    "gesloten_op" timestamp with time zone,
    "gesloten_door" "uuid",
    "sluit_motivering" "text",
    CONSTRAINT "risicos_categorie_check" CHECK (("categorie" = ANY (ARRAY['financieel_actuarieel'::"text", 'governance_organisatie'::"text", 'operationeel_datakwaliteit'::"text", 'informatie_communicatie'::"text"]))),
    CONSTRAINT "risicos_impact_check" CHECK ((("impact" >= 1) AND ("impact" <= 5))),
    CONSTRAINT "risicos_kans_check" CHECK ((("kans" >= 1) AND ("kans" <= 5))),
    CONSTRAINT "risicos_niveau_check" CHECK (("niveau" = ANY (ARRAY['laag'::"text", 'middel'::"text", 'hoog'::"text"]))),
    CONSTRAINT "risicos_status_check" CHECK (("status" = ANY (ARRAY['actief'::"text", 'gesloten'::"text"]))),
    CONSTRAINT "risicos_type_risico_check" CHECK (("type_risico" = ANY (ARRAY['structureel'::"text", 'tijdelijk'::"text"])))
);


ALTER TABLE "public"."risicos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."semantic_units" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "document_id" "uuid" NOT NULL,
    "chunk_id" "uuid",
    "concept_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "statement" "text" NOT NULL,
    "value_raw" "text" NOT NULL,
    "value_num" numeric,
    "value_date" "date",
    "value_text" "text",
    "value_unit" "text",
    "page" integer,
    "section" "text",
    "evidence" "text" NOT NULL,
    "evidence_verified" boolean DEFAULT false NOT NULL,
    "confidence_signals" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "document_status" "text",
    "extraction_run_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "semantic_units_evidence_niet_leeg_check" CHECK (("length"("btrim"("evidence")) > 0)),
    CONSTRAINT "semantic_units_waardetypering_check" CHECK (((("type" = 'percentage'::"text") AND ("value_num" IS NOT NULL)) OR (("type" = 'amount'::"text") AND ("value_num" IS NOT NULL)) OR (("type" = 'date'::"text") AND ("value_date" IS NOT NULL)) OR (("type" = 'policy_choice'::"text") AND ("value_text" IS NOT NULL))))
);


ALTER TABLE "public"."semantic_units" OWNER TO "postgres";


COMMENT ON TABLE "public"."semantic_units" IS 'Getypeerde, aan een canoniek concept gebonden semantic units (T7). Per fonds geïsoleerd (RLS op fonds_id). Schrijven uitsluitend via de service-role (besluit T7); authenticated is read-only. NIET append-only: her-extractie mag units vervangen. type is FK-gelockt aan concept.type; value_* is per type afgedwongen; evidence is verplicht en niet-leeg.';



CREATE TABLE IF NOT EXISTS "public"."stem_uitbrengingen" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "stemming_id" "uuid" NOT NULL,
    "uitgebracht_door" "uuid" NOT NULL,
    "stemgerechtigde_id" "uuid" NOT NULL,
    "keuze" "text" NOT NULL,
    "motivering" "text",
    "is_volmacht" boolean GENERATED ALWAYS AS (("uitgebracht_door" <> "stemgerechtigde_id")) STORED,
    "volmacht_toelichting" "text",
    "volmacht_bevestigd" boolean DEFAULT false NOT NULL,
    "uitgebracht_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_volmacht_bevestigd" CHECK (((("uitgebracht_door" = "stemgerechtigde_id") AND ("volmacht_bevestigd" = false)) OR (("uitgebracht_door" <> "stemgerechtigde_id") AND ("volmacht_bevestigd" = true))))
);


ALTER TABLE "public"."stem_uitbrengingen" OWNER TO "postgres";


COMMENT ON TABLE "public"."stem_uitbrengingen" IS 'Individueel stemgedrag per stemronde. Fondsbreed leesbaar voor bestuurlijke rollen (open stemming); NIET voor rol bestuursbureau (G9, migratie 2026_08_05). De ronde en de uitslag staan in public.stemmingen en blijven voor het bureau wél leesbaar.';



CREATE TABLE IF NOT EXISTS "public"."stemmingen" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "agendapunt_id" "uuid" NOT NULL,
    "decision_id" "uuid",
    "vraag" "text" NOT NULL,
    "alternatieven" "jsonb" DEFAULT '[{"code": "voor", "label": "Voor"}, {"code": "tegen", "label": "Tegen"}, {"code": "onthouden", "label": "Onthouden"}]'::"jsonb" NOT NULL,
    "vereist_quorum" integer,
    "vereiste_meerderheid" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "geopend_op" timestamp with time zone DEFAULT "now"() NOT NULL,
    "geopend_door" "uuid" NOT NULL,
    "gesloten_op" timestamp with time zone,
    "gesloten_door" "uuid",
    "ingetrokken_reden" "text",
    "uitslag" "jsonb",
    CONSTRAINT "chk_alternatieven_array" CHECK (("jsonb_typeof"("alternatieven") = 'array'::"text")),
    CONSTRAINT "stemmingen_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'gesloten'::"text", 'ingetrokken'::"text"]))),
    CONSTRAINT "stemmingen_vereiste_meerderheid_check" CHECK (("vereiste_meerderheid" = ANY (ARRAY['gewone'::"text", 'gekwalificeerd_twee_derde'::"text", 'unaniem'::"text"])))
);


ALTER TABLE "public"."stemmingen" OWNER TO "postgres";


COMMENT ON TABLE "public"."stemmingen" IS 'Stemronde op een agendapunt met categorie besluitvorming. decision_id afgeleid via agendapunt→procedure-stap→procedure bij starten.';



COMMENT ON COLUMN "public"."stemmingen"."uitslag" IS 'jsonb met totalen, quorum_status, meerderheid_status, besluitregistratie_advies, winnend_alternatief en per_stemgerechtigde. Gevuld bij sluiten.';



CREATE TABLE IF NOT EXISTS "public"."tenant_domains" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "host" "text" NOT NULL,
    "fonds_id" "uuid" NOT NULL,
    "actief" boolean DEFAULT true NOT NULL,
    "aangemaakt_op" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tenant_domains" OWNER TO "postgres";


COMMENT ON TABLE "public"."tenant_domains" IS 'Globale host→fonds-mapping voor de server-side tenant-resolver (besluit 0040, B4). Bewuste globale/uitzonderingstabel: RLS aan, deny-by-default (geen policy), alleen leesbaar via de service-role. Defense-in-depth naast RLS, geen autorisatie.';



COMMENT ON COLUMN "public"."tenant_domains"."host" IS 'Genormaliseerde request-host: lowercase, zonder poort, zonder leidende www. (contract identiek aan lib/platform-host.ts normaliseerHost).';



COMMENT ON COLUMN "public"."tenant_domains"."actief" IS 'Alleen actieve rijen resolven naar een fonds; actief=false → host geldt als onbekend (fail-closed).';



CREATE TABLE IF NOT EXISTS "public"."vergadering_log" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "vergadering_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "actor_id" "uuid" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "aangemaakt" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "vergadering_log_event_type_check" CHECK (("event_type" = ANY (ARRAY['vergadering_gewijzigd'::"text", 'vergadering_gearchiveerd'::"text", 'vergadering_gedearchiveerd'::"text"])))
);


ALTER TABLE "public"."vergadering_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."vergadering_log" IS 'Append-only mutatie-log voor de vergaderkop. Apart van governance_events (besluit-gericht) en agendapunt_log (agendapunt-gericht).';



CREATE TABLE IF NOT EXISTS "public"."vergaderingen" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fonds_id" "uuid",
    "titel" "text" NOT NULL,
    "datum" timestamp with time zone NOT NULL,
    "locatie" "text",
    "status" "text" DEFAULT 'in_voorbereiding'::"text",
    "aangemaakt_door" "uuid",
    "aangemaakt" timestamp with time zone DEFAULT "now"(),
    "gewijzigd_op" timestamp with time zone,
    "gewijzigd_door" "uuid",
    "gearchiveerd_op" timestamp with time zone,
    "gearchiveerd_door" "uuid",
    CONSTRAINT "vergaderingen_status_check" CHECK (("status" = ANY (ARRAY['gepland'::"text", 'in_voorbereiding'::"text", 'afgerond'::"text"])))
);


ALTER TABLE "public"."vergaderingen" OWNER TO "postgres";


COMMENT ON COLUMN "public"."vergaderingen"."gewijzigd_op" IS 'Tijdstip laatste wijziging van de vergaderkop (titel/locatie/datum). Null = nooit gewijzigd.';



COMMENT ON COLUMN "public"."vergaderingen"."gewijzigd_door" IS 'Gebruiker die de vergaderkop het laatst wijzigde.';



COMMENT ON COLUMN "public"."vergaderingen"."gearchiveerd_op" IS 'Besluit 0145 — handmatig archiveren. NULL = staat in de gewone lijst. Losstaand van `status`, die de voorbereidingsvoortgang modelleert.';



CREATE TABLE IF NOT EXISTS "public"."voorbereidingen" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "agendapunt_id" "uuid" NOT NULL,
    "gebruiker_id" "uuid" NOT NULL,
    "diepte" "text" DEFAULT 'snel'::"text" NOT NULL,
    "ai_output" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "eigen_notities" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "bronnen_meta" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "gegenereerd_op" timestamp with time zone DEFAULT "now"(),
    "bijgewerkt_op" timestamp with time zone DEFAULT "now"(),
    "vrije_notities" "text",
    CONSTRAINT "voorbereidingen_diepte_check" CHECK (("diepte" = ANY (ARRAY['snel'::"text", 'grondig'::"text"])))
);


ALTER TABLE "public"."voorbereidingen" OWNER TO "postgres";


COMMENT ON COLUMN "public"."voorbereidingen"."vrije_notities" IS 'Vrij persoonlijk notitieveld los van AI-lenzen. Privé per gebruiker (RLS via eigen voorbereiding).';



CREATE OR REPLACE VIEW "public"."vw_dossier_status" WITH ("security_invoker"='true') AS
 SELECT "p"."id" AS "procedure_id",
    "p"."fonds_id",
    "d"."id" AS "decision_id",
    "d"."status" AS "decision_status",
    ("d"."id" IS NOT NULL) AS "afgeleid_van_decision",
        CASE
            WHEN ("d"."id" IS NULL) THEN "p"."status"
            ELSE "m"."dossierstatus"
        END AS "dossierstatus",
        CASE
            WHEN ("d"."id" IS NULL) THEN NULL::"text"
            ELSE "m"."sublabel"
        END AS "sublabel"
   FROM (("public"."procedures" "p"
     LEFT JOIN "public"."decision_objects" "d" ON ((("d"."procedure_id" = "p"."id") AND ("d"."is_primary_decision" = true))))
     LEFT JOIN LATERAL "public"."fn_dossierstatus_van_decision"("d"."status") "m"("dossierstatus", "sublabel") ON (true));


ALTER VIEW "public"."vw_dossier_status" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_fondsleden" WITH ("security_invoker"='false') AS
 SELECT "id",
    "fonds_id",
    "naam",
    "rol"
   FROM "public"."profielen" "p"
  WHERE ("fonds_id" = ( SELECT "eigen"."fonds_id"
           FROM "public"."profielen" "eigen"
          WHERE ("eigen"."id" = "auth"."uid"())));


ALTER VIEW "public"."vw_fondsleden" OWNER TO "postgres";


COMMENT ON VIEW "public"."vw_fondsleden" IS 'Weergavenaam + rol van de leden van het EIGEN fonds. Definer-semantiek: omzeilt bewust de policy "profiel select eigen" op public.profielen, maar projecteert uitsluitend id/fonds_id/naam/rol — het persoonlijke bestuurdersprofiel (besluit 0017) blijft afgeschermd. Scoping zit in de WHERE; bewaakt door supabase/checks/2026_08_02_fondsleden_cross_tenant.sql.';



CREATE TABLE IF NOT EXISTS "public"."wettelijk_regime_per_fondstype" (
    "fondstype" "text" NOT NULL,
    "primair_wettelijk_regime" "text" NOT NULL,
    "toelichting" "text",
    "bevestigd_door_compliance" boolean DEFAULT false NOT NULL,
    "aangemaakt" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "wettelijk_regime_per_fondstype_fondstype_check" CHECK (("fondstype" = ANY (ARRAY['bedrijfstak'::"text", 'onderneming'::"text", 'beroeps'::"text", 'apf'::"text", 'algemeen'::"text"]))),
    CONSTRAINT "wettelijk_regime_per_fondstype_primair_wettelijk_regime_check" CHECK (("primair_wettelijk_regime" = ANY (ARRAY['pw'::"text", 'wvb'::"text", 'beide'::"text", 'algemeen'::"text"])))
);


ALTER TABLE "public"."wettelijk_regime_per_fondstype" OWNER TO "postgres";


COMMENT ON TABLE "public"."wettelijk_regime_per_fondstype" IS 'T4 — beheerde mapping fondstype → primair_wettelijk_regime (juridische kwalificatie in DATA, niet in code). Compliance-eigenaar. Seed = voorstel; bevestigd_door_compliance markeert per rij of compliance de kwalificatie heeft bevestigd. Retrieval leest fondsen.primair_wettelijk_regime, niet deze tabel.';



ALTER TABLE ONLY "public"."agendapunt_inbreng"
    ADD CONSTRAINT "agendapunt_inbreng_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agendapunt_log"
    ADD CONSTRAINT "agendapunt_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agendapunten"
    ADD CONSTRAINT "agendapunten_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_errors"
    ADD CONSTRAINT "app_errors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aqlab_ai_features"
    ADD CONSTRAINT "aqlab_ai_features_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."aqlab_ai_features"
    ADD CONSTRAINT "aqlab_ai_features_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aqlab_audit_exports"
    ADD CONSTRAINT "aqlab_audit_exports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aqlab_findings"
    ADD CONSTRAINT "aqlab_findings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aqlab_fixture_documents"
    ADD CONSTRAINT "aqlab_fixture_documents_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."aqlab_fixture_documents"
    ADD CONSTRAINT "aqlab_fixture_documents_code_versie_key" UNIQUE ("code", "versie");



ALTER TABLE ONLY "public"."aqlab_fixture_documents"
    ADD CONSTRAINT "aqlab_fixture_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aqlab_human_reviews"
    ADD CONSTRAINT "aqlab_human_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aqlab_log"
    ADD CONSTRAINT "aqlab_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aqlab_model_configurations"
    ADD CONSTRAINT "aqlab_model_configurations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aqlab_prompt_versions"
    ADD CONSTRAINT "aqlab_prompt_versions_feature_id_soort_versie_key" UNIQUE ("feature_id", "soort", "versie");



ALTER TABLE ONLY "public"."aqlab_prompt_versions"
    ADD CONSTRAINT "aqlab_prompt_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aqlab_release_decisions"
    ADD CONSTRAINT "aqlab_release_decisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aqlab_run_jobs"
    ADD CONSTRAINT "aqlab_run_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aqlab_run_jobs"
    ADD CONSTRAINT "aqlab_run_jobs_run_id_test_case_id_iteratie_key" UNIQUE ("run_id", "test_case_id", "iteratie");



ALTER TABLE ONLY "public"."aqlab_run_outputs"
    ADD CONSTRAINT "aqlab_run_outputs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aqlab_runs"
    ADD CONSTRAINT "aqlab_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aqlab_scores"
    ADD CONSTRAINT "aqlab_scores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aqlab_test_case_fixtures"
    ADD CONSTRAINT "aqlab_test_case_fixtures_pkey" PRIMARY KEY ("test_case_id", "fixture_document_id", "rol");



ALTER TABLE ONLY "public"."aqlab_test_cases"
    ADD CONSTRAINT "aqlab_test_cases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aqlab_test_cases"
    ADD CONSTRAINT "aqlab_test_cases_test_set_id_code_key" UNIQUE ("test_set_id", "code");



ALTER TABLE ONLY "public"."aqlab_test_sets"
    ADD CONSTRAINT "aqlab_test_sets_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."aqlab_test_sets"
    ADD CONSTRAINT "aqlab_test_sets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bron_whitelist_log"
    ADD CONSTRAINT "bron_whitelist_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bron_whitelist"
    ADD CONSTRAINT "bron_whitelist_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."catalogus_log"
    ADD CONSTRAINT "catalogus_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."classificatie_voorstellen"
    ADD CONSTRAINT "classificatie_voorstellen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."comparison_results"
    ADD CONSTRAINT "comparison_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."comparison_run"
    ADD CONSTRAINT "comparison_run_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."concepts"
    ADD CONSTRAINT "concepts_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."concepts"
    ADD CONSTRAINT "concepts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contact_aanvragen"
    ADD CONSTRAINT "contact_aanvragen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."decision_actions"
    ADD CONSTRAINT "decision_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."decision_ai_interactions"
    ADD CONSTRAINT "decision_ai_interactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."decision_assumptions"
    ADD CONSTRAINT "decision_assumptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."decision_audit_snapshots"
    ADD CONSTRAINT "decision_audit_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."decision_conditions"
    ADD CONSTRAINT "decision_conditions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."decision_dissent"
    ADD CONSTRAINT "decision_dissent_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."decision_evaluations"
    ADD CONSTRAINT "decision_evaluations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."decision_objects"
    ADD CONSTRAINT "decision_objects_besluit_code_key" UNIQUE ("besluit_code");



ALTER TABLE ONLY "public"."decision_objects"
    ADD CONSTRAINT "decision_objects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."decision_risks"
    ADD CONSTRAINT "decision_risks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."difference_judgements"
    ADD CONSTRAINT "difference_judgements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_agendapunten"
    ADD CONSTRAINT "document_agendapunten_document_id_agendapunt_id_key" UNIQUE ("document_id", "agendapunt_id");



ALTER TABLE ONLY "public"."document_agendapunten"
    ADD CONSTRAINT "document_agendapunten_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_chunks"
    ADD CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_inzage"
    ADD CONSTRAINT "document_inzage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_metadata_log"
    ADD CONSTRAINT "document_metadata_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_metadata_review_queue"
    ADD CONSTRAINT "document_metadata_review_queue_document_id_key" UNIQUE ("document_id");



ALTER TABLE ONLY "public"."document_metadata_review_queue"
    ADD CONSTRAINT "document_metadata_review_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_procesinstanties"
    ADD CONSTRAINT "document_procesinstanties_document_id_procesinstantie_id_key" UNIQUE ("document_id", "procesinstantie_id");



ALTER TABLE ONLY "public"."document_procesinstanties"
    ADD CONSTRAINT "document_procesinstanties_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_processing_jobs"
    ADD CONSTRAINT "document_processing_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."documenten"
    ADD CONSTRAINT "documenten_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expertises"
    ADD CONSTRAINT "expertises_fonds_id_id_key" UNIQUE ("fonds_id", "id");



ALTER TABLE ONLY "public"."expertises"
    ADD CONSTRAINT "expertises_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extraction_run"
    ADD CONSTRAINT "extraction_run_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fonds_config_log"
    ADD CONSTRAINT "fonds_config_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fonds_config_log"
    ADD CONSTRAINT "fonds_config_log_versie_uniek" UNIQUE ("fonds_id", "config_type", "config_sleutel", "versie");



ALTER TABLE ONLY "public"."fonds_content_overrides"
    ADD CONSTRAINT "fonds_content_overrides_pkey" PRIMARY KEY ("fonds_id", "sleutel");



ALTER TABLE ONLY "public"."fonds_feature_flags"
    ADD CONSTRAINT "fonds_feature_flags_pkey" PRIMARY KEY ("fonds_id", "flag_key");



ALTER TABLE ONLY "public"."fonds_instellingen"
    ADD CONSTRAINT "fonds_instellingen_pkey" PRIMARY KEY ("fonds_id");



ALTER TABLE ONLY "public"."fonds_klantbeeld_cohort"
    ADD CONSTRAINT "fonds_klantbeeld_cohort_pkey" PRIMARY KEY ("fonds_id", "leeftijd");



ALTER TABLE ONLY "public"."fonds_module_manifest"
    ADD CONSTRAINT "fonds_module_manifest_pkey" PRIMARY KEY ("fonds_id", "module_key");



ALTER TABLE ONLY "public"."fonds_stuurinfo_kpi"
    ADD CONSTRAINT "fonds_stuurinfo_kpi_pkey" PRIMARY KEY ("fonds_id", "periode", "kpi_key");



ALTER TABLE ONLY "public"."fonds_stuurinfo_log"
    ADD CONSTRAINT "fonds_stuurinfo_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fonds_stuurinfo_periode"
    ADD CONSTRAINT "fonds_stuurinfo_periode_pkey" PRIMARY KEY ("fonds_id", "periode");



ALTER TABLE ONLY "public"."fonds_stuurinfo_reeks"
    ADD CONSTRAINT "fonds_stuurinfo_reeks_pkey" PRIMARY KEY ("fonds_id", "periode", "reeks_key", "punt_key");



ALTER TABLE ONLY "public"."fonds_stuurinfo_reserve"
    ADD CONSTRAINT "fonds_stuurinfo_reserve_pkey" PRIMARY KEY ("fonds_id", "periode", "reserve_key");



ALTER TABLE ONLY "public"."fonds_theming"
    ADD CONSTRAINT "fonds_theming_pkey" PRIMARY KEY ("fonds_id");



ALTER TABLE ONLY "public"."fondsen"
    ADD CONSTRAINT "fondsen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fondsen"
    ADD CONSTRAINT "fondsen_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."gesprek_reflectie_state"
    ADD CONSTRAINT "gesprek_reflectie_state_pkey" PRIMARY KEY ("gesprek_id");



ALTER TABLE ONLY "public"."gesprekken"
    ADD CONSTRAINT "gesprekken_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."governance_audit_grants"
    ADD CONSTRAINT "governance_audit_grants_pkey" PRIMARY KEY ("gebruiker_id", "fonds_id", "capability");



ALTER TABLE ONLY "public"."governance_audit_inzage"
    ADD CONSTRAINT "governance_audit_inzage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."governance_events"
    ADD CONSTRAINT "governance_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."governance_export_log"
    ADD CONSTRAINT "governance_export_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."governance_log_inhoud"
    ADD CONSTRAINT "governance_log_inhoud_pkey" PRIMARY KEY ("log_id");



ALTER TABLE ONLY "public"."governance_log"
    ADD CONSTRAINT "governance_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."governance_redacties"
    ADD CONSTRAINT "governance_redacties_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."governance_redacties"
    ADD CONSTRAINT "governance_redacties_request_id_key" UNIQUE ("request_id");



ALTER TABLE ONLY "public"."gremia"
    ADD CONSTRAINT "gremia_fonds_id_id_key" UNIQUE ("fonds_id", "id");



ALTER TABLE ONLY "public"."gremia"
    ADD CONSTRAINT "gremia_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kritische_focusgebieden"
    ADD CONSTRAINT "kritische_focusgebieden_fonds_id_id_key" UNIQUE ("fonds_id", "id");



ALTER TABLE ONLY "public"."kritische_focusgebieden"
    ADD CONSTRAINT "kritische_focusgebieden_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notificaties"
    ADD CONSTRAINT "notificaties_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notulen_segmenten"
    ADD CONSTRAINT "notulen_segmenten_document_id_segment_index_key" UNIQUE ("document_id", "segment_index");



ALTER TABLE ONLY "public"."notulen_segmenten"
    ADD CONSTRAINT "notulen_segmenten_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organisatie_profielen"
    ADD CONSTRAINT "organisatie_profielen_fonds_id_key" UNIQUE ("fonds_id");



ALTER TABLE ONLY "public"."organisatie_profielen"
    ADD CONSTRAINT "organisatie_profielen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_capabilities"
    ADD CONSTRAINT "platform_capabilities_pkey" PRIMARY KEY ("capability");



ALTER TABLE ONLY "public"."platform_event_log"
    ADD CONSTRAINT "platform_event_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_identities"
    ADD CONSTRAINT "platform_identities_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."platform_identities"
    ADD CONSTRAINT "platform_identities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_identity_capabilities"
    ADD CONSTRAINT "platform_identity_capabilities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_signaal_config"
    ADD CONSTRAINT "platform_signaal_config_pkey" PRIMARY KEY ("signaal");



ALTER TABLE ONLY "public"."platform_signal_snapshots"
    ADD CONSTRAINT "platform_signal_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."procedure_afschriften"
    ADD CONSTRAINT "procedure_afschriften_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."procedure_besluiten"
    ADD CONSTRAINT "procedure_besluiten_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."procedure_bewijs"
    ADD CONSTRAINT "procedure_bewijs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."procedure_checklist"
    ADD CONSTRAINT "procedure_checklist_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."procedure_eigenaars"
    ADD CONSTRAINT "procedure_eigenaars_pkey" PRIMARY KEY ("procedure_id", "gebruiker_naam");



ALTER TABLE ONLY "public"."procedure_fase_beschrijving_override"
    ADD CONSTRAINT "procedure_fase_beschrijving_o_template_code_fase_code_fonds_key" UNIQUE ("template_code", "fase_code", "fonds_id");



ALTER TABLE ONLY "public"."procedure_fase_beschrijving_override"
    ADD CONSTRAINT "procedure_fase_beschrijving_override_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."procedure_fase_toelichting"
    ADD CONSTRAINT "procedure_fase_toelichting_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."procedure_fase_toelichting"
    ADD CONSTRAINT "procedure_fase_toelichting_procedure_id_fase_code_key" UNIQUE ("procedure_id", "fase_code");



ALTER TABLE ONLY "public"."procedure_log"
    ADD CONSTRAINT "procedure_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."procedure_requirement_instance"
    ADD CONSTRAINT "procedure_requirement_instance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."procedure_requirement_uitsluiting"
    ADD CONSTRAINT "procedure_requirement_uitslui_decision_id_stap_volgorde_req_key" UNIQUE ("decision_id", "stap_volgorde", "requirement_type", "match_sleutel");



ALTER TABLE ONLY "public"."procedure_requirement_uitsluiting"
    ADD CONSTRAINT "procedure_requirement_uitsluiting_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."procedure_requirements"
    ADD CONSTRAINT "procedure_requirements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."procedure_stappen"
    ADD CONSTRAINT "procedure_stappen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."procedure_template_fasen"
    ADD CONSTRAINT "procedure_template_fasen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."procedure_template_fasen"
    ADD CONSTRAINT "procedure_template_fasen_template_code_fase_code_key" UNIQUE ("template_code", "fase_code");



ALTER TABLE ONLY "public"."procedures"
    ADD CONSTRAINT "procedures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."procesmodel_expertises"
    ADD CONSTRAINT "procesmodel_expertises_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."procesmodel_expertises"
    ADD CONSTRAINT "procesmodel_expertises_procesmodel_id_expertise_id_key" UNIQUE ("procesmodel_id", "expertise_id");



ALTER TABLE ONLY "public"."procesmodel_focusgebieden"
    ADD CONSTRAINT "procesmodel_focusgebieden_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."procesmodel_focusgebieden"
    ADD CONSTRAINT "procesmodel_focusgebieden_procesmodel_id_focusgebied_id_key" UNIQUE ("procesmodel_id", "focusgebied_id");



ALTER TABLE ONLY "public"."procesmodel_gremia"
    ADD CONSTRAINT "procesmodel_gremia_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."procesmodel_gremia"
    ADD CONSTRAINT "procesmodel_gremia_procesmodel_id_gremium_id_key" UNIQUE ("procesmodel_id", "gremium_id");



ALTER TABLE ONLY "public"."procesmodellen"
    ADD CONSTRAINT "procesmodellen_fonds_id_id_key" UNIQUE ("fonds_id", "id");



ALTER TABLE ONLY "public"."procesmodellen"
    ADD CONSTRAINT "procesmodellen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiel_expertises"
    ADD CONSTRAINT "profiel_expertises_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiel_expertises"
    ADD CONSTRAINT "profiel_expertises_profiel_id_expertise_id_key" UNIQUE ("profiel_id", "expertise_id");



ALTER TABLE ONLY "public"."profiel_focusgebieden"
    ADD CONSTRAINT "profiel_focusgebieden_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiel_focusgebieden"
    ADD CONSTRAINT "profiel_focusgebieden_profiel_id_focusgebied_id_key" UNIQUE ("profiel_id", "focusgebied_id");



ALTER TABLE ONLY "public"."profiel_gremia"
    ADD CONSTRAINT "profiel_gremia_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiel_gremia"
    ADD CONSTRAINT "profiel_gremia_profiel_id_gremium_id_key" UNIQUE ("profiel_id", "gremium_id");



ALTER TABLE ONLY "public"."profiel_log"
    ADD CONSTRAINT "profiel_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profielen"
    ADD CONSTRAINT "profielen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rate_limit_events"
    ADD CONSTRAINT "rate_limit_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reindex_runs"
    ADD CONSTRAINT "reindex_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."risico_log"
    ADD CONSTRAINT "risico_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."risico_maatregelen"
    ADD CONSTRAINT "risico_maatregelen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."risicos"
    ADD CONSTRAINT "risicos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."semantic_units"
    ADD CONSTRAINT "semantic_units_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stem_uitbrengingen"
    ADD CONSTRAINT "stem_uitbrengingen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stem_uitbrengingen"
    ADD CONSTRAINT "stem_uitbrengingen_stemming_id_stemgerechtigde_id_key" UNIQUE ("stemming_id", "stemgerechtigde_id");



ALTER TABLE ONLY "public"."stemmingen"
    ADD CONSTRAINT "stemmingen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_domains"
    ADD CONSTRAINT "tenant_domains_host_key" UNIQUE ("host");



ALTER TABLE ONLY "public"."tenant_domains"
    ADD CONSTRAINT "tenant_domains_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."concepts"
    ADD CONSTRAINT "uq_concepts_id_type" UNIQUE ("id", "type");



ALTER TABLE ONLY "public"."profielen"
    ADD CONSTRAINT "uq_profielen_fonds_id" UNIQUE ("fonds_id", "id");



ALTER TABLE ONLY "public"."vergadering_log"
    ADD CONSTRAINT "vergadering_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vergaderingen"
    ADD CONSTRAINT "vergaderingen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."voorbereidingen"
    ADD CONSTRAINT "voorbereidingen_agendapunt_id_gebruiker_id_key" UNIQUE ("agendapunt_id", "gebruiker_id");



ALTER TABLE ONLY "public"."voorbereidingen"
    ADD CONSTRAINT "voorbereidingen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wettelijk_regime_per_fondstype"
    ADD CONSTRAINT "wettelijk_regime_per_fondstype_pkey" PRIMARY KEY ("fondstype");



CREATE INDEX "idx_actions_dec" ON "public"."decision_actions" USING "btree" ("decision_id");



CREATE INDEX "idx_afschriften_claim" ON "public"."procedure_afschriften" USING "btree" ("aangemaakt_op") WHERE ("status" = 'bezig'::"text");



CREATE INDEX "idx_afschriften_procedure" ON "public"."procedure_afschriften" USING "btree" ("procedure_id", "aangemaakt_op" DESC);



CREATE INDEX "idx_agenda_verg" ON "public"."agendapunten" USING "btree" ("vergadering_id", "volgorde");



CREATE INDEX "idx_agendapunt_log_punt" ON "public"."agendapunt_log" USING "btree" ("agendapunt_id", "aangemaakt" DESC);



CREATE INDEX "idx_agendapunten_actief" ON "public"."agendapunten" USING "btree" ("vergadering_id", "volgorde") WHERE ("verwijderd_op" IS NULL);



CREATE INDEX "idx_agendapunten_procstap" ON "public"."agendapunten" USING "btree" ("procedure_stap_id");



CREATE INDEX "idx_aiint_dec" ON "public"."decision_ai_interactions" USING "btree" ("decision_id", "aangemaakt_op" DESC);



CREATE INDEX "idx_app_errors_categorie" ON "public"."app_errors" USING "btree" ("categorie", "tijdstip" DESC);



CREATE INDEX "idx_app_errors_fonds" ON "public"."app_errors" USING "btree" ("fonds_id", "tijdstip" DESC);



CREATE INDEX "idx_app_errors_tijd" ON "public"."app_errors" USING "btree" ("tijdstip" DESC);



CREATE INDEX "idx_aqlab_audit_run" ON "public"."aqlab_audit_exports" USING "btree" ("run_id");



CREATE INDEX "idx_aqlab_findings_output" ON "public"."aqlab_findings" USING "btree" ("run_output_id");



CREATE INDEX "idx_aqlab_findings_score" ON "public"."aqlab_findings" USING "btree" ("score_id");



CREATE INDEX "idx_aqlab_fixtures_code_versie" ON "public"."aqlab_fixture_documents" USING "btree" ("code", "versie" DESC);



CREATE INDEX "idx_aqlab_log_object" ON "public"."aqlab_log" USING "btree" ("object_type", "object_id");



CREATE INDEX "idx_aqlab_log_tijd" ON "public"."aqlab_log" USING "btree" ("aangemaakt_op" DESC);



CREATE INDEX "idx_aqlab_prompt_versions_feat" ON "public"."aqlab_prompt_versions" USING "btree" ("feature_id");



CREATE INDEX "idx_aqlab_release_feature" ON "public"."aqlab_release_decisions" USING "btree" ("feature_id");



CREATE INDEX "idx_aqlab_release_run" ON "public"."aqlab_release_decisions" USING "btree" ("run_id");



CREATE INDEX "idx_aqlab_reviews_output" ON "public"."aqlab_human_reviews" USING "btree" ("run_output_id");



CREATE INDEX "idx_aqlab_run_jobs_run" ON "public"."aqlab_run_jobs" USING "btree" ("run_id");



CREATE INDEX "idx_aqlab_run_jobs_status" ON "public"."aqlab_run_jobs" USING "btree" ("status") WHERE ("status" = ANY (ARRAY['wachtend'::"text", 'bezig'::"text"]));



CREATE INDEX "idx_aqlab_run_outputs_run" ON "public"."aqlab_run_outputs" USING "btree" ("run_id");



CREATE INDEX "idx_aqlab_run_outputs_tc" ON "public"."aqlab_run_outputs" USING "btree" ("test_case_id");



CREATE INDEX "idx_aqlab_runs_baseline" ON "public"."aqlab_runs" USING "btree" ("baseline_run_id");



CREATE INDEX "idx_aqlab_runs_test_set" ON "public"."aqlab_runs" USING "btree" ("test_set_id");



CREATE INDEX "idx_aqlab_scores_output" ON "public"."aqlab_scores" USING "btree" ("run_output_id");



CREATE INDEX "idx_aqlab_tcf_fixture" ON "public"."aqlab_test_case_fixtures" USING "btree" ("fixture_document_id");



CREATE INDEX "idx_aqlab_test_cases_feature" ON "public"."aqlab_test_cases" USING "btree" ("feature_id");



CREATE INDEX "idx_aqlab_test_cases_set" ON "public"."aqlab_test_cases" USING "btree" ("test_set_id");



CREATE INDEX "idx_aqlab_test_cases_soort" ON "public"."aqlab_test_cases" USING "btree" ("soort");



CREATE INDEX "idx_aqlab_test_sets_feature" ON "public"."aqlab_test_sets" USING "btree" ("feature_id");



CREATE INDEX "idx_assump_dec" ON "public"."decision_assumptions" USING "btree" ("decision_id");



CREATE INDEX "idx_audit_snap_dec" ON "public"."decision_audit_snapshots" USING "btree" ("decision_id", "aangemaakt_op" DESC);



CREATE INDEX "idx_besluiten_proc" ON "public"."procedure_besluiten" USING "btree" ("procedure_id", "datum" DESC);



CREATE INDEX "idx_bewijs_stap" ON "public"."procedure_bewijs" USING "btree" ("stap_id", "toegevoegd_op" DESC);



CREATE INDEX "idx_bron_whitelist_log_entry" ON "public"."bron_whitelist_log" USING "btree" ("whitelist_id", "tijdstip" DESC);



CREATE INDEX "idx_bron_whitelist_review" ON "public"."bron_whitelist" USING "btree" ("review_datum");



CREATE INDEX "idx_bron_whitelist_status" ON "public"."bron_whitelist" USING "btree" ("status");



CREATE INDEX "idx_catalogus_log_fonds" ON "public"."catalogus_log" USING "btree" ("fonds_id", "tijdstip" DESC);



CREATE INDEX "idx_checklist_stap" ON "public"."procedure_checklist" USING "btree" ("stap_id", "volgorde");



CREATE INDEX "idx_chunks_bronsoort" ON "public"."document_chunks" USING "btree" ("bibliotheek");



CREATE INDEX "idx_chunks_denorm" ON "public"."document_chunks" USING "btree" ("bronstatus", "documentstatus", "procesinstantie_id");



CREATE INDEX "idx_chunks_document" ON "public"."document_chunks" USING "btree" ("document_id");



CREATE INDEX "idx_chunks_documentdatum" ON "public"."document_chunks" USING "btree" ("documentdatum");



CREATE INDEX "idx_chunks_embedding" ON "public"."document_chunks" USING "hnsw" ("embedding" "public"."vector_cosine_ops");



CREATE INDEX "idx_chunks_notulen_segment" ON "public"."document_chunks" USING "btree" ("notulen_segment_id") WHERE ("notulen_segment_id" IS NOT NULL);



CREATE INDEX "idx_chunks_procesinstantie" ON "public"."document_chunks" USING "btree" ("procesinstantie_id");



CREATE INDEX "idx_chunks_status_geldig" ON "public"."document_chunks" USING "btree" ("documentstatus", "bronstatus", "geldig_vanaf", "geldig_tot");



CREATE INDEX "idx_chunks_zoek" ON "public"."document_chunks" USING "gin" ("zoek_vector");



CREATE INDEX "idx_classificatie_document" ON "public"."classificatie_voorstellen" USING "btree" ("document_id");



CREATE INDEX "idx_classificatie_fonds_status" ON "public"."classificatie_voorstellen" USING "btree" ("fonds_id", "status");



CREATE INDEX "idx_comparison_results_fonds_finding" ON "public"."comparison_results" USING "btree" ("fonds_id", "finding_key");



CREATE INDEX "idx_comparison_results_run" ON "public"."comparison_results" USING "btree" ("comparison_run_id");



CREATE INDEX "idx_cond_dec" ON "public"."decision_conditions" USING "btree" ("decision_id");



CREATE INDEX "idx_config_log_fonds" ON "public"."fonds_config_log" USING "btree" ("fonds_id");



CREATE INDEX "idx_config_log_sleutel" ON "public"."fonds_config_log" USING "btree" ("fonds_id", "config_type", "config_sleutel", "versie" DESC);



CREATE INDEX "idx_config_log_tijd" ON "public"."fonds_config_log" USING "btree" ("aangemaakt" DESC);



CREATE INDEX "idx_contact_aanvragen_status" ON "public"."contact_aanvragen" USING "btree" ("status", "aangemaakt_op" DESC);



CREATE INDEX "idx_difference_judgements_fonds_finding" ON "public"."difference_judgements" USING "btree" ("fonds_id", "finding_key");



CREATE INDEX "idx_difference_judgements_user" ON "public"."difference_judgements" USING "btree" ("user_id");



CREATE INDEX "idx_dissent_dec" ON "public"."decision_dissent" USING "btree" ("decision_id");



CREATE INDEX "idx_dissent_stemming" ON "public"."decision_dissent" USING "btree" ("stemming_id") WHERE ("stemming_id" IS NOT NULL);



CREATE INDEX "idx_dobj_fonds" ON "public"."decision_objects" USING "btree" ("fonds_id", "aangemaakt_op" DESC);



CREATE UNIQUE INDEX "idx_dobj_one_primary" ON "public"."decision_objects" USING "btree" ("procedure_id") WHERE ("is_primary_decision" = true);



CREATE INDEX "idx_dobj_procedure" ON "public"."decision_objects" USING "btree" ("procedure_id");



CREATE INDEX "idx_dobj_status" ON "public"."decision_objects" USING "btree" ("fonds_id", "status");



CREATE INDEX "idx_doc_agenda_agendapunt" ON "public"."document_agendapunten" USING "btree" ("agendapunt_id");



CREATE INDEX "idx_doc_agenda_document" ON "public"."document_agendapunten" USING "btree" ("document_id");



CREATE INDEX "idx_doc_agenda_vergadering" ON "public"."document_agendapunten" USING "btree" ("vergadering_id");



CREATE INDEX "idx_doc_agendapunt" ON "public"."documenten" USING "btree" ("agendapunt_id");



CREATE INDEX "idx_doc_meta_log_doc" ON "public"."document_metadata_log" USING "btree" ("document_id", "tijdstip" DESC);



CREATE INDEX "idx_doc_meta_log_fonds" ON "public"."document_metadata_log" USING "btree" ("fonds_id", "tijdstip" DESC);



CREATE INDEX "idx_doc_proc_document" ON "public"."document_procesinstanties" USING "btree" ("document_id");



CREATE INDEX "idx_doc_proc_proc" ON "public"."document_procesinstanties" USING "btree" ("procesinstantie_id");



CREATE INDEX "idx_documenten_actief" ON "public"."documenten" USING "btree" ("actief") WHERE ("actief" = false);



CREATE INDEX "idx_documenten_bestandstype" ON "public"."documenten" USING "btree" ("bestandstype");



CREATE INDEX "idx_documenten_bronstatus" ON "public"."documenten" USING "btree" ("bronstatus");



CREATE INDEX "idx_documenten_fonds_status" ON "public"."documenten" USING "btree" ("fonds_id", "status", "actief");



CREATE INDEX "idx_documenten_procesinstantie" ON "public"."documenten" USING "btree" ("procesinstantie_id") WHERE ("procesinstantie_id" IS NOT NULL);



CREATE INDEX "idx_documenten_review" ON "public"."documenten" USING "btree" ("metadata_review_status") WHERE ("metadata_te_controleren" = true);



CREATE INDEX "idx_documenten_status" ON "public"."documenten" USING "btree" ("status");



CREATE INDEX "idx_documenten_vergadering" ON "public"."documenten" USING "btree" ("vergadering_id") WHERE ("vergadering_id" IS NOT NULL);



CREATE INDEX "idx_documenten_verwerkingsstatus" ON "public"."documenten" USING "btree" ("verwerkingsstatus") WHERE ("verwerkingsstatus" IS NOT NULL);



CREATE INDEX "idx_dpj_claim" ON "public"."document_processing_jobs" USING "btree" ("status", "aangemaakt") WHERE ("status" = ANY (ARRAY['wachtend'::"text", 'bezig'::"text"]));



CREATE INDEX "idx_dpj_correlatie" ON "public"."document_processing_jobs" USING "btree" ("correlatie_id");



CREATE INDEX "idx_dpj_document" ON "public"."document_processing_jobs" USING "btree" ("document_id", "aangemaakt");



CREATE INDEX "idx_dpj_status" ON "public"."document_processing_jobs" USING "btree" ("status") WHERE ("status" = ANY (ARRAY['wachtend'::"text", 'bezig'::"text", 'mislukt'::"text"]));



CREATE INDEX "idx_eigenaars_proc" ON "public"."procedure_eigenaars" USING "btree" ("procedure_id");



CREATE INDEX "idx_eval_dec" ON "public"."decision_evaluations" USING "btree" ("decision_id");



CREATE INDEX "idx_expertises_fonds" ON "public"."expertises" USING "btree" ("fonds_id", "sort_order");



CREATE INDEX "idx_export_fonds" ON "public"."governance_export_log" USING "btree" ("fonds_id");



CREATE INDEX "idx_export_tijd" ON "public"."governance_export_log" USING "btree" ("aangemaakt" DESC);



CREATE INDEX "idx_extraction_run_doc_catalog" ON "public"."extraction_run" USING "btree" ("document_id", "catalog_version");



CREATE INDEX "idx_extraction_run_document" ON "public"."extraction_run" USING "btree" ("document_id");



CREATE INDEX "idx_fase_toelichting_procedure" ON "public"."procedure_fase_toelichting" USING "btree" ("procedure_id");



CREATE INDEX "idx_focus_fonds" ON "public"."kritische_focusgebieden" USING "btree" ("fonds_id", "sort_order");



CREATE INDEX "idx_gesprek_gebruiker" ON "public"."gesprekken" USING "btree" ("gebruiker_id", "bijgewerkt" DESC) WHERE ("gearchiveerd" = false);



CREATE INDEX "idx_govevents_dec" ON "public"."governance_events" USING "btree" ("decision_id", "tijdstip" DESC);



CREATE INDEX "idx_govlog_gesprek_audit" ON "public"."governance_log" USING "btree" ("gesprek_audit_id") WHERE ("gesprek_audit_id" IS NOT NULL);



CREATE INDEX "idx_gremia_categorie" ON "public"."gremia" USING "btree" ("categorie") WHERE ("categorie" IS NOT NULL);



CREATE INDEX "idx_gremia_fonds" ON "public"."gremia" USING "btree" ("fonds_id", "sort_order");



CREATE INDEX "idx_inbreng_punt" ON "public"."agendapunt_inbreng" USING "btree" ("agendapunt_id", "aangemaakt");



CREATE INDEX "idx_inzage_doc" ON "public"."document_inzage" USING "btree" ("document_id", "aangemaakt" DESC);



CREATE INDEX "idx_inzage_fonds" ON "public"."document_inzage" USING "btree" ("fonds_id", "aangemaakt" DESC);



CREATE INDEX "idx_inzage_gebruiker" ON "public"."document_inzage" USING "btree" ("gebruiker_id", "aangemaakt" DESC);



CREATE INDEX "idx_log_fonds" ON "public"."governance_log" USING "btree" ("fonds_id");



CREATE INDEX "idx_log_gebruiker" ON "public"."governance_log" USING "btree" ("gebruiker_id");



CREATE INDEX "idx_log_tijd" ON "public"."governance_log" USING "btree" ("aangemaakt" DESC);



CREATE INDEX "idx_maatregelen_risico" ON "public"."risico_maatregelen" USING "btree" ("risico_id", "volgorde");



CREATE INDEX "idx_meta_review_fonds" ON "public"."document_metadata_review_queue" USING "btree" ("fonds_id", "status");



CREATE INDEX "idx_meta_review_status" ON "public"."document_metadata_review_queue" USING "btree" ("status");



CREATE INDEX "idx_notif_idempotent" ON "public"."notificaties" USING "btree" ("ontvanger_id", "type", "gerelateerd_aan_id", "aangemaakt" DESC);



CREATE INDEX "idx_notif_ongelezen" ON "public"."notificaties" USING "btree" ("ontvanger_id", "aangemaakt" DESC) WHERE ("gelezen_op" IS NULL);



CREATE INDEX "idx_notif_ontvanger_aangemaakt" ON "public"."notificaties" USING "btree" ("ontvanger_id", "aangemaakt" DESC);



CREATE INDEX "idx_notulen_seg_agendapunt_bevestigd" ON "public"."notulen_segmenten" USING "btree" ("agendapunt_id") WHERE "bevestigd";



CREATE INDEX "idx_notulen_seg_doc" ON "public"."notulen_segmenten" USING "btree" ("document_id", "segment_index");



CREATE INDEX "idx_pel_correlatie" ON "public"."platform_event_log" USING "btree" ("correlatie_id", "tijdstip");



CREATE INDEX "idx_pel_identity" ON "public"."platform_event_log" USING "btree" ("identity_id", "tijdstip" DESC);



CREATE INDEX "idx_pel_keten" ON "public"."platform_event_log" USING "btree" ("tijdstip" DESC, "id" DESC);



CREATE INDEX "idx_pic_identity" ON "public"."platform_identity_capabilities" USING "btree" ("identity_id");



CREATE INDEX "idx_pm_exp_pm" ON "public"."procesmodel_expertises" USING "btree" ("procesmodel_id");



CREATE INDEX "idx_pm_focus_pm" ON "public"."procesmodel_focusgebieden" USING "btree" ("procesmodel_id");



CREATE INDEX "idx_pm_gremia_pm" ON "public"."procesmodel_gremia" USING "btree" ("procesmodel_id");



CREATE INDEX "idx_proc_log_proc" ON "public"."procedure_log" USING "btree" ("procedure_id", "tijdstip" DESC);



CREATE INDEX "idx_procbesluit_decision" ON "public"."procedure_besluiten" USING "btree" ("decision_id");



CREATE INDEX "idx_procbewijs_documenttype" ON "public"."procedure_bewijs" USING "btree" ("documenttype") WHERE ("documenttype" IS NOT NULL);



CREATE INDEX "idx_procbewijs_stemming" ON "public"."procedure_bewijs" USING "btree" ("stemming_id") WHERE ("stemming_id" IS NOT NULL);



CREATE INDEX "idx_procedures_decision" ON "public"."procedures" USING "btree" ("decision_id");



CREATE INDEX "idx_procedures_fonds" ON "public"."procedures" USING "btree" ("fonds_id", "gestart_op" DESC);



CREATE INDEX "idx_procedures_procesmodel" ON "public"."procedures" USING "btree" ("procesmodel_id");



CREATE INDEX "idx_procedures_status" ON "public"."procedures" USING "btree" ("fonds_id", "status");



CREATE INDEX "idx_procesmodellen_fonds" ON "public"."procesmodellen" USING "btree" ("fonds_id", "generiek_procestype");



CREATE INDEX "idx_profiel_exp_profiel" ON "public"."profiel_expertises" USING "btree" ("profiel_id");



CREATE INDEX "idx_profiel_focus_profiel" ON "public"."profiel_focusgebieden" USING "btree" ("profiel_id");



CREATE INDEX "idx_profiel_grem_profiel" ON "public"."profiel_gremia" USING "btree" ("profiel_id");



CREATE INDEX "idx_profiel_log_fonds" ON "public"."profiel_log" USING "btree" ("fonds_id", "tijdstip" DESC);



CREATE INDEX "idx_pss_signaal_fonds_tijd" ON "public"."platform_signal_snapshots" USING "btree" ("signaal", "fonds_id", "tijdstip" DESC);



CREATE INDEX "idx_pss_signaal_tijd" ON "public"."platform_signal_snapshots" USING "btree" ("signaal", "tijdstip" DESC);



CREATE INDEX "idx_pss_tijd" ON "public"."platform_signal_snapshots" USING "btree" ("tijdstip" DESC);



CREATE INDEX "idx_rate_limit_lookup" ON "public"."rate_limit_events" USING "btree" ("gebruiker_id", "endpoint", "tijdstip" DESC);



CREATE INDEX "idx_reindex_runs_fonds" ON "public"."reindex_runs" USING "btree" ("fonds_id", "aangemaakt" DESC);



CREATE INDEX "idx_req_instance_decision" ON "public"."procedure_requirement_instance" USING "btree" ("decision_id", "stap_volgorde");



CREATE INDEX "idx_req_template" ON "public"."procedure_requirements" USING "btree" ("template_code", "stap_volgorde");



CREATE INDEX "idx_req_uitsluiting_decision" ON "public"."procedure_requirement_uitsluiting" USING "btree" ("decision_id");



CREATE UNIQUE INDEX "idx_req_uniek" ON "public"."procedure_requirements" USING "btree" ("template_code", "stap_volgorde", "requirement_type", COALESCE("documenttype", "label"));



CREATE INDEX "idx_risico_log_risico" ON "public"."risico_log" USING "btree" ("risico_id", "tijdstip" DESC);



CREATE INDEX "idx_risicos_categorie" ON "public"."risicos" USING "btree" ("fonds_id", "categorie");



CREATE INDEX "idx_risicos_fonds" ON "public"."risicos" USING "btree" ("fonds_id", "status", "aangemaakt" DESC);



CREATE INDEX "idx_risk_dec" ON "public"."decision_risks" USING "btree" ("decision_id");



CREATE INDEX "idx_semantic_units_concept" ON "public"."semantic_units" USING "btree" ("concept_id");



CREATE INDEX "idx_semantic_units_document_concept" ON "public"."semantic_units" USING "btree" ("document_id", "concept_id");



CREATE INDEX "idx_semantic_units_extraction_run" ON "public"."semantic_units" USING "btree" ("extraction_run_id");



CREATE INDEX "idx_semantic_units_fonds_document" ON "public"."semantic_units" USING "btree" ("fonds_id", "document_id");



CREATE INDEX "idx_stappen_proc" ON "public"."procedure_stappen" USING "btree" ("procedure_id", "volgorde");



CREATE INDEX "idx_stem_stemgerechtigde" ON "public"."stem_uitbrengingen" USING "btree" ("stemming_id", "stemgerechtigde_id");



CREATE INDEX "idx_stem_stemming" ON "public"."stem_uitbrengingen" USING "btree" ("stemming_id");



CREATE INDEX "idx_stemming_agendapunt" ON "public"."stemmingen" USING "btree" ("agendapunt_id");



CREATE INDEX "idx_stemming_decision" ON "public"."stemmingen" USING "btree" ("decision_id") WHERE ("decision_id" IS NOT NULL);



CREATE UNIQUE INDEX "idx_stemming_een_open" ON "public"."stemmingen" USING "btree" ("agendapunt_id") WHERE ("status" = 'open'::"text");



CREATE INDEX "idx_stuurinfo_log_fonds_tijd" ON "public"."fonds_stuurinfo_log" USING "btree" ("fonds_id", "aangemaakt" DESC);



CREATE INDEX "idx_stuurinfo_reeks_fonds_periode_reeks" ON "public"."fonds_stuurinfo_reeks" USING "btree" ("fonds_id", "periode", "reeks_key", "volgorde");



CREATE INDEX "idx_verg_fonds_actief" ON "public"."vergaderingen" USING "btree" ("fonds_id", "datum" DESC) WHERE ("gearchiveerd_op" IS NULL);



CREATE INDEX "idx_verg_fonds_datum" ON "public"."vergaderingen" USING "btree" ("fonds_id", "datum" DESC);



CREATE INDEX "idx_vergadering_log_verg" ON "public"."vergadering_log" USING "btree" ("vergadering_id", "aangemaakt" DESC);



CREATE INDEX "idx_voorbereiding_user" ON "public"."voorbereidingen" USING "btree" ("gebruiker_id", "bijgewerkt_op" DESC);



CREATE UNIQUE INDEX "tenant_domains_host_idx" ON "public"."tenant_domains" USING "btree" ("host");



CREATE UNIQUE INDEX "uq_aqlab_model_configurations_config_hash" ON "public"."aqlab_model_configurations" USING "btree" ("config_hash");



CREATE UNIQUE INDEX "uq_aqlab_run_outputs_run_tc_iter" ON "public"."aqlab_run_outputs" USING "btree" ("run_id", "test_case_id", "iteratie");



CREATE UNIQUE INDEX "uq_classificatie_actief_per_document" ON "public"."classificatie_voorstellen" USING "btree" ("document_id") WHERE ("status" = ANY (ARRAY['open'::"text", 'auto_toegepast'::"text"]));



CREATE UNIQUE INDEX "uq_dpj_open_stap" ON "public"."document_processing_jobs" USING "btree" ("document_id", "stap") WHERE ("status" = ANY (ARRAY['wachtend'::"text", 'bezig'::"text"]));



CREATE UNIQUE INDEX "uq_expertises_fonds_naam" ON "public"."expertises" USING "btree" ("fonds_id", "naam") WHERE ("fonds_id" IS NOT NULL);



CREATE UNIQUE INDEX "uq_expertises_template_naam" ON "public"."expertises" USING "btree" ("naam") WHERE ("fonds_id" IS NULL);



CREATE UNIQUE INDEX "uq_focus_fonds_naam" ON "public"."kritische_focusgebieden" USING "btree" ("fonds_id", "naam") WHERE ("fonds_id" IS NOT NULL);



CREATE UNIQUE INDEX "uq_focus_template_naam" ON "public"."kritische_focusgebieden" USING "btree" ("naam") WHERE ("fonds_id" IS NULL);



CREATE UNIQUE INDEX "uq_gremia_fonds_naam" ON "public"."gremia" USING "btree" ("fonds_id", "naam") WHERE ("fonds_id" IS NOT NULL);



CREATE UNIQUE INDEX "uq_gremia_template_naam" ON "public"."gremia" USING "btree" ("naam") WHERE ("fonds_id" IS NULL);



CREATE UNIQUE INDEX "ux_bron_whitelist_domein_match" ON "public"."bron_whitelist" USING "btree" ("domein", "matchtype", COALESCE("pad", ''::"text"));



CREATE UNIQUE INDEX "ux_documenten_generiek_hash" ON "public"."documenten" USING "btree" ("bestand_hash") WHERE (("bibliotheek" = 'generiek'::"text") AND ("bestand_hash" IS NOT NULL));



CREATE UNIQUE INDEX "ux_pel_correlatie_fase" ON "public"."platform_event_log" USING "btree" ("correlatie_id", "fase");



CREATE UNIQUE INDEX "ux_pic_actief" ON "public"."platform_identity_capabilities" USING "btree" ("identity_id", "capability") WHERE ("ingetrokken_op" IS NULL);



CREATE OR REPLACE TRIGGER "trg_afschrift_bevries_kolommen" BEFORE UPDATE ON "public"."procedure_afschriften" FOR EACH ROW EXECUTE FUNCTION "public"."fn_afschrift_bevries_kolommen"();



CREATE OR REPLACE TRIGGER "trg_agendapunt_log_no_delete" BEFORE DELETE ON "public"."agendapunt_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_agendapunt_log_no_update" BEFORE UPDATE ON "public"."agendapunt_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_aqlab_audit_exports_no_delete" BEFORE DELETE ON "public"."aqlab_audit_exports" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_aqlab_audit_exports_no_update" BEFORE UPDATE ON "public"."aqlab_audit_exports" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_aqlab_log_no_delete" BEFORE DELETE ON "public"."aqlab_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_aqlab_log_no_update" BEFORE UPDATE ON "public"."aqlab_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_aqlab_release_decisions_no_delete" BEFORE DELETE ON "public"."aqlab_release_decisions" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_aqlab_release_decisions_no_update" BEFORE UPDATE ON "public"."aqlab_release_decisions" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_audit_inzage_no_delete" BEFORE DELETE ON "public"."governance_audit_inzage" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_audit_inzage_no_update" BEFORE UPDATE ON "public"."governance_audit_inzage" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_bron_whitelist_log_hash" BEFORE INSERT ON "public"."bron_whitelist_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_bron_whitelist_log_hash"();



CREATE OR REPLACE TRIGGER "trg_bron_whitelist_log_no_delete" BEFORE DELETE ON "public"."bron_whitelist_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_bron_whitelist_log_immutable"();



CREATE OR REPLACE TRIGGER "trg_bron_whitelist_log_no_update" BEFORE UPDATE ON "public"."bron_whitelist_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_bron_whitelist_log_immutable"();



CREATE OR REPLACE TRIGGER "trg_chunk_denorm_before_insert" BEFORE INSERT ON "public"."document_chunks" FOR EACH ROW EXECUTE FUNCTION "public"."fn_chunk_denorm_before_insert"();



CREATE OR REPLACE TRIGGER "trg_chunk_denorm_refresh" AFTER UPDATE OF "procesinstantie_id", "vergadering_id", "agendapunt_id", "documenttype", "status", "bronstatus", "documentdatum", "geldig_vanaf", "geldig_tot", "bibliotheek", "bronorganisatie", "normgewicht", "extern_url", "wettelijk_regime" ON "public"."documenten" FOR EACH ROW EXECUTE FUNCTION "public"."fn_chunk_denorm_refresh"();



CREATE OR REPLACE TRIGGER "trg_comparison_results_no_delete" BEFORE DELETE ON "public"."comparison_results" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_comparison_results_no_update" BEFORE UPDATE ON "public"."comparison_results" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_comparison_run_no_delete" BEFORE DELETE ON "public"."comparison_run" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_comparison_run_no_update" BEFORE UPDATE ON "public"."comparison_run" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_contact_aanvragen_no_delete" BEFORE DELETE ON "public"."contact_aanvragen" FOR EACH ROW EXECUTE FUNCTION "public"."fn_contact_aanvragen_no_delete"();



CREATE OR REPLACE TRIGGER "trg_decision_code" BEFORE INSERT ON "public"."decision_objects" FOR EACH ROW EXECUTE FUNCTION "public"."fn_decision_code"();



CREATE OR REPLACE TRIGGER "trg_decision_snapshot" AFTER UPDATE OF "status" ON "public"."decision_objects" FOR EACH ROW EXECUTE FUNCTION "public"."fn_decision_snapshot"();



CREATE OR REPLACE TRIGGER "trg_decision_status_check" BEFORE UPDATE OF "status" ON "public"."decision_objects" FOR EACH ROW EXECUTE FUNCTION "public"."fn_decision_status_check"();



CREATE OR REPLACE TRIGGER "trg_decision_touch" BEFORE UPDATE ON "public"."decision_objects" FOR EACH ROW EXECUTE FUNCTION "public"."fn_decision_touch"();



CREATE OR REPLACE TRIGGER "trg_difference_judgements_no_delete" BEFORE DELETE ON "public"."difference_judgements" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_difference_judgements_no_update" BEFORE UPDATE ON "public"."difference_judgements" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_doc_meta_log_hash" BEFORE INSERT ON "public"."document_metadata_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_doc_meta_log_hash"();



CREATE OR REPLACE TRIGGER "trg_doc_meta_log_no_delete" BEFORE DELETE ON "public"."document_metadata_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_doc_meta_log_immutable"();



CREATE OR REPLACE TRIGGER "trg_doc_meta_log_no_update" BEFORE UPDATE ON "public"."document_metadata_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_doc_meta_log_immutable"();



CREATE OR REPLACE TRIGGER "trg_document_agendapunt_validatie" BEFORE INSERT OR UPDATE ON "public"."document_agendapunten" FOR EACH ROW EXECUTE FUNCTION "public"."fn_document_agendapunt_validatie"();



CREATE OR REPLACE TRIGGER "trg_document_agendapunt_vergadering" BEFORE INSERT OR UPDATE OF "agendapunt_id", "vergadering_id" ON "public"."documenten" FOR EACH ROW EXECUTE FUNCTION "public"."fn_document_agendapunt_vergadering_check"();



CREATE OR REPLACE TRIGGER "trg_document_primair_vs_secundair" BEFORE UPDATE OF "procesinstantie_id" ON "public"."documenten" FOR EACH ROW EXECUTE FUNCTION "public"."fn_document_primair_vs_secundair_check"();



CREATE OR REPLACE TRIGGER "trg_document_procesinstantie_fonds" BEFORE INSERT OR UPDATE OF "procesinstantie_id", "fonds_id" ON "public"."documenten" FOR EACH ROW EXECUTE FUNCTION "public"."fn_document_procesinstantie_fonds_check"();



CREATE OR REPLACE TRIGGER "trg_document_procesinstantie_validatie" BEFORE INSERT OR UPDATE ON "public"."document_procesinstanties" FOR EACH ROW EXECUTE FUNCTION "public"."fn_document_procesinstantie_validatie"();



CREATE OR REPLACE TRIGGER "trg_document_status_overgang" BEFORE UPDATE OF "status" ON "public"."documenten" FOR EACH ROW EXECUTE FUNCTION "public"."fn_document_status_overgang_check"();



CREATE OR REPLACE TRIGGER "trg_export_log_no_delete" BEFORE DELETE ON "public"."governance_export_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_export_log_immutable"();



CREATE OR REPLACE TRIGGER "trg_export_log_no_update" BEFORE UPDATE ON "public"."governance_export_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_export_log_immutable"();



CREATE OR REPLACE TRIGGER "trg_extraction_run_no_delete" BEFORE DELETE ON "public"."extraction_run" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_extraction_run_no_update" BEFORE UPDATE ON "public"."extraction_run" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_fonds_config_log_no_delete" BEFORE DELETE ON "public"."fonds_config_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_fonds_config_log_no_update" BEFORE UPDATE ON "public"."fonds_config_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_fonds_flags_audit" AFTER INSERT OR UPDATE ON "public"."fonds_feature_flags" FOR EACH ROW EXECUTE FUNCTION "public"."fn_fonds_config_capture"();



CREATE OR REPLACE TRIGGER "trg_fonds_manifest_audit" AFTER INSERT OR UPDATE ON "public"."fonds_module_manifest" FOR EACH ROW EXECUTE FUNCTION "public"."fn_fonds_config_capture"();



CREATE OR REPLACE TRIGGER "trg_fonds_overrides_audit" AFTER INSERT OR UPDATE ON "public"."fonds_content_overrides" FOR EACH ROW EXECUTE FUNCTION "public"."fn_fonds_config_capture"();



CREATE OR REPLACE TRIGGER "trg_fonds_stuurinfo_kpi_audit" AFTER INSERT OR UPDATE ON "public"."fonds_stuurinfo_kpi" FOR EACH ROW EXECUTE FUNCTION "public"."fn_fonds_stuurinfo_capture"();



CREATE OR REPLACE TRIGGER "trg_fonds_stuurinfo_log_no_delete" BEFORE DELETE ON "public"."fonds_stuurinfo_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_fonds_stuurinfo_log_no_update" BEFORE UPDATE ON "public"."fonds_stuurinfo_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_fonds_stuurinfo_periode_audit" AFTER INSERT OR UPDATE ON "public"."fonds_stuurinfo_periode" FOR EACH ROW EXECUTE FUNCTION "public"."fn_fonds_stuurinfo_capture"();



CREATE OR REPLACE TRIGGER "trg_fonds_stuurinfo_reeks_audit" AFTER INSERT OR UPDATE ON "public"."fonds_stuurinfo_reeks" FOR EACH ROW EXECUTE FUNCTION "public"."fn_fonds_stuurinfo_capture"();



CREATE OR REPLACE TRIGGER "trg_fonds_stuurinfo_reserve_audit" AFTER INSERT OR UPDATE ON "public"."fonds_stuurinfo_reserve" FOR EACH ROW EXECUTE FUNCTION "public"."fn_fonds_stuurinfo_capture"();



CREATE OR REPLACE TRIGGER "trg_fonds_theming_audit" AFTER INSERT OR UPDATE ON "public"."fonds_theming" FOR EACH ROW EXECUTE FUNCTION "public"."fn_fonds_config_capture"();



CREATE OR REPLACE TRIGGER "trg_generiek_status_overgang" BEFORE UPDATE ON "public"."documenten" FOR EACH ROW EXECUTE FUNCTION "public"."fn_generiek_status_overgang_check"();



CREATE OR REPLACE TRIGGER "trg_governance_log_no_delete" BEFORE DELETE ON "public"."governance_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_governance_log_no_update" BEFORE UPDATE ON "public"."governance_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_govevent_hash" BEFORE INSERT ON "public"."governance_events" FOR EACH ROW EXECUTE FUNCTION "public"."fn_govevent_hash"();



CREATE OR REPLACE TRIGGER "trg_govevent_no_delete" BEFORE DELETE ON "public"."governance_events" FOR EACH ROW EXECUTE FUNCTION "public"."fn_govevent_immutable"();



CREATE OR REPLACE TRIGGER "trg_govevent_no_update" BEFORE UPDATE ON "public"."governance_events" FOR EACH ROW EXECUTE FUNCTION "public"."fn_govevent_immutable"();



CREATE OR REPLACE TRIGGER "trg_notulen_segment_check" BEFORE INSERT OR UPDATE ON "public"."notulen_segmenten" FOR EACH ROW EXECUTE FUNCTION "public"."fn_notulen_segment_check"();



CREATE OR REPLACE TRIGGER "trg_organisatie_profielen_touch" BEFORE UPDATE ON "public"."organisatie_profielen" FOR EACH ROW EXECUTE FUNCTION "public"."fn_organisatie_profielen_touch"();



CREATE OR REPLACE TRIGGER "trg_platform_event_hash" BEFORE INSERT ON "public"."platform_event_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_platform_event_hash"();



CREATE OR REPLACE TRIGGER "trg_platform_event_no_delete" BEFORE DELETE ON "public"."platform_event_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_platform_event_immutable"();



CREATE OR REPLACE TRIGGER "trg_platform_event_no_update" BEFORE UPDATE ON "public"."platform_event_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_platform_event_immutable"();



CREATE OR REPLACE TRIGGER "trg_procedure_afschriften_no_delete" BEFORE DELETE ON "public"."procedure_afschriften" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_procedure_log_no_delete" BEFORE DELETE ON "public"."procedure_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_procedure_log_no_update" BEFORE UPDATE ON "public"."procedure_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_profiel_bevries_kolommen" BEFORE UPDATE ON "public"."profielen" FOR EACH ROW EXECUTE FUNCTION "public"."fn_profiel_bevries_kolommen"();



CREATE OR REPLACE TRIGGER "trg_redacties_no_delete" BEFORE DELETE ON "public"."governance_redacties" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_redacties_no_update" BEFORE UPDATE ON "public"."governance_redacties" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_risico_log_no_delete" BEFORE DELETE ON "public"."risico_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_risico_log_no_update" BEFORE UPDATE ON "public"."risico_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_snap_no_delete" BEFORE DELETE ON "public"."decision_audit_snapshots" FOR EACH ROW EXECUTE FUNCTION "public"."fn_snapshot_immutable"();



CREATE OR REPLACE TRIGGER "trg_snap_no_update" BEFORE UPDATE ON "public"."decision_audit_snapshots" FOR EACH ROW EXECUTE FUNCTION "public"."fn_snapshot_immutable"();



CREATE OR REPLACE TRIGGER "trg_vergadering_log_no_delete" BEFORE DELETE ON "public"."vergadering_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_vergadering_log_no_update" BEFORE UPDATE ON "public"."vergadering_log" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_append_only"();



ALTER TABLE ONLY "public"."agendapunt_inbreng"
    ADD CONSTRAINT "agendapunt_inbreng_agendapunt_id_fkey" FOREIGN KEY ("agendapunt_id") REFERENCES "public"."agendapunten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agendapunt_inbreng"
    ADD CONSTRAINT "agendapunt_inbreng_gebruiker_id_fkey" FOREIGN KEY ("gebruiker_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."agendapunt_log"
    ADD CONSTRAINT "agendapunt_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."agendapunt_log"
    ADD CONSTRAINT "agendapunt_log_agendapunt_id_fkey" FOREIGN KEY ("agendapunt_id") REFERENCES "public"."agendapunten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agendapunten"
    ADD CONSTRAINT "agendapunten_aangemaakt_door_fkey" FOREIGN KEY ("aangemaakt_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."agendapunten"
    ADD CONSTRAINT "agendapunten_gewijzigd_door_fkey" FOREIGN KEY ("gewijzigd_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."agendapunten"
    ADD CONSTRAINT "agendapunten_procedure_stap_id_fkey" FOREIGN KEY ("procedure_stap_id") REFERENCES "public"."procedure_stappen"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."agendapunten"
    ADD CONSTRAINT "agendapunten_vergadering_id_fkey" FOREIGN KEY ("vergadering_id") REFERENCES "public"."vergaderingen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agendapunten"
    ADD CONSTRAINT "agendapunten_verwijderd_door_fkey" FOREIGN KEY ("verwijderd_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."app_errors"
    ADD CONSTRAINT "app_errors_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aqlab_ai_features"
    ADD CONSTRAINT "aqlab_ai_features_aangemaakt_door_fkey" FOREIGN KEY ("aangemaakt_door") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."aqlab_audit_exports"
    ADD CONSTRAINT "aqlab_audit_exports_besluit_door_fkey" FOREIGN KEY ("besluit_door") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."aqlab_audit_exports"
    ADD CONSTRAINT "aqlab_audit_exports_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "public"."aqlab_ai_features"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aqlab_audit_exports"
    ADD CONSTRAINT "aqlab_audit_exports_gegenereerd_door_fkey" FOREIGN KEY ("gegenereerd_door") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."aqlab_audit_exports"
    ADD CONSTRAINT "aqlab_audit_exports_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."aqlab_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aqlab_findings"
    ADD CONSTRAINT "aqlab_findings_run_output_id_fkey" FOREIGN KEY ("run_output_id") REFERENCES "public"."aqlab_run_outputs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."aqlab_findings"
    ADD CONSTRAINT "aqlab_findings_score_id_fkey" FOREIGN KEY ("score_id") REFERENCES "public"."aqlab_scores"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."aqlab_fixture_documents"
    ADD CONSTRAINT "aqlab_fixture_documents_aangemaakt_door_fkey" FOREIGN KEY ("aangemaakt_door") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."aqlab_fixture_documents"
    ADD CONSTRAINT "aqlab_fixture_documents_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "public"."aqlab_ai_features"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aqlab_human_reviews"
    ADD CONSTRAINT "aqlab_human_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."aqlab_human_reviews"
    ADD CONSTRAINT "aqlab_human_reviews_run_output_id_fkey" FOREIGN KEY ("run_output_id") REFERENCES "public"."aqlab_run_outputs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."aqlab_log"
    ADD CONSTRAINT "aqlab_log_gebruiker_id_fkey" FOREIGN KEY ("gebruiker_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."aqlab_model_configurations"
    ADD CONSTRAINT "aqlab_model_configurations_aangemaakt_door_fkey" FOREIGN KEY ("aangemaakt_door") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."aqlab_prompt_versions"
    ADD CONSTRAINT "aqlab_prompt_versions_aangemaakt_door_fkey" FOREIGN KEY ("aangemaakt_door") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."aqlab_prompt_versions"
    ADD CONSTRAINT "aqlab_prompt_versions_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "public"."aqlab_ai_features"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."aqlab_release_decisions"
    ADD CONSTRAINT "aqlab_release_audit_export_fk" FOREIGN KEY ("audit_export_id") REFERENCES "public"."aqlab_audit_exports"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aqlab_release_decisions"
    ADD CONSTRAINT "aqlab_release_decisions_besluit_door_fkey" FOREIGN KEY ("besluit_door") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."aqlab_release_decisions"
    ADD CONSTRAINT "aqlab_release_decisions_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "public"."aqlab_ai_features"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aqlab_release_decisions"
    ADD CONSTRAINT "aqlab_release_decisions_model_configuration_id_fkey" FOREIGN KEY ("model_configuration_id") REFERENCES "public"."aqlab_model_configurations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aqlab_release_decisions"
    ADD CONSTRAINT "aqlab_release_decisions_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."aqlab_prompt_versions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aqlab_release_decisions"
    ADD CONSTRAINT "aqlab_release_decisions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."aqlab_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aqlab_run_jobs"
    ADD CONSTRAINT "aqlab_run_jobs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."aqlab_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."aqlab_run_jobs"
    ADD CONSTRAINT "aqlab_run_jobs_test_case_id_fkey" FOREIGN KEY ("test_case_id") REFERENCES "public"."aqlab_test_cases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aqlab_run_outputs"
    ADD CONSTRAINT "aqlab_run_outputs_gestart_door_fkey" FOREIGN KEY ("gestart_door") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."aqlab_run_outputs"
    ADD CONSTRAINT "aqlab_run_outputs_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."aqlab_prompt_versions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aqlab_run_outputs"
    ADD CONSTRAINT "aqlab_run_outputs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."aqlab_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."aqlab_run_outputs"
    ADD CONSTRAINT "aqlab_run_outputs_test_case_id_fkey" FOREIGN KEY ("test_case_id") REFERENCES "public"."aqlab_test_cases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aqlab_runs"
    ADD CONSTRAINT "aqlab_runs_baseline_run_id_fkey" FOREIGN KEY ("baseline_run_id") REFERENCES "public"."aqlab_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aqlab_runs"
    ADD CONSTRAINT "aqlab_runs_gestart_door_fkey" FOREIGN KEY ("gestart_door") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."aqlab_runs"
    ADD CONSTRAINT "aqlab_runs_model_configuration_id_fkey" FOREIGN KEY ("model_configuration_id") REFERENCES "public"."aqlab_model_configurations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aqlab_runs"
    ADD CONSTRAINT "aqlab_runs_promoted_testcase_id_fkey" FOREIGN KEY ("promoted_testcase_id") REFERENCES "public"."aqlab_test_cases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aqlab_runs"
    ADD CONSTRAINT "aqlab_runs_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."aqlab_prompt_versions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aqlab_runs"
    ADD CONSTRAINT "aqlab_runs_test_set_id_fkey" FOREIGN KEY ("test_set_id") REFERENCES "public"."aqlab_test_sets"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aqlab_scores"
    ADD CONSTRAINT "aqlab_scores_beoordeeld_door_fkey" FOREIGN KEY ("beoordeeld_door") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."aqlab_scores"
    ADD CONSTRAINT "aqlab_scores_run_output_id_fkey" FOREIGN KEY ("run_output_id") REFERENCES "public"."aqlab_run_outputs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."aqlab_test_case_fixtures"
    ADD CONSTRAINT "aqlab_test_case_fixtures_fixture_document_id_fkey" FOREIGN KEY ("fixture_document_id") REFERENCES "public"."aqlab_fixture_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."aqlab_test_case_fixtures"
    ADD CONSTRAINT "aqlab_test_case_fixtures_test_case_id_fkey" FOREIGN KEY ("test_case_id") REFERENCES "public"."aqlab_test_cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."aqlab_test_cases"
    ADD CONSTRAINT "aqlab_test_cases_aangemaakt_door_fkey" FOREIGN KEY ("aangemaakt_door") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."aqlab_test_cases"
    ADD CONSTRAINT "aqlab_test_cases_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "public"."aqlab_ai_features"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aqlab_test_cases"
    ADD CONSTRAINT "aqlab_test_cases_test_set_id_fkey" FOREIGN KEY ("test_set_id") REFERENCES "public"."aqlab_test_sets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."aqlab_test_sets"
    ADD CONSTRAINT "aqlab_test_sets_aangemaakt_door_fkey" FOREIGN KEY ("aangemaakt_door") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."aqlab_test_sets"
    ADD CONSTRAINT "aqlab_test_sets_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "public"."aqlab_ai_features"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."catalogus_log"
    ADD CONSTRAINT "catalogus_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."catalogus_log"
    ADD CONSTRAINT "catalogus_log_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."classificatie_voorstellen"
    ADD CONSTRAINT "classificatie_voorstellen_beoordeeld_door_fkey" FOREIGN KEY ("beoordeeld_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."classificatie_voorstellen"
    ADD CONSTRAINT "classificatie_voorstellen_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documenten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."classificatie_voorstellen"
    ADD CONSTRAINT "classificatie_voorstellen_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."classificatie_voorstellen"
    ADD CONSTRAINT "classificatie_voorstellen_voorgestelde_procesinstantie_id_fkey" FOREIGN KEY ("voorgestelde_procesinstantie_id") REFERENCES "public"."procedures"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."comparison_results"
    ADD CONSTRAINT "comparison_results_bron_document_id_fkey" FOREIGN KEY ("bron_document_id") REFERENCES "public"."documenten"("id");



ALTER TABLE ONLY "public"."comparison_results"
    ADD CONSTRAINT "comparison_results_comparison_run_id_fkey" FOREIGN KEY ("comparison_run_id") REFERENCES "public"."comparison_run"("id");



ALTER TABLE ONLY "public"."comparison_results"
    ADD CONSTRAINT "comparison_results_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id");



ALTER TABLE ONLY "public"."comparison_results"
    ADD CONSTRAINT "comparison_results_doel_document_id_fkey" FOREIGN KEY ("doel_document_id") REFERENCES "public"."documenten"("id");



ALTER TABLE ONLY "public"."comparison_results"
    ADD CONSTRAINT "comparison_results_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id");



ALTER TABLE ONLY "public"."comparison_run"
    ADD CONSTRAINT "comparison_run_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id");



ALTER TABLE ONLY "public"."decision_actions"
    ADD CONSTRAINT "decision_actions_afhankelijk_van_fkey" FOREIGN KEY ("afhankelijk_van") REFERENCES "public"."decision_actions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."decision_actions"
    ADD CONSTRAINT "decision_actions_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "public"."decision_objects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."decision_actions"
    ADD CONSTRAINT "decision_actions_voorwaarde_id_fkey" FOREIGN KEY ("voorwaarde_id") REFERENCES "public"."decision_conditions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."decision_ai_interactions"
    ADD CONSTRAINT "decision_ai_interactions_aangemaakt_door_fkey" FOREIGN KEY ("aangemaakt_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."decision_ai_interactions"
    ADD CONSTRAINT "decision_ai_interactions_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "public"."decision_objects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."decision_ai_interactions"
    ADD CONSTRAINT "decision_ai_interactions_gevalideerd_door_fkey" FOREIGN KEY ("gevalideerd_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."decision_ai_interactions"
    ADD CONSTRAINT "decision_ai_interactions_procedure_stap_id_fkey" FOREIGN KEY ("procedure_stap_id") REFERENCES "public"."procedure_stappen"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."decision_assumptions"
    ADD CONSTRAINT "decision_assumptions_bron_document_id_fkey" FOREIGN KEY ("bron_document_id") REFERENCES "public"."documenten"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."decision_assumptions"
    ADD CONSTRAINT "decision_assumptions_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "public"."decision_objects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."decision_assumptions"
    ADD CONSTRAINT "decision_assumptions_gewijzigd_door_fkey" FOREIGN KEY ("gewijzigd_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."decision_audit_snapshots"
    ADD CONSTRAINT "decision_audit_snapshots_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "public"."decision_objects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."decision_conditions"
    ADD CONSTRAINT "decision_conditions_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "public"."decision_objects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."decision_dissent"
    ADD CONSTRAINT "decision_dissent_bestuurder_id_fkey" FOREIGN KEY ("bestuurder_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."decision_dissent"
    ADD CONSTRAINT "decision_dissent_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "public"."decision_objects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."decision_dissent"
    ADD CONSTRAINT "decision_dissent_gekoppeld_aanname_id_fkey" FOREIGN KEY ("gekoppeld_aanname_id") REFERENCES "public"."decision_assumptions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."decision_dissent"
    ADD CONSTRAINT "decision_dissent_gekoppeld_risico_id_fkey" FOREIGN KEY ("gekoppeld_risico_id") REFERENCES "public"."decision_risks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."decision_dissent"
    ADD CONSTRAINT "decision_dissent_stemming_id_fkey" FOREIGN KEY ("stemming_id") REFERENCES "public"."stemmingen"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."decision_dissent"
    ADD CONSTRAINT "decision_dissent_voorwaarde_fk" FOREIGN KEY ("gekoppeld_voorwaarde_id") REFERENCES "public"."decision_conditions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."decision_evaluations"
    ADD CONSTRAINT "decision_evaluations_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "public"."decision_objects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."decision_evaluations"
    ADD CONSTRAINT "decision_evaluations_uitgevoerd_door_fkey" FOREIGN KEY ("uitgevoerd_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."decision_objects"
    ADD CONSTRAINT "decision_objects_eigenaar_id_fkey" FOREIGN KEY ("eigenaar_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."decision_objects"
    ADD CONSTRAINT "decision_objects_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."decision_objects"
    ADD CONSTRAINT "decision_objects_procedure_id_fkey" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."decision_risks"
    ADD CONSTRAINT "decision_risks_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "public"."decision_objects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."decision_risks"
    ADD CONSTRAINT "decision_risks_risicomatrix_id_fkey" FOREIGN KEY ("risicomatrix_id") REFERENCES "public"."risicos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."difference_judgements"
    ADD CONSTRAINT "difference_judgements_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id");



ALTER TABLE ONLY "public"."difference_judgements"
    ADD CONSTRAINT "difference_judgements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profielen"("id");



ALTER TABLE ONLY "public"."document_agendapunten"
    ADD CONSTRAINT "document_agendapunten_aangemaakt_door_fkey" FOREIGN KEY ("aangemaakt_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_agendapunten"
    ADD CONSTRAINT "document_agendapunten_agendapunt_id_fkey" FOREIGN KEY ("agendapunt_id") REFERENCES "public"."agendapunten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_agendapunten"
    ADD CONSTRAINT "document_agendapunten_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documenten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_agendapunten"
    ADD CONSTRAINT "document_agendapunten_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_agendapunten"
    ADD CONSTRAINT "document_agendapunten_vergadering_id_fkey" FOREIGN KEY ("vergadering_id") REFERENCES "public"."vergaderingen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_chunks"
    ADD CONSTRAINT "document_chunks_agendapunt_id_fkey" FOREIGN KEY ("agendapunt_id") REFERENCES "public"."agendapunten"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_chunks"
    ADD CONSTRAINT "document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documenten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_chunks"
    ADD CONSTRAINT "document_chunks_notulen_segment_id_fkey" FOREIGN KEY ("notulen_segment_id") REFERENCES "public"."notulen_segmenten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_chunks"
    ADD CONSTRAINT "document_chunks_procesinstantie_id_fkey" FOREIGN KEY ("procesinstantie_id") REFERENCES "public"."procedures"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_chunks"
    ADD CONSTRAINT "document_chunks_procesmodel_id_fkey" FOREIGN KEY ("procesmodel_id") REFERENCES "public"."procesmodellen"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_chunks"
    ADD CONSTRAINT "document_chunks_vergadering_id_fkey" FOREIGN KEY ("vergadering_id") REFERENCES "public"."vergaderingen"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_inzage"
    ADD CONSTRAINT "document_inzage_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documenten"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_inzage"
    ADD CONSTRAINT "document_inzage_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_inzage"
    ADD CONSTRAINT "document_inzage_gebruiker_id_fkey" FOREIGN KEY ("gebruiker_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_metadata_log"
    ADD CONSTRAINT "document_metadata_log_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_metadata_log"
    ADD CONSTRAINT "document_metadata_log_gewijzigd_door_fkey" FOREIGN KEY ("gewijzigd_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_metadata_review_queue"
    ADD CONSTRAINT "document_metadata_review_queue_beoordeeld_door_fkey" FOREIGN KEY ("beoordeeld_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_metadata_review_queue"
    ADD CONSTRAINT "document_metadata_review_queue_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documenten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_metadata_review_queue"
    ADD CONSTRAINT "document_metadata_review_queue_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_procesinstanties"
    ADD CONSTRAINT "document_procesinstanties_aangemaakt_door_fkey" FOREIGN KEY ("aangemaakt_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_procesinstanties"
    ADD CONSTRAINT "document_procesinstanties_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documenten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_procesinstanties"
    ADD CONSTRAINT "document_procesinstanties_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_procesinstanties"
    ADD CONSTRAINT "document_procesinstanties_procesinstantie_id_fkey" FOREIGN KEY ("procesinstantie_id") REFERENCES "public"."procedures"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_processing_jobs"
    ADD CONSTRAINT "document_processing_jobs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documenten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_processing_jobs"
    ADD CONSTRAINT "document_processing_jobs_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_processing_jobs"
    ADD CONSTRAINT "document_processing_jobs_versie_id_fkey" FOREIGN KEY ("versie_id") REFERENCES "public"."documenten"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."documenten"
    ADD CONSTRAINT "documenten_agendapunt_id_fkey" FOREIGN KEY ("agendapunt_id") REFERENCES "public"."agendapunten"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."documenten"
    ADD CONSTRAINT "documenten_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id");



ALTER TABLE ONLY "public"."documenten"
    ADD CONSTRAINT "documenten_gedeactiveerd_door_fkey" FOREIGN KEY ("gedeactiveerd_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."documenten"
    ADD CONSTRAINT "documenten_metadata_gecontroleerd_door_fkey" FOREIGN KEY ("metadata_gecontroleerd_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."documenten"
    ADD CONSTRAINT "documenten_opgeslagen_door_fkey" FOREIGN KEY ("opgeslagen_door") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."documenten"
    ADD CONSTRAINT "documenten_procesinstantie_id_fkey" FOREIGN KEY ("procesinstantie_id") REFERENCES "public"."procedures"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."documenten"
    ADD CONSTRAINT "documenten_vergadering_id_fkey" FOREIGN KEY ("vergadering_id") REFERENCES "public"."vergaderingen"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."documenten"
    ADD CONSTRAINT "documenten_vervangen_door_document_id_fkey" FOREIGN KEY ("vervangen_door_document_id") REFERENCES "public"."documenten"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."documenten"
    ADD CONSTRAINT "documenten_vervangt_document_id_fkey" FOREIGN KEY ("vervangt_document_id") REFERENCES "public"."documenten"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."expertises"
    ADD CONSTRAINT "expertises_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expertises"
    ADD CONSTRAINT "expertises_gekopieerd_van_id_fkey" FOREIGN KEY ("gekopieerd_van_id") REFERENCES "public"."expertises"("id");



ALTER TABLE ONLY "public"."extraction_run"
    ADD CONSTRAINT "extraction_run_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documenten"("id");



ALTER TABLE ONLY "public"."extraction_run"
    ADD CONSTRAINT "extraction_run_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id");



ALTER TABLE ONLY "public"."profielen"
    ADD CONSTRAINT "fk_profielen_primaire_expertise" FOREIGN KEY ("fonds_id", "primaire_expertise_id") REFERENCES "public"."expertises"("fonds_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."semantic_units"
    ADD CONSTRAINT "fk_semantic_units_concept_type" FOREIGN KEY ("concept_id", "type") REFERENCES "public"."concepts"("id", "type");



ALTER TABLE ONLY "public"."fonds_config_log"
    ADD CONSTRAINT "fonds_config_log_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fonds_config_log"
    ADD CONSTRAINT "fonds_config_log_gebruiker_id_fkey" FOREIGN KEY ("gebruiker_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."fonds_content_overrides"
    ADD CONSTRAINT "fonds_content_overrides_bijgewerkt_door_fkey" FOREIGN KEY ("bijgewerkt_door") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."fonds_content_overrides"
    ADD CONSTRAINT "fonds_content_overrides_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fonds_feature_flags"
    ADD CONSTRAINT "fonds_feature_flags_bijgewerkt_door_fkey" FOREIGN KEY ("bijgewerkt_door") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."fonds_feature_flags"
    ADD CONSTRAINT "fonds_feature_flags_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fonds_instellingen"
    ADD CONSTRAINT "fonds_instellingen_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fonds_klantbeeld_cohort"
    ADD CONSTRAINT "fonds_klantbeeld_cohort_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fonds_module_manifest"
    ADD CONSTRAINT "fonds_module_manifest_bijgewerkt_door_fkey" FOREIGN KEY ("bijgewerkt_door") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."fonds_module_manifest"
    ADD CONSTRAINT "fonds_module_manifest_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fonds_stuurinfo_kpi"
    ADD CONSTRAINT "fonds_stuurinfo_kpi_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fonds_stuurinfo_kpi"
    ADD CONSTRAINT "fonds_stuurinfo_kpi_periode_fk" FOREIGN KEY ("fonds_id", "periode") REFERENCES "public"."fonds_stuurinfo_periode"("fonds_id", "periode") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fonds_stuurinfo_log"
    ADD CONSTRAINT "fonds_stuurinfo_log_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fonds_stuurinfo_periode"
    ADD CONSTRAINT "fonds_stuurinfo_periode_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fonds_stuurinfo_reeks"
    ADD CONSTRAINT "fonds_stuurinfo_reeks_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fonds_stuurinfo_reeks"
    ADD CONSTRAINT "fonds_stuurinfo_reeks_periode_fk" FOREIGN KEY ("fonds_id", "periode") REFERENCES "public"."fonds_stuurinfo_periode"("fonds_id", "periode") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fonds_stuurinfo_reserve"
    ADD CONSTRAINT "fonds_stuurinfo_reserve_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fonds_stuurinfo_reserve"
    ADD CONSTRAINT "fonds_stuurinfo_reserve_fonds_id_periode_fkey" FOREIGN KEY ("fonds_id", "periode") REFERENCES "public"."fonds_stuurinfo_periode"("fonds_id", "periode") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fonds_theming"
    ADD CONSTRAINT "fonds_theming_bijgewerkt_door_fkey" FOREIGN KEY ("bijgewerkt_door") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."fonds_theming"
    ADD CONSTRAINT "fonds_theming_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gesprek_reflectie_state"
    ADD CONSTRAINT "gesprek_reflectie_state_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id");



ALTER TABLE ONLY "public"."gesprek_reflectie_state"
    ADD CONSTRAINT "gesprek_reflectie_state_gebruiker_id_fkey" FOREIGN KEY ("gebruiker_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gesprek_reflectie_state"
    ADD CONSTRAINT "gesprek_reflectie_state_gesprek_id_fkey" FOREIGN KEY ("gesprek_id") REFERENCES "public"."gesprekken"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gesprekken"
    ADD CONSTRAINT "gesprekken_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gesprekken"
    ADD CONSTRAINT "gesprekken_gebruiker_id_fkey" FOREIGN KEY ("gebruiker_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."governance_audit_grants"
    ADD CONSTRAINT "governance_audit_grants_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."governance_audit_grants"
    ADD CONSTRAINT "governance_audit_grants_gebruiker_id_fkey" FOREIGN KEY ("gebruiker_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."governance_audit_inzage"
    ADD CONSTRAINT "governance_audit_inzage_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id");



ALTER TABLE ONLY "public"."governance_audit_inzage"
    ADD CONSTRAINT "governance_audit_inzage_gebruiker_id_fkey" FOREIGN KEY ("gebruiker_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."governance_events"
    ADD CONSTRAINT "governance_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."governance_events"
    ADD CONSTRAINT "governance_events_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "public"."decision_objects"("id") ON DELETE RESTRICT;



COMMENT ON CONSTRAINT "governance_events_decision_id_fkey" ON "public"."governance_events" IS 'Restrict: Decision Objects met audit-trail zijn principieel niet hard verwijderbaar. Annulering verloopt via status, niet via DELETE.';



ALTER TABLE ONLY "public"."governance_export_log"
    ADD CONSTRAINT "governance_export_log_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id");



ALTER TABLE ONLY "public"."governance_export_log"
    ADD CONSTRAINT "governance_export_log_gebruiker_id_fkey" FOREIGN KEY ("gebruiker_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."governance_log"
    ADD CONSTRAINT "governance_log_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id");



ALTER TABLE ONLY "public"."governance_log"
    ADD CONSTRAINT "governance_log_gebruiker_id_fkey" FOREIGN KEY ("gebruiker_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."governance_log_inhoud"
    ADD CONSTRAINT "governance_log_inhoud_log_id_fkey" FOREIGN KEY ("log_id") REFERENCES "public"."governance_log"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."governance_redacties"
    ADD CONSTRAINT "governance_redacties_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id");



ALTER TABLE ONLY "public"."governance_redacties"
    ADD CONSTRAINT "governance_redacties_uitgevoerd_door_fkey" FOREIGN KEY ("uitgevoerd_door") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."gremia"
    ADD CONSTRAINT "gremia_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gremia"
    ADD CONSTRAINT "gremia_gekopieerd_van_id_fkey" FOREIGN KEY ("gekopieerd_van_id") REFERENCES "public"."gremia"("id");



ALTER TABLE ONLY "public"."kritische_focusgebieden"
    ADD CONSTRAINT "kritische_focusgebieden_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kritische_focusgebieden"
    ADD CONSTRAINT "kritische_focusgebieden_gekopieerd_van_id_fkey" FOREIGN KEY ("gekopieerd_van_id") REFERENCES "public"."kritische_focusgebieden"("id");



ALTER TABLE ONLY "public"."notificaties"
    ADD CONSTRAINT "notificaties_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notificaties"
    ADD CONSTRAINT "notificaties_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notificaties"
    ADD CONSTRAINT "notificaties_ontvanger_id_fkey" FOREIGN KEY ("ontvanger_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notulen_segmenten"
    ADD CONSTRAINT "notulen_segmenten_agendapunt_id_fkey" FOREIGN KEY ("agendapunt_id") REFERENCES "public"."agendapunten"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notulen_segmenten"
    ADD CONSTRAINT "notulen_segmenten_bevestigd_door_fkey" FOREIGN KEY ("bevestigd_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notulen_segmenten"
    ADD CONSTRAINT "notulen_segmenten_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documenten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notulen_segmenten"
    ADD CONSTRAINT "notulen_segmenten_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notulen_segmenten"
    ADD CONSTRAINT "notulen_segmenten_vergadering_id_fkey" FOREIGN KEY ("vergadering_id") REFERENCES "public"."vergaderingen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organisatie_profielen"
    ADD CONSTRAINT "organisatie_profielen_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."platform_event_log"
    ADD CONSTRAINT "platform_event_log_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "public"."platform_identities"("id");



ALTER TABLE ONLY "public"."platform_identity_capabilities"
    ADD CONSTRAINT "platform_identity_capabilities_capability_fkey" FOREIGN KEY ("capability") REFERENCES "public"."platform_capabilities"("capability");



ALTER TABLE ONLY "public"."platform_identity_capabilities"
    ADD CONSTRAINT "platform_identity_capabilities_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "public"."platform_identities"("id");



ALTER TABLE ONLY "public"."platform_identity_capabilities"
    ADD CONSTRAINT "platform_identity_capabilities_toegekend_door_fkey" FOREIGN KEY ("toegekend_door") REFERENCES "public"."platform_identities"("id");



ALTER TABLE ONLY "public"."platform_identity_capabilities"
    ADD CONSTRAINT "platform_identity_capabilities_vier_ogen_door_fkey" FOREIGN KEY ("vier_ogen_door") REFERENCES "public"."platform_identities"("id");



ALTER TABLE ONLY "public"."platform_signal_snapshots"
    ADD CONSTRAINT "platform_signal_snapshots_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procedure_afschriften"
    ADD CONSTRAINT "procedure_afschriften_aangemaakt_door_fkey" FOREIGN KEY ("aangemaakt_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procedure_afschriften"
    ADD CONSTRAINT "procedure_afschriften_ai_vastgesteld_door_fkey" FOREIGN KEY ("ai_vastgesteld_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procedure_afschriften"
    ADD CONSTRAINT "procedure_afschriften_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."procedure_afschriften"
    ADD CONSTRAINT "procedure_afschriften_ingetrokken_door_fkey" FOREIGN KEY ("ingetrokken_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procedure_afschriften"
    ADD CONSTRAINT "procedure_afschriften_procedure_id_fkey" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."procedure_besluiten"
    ADD CONSTRAINT "procedure_besluiten_agendapunt_id_fkey" FOREIGN KEY ("agendapunt_id") REFERENCES "public"."agendapunten"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procedure_besluiten"
    ADD CONSTRAINT "procedure_besluiten_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "public"."decision_objects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procedure_besluiten"
    ADD CONSTRAINT "procedure_besluiten_procedure_id_fkey" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."procedure_besluiten"
    ADD CONSTRAINT "procedure_besluiten_stap_id_fkey" FOREIGN KEY ("stap_id") REFERENCES "public"."procedure_stappen"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procedure_besluiten"
    ADD CONSTRAINT "procedure_besluiten_vastgelegd_door_fkey" FOREIGN KEY ("vastgelegd_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procedure_besluiten"
    ADD CONSTRAINT "procedure_besluiten_vergadering_id_fkey" FOREIGN KEY ("vergadering_id") REFERENCES "public"."vergaderingen"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procedure_bewijs"
    ADD CONSTRAINT "procedure_bewijs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documenten"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procedure_bewijs"
    ADD CONSTRAINT "procedure_bewijs_stap_id_fkey" FOREIGN KEY ("stap_id") REFERENCES "public"."procedure_stappen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."procedure_bewijs"
    ADD CONSTRAINT "procedure_bewijs_stemming_id_fkey" FOREIGN KEY ("stemming_id") REFERENCES "public"."stemmingen"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procedure_bewijs"
    ADD CONSTRAINT "procedure_bewijs_toegevoegd_door_fkey" FOREIGN KEY ("toegevoegd_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procedure_checklist"
    ADD CONSTRAINT "procedure_checklist_aangemaakt_door_fkey" FOREIGN KEY ("aangemaakt_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procedure_checklist"
    ADD CONSTRAINT "procedure_checklist_governance_event_id_fkey" FOREIGN KEY ("governance_event_id") REFERENCES "public"."governance_events"("id");



ALTER TABLE ONLY "public"."procedure_checklist"
    ADD CONSTRAINT "procedure_checklist_stap_id_fkey" FOREIGN KEY ("stap_id") REFERENCES "public"."procedure_stappen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."procedure_checklist"
    ADD CONSTRAINT "procedure_checklist_voldaan_door_fkey" FOREIGN KEY ("voldaan_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procedure_eigenaars"
    ADD CONSTRAINT "procedure_eigenaars_gebruiker_id_fkey" FOREIGN KEY ("gebruiker_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."procedure_eigenaars"
    ADD CONSTRAINT "procedure_eigenaars_procedure_id_fkey" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."procedure_fase_beschrijving_override"
    ADD CONSTRAINT "procedure_fase_beschrijving_override_aangepast_door_fkey" FOREIGN KEY ("aangepast_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procedure_fase_beschrijving_override"
    ADD CONSTRAINT "procedure_fase_beschrijving_override_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."procedure_fase_toelichting"
    ADD CONSTRAINT "procedure_fase_toelichting_aangepast_door_fkey" FOREIGN KEY ("aangepast_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procedure_fase_toelichting"
    ADD CONSTRAINT "procedure_fase_toelichting_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."procedure_fase_toelichting"
    ADD CONSTRAINT "procedure_fase_toelichting_procedure_id_fkey" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."procedure_log"
    ADD CONSTRAINT "procedure_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procedure_log"
    ADD CONSTRAINT "procedure_log_procedure_id_fkey" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."procedure_requirement_instance"
    ADD CONSTRAINT "procedure_requirement_instance_aangemaakt_door_fkey" FOREIGN KEY ("aangemaakt_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procedure_requirement_instance"
    ADD CONSTRAINT "procedure_requirement_instance_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "public"."decision_objects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."procedure_requirement_instance"
    ADD CONSTRAINT "procedure_requirement_instance_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."procedure_requirement_instance"
    ADD CONSTRAINT "procedure_requirement_instance_governance_event_id_fkey" FOREIGN KEY ("governance_event_id") REFERENCES "public"."governance_events"("id");



ALTER TABLE ONLY "public"."procedure_requirement_uitsluiting"
    ADD CONSTRAINT "procedure_requirement_uitsluiting_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "public"."decision_objects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."procedure_requirement_uitsluiting"
    ADD CONSTRAINT "procedure_requirement_uitsluiting_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."procedure_requirement_uitsluiting"
    ADD CONSTRAINT "procedure_requirement_uitsluiting_governance_event_id_fkey" FOREIGN KEY ("governance_event_id") REFERENCES "public"."governance_events"("id");



ALTER TABLE ONLY "public"."procedure_requirement_uitsluiting"
    ADD CONSTRAINT "procedure_requirement_uitsluiting_uitgesloten_door_fkey" FOREIGN KEY ("uitgesloten_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procedure_stappen"
    ADD CONSTRAINT "procedure_stappen_procedure_id_fkey" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."procedure_stappen"
    ADD CONSTRAINT "procedure_stappen_voltooid_door_fkey" FOREIGN KEY ("voltooid_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procedures"
    ADD CONSTRAINT "procedures_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "public"."decision_objects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procedures"
    ADD CONSTRAINT "procedures_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."procedures"
    ADD CONSTRAINT "procedures_gestart_door_fkey" FOREIGN KEY ("gestart_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procedures"
    ADD CONSTRAINT "procedures_procesmodel_id_fkey" FOREIGN KEY ("procesmodel_id") REFERENCES "public"."procesmodellen"("id");



ALTER TABLE ONLY "public"."procesmodel_expertises"
    ADD CONSTRAINT "procesmodel_expertises_aangemaakt_door_fkey" FOREIGN KEY ("aangemaakt_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procesmodel_expertises"
    ADD CONSTRAINT "procesmodel_expertises_fonds_id_expertise_id_fkey" FOREIGN KEY ("fonds_id", "expertise_id") REFERENCES "public"."expertises"("fonds_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."procesmodel_expertises"
    ADD CONSTRAINT "procesmodel_expertises_fonds_id_procesmodel_id_fkey" FOREIGN KEY ("fonds_id", "procesmodel_id") REFERENCES "public"."procesmodellen"("fonds_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."procesmodel_focusgebieden"
    ADD CONSTRAINT "procesmodel_focusgebieden_aangemaakt_door_fkey" FOREIGN KEY ("aangemaakt_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procesmodel_focusgebieden"
    ADD CONSTRAINT "procesmodel_focusgebieden_fonds_id_focusgebied_id_fkey" FOREIGN KEY ("fonds_id", "focusgebied_id") REFERENCES "public"."kritische_focusgebieden"("fonds_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."procesmodel_focusgebieden"
    ADD CONSTRAINT "procesmodel_focusgebieden_fonds_id_procesmodel_id_fkey" FOREIGN KEY ("fonds_id", "procesmodel_id") REFERENCES "public"."procesmodellen"("fonds_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."procesmodel_gremia"
    ADD CONSTRAINT "procesmodel_gremia_aangemaakt_door_fkey" FOREIGN KEY ("aangemaakt_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procesmodel_gremia"
    ADD CONSTRAINT "procesmodel_gremia_fonds_id_gremium_id_fkey" FOREIGN KEY ("fonds_id", "gremium_id") REFERENCES "public"."gremia"("fonds_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."procesmodel_gremia"
    ADD CONSTRAINT "procesmodel_gremia_fonds_id_procesmodel_id_fkey" FOREIGN KEY ("fonds_id", "procesmodel_id") REFERENCES "public"."procesmodellen"("fonds_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."procesmodellen"
    ADD CONSTRAINT "procesmodellen_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiel_expertises"
    ADD CONSTRAINT "profiel_expertises_fonds_id_expertise_id_fkey" FOREIGN KEY ("fonds_id", "expertise_id") REFERENCES "public"."expertises"("fonds_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiel_expertises"
    ADD CONSTRAINT "profiel_expertises_fonds_id_profiel_id_fkey" FOREIGN KEY ("fonds_id", "profiel_id") REFERENCES "public"."profielen"("fonds_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiel_focusgebieden"
    ADD CONSTRAINT "profiel_focusgebieden_fonds_id_focusgebied_id_fkey" FOREIGN KEY ("fonds_id", "focusgebied_id") REFERENCES "public"."kritische_focusgebieden"("fonds_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiel_focusgebieden"
    ADD CONSTRAINT "profiel_focusgebieden_fonds_id_profiel_id_fkey" FOREIGN KEY ("fonds_id", "profiel_id") REFERENCES "public"."profielen"("fonds_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiel_gremia"
    ADD CONSTRAINT "profiel_gremia_fonds_id_gremium_id_fkey" FOREIGN KEY ("fonds_id", "gremium_id") REFERENCES "public"."gremia"("fonds_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiel_gremia"
    ADD CONSTRAINT "profiel_gremia_fonds_id_profiel_id_fkey" FOREIGN KEY ("fonds_id", "profiel_id") REFERENCES "public"."profielen"("fonds_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiel_log"
    ADD CONSTRAINT "profiel_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiel_log"
    ADD CONSTRAINT "profiel_log_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiel_log"
    ADD CONSTRAINT "profiel_log_profiel_id_fkey" FOREIGN KEY ("profiel_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profielen"
    ADD CONSTRAINT "profielen_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id");



ALTER TABLE ONLY "public"."profielen"
    ADD CONSTRAINT "profielen_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rate_limit_events"
    ADD CONSTRAINT "rate_limit_events_gebruiker_id_fkey" FOREIGN KEY ("gebruiker_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reindex_runs"
    ADD CONSTRAINT "reindex_runs_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reindex_runs"
    ADD CONSTRAINT "reindex_runs_gestart_door_fkey" FOREIGN KEY ("gestart_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."risico_log"
    ADD CONSTRAINT "risico_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."risico_log"
    ADD CONSTRAINT "risico_log_risico_id_fkey" FOREIGN KEY ("risico_id") REFERENCES "public"."risicos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."risico_maatregelen"
    ADD CONSTRAINT "risico_maatregelen_aangemaakt_door_fkey" FOREIGN KEY ("aangemaakt_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."risico_maatregelen"
    ADD CONSTRAINT "risico_maatregelen_risico_id_fkey" FOREIGN KEY ("risico_id") REFERENCES "public"."risicos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."risicos"
    ADD CONSTRAINT "risicos_aangemaakt_door_fkey" FOREIGN KEY ("aangemaakt_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."risicos"
    ADD CONSTRAINT "risicos_eigenaar_id_fkey" FOREIGN KEY ("eigenaar_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."risicos"
    ADD CONSTRAINT "risicos_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."risicos"
    ADD CONSTRAINT "risicos_gesloten_door_fkey" FOREIGN KEY ("gesloten_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."semantic_units"
    ADD CONSTRAINT "semantic_units_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "public"."document_chunks"("id");



ALTER TABLE ONLY "public"."semantic_units"
    ADD CONSTRAINT "semantic_units_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id");



ALTER TABLE ONLY "public"."semantic_units"
    ADD CONSTRAINT "semantic_units_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documenten"("id");



ALTER TABLE ONLY "public"."semantic_units"
    ADD CONSTRAINT "semantic_units_extraction_run_id_fkey" FOREIGN KEY ("extraction_run_id") REFERENCES "public"."extraction_run"("id");



ALTER TABLE ONLY "public"."semantic_units"
    ADD CONSTRAINT "semantic_units_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id");



ALTER TABLE ONLY "public"."stem_uitbrengingen"
    ADD CONSTRAINT "stem_uitbrengingen_stemgerechtigde_id_fkey" FOREIGN KEY ("stemgerechtigde_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stem_uitbrengingen"
    ADD CONSTRAINT "stem_uitbrengingen_stemming_id_fkey" FOREIGN KEY ("stemming_id") REFERENCES "public"."stemmingen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stem_uitbrengingen"
    ADD CONSTRAINT "stem_uitbrengingen_uitgebracht_door_fkey" FOREIGN KEY ("uitgebracht_door") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stemmingen"
    ADD CONSTRAINT "stemmingen_agendapunt_id_fkey" FOREIGN KEY ("agendapunt_id") REFERENCES "public"."agendapunten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stemmingen"
    ADD CONSTRAINT "stemmingen_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "public"."decision_objects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."stemmingen"
    ADD CONSTRAINT "stemmingen_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stemmingen"
    ADD CONSTRAINT "stemmingen_geopend_door_fkey" FOREIGN KEY ("geopend_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."stemmingen"
    ADD CONSTRAINT "stemmingen_gesloten_door_fkey" FOREIGN KEY ("gesloten_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tenant_domains"
    ADD CONSTRAINT "tenant_domains_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."vergadering_log"
    ADD CONSTRAINT "vergadering_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vergadering_log"
    ADD CONSTRAINT "vergadering_log_vergadering_id_fkey" FOREIGN KEY ("vergadering_id") REFERENCES "public"."vergaderingen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vergaderingen"
    ADD CONSTRAINT "vergaderingen_aangemaakt_door_fkey" FOREIGN KEY ("aangemaakt_door") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."vergaderingen"
    ADD CONSTRAINT "vergaderingen_fonds_id_fkey" FOREIGN KEY ("fonds_id") REFERENCES "public"."fondsen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vergaderingen"
    ADD CONSTRAINT "vergaderingen_gearchiveerd_door_fkey" FOREIGN KEY ("gearchiveerd_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vergaderingen"
    ADD CONSTRAINT "vergaderingen_gewijzigd_door_fkey" FOREIGN KEY ("gewijzigd_door") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."voorbereidingen"
    ADD CONSTRAINT "voorbereidingen_agendapunt_id_fkey" FOREIGN KEY ("agendapunt_id") REFERENCES "public"."agendapunten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."voorbereidingen"
    ADD CONSTRAINT "voorbereidingen_gebruiker_id_fkey" FOREIGN KEY ("gebruiker_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."agendapunt_inbreng" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agendapunt_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agendapunten" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai validatie domein" ON "public"."decision_ai_interactions" AS RESTRICTIVE FOR UPDATE USING ((("decision_id" IN ( SELECT "decision_objects"."id"
   FROM "public"."decision_objects"
  WHERE ("decision_objects"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))) AND (("validatie_domein" = 'algemeen'::"text") OR (("validatie_domein" = ANY (ARRAY['risk'::"text", 'compliance'::"text", 'beleggingen'::"text", 'governance'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."profielen"
  WHERE (("profielen"."id" = "auth"."uid"()) AND ("profielen"."rol" = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"])))))))));



ALTER TABLE "public"."app_errors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aqlab_ai_features" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aqlab_audit_exports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aqlab_findings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aqlab_fixture_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aqlab_human_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aqlab_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aqlab_model_configurations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aqlab_prompt_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aqlab_release_decisions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aqlab_run_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aqlab_run_outputs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aqlab_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aqlab_scores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aqlab_test_case_fixtures" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aqlab_test_cases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aqlab_test_sets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "auditregels schrijven eigen fonds" ON "public"."governance_log" FOR INSERT WITH CHECK ((("gebruiker_id" = "auth"."uid"()) AND ("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))));



ALTER TABLE "public"."bron_whitelist" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bron_whitelist lees actief" ON "public"."bron_whitelist" FOR SELECT USING ((("status" = 'actief'::"text") AND ("auth"."uid"() IS NOT NULL)));



ALTER TABLE "public"."bron_whitelist_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."catalogus_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chunks select" ON "public"."document_chunks" FOR SELECT USING ((("auth"."uid"() IS NOT NULL) AND ("document_id" IN ( SELECT "documenten"."id"
   FROM "public"."documenten"
  WHERE (("documenten"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))) OR ("documenten"."bibliotheek" = 'generiek'::"text"))))));



CREATE POLICY "chunks write eigen fonds" ON "public"."document_chunks" USING (("document_id" IN ( SELECT "documenten"."id"
   FROM "public"."documenten"
  WHERE (("documenten"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))) AND ("documenten"."bibliotheek" = 'fonds'::"text"))))) WITH CHECK (("document_id" IN ( SELECT "documenten"."id"
   FROM "public"."documenten"
  WHERE (("documenten"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))) AND ("documenten"."bibliotheek" = 'fonds'::"text")))));



ALTER TABLE "public"."classificatie_voorstellen" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."comparison_results" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "comparison_results eigen fonds lezen" ON "public"."comparison_results" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



ALTER TABLE "public"."comparison_run" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "comparison_run eigen fonds lezen" ON "public"."comparison_run" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



ALTER TABLE "public"."concepts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "concepts lezen" ON "public"."concepts" FOR SELECT USING (true);



CREATE POLICY "config log insert eigen fonds" ON "public"."fonds_config_log" FOR INSERT WITH CHECK (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "config log lezen eigen fonds" ON "public"."fonds_config_log" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



ALTER TABLE "public"."contact_aanvragen" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."decision_actions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."decision_ai_interactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."decision_assumptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."decision_audit_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."decision_conditions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."decision_dissent" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."decision_evaluations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."decision_objects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."decision_risks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."difference_judgements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dissent zichtbaarheid select" ON "public"."decision_dissent" FOR SELECT USING ((("decision_id" IN ( SELECT "decision_objects"."id"
   FROM "public"."decision_objects"
  WHERE ("decision_objects"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))) AND (("bestuurder_id" = "auth"."uid"()) OR (("zichtbaarheid" <> 'prive'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."profielen"
  WHERE (("profielen"."id" = "auth"."uid"()) AND ("profielen"."rol" = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"])))))) OR ("zichtbaarheid" = ANY (ARRAY['formele_dissent'::"text", 'minderheidsnotitie'::"text"])))));



CREATE POLICY "dissent zichtbaarheid write" ON "public"."decision_dissent" USING ((("decision_id" IN ( SELECT "decision_objects"."id"
   FROM "public"."decision_objects"
  WHERE ("decision_objects"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))) AND (("bestuurder_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."profielen"
  WHERE (("profielen"."id" = "auth"."uid"()) AND ("profielen"."rol" = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"])))))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) IS DISTINCT FROM 'bestuursbureau'::"text"))) WITH CHECK ((("decision_id" IN ( SELECT "decision_objects"."id"
   FROM "public"."decision_objects"
  WHERE ("decision_objects"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))) AND (("bestuurder_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."profielen"
  WHERE (("profielen"."id" = "auth"."uid"()) AND ("profielen"."rol" = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"])))))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) IS DISTINCT FROM 'bestuursbureau'::"text")));



ALTER TABLE "public"."document_agendapunten" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_chunks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_inzage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_metadata_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_metadata_review_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_procesinstanties" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_processing_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."documenten" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "documenten delete eigen fonds" ON "public"."documenten" FOR DELETE USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "documenten insert eigen fonds" ON "public"."documenten" FOR INSERT WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND ("bibliotheek" = 'fonds'::"text")));



CREATE POLICY "documenten select" ON "public"."documenten" FOR SELECT USING ((("auth"."uid"() IS NOT NULL) AND (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) OR ("bibliotheek" = 'generiek'::"text"))));



CREATE POLICY "documenten update eigen fonds" ON "public"."documenten" FOR UPDATE USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))) WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND ("bibliotheek" = 'fonds'::"text")));



CREATE POLICY "eigen auditregels lezen" ON "public"."governance_log" FOR SELECT USING ((("gebruiker_id" = "auth"."uid"()) OR "public"."mag_audit"("fonds_id")));



CREATE POLICY "eigen gesprekken aanmaken" ON "public"."gesprekken" FOR INSERT WITH CHECK ((("gebruiker_id" = "auth"."uid"()) AND ("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))));



CREATE POLICY "eigen gesprekken bijwerken" ON "public"."gesprekken" FOR UPDATE USING ((("gebruiker_id" = "auth"."uid"()) AND ("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))))) WITH CHECK ((("gebruiker_id" = "auth"."uid"()) AND ("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))));



CREATE POLICY "eigen gesprekken lezen" ON "public"."gesprekken" FOR SELECT USING ((("gebruiker_id" = "auth"."uid"()) AND ("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))));



CREATE POLICY "eigen inbreng schrijven" ON "public"."agendapunt_inbreng" FOR INSERT WITH CHECK ((("gebruiker_id" = "auth"."uid"()) AND ("agendapunt_id" IN ( SELECT "ap"."id"
   FROM ("public"."agendapunten" "ap"
     JOIN "public"."vergaderingen" "v" ON (("v"."id" = "ap"."vergadering_id")))
  WHERE ("v"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) IS DISTINCT FROM 'bestuursbureau'::"text")));



CREATE POLICY "eigen inbreng verwijderen" ON "public"."agendapunt_inbreng" FOR DELETE USING ((("gebruiker_id" = "auth"."uid"()) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) IS DISTINCT FROM 'bestuursbureau'::"text")));



CREATE POLICY "eigen inbreng wijzigen" ON "public"."agendapunt_inbreng" FOR UPDATE USING ((("gebruiker_id" = "auth"."uid"()) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) IS DISTINCT FROM 'bestuursbureau'::"text"))) WITH CHECK ((("gebruiker_id" = "auth"."uid"()) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) IS DISTINCT FROM 'bestuursbureau'::"text")));



CREATE POLICY "eigen inzage lezen" ON "public"."governance_audit_inzage" FOR SELECT USING ((("gebruiker_id" = "auth"."uid"()) OR "public"."mag_audit_redacties"("fonds_id")));



CREATE POLICY "eigen inzage schrijven" ON "public"."document_inzage" FOR INSERT WITH CHECK ((("gebruiker_id" = "auth"."uid"()) AND ("document_id" IN ( SELECT "documenten"."id"
   FROM "public"."documenten")) AND (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) OR (("fonds_id" IS NULL) AND ("document_id" IN ( SELECT "documenten"."id"
   FROM "public"."documenten"
  WHERE ("documenten"."bibliotheek" = 'generiek'::"text")))))));



CREATE POLICY "eigen loginhoud lezen" ON "public"."governance_log_inhoud" FOR SELECT USING (("log_id" IN ( SELECT "gl"."id"
   FROM "public"."governance_log" "gl"
  WHERE (("gl"."gebruiker_id" = "auth"."uid"()) AND ("gl"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"())))))));



CREATE POLICY "eigen notificaties select" ON "public"."notificaties" FOR SELECT USING ((("ontvanger_id" = "auth"."uid"()) AND ("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))));



CREATE POLICY "eigen notificaties update" ON "public"."notificaties" FOR UPDATE USING (("ontvanger_id" = "auth"."uid"())) WITH CHECK (("ontvanger_id" = "auth"."uid"()));



CREATE POLICY "eigen oordelen lezen" ON "public"."difference_judgements" FOR SELECT USING ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (("user_id" = "auth"."uid"()) OR ("private" = false))));



CREATE POLICY "eigen oordelen schrijven" ON "public"."difference_judgements" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND ("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))));



CREATE POLICY "eigen profiel_expertises" ON "public"."profiel_expertises" USING (("profiel_id" = "auth"."uid"())) WITH CHECK (("profiel_id" = "auth"."uid"()));



CREATE POLICY "eigen profiel_focusgebieden" ON "public"."profiel_focusgebieden" USING (("profiel_id" = "auth"."uid"())) WITH CHECK (("profiel_id" = "auth"."uid"()));



CREATE POLICY "eigen profiel_gremia" ON "public"."profiel_gremia" USING (("profiel_id" = "auth"."uid"())) WITH CHECK (("profiel_id" = "auth"."uid"()));



CREATE POLICY "eigen reflectiestatus lezen" ON "public"."gesprek_reflectie_state" FOR SELECT USING ((("gebruiker_id" = "auth"."uid"()) AND ("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))));



CREATE POLICY "eigen voorbereiding" ON "public"."voorbereidingen" USING (("gebruiker_id" = "auth"."uid"())) WITH CHECK (("gebruiker_id" = "auth"."uid"()));



ALTER TABLE "public"."expertises" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "export log select" ON "public"."governance_export_log" FOR SELECT USING ("public"."mag_audit"("fonds_id"));



ALTER TABLE "public"."extraction_run" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extraction_run eigen fonds lezen" ON "public"."extraction_run" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "fase-override eigen fonds lezen" ON "public"."procedure_fase_beschrijving_override" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "fase-override schrijven voorzitter-beheerder" ON "public"."procedure_fase_beschrijving_override" FOR INSERT WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (EXISTS ( SELECT 1
   FROM "public"."profielen"
  WHERE (("profielen"."id" = "auth"."uid"()) AND ("profielen"."rol" = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"])))))));



CREATE POLICY "fase-override wijzigen voorzitter-beheerder" ON "public"."procedure_fase_beschrijving_override" FOR UPDATE USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))) WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (EXISTS ( SELECT 1
   FROM "public"."profielen"
  WHERE (("profielen"."id" = "auth"."uid"()) AND ("profielen"."rol" = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"])))))));



CREATE POLICY "fase-toelichting eigen fonds lezen" ON "public"."procedure_fase_toelichting" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "fase-toelichting toevoegen voorzitter-beheerder" ON "public"."procedure_fase_toelichting" FOR INSERT WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (EXISTS ( SELECT 1
   FROM "public"."profielen"
  WHERE (("profielen"."id" = "auth"."uid"()) AND ("profielen"."rol" = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"])))))));



CREATE POLICY "fase-toelichting wijzigen voorzitter-beheerder" ON "public"."procedure_fase_toelichting" FOR UPDATE USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))) WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (EXISTS ( SELECT 1
   FROM "public"."profielen"
  WHERE (("profielen"."id" = "auth"."uid"()) AND ("profielen"."rol" = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"])))))));



CREATE POLICY "fasen insert beheerder" ON "public"."procedure_template_fasen" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profielen"
  WHERE (("profielen"."id" = "auth"."uid"()) AND ("profielen"."rol" = 'beheerder'::"text")))));



CREATE POLICY "fasen read all" ON "public"."procedure_template_fasen" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "fasen update beheerder" ON "public"."procedure_template_fasen" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profielen"
  WHERE (("profielen"."id" = "auth"."uid"()) AND ("profielen"."rol" = 'beheerder'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profielen"
  WHERE (("profielen"."id" = "auth"."uid"()) AND ("profielen"."rol" = 'beheerder'::"text")))));



CREATE POLICY "flags bijwerken priv" ON "public"."fonds_feature_flags" FOR UPDATE USING ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"])))) WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"]))));



CREATE POLICY "flags lezen eigen fonds" ON "public"."fonds_feature_flags" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "flags schrijven priv" ON "public"."fonds_feature_flags" FOR INSERT WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"]))));



CREATE POLICY "fonds afschriften aanmaken" ON "public"."procedure_afschriften" FOR INSERT WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) IS DISTINCT FROM 'bestuursbureau'::"text")));



CREATE POLICY "fonds afschriften bijwerken" ON "public"."procedure_afschriften" FOR UPDATE USING ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) IS DISTINCT FROM 'bestuursbureau'::"text"))) WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) IS DISTINCT FROM 'bestuursbureau'::"text")));



CREATE POLICY "fonds afschriften lezen" ON "public"."procedure_afschriften" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "fonds agendapunt_log insert" ON "public"."agendapunt_log" FOR INSERT WITH CHECK ((("agendapunt_id" IN ( SELECT "ap"."id"
   FROM ("public"."agendapunten" "ap"
     JOIN "public"."vergaderingen" "v" ON (("v"."id" = "ap"."vergadering_id")))
  WHERE ("v"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))) AND ("actor_id" = "auth"."uid"())));



CREATE POLICY "fonds agendapunt_log select" ON "public"."agendapunt_log" FOR SELECT USING (("agendapunt_id" IN ( SELECT "ap"."id"
   FROM ("public"."agendapunten" "ap"
     JOIN "public"."vergaderingen" "v" ON (("v"."id" = "ap"."vergadering_id")))
  WHERE ("v"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))));



CREATE POLICY "fonds agendapunten" ON "public"."agendapunten" USING (("vergadering_id" IN ( SELECT "vergaderingen"."id"
   FROM "public"."vergaderingen"
  WHERE ("vergaderingen"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"())))))) WITH CHECK (("vergadering_id" IN ( SELECT "vergaderingen"."id"
   FROM "public"."vergaderingen"
  WHERE ("vergaderingen"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))));



CREATE POLICY "fonds classificatie_voorstellen" ON "public"."classificatie_voorstellen" USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))) WITH CHECK (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "fonds decision_actions" ON "public"."decision_actions" USING (("decision_id" IN ( SELECT "decision_objects"."id"
   FROM "public"."decision_objects"
  WHERE ("decision_objects"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"())))))) WITH CHECK (("decision_id" IN ( SELECT "decision_objects"."id"
   FROM "public"."decision_objects"
  WHERE ("decision_objects"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))));



CREATE POLICY "fonds decision_ai_interactions" ON "public"."decision_ai_interactions" USING (("decision_id" IN ( SELECT "decision_objects"."id"
   FROM "public"."decision_objects"
  WHERE ("decision_objects"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"())))))) WITH CHECK (("decision_id" IN ( SELECT "decision_objects"."id"
   FROM "public"."decision_objects"
  WHERE ("decision_objects"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))));



CREATE POLICY "fonds decision_assumptions" ON "public"."decision_assumptions" USING (("decision_id" IN ( SELECT "decision_objects"."id"
   FROM "public"."decision_objects"
  WHERE ("decision_objects"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"())))))) WITH CHECK (("decision_id" IN ( SELECT "decision_objects"."id"
   FROM "public"."decision_objects"
  WHERE ("decision_objects"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))));



CREATE POLICY "fonds decision_audit_snapshots" ON "public"."decision_audit_snapshots" USING (("decision_id" IN ( SELECT "decision_objects"."id"
   FROM "public"."decision_objects"
  WHERE ("decision_objects"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"())))))) WITH CHECK (("decision_id" IN ( SELECT "decision_objects"."id"
   FROM "public"."decision_objects"
  WHERE ("decision_objects"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))));



CREATE POLICY "fonds decision_conditions" ON "public"."decision_conditions" USING (("decision_id" IN ( SELECT "decision_objects"."id"
   FROM "public"."decision_objects"
  WHERE ("decision_objects"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"())))))) WITH CHECK (("decision_id" IN ( SELECT "decision_objects"."id"
   FROM "public"."decision_objects"
  WHERE ("decision_objects"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))));



CREATE POLICY "fonds decision_evaluations" ON "public"."decision_evaluations" USING (("decision_id" IN ( SELECT "decision_objects"."id"
   FROM "public"."decision_objects"
  WHERE ("decision_objects"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"())))))) WITH CHECK (("decision_id" IN ( SELECT "decision_objects"."id"
   FROM "public"."decision_objects"
  WHERE ("decision_objects"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))));



CREATE POLICY "fonds decision_objects" ON "public"."decision_objects" USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))) WITH CHECK (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "fonds decision_risks" ON "public"."decision_risks" USING (("decision_id" IN ( SELECT "decision_objects"."id"
   FROM "public"."decision_objects"
  WHERE ("decision_objects"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"())))))) WITH CHECK (("decision_id" IN ( SELECT "decision_objects"."id"
   FROM "public"."decision_objects"
  WHERE ("decision_objects"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))));



CREATE POLICY "fonds document_agendapunten" ON "public"."document_agendapunten" USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))) WITH CHECK (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "fonds document_procesinstanties" ON "public"."document_procesinstanties" USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))) WITH CHECK (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "fonds governance_events" ON "public"."governance_events" USING (("decision_id" IN ( SELECT "decision_objects"."id"
   FROM "public"."decision_objects"
  WHERE ("decision_objects"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"())))))) WITH CHECK (("decision_id" IN ( SELECT "decision_objects"."id"
   FROM "public"."decision_objects"
  WHERE ("decision_objects"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))));



CREATE POLICY "fonds inbreng lezen" ON "public"."agendapunt_inbreng" FOR SELECT USING ((("agendapunt_id" IN ( SELECT "ap"."id"
   FROM ("public"."agendapunten" "ap"
     JOIN "public"."vergaderingen" "v" ON (("v"."id" = "ap"."vergadering_id")))
  WHERE ("v"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) IS DISTINCT FROM 'bestuursbureau'::"text")));



CREATE POLICY "fonds instellingen" ON "public"."fonds_instellingen" USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))) WITH CHECK (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "fonds inzage lezen" ON "public"."document_inzage" FOR SELECT USING ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) OR (("fonds_id" IS NULL) AND ("document_id" IN ( SELECT "documenten"."id"
   FROM "public"."documenten"
  WHERE ("documenten"."bibliotheek" = 'generiek'::"text"))))));



CREATE POLICY "fonds maatregelen" ON "public"."risico_maatregelen" USING (("risico_id" IN ( SELECT "risicos"."id"
   FROM "public"."risicos"
  WHERE ("risicos"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"())))))) WITH CHECK (("risico_id" IN ( SELECT "risicos"."id"
   FROM "public"."risicos"
  WHERE ("risicos"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))));



CREATE POLICY "fonds notulen_segmenten" ON "public"."notulen_segmenten" USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))) WITH CHECK (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "fonds proc besluiten" ON "public"."procedure_besluiten" USING (("procedure_id" IN ( SELECT "procedures"."id"
   FROM "public"."procedures"
  WHERE ("procedures"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"())))))) WITH CHECK (("procedure_id" IN ( SELECT "procedures"."id"
   FROM "public"."procedures"
  WHERE ("procedures"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))));



CREATE POLICY "fonds proc bewijs" ON "public"."procedure_bewijs" USING (("stap_id" IN ( SELECT "s"."id"
   FROM ("public"."procedure_stappen" "s"
     JOIN "public"."procedures" "p" ON (("p"."id" = "s"."procedure_id")))
  WHERE ("p"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"())))))) WITH CHECK (("stap_id" IN ( SELECT "s"."id"
   FROM ("public"."procedure_stappen" "s"
     JOIN "public"."procedures" "p" ON (("p"."id" = "s"."procedure_id")))
  WHERE ("p"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))));



CREATE POLICY "fonds proc checklist" ON "public"."procedure_checklist" USING (("stap_id" IN ( SELECT "s"."id"
   FROM ("public"."procedure_stappen" "s"
     JOIN "public"."procedures" "p" ON (("p"."id" = "s"."procedure_id")))
  WHERE ("p"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"())))))) WITH CHECK (("stap_id" IN ( SELECT "s"."id"
   FROM ("public"."procedure_stappen" "s"
     JOIN "public"."procedures" "p" ON (("p"."id" = "s"."procedure_id")))
  WHERE ("p"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))));



CREATE POLICY "fonds proc eigenaars" ON "public"."procedure_eigenaars" USING (("procedure_id" IN ( SELECT "procedures"."id"
   FROM "public"."procedures"
  WHERE ("procedures"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"())))))) WITH CHECK (("procedure_id" IN ( SELECT "procedures"."id"
   FROM "public"."procedures"
  WHERE ("procedures"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))));



CREATE POLICY "fonds proc log" ON "public"."procedure_log" USING (("procedure_id" IN ( SELECT "procedures"."id"
   FROM "public"."procedures"
  WHERE ("procedures"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"())))))) WITH CHECK (("procedure_id" IN ( SELECT "procedures"."id"
   FROM "public"."procedures"
  WHERE ("procedures"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))));



CREATE POLICY "fonds proc stappen" ON "public"."procedure_stappen" USING (("procedure_id" IN ( SELECT "procedures"."id"
   FROM "public"."procedures"
  WHERE ("procedures"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"())))))) WITH CHECK (("procedure_id" IN ( SELECT "procedures"."id"
   FROM "public"."procedures"
  WHERE ("procedures"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))));



CREATE POLICY "fonds procedures" ON "public"."procedures" USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))) WITH CHECK (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "fonds procesmodel_expertises" ON "public"."procesmodel_expertises" USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))) WITH CHECK (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "fonds procesmodel_focusgebieden" ON "public"."procesmodel_focusgebieden" USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))) WITH CHECK (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "fonds procesmodel_gremia" ON "public"."procesmodel_gremia" USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))) WITH CHECK (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "fonds procesmodellen" ON "public"."procesmodellen" USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))) WITH CHECK (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "fonds reindex_runs" ON "public"."reindex_runs" USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))) WITH CHECK (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "fonds risico log" ON "public"."risico_log" USING (("risico_id" IN ( SELECT "risicos"."id"
   FROM "public"."risicos"
  WHERE ("risicos"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"())))))) WITH CHECK (("risico_id" IN ( SELECT "risicos"."id"
   FROM "public"."risicos"
  WHERE ("risicos"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))));



CREATE POLICY "fonds risicos" ON "public"."risicos" USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))) WITH CHECK (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "fonds stem delete" ON "public"."stem_uitbrengingen" FOR DELETE USING ((("uitgebracht_door" = "auth"."uid"()) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) IS DISTINCT FROM 'bestuursbureau'::"text")));



CREATE POLICY "fonds stem insert" ON "public"."stem_uitbrengingen" FOR INSERT WITH CHECK ((("uitgebracht_door" = "auth"."uid"()) AND ("stemming_id" IN ( SELECT "stemmingen"."id"
   FROM "public"."stemmingen"
  WHERE ("stemmingen"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) IS DISTINCT FROM 'bestuursbureau'::"text")));



CREATE POLICY "fonds stem select" ON "public"."stem_uitbrengingen" FOR SELECT USING ((("stemming_id" IN ( SELECT "stemmingen"."id"
   FROM "public"."stemmingen"
  WHERE ("stemmingen"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) IS DISTINCT FROM 'bestuursbureau'::"text")));



CREATE POLICY "fonds stem update" ON "public"."stem_uitbrengingen" FOR UPDATE USING ((("uitgebracht_door" = "auth"."uid"()) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) IS DISTINCT FROM 'bestuursbureau'::"text"))) WITH CHECK ((("uitgebracht_door" = "auth"."uid"()) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) IS DISTINCT FROM 'bestuursbureau'::"text")));



CREATE POLICY "fonds stemmingen insert" ON "public"."stemmingen" FOR INSERT WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND ("geopend_door" = "auth"."uid"()) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) IS DISTINCT FROM 'bestuursbureau'::"text")));



CREATE POLICY "fonds stemmingen select" ON "public"."stemmingen" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "fonds stemmingen update" ON "public"."stemmingen" FOR UPDATE USING ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) IS DISTINCT FROM 'bestuursbureau'::"text"))) WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) IS DISTINCT FROM 'bestuursbureau'::"text")));



CREATE POLICY "fonds vergadering_log insert" ON "public"."vergadering_log" FOR INSERT WITH CHECK ((("vergadering_id" IN ( SELECT "vergaderingen"."id"
   FROM "public"."vergaderingen"
  WHERE ("vergaderingen"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))) AND ("actor_id" = "auth"."uid"())));



CREATE POLICY "fonds vergadering_log select" ON "public"."vergadering_log" FOR SELECT USING (("vergadering_id" IN ( SELECT "vergaderingen"."id"
   FROM "public"."vergaderingen"
  WHERE ("vergaderingen"."fonds_id" = ( SELECT "profielen"."fonds_id"
           FROM "public"."profielen"
          WHERE ("profielen"."id" = "auth"."uid"()))))));



CREATE POLICY "fonds vergaderingen" ON "public"."vergaderingen" USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))) WITH CHECK (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



ALTER TABLE "public"."fonds_config_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fonds_content_overrides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fonds_feature_flags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fonds_instellingen" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fonds_klantbeeld_cohort" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fonds_module_manifest" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fonds_stuurinfo_kpi" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fonds_stuurinfo_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fonds_stuurinfo_periode" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fonds_stuurinfo_reeks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fonds_stuurinfo_reserve" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fonds_theming" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fondsen" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "fondsen lezen" ON "public"."fondsen" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."gesprek_reflectie_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gesprekken" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."governance_audit_grants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."governance_audit_inzage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."governance_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."governance_export_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."governance_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."governance_log_inhoud" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."governance_redacties" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gremia" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "klantbeeld cohort bijwerken priv" ON "public"."fonds_klantbeeld_cohort" FOR UPDATE USING ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"])))) WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"]))));



CREATE POLICY "klantbeeld cohort lezen eigen fonds" ON "public"."fonds_klantbeeld_cohort" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "klantbeeld cohort schrijven priv" ON "public"."fonds_klantbeeld_cohort" FOR INSERT WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"]))));



ALTER TABLE "public"."kritische_focusgebieden" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lees catalogus_log" ON "public"."catalogus_log" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "lees document_metadata_log" ON "public"."document_metadata_log" FOR SELECT USING ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) OR (("fonds_id" IS NULL) AND ("document_id" IN ( SELECT "documenten"."id"
   FROM "public"."documenten"
  WHERE ("documenten"."bibliotheek" = 'generiek'::"text"))))));



CREATE POLICY "lees expertises" ON "public"."expertises" FOR SELECT USING ((("fonds_id" IS NULL) OR ("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))));



CREATE POLICY "lees focusgebieden" ON "public"."kritische_focusgebieden" FOR SELECT USING ((("fonds_id" IS NULL) OR ("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))));



CREATE POLICY "lees gremia" ON "public"."gremia" FOR SELECT USING ((("fonds_id" IS NULL) OR ("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))));



CREATE POLICY "lees meta_review_queue" ON "public"."document_metadata_review_queue" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "lees profiel_log" ON "public"."profiel_log" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "manifest bijwerken priv" ON "public"."fonds_module_manifest" FOR UPDATE USING ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"])))) WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"]))));



CREATE POLICY "manifest lezen eigen fonds" ON "public"."fonds_module_manifest" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "manifest schrijven priv" ON "public"."fonds_module_manifest" FOR INSERT WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"]))));



ALTER TABLE "public"."notificaties" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notificaties insert eigen fonds" ON "public"."notificaties" FOR INSERT WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND "public"."fn_zelfde_fonds"("ontvanger_id")));



ALTER TABLE "public"."notulen_segmenten" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organisatie_profielen" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organisatieprofiel insert eigen fonds" ON "public"."organisatie_profielen" FOR INSERT WITH CHECK (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "organisatieprofiel select eigen fonds" ON "public"."organisatie_profielen" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "organisatieprofiel update eigen fonds" ON "public"."organisatie_profielen" FOR UPDATE USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))) WITH CHECK (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "overrides bijwerken priv" ON "public"."fonds_content_overrides" FOR UPDATE USING ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"])))) WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"]))));



CREATE POLICY "overrides lezen eigen fonds" ON "public"."fonds_content_overrides" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "overrides schrijven priv" ON "public"."fonds_content_overrides" FOR INSERT WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"]))));



ALTER TABLE "public"."platform_capabilities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_event_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_identities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_identity_capabilities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_signaal_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_signal_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."procedure_afschriften" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."procedure_besluiten" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."procedure_bewijs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."procedure_checklist" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."procedure_eigenaars" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."procedure_fase_beschrijving_override" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."procedure_fase_toelichting" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."procedure_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."procedure_requirement_instance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."procedure_requirement_uitsluiting" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."procedure_requirements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."procedure_stappen" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."procedure_template_fasen" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."procedures" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."procesmodel_expertises" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."procesmodel_focusgebieden" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."procesmodel_gremia" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."procesmodellen" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiel select eigen" ON "public"."profielen" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "profiel update eigen" ON "public"."profielen" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



ALTER TABLE "public"."profiel_expertises" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiel_focusgebieden" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiel_gremia" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiel_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profielen" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rate_limit_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "redacties lezen" ON "public"."governance_redacties" FOR SELECT USING ((("uitgevoerd_door" = "auth"."uid"()) OR "public"."mag_audit_redacties"("fonds_id")));



CREATE POLICY "regime-mapping lezen" ON "public"."wettelijk_regime_per_fondstype" FOR SELECT USING (true);



ALTER TABLE "public"."reindex_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "req read all" ON "public"."procedure_requirements" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "req write beheerder" ON "public"."procedure_requirements" USING ((EXISTS ( SELECT 1
   FROM "public"."profielen"
  WHERE (("profielen"."id" = "auth"."uid"()) AND ("profielen"."rol" = 'beheerder'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profielen"
  WHERE (("profielen"."id" = "auth"."uid"()) AND ("profielen"."rol" = 'beheerder'::"text")))));



CREATE POLICY "req-instance eigen fonds lezen" ON "public"."procedure_requirement_instance" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "req-instance toevoegen voorzitter-beheerder" ON "public"."procedure_requirement_instance" FOR INSERT WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (EXISTS ( SELECT 1
   FROM "public"."profielen"
  WHERE (("profielen"."id" = "auth"."uid"()) AND ("profielen"."rol" = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"])))))));



CREATE POLICY "req-instance wijzigen voorzitter-beheerder" ON "public"."procedure_requirement_instance" FOR UPDATE USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))) WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (EXISTS ( SELECT 1
   FROM "public"."profielen"
  WHERE (("profielen"."id" = "auth"."uid"()) AND ("profielen"."rol" = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"])))))));



CREATE POLICY "req-uitsluiting eigen fonds lezen" ON "public"."procedure_requirement_uitsluiting" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "req-uitsluiting toevoegen voorzitter-beheerder" ON "public"."procedure_requirement_uitsluiting" FOR INSERT WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (EXISTS ( SELECT 1
   FROM "public"."profielen"
  WHERE (("profielen"."id" = "auth"."uid"()) AND ("profielen"."rol" = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"])))))));



CREATE POLICY "req-uitsluiting wijzigen voorzitter-beheerder" ON "public"."procedure_requirement_uitsluiting" FOR UPDATE USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))) WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (EXISTS ( SELECT 1
   FROM "public"."profielen"
  WHERE (("profielen"."id" = "auth"."uid"()) AND ("profielen"."rol" = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"])))))));



ALTER TABLE "public"."risico_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."risico_maatregelen" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."risicos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schrijf catalogus_log" ON "public"."catalogus_log" FOR INSERT WITH CHECK (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "schrijf document_metadata_log" ON "public"."document_metadata_log" FOR INSERT WITH CHECK ((("gewijzigd_door" = "auth"."uid"()) AND ("document_id" IN ( SELECT "documenten"."id"
   FROM "public"."documenten")) AND (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) OR (("fonds_id" IS NULL) AND ("document_id" IN ( SELECT "documenten"."id"
   FROM "public"."documenten"
  WHERE ("documenten"."bibliotheek" = 'generiek'::"text")))))));



CREATE POLICY "schrijf expertises" ON "public"."expertises" USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))) WITH CHECK (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "schrijf focusgebieden" ON "public"."kritische_focusgebieden" USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))) WITH CHECK (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "schrijf gremia" ON "public"."gremia" USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))) WITH CHECK (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "schrijf meta_review_queue" ON "public"."document_metadata_review_queue" USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))) WITH CHECK (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "schrijf profiel_log" ON "public"."profiel_log" FOR INSERT WITH CHECK ((("actor_id" = "auth"."uid"()) AND ("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())))));



ALTER TABLE "public"."semantic_units" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "semantic_units eigen fonds lezen" ON "public"."semantic_units" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



ALTER TABLE "public"."stem_uitbrengingen" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stemmingen" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stuurinfo kpi bijwerken priv" ON "public"."fonds_stuurinfo_kpi" FOR UPDATE USING ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"])))) WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"]))));



CREATE POLICY "stuurinfo kpi lezen eigen fonds" ON "public"."fonds_stuurinfo_kpi" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "stuurinfo kpi schrijven priv" ON "public"."fonds_stuurinfo_kpi" FOR INSERT WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"]))));



CREATE POLICY "stuurinfo log lezen eigen fonds" ON "public"."fonds_stuurinfo_log" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "stuurinfo log schrijven priv" ON "public"."fonds_stuurinfo_log" FOR INSERT WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"])) AND (NOT ("gebruiker_id" IS DISTINCT FROM "auth"."uid"()))));



CREATE POLICY "stuurinfo periode bijwerken priv" ON "public"."fonds_stuurinfo_periode" FOR UPDATE USING ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"])))) WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"]))));



CREATE POLICY "stuurinfo periode lezen eigen fonds" ON "public"."fonds_stuurinfo_periode" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "stuurinfo periode schrijven priv" ON "public"."fonds_stuurinfo_periode" FOR INSERT WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"]))));



CREATE POLICY "stuurinfo reeks bijwerken priv" ON "public"."fonds_stuurinfo_reeks" FOR UPDATE USING ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"])))) WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"]))));



CREATE POLICY "stuurinfo reeks lezen eigen fonds" ON "public"."fonds_stuurinfo_reeks" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "stuurinfo reeks schrijven priv" ON "public"."fonds_stuurinfo_reeks" FOR INSERT WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"]))));



CREATE POLICY "stuurinfo reserve bijwerken priv" ON "public"."fonds_stuurinfo_reserve" FOR UPDATE USING ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"])))) WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"]))));



CREATE POLICY "stuurinfo reserve lezen eigen fonds" ON "public"."fonds_stuurinfo_reserve" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "stuurinfo reserve schrijven priv" ON "public"."fonds_stuurinfo_reserve" FOR INSERT WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"]))));



ALTER TABLE "public"."tenant_domains" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "theming bijwerken priv" ON "public"."fonds_theming" FOR UPDATE USING ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"])))) WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"]))));



CREATE POLICY "theming lezen eigen fonds" ON "public"."fonds_theming" FOR SELECT USING (("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))));



CREATE POLICY "theming schrijven priv" ON "public"."fonds_theming" FOR INSERT WITH CHECK ((("fonds_id" = ( SELECT "profielen"."fonds_id"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"()))) AND (( SELECT "profielen"."rol"
   FROM "public"."profielen"
  WHERE ("profielen"."id" = "auth"."uid"())) = ANY (ARRAY['voorzitter'::"text", 'beheerder'::"text"]))));



ALTER TABLE "public"."vergadering_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vergaderingen" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."voorbereidingen" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wettelijk_regime_per_fondstype" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "zelf-lees eigen platform-identiteit" ON "public"."platform_identities" FOR SELECT USING (("auth"."uid"() = "id"));



REVOKE USAGE ON SCHEMA "public" FROM PUBLIC;
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT ALL ON SCHEMA "public" TO "service_role";



GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE "public"."procedure_afschriften" TO "authenticated";
GRANT ALL ON TABLE "public"."procedure_afschriften" TO "service_role";



REVOKE ALL ON FUNCTION "public"."afschriften_claim_jobs"("p_worker_id" "text", "p_limit" integer, "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."afschriften_claim_jobs"("p_worker_id" "text", "p_limit" integer, "p_lease_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."aqlab_add_run_cost"("p_run_id" "uuid", "p_delta" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."aqlab_add_run_cost"("p_run_id" "uuid", "p_delta" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."aqlab_assurance_meetwaarden"("p_codes" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."aqlab_assurance_meetwaarden"("p_codes" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."aqlab_assurance_meetwaarden"("p_codes" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."aqlab_audit_export_bron"("p_export_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."aqlab_audit_export_bron"("p_export_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."aqlab_audit_export_bron"("p_export_id" "uuid") TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."aqlab_run_jobs" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."aqlab_run_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."aqlab_run_jobs" TO "service_role";



REVOKE ALL ON FUNCTION "public"."aqlab_claim_run_jobs"("p_worker_id" "text", "p_limit" integer, "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."aqlab_claim_run_jobs"("p_worker_id" "text", "p_limit" integer, "p_lease_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."aqlab_log_download"("p_export_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."aqlab_log_download"("p_export_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."aqlab_log_download"("p_export_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."contact_aanvraag_insert"("p_naam" "text", "p_organisatie" "text", "p_rol" "text", "p_email" "text", "p_telefoon" "text", "p_type_verzoek" "text", "p_bericht" "text", "p_herkomst_pagina" "text", "p_privacy_version" "text", "p_ip_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."contact_aanvraag_insert"("p_naam" "text", "p_organisatie" "text", "p_rol" "text", "p_email" "text", "p_telefoon" "text", "p_type_verzoek" "text", "p_bericht" "text", "p_herkomst_pagina" "text", "p_privacy_version" "text", "p_ip_hash" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."contact_aanvraag_insert"("p_naam" "text", "p_organisatie" "text", "p_rol" "text", "p_email" "text", "p_telefoon" "text", "p_type_verzoek" "text", "p_bericht" "text", "p_herkomst_pagina" "text", "p_privacy_version" "text", "p_ip_hash" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."contact_aanvraag_insert"("p_naam" "text", "p_organisatie" "text", "p_rol" "text", "p_email" "text", "p_telefoon" "text", "p_type_verzoek" "text", "p_bericht" "text", "p_herkomst_pagina" "text", "p_privacy_version" "text", "p_ip_hash" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."contact_notificatie_status"("p_id" "uuid", "p_verzonden" boolean, "p_error" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."contact_notificatie_status"("p_id" "uuid", "p_verzonden" boolean, "p_error" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."contact_notificatie_status"("p_id" "uuid", "p_verzonden" boolean, "p_error" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."contact_notificatie_status"("p_id" "uuid", "p_verzonden" boolean, "p_error" "text") TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."document_processing_jobs" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."document_processing_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."document_processing_jobs" TO "service_role";



REVOKE ALL ON FUNCTION "public"."documenten_claim_ingest_jobs"("p_worker_id" "text", "p_limit" integer, "p_lease_seconds" integer, "p_max_per_fonds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."documenten_claim_ingest_jobs"("p_worker_id" "text", "p_limit" integer, "p_lease_seconds" integer, "p_max_per_fonds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_afschrift_bevries_kolommen"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_afschrift_bevries_kolommen"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_afschrift_bevries_kolommen"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_app_error_log"("p_label" "text", "p_categorie" "text", "p_severity" "text", "p_http_status" integer, "p_fouttype" "text", "p_foutcode" "text", "p_melding_kort" "text", "p_context_sleutels" "text"[], "p_correlatie_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_app_error_log"("p_label" "text", "p_categorie" "text", "p_severity" "text", "p_http_status" integer, "p_fouttype" "text", "p_foutcode" "text", "p_melding_kort" "text", "p_context_sleutels" "text"[], "p_correlatie_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_app_error_log"("p_label" "text", "p_categorie" "text", "p_severity" "text", "p_http_status" integer, "p_fouttype" "text", "p_foutcode" "text", "p_melding_kort" "text", "p_context_sleutels" "text"[], "p_correlatie_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_bron_whitelist_log_hash"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_bron_whitelist_log_hash"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_bron_whitelist_log_hash"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_bron_whitelist_log_immutable"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_bron_whitelist_log_immutable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_bron_whitelist_log_immutable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_build_decision_dossier"("p_decision_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_build_decision_dossier"("p_decision_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_build_decision_dossier"("p_decision_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_chunk_denorm"("p_document_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_chunk_denorm"("p_document_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_chunk_denorm"("p_document_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_chunk_denorm_before_insert"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_chunk_denorm_before_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_chunk_denorm_before_insert"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_chunk_denorm_refresh"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_chunk_denorm_refresh"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_chunk_denorm_refresh"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_contact_aanvragen_no_delete"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_contact_aanvragen_no_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_contact_aanvragen_no_delete"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_decision_code"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_decision_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_decision_code"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_decision_readiness_check"("p_decision_id" "uuid", "p_target" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_decision_readiness_check"("p_decision_id" "uuid", "p_target" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_decision_readiness_check"("p_decision_id" "uuid", "p_target" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_decision_readiness_overview"("p_decision_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_decision_readiness_overview"("p_decision_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_decision_readiness_overview"("p_decision_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_decision_snapshot"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_decision_snapshot"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_decision_snapshot"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_decision_status_check"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_decision_status_check"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_decision_status_check"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_decision_touch"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_decision_touch"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_decision_touch"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_doc_meta_log_hash"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_doc_meta_log_hash"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_doc_meta_log_hash"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_doc_meta_log_immutable"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_doc_meta_log_immutable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_doc_meta_log_immutable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_document_agendapunt_validatie"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_document_agendapunt_validatie"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_document_agendapunt_vergadering_check"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_document_agendapunt_vergadering_check"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_document_agendapunt_vergadering_check"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_document_primair_vs_secundair_check"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_document_primair_vs_secundair_check"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_document_primair_vs_secundair_check"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_document_procesinstantie_fonds_check"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_document_procesinstantie_fonds_check"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_document_procesinstantie_fonds_check"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_document_procesinstantie_validatie"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_document_procesinstantie_validatie"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_document_procesinstantie_validatie"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_document_status_overgang_check"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_document_status_overgang_check"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_document_status_overgang_check"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_document_status_transitie"("p_van" "text", "p_naar" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_document_status_transitie"("p_van" "text", "p_naar" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_document_status_transitie"("p_van" "text", "p_naar" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_dossierstatus_van_decision"("p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_dossierstatus_van_decision"("p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_dossierstatus_van_decision"("p_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_export_log_immutable"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_export_log_immutable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_export_log_immutable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_fonds_config_capture"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_fonds_config_capture"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_fonds_config_capture"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_fonds_stuurinfo_capture"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_fonds_stuurinfo_capture"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_fonds_stuurinfo_capture"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_generiek_geldigheidsstatus"("p_status" "text", "p_bronstatus" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_generiek_geldigheidsstatus"("p_status" "text", "p_bronstatus" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_generiek_geldigheidsstatus"("p_status" "text", "p_bronstatus" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_generiek_status_overgang_check"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_generiek_status_overgang_check"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_generiek_status_overgang_check"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_generiek_transitie"("p_van" "text", "p_naar" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_generiek_transitie"("p_van" "text", "p_naar" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_generiek_transitie"("p_van" "text", "p_naar" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_govevent_hash"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_govevent_hash"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_govevent_hash"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_govevent_immutable"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_govevent_immutable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_govevent_immutable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_log_append_only"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_log_append_only"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_log_append_only"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_notulen_segment_audit"("p_document_id" "uuid", "p_veld" "text", "p_oud" "text", "p_nieuw" "text", "p_reden" "text", "p_rag_impact" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_notulen_segment_audit"("p_document_id" "uuid", "p_veld" "text", "p_oud" "text", "p_nieuw" "text", "p_reden" "text", "p_rag_impact" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_notulen_segment_audit"("p_document_id" "uuid", "p_veld" "text", "p_oud" "text", "p_nieuw" "text", "p_reden" "text", "p_rag_impact" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_notulen_segment_bevestig"("p_segment_id" "uuid", "p_chunks" "jsonb", "p_reden" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_notulen_segment_bevestig"("p_segment_id" "uuid", "p_chunks" "jsonb", "p_reden" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_notulen_segment_bevestig"("p_segment_id" "uuid", "p_chunks" "jsonb", "p_reden" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_notulen_segment_check"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_notulen_segment_check"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_notulen_segment_check"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_notulen_segment_ontbevestig"("p_segment_id" "uuid", "p_reden" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_notulen_segment_ontbevestig"("p_segment_id" "uuid", "p_reden" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_notulen_segment_ontbevestig"("p_segment_id" "uuid", "p_reden" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_notulen_segment_verwijder"("p_segment_id" "uuid", "p_reden" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_notulen_segment_verwijder"("p_segment_id" "uuid", "p_reden" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_notulen_segment_verwijder"("p_segment_id" "uuid", "p_reden" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_organisatie_profielen_touch"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_organisatie_profielen_touch"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_organisatie_profielen_touch"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_platform_event_hash"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_platform_event_hash"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_platform_event_hash"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_platform_event_immutable"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_platform_event_immutable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_platform_event_immutable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_profiel_bevries_kolommen"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_profiel_bevries_kolommen"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_rate_limit_check"("p_endpoint" "text", "p_limiet" integer, "p_venster" interval) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_rate_limit_check"("p_endpoint" "text", "p_limiet" integer, "p_venster" interval) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_rate_limit_check"("p_endpoint" "text", "p_limiet" integer, "p_venster" interval) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_schrijf_semantische_extractie"("p_fonds_id" "uuid", "p_document_id" "uuid", "p_model" "text", "p_prompt_version" "text", "p_extractor_version" "text", "p_catalog_version" "text", "p_status" "text", "p_units" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_schrijf_semantische_extractie"("p_fonds_id" "uuid", "p_document_id" "uuid", "p_model" "text", "p_prompt_version" "text", "p_extractor_version" "text", "p_catalog_version" "text", "p_status" "text", "p_units" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_schrijf_vergelijking"("p_mode" "text", "p_model" "text", "p_prompt_version" "text", "p_comparator_version" "text", "p_findings" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_schrijf_vergelijking"("p_mode" "text", "p_model" "text", "p_prompt_version" "text", "p_comparator_version" "text", "p_findings" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_schrijf_vergelijking"("p_mode" "text", "p_model" "text", "p_prompt_version" "text", "p_comparator_version" "text", "p_findings" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_snapshot_immutable"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_snapshot_immutable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_snapshot_immutable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_zelfde_fonds"("p_gebruiker" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_zelfde_fonds"("p_gebruiker" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_zelfde_fonds"("p_gebruiker" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mag_audit"("p_fonds" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mag_audit"("p_fonds" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mag_audit"("p_fonds" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mag_audit_bronnen"("p_fonds" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mag_audit_bronnen"("p_fonds" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mag_audit_bronnen"("p_fonds" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."meta_basisniveau"("p_meta" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."meta_basisniveau"("p_meta" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."meta_basisniveau"("p_meta" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."meta_bronniveau"("p_meta" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."meta_bronniveau"("p_meta" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."meta_bronniveau"("p_meta" "jsonb") TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."governance_log" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."governance_log" TO "authenticated";
GRANT ALL ON TABLE "public"."governance_log" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."governance_log_inhoud" TO "authenticated";
GRANT ALL ON TABLE "public"."governance_log_inhoud" TO "service_role";



GRANT ALL ON TABLE "public"."vw_governance_audit" TO "service_role";



REVOKE ALL ON FUNCTION "public"."lees_governance_audit"("p_fonds" "uuid", "p_filters" "jsonb", "p_motivering" "text", "p_limiet" integer, "p_bronniveau" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lees_governance_audit"("p_fonds" "uuid", "p_filters" "jsonb", "p_motivering" "text", "p_limiet" integer, "p_bronniveau" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."lees_governance_audit"("p_fonds" "uuid", "p_filters" "jsonb", "p_motivering" "text", "p_limiet" integer, "p_bronniveau" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_word_export"("p_gesprek_audit_id" "uuid", "p_stuksoort" "text", "p_promptvariant" "text", "p_bronnen" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_word_export"("p_gesprek_audit_id" "uuid", "p_stuksoort" "text", "p_promptvariant" "text", "p_bronnen" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_word_export"("p_gesprek_audit_id" "uuid", "p_stuksoort" "text", "p_promptvariant" "text", "p_bronnen" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."maak_profiel"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."maak_profiel"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mag_audit_redacties"("p_fonds" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mag_audit_redacties"("p_fonds" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mag_audit_redacties"("p_fonds" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."meta_projectie"("p_meta" "jsonb", "p_bron" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."meta_projectie"("p_meta" "jsonb", "p_bron" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."meta_projectie"("p_meta" "jsonb", "p_bron" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."profiel_opslaan"("p_naam" "text", "p_bestuurlijke_rol" "text", "p_primaire_expertise_id" "uuid", "p_antwoordvoorkeur" "text", "p_standaard_ai_modus" "text", "p_detailniveau" "text", "p_secundaire_expertise_ids" "uuid"[], "p_gremium_ids" "uuid"[], "p_focusgebied_ids" "uuid"[], "p_reflectie_uitnodiging" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."profiel_opslaan"("p_naam" "text", "p_bestuurlijke_rol" "text", "p_primaire_expertise_id" "uuid", "p_antwoordvoorkeur" "text", "p_standaard_ai_modus" "text", "p_detailniveau" "text", "p_secundaire_expertise_ids" "uuid"[], "p_gremium_ids" "uuid"[], "p_focusgebied_ids" "uuid"[], "p_reflectie_uitnodiging" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."profiel_opslaan"("p_naam" "text", "p_bestuurlijke_rol" "text", "p_primaire_expertise_id" "uuid", "p_antwoordvoorkeur" "text", "p_standaard_ai_modus" "text", "p_detailniveau" "text", "p_secundaire_expertise_ids" "uuid"[], "p_gremium_ids" "uuid"[], "p_focusgebied_ids" "uuid"[], "p_reflectie_uitnodiging" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reflectie_bronset_hash"("p_retrieval_meta" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reflectie_bronset_hash"("p_retrieval_meta" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reflectie_bronset_hash"("p_retrieval_meta" "jsonb") TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."gesprek_reflectie_state" TO "authenticated";
GRANT ALL ON TABLE "public"."gesprek_reflectie_state" TO "service_role";



REVOKE ALL ON FUNCTION "public"."reflectie_transitie"("p_gesprek_id" "uuid", "p_actie" "text", "p_ingang" "text", "p_bronset_log_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reflectie_transitie"("p_gesprek_id" "uuid", "p_actie" "text", "p_ingang" "text", "p_bronset_log_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reflectie_transitie"("p_gesprek_id" "uuid", "p_actie" "text", "p_ingang" "text", "p_bronset_log_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_tenant_host"("p_host" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_tenant_host"("p_host" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_tenant_host"("p_host" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_tenant_host"("p_host" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."schrijf_ai_interactie"("p_vraag" "text", "p_antwoord" "text", "p_bronnen" "jsonb", "p_modus" "text", "p_model" "text", "p_retrieval_meta" "jsonb", "p_retrieval_meta_inhoud" "jsonb", "p_gesprek_audit_id" "uuid", "p_inhoud_hmac" "text", "p_hmac_schema_versie" smallint, "p_hmac_sleutel_versie" smallint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."schrijf_ai_interactie"("p_vraag" "text", "p_antwoord" "text", "p_bronnen" "jsonb", "p_modus" "text", "p_model" "text", "p_retrieval_meta" "jsonb", "p_retrieval_meta_inhoud" "jsonb", "p_gesprek_audit_id" "uuid", "p_inhoud_hmac" "text", "p_hmac_schema_versie" smallint, "p_hmac_sleutel_versie" smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."schrijf_ai_interactie"("p_vraag" "text", "p_antwoord" "text", "p_bronnen" "jsonb", "p_modus" "text", "p_model" "text", "p_retrieval_meta" "jsonb", "p_retrieval_meta_inhoud" "jsonb", "p_gesprek_audit_id" "uuid", "p_inhoud_hmac" "text", "p_hmac_schema_versie" smallint, "p_hmac_sleutel_versie" smallint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."stuurinfo_balans_opslaan"("p_periode" "text", "p_peildatum" "date", "p_bron" "text", "p_invoer_bron" "text", "p_activa" "jsonb", "p_passiva" "jsonb", "p_reserves" "jsonb", "p_financieringsgraad" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stuurinfo_balans_opslaan"("p_periode" "text", "p_peildatum" "date", "p_bron" "text", "p_invoer_bron" "text", "p_activa" "jsonb", "p_passiva" "jsonb", "p_reserves" "jsonb", "p_financieringsgraad" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."stuurinfo_balans_opslaan"("p_periode" "text", "p_peildatum" "date", "p_bron" "text", "p_invoer_bron" "text", "p_activa" "jsonb", "p_passiva" "jsonb", "p_reserves" "jsonb", "p_financieringsgraad" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."stuurinfo_operationeel_opslaan"("p_periode" "text", "p_invoer_bron" "text", "p_mutaties" "jsonb", "p_norm" numeric, "p_band_onder" numeric, "p_band_boven" numeric, "p_kosten_realisatie" "jsonb", "p_kosten_begroot" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stuurinfo_operationeel_opslaan"("p_periode" "text", "p_invoer_bron" "text", "p_mutaties" "jsonb", "p_norm" numeric, "p_band_onder" numeric, "p_band_boven" numeric, "p_kosten_realisatie" "jsonb", "p_kosten_begroot" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."stuurinfo_operationeel_opslaan"("p_periode" "text", "p_invoer_bron" "text", "p_mutaties" "jsonb", "p_norm" numeric, "p_band_onder" numeric, "p_band_boven" numeric, "p_kosten_realisatie" "jsonb", "p_kosten_begroot" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."stuurinfo_premie_opslaan"("p_periode" "text", "p_invoer_bron" "text", "p_componenten_eur" "jsonb", "p_componenten_pct" "jsonb", "p_comp_mutaties" "jsonb", "p_toekenning" numeric, "p_startomvang" numeric, "p_ondergrens_pct" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stuurinfo_premie_opslaan"("p_periode" "text", "p_invoer_bron" "text", "p_componenten_eur" "jsonb", "p_componenten_pct" "jsonb", "p_comp_mutaties" "jsonb", "p_toekenning" numeric, "p_startomvang" numeric, "p_ondergrens_pct" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."stuurinfo_premie_opslaan"("p_periode" "text", "p_invoer_bron" "text", "p_componenten_eur" "jsonb", "p_componenten_pct" "jsonb", "p_comp_mutaties" "jsonb", "p_toekenning" numeric, "p_startomvang" numeric, "p_ondergrens_pct" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."stuurinfo_soli_opslaan"("p_periode" "text", "p_invoer_bron" "text", "p_vulling" "jsonb", "p_uitdeling" numeric, "p_ondergrens" numeric, "p_bovengrens" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stuurinfo_soli_opslaan"("p_periode" "text", "p_invoer_bron" "text", "p_vulling" "jsonb", "p_uitdeling" numeric, "p_ondergrens" numeric, "p_bovengrens" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."stuurinfo_soli_opslaan"("p_periode" "text", "p_invoer_bron" "text", "p_vulling" "jsonb", "p_uitdeling" numeric, "p_ondergrens" numeric, "p_bovengrens" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."verwijder_gesprek"("p_gesprek_id" "uuid", "p_request_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verwijder_gesprek"("p_gesprek_id" "uuid", "p_request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."verwijder_gesprek"("p_gesprek_id" "uuid", "p_request_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."zoek_chunks"("p_query" "text", "p_limit" integer, "p_document_ids" "uuid"[], "p_bronstatus" "text"[], "p_documentstatus" "text"[], "p_procesinstantie_ids" "uuid"[], "p_modus" "text", "p_peildatum" "date", "p_bronsoort" "text"[], "p_fonds_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."zoek_chunks"("p_query" "text", "p_limit" integer, "p_document_ids" "uuid"[], "p_bronstatus" "text"[], "p_documentstatus" "text"[], "p_procesinstantie_ids" "uuid"[], "p_modus" "text", "p_peildatum" "date", "p_bronsoort" "text"[], "p_fonds_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."zoek_chunks"("p_query" "text", "p_limit" integer, "p_document_ids" "uuid"[], "p_bronstatus" "text"[], "p_documentstatus" "text"[], "p_procesinstantie_ids" "uuid"[], "p_modus" "text", "p_peildatum" "date", "p_bronsoort" "text"[], "p_fonds_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."zoek_chunks_hybride"("p_query" "text", "p_embedding" "public"."vector", "p_limit" integer, "p_kandidaten" integer, "p_k" integer, "p_document_ids" "uuid"[], "p_bronstatus" "text"[], "p_documentstatus" "text"[], "p_procesinstantie_ids" "uuid"[], "p_modus" "text", "p_peildatum" "date", "p_bronsoort" "text"[], "p_fonds_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."zoek_chunks_hybride"("p_query" "text", "p_embedding" "public"."vector", "p_limit" integer, "p_kandidaten" integer, "p_k" integer, "p_document_ids" "uuid"[], "p_bronstatus" "text"[], "p_documentstatus" "text"[], "p_procesinstantie_ids" "uuid"[], "p_modus" "text", "p_peildatum" "date", "p_bronsoort" "text"[], "p_fonds_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."zoek_chunks_hybride"("p_query" "text", "p_embedding" "public"."vector", "p_limit" integer, "p_kandidaten" integer, "p_k" integer, "p_document_ids" "uuid"[], "p_bronstatus" "text"[], "p_documentstatus" "text"[], "p_procesinstantie_ids" "uuid"[], "p_modus" "text", "p_peildatum" "date", "p_bronsoort" "text"[], "p_fonds_id" "uuid") TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."agendapunt_inbreng" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."agendapunt_inbreng" TO "authenticated";
GRANT ALL ON TABLE "public"."agendapunt_inbreng" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."agendapunt_log" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."agendapunt_log" TO "authenticated";
GRANT ALL ON TABLE "public"."agendapunt_log" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."agendapunten" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."agendapunten" TO "authenticated";
GRANT ALL ON TABLE "public"."agendapunten" TO "service_role";



GRANT ALL ON TABLE "public"."app_errors" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."aqlab_ai_features" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."aqlab_ai_features" TO "authenticated";
GRANT ALL ON TABLE "public"."aqlab_ai_features" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."aqlab_audit_exports" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."aqlab_audit_exports" TO "authenticated";
GRANT ALL ON TABLE "public"."aqlab_audit_exports" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."aqlab_findings" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."aqlab_findings" TO "authenticated";
GRANT ALL ON TABLE "public"."aqlab_findings" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."aqlab_fixture_documents" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."aqlab_fixture_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."aqlab_fixture_documents" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."aqlab_human_reviews" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."aqlab_human_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."aqlab_human_reviews" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."aqlab_log" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."aqlab_log" TO "authenticated";
GRANT ALL ON TABLE "public"."aqlab_log" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."aqlab_model_configurations" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."aqlab_model_configurations" TO "authenticated";
GRANT ALL ON TABLE "public"."aqlab_model_configurations" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."aqlab_prompt_versions" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."aqlab_prompt_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."aqlab_prompt_versions" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."aqlab_release_decisions" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."aqlab_release_decisions" TO "authenticated";
GRANT ALL ON TABLE "public"."aqlab_release_decisions" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."aqlab_run_outputs" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."aqlab_run_outputs" TO "authenticated";
GRANT ALL ON TABLE "public"."aqlab_run_outputs" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."aqlab_runs" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."aqlab_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."aqlab_runs" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."aqlab_scores" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."aqlab_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."aqlab_scores" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."aqlab_test_case_fixtures" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."aqlab_test_case_fixtures" TO "authenticated";
GRANT ALL ON TABLE "public"."aqlab_test_case_fixtures" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."aqlab_test_cases" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."aqlab_test_cases" TO "authenticated";
GRANT ALL ON TABLE "public"."aqlab_test_cases" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."aqlab_test_sets" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."aqlab_test_sets" TO "authenticated";
GRANT ALL ON TABLE "public"."aqlab_test_sets" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."bron_whitelist" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."bron_whitelist" TO "authenticated";
GRANT ALL ON TABLE "public"."bron_whitelist" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."bron_whitelist_log" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."bron_whitelist_log" TO "authenticated";
GRANT ALL ON TABLE "public"."bron_whitelist_log" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."catalogus_log" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."catalogus_log" TO "authenticated";
GRANT ALL ON TABLE "public"."catalogus_log" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."classificatie_voorstellen" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."classificatie_voorstellen" TO "authenticated";
GRANT ALL ON TABLE "public"."classificatie_voorstellen" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."comparison_results" TO "authenticated";
GRANT ALL ON TABLE "public"."comparison_results" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."comparison_run" TO "authenticated";
GRANT ALL ON TABLE "public"."comparison_run" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."concepts" TO "authenticated";
GRANT ALL ON TABLE "public"."concepts" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."contact_aanvragen" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."contact_aanvragen" TO "authenticated";
GRANT ALL ON TABLE "public"."contact_aanvragen" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."decision_actions" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."decision_actions" TO "authenticated";
GRANT ALL ON TABLE "public"."decision_actions" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."decision_ai_interactions" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."decision_ai_interactions" TO "authenticated";
GRANT ALL ON TABLE "public"."decision_ai_interactions" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."decision_assumptions" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."decision_assumptions" TO "authenticated";
GRANT ALL ON TABLE "public"."decision_assumptions" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."decision_audit_snapshots" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."decision_audit_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."decision_audit_snapshots" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."decision_conditions" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."decision_conditions" TO "authenticated";
GRANT ALL ON TABLE "public"."decision_conditions" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."decision_dissent" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."decision_dissent" TO "authenticated";
GRANT ALL ON TABLE "public"."decision_dissent" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."decision_evaluations" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."decision_evaluations" TO "authenticated";
GRANT ALL ON TABLE "public"."decision_evaluations" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."decision_objects" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."decision_objects" TO "authenticated";
GRANT ALL ON TABLE "public"."decision_objects" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."decision_risks" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."decision_risks" TO "authenticated";
GRANT ALL ON TABLE "public"."decision_risks" TO "service_role";



GRANT ALL ON SEQUENCE "public"."decision_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."decision_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."decision_seq" TO "service_role";



GRANT SELECT,INSERT,MAINTAIN ON TABLE "public"."difference_judgements" TO "authenticated";
GRANT ALL ON TABLE "public"."difference_judgements" TO "service_role";



GRANT SELECT ON TABLE "public"."document_agendapunten" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."document_agendapunten" TO "authenticated";
GRANT ALL ON TABLE "public"."document_agendapunten" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."document_chunks" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."document_chunks" TO "authenticated";
GRANT ALL ON TABLE "public"."document_chunks" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."document_inzage" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."document_inzage" TO "authenticated";
GRANT ALL ON TABLE "public"."document_inzage" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."document_metadata_log" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."document_metadata_log" TO "authenticated";
GRANT ALL ON TABLE "public"."document_metadata_log" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."document_metadata_review_queue" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."document_metadata_review_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."document_metadata_review_queue" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."document_procesinstanties" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."document_procesinstanties" TO "authenticated";
GRANT ALL ON TABLE "public"."document_procesinstanties" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."documenten" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."documenten" TO "authenticated";
GRANT ALL ON TABLE "public"."documenten" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."expertises" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."expertises" TO "authenticated";
GRANT ALL ON TABLE "public"."expertises" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."extraction_run" TO "authenticated";
GRANT ALL ON TABLE "public"."extraction_run" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."fonds_config_log" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."fonds_config_log" TO "authenticated";
GRANT ALL ON TABLE "public"."fonds_config_log" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."fonds_content_overrides" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."fonds_content_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."fonds_content_overrides" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."fonds_feature_flags" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."fonds_feature_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."fonds_feature_flags" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."fonds_instellingen" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."fonds_instellingen" TO "authenticated";
GRANT ALL ON TABLE "public"."fonds_instellingen" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."fonds_klantbeeld_cohort" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."fonds_klantbeeld_cohort" TO "authenticated";
GRANT ALL ON TABLE "public"."fonds_klantbeeld_cohort" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."fonds_module_manifest" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."fonds_module_manifest" TO "authenticated";
GRANT ALL ON TABLE "public"."fonds_module_manifest" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."fonds_stuurinfo_kpi" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."fonds_stuurinfo_kpi" TO "authenticated";
GRANT ALL ON TABLE "public"."fonds_stuurinfo_kpi" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."fonds_stuurinfo_log" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."fonds_stuurinfo_log" TO "authenticated";
GRANT ALL ON TABLE "public"."fonds_stuurinfo_log" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."fonds_stuurinfo_periode" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."fonds_stuurinfo_periode" TO "authenticated";
GRANT ALL ON TABLE "public"."fonds_stuurinfo_periode" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."fonds_stuurinfo_reeks" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."fonds_stuurinfo_reeks" TO "authenticated";
GRANT ALL ON TABLE "public"."fonds_stuurinfo_reeks" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."fonds_stuurinfo_reserve" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."fonds_stuurinfo_reserve" TO "authenticated";
GRANT ALL ON TABLE "public"."fonds_stuurinfo_reserve" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."fonds_theming" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."fonds_theming" TO "authenticated";
GRANT ALL ON TABLE "public"."fonds_theming" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."fondsen" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."fondsen" TO "authenticated";
GRANT ALL ON TABLE "public"."fondsen" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."gesprekken" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."gesprekken" TO "authenticated";
GRANT ALL ON TABLE "public"."gesprekken" TO "service_role";



GRANT ALL ON TABLE "public"."governance_audit_grants" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."governance_audit_inzage" TO "authenticated";
GRANT ALL ON TABLE "public"."governance_audit_inzage" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."governance_events" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."governance_events" TO "authenticated";
GRANT ALL ON TABLE "public"."governance_events" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."governance_export_log" TO "authenticated";
GRANT ALL ON TABLE "public"."governance_export_log" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."governance_redacties" TO "authenticated";
GRANT ALL ON TABLE "public"."governance_redacties" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."gremia" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."gremia" TO "authenticated";
GRANT ALL ON TABLE "public"."gremia" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."kritische_focusgebieden" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."kritische_focusgebieden" TO "authenticated";
GRANT ALL ON TABLE "public"."kritische_focusgebieden" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."notificaties" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."notificaties" TO "authenticated";
GRANT ALL ON TABLE "public"."notificaties" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."notulen_segmenten" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."notulen_segmenten" TO "authenticated";
GRANT ALL ON TABLE "public"."notulen_segmenten" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."organisatie_profielen" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."organisatie_profielen" TO "authenticated";
GRANT ALL ON TABLE "public"."organisatie_profielen" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."platform_capabilities" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."platform_capabilities" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_capabilities" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."platform_event_log" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."platform_event_log" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_event_log" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."platform_identities" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."platform_identities" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_identities" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."platform_identity_capabilities" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."platform_identity_capabilities" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_identity_capabilities" TO "service_role";



GRANT ALL ON TABLE "public"."platform_signaal_config" TO "service_role";



GRANT ALL ON TABLE "public"."platform_signal_snapshots" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."procedure_besluiten" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."procedure_besluiten" TO "authenticated";
GRANT ALL ON TABLE "public"."procedure_besluiten" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."procedure_bewijs" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."procedure_bewijs" TO "authenticated";
GRANT ALL ON TABLE "public"."procedure_bewijs" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."procedure_checklist" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."procedure_checklist" TO "authenticated";
GRANT ALL ON TABLE "public"."procedure_checklist" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."procedure_eigenaars" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."procedure_eigenaars" TO "authenticated";
GRANT ALL ON TABLE "public"."procedure_eigenaars" TO "service_role";



GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE "public"."procedure_fase_beschrijving_override" TO "authenticated";
GRANT ALL ON TABLE "public"."procedure_fase_beschrijving_override" TO "service_role";



GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE "public"."procedure_fase_toelichting" TO "authenticated";
GRANT ALL ON TABLE "public"."procedure_fase_toelichting" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."procedure_log" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."procedure_log" TO "authenticated";
GRANT ALL ON TABLE "public"."procedure_log" TO "service_role";



GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE "public"."procedure_requirement_instance" TO "authenticated";
GRANT ALL ON TABLE "public"."procedure_requirement_instance" TO "service_role";



GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE "public"."procedure_requirement_uitsluiting" TO "authenticated";
GRANT ALL ON TABLE "public"."procedure_requirement_uitsluiting" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."procedure_requirements" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."procedure_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."procedure_requirements" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."procedure_stappen" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."procedure_stappen" TO "authenticated";
GRANT ALL ON TABLE "public"."procedure_stappen" TO "service_role";



GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE "public"."procedure_template_fasen" TO "authenticated";
GRANT ALL ON TABLE "public"."procedure_template_fasen" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."procedures" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."procedures" TO "authenticated";
GRANT ALL ON TABLE "public"."procedures" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."procesmodel_expertises" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."procesmodel_expertises" TO "authenticated";
GRANT ALL ON TABLE "public"."procesmodel_expertises" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."procesmodel_focusgebieden" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."procesmodel_focusgebieden" TO "authenticated";
GRANT ALL ON TABLE "public"."procesmodel_focusgebieden" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."procesmodel_gremia" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."procesmodel_gremia" TO "authenticated";
GRANT ALL ON TABLE "public"."procesmodel_gremia" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."procesmodellen" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."procesmodellen" TO "authenticated";
GRANT ALL ON TABLE "public"."procesmodellen" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."profiel_expertises" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."profiel_expertises" TO "authenticated";
GRANT ALL ON TABLE "public"."profiel_expertises" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."profiel_focusgebieden" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."profiel_focusgebieden" TO "authenticated";
GRANT ALL ON TABLE "public"."profiel_focusgebieden" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."profiel_gremia" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."profiel_gremia" TO "authenticated";
GRANT ALL ON TABLE "public"."profiel_gremia" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."profiel_log" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."profiel_log" TO "authenticated";
GRANT ALL ON TABLE "public"."profiel_log" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."profielen" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."profielen" TO "authenticated";
GRANT ALL ON TABLE "public"."profielen" TO "service_role";



GRANT ALL ON TABLE "public"."rate_limit_events" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."reindex_runs" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."reindex_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."reindex_runs" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."risico_log" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."risico_log" TO "authenticated";
GRANT ALL ON TABLE "public"."risico_log" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."risico_maatregelen" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."risico_maatregelen" TO "authenticated";
GRANT ALL ON TABLE "public"."risico_maatregelen" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."risicos" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."risicos" TO "authenticated";
GRANT ALL ON TABLE "public"."risicos" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."semantic_units" TO "authenticated";
GRANT ALL ON TABLE "public"."semantic_units" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."stem_uitbrengingen" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."stem_uitbrengingen" TO "authenticated";
GRANT ALL ON TABLE "public"."stem_uitbrengingen" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."stemmingen" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."stemmingen" TO "authenticated";
GRANT ALL ON TABLE "public"."stemmingen" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."tenant_domains" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."tenant_domains" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_domains" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."vergadering_log" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."vergadering_log" TO "authenticated";
GRANT ALL ON TABLE "public"."vergadering_log" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."vergaderingen" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."vergaderingen" TO "authenticated";
GRANT ALL ON TABLE "public"."vergaderingen" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."voorbereidingen" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."voorbereidingen" TO "authenticated";
GRANT ALL ON TABLE "public"."voorbereidingen" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."vw_dossier_status" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."vw_dossier_status" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_dossier_status" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."vw_fondsleden" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_fondsleden" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."wettelijk_regime_per_fondstype" TO "authenticated";
GRANT ALL ON TABLE "public"."wettelijk_regime_per_fondstype" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
