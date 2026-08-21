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
- **Toets de uitkomst in de database, niet de intentie in de migratie.** Een `revoke`, een policy of een comment in een migratiebestand bewijst niets over productie: er is geen migratierunner en migraties worden handmatig geplakt. De review van 31-07-2026 vond drie objecten die in productie stonden maar in geen enkele migratie, en één maatregel die wél in de code stond maar nooit heeft gewerkt. Draai `supabase/checks/2026_07_31_r1_structurele_gates.sql` (gates A t/m H) na elke policy-, grant- of functiewijziging en na elke Supabase-platformwijziging.
- **`revoke … from public` is op Supabase niet genoeg.** De default-ACL kent rechten **expliciet aan `anon` en `authenticated`** toe, niet via `PUBLIC`. Schrijf altijd `revoke all on function … from public, anon` en geef daarna gericht terug aan de rol die de aanroeper werkelijk gebruikt. Nieuwe `SECURITY DEFINER`-functies zijn anders ongeauthenticeerd aanroepbaar en omzeilen RLS volledig (bevinding H-18).
- **`TRUNCATE` valt buiten RLS.** Postgres evalueert daarbij geen enkele policy. Geef dat recht nooit aan `anon` of `authenticated`; het maakt het uitgangspunt "auditdata is niet manipuleerbaar" onhoudbaar.
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
- **Deploy** verloopt via GitHub Desktop (commit → push → Vercel auto-deploy). **Geen terminal-git commits.** Branch protection op `main` staat aan: commit op een feature-branch → PR → merge ná groene gates. Rechtstreeks op `main` pushen is geblokkeerd.
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

- **`npm run sanity` draait álle suites door** en somt aan het eind op wat rood is; hij stopt niet meer bij de eerste. Die wijziging komt uit bevinding T-01: door een `|| exit 1` hadden 45 suites twee weken niet gedraaid zonder dat iemand het zag. Lees de slotregel, niet alleen de exitcode.
- **`core/lib/generatie-kern.sanity.ts` pint de toon-systeemprompt op sha256.** Kantelt een hash, dan is de prompt of de assemblage gewijzigd — verifieer dat dit bewust was en werk pas dán de pin bij. Bereken de nieuwe waarde, neem hem niet over uit de foutmelding.

Verificatie loopt primair via `tsc --noEmit` + de `lib/*.sanity.ts`-checks (pure functies, `npm run sanity`) + handmatige smoke-tests. Voor de cross-tenant-isolatie is er sinds T5 een **licht testframework** (`node:test` + `tsx`, geen extra runtime-dep): benoemde §15-tests in `tests/cross-tenant/*.test.ts`. Bij nieuwe businesslogica: voeg tests toe of motiveer expliciet waarom niet. Reken berekeningen waar mogelijk programmatisch na (zie de sanity-tests bij `lib/stemming.ts` als patroon). Geef prioriteit aan sanity-checks voor risicovolle logica: stemming, readiness/gating, procedurestatussen, audit-eventconstructie, permissie-/rolchecks, stuurinformatie-berekeningen en AI-validatiestatussen.

**Verplicht bij elk tenant-pad (host/fonds/RLS/audit/retrieval/storage):** draai de gebundelde §15 cross-tenant suite — `bash scripts/cross-tenant-ci.sh` (tsc + app-laag T1–T14 + DB-laag T3/T4/T6/T7 onder échte RLS, één rood/groen). Dit is HÉT verificatiecommando en draait in CI op elke push (`.github/workflows/rls-cross-tenant.yml`, ephemere Supabase-DB). Voor de DB-laag lokaal: `supabase start` of een wegwerpbare `TEST_DATABASE_URL`. Zie `T3-RLS-CONTROLEKADER.md` §7–§8.

**De gates zijn blokkerend (branch protection staat aan).** Branch protection op `main` dwingt de gates af als _required status check_ — geverifieerd via de branch-protection-API op 2026-08-20: required zijn `Cross-tenant isolatie (§15 T1-T14)`, `Security baseline (Sprint 1)`, `Code-scheiding (T9 core/platform-grens)` en `Mapindeling supabase/ (migraties vs rollbacks/seeds)`, met `enforce_admins` aan en een PR verplicht. **Dus: álle werk gaat via PR — ook, juist, AI-assisted werk; direct pushen naar `main` is geblokkeerd (ook voor admins).** Twee valkuilen: (1) branch protection selecteert op de **job-naam**, niet de workflow-naam — hernoem een job nooit zonder de branch-protection-regel mee te verzetten, anders wordt de gate stil losgekoppeld (geen foutmelding); (2) richt je de Claude Code GitHub Action in, geef dan géén `github_token: ${{ secrets.GITHUB_TOKEN }}` mee — met dat token start GitHub geen workflows op de agent-commits, dus draaien de gates niet op precies de PR's waar ze het hardst nodig zijn; laat de parameter weg zodat de action als GitHub App authenticeert. **Let op — de gate is zo goed als zijn dekking:** een geschreven controle die niet in `scripts/cross-tenant-ci.sh` is aangesloten, draait niet in de gate. C-01 kon 12 dagen bestaan doordat de detectie (`fondsleden`-suite) niet was aangesloten — niet doordat de gate niet blokkeerde. Sluit nieuwe suites daarom altijd aan (V4/#81).

## Definition of Done

- Functionaliteit werkt volgens de requirements.
- RLS-impact gecontroleerd; tenant-isolatie intact.
- Audit-logging meegenomen waar van toepassing.
- Tests toegevoegd, of gemotiveerd niet toegevoegd.
- UX consistent met bestaande patronen.
- `tsc --noEmit --skipLibCheck` groen.
- Bij een wijziging aan policies, grants, `SECURITY DEFINER`-functies of het datamodel: `supabase/checks/2026_07_31_r1_structurele_gates.sql` gedraaid tegen de doeldatabase en schoon (gates A1, A2, B, C, C2, E, F, G, H en D).
- **Een nieuw databaseobject (tabel, view, matview, functie, bucket) of een gewijzigde grant vereist een regel in `supabase/checks/allowlist-grants.tsv`; de V3-grants-gate (`2026_08_20_v3_grants_volledig.sql`) faalt anders op "onbekend object" of een rechtenverschil.** De allowlist is een dwingende checklist, geen rapportage: elke nieuwe grant is een bewuste keuze. Regenereer de tsv met `scripts/gen/v3-allowlist-generate.sql` en motiveer elke afwijking in `allowlist-grants.toelichting.md`.
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
- **AI-antwoordweergave (parser, opmaak, kopiëren):** `core/lib/antwoord-parser.ts`, `core/lib/antwoord-klembord.ts`, `app/(dashboard)/ai/_components/AntwoordWeergave.tsx`, `AI-WEERGAVE-ONTWERP.md`. Eén renderer voor `/ai` én de agendapuntchat (besluit 0079) — een wijziging landt altijd op beide.
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
