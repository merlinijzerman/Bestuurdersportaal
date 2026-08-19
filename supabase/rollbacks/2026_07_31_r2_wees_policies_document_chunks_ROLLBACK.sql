-- ============================================================
--  ROLLBACK 2026-07-31 — R2: wees-policies op document_chunks
--
--  ⚠️⚠️  DRAAI DIT NIET TENZIJ JE PRECIES WEET WAAROM.  ⚠️⚠️
--
--  Deze rollback herstelt twee policies die samen een KRITIEK,
--  ONGEAUTHENTICEERD schrijfpad naar de RAG-corpus vormen (bevinding K-02):
--
--    chunks schrijven → INSERT, TO public, WITH CHECK = true
--        Iedereen met de publieke anon-key kan willekeurige chunks invoegen
--        onder een willekeurig document_id, ook van een ander fonds. Die tekst
--        wordt door de retrieval van dát fonds opgehaald en als [Bron N]
--        geciteerd — dus als vastgestelde fondsbron.
--
--    chunks lezen → SELECT, TO public, zonder auth.uid()-binding
--        Neutraliseert de M-02-maatregel: de generieke kennisbank wordt weer
--        leesbaar met de publieke anon-key.
--
--  Er is GEEN scenario waarin je deze twee terugwilt om functionele redenen:
--  de overblijvende policies ("chunks select" en "chunks write eigen fonds")
--  dekken lezen, schrijven, wijzigen en verwijderen volledig, en de generieke
--  pipeline draait op de service-role.
--
--  Dit bestand bestaat uitsluitend omdat elke migratie in dit project een
--  spiegel hoort te hebben — niet omdat terugdraaien verdedigbaar is. Blijkt de
--  ingest te breken, zoek dan de oorzaak in "chunks write eigen fonds"
--  (bibliotheek='fonds'-eis) in plaats van hier.
-- ============================================================

begin;

create policy "chunks lezen" on public.document_chunks
  for select using (
    document_id in (
      select id from public.documenten
       where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
          or bibliotheek = 'generiek'
    )
  );

create policy "chunks schrijven" on public.document_chunks
  for insert with check (true);

commit;
