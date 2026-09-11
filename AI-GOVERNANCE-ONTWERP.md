# AI-governance & ondersteunende subagents — Ontwerpdocument

> **Status**: Revisie 0.1 (concept ter review)
> **Datum**: 2026-05-22
> **Doel**: (1) een **proportionele** AI-governance-inrichting voor het bestuurdersplatform in de geest van de EU AI Act en het AI Pact, en (2) een lean set **Claude Code-subagents** die het ontwikkelwerk daarvoor ondersteunen. Scope: MVP.
> **Geen juridisch advies**: dit document bereidt voor. De formele AI-Act-classificatie en de vraag of het platform "provider" of "deployer" is, horen bij een gekwalificeerde juridische/compliance-beoordeling. Agents en dit document leveren concepten; **mensen besluiten en zijn verantwoordelijk**.

---

## 1. Twee soorten "agents" — niet door elkaar halen

Het belangrijkste om scherp te houden, want hier ontstaat anders verwarring:

- **Laag A — Claude Code-subagents.** Hulpmiddelen die *ons helpen de software te bouwen en te reviewen*. Ze werken op de codebase tijdens ontwikkeling. Dit is wat je oorspronkelijk vroeg te schetsen.
- **Laag B — AI-governance-functies (AI Act / AI Pact).** De organisatorische verantwoordelijkheid voor *hoe de AI-functies ín het product worden bestuurd*. De "agents" die in het advies bij deze laag horen, zijn AI-ondersteunde reviewers binnen een proces; de **accountable functies zijn mensen**.

Het raakvlak: een Laag-A-subagent kan een Laag-B-zorg afdwingen — een audit-evidence-reviewer controleert bijvoorbeeld of een nieuwe AI-feature logt zoals AI-governance vereist. Maar een subagent is nooit de accountable functie. Hij bereidt voor, controleert en signaleert; hij besluit niet.

---

## 2. Het principe: mensen accountable, agents ondersteunen

Ik onderschrijf het hybride model volledig:

```
Menselijke functies = accountable / besluitvormend
Agents             = voorbereidend, controlerend, documenterend, signalerend
```

Dit sluit aan op een guardrail die al in `CLAUDE.md` en in het product staat: **human-in-the-loop — AI signaleert, vat samen en spiegelt, maar besluit nooit.** Het AI Pact is een set vrijwillige commitments (o.a. AI-governancestrategie, in kaart brengen van hoog-risico-systemen, AI-geletterdheid); de AI Act werkt risicogebaseerd met menselijk toezicht als kernverplichting voor hoog-risico-systemen. De precieze verplichtingen hangen af van het gebruik en van de provider/deployer-status — dat is juist het stuk dat een mens (met juridische input) moet vaststellen.

---

## 3. Menselijke functies — proportioneel voor de MVP

Vijf functies volstaan voor nu. Belangrijk voor een klein team: in de MVP-fase mag **één persoon meerdere functies dragen**, zolang de verantwoordelijkheid expliciet is *benoemd*. Geen lege rollen, wel duidelijke accountability.

| Functie | Kern | Agent kan dit |
|---|---|---|
| **AI Governance Owner** | AI-principes, human-in-the-loop-beleid, go/no-go voor productiegebruik, risicobereidheid | ondersteunen, niet vervangen |
| **AI Risk & Compliance Reviewer** | use-case-classificatie, hoog-risico-inschatting, transparantie- en audit-eisen, restrisico's | sterk ondersteunen, eindoordeel menselijk |
| **Product Owner AI** | requirements, acceptatiecriteria, UX-waarschuwingen, validatiestatussen, bronvermelding | deels ondersteunen |
| **Technical AI & Security Owner** | RLS/tenant-isolatie, prompt-/outputlogging, modelconfig, autorisaties, audit-events | deels ondersteunen |
| **AI Literacy & Adoption Lead** | gebruikersuitleg, disclaimers, training, voorbeelden van goed/verkeerd gebruik | deels ondersteunen |

Let op: deze AI-governance-functies zijn iets anders dan de productrollen in `profielen` (`bestuurder`/`voorzitter`/`beheerder`). Die laatste bepalen rechten ín de applicatie; de functies hierboven beleggen verantwoordelijkheid óver het AI-gebruik. Niet door elkaar halen.

---

## 4. Ondersteunende Claude Code-subagents (de schets)

> **Canonieke definities:** de volledige, kant-en-klare laag-A-subagentdefinities (incl. `ontwerp-author` en `ontwerp-sync-reviewer`) staan in [`SUBAGENTS-ONTWERP.md`](./SUBAGENTS-ONTWERP.md). Onderstaande prozabeschrijving was de eerste aanzet; dat document is leidend.

Het advies stelde zes governance-agents voor. Voor een MVP zou ik die **consolideren tot een lean set**: meerdere overlappen sterk op code-reviewniveau, en je wilt niet zes reviewpassages per feature. Hieronder een **core van vier** plus **twee optionele**. Elke definitie is bedoeld om straks (na akkoord) als bestand in `.claude/agents/<naam>.md` te landen; ze staan hier eerst ter review. Elke subagent eindigt met een advies voor de verantwoordelijke mens en neemt nooit zelf een besluit.

### Core

#### `supabase-rls-reviewer`
> Je bent RLS- en tenant-isolatie-reviewer voor een Next.js/Supabase-platform voor pensioenfondsen. Controleer bij elke datamodel- of route-wijziging: RLS aan op nieuwe tabellen, policy-filtering per `fonds_id` (direct of via decision-chain), géén service-role-key in client-code, en of gevoelige acties server-side zijn afgedwongen (niet alleen in de UI). Output: (1) oordeel, (2) blocking RLS-issues, (3) cross-tenant-risico's, (4) ontbrekende policies, (5) advies voor de Technical & Security Owner. Je besluit niet; je adviseert.

#### `audit-evidence-reviewer`
> Je bent audit- en reproduceerbaarheidsreviewer. Controleer of een wijziging append-only logt en later aantoonbaar is. Loop na: wordt de actie gelogd in `governance_events` / het juiste `*_log` (nooit UPDATE/DELETE), met actor, fonds, objecttype/-id, oude/nieuwe waarde, timestamp en hash waar relevant? Voor AI-output: prompt, bronnen, model(versie), validatiestatus, gevalideerd_door/op vastgelegd? Output: (1) evidence-overzicht, (2) ontbrekende logging, (3) auditrisico, (4) aanvullende requirements, (5) go/no-go voor auditability — als advies voor de Risk & Compliance Reviewer.

#### `ai-governance-reviewer`
> Je bent AI-governance-reviewer voor een bestuurdersplatform. Beoordeel een AI-feature op: doelbinding, human-in-the-loop, transparantie/bronvermelding, uitlegbaarheid, governance-logging, en het risico op schijnzekerheid of feitelijke/juridische/actuariële misinterpretatie. Geef ook een **conservatieve risico-inschatting** (verboden / hoog / beperkt / minimaal / nader juridisch beoordelen) met redenering, geraakt belang en benodigde beheersmaatregelen. Je neemt geen eindbesluit: je levert een advies (toestaan / aanpassen / blokkeren / later beoordelen) voor de AI Governance Owner.

#### `code-reviewer`
> Je bent eindreviewer op kwaliteit, security en onderhoudbaarheid. Controleer regressierisico, naleving van bestaande patronen (zie `CLAUDE.md`), `tsc --noEmit --skipLibCheck`, en of de wijziging het afgesproken antwoordformat respecteert. Output: bevindingen geprioriteerd op blocking / aanbevolen / optioneel, plus een korte eindconclusie.

### Optioneel (later)

#### `test-engineer`
> Stelt programmatische sanity-checks/tests voor bij risicovolle businesslogica (stemming, readiness/gating, procedurestatussen, audit-eventconstructie, permissie-/rolchecks, stuurinformatie-berekeningen, AI-validatiestatussen). *Waarde is beperkt zolang er geen testframework is* — pas zinvol zodra er een testharnas staat, of als generator van losse `tsc`-uitvoerbare sanity-scripts zoals bij `lib/stemming.ts`.

#### `ai-literacy-ux-reviewer`
> Maakt AI-functionaliteit begrijpelijk voor bestuurders en bestuursbureaus: korte gebruikersuitleg ("wat doet de AI hier?"), disclaimers ("dit is geen besluit"), microcopy, en uitleg over broncontrole en menselijke verantwoordelijkheid. Toon: professioneel, bestuurlijk, niet-technisch, geen AI-hype. Ondersteunt de AI Literacy & Adoption Lead.

**Aanrader om mee te starten:** `supabase-rls-reviewer`, `audit-evidence-reviewer` en `ai-governance-reviewer`. Dat zijn precies de drie die elke nieuwe AI-feature zou moeten passeren vóór een mens go/no-go geeft. `code-reviewer` als vaste eindstap; de twee optionele erbij wanneer er behoefte (en bij `test-engineer`: een testframework) is.

---

## 5. Wat je al hebt versus de kleine gaten (product-laag)

Een groot deel van de "concreet in jullie product"-lijst uit het advies is **al gebouwd**. Conform het principe "technische waarheid uit de codebase" — geverifieerd tegen de migraties:

**Al aanwezig:**

- **Centrale providergovernance (#311, besluit 0209):** alle generatieve productietaken lopen
  via één gateway. Provider/model komen per fonds uit een privaat configuratieschema, iedere
  logische actie reserveert quotum, iedere call passeert de live kill switch/allowlist en krijgt
  een inhoudsvrije auditregel. Een fonds kan alleen een platformprofiel of zijn eigen profiel
  gebruiken. Hiermee is klant-eigen AI configureerbaar zonder een tweede applicatievariant.

- **AI-interactielog (chat):** `governance_log` legt elke AI-vraag vast met `gebruiker_id`, `fonds_id`, vraag, antwoord, `bronnen` (jsonb), `modus` (documenten/combineren/algemeen) en `model`.
- **AI-interactie + human-validation workflow (Decision Object):** `decision_ai_interactions` heeft `prompt`, `bronnen`, `model`/`modelversie`, `output`, **`validatiestatus`** (concept → gevalideerd → aangepast → afgekeurd → gearchiveerd), `gevalideerd_door`/`gevalideerd_op`, `aangepaste_output`, `gebruikt_in_dossier` en `validatie_domein` (welke rol mag valideren). Dat is vrijwel exact de human-validation workflow uit het advies — al in het schema.
- **Transparantie:** klikbare `[Bron N]`-bronvermelding in de chat; drie AI-modi met een expliciete disclaimer bij de "Algemeen"-modus. **Herkomstlabels worden strikt gescheiden gehouden** — naast `[Bron N]` (vastgestelde fondsbron) zijn er `[Algemene kennis]`/`[Volgens wetgeving]` (modelkennis) en, sinds de agendapunt-modus (ADR 0028), `[Toelichting agendapunt]` voor ongevalideerde bestuurs-vrijetekst. Kerninvariant: vrije tekst van een bestuurder wordt nooit als vastgestelde fondsbron gepresenteerd; het auditspoor legt de herkomst vast (`governance_log.retrieval_meta.herkomst='agendapunt:<id>'`).
- **Integriteit:** `governance_events` append-only met sha256-hash per event.

**Eerlijke nuance:** het *schema* voor de validation workflow bestaat, maar volgens `HANDOVER.md` ontstaan `decision_ai_interactions`-rijen nu inline en wordt de notificatie `ai_validatie_wacht` nog niet getriggerd. Of élke AI-feature consistent naar deze tabel schrijft, is dus iets om te verifiëren — een mooie eerste taak voor de `audit-evidence-reviewer`.

**De gaten (klein, proportioneel aan te vullen):**

- **AI-use-case register** — een meta-inventaris van AI-features (naam, doel, gebruiker, geraakt proces, model, bronnen, risicocategorie, eigenaar, human-in-the-loop-maatregel, status ontwerp/pilot/productie/retired). Bestaat nog niet; een markdown-register (bv. `AI-REGISTER.md`) is het goedkoopste begin en kan later naar de database.
- **Consistente in-app AI-literacy** — de disclaimer bestaat in de "Algemeen"-modus, maar niet als consistent patroon over alle AI-features. Uitbreidbaar met korte "wat doet de AI hier / dit is geen besluit"-snippets.
- **Governance-dashboard** — overzicht voor de Governance Owner (actieve use-cases, openstaande validaties, output zonder review). Een echte feature; voor een demo-MVP zou ik dit **uitstellen**.

---

## 6. Proportioneel MVP-advies

Houd het licht maar aantoonbaar:

1. **Benoem de vijf menselijke functies** — desnoods met één persoon op meerdere, maar expliciet vastgelegd (bv. in een ADR).
2. **Start een AI-use-case register** in markdown; vul het met de bestaande AI-features (chat-assistent, agendapunt-voorbereiding, AI-vraag geframed door agendapunt-toelichting (ADR 0028; human-in-the-loop-maatregel = strikte herkomstlabeling `[Toelichting agendapunt]` + `governance_log.retrieval_meta.herkomst`), document-samenvatting, besluit-concept).
3. **Leun op de bestaande logging** (`governance_log` + `decision_ai_interactions`) en verifieer met de `audit-evidence-reviewer` of de dekking compleet is.
4. **Wire drie subagents** in de ontwikkelflow: `supabase-rls-reviewer`, `audit-evidence-reviewer`, `ai-governance-reviewer`.
5. **Menselijk go/no-go** voor productiegebruik van elke nieuwe AI-feature, gelogd als besluit.
6. **Stel het dashboard uit** tot er een betalende klant/echte gebruikers zijn.
7. **Formele AI-Act-classificatie** met gekwalificeerde juridische input — agents bereiden de classificatie voor, een mens stelt vast.

---

## 7. Volgende stappen

- **Activatie subagents:** na akkoord op de set zet ik de definities om in `.claude/agents/<naam>.md` (Claude Code-formaat).
- **Besluit vastleggen:** dit hybride model (mensen accountable, agents ondersteunen) is een governance-besluit — kandidaat voor `decisions/0003-ai-governance-hybride-model.md`.
- **AI-use-case register:** los, klein deliverable; kan ik opzetten met de vier bestaande AI-features als eerste rijen.

---

*Dit document is de schets ter review. Niets hiervan wijzigt code; activatie van subagents en het register volgen pas na akkoord.*
