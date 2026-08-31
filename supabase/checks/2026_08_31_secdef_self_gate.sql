-- #212 — SECURITY DEFINER is nooit een impliciete RLS-uitzondering.
-- ROL: postgres draait als database-eigenaar om catalogus- en grantmetadata te kunnen
--      beoordelen; de gecontroleerde browserrol is expliciet `authenticated`.
--
-- Elke browser-uitvoerbare DEFINER-functie staat hieronder exact één keer. Een
-- nieuwe functie, overloading of grant faalt dus totdat expliciet is vastgelegd
-- welk eigen slot haar beschermt. `productbreed` en `trigger` zijn bewuste,
-- gemotiveerde uitzonderingen: zij ontsluiten geen fondsobject respectievelijk
-- zijn alleen veilig als zij werkelijk aan een trigger hangen.

do $$
declare
  fouten text := '';
  r record;
begin
  create temporary table secdef_beleid (
    identiteit text primary key,
    klasse text not null check (klasse in ('rol_fonds', 'eigen_fonds', 'eigen_context', 'productbreed', 'publiek_begrensd', 'trigger')),
    motivering text not null
  ) on commit drop;

  insert into secdef_beleid (identiteit, klasse, motivering) values
    ('aqlab_assurance_meetwaarden(p_codes text[])', 'productbreed', 'Gecureerde synthetische product-QA-metadata; geen fondsdata.'),
    ('aqlab_audit_export_bron(p_export_id uuid)', 'productbreed', 'Alleen vrijgegeven productbreed auditrapport; embargo blijft null.'),
    ('aqlab_log_download(p_export_id uuid, p_herkomst text)', 'productbreed', 'Logt uitsluitend download van productbreed vrijgegeven rapport.'),
    ('contact_aanvraag_insert(p_naam text, p_organisatie text, p_rol text, p_email text, p_telefoon text, p_type_verzoek text, p_bericht text, p_herkomst_pagina text, p_privacy_version text, p_ip_hash text)', 'publiek_begrensd', 'Publieke contactinzending; alleen INSERT met server-side IP-venster, geen leespad.'),
    ('contact_notificatie_status(p_id uuid, p_verzonden boolean, p_error text)', 'publiek_begrensd', 'Alleen recente, nog niet gemarkeerde contactrij; uitsluitend twee operationele velden.'),
    ('fn_afschrift_bevries_kolommen()', 'trigger', 'BEFORE UPDATE-trigger; directe aanroep heeft geen NEW/TG-context.'),
    ('fn_ai_actie_afronden(p_actie_id uuid, p_status text, p_resultaat_ref text)', 'eigen_context', 'Een sessie kan uitsluitend de eigen AI-actie afronden.'),
    ('fn_ai_actietype_spec(p_actietype text)', 'productbreed', 'Read-only vaste actietypespecificatie, zonder fondsobject.'),
    ('fn_ai_poort_check(p_provider text, p_model text)', 'productbreed', 'Read-only actuele AI-configuratie; geen fondsobject of persoonsdata.'),
    ('fn_ai_preflight(p_actietype text, p_provider text, p_model text, p_ocr_paginas integer, p_idempotentie text, p_vingerafdruk text, p_dryrun boolean)', 'eigen_fonds', 'Preflight leidt actor en fonds uitsluitend uit auth.uid() af.'),
    ('fn_app_error_log(p_label text, p_categorie text, p_severity text, p_http_status integer, p_fouttype text, p_foutcode text, p_melding_kort text, p_context_sleutels text[], p_correlatie_id uuid)', 'eigen_fonds', 'Schrijft de foutmelding met fonds uitsluitend uit auth.uid().'),
    ('fn_besluit_heropenen_correctie(p_decision_id uuid, p_reden_type text, p_motivering text)', 'rol_fonds', 'Bestuurlijke correctie op een besluit in het eigen fonds.'),
    ('fn_besluit_status_omslag(p_decision_id uuid, p_target text, p_reden text, p_motivering text, p_open_elders jsonb)', 'rol_fonds', 'Bestuurlijke statusovergang op een besluit in het eigen fonds.'),
    ('fn_procedure_beeindigen(p_procedure_id uuid, p_reden text)', 'rol_fonds', 'Bestuurlijke procedureovergang in het eigen fonds.'),
    ('fn_procedure_heropenen(p_procedure_id uuid, p_reden text, p_reden_type text)', 'rol_fonds', 'Bestuurlijke procedureheropening in het eigen fonds, met verplichte getypeerde reden.'),
    ('fn_rate_limit_check(p_endpoint text, p_limiet integer, p_venster interval)', 'eigen_context', 'Rate-limit is alleen op de huidige actor/sessie gebaseerd.'),
    ('fn_schrijf_handeling(p_handeling text, p_methode text, p_pad text, p_status integer, p_request_id uuid)', 'eigen_fonds', 'Append-only handeling leidt actor en fonds server-side af.'),
    ('fn_schrijf_vergelijking(p_mode text, p_model text, p_prompt_version text, p_comparator_version text, p_findings jsonb)', 'eigen_fonds', 'Vergelijkingsresultaat leidt fonds en actor server-side af.'),
    ('fn_stap_activeerbaar_maken(p_stap_id uuid, p_procedure_id uuid)', 'eigen_fonds', 'Afgeleide cascade-overgang; sessie en procedure worden fail-closed op hetzelfde fonds gebonden.'),
    ('fn_stap_activeren(p_stap_id uuid, p_procedure_id uuid)', 'eigen_fonds', 'Gewone processtapactivering; sessie en procedure worden fail-closed op hetzelfde fonds gebonden.'),
    ('fn_stap_afronden(p_stap_id uuid, p_procedure_id uuid)', 'eigen_fonds', 'Gewone processtapafronding; sessie en procedure worden fail-closed op hetzelfde fonds gebonden.'),
    ('fn_stap_afronden_met_afwijking(p_stap_id uuid, p_procedure_id uuid, p_motivering text, p_bevestigd boolean)', 'rol_fonds', 'Afwijkingsmutatie binnen een procedure in het eigen fonds.'),
    ('fn_stap_heropenen(p_stap_id uuid, p_procedure_id uuid, p_motivering text)', 'rol_fonds', 'Stapmutatie binnen een procedure in het eigen fonds.'),
    ('fn_zelfde_fonds(p_gebruiker uuid)', 'eigen_fonds', 'Vergelijkt een kandidaat uitsluitend met het fonds van auth.uid().'),
    ('lees_governance_audit(p_fonds uuid, p_filters jsonb, p_motivering text, p_limiet integer, p_bronniveau boolean)', 'rol_fonds', 'Auditinzage vereist capability en vergelijking met het sessiefonds.'),
    ('log_word_export(p_gesprek_audit_id uuid, p_stuksoort text, p_promptvariant text, p_bronnen jsonb)', 'rol_fonds', 'Exportlog vereist bestuursbureau en is aan het sessiefonds gebonden.'),
    ('mag_audit(p_fonds uuid)', 'eigen_fonds', 'Autoriseerhelper vergelijkt het gevraagde fonds met auth.uid().'),
    ('mag_audit_bronnen(p_fonds uuid)', 'eigen_fonds', 'Autoriseerhelper vergelijkt het gevraagde fonds met auth.uid().'),
    ('mag_audit_redacties(p_fonds uuid)', 'eigen_fonds', 'Autoriseerhelper vergelijkt het gevraagde fonds met auth.uid().'),
    ('mag_handelingen_lezen(p_fonds uuid)', 'eigen_fonds', 'Autoriseerhelper vergelijkt het gevraagde fonds met auth.uid().'),
    ('reflectie_transitie(p_gesprek_id uuid, p_actie text, p_ingang text, p_bronset_log_id uuid)', 'eigen_fonds', 'Gesprekstransitie is aan de actor en diens fonds gebonden.'),
    ('resolve_tenant_host(p_host text)', 'publiek_begrensd', 'Exacte actieve host-resolutie; geen enumeratie van tenant_domains.'),
    ('schrijf_ai_interactie(p_vraag text, p_antwoord text, p_bronnen jsonb, p_modus text, p_model text, p_retrieval_meta jsonb, p_retrieval_meta_inhoud jsonb, p_gesprek_audit_id uuid, p_inhoud_hmac text, p_hmac_schema_versie smallint, p_hmac_sleutel_versie smallint)', 'eigen_fonds', 'AI-interactie leidt fonds en actor server-side af.'),
    ('verwijder_gesprek(p_gesprek_id uuid, p_request_id uuid)', 'eigen_fonds', 'Verwijderen is begrensd tot het eigen gesprek/fonds.');

  create temporary table secdef_actueel on commit drop as
  select p.oid,
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as identiteit,
         lower(pg_get_functiondef(p.oid)) as body
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and not exists (
       select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass
          and d.objid = p.oid
          and d.deptype = 'e'
     );

  select coalesce(string_agg(a.identiteit, E'\n  - ' order by a.identiteit), '') into fouten
    from secdef_actueel a
   where not exists (select 1 from secdef_beleid b where b.identiteit = a.identiteit);
  if fouten <> '' then
    raise exception E'#212 FAALT: nieuwe SECURITY DEFINER met authenticated EXECUTE zonder expliciet zelfslot/allowlist:\n  - %', fouten;
  end if;

  select coalesce(string_agg(b.identiteit, E'\n  - ' order by b.identiteit), '') into fouten
    from secdef_beleid b
   where not exists (select 1 from secdef_actueel a where a.identiteit = b.identiteit);
  if fouten <> '' then
    raise exception E'#212 FAALT: allowlist verwijst naar geen actuele SECURITY DEFINER met authenticated EXECUTE:\n  - %', fouten;
  end if;

  select coalesce(string_agg(a.identiteit, E'\n  - ' order by a.identiteit), '') into fouten
    from secdef_actueel a
    join secdef_beleid b using (identiteit)
   where b.klasse in ('rol_fonds', 'eigen_fonds')
     and (a.body !~ 'auth\.uid\s*\(\)' or a.body !~ 'fonds_id');
  if fouten <> '' then
    raise exception E'#212 FAALT: fonds-gebonden DEFINER zonder aantoonbaar auth.uid()-afgeleid fonds-slot:\n  - %', fouten;
  end if;

  select coalesce(string_agg(a.identiteit, E'\n  - ' order by a.identiteit), '') into fouten
    from secdef_actueel a
    join secdef_beleid b using (identiteit)
   where b.klasse = 'rol_fonds'
     and (a.body !~ 'auth\.uid\s*\(\)'
       or a.body !~ '(rol|capabilit|voorzitter|bestuurder|mag_audit)');
  if fouten <> '' then
    raise exception E'#212 FAALT: bestuurlijke DEFINER zonder aantoonbare rol/capability-gate:\n  - %', fouten;
  end if;

  select coalesce(string_agg(a.identiteit, E'\n  - ' order by a.identiteit), '') into fouten
    from secdef_actueel a
    join secdef_beleid b using (identiteit)
   where b.klasse = 'eigen_context'
     and a.body !~ 'auth\.uid\s*\(\)';
  if fouten <> '' then
    raise exception E'#212 FAALT: sessie-gebonden DEFINER zonder auth.uid()-slot:\n  - %', fouten;
  end if;

  select coalesce(string_agg(a.identiteit, E'\n  - ' order by a.identiteit), '') into fouten
    from secdef_actueel a
    join secdef_beleid b using (identiteit)
   where b.klasse = 'trigger'
     and not exists (select 1 from pg_trigger t where t.tgfoid = a.oid and not t.tgisinternal);
  if fouten <> '' then
    raise exception E'#212 FAALT: trigger-only allowlistregel zonder gekoppelde trigger:\n  - %', fouten;
  end if;

  -- De drie openbare uitzonderingen zijn geen fonds-RPC's. Hun veiligheid zit
  -- in een bewust klein, controleerbaar contract — nooit in "public is ok".
  select coalesce(string_agg(a.identiteit, E'\n  - ' order by a.identiteit), '') into fouten
    from secdef_actueel a
    join secdef_beleid b using (identiteit)
   where b.klasse = 'publiek_begrensd'
     and (
       (a.identiteit = 'resolve_tenant_host(p_host text)'
        and (a.body !~ 'td\.host = p_host' or a.body !~ 'td\.actief = true'))
       or
       (a.identiteit like 'contact_aanvraag_insert(%'
        and (a.body !~ 'p_ip_hash' or a.body !~ '10 minutes'))
       or
       (a.identiteit = 'contact_notificatie_status(p_id uuid, p_verzonden boolean, p_error text)'
        and (a.body !~ 'aangemaakt_op' or a.body !~ '1 hour' or a.body !~ 'notificatie_verzonden = false'))
     );
  if fouten <> '' then
    raise exception E'#212 FAALT: publieke DEFINER-uitzondering mist haar expliciete begrenzing:\n  - %', fouten;
  end if;

  raise notice '#212 OK: % browser-uitvoerbare SECURITY DEFINER-functies zijn volledig geïnventariseerd; zelfsloten en uitzonderingen zijn expliciet.', (select count(*) from secdef_actueel);
end $$;
