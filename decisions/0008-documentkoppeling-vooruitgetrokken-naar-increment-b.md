# 0008 — Documentkoppeling vooruitgetrokken naar Increment B: primaire kolom + trigger nu, join-tabel later

- **Status:** Geaccepteerd (2026-06-18) — bekrachtigd bij de bouw van Increment B
- **Datum:** 2026-06-18
- **Betrokkenen:** Merlin IJzerman
- **Scope:** Increment B (procesinstantie/dossier); raakt Increment C (documentmodel)

## Context

TO v1.2 §4 plaatst de tabel `document_procesinstanties` (+ trigger) in **Increment C**, samen met het volledige documentstatus-/bronstatus-/metadata-model. De werkopdracht voor **Increment B** trekt echter de *documentkoppeling + constraint* expliciet naar voren: het demo-scenario "twee instanties van hetzelfde procesmodel (2027/2028) met **gescheiden documenten**" (FO v1.2 §5, acceptatiecriterium 1) en "document onder de juiste tijdlijnfase" (acceptatiecriterium 2) zijn zonder een document↔procesinstantie-koppeling niet aantoonbaar. Er is dus een spanning tussen de increment-indeling in TO §4 en de B-acceptatiecriteria. Randvoorwaarden: fondsconsistentie op elke koppeling (`decisions/0007`), RLS per `fonds_id`, en geen vooruitlopen op het bredere metadata-model (dat blijft C).

## Besluit

In Increment B wordt **alleen de primaire koppeling** gebouwd als één kolom `documenten.procesinstantie_id` (`on delete set null`) met fondsconsistentie via een trigger (`fn_document_procesinstantie_fonds_check`). "Maximaal één primaire procesinstantie" volgt inherent uit één kolom (FO §6). De **secundaire** koppeling (`document_procesinstanties`-join-tabel met "secundair ≠ primair"- en duplicaat-bij-wijziging-regels) én het documentcontext-/status-/bronstatus-/metadata-model blijven **Increment C**.

## Overwogen alternatieven

- **Volledige `document_procesinstanties`-join-tabel nu bouwen (TO §4-indeling volgen)** — verworpen voor B: de join-tabel heeft pas betekenis mét het secundaire-koppeling- en metadata-model van C; nu bouwen zou C-scope naar voren halen zonder dat de bijbehorende context-/statusvelden bestaan. Onnodige complexiteit en half-af model.
- **Niets koppelen in B en op C wachten** — verworpen: dan zijn de B-acceptatiecriteria 1 (gescheiden documenten per instantie) en 2 (document onder tijdlijnfase) niet demonstreerbaar; de increment zou niet "done" zijn volgens FO §5.
- **Composite-FK i.p.v. trigger voor fondsconsistentie** — verworpen hier: `documenten.fonds_id` is nullable (generieke bibliotheek), waardoor een composite-FK door MATCH SIMPLE juist níét vuurt bij NULL. Dit is precies de in `decisions/0007` voorziene uitzondering waar een trigger leidend is.

## Gevolgen

- **Datamodel/migraties:** additieve kolom + index + trigger in `2026_06_18_dossier_procesinstantie.sql`; volledig in de ROLLBACK opgenomen. De C-join-tabel komt later additief erbij; de primaire kolom blijft bestaan naast de secundaire koppeling.
- **RLS/tenant-isolatie:** koppeling valt onder de bestaande `documenten`-RLS; de trigger borgt declaratief dat document-fonds = procesinstantie-fonds en sluit generieke docs (`fonds_id NULL`) uit van een fonds-dossier — conform `decisions/0007`.
- **Audit/reproduceerbaarheid:** de koppeling zelf raakt de Decision Object-audit niet.
- **Bewust geaccepteerde schuld:** de increment-grens uit TO §4 wijkt af van de as-built. Deze entry + de HANDOVER-release-entry leggen dat vast zodat het een bewuste keuze is en geen drift. TO §4 mag bij de volgende ontwerp-update worden bijgewerkt zodat het de as-built weergeeft.

## Referenties

- `04 Technische inrichting/Bestuurdersportaal - Doorontwikkeling v2 technisch ontwerp v1.2.md` §3.2, §4.
- `03 Functioneel ontwerp/Bestuurdersportaal - Doorontwikkeling v2 functioneel ontwerp v1.2.md` §5 (acceptatiecriteria), §6 (documentkoppeling-regels).
- `mvp/decisions/0006` (B2, O2), `mvp/decisions/0007` (fondsconsistentie: composite-FK vs. trigger).
- `mvp/supabase/migrations/2026_06_18_dossier_procesinstantie.sql` (kolom + trigger), `_ROLLBACK.sql`.
