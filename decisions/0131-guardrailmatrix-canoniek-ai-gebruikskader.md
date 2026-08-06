# 0131 — Guardrailmatrix §7.3 vastgesteld als canoniek AI-gebruikskader, met de kernregel §7.2 en de beheerafspraak §7.8 (B-3b)

- **Status:** Geaccepteerd
- **Datum:** 2026-08-05
- **Betrokkenen:** Merlin (opdrachtgever), Claude (analyse & uitvoering)
- **Werkopdracht:** T3, plateau A — `04 Technische inrichting/Bestuurdersportaal - Werkopdracht T3 - Aantoonbaarheid evals assurance en doorwerking v1.0.md`
- **Ontwerp:** `03 Functioneel ontwerp/Bestuurdersportaal - Rol Bestuursbureau ontwerp v0.3.md`, §7 (matrix §7.3, handhavingsklassen §7.2, beheer §7.8)
- **Bouwt op:** [`0098`](./0098-kopieren-uit-de-chat-zonder-logging.md) (herkomst als constructie i.p.v. instructie — het patroon achter de kernregel), [`0128`](./0128-tenant-rol-bestuursbureau.md), [`0129`](./0129-t2-bureau-produceren-en-word-export.md)

## Context

De verruiming (bureau mag produceren) vraagt om een dicht, aantoonbaar kader eromheen.
De guardrails zaten tot nu toe verspreid over promptregels, code en losse besluiten. B-3b
vroeg: stellen we de matrix §7.3 vast als het **canonieke** AI-gebruikskader, inclusief de
kernregel §7.2 (geen compliance-relevante guardrail uitsluitend in klasse M) en de
beheerafspraak §7.8 (guardrailwijziging vergt een besluit)?

## Besluit

De matrix §7.3 is het **canonieke** AI-gebruikskader (G1..G23). Ze wordt machine-leesbaar
vastgelegd in [`core/lib/guardrailkader.ts`](../core/lib/guardrailkader.ts) — de bron van
waarheid; documentatie verwijst ernaar in plaats van te herhalen. De **kernregel §7.2** is
programmatisch geborgd (`schendtKernregel()` in `core/lib/guardrailkader.sanity.ts`, FR-20)
en zichtbaar in de assurance-view (FR-19). De **beheerafspraak §7.8** geldt: elke
guardrailwijziging vergt een `decisions/`-entry, ook een kleine.

## Overwogen alternatieven

- **Guardrails alleen in het ontwerpdocument** — verworpen: proza kan achterlopen op de
  code en de kernregel is dan niet toetsbaar. "Aantoonbaarheid boven documentatie."
- **Guardrails per guardrail als afzonderlijke decisions/-entry (23 stuks)** — verworpen:
  onwerkbaar en redundant. Het register legt per guardrail de besluit-referentie vast; de
  §7.8-regel borgt dat elke *wijziging* voortaan een eigen entry krijgt. Zo betekent "per
  guardrail" (werkopdracht) het *mechanisme*, geen 23 bestanden.
- **Kernregel §7.2 alleen als reviewrichtlijn** — verworpen: dan faalt hij stil. Een
  sanity-check (FR-20) maakt een schending een rode build.

## Gevolgen

- **Nieuwe artefacten:** `core/lib/guardrailkader.ts` (register, sha256-gepind) +
  `core/lib/guardrailkader.sanity.ts` (FR-20-check) + de guardrailkader-sectie in
  `/governance/assurance` (`core/lib/aqlab/guardrailkader-view.ts`, FR-19).
- **Aanvaarde restrisico's (§7.3):** G18 en G19 leunen (deels) op klasse M zonder volwaardige
  D-tegenhanger; expliciet aanvaard en in het register als restrisico met deze besluit-
  referentie gemarkeerd, afgedekt via de evalset. G22 is fail-open bij DB-storing (R11).
- **Addendum na de T3 ai-governance-review — vier extra restrisico's in het register.** De
  review stelde vast dat `schendtKernregel()` de klasse-*labels* toetst, niet of de geclaimde
  H/D-borging de guardrail volledig afdwingt. Vier compliance-relevante guardrails dragen daarom
  nu een expliciet `restrisico` (klassen ongewijzigd t.o.v. §7.3; een formele herclassificatie
  vergt een eigen besluit, §7.8):
  - **G7** ([Algemene kennis]-markering): de D-borging is DETECTIE/auditsignaal
    (`assistant-source.ts`), niet afdwinging — het márkeren zelf is modelgedrag. Te hardenen of
    te herclassificeren naar D+M.
  - **G9** (persoonsgebonden bestuurlijke info uit de AI-context): H geldt de AI-context
    (geverifieerd), maar individueel stemgedrag lekt BUITEN de AI-context via
    `stemmingen.uitslag.per_stemgerechtigde` + `decision_audit_snapshots` (klasse-D afgeschermd) —
    FR-4 niet aantoonbaar gehaald (OP-T1-7/8). Dit is hetzelfde restrisico dat T1 al benoemde;
    het is nu ook in het canonieke register zichtbaar.
  - **G11** ([Bron N] per bewering): de D dekt de anti-dangling-telling (`citaties.ongeldig`),
    niet de dekking-per-bewering (modelgedrag).
  - **G20** (prompt-injectie): de echte D is de sentinel + `neutraliseerBrontekst`
    (`bron-afbakening.ts`); de *gehoorzaamheid* leunt op `SP_BRON_VERTROUWEN` (M). Volledige
    injectie-evals volgen bij T4.
  Deze vier zijn opgenomen in `openstaande-punten-en-risicos.md` (OP-T3-1) ter validatie/harding.
- **Doorwerking:** guardrailmatrix verankerd in `02 Architectuur/…AI-governance ontwerp` en
  `07 Compliance…/ai-governance.md` (DPIA-onderlegger).
- **Openstaand restrisico (raakt de kernregel):** de individueel-stemgedrag-lek via
  `stemmingen.uitslag`/`decision_audit_snapshots` (OP-T1-7/FR-4) is nu enkel klasse-D
  afgeschermd; structurele fix uitgesteld. Bewust benoemd, niet opgelost in T3.
- Geen RLS-/migratie-impact door dit besluit zelf.

## Referenties

- Ontwerp §7.2/§7.3/§7.8 · `core/lib/guardrailkader.ts` · `core/lib/guardrailkader.sanity.ts`
- `core/lib/aqlab/guardrailkader-view.ts` · `app/(dashboard)/governance/assurance/page.tsx`
- Verwant: [`0130`](./0130-nulgrens-harde-opleveringsvoorwaarde.md), [`0132`](./0132-nulgrens-regressiepoort-dekking.md)
