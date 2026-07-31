-- ============================================================
--  Migratie 2026-07-31 — R2: wees-policies op document_chunks opruimen
--
--  BEVINDING K-02 (gevonden 31-07-2026, direct na de R1-migratie, door de
--  nieuwe structurele gate A2 uit supabase/checks/2026_07_31_r1_structurele_gates.sql)
--
--  In de PRODUCTIEDATABASE stonden twee policies op public.document_chunks die
--  in GEEN ENKELE migratie en ook niet in schema.sql voorkomen:
--
--    chunks schrijven | INSERT | TO public | qual = null | with_check = TRUE
--    chunks lezen     | SELECT | TO public | qual = fonds/generiek, GEEN auth.uid()
--
--  Ze zijn ouder dan 2026_06_20e_bronsoort_generiek_isolatie_denorm.sql, die
--  alleen de policy "fonds chunks" opruimde en de bestaande "chunks lezen"/
--  "chunks schrijven" ongemoeid liet. Daardoor hebben ze drie hardeningsrondes
--  (T3, D1, R1) overleefd.
--
--  WAAROM DIT KRITIEK IS
--  Permissive policies worden ge-OR'd. Voor INSERT betekende `with_check = true`
--  dat de parent-gebonden policy "chunks write eigen fonds" volledig irrelevant
--  was. Combineer dat met de Supabase-standaardgrant (anon heeft INSERT op alle
--  tabellen in `public`; alleen op rate_limit_events is die ingetrokken) en het
--  gevolg is:
--
--    Iedereen met de PUBLIEKE anon-key — zonder in te loggen — kon willekeurige
--    rijen in document_chunks schrijven, onder een willekeurig document_id, ook
--    dat van een ander fonds. Die chunk wordt door de retrieval van dát fonds
--    opgehaald en als [Bron N] geciteerd, dus als vastgestelde fondsbron.
--
--  Dat is geen inzage maar beïnvloeding van bestuurlijke advisering, en het is
--  ongeauthenticeerd uitvoerbaar. Zwaarder dan K-01 (cross-tenant dissent).
--
--  Daarnaast neutraliseerde "chunks lezen" de M-02-maatregel uit de R1-migratie:
--  die voegde `auth.uid() is not null` toe aan "chunks select", maar de OR met
--  "chunks lezen" hield de generieke kennisbank anon-leesbaar.
--
--  WAAROM DIT VEILIG IS OM TE DROPPEN
--  - lezen  → "chunks select" (R1) dekt eigen fonds + generiek, mét auth-eis;
--  - schrijven/wijzigen/verwijderen → "chunks write eigen fonds" is FOR ALL en
--    parent-gebonden (documenten.fonds_id = eigen fonds AND bibliotheek='fonds');
--  - de generieke curatiepipeline draait op de service-role en omzeilt RLS.
--
--  Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
--  Idempotent. Rollback: 2026_07_31_r2_wees_policies_document_chunks_ROLLBACK.sql
--  (die herstelt bewust een kritiek lek — zie de waarschuwing daar).
-- ============================================================

begin;

drop policy if exists "chunks schrijven" on public.document_chunks;
drop policy if exists "chunks lezen"     on public.document_chunks;

-- Fail-closed verificatie binnen dezelfde transactie: blijft er iets onverwachts
-- staan, dan rollt deze migratie terug in plaats van een half resultaat achter
-- te laten.
do $$
declare
  n int;
  ongebonden text := '';
  r record;
begin
  select count(*) into n
    from pg_policies
   where schemaname = 'public' and tablename = 'document_chunks';
  if n <> 2 then
    raise exception 'R2 FAALT: % policies op document_chunks (verwacht 2: "chunks select" + "chunks write eigen fonds").', n;
  end if;

  for r in
    select policyname, cmd, coalesce(qual,'') as q, coalesce(with_check,'') as wc
      from pg_policies
     where schemaname = 'public' and tablename = 'document_chunks'
  loop
    if position('documenten' in r.q) = 0 and position('documenten' in r.wc) = 0 then
      ongebonden := ongebonden || format('  - %s (%s)%s', r.policyname, r.cmd, chr(10));
    end if;
  end loop;

  if ongebonden <> '' then
    raise exception E'R2 FAALT: policy(s) op document_chunks zonder verwijzing naar documenten:\n%', ongebonden;
  end if;

  raise notice 'R2 OK: document_chunks draagt nog twee policies, beide parent-gebonden.';
end $$;

commit;

-- ============================================================
--  Integriteitscontrole ná de migratie (handmatig; leesbaar, wijzigt niets)
-- ============================================================
-- Is er via de kapotte policy al geschreven? Met één fonds in productie is de
-- verwachting nul, maar leg de uitkomst vast in het reviewdossier.
--
-- 1. Chunks zonder parent-document (alleen mogelijk zonder parent-binding):
--      select count(*) from public.document_chunks where document_id is null;
--
-- 2. Chunks waarvan de gedenormaliseerde bibliotheek afwijkt van het document
--    (de trigger fn_chunk_denorm zet die bij een normale ingest gelijk):
--      select c.id, c.document_id, c.bibliotheek, d.bibliotheek, c.aangemaakt
--        from public.document_chunks c
--        join public.documenten d on d.id = c.document_id
--       where c.bibliotheek is distinct from d.bibliotheek
--       order by c.aangemaakt desc;
--
-- 3. Chunks op documenten die als niet-geïndexeerd staan (de ingest zet
--    geindexeerd=true zodra chunks zijn geschreven; een mismatch duidt op een
--    schrijver buiten de keten):
--      select d.id, d.titel, d.fonds_id, count(c.id)
--        from public.documenten d join public.document_chunks c on c.document_id = d.id
--       where d.geindexeerd = false group by 1,2,3 order by 4 desc;
--
-- ============================================================
--  Vervolgacties (niet in deze migratie — bewuste keuze)
-- ============================================================
-- a) GRANT-hygiëne (reviewbevinding O-03). De diepere oorzaak is dat `anon`
--    standaard INSERT/UPDATE/DELETE heeft op élke tabel in `public`, waardoor
--    één te ruime policy meteen een schrijfpad wordt. Overweeg:
--      revoke insert, update, delete on all tables in schema public from anon;
--    en daarna gericht teruggeven waar nodig. Dat raakt het hele schema en
--    hoort daarom in een eigen, apart geteste migratie.
--
-- b) Volledige policy-inventarisatie tegen de repo (reviewbevinding H-17). Deze
--    twee wees-policies bewijzen dat productie objecten bevat die niet uit de
--    migraties komen. Dump `pg_policies`, `pg_proc(prosecdef)`, `pg_trigger` en
--    `information_schema.role_table_grants` en pin die als baseline in de repo,
--    zodat CI drift detecteert in plaats van een reviewer.
