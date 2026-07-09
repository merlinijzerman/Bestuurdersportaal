# 0048 — T7: G2 go/no-go-gate geformaliseerd (0026-her-introductie-gate geëffectueerd)

- **Status:** Geaccepteerd
- **Datum:** 2026-07-09
- **Betrokkenen:** Merlin (gate-eigenaar, akkoord), Claude (uitvoering); security/compliance (verplicht adviseur, rol te beleggen)

## Context

Besluit 0040 (bridge-ready pool) en beslisnotitie multi-tenant v0.4 stellen dat **fonds 2 (PGB) pas
mag worden aangesloten nadat P0 aantoonbaar is afgerond** (gate **G2**). Besluit 0026 kende al een
her-introductie-gate vóór productie/fonds 2; v0.4 §16 (R3) vraagt die gate **expliciet te formaliseren**
met eigenaar, toetscriteria en besluitmoment. Increment **T7** uit de T-serie-roadmap levert die
formalisatie. De openstaande reviewvraag uit v0.4 §16/§21 ("wie is eigenaar van deze gate?") wordt hier
beantwoord.

Feitelijke stand bij vaststelling (uit `HANDOVER.md`): de meeste technische P0-bouwstenen zijn opgeleverd
(T1 resolver, T2 R1/R2, T3 RLS-hardening, T4 RAG-discipline, T5 cross-tenant suite), maar het restrisico
zit niet in "gebouwd" maar in "**aantoonbaar actief op productie**": T4-migratie nog te draaien op live,
`TENANT_ENFORCE` nog niet aan op live, de cross-tenant suite draait nog **niet-blokkerend**, T6 (gedeelde
contentlaag) is nog niet opgeleverd, en demo/productie-scheiding (B6) is nog niet bevestigd. De gate is dus
**nog niet dicht**; dit besluit legt vast wanneer en door wie hij dat wél is.

Randvoorwaarden die meewegen: RLS/tenant-isolatie als primair controlekader (0039/0040); audit/
reproduceerbaarheid (elke gate-aftekening moet herleidbaar bewijs hebben); geen schijnzekerheid ("aantoonbaar"
mag niet interpreteerbaar blijven).

## Besluit

De G2 go/no-go-gate wordt geformaliseerd langs drie assen:

1. **Eigenaar.** Merlin is de **accountable gate-eigenaar** die het go/no-go-besluit formeel aftekent. Een
   **security/compliance-advies is verplichte input** vóór aftekening (adviserend, niet vetohoudend; de rol
   wordt belegd vóór het besluitmoment).
2. **Toetscriteria.** De acht P0-criteria uit v0.4 §18 gelden **één-op-één**, elk met een **expliciete
   bewijseis** ("aantoonbaar" = migratie gedraaid op live, enforce aan, negatieve test groen, met
   bewijsreferentie). Aanvullend blokkerend: **T5** (cross-tenant suite) staat als **blokkerende** merge-gate
   aan, **T6** (gedeelde contentlaag) is opgeleverd, en **demo/productie-scheiding (B6)** is apart aangetoond.
3. **Besluitmoment.** Eén formele **go/no-go-review vlak vóór PGB-onboarding**. De uitkomst wordt vastgelegd
   op de herbruikbare go/no-go-checklist (`02 Architectuur/Bestuurdersportaal - T7 G2 go-no-go checklist v0.1.md`),
   afgetekend door de eigenaar, met het security-advies als bijlage/referentie. **Zonder afgetekende checklist
   geen aansluiting van fonds 2.**

## Overwogen alternatieven

- **Eigenaar = aparte security/compliance-rol of stuurgroep-collectief** — sterker vanuit assurance
  respectievelijk draagvlak, maar diffuser/trager eigenaarschap; niet gekozen omdat helder, enkelvoudig
  eigenaarschap met verplicht security-advies de snelheid behoudt zonder de assurance-toets te verliezen.
  Migratiepad blijft open: de rol kan later naar een security-officer verschuiven zonder de gate te herzien.
- **Toetscriteria = §18 zoals het staat (zonder bewijseis)** — sneller, maar laat "aantoonbaar"
  interpreteerbaar; verworpen omdat juist de live-activering (migraties/enforce/blokkerende suite) het
  resterende risico vormt.
- **Vastlegging = alleen checklist of alleen stuurgroep-notitie** — te licht respectievelijk buiten de
  decisions-conventie; gekozen is besluitnotitie (verankering) + checklist (operationeel bewijsstuk).

## Gevolgen

- **Tenant-isolatie:** de gate maakt de isolatieclaim pas "hard" ná bewijs van live-activering; voorkomt dat
  fonds 2 aansluit terwijl enforce/migraties/suite nog niet productief zijn.
- **Audit/reproduceerbaarheid:** elke aftekening vereist een bewijsreferentie (migratie-run, CI-run,
  testresultaat); de afgetekende checklist is zelf een auditartefact.
- **Datamodel/migraties:** geen — dit is een governance-/procesbesluit, geen code- of schemawijziging.
- **Beheer/proces:** er ontstaat een expliciet, enkelvoudig eigenaarschap voor de go/no-go; security/compliance
  moet als adviesrol worden belegd vóór het besluitmoment (actiepunt). **Bewust geaccepteerd:** het
  security-advies is adviserend, niet vetohoudend — de eigenaar draagt de eindverantwoordelijkheid en daarmee
  het restrisico van een go-besluit tegen advies in (te documenteren indien dat zich voordoet).

## Referenties

- Beslisnotitie multi-tenant v0.4 §14 (RLS-hardening), §15 (testmatrix T1–T14), §16 (R1–R3), §18 (P0-criteria)
- Besluiten `0026` (deferral + her-introductie-gate), `0040` (bridge-ready pool + G2), `0044` (R1), `0042`/`0045` (R2/RAG), `0046` (cross-tenant suite/CI)
- `02 Architectuur/Bestuurdersportaal - Implementatieroadmap multi-tenant (T-serie) v0.1.md` (T7)
- `02 Architectuur/Bestuurdersportaal - T7 G2 go-no-go checklist v0.1.md` (operationeel bewijsstuk)
