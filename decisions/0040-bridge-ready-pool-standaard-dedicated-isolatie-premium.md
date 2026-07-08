# 0040 — Bridge-ready pool als standaard tenant-model; dedicated isolatie als premiumvariant

- **Status:** Geaccepteerd (richting) — uitvoering via de T-serie (zie roadmap)
- **Datum:** 2026-07-08
- **Betrokkenen:** Merlin (akkoord), Claude (uitwerking)

## Context

Voor de aansluiting van de eerste externe pilotpartij (PGB) speelt de vraag hoe het
bestuurdersportaal meerdere fondsen bedient: eigen fonds-URL, frontend-onderscheid
per fonds, code-scheiding zodat een fonds bij code review geen andermans code ziet,
en fonds-specifieke modules (stuurinformatie, klantbeeld) — zonder aparte "straten"
(silo) per fonds.

As-built is het portaal multi-tenant in model maar single-tenant in gebruik: `fondsen`
is de tenant-root, isolatie loopt volledig via RLS (`fonds_id = (select fonds_id from
profielen where id = auth.uid())`), en de host bepaalt vandaag niets over het fonds
(`bepaalSurface` splitst alleen marketing/app/platform). Bekende zwaktes: `maak_profiel()`
koppelt aan "het eerste fonds" (`limit 1`), de chat logt client-aangeleverd `fonds_id`,
en besluit 0026 kent een her-introductie-gate vóór productie/fonds 2.

Randvoorwaarden die meewegen: huispatroon **RLS = fonds-isolatie, code = rolgate**
(0039, `capabilities.ts`), migratie-eerst-dan-deploy, geen verzwakking van tenant-isolatie,
en de 0026-gate. De keuze moet besluitbaar, commercieel uitlegbaar en architectonisch
eerlijk zijn: geen gedeelde database die als "eigen omgeving" wordt verkocht.

Onderbouwing en afwegingen staan volledig in de beslisnotitie *Multi-tenant frontend,
host→fonds-binding en modulescheiding v0.4* (`02 Architectuur/`).

## Besluit

Het portaal wordt standaard geleverd als **bridge-ready pool** — een gedeeld platform
met logisch gescheiden fondscontexten — met **dedicated isolatie als betaalde
premiumvariant**. Zes besluitpunten:

1. **B1 — Bridge-ready pool als standaardmodel.** Gedeelde codebase, runtime en
   database met logische, server-side afgedwongen en aantoonbaar geteste isolatie via
   vier pijlers: (a) RLS op elke tenant-tabel, deny-by-default; (b) een verplichte
   server-side tenant-resolver; (c) dataclassificatie (`generic`/`fund_specific`/`demo`/
   `internal`/`restricted`); (d) gescheiden RAG-/retrievalcontexten per fonds. RLS is het
   primaire, permanente controlekader; hardening geldt ook bij wijziging (regressietests).
   Het model claimt géén fysieke datascheiding.
2. **B2 — Dedicated isolatie als premiumvariant.** Fondsen die fysieke scheiding eisen
   nemen dat af als betaalde variant: niveau 2 (dedicated data-plane — eigen database +
   storage) en/of niveau 3 (dedicated runtime-build — eigen deploy/build/secrets/
   releasekalender/pentestscope). Een eigen schema binnen dezelfde database is een
   zwakkere tussenvariant, niet gelijkwaardig aan een eigen database. Prijs/SLA buiten
   dit besluit; de architectuur maakt de varianten additief mogelijk.
3. **B3 — Gedeelde contentlaag.** Generieke, fonds-overstijgende content wordt centraal
   beheerd (`generic`, `fonds_id IS NULL`, read-only voor fondsen) met geldigheidsstatus
   (`draft`/`published`/`deprecated`/`withdrawn`), versie, eigenaar, review en
   bronverwijzing; verplichte periodieke review. RAG gebruikt standaard alleen
   `published`. Fondsen bouwen hun eigen overlay onder `fonds_id`/RLS.
4. **B4 — Host→fonds-resolutie.** Eigen hostnaam per fonds, server-side gebonden via een
   verplichte tenant-resolver. Onbekende host fail-closed; geen "eerste fonds"-fallback;
   request-body `fonds_id` nooit vertrouwd; toegang alleen bij overeenkomst host-fonds ↔
   geautoriseerd fonds; afdwinging op álle server-side entrypoints (incl. RAG).
5. **B5 — Configuratie, modules en code-scheiding.** Differentiatie standaard via
   configuratie (theming, module-manifest, feature flags, fondsinstellingen).
   Fonds-specifieke modules (stuurinformatie, klantbeeld) en code logisch gescheiden in
   `core`/`fondsen` met CI-boundaries. Deze code-scheiding is een onderhouds-/review-/
   IP-maatregel, **geen runtime-isolatie**; harde runtime-/buildisolatie hoort bij niveau 3.
6. **B6 — Demo-/omgevingsscheiding.** Sales-/demo-omgeving gescheiden van pilot/productie;
   demodata geclassificeerd als `demo`, niet gemengd met fondsdata in database, storage of
   RAG-index.

Onboarding van fonds 2 is pas toegestaan nadat **P0 aantoonbaar is afgerond**
(tenant-resolver, R1 deterministische fonds-toewijzing, R2 server-side auditfonds,
RLS-hardening, RAG-tenantdiscipline, dataclassificatie, demo/productie-scheiding,
geformaliseerde 0026-gate).

## Overwogen alternatieven

- **Pool als tijdelijk pilotcompromis met migratiepad naar bridge/silo** (v0.3-framing) —
  verworpen als positionering: suggereert dat het standaardmodel "onaf" is. De pool wordt
  bewust het permanente standaardmodel; fysieke isolatie is een keuze, geen eindstation.
- **Silo/"aparte straten" per fonds als standaard** — verworpen: levert de sterkste
  scheiding maar precies de operationele last (aparte stack/deploy/DB per fonds) die nu
  vermeden wordt; niet nodig voor de meeste fondsen. Wel beschikbaar als niveau 3 (betaald).
- **Alleen een eigen URL zonder server-side host→fonds-binding** — verworpen: cosmetisch en
  in een due-diligence-pilot een afbreukrisico; de fondscontext moet server-side, niet uit
  de host of de UI.
- **Code-scheiding presenteren als runtime-isolatie** — verworpen als onjuiste claim: in één
  deploy draait alle fonds-code in dezelfde runtime; `core`/`fondsen` is organisatie/review,
  geen isolatie.
- **Eigen schema gelijkstellen aan eigen database** — verworpen: gedeelde database-instance,
  gedeelde back-up/restore en blast radius blijven; expliciet als zwakkere tussenvariant
  gepositioneerd.

## Gevolgen

- **RLS/tenant-isolatie:** isolatieprincipe ongewijzigd maar geformaliseerd tot een
  controlekader met deny-by-default, gedocumenteerde globale tabellen, service-role met
  eigenaar/doel/scope/logging, en verplichte cross-tenant regressietests bij elke wijziging
  aan tabellen/policies/RPC's/storage/exports/RAG-indexen/service-role-paden.
- **Autorisatie/resolutie:** nieuwe verplichte server-side tenant-resolver (host→fonds via
  `tenant_domains`) als beveiligingslaag naast RLS; afdwinging op alle entrypoints.
- **Datamodel/migraties:** dataclassificatie invoeren; `tenant_domains`-mapping; R1
  (deterministische fonds-toewijzing i.p.v. `limit 1`) en R2 (server-side auditfonds)
  oplossen vóór fonds 2. Membership: `profielen.fonds_id` blijft tijdelijk toegestaan voor
  strikt één-fonds-gebruikers; `fonds_memberships` wordt verplicht zodra iemand legitiem
  meerdere fondscontexten nodig heeft.
- **RAG:** namespace/`fonds_id` per fonds, server-side filter, `published`-only voor
  generiek, bronlabels en minimale bronversie-audit; cross-tenant RAG-tests.
- **Content/beheer:** gedeelde contentlaag met geldigheidsstatus en verplichte review.
- **Build/repo:** herstructurering naar `core`/`fondsen/*` met lint-boundaries in CI
  (logische scheiding, geen runtime-isolatie).
- **Commercie/contractering:** variantenladder (niveau 1/2/3) wordt vooraf en schriftelijk
  gecommuniceerd zodat "eigen omgeving" niet verkeerd wordt geïnterpreteerd; prijs/SLA van
  niveau 2/3 apart te besluiten.
- **Bewust geaccepteerde schuld / risico:** het standaardmodel heeft een ander risicoprofiel
  dan fysieke isolatie (blast radius over één gedeelde database/runtime/RAG/restore). Dit is
  bewust geaccepteerd voor niveau 1 en afkoopbaar via niveau 2/3.
- **Klantbeeld:** vastgesteld (2026-07-08) dat klantbeeld **géén deelnemergegevens**
  verwerkt; de DPIA-trigger vervalt daarmee. Blijven gelden: rol-/capabilitycontrole,
  fonds-RLS en de standaard dataclassificatie. Zodra klantbeeld alsnog persoons- of
  dossierinformatie zou gaan bevatten, geldt opnieuw een aparte go/no-go (veldautorisatie,
  inzagelogging, export, masking, DPIA) vóór bouw.
- **SSO per fonds:** bewust naar achteren geschoven (2026-07-08). Geen harde
  architectuurvoorwaarde in dit besluit; de tenant-resolver en R1 worden zó ontworpen dat
  SSO later additief inplugt zonder herbouw. Auth-provider en licentieniveau blijven een
  nog te valideren ontwerpbeslissing op het moment dat SSO wordt opgepakt.

## Referenties

- `02 Architectuur/Bestuurdersportaal - Beslisnotitie multi-tenant frontend en modulescheiding v0.4.md` (volledige onderbouwing, B1–B6, P0/P1/P2, testmatrix, risico's)
- `02 Architectuur/Bestuurdersportaal - Implementatieroadmap multi-tenant (T-serie) v0.1.md` (uitvoering)
- `02 Architectuur/multi-tenant-inrichting.md`, `applicatiecomponenten.md`
- `mvp/lib/platform-host.ts`, `mvp/lib/capabilities.ts`
- Besluiten `0006` (B13/B14), `0021` (platformfundament, hosting-variant B), `0026` (deferral + gate), `0029`/`0030` (host-indeling), `0039` (RLS = isolatie, code = rol)
