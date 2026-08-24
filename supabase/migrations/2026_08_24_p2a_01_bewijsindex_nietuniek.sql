-- P2 / PR-A (#167) — #160-correctie: bewijs-bindingsindex uniek → niet-uniek
-- ---------------------------------------------------------------------------
-- Ontwerp: PROCEDURE-ENGINE-V2-ONTWERP.md v0.12 §6.2 ("Gevolg voor procedure_bewijs
-- — een bestaande afwijking, geen nieuwe"). Besluit 0189.
-- Impact: data. HAND-APPLIED. Rollback:
--   supabase/rollbacks/2026_08_24_p2a_01_bewijsindex_nietuniek_ROLLBACK.sql
--
-- WAAROM. De unieke partiële index idx_procbewijs_req_sleutel (stap_id,
-- requirement_sleutel) uit #160 dwingt één-bewijs-per-vereiste af. Daarmee kan
-- een vereiste met min_aantal > 1 (bv. "afschriften van tien groepen") nooit
-- groen worden — het tweede bewijs wordt geweigerd. Dat is geen bedoeld ontwerp:
-- de kolomvorm (één requirement_sleutel-kolom per bronrij) garandeert al "één
-- artefact vervult hoogstens één vereiste"; de uniciteit voegde alleen "één feit
-- per vereiste" toe, wat min_aantal juist moet toestaan. Vervulling = count(
-- gebonden feiten) ≥ min_aantal (P2/PR-B). Deze migratie zet de index recht,
-- vóór de overige P2-brontabellen erop stapelen (I6, §6.2).

begin;

-- ── Pre-flight: bevestig dat de wijziging geen bestaand gedrag raakt. Er mag
--   vandaag geen vereiste met min_aantal > 1 zijn die al gebonden bewijs draagt
--   (dan zou de unieke index nu al onmogelijk maken wat we straks toestaan, en
--   moet een mens ernaar kijken). Verwacht: nul.
do $$
declare v_aantal int;
begin
  select count(*) into v_aantal
    from public.procedure_bewijs pb
    join public.procedure_stappen ps on ps.id = pb.stap_id
    where pb.requirement_sleutel is not null
      and exists (
        select 1 from public.procedure_requirements r
         where r.template_code = (
                 select template_code from public.procedures p where p.id = ps.procedure_id)
           and r.stap_volgorde = ps.volgorde
           and coalesce(r.min_aantal, 1) > 1
           and split_part(pb.requirement_sleutel, '|', 1) = ps.volgorde::text
      );
  if v_aantal > 0 then
    raise exception
      'P2-preflight: % gebonden bewijsstuk(ken) op een vereiste met min_aantal > 1 — de index-omzetting raakt bestaand gedrag; handmatig beoordelen (0189).', v_aantal;
  end if;
end $$;

-- ── Uniek → niet-uniek. Zelfde kolommen, zelfde partiële conditie; alleen de
--   uniciteit vervalt.
drop index if exists public.idx_procbewijs_req_sleutel;
create index if not exists idx_procbewijs_req_sleutel
  on public.procedure_bewijs(stap_id, requirement_sleutel)
  where requirement_sleutel is not null;

commit;
