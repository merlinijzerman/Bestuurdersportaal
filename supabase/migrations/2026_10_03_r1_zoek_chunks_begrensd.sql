-- ============================================================================
-- Zoekpad-herontwerp R1 (besluit 0218) — `public.zoek_chunks_begrensd`:
-- RLS-behoudende versnelling van het tekstzoeken (naast `zoek_chunks`).
-- ----------------------------------------------------------------------------
-- WAAROM. `zoek_chunks` is een `LANGUAGE sql`-functie; Postgres plant het
-- lichaam zonder parameterwaarden, schat de chunkscan op 1 rij en kiest een
-- nested loop die `documenten` per chunkrij opnieuw scant (PR0-rapport, H1:
-- 57k buffers per aanroep op 25k chunks; op Productie 0,8–1,0 s warm en
-- uitschieters tot 8,6 s tegen een statement_timeout van 8 s). De oorzaak is
-- de planvorm, niet RLS.
--
-- WAT. Dezelfde 10 parameters (namen/typen/defaults) en dezelfde 23
-- retourkolommen (naam/type/volgorde) als `zoek_chunks` — bestaande regexen
-- en aanroepvormen blijven geldig — maar als plpgsql in twee stappen:
--   1. de toelaatbare document-id's uit `documenten` ONDER RLS, met uitsluitend
--      zuivere `d.`-predicaten (actief, documentscope);
--   2. de chunks via `document_id = any(v_doc_ids)` (idx_chunks_document),
--      gejoind met een GEMATERIALISEERDE CTE van diezelfde documentrijen
--      (id/fonds_id/volgende_review/titel/bron/bibliotheek/opslag_pad/actief),
--      met de tsquery als variabele, `@@` als filter en het VOLLEDIGE
--      filterblok van `zoek_chunks` letterlijk (incl. de `p_fonds_id`-clausule
--      en de generiek/review-regel).
-- Planbewijs (lokaal, PR0-fixture 25.471 chunks, rol authenticated, JWT 0,9 kB;
-- tests/karakterisering/uitvoer/zoekpad-r1/plannen-*.txt): generiek plan
-- (plpgsql-plancache, ≥ 6e aanroep per backend) = CTE Scan (74 documenten) →
-- Index Scan idx_chunks_document per document, 6,0k buffers; custom plan
-- (1e–5e aanroep) = seq scan over de chunks met de id-array als filter (75 %
-- van de tabel is zichtbaar) → CTE Scan, 6,9k buffers. In GEEN van beide een
-- seq scan op `documenten` per chunkrij. De array+join-vorm zonder CTE had in
-- het custom plan bij een rows=1-schatting wél een nested loop met
-- `Seq Scan on documenten` per rakende chunkrij (de R0-planvorm, begrensd
-- tot de @@-treffers); daarom de CTE.
--
-- TWEE BEWUSTE VERSCHILLEN met `zoek_chunks` (0218):
--   • tiebreaker `, c.id` op de sortering (deterministisch binnen gelijke
--     (rang, chunk_index); besluit 0139-lijn);
--   • bovengrens: `p_limit > 1000` wordt EXPLICIET afgewezen (SQLSTATE P0R01),
--     niet stil afgekapt. De ondergrens `greatest(p_limit, 1)` is identiek.
-- Scanbewijs (WP3) blijft app-side (`filterOpScanbewijs`), net als bij
-- `zoek_chunks`.
--
-- BEVEILIGING. SECURITY INVOKER (RLS op documenten/document_chunks blijft de
-- enige tenantgrens; de filters zijn additief), `set search_path = public,
-- pg_temp`, STABLE, geen GUC's/set_config. ACL exact als `zoek_chunks`:
-- `revoke … from public, anon; grant execute … to authenticated,
-- service_role` (H-18). Pariteit met `zoek_chunks` onder 8 actoren:
-- supabase/checks/2026_10_03_r1_zoektekst_pariteit.sql.
--
-- APP. Alleen achter de vlag ZOEK_TEKST_V2 (env, hoofdstop) + fondsvlag
-- `zoek_tekst_v2`; met de vlag uit roept de app deze functie nooit aan.
-- Rollback: supabase/rollbacks/2026_10_03_r1_zoek_chunks_begrensd_ROLLBACK.sql.
-- Idempotent (drop-and-recreate + ACL opnieuw; fail-closed catalogusvergelijking).
-- ============================================================================

begin;

drop function if exists public.zoek_chunks_begrensd(text, int, uuid[], text[], text[], uuid[], text, date, text[], uuid);

create or replace function public.zoek_chunks_begrensd(
  p_query               text,
  p_limit               int    default 20,
  p_document_ids        uuid[] default null,
  p_bronstatus          text[] default null,
  p_documentstatus      text[] default null,
  p_procesinstantie_ids uuid[] default null,
  p_modus               text   default 'alles',
  p_peildatum           date   default current_date,
  p_bronsoort           text[] default null,
  p_fonds_id            uuid   default null
)
returns table (
  id                 uuid,
  document_id        uuid,
  tekst              text,
  pagina             int,
  paragraaf          text,
  chunk_index        int,
  titel              text,
  bron               text,
  bibliotheek        text,
  opslag_pad         text,
  rang               real,
  documentstatus     text,
  bronstatus         text,
  documentdatum      date,
  geldig_vanaf       date,
  geldig_tot         date,
  procesinstantie_id uuid,
  bronorganisatie    text,
  normgewicht        text,
  extern_url         text,
  fonds_id           uuid,
  volgende_review    date,
  wettelijk_regime   text
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tsq     tsquery;
  v_doc_ids uuid[];
begin
  -- Bewust verschil met zoek_chunks: een aanvraag boven de bovengrens wordt
  -- expliciet geweigerd (niet stil afgekapt). NULL gedraagt zich als voorheen
  -- (greatest(null, 1) = 1).
  if p_limit > 1000 then
    raise exception using
      errcode = 'P0R01',
      message = 'zoek_chunks_begrensd: p_limit > 1000',
      hint    = 'De bovengrens van zoek_chunks_begrensd is 1000 rijen; vraag minder rijen of gebruik documentscope.';
  end if;

  -- De tsquery als variabele (Param): één keer geparset, niet per rij.
  v_tsq := websearch_to_tsquery('dutch', p_query);

  -- Stap 1 — toelaatbare document-id's onder RLS. Uitsluitend zuivere
  -- documentpredicaten: actief en de documentscope. Alles wat ook op de
  -- chunkrij staat (status, bronstatus, bibliotheek, fonds, review) blijft
  -- letterlijk in het filterblok van stap 2.
  select coalesce(array_agg(d.id), '{}'::uuid[])
    into v_doc_ids
    from public.documenten d
   where d.actief = true
     and (p_document_ids is null or d.id = any(p_document_ids));

  -- Stap 2 — de chunks, id-begrensd (idx_chunks_document), gejoind met de
  -- gematerialiseerde documentrijen van stap 1 (één scan van documenten; nooit
  -- een seq scan op documenten per chunkrij), met het volledige filterblok van
  -- zoek_chunks (byte-identiek, met q.query → v_tsq en d → de CTE-rij).
  return query
  with docs as materialized (
    select d.id, d.fonds_id, d.volgende_review, d.titel, d.bron, d.bibliotheek, d.opslag_pad, d.actief
      from public.documenten d
     where d.id = any(v_doc_ids)
  )
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
    ts_rank_cd(c.zoek_vector, v_tsq) as rang,
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
  join docs d on d.id = c.document_id
  where c.document_id = any(v_doc_ids)
    and d.actief = true
    -- 0154 §3: gearchiveerd universeel uit (NULL-veilig).
    and c.documentstatus is distinct from 'gearchiveerd'
    and c.zoek_vector @@ v_tsq
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
  order by rang desc, c.chunk_index asc, c.id
  limit greatest(p_limit, 1);
end
$$;

comment on function public.zoek_chunks_begrensd(text, int, uuid[], text[], text[], uuid[], text, date, text[], uuid) is
  'R1 (besluit 0218): RLS-behoudende, id-begrensde variant van zoek_chunks — zelfde 10 parameters, zelfde 23 retourkolommen, zelfde filterblok (additief op RLS, SECURITY INVOKER). plpgsql in twee stappen: toelaatbare document-id''s uit documenten onder RLS (actief + scope), dan chunks via document_id = any(…) gejoind met een gematerialiseerde CTE van die documentrijen, met de tsquery als variabele. Twee bewuste verschillen: tiebreaker ", c.id" en bovengrens p_limit <= 1000 (P0R01 bij overschrijding). Alleen aangeroepen achter de vlag ZOEK_TEKST_V2 + fondsvlag zoek_tekst_v2. Scanbewijs blijft app-side.';

revoke all on function public.zoek_chunks_begrensd(text, int, uuid[], text[], text[], uuid[], text, date, text[], uuid) from public, anon;
grant execute on function public.zoek_chunks_begrensd(text, int, uuid[], text[], text[], uuid[], text, date, text[], uuid) to authenticated, service_role;

-- Fail-closed catalogusvergelijking in dezelfde transactie: contract, taal,
-- beveiligingsvorm, search_path en ACL moeten zijn wat hierboven staat, en
-- het parameter- en retourcontract moet gelijk zijn aan dat van zoek_chunks.
do $$
declare
  v_nieuw record;
  v_oud   record;
begin
  select p.prosecdef, l.lanname, p.proconfig, p.provolatile, p.proretset,
         pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as res,
         (select array_agg(a::text order by a::text) from unnest(p.proacl) a) as acl
    into v_nieuw
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join pg_catalog.pg_language l on l.oid = p.prolang
   where n.nspname = 'public' and p.proname = 'zoek_chunks_begrensd';
  if (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'zoek_chunks_begrensd') <> 1 then
    raise exception 'R1 MIGRATIE FAALT: zoek_chunks_begrensd heeft niet precies één overload.';
  end if;
  select pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as res,
         (select array_agg(a::text order by a::text) from unnest(p.proacl) a) as acl
    into v_oud
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'zoek_chunks';
  if v_oud is null then
    raise exception 'R1 MIGRATIE FAALT: public.zoek_chunks ontbreekt (de T4-migratie 2026_08_12 is vereist).';
  end if;
  if v_nieuw.prosecdef then
    raise exception 'R1 MIGRATIE FAALT: zoek_chunks_begrensd is SECURITY DEFINER.';
  end if;
  if v_nieuw.lanname <> 'plpgsql' or v_nieuw.provolatile <> 's' or not v_nieuw.proretset then
    raise exception 'R1 MIGRATIE FAALT: taal/volatiliteit/setof wijkt af (%/%/%).', v_nieuw.lanname, v_nieuw.provolatile, v_nieuw.proretset;
  end if;
  if v_nieuw.proconfig is distinct from array['search_path=public, pg_temp']::text[] then
    raise exception 'R1 MIGRATIE FAALT: proconfig is % (verwacht alleen search_path=public, pg_temp).', v_nieuw.proconfig;
  end if;
  if v_nieuw.args is distinct from v_oud.args then
    raise exception 'R1 MIGRATIE FAALT: parametercontract wijkt af van zoek_chunks: % ≠ %.', v_nieuw.args, v_oud.args;
  end if;
  if v_nieuw.res is distinct from v_oud.res then
    raise exception 'R1 MIGRATIE FAALT: retourcontract wijkt af van zoek_chunks: % ≠ %.', v_nieuw.res, v_oud.res;
  end if;
  if v_nieuw.acl is distinct from v_oud.acl then
    raise exception 'R1 MIGRATIE FAALT: ACL wijkt af van zoek_chunks: % ≠ %.', v_nieuw.acl, v_oud.acl;
  end if;
  raise notice 'R1: zoek_chunks_begrensd aangemaakt — plpgsql, SECURITY INVOKER, search_path=public,pg_temp, contract en ACL gelijk aan zoek_chunks.';
end $$;

commit;
