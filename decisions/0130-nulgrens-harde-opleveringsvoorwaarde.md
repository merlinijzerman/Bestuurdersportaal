# 0130 — Nulgrens G23 als harde opleveringsvoorwaarde, met de regressiepoort als bewijslast (B-3a)

- **Status:** Geaccepteerd
- **Datum:** 2026-08-05
- **Betrokkenen:** Merlin (opdrachtgever), Claude (analyse & uitvoering)
- **Werkopdracht:** T3, plateau A — `04 Technische inrichting/Bestuurdersportaal - Werkopdracht T3 - Aantoonbaarheid evals assurance en doorwerking v1.0.md`
- **Ontwerp:** `03 Functioneel ontwerp/Bestuurdersportaal - Rol Bestuursbureau ontwerp v0.3.md`, §7.5 (nulgrens) en §12 beslispunt B-3a
- **Bouwt op:** [`0128`](./0128-tenant-rol-bestuursbureau.md) (rol), [`0129`](./0129-t2-bureau-produceren-en-word-export.md) (producerende stand + sha256-diffbewijs)

## Context

De bureau-increments (T1/T2) verruimen één guardrail: het bureau mag concepttekst en
voorstellen produceren. De opdrachtgever stelde als harde randvoorwaarde dat het
assistentgedrag van de **bestaande** rollen (bestuurder, voorzitter, beheerder) daardoor
niet verandert: exact hetzelfde antwoord op exact dezelfde vraag (§7.5). Omdat de
bureau-taken in dezelfde chat-route en generatiekern landen, is "niets gewijzigd" een
regressiedoel, geen structurele garantie. De vraag (B-3a): is de nulgrens een *harde
opleveringsvoorwaarde*, en zo ja, wat is de bewijslast?

## Besluit

De nulgrens (G23) is een **harde opleveringsvoorwaarde**. De bewijslast is de
**nulgrens-regressiepoort** ([`evals/nulgrens-regressiepoort.md`](../evals/nulgrens-regressiepoort.md),
FR-9): rood = de bureau-increments mogen niet live. Aantoonbaarheid, geen belofte.

## Overwogen alternatieven

- **Nulgrens als inspanningsverplichting/documentatiebelofte** — verworpen: een guardrail
  die alleen in proza leeft, faalt stil (§7.2). De kernregel eist een aantoonbare borging.
- **Volledige, uitputtende gedragsmatrix over alle zeven modi** — verworpen als
  opleveringsvoorwaarde: onevenredig zwaar voor plateau A; de smalle poort (B-9, besluit
  [`0132`](./0132-nulgrens-regressiepoort-dekking.md)) dekt het grootste breukvlak
  (prompt-assemblage) plus de bestaande afgetekende instrumenten.

## Gevolgen

- **Oplevering:** een release van de bureau-stand vereist een **groene** regressiepoort
  (beide legs). Dit is opgenomen in de DoD van T3.
- **Aantoonbaarheid/audit:** leg (a) is deterministisch reproduceerbaar via de sha256-pins
  in `core/lib/generatie-kern.sanity.ts` (`npm run sanity`); leg (b) is de her-aftekening
  van de twee bestaande bestuurders-evalsets. Beide zijn herleidbaar naar code/eval.
- **Guardrailregister:** G23 verwijst in `core/lib/guardrailkader.ts` naar dit besluit en
  naar de regressiepoort.
- Geen RLS-, datamodel- of migratie-impact.

## Referenties

- Ontwerp §7.5, §12 (B-3a) · [`evals/nulgrens-regressiepoort.md`](../evals/nulgrens-regressiepoort.md)
- `core/lib/generatie-kern.sanity.ts` (sha256-pins) · `core/lib/guardrailkader.ts` (G23)
- Verwant: [`0132`](./0132-nulgrens-regressiepoort-dekking.md) (dekking + slaagcriterium)
