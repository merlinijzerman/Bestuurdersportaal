# Werkticket — Preview-AI begrenzing, quota en kill switch

> Plak dit document als eerste bericht in een nieuwe Claude Code-sessie in de
> repo-root `mvp/`. Lees eerst `CLAUDE.md`, `HANDOVER.md` en
> `security/VERVOLGSTAPPEN-SPRINT-1-2026-08-15.md`. Begin in **Plan-modus** en
> wijzig pas bestanden nadat Merlin het implementatieplan expliciet heeft
> goedgekeurd.

| | |
|---|---|
| **Versie** | v1.0 — 2026-08-15 |
| **Type** | Security-/data-/tenantwerkopdracht voor Claude Code |
| **Prioriteit** | Hoog — voorwaarde voor externe Previewgebruikers |
| **Doelomgeving eerste uitrol** | Uitsluitend Preview (`swviwoytzvaqypieqgji`) |
| **Beheersurface** | `https://beheer.preview.bestuurdersportaal.com` |
| **Besluitbron** | `security/VERVOLGSTAPPEN-SPRINT-1-2026-08-15.md` §2 |

## 1. Opdracht

Bouw een centrale, server-side afgedwongen beheersing voor alle kostendragende
AI-functionaliteit in Preview. De oplossing moet maandquota per gebruiker, per
fonds en voor heel Preview afdwingen, OCR-pagina's per fonds begrenzen,
provider- en globale kill switches bieden en heractivering technisch via het
vier-ogenprincipe afdwingen.

De bediening komt in de bestaande beheerapp. Stoppen of hervatten mag geen
redeploy en geen wijziging van Vercel-secrets vereisen. Financiële limieten bij
Anthropic en Mistral blijven onafhankelijke backstops en mogen nooit door deze
functionaliteit worden omzeild.

Dezelfde codebase wordt voor Preview en Productie gebruikt. Iedere deployment
mag uitsluitend de Supabase-omgeving beheren waaraan zij zelf gekoppeld is:

- `beheer.preview.bestuurdersportaal.com` beheert alleen Preview;
- `beheer.bestuurdersportaal.com` beheert alleen Productie;
- er komt geen cross-environment client, projectkiezer of centrale opslag van
  providerkeys;
- dit increment wordt alleen in Preview geconfigureerd, gemigreerd en getest.

## 2. Vaststaande besluiten — niet opnieuw ter discussie stellen

### 2.1 Budgetten en providers

| Onderdeel | Besluit |
|---|---|
| Anthropic werkbudget | USD 150/maand; waarschuwingen USD 75 en USD 120; provider-harde stop USD 200 |
| Mistral werkbudget | USD 25/maand; waarschuwingen USD 12,50 en USD 20; beoogde harde stop USD 40 |
| Gecombineerde absolute stop | USD 240/maand; nooit overloop naar Productiekeys of -budget |
| Anthropic allowlist | `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-haiku-4-5-20251001` |
| Mistral allowlist | `mistral-embed`, `mistral-ocr-latest` |
| Mistral Large | Alleen tijdelijk in een vooraf gepland intern AQLab-testvenster, met expliciete begin- en eindtijd |
| Overige challengers | Standaard uit; alleen intern en tijdelijk met synthetische data |

Providerrealiteit op de peildatum:

- Anthropic heeft een Previewworkspace met een harde maandlimiet van USD 200 en
  waarschuwingen op USD 75 en USD 120.
- Mistral werkt in dit account prepaid; EUR 10 tegoed en auto-recharge uit is nu
  de feitelijke, strengere financiële stop. De beheerapp mag niet claimen dat
  een USD 40-providerstop actief is zolang de provider dat niet ondersteunt.
- Providerkeys blijven uitsluitend in server-side environment variables. Sla
  geen key, token, wachtwoord of secretwaarde op in Supabase, auditlogs, de UI,
  tests of documentatie.

### 2.2 Applicatiequota

| Niveau | Maandquotum |
|---|---:|
| Per gebruiker | 150 AI-acties |
| Per fonds | 500 AI-acties |
| Heel Preview | 1.200 AI-acties |
| OCR per fonds | 1.000 daadwerkelijk aangeboden OCR-pagina's |

De bestaande burstlimiet van 20 verzoeken per 5 minuten blijft bestaan en is
een aanvullende beveiligingslaag. Dit ticket vervangt of verruimt die limiet
niet.

Waarschuwingsstatussen in de beheerweergave: bij minimaal 50% en minimaal 80%
van ieder quotum. Overschrijding is blokkerend; een waarschuwing zelf niet.

### 2.3 Bevoegdheden

- Merlin en Robert zijn de twee bevoegde beheerders.
- Beiden mogen een globale of providerspecifieke kill switch zelfstandig
  **uitschakelen**.
- Heractivering vereist altijd vier ogen: één beheerder initieert het verzoek en
  de andere keurt het goed. Zelfgoedkeuring moet in de datalaag onmogelijk zijn.
- Alle beheerhandelingen vereisen een actuele AAL2/MFA-sessie.
- Quota en modelallowlists wijzigen vereist `platform.config.manage`.
- Stoppen, heractivering aanvragen, goedkeuren of afwijzen vereist
  `platform.security.operate`.
- Alleen verbruik en status lezen vereist `platform.observability.read`.
- Identiteiten worden via bestaande platformidentiteiten en capabilities
  bevoegd; hardcode geen namen, e-mailadressen of UUID's in code of migraties.

Preview-testaccounts krijgen geen automatische einddatum. Deze opdracht voegt
geen automatische accountdeactivatie toe.

## 3. Functionele scope

### FR-1 — Eén centrale AI-preflight

Alle kostendragende AI-/OCR-paden moeten vóór de eerste providercall dezelfde
server-side preflight gebruiken. Inventariseer in Plan-modus alle directe en
indirecte Anthropic-, Mistral- en eventuele challenger-calls; vertrouw niet
alleen op de hieronder genoemde routes.

De preflight controleert atomair en fail-closed:

1. is de globale AI-switch actief;
2. is de benodigde provider actief;
3. staat het model op de actieve allowlist en, bij een tijdelijk model, binnen
   het goedgekeurde tijdvenster;
4. blijft de gebruiker binnen 150 AI-acties in de kalendermaand;
5. blijft het fonds binnen 500 AI-acties in de kalendermaand;
6. blijft Preview binnen 1.200 AI-acties in de kalendermaand;
7. blijft OCR binnen 1.000 pagina's voor het fonds in de kalendermaand.

Een DB-/configfout op deze preflight mag voor een kostendragend pad nooit
fail-open zijn. Geef een gesanitiseerde, functionele fout terug zonder interne
configuratie, tellerstanden van andere gebruikers/fondsen of providerinformatie
te lekken.

### FR-2 — Atomaire reservering en eenduidig telcontract

- Reserveer verbruik vóór de externe providercall in één atomaire
  databasehandeling, zodat parallelle requests quota niet kunnen overschrijden.
- Eén **AI-actie** is één door een gebruiker geïnitieerde functionele actie die
  één of meer modelcalls kan veroorzaken. Interne retries of meerdere
  modelstappen binnen dezelfde actie tellen niet opnieuw als AI-actie, maar
  blijven wel zichtbaar in bestaande technische/providertelemetrie.
- Gebruik een server-side idempotentiesleutel per logische actie om dubbele
  reservering bij retried HTTP-requests te voorkomen.
- Een eenmaal geaccepteerde reservering blijft conservatief meetellen wanneer
  de providercall daarna faalt; muteer of verwijder geen verbruiksregel.
- OCR reserveert het aantal pagina's dat werkelijk aan de OCR-provider wordt
  aangeboden, vóór verzending. Een request dat geheel uit de PDF-tekstlaag kan
  worden afgehandeld verbruikt geen OCR-paginaquotum.
- Een fondsgebonden actie telt tegelijk voor gebruiker, fonds en globaal. Een
  legitieme platformbrede interne actie zonder fonds telt alleen globaal en
  vereist een expliciet, auditbaar actietype; maak `fonds_id = null` niet tot
  een makkelijke quota-bypass.
- De kalendermaand wordt server-side in UTC bepaald en in de UI als maand met
  tijdzone-uitleg getoond. Geen clientgestuurde periodegrens.

### FR-3 — Kill-switchtoestanden

Ondersteun minimaal deze onafhankelijk bedienbare schakelaars:

- alle Preview-AI;
- Anthropic;
- Mistral;
- iedere later geconfigureerde challenger standaard uit.

Toestanden:

```text
actief -> gestopt -> heractivering_aangevraagd -> actief
                  \-> heractivering_afgewezen -> gestopt
```

Regels:

- stoppen gaat onmiddellijk in en annuleert een eventueel openstaand
  heractiveringsverzoek;
- nieuwe providercalls worden na stoppen geblokkeerd; reeds lopende externe
  calls hoeven niet technisch te worden afgebroken, maar dit voorbehoud moet in
  de UI staan;
- een stop vereist een verplichte reden;
- een heractiveringsverzoek vereist een verplichte reden;
- alleen een andere bevoegde beheerder mag goedkeuren;
- een goedkeuring is ongeldig als er sinds het verzoek een nieuwe stop of
  configuratiewijziging is geweest; gebruik versie-/optimistic locking;
- afwijzen laat de schakelaar gestopt;
- een lokale heractivering kan een provider-harde limiet, ontbrekend tegoed of
  ingetrokken key niet opheffen. Toon dit expliciet.

### FR-4 — Modelallowlist

Modelkeuze wordt centraal gevalideerd vlak vóór de providercall. Een route mag
de controle niet omzeilen door zelf een modelstring te zetten.

Een tijdelijk AQLab-modelvenster bevat minimaal provider, exact model-id,
begin- en eindtijd, reden en actor. Na de eindtijd is het model zonder verdere
handeling automatisch niet meer toegestaan. Dit is configuratie-expiratie,
geen accountdeactivatie.

### FR-5 — Beheerweergave

Voeg binnen de bestaande beheerapp een duidelijke weergave toe, bij voorkeur
onder `/platform/monitoring` als aparte subweergave of onder een passend bestaand
configuratiepad. Verifieer de actuele navigatie en voorkom botsingen met het
lopende, niet-gecommitteerde werk aan **Verbruik & bundel**.

Toon minimaal:

- globale en providerspecifieke status;
- actuele maandtellers en quota voor heel Preview;
- per fonds: AI-acties, OCR-pagina's, percentage en status;
- zoekbare/gefilterde gebruikerslijst met AI-acties, fonds en status;
- waarschuwingen bij 50% en 80%; blokkering bij 100%;
- laatste wijziging, actor, tijdstip en reden zonder gevoelige inhoud;
- openstaand heractiveringsverzoek en welke handeling de ingelogde beheerder
  wel of niet mag uitvoeren;
- afzonderlijke vermelding van de externe providerbackstops en, zolang geen
  betrouwbare provider-API wordt ingelezen, de tekst **providerverbruik niet
  live beschikbaar** in plaats van een verzonnen kostenbedrag.

Kleur is nooit de enige informatiedrager. Maak blokkades en vereiste tweede
goedkeuring vóór de actie zichtbaar.

### FR-6 — Beheeracties en audit

Laat iedere mutatie via de bestaande `withPlatform()`-wrapper lopen met live
AAL2, capabilitycheck en twee-fasenaudit. Log append-only minimaal:

- handeling en schakelaar/configuratieobject;
- actor;
- oude en nieuwe status of gesaneerde configuratiedelta;
- verplichte reden;
- correlatie-id en uitkomst;
- bij vier ogen: aanvrager en goedkeurder als verschillende identiteiten.

Log nooit prompts, antwoorden, persoonsgegevens, providerkeys of secretwaarden
in het platformauditspoor. Leesacties lopen via `withPlatformRead()`.

### FR-7 — Veilige foutafhandeling

Maak onderscheid tussen:

- quotum bereikt — functionele 429 met geschikt `Retry-After` tot de volgende
  kalendermaand;
- burstlimiet bereikt — bestaande 429-afhandeling behouden;
- kill switch/provider gestopt — gesanitiseerde 503 of een reeds bestaand,
  semantisch passend foutcontract;
- model niet toegestaan — server-side blokkade; geen stille fallback naar een
  ruimer of Productiemodel;
- preflight/config niet beschikbaar — fail-closed 503;
- providerlimiet/tegoed/keyprobleem — bestaande gesanitiseerde providerfout,
  zonder automatisch een andere lifecycle-key te gebruiken.

Leg de definitieve HTTP-contractkeuze in het implementatieplan vast en gebruik
de bestaande API-errorpatronen.

## 4. Datamodel- en beveiligingseisen

Claude stelt in Plan-modus het precieze model vast. Het model moet minimaal
voorzien in:

- environment-lokale AI-configuratie en modelallowlist;
- append-only verbruiksreserveringen met `fonds_id`, gebruiker/actor,
  actietype, provider/model waar bekend, AI-acties, OCR-pagina's,
  idempotentiesleutel en tijdstip;
- kill-switchstatus met monotone versie;
- afzonderlijke, append-only heractiveringsverzoeken en besluiten;
- efficiënte maandaggregatie zonder persoonsdata naar andere fondsen te lekken.

Niet-onderhandelbaar:

- bestaande migraties niet achteraf wijzigen; lever een nieuwe idempotente
  migratie én een afzonderlijke rollback-/herstelprocedure;
- directe tenantreads/-writes op beheerconfiguratie en globale tellers zijn
  deny-by-default;
- een tenantroute mag alleen via een nauw begrensde RPC/preflight zijn eigen
  reservering uitvoeren; de client levert nooit een vertrouwde `user_id` of
  willekeurig `fonds_id` aan;
- `auth.uid()` en de server-side vastgestelde tenantcontext zijn leidend;
- een `SECURITY DEFINER`-functie heeft een vast `search_path`, valideert alle
  context, trekt rechten expliciet in van `public` én `anon` en geeft alleen de
  minimaal vereiste executegrant terug;
- zelfgoedkeuring en dubbele/openstaande heractiveringsverzoeken worden ook met
  constraints/transactielogica in Postgres geblokkeerd, niet alleen in de UI;
- geen service-role in app-clientcode. Platformservice-role uitsluitend achter
  `withPlatform()`/`withPlatformRead()`;
- geen cross-environment tabel, synchronisatie of remote Supabase-client;
- Productie krijgt geen Previewseed en geen Previewconfiguratie.

## 5. Waarschijnlijke raakvlakken — eerst verifiëren

- `core/lib/rate-limit.ts` en `core/lib/rate-limit.sanity.ts` — bestaande
  burstlimiet; behouden en composeren, niet vervangen.
- `app/api/chat/route.ts` — hoofdchat en mogelijk meerdere modelstappen.
- `app/api/agendapunten/[id]/voorbereiding/route.ts`.
- `app/api/procedures/[id]/stappen/[stapId]/besluit-concept/route.ts`.
- documentupload, herextractie, ingest-, embedding- en OCR-paden in `app/api/`,
  `core/lib/` en `platform/lib/`.
- AQLab-providerpaden onder `platform/lib/aqlab/`.
- `platform/lib/platform-wrapper.ts`.
- `platform/lib/platform-capabilities.ts` en bijbehorende seed-/sanitycheck.
- `app/(platform)/platform/(beveiligd)/monitoring/` — bevat reeds lokaal,
  niet-gecommitteerd werk; niet overschrijven of terugdraaien.
- `platform/lib/monitoring-*` — hergebruik alleen waar conceptueel passend.
- `supabase/migrations/` en `supabase/checks/2026_07_31_r1_structurele_gates.sql`.

Voer vóór het plan minimaal een repositorybrede inventarisatie uit op provider-
SDK's, environmentvariabelen en model-id's. Rapporteer expliciet welke
kostendragende paden wel en niet binnen dit increment worden aangesloten. Een
gedeeltelijke preflight die één indirect pad openlaat is geen geslaagde DoD.

## 6. Scopegrenzen

### Wel

- database-afgedwongen maandquota en OCR-quotum;
- globale/provider kill switches;
- vier-ogenheractivering;
- modelallowlist en tijdelijke AQLab-vensters;
- beheer-UI, capabilities en append-only audit;
- integratie op alle geïnventariseerde kostendragende Previewpaden;
- geautomatiseerde tests en Previewsmokes;
- gesaneerd uitvoeringsbewijs en documentatie-update.

### Niet

- providerkeys tonen, opslaan, roteren of vanuit de beheerapp wijzigen;
- automatisch providertegoed kopen of providerlimieten verhogen;
- een Productiekey als fallback gebruiken;
- automatische deactivering van Preview-testaccounts;
- nieuwe AI-functionaliteit of wijzigingen aan de AI-toonprompt;
- wijziging van de bestaande burstlimieten;
- fonds-facing kostenrapportage of facturatie;
- dependency-upgrades uit Werkpakket 4;
- Productiemigratie, Productieseed of Productiesmoke in dit increment;
- het lopende ticket **Verbruik & bundel** herontwerpen of diens wijzigingen
  overschrijven.

## 7. Uitvoeringsfasering

1. **Plan en inventarisatie.** Beschrijf bestaande providerpaden, tellerbron,
   datamodel, RPC-contract, RLS/grants, route-integraties, UI, migratievolgorde,
   rollback en testmatrix. Benoem overlapping met lokaal werk.
2. **Na expliciet akkoord: pure kern en migratie.** Bouw eerst testbare
   beslislogica en de databasegrenzen. Pas migratie-eerst-dan-deploy toe.
3. **Route-integratie.** Sluit ieder kostendragend pad aan en bewijs dat geen
   stille fallback of directe providerroute overblijft.
4. **Beheerbediening.** Bouw read-, stop-, aanvraag-, afwijs- en
   goedkeuringspaden met capabilities, AAL2 en audit.
5. **Lokale verificatie.** Sanity, TypeScript, relevante suites, structurele
   DB-gates en volledige cross-tenantsuite.
6. **Previewuitrol na apart akkoord.** Migratie eerst op Preview, daarna code;
   voer de acceptatiematrix uit met Merlin en Robert. Geen Productieactie.

## 8. Verplichte acceptatiematrix

| Test | Verwachte uitkomst |
|---|---|
| Normale AI-actie onder alle quota | Toegestaan; exact één logische AI-actie gereserveerd op gebruiker, fonds en globaal |
| Parallelle laatste twee acties bij nog één plek | Exact één toegestaan; geen race-overschrijding |
| Zelfde idempotentiesleutel opnieuw | Geen dubbele reservering of providercall |
| Gebruiker op 150 | Nieuwe actie geblokkeerd; ander fondslid blijft mogelijk zolang fonds/globaal ruimte hebben |
| Fonds op 500 | Alle nieuwe fondsacties geblokkeerd; ander fonds blijft mogelijk |
| Preview op 1.200 | Alle nieuwe Preview-AI geblokkeerd |
| OCR op 1.000 pagina's | Verdere OCR geblokkeerd; niet-OCR-functionaliteit blijft volgens eigen quota werken |
| 50% en 80% | Correcte tekstuele waarschuwing zonder blokkade |
| Anthropic gestopt | Alleen nieuwe Anthropicaanroepen geblokkeerd; geen fallback naar Productie of ruimer model |
| Mistral gestopt | Embedding/OCR geblokkeerd of veilig functioneel afgehandeld conform vooraf vastgelegd routecontract; geen providerfallback |
| Globale stop | Alle nieuwe kostendragende AI-/OCR-calls geblokkeerd |
| Merlin stopt | Direct effectief; audit bevat reden en resultaat |
| Merlin vraagt heractivering aan | Status blijft niet-actief tot tweede goedkeuring |
| Merlin keurt eigen aanvraag goed | Server/DB weigert, ook buiten de UI om |
| Robert keurt Merlins actuele aanvraag goed | Schakelaar wordt actief; beide actoren auditbaar |
| Config wijzigt tussen aanvraag en goedkeuring | Oude aanvraag kan niet activeren |
| Geen actuele AAL2 | Lezen/muteren geweigerd volgens capabilitypad |
| Ontbrekende capability | Handeling geweigerd en gesaneerd gelogd |
| Preflight-DB-fout | Kostendragende call fail-closed; provider ontvangt niets |
| Vreemd fonds / gespoofte user- of fonds-id | Weigering; geen teller- of datalek |
| Previewbeheer | Kan uitsluitend Previewconfig en -tellers zien/wijzigen |
| Productieconfig/-key | Wordt in geen enkele Previewtest geraakt |

Gebruik synthetische of gesaneerde testdata. Neem geen wachtwoorden, tokens,
secretwaarden of volledige persoonsgegevens op in screenshots of logs.

## 9. Definition of Done

Volg volledig `CLAUDE.md` §Definition of Done. Opdrachtspecifiek is het werk pas
gereed wanneer:

- alle geïnventariseerde kostendragende paden door de centrale preflight lopen;
- normale route, quotumoverschrijding, kill switch en vier-ogenheractivering
  aantoonbaar groen zijn;
- tellerreservering race-safe, idempotent en fail-closed is getest;
- RLS, grants en eventuele `SECURITY DEFINER`-functies tegen de echte
  Previewdatabase zijn gecontroleerd met de structurele gates;
- `bash scripts/cross-tenant-ci.sh`, `npm run sanity` en
  `./node_modules/.bin/tsc --noEmit --skipLibCheck` groen zijn;
- een nieuw decision-record het telcontract, de bevoegdhedenscheiding en de
  vier-ogenstatusmachine vastlegt;
- `HANDOVER.md`, `security/VERVOLGSTAPPEN-SPRINT-1-2026-08-15.md` en de door
  `CLAUDE.md` vereiste security-/as-builtdocumentatie zijn bijgewerkt;
- open restrisico's met eigenaar in
  `00 Overzicht en status/openstaande-punten-en-risicos.md` staan;
- de terugkoppeling expliciet bevestigt dat geen Productiedata, -key, -provider-
  budget of -Supabaseproject is geraakt.

Externe Previewgebruikers blijven **no-go** totdat naast dit ticket ook de
Auth/AAL2-matrix en de gesaneerde service-rolefingerprints uit het
vervolgdocument groen zijn.

## 10. Terugkoppeling

Rapporteer in het vaste antwoordformat uit `CLAUDE.md`:

1. samenvatting;
2. aangepaste bestanden;
3. RLS/security-impact;
4. audit-logging-impact;
5. datamodel/migratie-impact;
6. test/verificatie inclusief de acceptatiematrix;
7. openstaande risico's en vervolgpunten.

Noem daarnaast apart:

- de volledige lijst van afgedekte providerpaden;
- alle bewust niet-afgedekte paden met reden en eigenaar;
- migratie- en rollbackvolgorde;
- het gesaneerde bewijs dat uitsluitend Preview is geraakt.
