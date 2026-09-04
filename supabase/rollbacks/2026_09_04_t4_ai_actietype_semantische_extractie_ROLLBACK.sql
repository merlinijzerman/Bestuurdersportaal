-- Rollback #311 T4: herstel de actietypespecificatie zonder semantische_extractie.
-- Eerst de T4-code terugrollen; anders faalt het workerpad terecht gesloten.
begin;

create or replace function public.fn_ai_actietype_spec(p_actietype text)
returns table (bereik text, ai_acties integer, via_gebruiker boolean, via_systeem boolean, lease_seconden integer)
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select s.bereik, s.ai_acties, s.via_gebruiker, s.via_systeem, s.lease_seconden
    from (values
      ('chat',                     'fonds',      1, true,  false,  300),
      ('agendapunt_voorbereiding', 'fonds',      1, true,  false,  300),
      ('besluit_concept',          'fonds',      1, true,  false,  300),
      ('afschrift_concept',        'fonds',      1, true,  false,  300),
      ('vergelijken',              'fonds',      1, true,  false,  600),
      ('notulen_bevestig',         'fonds',      1, true,  false,  300),
      ('embeddings_backfill',      'fonds',      1, true,  false,  600),
      ('reindex_backfill',         'fonds',      1, true,  false,  900),
      ('document_ingest',          'fonds',      1, false, true,   900),
      ('ocr',                      'fonds',      0, true,  true,   600),
      ('generiek_curatie',         'globaal',    1, false, true,   900),
      ('ocr_generiek',             'globaal',    0, false, true,   600),
      ('aqlab_run',                'globaal',    1, false, true,  1800),
      ('aqlab_adhoc',              'globaal',    1, false, true,  1800)
    ) as s(actietype, bereik, ai_acties, via_gebruiker, via_systeem, lease_seconden)
   where s.actietype = p_actietype;
$$;

revoke all on function public.fn_ai_actietype_spec(text)
  from public, anon, authenticated, service_role;
grant execute on function public.fn_ai_actietype_spec(text) to authenticated, service_role;

comment on function public.fn_ai_actietype_spec(text) is
  'Bron van waarheid voor bereik, gewicht en lease per AI-actietype (besluit 0180). '
  'Geen rij = onbekend actietype = fail-closed. Spiegel: core/lib/ai-quota-kern.ts.';

commit;
