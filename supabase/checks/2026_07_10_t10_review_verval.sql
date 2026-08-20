-- ============================================================================
-- T10 — Negatieve suite: review-verval-gate op retrieval + generieke
--       toestandsmachine-poort (werkopdracht T10 acceptatiecriteria #4).
-- ----------------------------------------------------------------------------
-- Bewijst dat:
--   R1 — een GENERIEK published document met een VERSTREKEN review
--        (volgende_review < current_date) NIET meer als actuele bron verschijnt
--        in zoek_chunks én zoek_chunks_hybride (read-time verval, besluit 0053).
--   R2 — een published document met review in de TOEKOMST wél verschijnt (regressie).
--   R3 — een published document ZONDER reviewdatum (NULL) wél verschijnt
--        (NULL = niet afgedwongen — backward-compat).
--   P1 — de toestandsmachine-trigger een ONGELDIGE overgang (withdrawn→published)
--        WEIGERT en een geldige (published→deprecated) TOESTAAT.
--
-- Self-seeding (1 fonds + 1 user via maak_profiel-trigger) + generieke documenten
-- met chunks. Alles in één transactie met ROLLBACK. Assertions op de SEED-id's.
-- Elke "LEK:"/"FAALT"/"REGRESSIE" → raise exception → psql exit <> 0 → CI faalt.
--
-- Uitvoeren:  psql "$DB" -f dit-bestand
-- ============================================================================

\set ON_ERROR_STOP on

begin;

insert into public.fondsen (id, naam, slug)
values ('11111111-1111-1111-1111-111111111111', 'T10 Testfonds A', 't10-testfonds-a');

insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','t10-a@test.local',
   '{"naam":"Test A","fonds_id":"11111111-1111-1111-1111-111111111111"}', now(), now());

do $$
begin
  if (select fonds_id from public.profielen where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
       is distinct from '11111111-1111-1111-1111-111111111111'::uuid then
    raise exception 'SEED FAALT: profiel A niet aan fonds A gekoppeld (trigger maak_profiel).';
  end if;
end $$;

-- ── Generieke documenten (published) met verschillende reviewdatums + één
--    withdrawn (bronstatus uitgesloten) voor de poort-test. Unieke zoekterm
--    'xqztien' isoleert de treffers van echte data. volgende_review leeft op
--    documenten (d) — de RPC leest die via de bestaande join. ─────────────────
--   DOC_VERLOPEN  = published, volgende_review = gisteren      (R1 → onzichtbaar)
--   DOC_TOEKOMST  = published, volgende_review = +1 jaar       (R2 → zichtbaar)
--   DOC_NULL      = published, volgende_review NULL            (R3 → zichtbaar)
--   DOC_WITHDRAWN = bronstatus uitgesloten                     (poort-test P1)
insert into public.documenten (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, volgende_review, actief)
values
  ('09000000-0000-0000-0000-0000000000a1', null,'generiek','DNB','T10 verlopen review','van_kracht','actief', current_date - 1,   true),
  ('09000000-0000-0000-0000-0000000000a2', null,'generiek','DNB','T10 toekomst review','van_kracht','actief', current_date + 365, true),
  ('09000000-0000-0000-0000-0000000000a3', null,'generiek','DNB','T10 geen review',    'van_kracht','actief', null,               true),
  ('09000000-0000-0000-0000-0000000000a4', null,'generiek','DNB','T10 withdrawn',      'van_kracht','uitgesloten', null,          true);

insert into public.document_chunks
  (document_id, chunk_index, tekst, bibliotheek, documentstatus, bronstatus)
values
  ('09000000-0000-0000-0000-0000000000a1',0,'Dit fragment bevat xqztien voor de T10-test.','generiek','van_kracht','actief'),
  ('09000000-0000-0000-0000-0000000000a2',0,'Dit fragment bevat xqztien voor de T10-test.','generiek','van_kracht','actief'),
  ('09000000-0000-0000-0000-0000000000a3',0,'Dit fragment bevat xqztien voor de T10-test.','generiek','van_kracht','actief'),
  ('09000000-0000-0000-0000-0000000000a4',0,'Dit fragment bevat xqztien voor de T10-test.','generiek','van_kracht','uitgesloten');

-- ── Impersoneer user A (elke ingelogde identiteit mag generiek lezen, B13) ──
set local role authenticated;
set local request.jwt.claim.sub to 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- R1 (NEGATIEF): verlopen review verschijnt NIET — beide RPC's.
do $$
declare n_fts int; n_hyb int;
  nul_vec text := '[' || rtrim(repeat('0,',1024),',') || ']';
begin
  select count(*) into n_fts
    from public.zoek_chunks(p_query => 'xqztien')
   where document_id = '09000000-0000-0000-0000-0000000000a1';
  select count(*) into n_hyb
    from public.zoek_chunks_hybride(p_query => 'xqztien', p_embedding => nul_vec::vector)
   where document_id = '09000000-0000-0000-0000-0000000000a1';
  if n_fts <> 0 then
    raise exception 'LEK R1a: generiek met VERSTREKEN review verschijnt in zoek_chunks (review-verval kapot).';
  end if;
  if n_hyb <> 0 then
    raise exception 'LEK R1b: generiek met VERSTREKEN review verschijnt in zoek_chunks_hybride.';
  end if;
  -- Positieve controle op de HYBRIDE RPC: de niet-verlopen doc (toekomst) MOET wél
  -- verschijnen — anders zou R1b vacuous slagen als de hybride RPC niets teruggeeft.
  declare n_hyb_pos int;
  begin
    select count(*) into n_hyb_pos
      from public.zoek_chunks_hybride(p_query => 'xqztien', p_embedding => nul_vec::vector)
     where document_id = '09000000-0000-0000-0000-0000000000a2';
    if n_hyb_pos = 0 then
      raise exception 'REGRESSIE R1b-pos: toekomstige review verschijnt NIET in zoek_chunks_hybride (gate te streng of RPC leeg → R1b was vacuous).';
    end if;
  end;
  raise notice 'OK R1: verlopen review onzichtbaar in beide RPC''s (hybride positieve controle geslaagd).';
end $$;

-- R2 (REGRESSIE): review in de toekomst blijft zichtbaar.
do $$
declare n int;
begin
  select count(*) into n
    from public.zoek_chunks(p_query => 'xqztien')
   where document_id = '09000000-0000-0000-0000-0000000000a2';
  if n = 0 then
    raise exception 'REGRESSIE R2: published generiek met toekomstige review verdween ten onrechte.';
  end if;
  raise notice 'OK R2: toekomstige review blijft zichtbaar.';
end $$;

-- R3 (REGRESSIE): NULL review = niet afgedwongen → zichtbaar.
do $$
declare n int;
begin
  select count(*) into n
    from public.zoek_chunks(p_query => 'xqztien')
   where document_id = '09000000-0000-0000-0000-0000000000a3';
  if n = 0 then
    raise exception 'REGRESSIE R3: published generiek ZONDER reviewdatum werd ten onrechte geblokkeerd.';
  end if;
  raise notice 'OK R3: NULL-review niet afgedwongen (zichtbaar).';
end $$;

reset role;

-- ── P1: toestandsmachine-poort (trigger). Ongeldige overgang geweigerd, geldige
--    toegestaan. Draait als tabel-eigenaar; de trigger vuurt rolonafhankelijk. ──
do $$
begin
  -- Ongeldig: withdrawn (bronstatus uitgesloten) → published. MOET falen.
  begin
    update public.documenten
       set status='van_kracht', bronstatus='actief'
     where id='09000000-0000-0000-0000-0000000000a4';
    raise exception 'LEK P1a: withdrawn→published werd NIET geweigerd door de toestandsmachine.';
  exception
    when others then
      if sqlerrm like '%LEK P1a%' then raise; end if;
      raise notice 'OK P1a: withdrawn→published geweigerd (%).', sqlerrm;
  end;

  -- Geldig: published → deprecated (van_kracht+actief → historisch+historisch).
  update public.documenten
     set status='historisch', bronstatus='historisch'
   where id='09000000-0000-0000-0000-0000000000a3';
  if (select public.fn_generiek_geldigheidsstatus(status, bronstatus)
        from public.documenten where id='09000000-0000-0000-0000-0000000000a3') <> 'deprecated' then
    raise exception 'FAALT P1b: published→deprecated leverde niet de verwachte canonieke status.';
  end if;
  raise notice 'OK P1b: published→deprecated toegestaan.';
end $$;

rollback;

-- ============================================================================
-- Alles geslaagd bij psql exit 0 + de "OK …"-notices (R1, R2, R3, P1a, P1b).
-- Elke "LEK:"/"FAALT"/"REGRESSIE" doet raise exception → non-zero exit → CI rood.
-- ============================================================================
