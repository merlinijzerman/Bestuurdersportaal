# AI-modulecontext — Ontwerpdocument

> **Sinds P1a (03-09-2026, besluit 0201) staat de assistent in drie lagen.** De context (L1) en het gesprek (L2) wonen in `core/components/assistent/` en `core/lib/assistent-*`. Verwijzingen hieronder die over gespreksstaat, streaming of de payload gaan, slaan dus op `core/components/assistent/useAssistent.ts`. Zie `core/components/assistent/README.md`.
>
> **Sinds T1 (03-09-2026, besluit 0204) is er één component, niet twee.** De presentatielaag heet `app/(dashboard)/ai/_components/AssistentOppervlak.tsx` en is de INHOUD van het assistentpaneel; dat paneel hangt in `core/components/DashboardShell.tsx` en kent vier standen (dicht → 400 px → 740 px → volledig scherm). `/ai` rendert de assistent niet meer zelf: die route ís de volledig-schermstand en `AssistentClient.tsx` is er nog uitsluitend de brug naartoe. Waar hieronder "de pagina /ai" staat, lees: het oppervlak in zijn volledig-schermstand.


> **Status**: Ontwerp — vastgesteld 2026-08-09, in bouw. Besluiten §7 belegd; uitvoering
> volgt [`WERKOPDRACHT-AI-MODULECONTEXT.md`](./WERKOPDRACHT-AI-MODULECONTEXT.md) en
> [`decisions/0151`](./decisions/0151-ai-modulecontext-module-scope.md).
> **Datum**: 2026-08-09
> **Scope**: de AI-assistent in de context van een specifieke module bevraagbaar maken —
> concreet de **risicomatrix** (vragen over de risico's van het fonds, met de mogelijkheid
> in te zoomen op één risico) en **processen** (vragen over de scope en gekoppelde stukken
> van een dossier).
> **Doel**: vastleggen *wat en waarom*, zodat de bouw de bestaande bouwstenen specialiseert
> in plaats van een nieuw mechanisme te introduceren. Bron van waarheid blijft de code +
> `supabase/migrations/`; dit document beschrijft de ontwerpkeuze.
> **Verwant**: [`WERKOPDRACHT-AI-CONTEXTBESEF.md`](./WERKOPDRACHT-AI-CONTEXTBESEF.md) (persoonlijke
> portaalstand) en [`AI-STARTPUNT-ONTWERP.md`](./AI-STARTPUNT-ONTWERP.md) (taakgerichte instap).
> Deze drie delen hetzelfde principe: de assistent context meegeven zónder de heuristische
> classificatie of de toon-systeemprompt te raken.

---

## 0. Verificatie tegen de code (09-08-2026) — twee correcties

Bij de uitwerking is het ontwerp tegen de migraties gelegd (CLAUDE.md: de code wint). Twee
aannames uit een eerdere ontwerpversie klopten niet:

1. **Er is geen `archief`-DB-view.** Gesloten risico's zijn puur `risicos.status = 'gesloten'`
   (met `gesloten_op`, `gesloten_door`, `sluit_motivering`). "Archief" is alleen een UI-route
   (`risicomatrix/archief/`). Het risico-blok filtert dus rechtstreeks op `status`.
2. **`risico_log.event_type` kent meerdere waarden.** De schrijfpaden loggen `risico_gewijzigd`
   (payload `{velden, veld_labels, diff:{veld:{oud,nieuw}}, motivering, raakt_weging}`),
   `risico_gesloten` (`{motivering}`), `risico_aangemaakt` en `maatregel_*`. De **seed-data**
   (`2026_04_29_risicomatrix.sql`) draagt daarnaast het legacy-event `niveau_gewijzigd` met
   payload `{van, naar, motivering}`. Het blok leest **beide vormen**, anders mist juist de
   demo de "waarom stond dit op hoog"-regel.

## 1. Probleemstelling

De AI-assistent kent vandaag drie contextniveaus: fondsbreed (het `modulesBlok` met actieve
risico's en lopende procedures), documentgericht (de `document_scope`) en persoonlijk (de
portaalstand uit contextbesef). Wat ontbreekt is **objectcontext**: een vraag die gaat over
het object waar de bestuurder op dat moment naar kijkt.

Twee concrete gevallen uit de praktijk:

- In de **risicomatrix** wil een bestuurder vragen *"welke risico's speelden er eerder rond
  dit thema, en waarom is de weging in de loop van de tijd verschoven?"* en, als vervolg,
  inzoomen op één risico: *"hoe weeg je zelf dit risico?"*.
- Bij een **geopend proces** wil hij vragen *"wat is de scope van dit dossier en welke stukken
  zijn eraan gekoppeld?"* — een vraag naar de reikwijdte en de bewijsstukken van één procedure.

Vandaag valt zo'n vraag terug op de fondsbrede context (te grof) of op een
verduidelijkingsvraag. De informatie staat wél in het portaal, maar het chatvenster weet niet
naar welk object de bestuurder kijkt.

## 2. Ontwerpprincipe — specialiseren, niet bouwen

De centrale keuze: **geen nieuw retrievalmechanisme.** In `app/api/chat/route.ts` bestaan al
twee bouwstenen die samen precies dit dekken.

**Bouwsteen A — het gestructureerde contextblok.** `haalModuleContextBlok` en
`bouwPortaalstandBlok` (`core/lib/portaalstand-blok.ts`) leveren onder RLS opgehaalde
databaserijen als *benoemde tekst* — geen genummerde bron — mét een gedragsinstructie die
meereist ín het blok. Doordat de instructie in het blok zit en niet in de systeemprompt, blijft
de op sha256 gepinde toon-systeemprompt (`generatie-kern.sanity.ts`) byte-identiek. Dit is de
juiste vorm voor gestructureerde data zoals risicohistorie.

**Bouwsteen B — de `document_scope`.** Het contract waarmee de client een documentset
meestuurt, die de server onder RLS valideert (`valideerScope`, `core/lib/document-scope.ts`),
waarna de retrieval ertoe beperkt wordt en de scope in `governance_log.retrieval_meta.scope`
wordt vastgelegd. Belangrijk neveneffect: een actieve scope **zet de intent-heuristiek uit**
(`scopeActief → bronIntentResultaat = null`) — geen terugvraag, geen gok. Dit is de juiste
vorm voor de documentkant van een procesvraag.

De twee wensen vallen langs deze bouwstenen uiteen: risicohistorie is *gestructureerde data*
(A), een procesvraag is een *hybride* (A voor scope/fase + B voor de gekoppelde stukken).

## 3. Het scope-contract: `module_scope` (drie soorten)

Het huidige `document_scope`-contract wordt aangevuld met een **`module_scope`** dat de client
meestuurt en de server onder RLS resolveert:

```ts
module_scope?:
  | { soort: "proces";       procedure_id: string }   // knop in het procesdossier
  | { soort: "risicomatrix" }                          // knop op de risicomatrix — enige risico-ingang
  | { soort: "risico";       risico_id: string }       // in-chat verdieping, geen eigen ingang
```

Discipline (identiek aan `document_scope`): de client stuurt **alleen de sleutel**
(`procedure_id` / `risico_id`), nooit documenten, titels of blok-tekst. Alle inhoud resolveert
de server onder RLS op de sessie; een id dat niet bij het fonds hoort valt weg door RLS en wordt
**geweigerd — nooit een stille terugval** naar fondsbrede data. Net als een actieve
`document_scope` schakelt een geldige, actieve `module_scope` de intent-heuristiek uit (de
scope is expliciet, dus de assistent hoeft niet te *raden* in welke module de gebruiker zit).
Dat houdt de classificatie zuiver en reproduceerbaar — precies de reden waarom die heuristiek
geen LLM is.

**Weigering vs. legitiem leeg.** Een `procedure_id`/`risico_id` dat onder RLS niets oplevert =
weigering (400, gesaneerde melding; cross-tenant of verwijderd). De `risicomatrix`-soort kent
geen id en is er altijd; heeft een fonds geen risico's, dan draagt het blok een expliciete
"geen geregistreerde risico's"-regel — dat is legitiem leeg, geen weigering.

## 4. Risico — matrixbreed met in-chat verdieping

*"Welke risico's speelden er en waarom is de weging veranderd"* is geen documentvraag maar een
query op `risicos` + `risico_log`. Twee blokvarianten, één builder-familie:

- **`risicomatrix` (breed, compact — de instapbreedte).** Alle risico's van het fonds, per
  thema gegroepeerd (de vier `categorie`-slugs uit `risico-config.ts` als koppen): actieve
  risico's compact, gesloten risico's als één-regel-samenvatting (titel, laatste niveau,
  `sluit_motivering`), plus de **N recentste** weegveld-/sluit-regels uit `risico_log`
  fondsbreed. Bewust begrensd (voorstel N=15) — goedkoop genoeg om elke beurt mee te sturen.
- **`risico` (verdieping — de vervolgvraag).** Eén risico met de **volledige** `risico_log`-
  historie (elke kans/impact/niveau-wijziging met motivering, actor, datum), de sluit-motivering
  en de maatregelen. Dit blok draagt een vraag als *"waarom stond dit vorig kwartaal op hoog?"*.

Beide zijn benoemde tekst, geen genummerde bron; geen RAG, geen `document_scope`. De
gedragsinstructie reist mee in het blok.

**De weging-nuance (human-in-the-loop).** Bij *"hoe weeg je zelf dit risico?"* mag het model
geen eigen weging als besluit uitspreken. De instructie stuurt op spiegelen: geregistreerde
kans/impact/niveau + de motiveringen achter eerdere verschuivingen benoemen, overwegingen en
open punten signaleren — de weging blijft aan het bestuur. Ontbreekt een motivering, dan zegt
het model dat, in plaats van er een te veronderstellen.

**Grens "eerder/opgetreden" (besluitpunt 3).** "Eerder" = gesloten risico's + de logboek-
motiveringen. *Opgetreden incidenten* kent het datamodel niet; het blok benoemt die grens
letterlijk ("uitsluitend geregistreerde risico's… incidenten staan er niet in"), zodat de
assistent geen historie suggereert die er niet is (schijnzekerheid, `CLAUDE.md`).

## 5. Proces — hybride: contextblok + documentscope

Een proces heeft twee soorten context, beide aanwezig in het datamodel (`decision.ts`,
`proces-templates.ts`):

- **Scope/reikwijdte** — de centrale besluitvraag + `scope`/`aanleiding` + classificatie-
  dimensies (complexiteit, risiconiveau, mandaat-/toezichtgevoelig, beleidsafwijking,
  ai_risicoklasse) van het gekoppelde Decision Object (`procedures.decision_id`), plus de
  huidige stap (`procedure_stappen`, de `status='actief'`) en de openstaande
  `procedure_requirements`. Dit gaat mee als gestructureerd blok (bouwsteen A).
- **Gekoppelde documenten** — de bewijsstukken per stap (`procedure_bewijs`:
  `stap_id, document_id, titel, documenttype`). De server leidt hun `document_id`'s zélf af en
  vult daarmee de bestaande `scopeDocumentIds` (bouwsteen B), zodat de bestaande RAG (FTS +
  hybride pgvector + reranker + parent-retrieval) over precies die stukken loopt. De
  client-`document_scope` wordt bij een proces-scope genegeerd.

Zo krijgt de bestuurder een antwoord dat de reikwijdte benoemt (uit het blok) én de inhoud van
de stukken kan raadplegen (`[Bron N]`). Heeft een proces geen gekoppelde stukken, dan verschijnt
een expliciete bronbasis-melding (steunt op de dossiergegevens + algemene kennis) — nooit een
stille terugval naar de hele bibliotheek.

## 6. Instap en placement

De instap volgt het precedent van `/ai?doc=…` / `/ai?agendapunt=…` (sinds besluit 0201
gebundeld in `core/lib/assistent-url-ingang.ts`; voorheen `AssistentClient.tsx`
leest de URL-parameter bij mount en zet de scope-state, die per beurt in de body meereist):

- **Proces** — knop op het niveau van een **geopend proces** (`procedures/[id]/page.tsx`), als
  primaire actie in `DecisionObjectHeader.tsx` of `DossierStatusStrip.tsx` → `/ai?proces=<id>`.
  **Niet** op de lijst (`procedures/page.tsx`): daar is geen dossierscope; een AI-vraag daar
  hoort terug te vallen op het bestaande fondsbrede `modulesBlok`.
- **Risicomatrix** — één knop op **`risicomatrix/page.tsx`** ("Bespreek de risicomatrix") →
  `/ai?risicomatrix=1`, altijd met de volledige matrix-scope. **Enige risico-ingang.** Geen
  per-categorie-knop in `Heatmap.tsx`, geen aparte deep-link op `risicomatrix/[id]`.
- **Verdieping** — inzoomen op één risico gebeurt **in de chat**: de risico's-in-scope staan
  als chips onder het invoerveld; "verdiep dit risico" zet vanaf de volgende beurt
  `{ soort: "risico", risico_id }` (body-niveau, geen URL-ingang). Terug naar de brede blik met
  dezelfde chips.

**Zichtbaarheid.** De scope is zichtbaar als scope: een chip ("Proces: «…»" / "Risicomatrix" /
"Risico: «…»") en een aparte aanduiding in het onderbouwingspaneel, onderscheiden van
documentbronnen — de transparantielijn van besluit 0071, gelijk aan de "portaalstand"-aanduiding.

## 7. Besluiten (belegd 2026-08-09)

1. **Uitrouteren naar `/ai` mét scope** (niet inline). Volle chat-ervaring + onderbouwingspaneel,
   geen tweede chat-implementatie; consistent met `?doc=`/`?agendapunt=`. `AIValidatieBlok`
   blijft voor de validatie in het dossier. Restrisico "bestuurder wil in context blijven" als
   openstaand punt (kort toetsen).
2. **Procesgranulariteit: procesniveau (MVP).** Bewijsstukken hangen per `stap_id`; procesniveau
   aggregeert. Stapniveau is een vervolg op hetzelfde contract.
3. **"Eerder/opgetreden" = gesloten risico's + `risico_log`-motiveringen**, geen incidenten. De
   grens staat letterlijk in het blok. Eigenaar van de grensbewaking: compliance/opdrachtgever
   (openstaand punt).
4. **Risico-scope = matrixbreed, met in-chat verdieping naar één risico.** Enige ingang vanaf de
   risicomatrix; het individuele risico is een verfijning binnen het gesprek, geen tweede
   instappunt (bevestigd 2026-08-09).
5. **Bij tegenspraak niets stilzwijgend kiezen** — modulestand én genotuleerd besluit/document
   expliciet benoemen, identiek aan `PORTAALSTAND_INSTRUCTIE` en contextbesef-besluitpunt 2.

## 8. Guardrails

- **RLS per `fonds_id`** — scope server-side geresolveerd onder RLS, nooit uit de body vertrouwd;
  cross-tenant-weigering aantoonbaar (§15-suite).
- **Human-in-the-loop** — de instructie in het blok stuurt op signaleren ("dit speelde eerder /
  dit staat open / dit is de motivering geweest"), nooit op een besluit of opdracht. Bij de
  weging-vraag: spiegelen, niet zelf wegen. Zwaarst wegend punt hier.
- **Append-only audit** — elke modulescope-beurt logt in `retrieval_meta` (scope-soort,
  id/thema, gebruikte bronnen, validatiestatus); het antwoord blijft reconstrueerbaar.
  `risico_log` en het procedure-log blijven ongemoeid (alleen gelézen).
- **Geen schijnzekerheid** — zie besluit 3.
- **Toon-systeemprompt byte-identiek** — alle instructies reizen mee in de contextblokken;
  sha256-pin ongewijzigd.
- **Kosten/ruis** — een modulescope is alleen actief bij een expliciete instap. Het brede
  risico-blok en de historie worden begrensd (N=15) en de prompt-tokens/tijd-tot-eerste-token
  worden per soort gemeten (criterium 11); verslechtering expliciet melden.

## 9. Verwachte impact op datamodel

**Geen nieuwe tabel of kolom.** De benodigde data bestaat: `risicos`, `risico_log`,
`procedures` (+ `decision_id`), `decision_objects`, `procedure_stappen`,
`procedure_requirements`, `procedure_bewijs`, `documenten`, `document_chunks`. Blijkt tijdens de
bouw tóch een migratie nodig, dan is dat een signaal dat de scope verkeerd is begrepen: stoppen
en voorleggen (en dan gelden de structurele gates en de migratie-eerst-dan-deploy-volgorde).

## 10. Meetopzet (criterium 11)

De route logt al `input_tokens` (incl. cache) en `duur_model_ms`/`generatieDuurMs` in
`retrieval_meta`. Toevoegen: een `module_scope`-subobject `{soort, id, validatie, bron_ids,
blok_tekens}` en een **TTFT-timestamp** (`generatieStart` → eerste `content_block_delta`).
`audit-meta.ts` classificeert `module_scope.procedure_id/risico_id/bron_ids` als **`bron`**
(identiteit), een titel als **`inhoud`** (spiegel van de bestaande `scope`-classificatie).
Voor/na-meting: representatieve vragen per soort, mét en zónder scope, TTFT + prompt-tokens in
een tabel. N=15 (historie) is de eerste begrenzingsknop als de meting tegenvalt.

## 11. Referenties

- Code: `app/api/chat/route.ts` (`haalModuleContextBlok`, `document_scope`, `scopeActief`);
  `core/lib/document-scope.ts`; `core/lib/portaalstand-blok.ts`; `core/lib/module-scope.ts` (nieuw);
  `core/lib/risico-config.ts`; `core/lib/risico-wijziging.ts`; `core/lib/decision.ts`;
  `core/lib/proces-templates.ts`; `core/lib/vraagtype.ts`; `core/lib/audit-meta.ts`.
- API: `app/api/risicos/[id]/route.ts` en `.../sluiten/route.ts` (schrijven naar `risico_log`).
- UI: `app/(dashboard)/procedures/[id]/` (o.a. `DecisionObjectHeader`, `DossierStatusStrip`);
  `app/(dashboard)/risicomatrix/` (`page.tsx`, `Heatmap.tsx`, `[id]/page.tsx`, `archief/`);
  `core/lib/assistent-url-ingang.ts` (de instap, sinds besluit 0201) +
  `app/(dashboard)/ai/_components/DocumentDoorgronden.tsx`.
- Ontwerp/besluiten: `AI-STARTPUNT-ONTWERP.md`, `WERKOPDRACHT-AI-CONTEXTBESEF.md`; besluit 0071
  (bronherkenbaarheid), besluit 0145 (risico-logboek), **besluit 0151** (de `module_scope`-soort).
- Uitvoering: `WERKOPDRACHT-AI-MODULECONTEXT.md`.

## 12. Openstaande punten

Op te nemen in `00 Overzicht en status/openstaande-punten-en-risicos.md`, mét eigenaar:
besluit 3 (definitie eerder/opgetreden — compliance/opdrachtgever), besluit 1 (uitrouteren vs.
inline — te toetsen bij gebruikers), en de kosten/ruis-afweging van het brede risico-blok +
verdiepingsblok (tokenmeting vóór vastzetten; N=15 als eerste knop).
