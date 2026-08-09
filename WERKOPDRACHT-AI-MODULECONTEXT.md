# Werkopdracht: modulecontext in de AI-assistent (risicomatrix + processen)

> Plansessie Cowork, 09-08-2026. Plak deze werkopdracht als eerste bericht in een
> Claude Code-sessie in de repo-root. Zie `decisions/0004` en `WERKOPDRACHT-TEMPLATE.md`.
> Verwant maar los van `WERKOPDRACHT-AI-CONTEXTBESEF.md` (dat regelt de *persoonlijke*
> portaalstand); deze opdracht voegt een *object-/modulescope* toe.

---

**Doel & context** — de bestuurder moet de AI kunnen bevragen ín de context van de
module waar hij op dat moment werkt: bij de risicomatrix "welke risico's speelden er
eerder rond thema X en waarom is de weging verschoven", en bij een geopend proces
"wat is de scope en welke stukken zijn hieraan gekoppeld". Vandaag weet het chatvenster
niets van het geopende object; zo'n vraag valt terug op de fondsbrede context of op een
verduidelijkingsvraag.

**Goedgekeurd ontwerp/plan** — leidend is de plansessie-uitkomst: **geen nieuw
retrievalmechanisme bouwen, maar de twee bestaande bouwstenen specialiseren**:

1. **Gestructureerd contextblok** — zoals `haalModuleContextBlok` /
   `bouwPortaalstandBlok` het nu doen: onder RLS opgehaalde databaserijen als *benoemde
   tekst* (geen genummerde bron), mét een instructie die meereist ín het blok zodat de
   op sha256 gepinde toon-systeemprompt byte-identiek blijft.
2. **`document_scope`** — het bestaande, server-side onder RLS gevalideerde
   scope-contract (`valideerScope`, `document-scope.ts`), dat de retrieval tot een
   documentset beperkt en de scope in `retrieval_meta.scope` vastlegt.

De twee wensen vallen langs deze twee bouwstenen uiteen: risicohistorie is *gestructureerde
data* (blok 1), een procesvraag is een *hybride* (blok 1 voor scope/fase + blok 2 voor de
gekoppelde stukken). Werk dit vóór de bouw uit tot `AI-MODULECONTEXT-ONTWERP.md`.

---

## Vertrekpunt — geverifieerd tegen de code op 09-08-2026

- **`app/api/chat/route.ts`** bouwt de context al in twee vormen. `haalModuleContextBlok`
  levert nu "=== ACTIEVE RISICO'S VAN HET FONDS ===" (`titel, toelichting, niveau,
  type_risico, categorie`) en "=== LOPENDE PROCEDURES ===" als benoemde-tekstblokken,
  bewust gated (aanvankelijk alleen agendapunt-modus wegens kosten/ruis, sinds
  contextbesef ook conditioneel). Het `document_scope`-pad valideert client-`document_ids`
  onder RLS en zet daarbij de intent-heuristiek uit (`scopeActief → bronIntentResultaat
  = null`) — precies het gedrag dat we voor een expliciete scope willen.
- **Classificatie is bewust heuristisch, geen LLM** (`vraagtype.ts`). Een expliciete
  modulescope hoeft die heuristiek dus niet te raken: hij omzeilt hem, net als
  `document_scope` nu.
- **Risico-datamodel** (`risico-config.ts`, `risico-wijziging.ts`): `risicos` met vier
  vaste thema's (`categorie`), `status` (`actief`/`gesloten`), `kans`, `impact`, `niveau`,
  `type_risico`, `eigenaar_naam`, `volgende_beoordeling`, `toelichting`. Weegveld-
  wijzigingen kennen een **redenplicht** en landen append-only in **`risico_log`**
  (`event_type` `risico_gewijzigd`); sluiten zet `status = gesloten` en logt ook in
  `risico_log`. Er is een **`archief`**-view voor gesloten risico's. Dit is de feitelijke
  bron voor "wat speelde eerder / waarom stond dit op hoog".
- **Proces-datamodel** (`decision.ts`, `proces-templates.ts`): een `procedure` heeft een
  gekoppeld Decision Object (`procedures.decision_id`) met besluitvraag/scope/classificatie,
  `stappen`, `procedure_requirements`, en **bewijsstukken per stap** (`stap_id,
  document_id, titel, documenttype`) — dat zijn de "gekoppelde documenten".
- **Instap-precedent**: taakkaart 2 "Een document doorgronden" (`DocumentDoorgronden.tsx`)
  opent `/ai` mét een vooraf gezette `document_scope`. Tegelijk bestaat er *inline* AI ín
  het procesdossier (`AIValidatieBlok.tsx`, `OnderbouwingsPaneel.tsx`) — twee patronen die
  hier botsen (zie besluitpunt 1).

**Beschikbaar gereedschap** — de route leest al uit `risicos`, `procedures`, `documenten`,
`document_chunks`; `risico_log` en `archief` bestaan. **Verwachting: geen nieuwe tabel of
kolom nodig.** Blijkt er tóch een migratie nodig, dan is dat een signaal dat de scope
verkeerd is begrepen: stop en leg voor.

---

## Scope

### Stap 1 — het scope-contract uitbreiden

Breid het client→server scope-contract uit van `document_scope` naar een generieke
**`module_scope`**, server-side gevalideerd onder RLS (zelfde discipline als
`valideerScope`: id's uit de body worden nooit vertrouwd; een vreemd-fonds-id valt weg
door RLS en wordt geweigerd, nooit stille terugval). Twee soorten:

- `module_scope: { soort: "proces", procedure_id }`
- `module_scope: { soort: "risico_thema", categorie }` (vier vaste slugs uit
  `risico-config.ts`)

Resolveer server-side naar (a) een gestructureerd contextblok en, bij een proces, (b) een
`document_scope` gevuld met de `document_id`'s van de gekoppelde bewijsstukken — zodat de
bestaande RAG over precies die stukken loopt.

### Stap 2 — het risico-thema-contextblok

Nieuwe variant naast `haalModuleContextBlok`, gefilterd op `categorie`, die de historie
meeneemt die het huidige actieve-risico-blok mist:

- actieve én **gesloten** risico's in dat thema (`archief` / `status = gesloten`);
- per risico de relevante regels uit **`risico_log`** (met name weegveld-wijzigingen +
  motivering) — begrensd (bv. N recentste), want dit kan fors worden.

Benoemde tekst, geen genummerde bron; instructie reist mee in het blok.

### Stap 3 — het proces-contextblok + documentscope

Nieuwe variant die uit `procedure_id` (onder RLS) opbouwt: besluitvraag/scope/classificatie
(Decision Object), huidige stap/fase, openstaande `procedure_requirements`; plus het zetten
van de `document_scope` op de gekoppelde bewijsstukken (**procesniveau** als MVP; zie
besluitpunt 2). Bij een proces zónder gekoppelde stukken: expliciete melding (steunt op
metadata + algemene kennis), nooit stille terugval naar de hele bibliotheek.

### Stap 4 — instapknoppen (placement)

- **Proces**: knop op het niveau van een **geopend proces** (`procedures/[id]/page.tsx`),
  als primaire actie in `DecisionObjectHeader.tsx` of `DossierStatusStrip.tsx`. **Niet** op
  de lijst (`procedures/page.tsx`) — daar is geen proces-scope; een generieke AI-vraag
  daar valt terug op het bestaande fondsbrede `modulesBlok`.
- **Risicomatrix**: knop op **thema-/categorieniveau** in de matrix (`risicomatrix/page.tsx`,
  `Heatmap.tsx` — per categorie), en optioneel op een **geopend risico**
  (`risicomatrix/[id]/page.tsx`) voor de enkel-risico-variant (zie besluitpunt 4).

### Stap 5 — herkenbaarheid en toon

- **Scope zichtbaar als scope.** Toon een scope-chip ("Proces: «…»" / "Thema: «…»") en
  benoem de gebruikte modulecontext in het onderbouwingspaneel, onderscheiden van
  documentbronnen (transparantielijn besluit 0071, gelijk aan de "portaalstand"-aanduiding).
- **Signaleren, niet adviseren.** De instructie in het blok stuurt op "dit speelde eerder /
  dit staat open / dit is de motivering geweest", nooit op "u moet nu X doen"
  (human-in-the-loop, `CLAUDE.md`). Hergebruik het patroon van `PORTAALSTAND_INSTRUCTIE`.

### Niet in scope

- De heuristische intentclassificatie vervangen door een LLM. De scope is expliciet en
  omzeilt de heuristiek; dat houdt de verduidelijkingsbeslissing auditeerbaar.
- Stapniveau-scope voor processen (besluitpunt 2 — bewust als vervolg).
- Een tweede, inline chat-implementatie in de module, tenzij besluitpunt 1 daarvoor kiest.
- Nieuwe tabellen/kolommen/migraties (verwachting; zie vertrekpunt).
- Wijziging aan de toon-systeemprompt (`app/api/chat/route.ts`); instructies reizen mee in
  het contextblok.

---

## Impactklasse

**Architectuur** — nieuw AI-pad (nieuwe scope-soort + promptopbouw + logging), géén
verwachte datamodelmigratie. Weging expliciet: documentatiehaak **vuurt** (AI-gedrag/
architectuur), dus naast `HANDOVER.md` ook `AI-MODULECONTEXT-ONTWERP.md` + het functioneel
ontwerp van de AI-module bijwerken en de marker in `00 Overzicht en status/
doc-actualisatie-log.md` ná de Word-doc-actualisatie verschuiven. Structurele gates
(`supabase/checks/2026_07_31_r1_structurele_gates.sql`) zijn **niet vereist** zolang er geen
policy-/grant-/`SECURITY DEFINER`-/datamodelwijziging is; blijkt die tóch nodig, dan gates
verplicht en scope heroverwegen.

---

## Besluitpunten

1. **Uitrouteren naar `/ai` mét scope, of inline in de module?** Aanbeveling:
   uitrouteren (volle chat-ervaring, geen dubbele implementatie), consistent met taakkaart 2.
   Tegenkracht: `AIValidatieBlok` is inline; sommige bestuurders willen in het dossier
   blijven. Kort toetsen bij een paar gebruikers vóór vastzetten.
2. **Granulariteit proces: procesniveau (MVP) of stapniveau?** Bewijsstukken hangen per
   `stap_id`, dus stapniveau is technisch natuurlijk en preciezer. Aanbeveling: procesniveau
   als MVP, stapniveau als vervolg (zelfde scope-contract, geen herbouw).
3. **Definitie "vroeger/opgetreden" bij risico's.** Bedoelen we gesloten risico's +
   wijzigingslog, of *gematerialiseerde* risico's (incidenten)? Het model kent dat laatste
   niet expliciet. Kies gesloten-risico's-plus-`risico_log` en benoem die grens in het
   antwoord — anders suggereert de assistent een historie die er niet is (schijnzekerheid,
   `CLAUDE.md`).
4. **Risico-scope: thema/categorie, enkel risico, of beide?** Aanbeveling: thema als
   primair (past op de wens "rond een bepaald thema"); enkel-risico optioneel.
5. **Wat is leidend bij tegenspraak** tussen de modulestand en een genotuleerd besluit/
   document? Vooraf bepalen en in het antwoord benoemen, niet stilzwijgend kiezen (gelijk
   aan contextbesef-besluitpunt 2).

---

## Acceptatiecriteria

1. Vanuit een geopend proces levert "waar gaat dit proces over en welke stukken horen
   erbij?" een inhoudelijk antwoord op basis van besluitvraag/fase + de gekoppelde
   bewijsstukken, zónder verduidelijkingsvraag.
2. Vanuit een risicothema levert "welke risico's speelden hier eerder en waarom is de
   weging veranderd?" een antwoord dat gesloten risico's én `risico_log`-motiveringen van
   dát thema gebruikt.
3. Een modulescope zet de intent-heuristiek uit (aantoonbaar via de promptopbouw/log),
   net als `document_scope`; een gewone vraag zonder scope gedraagt zich ongewijzigd
   (regressie).
4. De scope wordt server-side onder RLS geresolveerd; een gemanipuleerde `procedure_id`/
   `categorie` van een ander fonds wordt geweigerd (cross-tenant-test), nooit stille
   terugval.
5. Bij een proces zonder gekoppelde stukken verschijnt een expliciete bronbasis-melding;
   er wordt niet stil de hele bibliotheek doorzocht.
6. De scope is zichtbaar (chip + onderbouwingspaneel), onderscheiden van documentbronnen.
7. Antwoorden signaleren (open/eerder/motivering) en dragen geen besluit of opdracht op
   (steekproef van vijf beoordeeld).
8. Elke modulescope-beurt logt in `retrieval_meta` (scope-soort, `procedure_id`/`categorie`,
   gebruikte bronnen) plus validatiestatus; het antwoord is reconstrueerbaar.
9. De toon-systeemprompt is byte-identiek (sha256-pin `generatie-kern.sanity.ts` ongewijzigd);
   alle instructies reizen mee in de contextblokken.
10. Meetset/sanity uitgebreid voor de scope-resolutie (incl. tegenvoorbeeld: geen scope →
    geen modulecontext); `tsc --noEmit --skipLibCheck` groen; `npm run sanity` groen.
11. Gemeten effect op prompt-tokens en tijd-tot-eerste-token vóór/ná, per scope-soort;
    verslechtering expliciet melden i.p.v. laten passeren.
12. Geen migratie, geen nieuwe tabel of kolom (of, indien tóch nodig: gestopt en voorgelegd).

---

## Relevante bestanden / modules

- `app/api/chat/route.ts` — scope-contract (`module_scope`), resolutie, `haalModuleContextBlok`-
  varianten, promptblokken.
- `core/lib/document-scope.ts` — patroon voor server-side scope-validatie (uitbreiden/spiegelen).
- `core/lib/portaalstand-blok.ts` — patroon voor benoemd contextblok + meereizende instructie.
- `core/lib/risico-config.ts`, `core/lib/risico-wijziging.ts` — thema's, weegvelden, logsemantiek.
- `core/lib/decision.ts`, `core/lib/proces-templates.ts` — Decision Object, stappen, bewijsstukken.
- `core/lib/vraagtype.ts` (+ `.sanity.ts`), meetset — regressie bij expliciete scope.
- UI: `app/(dashboard)/procedures/[id]/page.tsx` + `DecisionObjectHeader.tsx`/`DossierStatusStrip.tsx`;
  `app/(dashboard)/risicomatrix/page.tsx` + `Heatmap.tsx`, `risicomatrix/[id]/page.tsx`;
  `app/(dashboard)/ai/_components/{DocumentDoorgronden,OnderbouwingPaneel}.tsx` als referentie.

**Guardrails (zie `CLAUDE.md`)** — RLS per `fonds_id`, scope uit sessie/geresolveerd, nooit uit
de body vertrouwd; append-only audit ongemoeid; **human-in-the-loop** (zwaarst wegend hier);
geen schijnzekerheid (besluitpunt 3); toon-systeemprompt afblijven; nieuw AI-pad = prompt-/
output-logging + validatiestatus.

**In te zetten subagents (zie `SUBAGENTS-ONTWERP.md`)** — `ai-governance-reviewer` (verplicht:
nieuw AI-pad, promptopbouw, human-in-the-loop, bronherkenbaarheid), `supabase-rls-reviewer`
(verplicht: nieuwe scope-resolutie-query's), `code-reviewer`, en `ontwerp-sync-reviewer` vóór merge.

**Werkmodus** — begin in **Plan-modus**. Lever eerst: het `module_scope`-contract, de
scope-resolutie + RLS-aanpak, de exacte blok-teksten (proces + risicothema) mét meereizende
instructie, de antwoorden op besluitpunten 1–5, en de meetopzet voor criterium 11. **Wijzig
pas na expliciet akkoord.**

**Definition of Done** — volg `CLAUDE.md` §Definition of Done. Opdracht-specifiek:
`AI-MODULECONTEXT-ONTWERP.md` opgesteld + ontwerp-sync groen; een `decisions/`-entry voor de
nieuwe scope-soort (gedragswijziging in bronkeuze); meetset/sanity uitgebreid; `HANDOVER.md`
+ FO AI-module bijgewerkt; documentatiehaak afgehandeld (architectuur-impact).

**Openstaande punten** — leg nieuwe restrisico's (o.a. besluitpunt 3, en de kosten/ruis-
afweging van het historieblok) mét eigenaar vast in `00 Overzicht en status/
openstaande-punten-en-risicos.md`.

**Terugkoppeling** — rapporteer in het antwoordformat uit `CLAUDE.md` (samenvatting,
aangepaste bestanden, RLS/security-impact, audit-impact, datamodel/migratie-impact,
test/verificatie, openstaande risico's).
