-- ============================================================================
-- R1b — integriteitsborging document_chunks.bibliotheek (I1b_nn) onder ÉCHTE
-- RLS en triggers. Hoort bij 2026_10_06_r1b_chunks_bibliotheek_borging.sql.
-- ----------------------------------------------------------------------------
-- Bewijst:
--   B0  structuur: unique (id, bibliotheek) op documenten; document_id en
--       bibliotheek NOT NULL; FK (document_id, bibliotheek) → documenten
--       (id, bibliotheek) NO ACTION/NO ACTION, DEFERRABLE INITIALLY DEFERRED,
--       gevalideerd; geen hulp-CHECK's; bestaande FK document_id (ON DELETE
--       CASCADE) ongewijzigd.
--   B1  foutieve directe chunk-updates worden geweigerd — fondsgebruiker
--       (authenticated onder RLS) én service_role: bibliotheek afwijkend van
--       het document (23503 bij de commit-toets), NULL (23502), document_id
--       NULL (23502 / 42501), verhangen naar een document met een andere
--       bibliotheek (23503 / 42501).
--   B2  legitieme paden werken en houden alle 16 gedenormaliseerde velden gelijk
--       aan fn_chunk_denorm: insert (ook met een foute bibliotheek-waarde: de
--       trigger corrigeert), herindexering, fn_document_chunks_vervangen (fonds
--       en service_role), documentwijzigingen, document verwijderen (cascade en
--       expliciet), en een gecombineerde bibliotheekwissel met ÉÉN fysieke
--       chunk-update per chunk.
--   B3  atomiciteit: een geldige wissel plus een foutieve chunk-update in één
--       transactie wordt in zijn geheel geweigerd; een fout halverwege de wissel
--       laat niets half achter.
--   B4  negatieve controle: zonder de borging slagen dezelfde foutieve updates
--       (de check ziet het verschil).
-- De commit-toets van de uitgestelde FK wordt geëmuleerd met
-- `SET CONSTRAINTS … IMMEDIATE` binnen een subtransactie; elk geval wordt
-- daarna teruggedraaid. Een echte COMMIT-proef staat in het draaiboek.
--
-- Self-seeding in één transactie met ROLLBACK — laat geen data achter.
-- Uitvoeren:  psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ROL: postgres voor opbouw, afbraak, catalogusvragen (B0) en de wissel/
--      documentpaden; authenticated (fonds A, via request.jwt.claims) voor de
--      fondsgebruikerspaden in B1/B2; service_role voor de service-paden in
--      B1/B2.
--      (verplicht en machineleesbaar — zie ROL-1 in
--       tests/cross-tenant/checksuite-rolverklaring.test.ts voor het waarom)
-- ----------------------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

-- ── B0: structuur ───────────────────────────────────────────────────────────
do $$
declare v record;
begin
  select c.convalidated, c.condeferrable, c.condeferred, c.confupdtype, c.confdeltype,
         (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) kol,
         (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord)
            join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) refkol,
         c.confrelid::regclass::text reftab
    into v
    from pg_constraint c
   where c.conrelid = 'public.document_chunks'::regclass and c.conname = 'document_chunks_document_bibliotheek_fkey';
  if v is null then raise exception 'LEK B0: FK document_chunks_document_bibliotheek_fkey ontbreekt.'; end if;
  if not v.convalidated or not v.condeferrable or not v.condeferred or v.confupdtype <> 'a' or v.confdeltype <> 'a'
     or v.kol <> array['document_id', 'bibliotheek'] or v.refkol <> array['id', 'bibliotheek'] or v.reftab <> 'documenten' then
    raise exception 'LEK B0: FK heeft niet de vorm (document_id, bibliotheek) → documenten (id, bibliotheek) NO ACTION DEFERRABLE INITIALLY DEFERRED, gevalideerd.';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.documenten'::regclass
                  and conname = 'documenten_id_bibliotheek_key' and contype = 'u') then
    raise exception 'LEK B0: unique documenten_id_bibliotheek_key ontbreekt.';
  end if;
  if (select count(*) from pg_attribute where attrelid = 'public.document_chunks'::regclass
        and attname in ('document_id', 'bibliotheek') and attnotnull) <> 2 then
    raise exception 'LEK B0: document_id/bibliotheek niet beide NOT NULL.';
  end if;
  if exists (select 1 from pg_constraint where conname in ('document_chunks_document_id_nn', 'document_chunks_bibliotheek_nn')) then
    raise exception 'LEK B0: hulp-CHECK uit de migratie is blijven staan.';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.document_chunks'::regclass
                  and conname = 'document_chunks_document_id_fkey' and confdeltype = 'c') then
    raise exception 'LEK B0: bestaande FK document_chunks_document_id_fkey (ON DELETE CASCADE) gewijzigd of weg.';
  end if;
  raise notice 'OK B0: unique, NOT NULL (2), FK deferred/gevalideerd; bestaande cascade-FK intact.';
end $$;

-- ── Fixture ─────────────────────────────────────────────────────────────────
insert into public.fondsen (id, naam, slug) values
  ('0b1b0000-1111-1111-1111-111111111111', 'R1b borging fonds A', 'r1b-borging-a'),
  ('0b1b0000-2222-2222-2222-222222222222', 'R1b borging fonds B', 'r1b-borging-b');

insert into auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at) values
  ('0b1b0000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'authenticated', 'authenticated', 'r1b-borging-a@test.local',
   '{"naam":"R1b Borging A","fonds_id":"0b1b0000-1111-1111-1111-111111111111"}', now(), now());

insert into public.documenten (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, actief, bestandstype) values
  ('0b1b0000-0000-0000-0000-0000000000a1', '0b1b0000-1111-1111-1111-111111111111', 'fonds', 'Intern', 'R1b A1 beleid', 'vastgesteld', 'actief', true, 'pdf'),
  ('0b1b0000-0000-0000-0000-0000000000a2', '0b1b0000-1111-1111-1111-111111111111', 'fonds', 'Intern', 'R1b A2 notitie', 'vastgesteld', 'actief', true, 'pdf'),
  ('0b1b0000-0000-0000-0000-0000000000b1', '0b1b0000-2222-2222-2222-222222222222', 'fonds', 'Intern', 'R1b B1 beleid', 'vastgesteld', 'actief', true, 'pdf'),
  ('0b1b0000-0000-0000-0000-0000000000e1', null, 'generiek', 'Extern', 'R1b G1 servicedocument', 'van_kracht', 'actief', true, 'pdf'),
  ('0b1b0000-0000-0000-0000-0000000000e2', null, 'generiek', 'Extern', 'R1b G2 servicedocument', 'van_kracht', 'actief', true, 'pdf');

insert into public.document_chunks (document_id, chunk_index, pagina, tekst, indexering_versie)
select d.id, i, 1, 'R1b borging ' || d.titel || ' deel ' || i, 'r1-structuur-contextueel'
  from public.documenten d, generate_series(0, 2) i
 where d.id::text like '0b1b0000-0000-0000-0000-0000000000%' and d.id <> '0b1b0000-0000-0000-0000-0000000000e1';
-- G1: 300 chunks voor de wissel.
insert into public.document_chunks (document_id, chunk_index, pagina, tekst, indexering_versie)
select '0b1b0000-0000-0000-0000-0000000000e1', i, 1 + i / 10, 'R1b borging G1 deel ' || i, 'r1-structuur-contextueel'
  from generate_series(0, 299) i;

-- Afwijkingen van de 16 gedenormaliseerde velden t.o.v. fn_chunk_denorm, en van
-- de bibliotheek t.o.v. het document, voor één document.
create function pg_temp.r1b_afwijkend(p_doc uuid) returns int language sql stable as $$
  select count(*)::int
    from public.document_chunks dc
    join public.documenten d on d.id = dc.document_id
   cross join lateral public.fn_chunk_denorm(dc.document_id) v
   where dc.document_id = p_doc
     and ((dc.procesmodel_id, dc.procesinstantie_id, dc.vergadering_id, dc.agendapunt_id, dc.documenttype,
           dc.documentstatus, dc.documentdatum, dc.periode, dc.bronstatus, dc.geldig_vanaf, dc.geldig_tot,
           dc.bibliotheek, dc.bronorganisatie, dc.normgewicht, dc.extern_url, dc.wettelijk_regime)
          is distinct from
          (v.procesmodel_id, v.procesinstantie_id, v.vergadering_id, v.agendapunt_id, v.documenttype,
           v.documentstatus, v.documentdatum, v.periode, v.bronstatus, v.geldig_vanaf, v.geldig_tot,
           v.bibliotheek, v.bronorganisatie, v.normgewicht, v.extern_url, v.wettelijk_regime)
          or dc.bibliotheek is distinct from d.bibliotheek)
$$;

-- Voert p_sql uit als p_rol (met claims), toetst de uitgestelde FK direct en
-- draait ALTIJD terug (subtransactie + sentinel). Geeft 'ok' of de SQLSTATE.
-- p_na: optionele controle-SQL die vóór het terugdraaien true moet opleveren.
create function pg_temp.r1b_probeer(p_sql text, p_rol text, p_claims text default null, p_na text default null)
returns text language plpgsql as $$
declare v_ok boolean;
begin
  begin
    if p_claims is not null then perform set_config('request.jwt.claims', p_claims, true); end if;
    if p_rol <> 'postgres' then perform set_config('role', p_rol, true); end if;
    execute p_sql;
    set constraints all immediate;
    perform set_config('role', 'none', true);
    if p_na is not null then
      execute p_na into v_ok;
      if v_ok is not true then raise exception using errcode = 'R1BNA', message = 'nacontrole faalt'; end if;
    end if;
    raise exception using errcode = 'R1BOK', message = 'terugdraaien';
  exception when others then
    if sqlstate = 'R1BOK' then return 'ok'; end if;
    return sqlstate;
  end;
end $$;

-- ── B1: foutieve directe chunk-updates ──────────────────────────────────────
do $$
declare
  ca text := '{"sub":"0b1b0000-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
  cs text := '{"role":"service_role"}';
  ch uuid := (select id from public.document_chunks where document_id = '0b1b0000-0000-0000-0000-0000000000a1' order by chunk_index limit 1);
  r text;
begin
  -- fondsgebruiker
  r := pg_temp.r1b_probeer(format('update public.document_chunks set bibliotheek = ''generiek'' where id = %L', ch), 'authenticated', ca);
  if r <> '23503' then raise exception 'LEK B1a: fondsgebruiker zet eigen chunk op generiek (uitkomst %).', r; end if;
  r := pg_temp.r1b_probeer(format('update public.document_chunks set bibliotheek = null where id = %L', ch), 'authenticated', ca);
  if r <> '23502' then raise exception 'LEK B1b: fondsgebruiker zet bibliotheek op NULL (uitkomst %).', r; end if;
  r := pg_temp.r1b_probeer(format('update public.document_chunks set document_id = null where id = %L', ch), 'authenticated', ca);
  if r not in ('23502', '42501') then raise exception 'LEK B1c: fondsgebruiker zet document_id op NULL (uitkomst %).', r; end if;
  r := pg_temp.r1b_probeer(format('update public.document_chunks set document_id = %L where id = %L', '0b1b0000-0000-0000-0000-0000000000e2', ch), 'authenticated', ca);
  if r not in ('23503', '42501') then raise exception 'LEK B1d: fondsgebruiker verhangt chunk naar generiek document (uitkomst %).', r; end if;
  -- service_role
  r := pg_temp.r1b_probeer(format('update public.document_chunks set bibliotheek = ''generiek'' where id = %L', ch), 'service_role', cs);
  if r <> '23503' then raise exception 'LEK B1e: service_role zet chunk op generiek (uitkomst %).', r; end if;
  r := pg_temp.r1b_probeer(format('update public.document_chunks set bibliotheek = null where id = %L', ch), 'service_role', cs);
  if r <> '23502' then raise exception 'LEK B1f: service_role zet bibliotheek op NULL (uitkomst %).', r; end if;
  r := pg_temp.r1b_probeer(format('update public.document_chunks set document_id = null where id = %L', ch), 'service_role', cs);
  if r <> '23502' then raise exception 'LEK B1g: service_role zet document_id op NULL (uitkomst %).', r; end if;
  r := pg_temp.r1b_probeer(format('update public.document_chunks set document_id = %L where id = %L', '0b1b0000-0000-0000-0000-0000000000e2', ch), 'service_role', cs);
  if r <> '23503' then raise exception 'LEK B1h: service_role verhangt fondschunk naar generiek document (uitkomst %).', r; end if;
  r := pg_temp.r1b_probeer(format('update public.document_chunks set bibliotheek = ''fonds'' where document_id = %L', '0b1b0000-0000-0000-0000-0000000000e2'), 'service_role', cs);
  if r <> '23503' then raise exception 'LEK B1i: service_role zet generieke chunks op fonds (uitkomst %).', r; end if;
  raise notice 'OK B1: foutieve chunk-updates geweigerd (fondsgebruiker en service_role: afwijkende bibliotheek 23503, NULL 23502, verhangen 23503/42501).';
end $$;

-- ── B2: legitieme paden, denormpariteit over 16 velden ──────────────────────
do $$
declare
  ca text := '{"sub":"0b1b0000-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
  cs text := '{"role":"service_role"}';
  setje jsonb := (select jsonb_agg(jsonb_build_object('chunk_index', i, 'tekst', 'R1b vervangen ' || i, 'pagina', 1,
                    'paragraaf', null, 'structuur_type', null, 'structuur_label', null, 'context_prefix', null,
                    'prefix_model', null, 'indexering_versie', 'r2-bronblokken')) from generate_series(0, 3) i);
  r text;
  pariteit text := 'select pg_temp.r1b_afwijkend(%L) = 0';
begin
  r := pg_temp.r1b_probeer(format('insert into public.document_chunks (document_id, chunk_index, tekst) values (%L, 900, ''r1b insert'')', '0b1b0000-0000-0000-0000-0000000000a1'),
        'postgres', null, format(pariteit, '0b1b0000-0000-0000-0000-0000000000a1'));
  if r <> 'ok' then raise exception 'LEK B2a: insert zonder bibliotheek faalt of denorm wijkt af (%).', r; end if;
  r := pg_temp.r1b_probeer(format('insert into public.document_chunks (document_id, chunk_index, tekst, bibliotheek) values (%L, 901, ''r1b insert fout'', ''generiek'')', '0b1b0000-0000-0000-0000-0000000000a1'),
        'service_role', cs, format(pariteit, '0b1b0000-0000-0000-0000-0000000000a1'));
  if r <> 'ok' then raise exception 'LEK B2b: insert met foute bibliotheek-waarde niet gecorrigeerd door de trigger (%).', r; end if;
  r := pg_temp.r1b_probeer(format('update public.document_chunks set embedding_model = ''r1b-test'', indexering_versie = ''r1b-test'' where document_id = %L', '0b1b0000-0000-0000-0000-0000000000a1'),
        'authenticated', ca, format(pariteit, '0b1b0000-0000-0000-0000-0000000000a1'));
  if r <> 'ok' then raise exception 'LEK B2c: herindexering als fondsgebruiker faalt (%).', r; end if;
  r := pg_temp.r1b_probeer(format('select public.fn_document_chunks_vervangen(%L, %L::jsonb)', '0b1b0000-0000-0000-0000-0000000000a2', setje),
        'authenticated', ca, format(pariteit, '0b1b0000-0000-0000-0000-0000000000a2'));
  if r <> 'ok' then raise exception 'LEK B2d: fn_document_chunks_vervangen als fondsgebruiker faalt (%).', r; end if;
  r := pg_temp.r1b_probeer(format('select public.fn_document_chunks_vervangen(%L, %L::jsonb)', '0b1b0000-0000-0000-0000-0000000000e2', setje),
        'service_role', cs, format(pariteit, '0b1b0000-0000-0000-0000-0000000000e2'));
  if r <> 'ok' then raise exception 'LEK B2e: fn_document_chunks_vervangen als service_role (generiek) faalt (%).', r; end if;
  r := pg_temp.r1b_probeer(format('update public.documenten set documentdatum = date ''2026-04-04'', titel = titel || '' (r1b)'', bronstatus = ''historisch'' where id = %L', '0b1b0000-0000-0000-0000-0000000000e2'),
        'postgres', null, format(pariteit, '0b1b0000-0000-0000-0000-0000000000e2'));
  if r <> 'ok' then raise exception 'LEK B2f: documentwijziging (datum/titel/bronstatus) faalt (%).', r; end if;
  r := pg_temp.r1b_probeer(format('update public.documenten set documentdatum = date ''2026-03-03'' where id = %L', '0b1b0000-0000-0000-0000-0000000000a1'),
        'authenticated', ca, format(pariteit, '0b1b0000-0000-0000-0000-0000000000a1'));
  if r <> 'ok' then raise exception 'LEK B2g: documentwijziging als fondsgebruiker faalt (%).', r; end if;
  r := pg_temp.r1b_probeer(format('delete from public.documenten where id = %L', '0b1b0000-0000-0000-0000-0000000000a2'),
        'postgres', null, format('select not exists (select 1 from public.document_chunks where document_id = %L)', '0b1b0000-0000-0000-0000-0000000000a2'));
  if r <> 'ok' then raise exception 'LEK B2h: document verwijderen (cascade op chunks) faalt (%).', r; end if;
  r := pg_temp.r1b_probeer(format('delete from public.document_chunks where document_id = %1$L; delete from public.documenten where id = %1$L', '0b1b0000-0000-0000-0000-0000000000a2'),
        'postgres', null, format('select not exists (select 1 from public.documenten where id = %L)', '0b1b0000-0000-0000-0000-0000000000a2'));
  if r <> 'ok' then raise exception 'LEK B2i: chunks en daarna document verwijderen faalt (%).', r; end if;
  raise notice 'OK B2: insert (ook met foute waarde), herindexering, vervanging (fonds/service), documentwijzigingen en verwijderen werken; 0 afwijkingen over 16 velden.';
end $$;

-- B2j: gecombineerde bibliotheekwissel G1 (300 chunks) — één fysieke update per chunk.
do $$
declare
  u0 int; u1 int; r text;
begin
  begin
    u0 := pg_stat_get_xact_tuples_updated('public.document_chunks'::regclass);
    update public.documenten set bibliotheek = 'fonds', fonds_id = '0b1b0000-1111-1111-1111-111111111111',
           documentdatum = date '2026-05-05', bronstatus = 'actief'
     where id = '0b1b0000-0000-0000-0000-0000000000e1';
    set constraints document_chunks_document_bibliotheek_fkey immediate;
    u1 := pg_stat_get_xact_tuples_updated('public.document_chunks'::regclass);
    if pg_temp.r1b_afwijkend('0b1b0000-0000-0000-0000-0000000000e1') <> 0 then raise exception 'LEK B2j: denorm wijkt af na de wissel.'; end if;
    if (select count(*) from public.document_chunks where document_id = '0b1b0000-0000-0000-0000-0000000000e1' and bibliotheek = 'fonds') <> 300 then
      raise exception 'LEK B2j: niet alle 300 chunks gewisseld.';
    end if;
    if u1 - u0 <> 300 then raise exception 'LEK B2j: % fysieke chunk-updates voor 300 chunks (verwacht 1 per chunk).', u1 - u0; end if;
    raise exception using errcode = 'R1BOK', message = 'terugdraaien';
  exception when others then
    if sqlstate <> 'R1BOK' then raise; end if;
  end;
  set constraints document_chunks_document_bibliotheek_fkey deferred;
  raise notice 'OK B2j: gecombineerde bibliotheekwissel van 300 chunks: consistent, 1 fysieke update per chunk.';
end $$;

-- ── B3: atomiciteit ─────────────────────────────────────────────────────────
do $$
declare ch uuid := (select id from public.document_chunks where document_id = '0b1b0000-0000-0000-0000-0000000000a1' order by chunk_index limit 1);
begin
  -- B3a geldige wissel + foutieve chunk-update in één transactie ⇒ geheel geweigerd.
  begin
    update public.documenten set bibliotheek = 'fonds', fonds_id = '0b1b0000-1111-1111-1111-111111111111' where id = '0b1b0000-0000-0000-0000-0000000000e1';
    update public.document_chunks set bibliotheek = 'generiek' where id = ch;
    set constraints document_chunks_document_bibliotheek_fkey immediate;
    raise exception 'LEK B3a: gecombineerde transactie met foutieve chunk-update geaccepteerd.';
  exception when foreign_key_violation then null;
  end;
  set constraints document_chunks_document_bibliotheek_fkey deferred;
  if (select bibliotheek from public.documenten where id = '0b1b0000-0000-0000-0000-0000000000e1') <> 'generiek'
     or exists (select 1 from public.document_chunks where document_id = '0b1b0000-0000-0000-0000-0000000000e1' and bibliotheek <> 'generiek')
     or (select bibliotheek from public.document_chunks where id = ch) <> 'fonds' then
    raise exception 'LEK B3a: na weigering is een deel van de transactie blijven staan.';
  end if;
  raise notice 'OK B3a: geldige wissel + foutieve chunk-update ⇒ geheel geweigerd, niets doorgevoerd.';
end $$;

-- B3b fout halverwege de wissel (trigger gooit bij chunk-update nr. 150).
create function public.r1b_check_storing() returns trigger language plpgsql as $$
declare v int := coalesce(nullif(current_setting('r1b.check_teller', true), ''), '0')::int + 1;
begin
  perform set_config('r1b.check_teller', v::text, true);
  if v >= 150 then raise exception using errcode = 'P0R09', message = 'R1B-CHECK: geforceerde fout halverwege'; end if;
  return new;
end $$;
create trigger r1b_check_storing before update on public.document_chunks for each row execute function public.r1b_check_storing();
do $$
begin
  perform set_config('r1b.check_teller', '0', true);
  begin
    update public.documenten set bibliotheek = 'fonds', fonds_id = '0b1b0000-1111-1111-1111-111111111111' where id = '0b1b0000-0000-0000-0000-0000000000e1';
    raise exception 'LEK B3b: de geforceerde fout trad niet op.';
  exception when sqlstate 'P0R09' then null;
  end;
  if (select bibliotheek from public.documenten where id = '0b1b0000-0000-0000-0000-0000000000e1') <> 'generiek'
     or exists (select 1 from public.document_chunks where document_id = '0b1b0000-0000-0000-0000-0000000000e1' and bibliotheek <> 'generiek') then
    raise exception 'LEK B3b: wissel half doorgevoerd na een fout halverwege.';
  end if;
  raise notice 'OK B3b: fout halverwege de wissel ⇒ niets half doorgevoerd.';
end $$;
drop trigger r1b_check_storing on public.document_chunks;
drop function public.r1b_check_storing();

-- ── B4: negatieve controle (zonder borging slagen de foutieve updates) ──────
do $$
declare
  cs text := '{"role":"service_role"}';
  ch uuid := (select id from public.document_chunks where document_id = '0b1b0000-0000-0000-0000-0000000000a1' order by chunk_index limit 1);
  r1 text; r2 text;
begin
  -- Openstaande uitgestelde FK-controles (van de fixture-inserts) eerst
  -- afhandelen: ALTER TABLE weigert bij pending trigger events.
  set constraints document_chunks_document_bibliotheek_fkey immediate;
  begin
    alter table public.document_chunks drop constraint document_chunks_document_bibliotheek_fkey;
    alter table public.document_chunks alter column document_id drop not null;
    alter table public.document_chunks alter column bibliotheek drop not null;
    r1 := pg_temp.r1b_probeer(format('update public.document_chunks set bibliotheek = ''generiek'' where id = %L', ch), 'service_role', cs);
    r2 := pg_temp.r1b_probeer(format('update public.document_chunks set document_id = null where id = %L', ch), 'service_role', cs);
    raise exception using errcode = 'R1BOK', message = 'borging terug';
  exception when others then
    if sqlstate <> 'R1BOK' then raise; end if;
  end;
  if r1 <> 'ok' or r2 <> 'ok' then
    raise exception 'B4: negatieve controle zonder borging gaf % / % — verwacht ok/ok (anders bewijst B1 niets over de borging).', r1, r2;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'document_chunks_document_bibliotheek_fkey') then
    raise exception 'B4: borging na de negatieve controle niet hersteld.';
  end if;
  raise notice 'OK B4: zonder borging slagen de foutieve updates (gat zichtbaar); borging daarna intact.';
end $$;

rollback;
