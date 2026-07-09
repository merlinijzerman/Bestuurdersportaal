# Bestuurdersportaal — werkinstructies voor Claude

> Dit bestand beschrijft **hoe** je in deze codebase werkt. Het actuele overzicht van projectstatus, architectuur en modules leeft in [`HANDOVER.md`](./HANDOVER.md) — lees die eerst. Houd dit bestand kort; het wordt elke sessie geladen.

## Bron van waarheid (bij twijfel wint de code)

Hiërarchie, van leidend naar afgeleid:

1. **Code + `supabase/migrations/`** — de werkelijkheid. Technische waarheid komt hieruit, niet uit een ontwerpdocument.
2. **`HANDOVER.md`** — lopend overzicht van status, architectuur en keuzes.
3. **`*-ONTWERP.md` / `*-AUDIT.md`** — design-laag ("wat en waarom"), kan achterlopen.

`supabase/schema.sql` is **documentatie en mag achterlopen**; de migraties zijn authoritatief. Verifieer aannames altijd tegen de migraties en de `lib/`-bestanden voordat je erop bouwt.

## Productcontext

Demo/MVP-portaal voor bestuurders van Nederlandse pensioenfondsen (demofonds *Stichting Pensioenfonds Horizon*). Kern: dossiergedreven besluitvorming (Decision Object), AI-assistentie met traceerbare bronvermelding, governance-logging en reproduceerbare besluitvorming. Alle stuurinformatiecijfers zijn realistische dummy-data.

Stack (detail in HANDOVER): Next.js 15 App Router + TypeScript strict, Tailwind, Supabase (Postgres + Auth + RLS), Anthropic SDK (`claude-sonnet-4-5`). Geen chart-library — visuals zijn pure SVG/HTML.

## Niet-onderhandelbare guardrails

- **Tenant-isolatie via RLS per `fonds_id`** is verplicht en mag nooit worden omzeild. Gebruik uitsluitend de anon-key + RLS; **nooit de service-role-key in client-code**.
- **Append-only audit.** `governance_events` (sha256-hash per event) en de `*_log`-tabellen worden nooit ge-UPDATE of -DELETE; triggers blokkeren dit. Elke mutatie logt expliciet na de wijziging.
- **Human-in-the-loop.** AI signaleert, vat samen en spiegelt — besluit nooit. Elke AI-interactie blijft herleidbaar naar gebruiker, fonds, bron, prompt, output, validatiestatus en tijdstip.
- **Snapshot-integriteit.** Lopende procedures mogen nooit wijzigen door een latere template- of configwijziging (snapshot-bij-start).
- **Governance-logica hoort niet uitsluitend in de frontend.** Kritieke validatie, autorisatie en gating zijn ook server-side of in de DB geborgd, niet alleen in de UI.
- **UX-principe "maak vereisten en blokkers expliciet":** toon vóór een actie wat nog ontbreekt, niet pas een foutmelding erna.

## Werkmodus

Bepaal bij elke taak eerst de modus; wijzig nooit bestanden zonder expliciet akkoord.

- **Analyse** — onderzoeken, samenvatten, risico's benoemen. Geen wijzigingen.
- **Plan** — implementatieplan met bestanden, RLS-impact, risico's en testaanpak. Geen wijzigingen.
- **Implementatie** — pas ná akkoord bestanden wijzigen.
- **Review** — beoordelen op regressie, RLS, auditability, UX en `tsc`.

Vraagt de gebruiker niet expliciet om implementatie, dan blijf je in analyse- of planmodus.

Opdrachten komen vaak als **werkopdracht** uit een plansessie (zie `WERKOPDRACHT-TEMPLATE.md` en `decisions/0004`): plannen/ontwerpen gebeuren daar, uitvoering hier in Claude Code. Begin ook dan in Plan-modus en wijzig pas na akkoord.

## Werkwijze

- **Analyseer bestaande patronen** voordat je code wijzigt. Volg de conventies die er al zijn.
- **Plan eerst, wijzig daarna.** Geef bij niet-triviale taken eerst een implementatieplan; voer pas uit na akkoord. Geen grote refactors zonder expliciet voorstel.
- **TypeScript-check vóór commit (verplicht):** `./node_modules/.bin/tsc --noEmit --skipLibCheck` moet exit 0 zijn.
- **Schema-wijzigingen:** schrijf een idempotente migratie in `supabase/migrations/<datum>_<naam>.sql`, werk `schema.sql` bij als documentatie, en draai de migratie **eerst in Supabase** — dán pas code-deploy (anders crashen inserts / breken CHECK-constraints). Documenteer migraties.
- **Controleer RLS-impact** bij elke datamodelwijziging.
- **Deploy** verloopt via GitHub Desktop (commit → push `main` → Vercel auto-deploy). **Geen terminal-git commits.**
- **Geef altijd aan welke bestanden je hebt aangepast.**
- De AI-toon-systeemprompt in `app/api/chat/route.ts` is kostbaar, fijn afgesteld werk — wijzig met beleid en alleen op verzoek.

## Governance-check bij wijzigingen

Bij elke wijziging aan procedures, besluiten, documenten, AI-output of gebruikersacties loop je na:

- Welke gebruiker en welk fonds; welke rol/autorisatie is vereist — en is die server-side afgedwongen?
- Wordt de actie append-only gelogd en is ze reproduceerbaar?
- Is zichtbaar welke bron/input is gebruikt, en of AI-output is gevalideerd?
- Is menselijke bevestiging nodig?
- Kan een lopende procedure onbedoeld wijzigen door een template-/configaanpassing?

## Antwoordformat bij implementatie

Na een implementatie rapporteer je kort en in deze volgorde: (1) samenvatting van de wijziging, (2) aangepaste bestanden, (3) RLS/security-impact, (4) audit-logging-impact, (5) datamodel/migratie-impact, (6) test/verificatie, (7) openstaande risico's of vervolgpunten.

## Geen schijnzekerheid

Doe geen harde juridische, actuariële, fiscale of toezichtclaims zonder bron in de codebase of projectdocumentatie. Bij ontbrekende of onzekere informatie: benoem de aanname, geef aan wat geverifieerd moet worden, en bouw geen functionaliteit die de aanname als waarheid afdwingt.

## Tests

Er is op dit moment **geen testframework** in de repo; verificatie loopt via `tsc --noEmit` + handmatige smoke-tests. Bij nieuwe businesslogica: voeg tests toe of motiveer expliciet waarom niet. Reken berekeningen waar mogelijk programmatisch na (zie de sanity-tests bij `lib/stemming.ts` als patroon). Geef prioriteit aan sanity-checks voor risicovolle logica: stemming, readiness/gating, procedurestatussen, audit-eventconstructie, permissie-/rolchecks, stuurinformatie-berekeningen en AI-validatiestatussen.

## Definition of Done

- Functionaliteit werkt volgens de requirements.
- RLS-impact gecontroleerd; tenant-isolatie intact.
- Audit-logging meegenomen waar van toepassing.
- Tests toegevoegd, of gemotiveerd niet toegevoegd.
- UX consistent met bestaande patronen.
- `tsc --noEmit --skipLibCheck` groen.
- Bij een niet-triviale feature: ontwerpdoc (`*-ONTWERP.md`) opgesteld of bijgewerkt en de ontwerp-sync-check groen.
- `HANDOVER.md` release-historie bijgewerkt; bij een besluit een decision-log-entry.
- **Documentatiehaak (bron van waarheid = deze repo-markdown):** bij een **gate/mijlpaal** of een increment met architectuur-, data-, security- of tenant-impact wordt aansluitend de projectdocumentatie geactualiseerd volgens `00 Overzicht en status/release-template.md` (de `00–09`-markdown én de as-built Word-doc als momentopname). Bij een kleine release volstaat `HANDOVER.md`; de wekelijkse drift-check (`Scheduled/doc-drift-check`) signaleert wanneer een gate-actualisatie openstaat. Werk na een Word-doc-actualisatie de marker in `00 Overzicht en status/doc-actualisatie-log.md` bij.

## Waar te kijken

- **Status & architectuur:** `HANDOVER.md` (master-index).
- **Besluitlog (waarom-keuzes):** `decisions/` — zie `decisions/README.md`.
- **Procedures / Decision Object:** `lib/decision.ts`, `lib/decision-view.ts`, `lib/proces-templates.ts`, `app/(dashboard)/procedures/`, `PROCEDURE-MVP1-ONTWERP.md`.
- **Generieke proceduremodule (in ontwerp):** `PROCEDURE-GENERIEK-ONTWERP.md`.
- **RAG / documentpipeline:** `lib/rag.ts`, `lib/document-extractie.ts`, `app/api/documents/upload/route.ts`.
- **AI-chat:** `app/api/chat/route.ts`.
- **Migraties (bron van waarheid voor schema):** `supabase/migrations/`.
- **Security-status:** `SECURITY-ROUTE-A-PLAN.md`, `SECURITY-ROUTE-A-IMPLEMENTATIE.md`, `lib/api-errors.ts`.
- **RLS-controlekader + wijzigingsproces (T3):** `T3-RLS-CONTROLEKADER.md` (policy-matrix, §14-checklist, service-role-inventaris, testkader). Elke nieuwe tenant-policy krijgt een `WITH CHECK`; de structurele test `supabase/checks/2026_07_08_t3_cross_tenant.sql` faalt anders.

## Niet doen zonder expliciet voorstel

- Service-role-key introduceren of RLS verzwakken.
- Bestaande migraties achteraf wijzigen (schrijf een nieuwe, idempotente migratie).
- Grote refactors of het verwijderen van de code-fallback in template-/procedurelogica.
- De AI-toon-systeemprompt herschrijven.
- Hard-delete van Decision Objects met audit-trail (principieel uitgesloten; annulering via status).
- Autorisatie- of gating-checks uitsluitend in de frontend oplossen.
- Nieuwe AI-functionaliteit toevoegen zonder prompt-/output-logging en validatiestatus.
- Een nieuwe visualisatie-/chartbibliotheek introduceren.
