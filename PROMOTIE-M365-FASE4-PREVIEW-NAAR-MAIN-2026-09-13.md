# Promotie `preview` → `main` — M365 fase 4

**Uitvoerdatum:** 13 september 2026

**Voorafgaande productiebasis:** `09d473f` (release 11 september 2026, uitgevoerd)

**Geaccepteerde Preview-bron:** `6a0456d`

**Productiecommit:** `3a6d9de2d53139a50475569f95c0aa55135fc108`

**Promotie-PR:** [#384](https://github.com/merlinijzerman/Bestuurdersportaal/pull/384)

**Status:** uitgevoerd; afsluitings-PR naar `preview` niet mergen zonder nieuw akkoord

## Scope en releasegrens

De promotie heeft de via #367–#370 op Preview geïntegreerde fase-4-uitvoering naar Productie
gebracht: volledige opaque versie-/passage-/citationidentiteit, centrale orkestratie van zoeken en
vergelijken, typed evidence-/modelcontextlezingen, een hermetische Microsoftadapterstub en drie
additieve auditprojectiemigraties. Microsoft-, Outlook-, SharePoint- en Graphactivering, een live
Microsoft RetrievalAdapter en Azure AI Search/Copilot bleven buiten scope.

De huidige afsluitings-PR bevat uitsluitend Markdown en de noodzakelijke terugreconciliatie van de
productiehistorie naar `preview`. Zij bevat geen productiecode, migratie of configuratiewijziging.

## Uitgevoerde voorwaarden en databasevolgorde

- [x] Productiebasis `09d473f` en Preview-bron `6a0456d` exact vastgelegd.
- [x] PR #384 na afzonderlijk opdrachtgeverakkoord gemerged naar `main`.
- [x] Verplichte PR- en postmergechecks groen; beide Vercel-projecten `Ready`.
- [x] Dagelijkse productiebackup en backupwatchdog groen; laatste beheerde restore-drill reeds groen
  vastgelegd op run `32345486528` van 20 augustus 2026.
- [x] De drie migraties in de voorgeschreven volgorde toegepast:
  1. `2026_09_11_369_vergelijk_retrieval_audit.sql`;
  2. `2026_09_11_z367_retrieval_identiteit_auditprojectie.sql`;
  3. `2026_09_12_368_evidence_auditprojectie.sql`.
- [x] T5-vergelijking, retrieval-identiteit, evidenceprojectie, R1, V3-grants en SECURITY DEFINER
  self-gate groen.
- [x] Geen tijdelijke productietesttabellen achtergebleven.
- [ ] Volledige cross-tenantrunner op Productie — bewust niet uitgevoerd omdat die runner voor een
  testdatabase is begrensd en destructieve stappen bevat; lokaal en in CI wel groen.

De #367- en #368-migraties zijn bij handmatige productie-uitvoering in expliciete transacties
geplaatst; #369 is zelf-transactioneel. Rollbacks zijn niet op Productie uitgevoerd. De lokale
rehearsal bewees vooraf de omgekeerde rollbackvolgorde #368 → #367 → #369 en de herapply in
voorwaartse volgorde.

## Deploy- en smoke-uitkomst

| Stap | Uitkomst |
|---|---|
| App-deployment | `dpl_8S5UsM6DtpqfKLw5PNjcSe5ywkGR`, `Ready`, commit `3a6d9de` |
| Beheer-deployment | `dpl_7hcuTjv5bV7H4MWh9Pw9BkrTFpF1`, `Ready` |
| Health | app, PGB en beheer antwoordden `{"ok":true}` |
| Bestaande sessie | PGB-tenant en rol correct |
| Zoeken | `ORION-4827` vond twee synthetische documenten |
| Chat/evidence | correct antwoord met `PGB ingest-worker productietest`, pagina 1 |
| Governance | terugvraag en generatie als twee nieuwe inhoudsarme regels; tien generatiebronnen |
| Signalen | 0 app errors, 0 critical/high, 0 gatewaylogschrijffouten, 0 niet-OK gatewaycalls |
| Runtime 5xx | geen 5xx in app of beheer |

Eén fail-safe melding op error-niveau — `Reflectietransitie geweigerd of mislukt:
gesprek_niet_gevonden` — trad op tijdens de eerste chatbeurt, zonder gebruikersfout: de route bleef
HTTP 200 en het antwoord was correct. Dit reeds in `09d473f` aanwezige gedrag volgt afzonderlijk in
[#386](https://github.com/merlinijzerman/Bestuurdersportaal/issues/386).

## Eerlijk niet afzonderlijk uitgevoerd

- verse wachtwoordlogin; de bestaande geldige PGB-sessie is hergebruikt;
- positieve live documentvergelijking;
- negatieve live cross-tenantaccountwissel;
- live Microsoft/Graph-/Outlook-/SharePointretrieval;
- de volledige destructieve cross-tenantrunner op Productie.

Deze omissies zijn geen geslaagde smokes en mogen niet achteraf als bewijs worden aangemerkt.
Microsoft bleef uit en de hermetische stub werd niet product-bedraad.

## Go/no-go, afsluiting en rollback

De productiepromotie is **GO en uitgevoerd met beperkingen**. Bij een appregressie blijft
`09d473f` de voorafgaande codebasis; de additieve auditprojecties worden alleen na afzonderlijke
data-/auditbeoordeling teruggerold. Microsoftvlaggen blijven uit.

De afsluitingsbranch is vanaf `origin/preview` gemaakt en met `origin/main` gereconcilieerd, zodat
Preview de productiehistorie krijgt. De bijbehorende docs-only PR mag niet zonder nieuw akkoord
worden gemerged. Issues #367–#370 blijven tot die documentatieacceptatie open als administratief
vervolg; #386 is een afzonderlijk codevervolg.
