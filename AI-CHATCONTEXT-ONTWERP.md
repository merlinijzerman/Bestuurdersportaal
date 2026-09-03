# AI-chatcontext — contextvaste vervolgvragen (plateau 1)

> Ontwerp-laag ("wat en waarom"). Bron van waarheid is de code: `core/lib/vraag-context.ts`,
> `app/api/chat/route.ts`, `core/lib/audit-meta.ts`. Zie ook `decisions/0200`.

## 1. Probleem

Binnen één zichtbaar chatgesprek verloor een vervolgvraag zijn onderwerp. Na
*"Wat betekent de solidariteitsreserve?"* werd *"Breng het wettelijke kader in kaart."*
verwerkt als een losse, onderwerp-arme vraag: retrieval én de routerings-/classificatieketen
keken alleen naar die tweede zin. De bestaande history-aware reformulatie
(`core/lib/query-reformulatie.ts`) ving dit niet: zij vuurde alleen op expliciete openers/anaforen
(`hiervoor` ontbrak zelfs), draaide laat, en stuurde uitsluitend de retrieval-zoekvraag — terwijl
bronintentie, vraagrouter, antwoordmodus, retrievalmodus, bronsoortprofiel, webprofiel en de
PII-gate de ruwe vraag bleven gebruiken.

## 2. Kernidee: originele vs. effectieve vraag

Er is één vroege, server-side contextresolutie die uit de actuele vraag + de al door de client
meegestuurde historie één **effectieve vraag** afleidt. Twee representaties, scherp gescheiden:

| | `origineleVraag` | `effectieveVraag` |
|---|---|---|
| Herkomst | letterlijke gebruikersinvoer | resolver-uitkomst (of == origineel) |
| Leidt | zichtbare chat, opslag (`p_vraag`), inhoudszegel/HMAC, conversational toon (`isOpsteltaak`) | bronintentie, vraagrouter (det + model), antwoordmodus, retrievalmodus, bronsoortprofiel, retrieval + fusie, webprofiel, schaduwtelling, generatieprompt |

Plateau 1 gebruikt **uitsluitend** de historie van hetzelfde request. Geen server-side
history-fetch, geen gesprekstoestand, geen nieuwe (sub)verwerker — dezelfde Anthropic-poort en
dezelfde reeds gereserveerde AI-actie als de bestaande reformulatie.

## 3. Resolver-contract (`core/lib/vraag-context.ts`)

Pure module (geen SDK-import; de modelcall wordt geïnjecteerd via `roepModelAan`, zoals
`query-reformulatie.ts`). `VraagContext` draagt o.a.: `origineleVraag`, `effectieveVraag`,
`kandidaatVraag`, `relatie` (`eerste_beurt | vervolg | nieuw_onderwerp | onduidelijk`), `onderwerp`,
`vertrouwen` (`hoog | middel | laag`), `historieGebruikt`, `afgedwongen`, `modelAangeroepen`,
`resolvermethode`, `fallbackReden?`, `meting?`.

- **Geen historie** → `eerste_beurt`, effectief == origineel, géén modelcall.
- **Speciaal pad** (`magResolveren = false`) → `overgeslagen`, géén modelcall.
- **Anders** → één modelcall op `REWRITE_MODEL` (`claude-sonnet-4-6`), temperatuur 0, strikt JSON
  `{ relatie, effectieveVraag, onderwerp, vertrouwen }`. Server dwingt ná parse af:
  - `nieuw_onderwerp` → effectief = origineel (nooit oud onderwerp plakken);
  - `laag` vertrouwen / `onduidelijk` → effectief = origineel (geen speculatieve context);
  - parse/leeg/timeout/poortweigering/fout → fallback naar origineel, `fallbackReden` gelogd.
  Alleen `vervolg` met hoog/middel vertrouwen laat de herschreven vraag downstream sturen.

**Timeout is een echte abort** (AbortController + `signal`, patroon van de map-stap), niet een
`Promise.race`: bij overschrijding (`CONTEXTRESOLVER_TIMEOUT_MS ≈ 3500 ms`) wordt de providercall
afgebroken en valt de resolver terug op de originele vraag.

**`modelAangeroepen`** is een expliciete runtimewaarde (niet afgeleid uit `resolvermethode`): true
zodra de providercall echt start. Een **poortweigering vóór de call** telt níet als modelcall; een
**timeout ná start** telt wél.

## 4. Feature flag

Eén server-side schakelaar `CHATCONTEXT_RESOLVER ∈ off | observe | enforce`, fail-safe default
`off` (pure `resolveChatcontextModus`, env-lezer apart — patroon `capability-enforce.ts`):

- **off** — resolver draait niet; **byte-identiek** aan het huidige gedrag.
- **observe** — resolver draait en logt (incl. de voorgestelde kandidaatvraag), maar downstream
  stuurt op de originele vraag. **Gedragsmatig niet-afdwingend, niet byte-identiek:** dezelfde
  downstream-beslissingen en antwoordinhoud, maar wél een extra resolver-modelcall, extra
  latency/kosten en extra auditmetadata (`invoer.context` + `invoer.context_kandidaat_vraag`).
- **enforce** — de effectieve vraag stuurt de §5-paden.

Geen UI-instelling, geen DB-config in plateau 1.

## 5. Skip / consume-beleid

De resolver draait vroeg (ná rate-limit/fonds/host/module/preflight en de agendapunt-seed, vóór
documentnaam-detectie en bronintentie). Hij wordt **overgeslagen** op paden met een eigen contract:
reflectie(-vervolg), transformatie, stukvoorbereiding, doorgronden met secties, agendapunt-modus,
expliciete document-scope, module-scope, en volledige-analyse-vervolg.

`effectieveVraag` wordt **alleen** op de normale-informatie-callsites gesubstitueerd
(bronintentie, vergelijk-intent, vraagtype, router det+model, analyseplan, antwoordmodus,
retrievalmodus, bronsoortprofiel biblio+web, portaalstand, schaduwtelling, retrieval, prompts). De
reflectie/transformatie/doorgrond/scope-takken houden bewust de ruwe `vraag`/`vraagVoorPrompt`, dus
een enkele laat-bekende speciale beurt kan door een stray resolver-call nooit worden gecorrumpeerd.

**Additieve retrieval:** als `effectief !== origineel` gaat de originele vraag als tweede
zoekpoging mee (bestaand fusiepatroon, besluit 0139 M-R3) — context voegt recall toe, verwijdert de
originele zoekvraag nooit stil. De vroege resolver **subsumeert** de losse reformulatie: in enforce
wordt `zoekVraag = effectieveVraag` en draait de oude reformulatiecall niet meer.

**Generatieprompt** krijgt op de normale takken bij een echte vervolgvraag *beide* representaties:
`ORIGINELE VRAAG VAN DE GEBRUIKER: …` én `ZELFSTANDIGE INTERPRETATIE VOOR CONTEXT EN BRONSELECTIE: …`,
zodat toon en formulering van de bestuurder behouden blijven. De toon-systeemprompt is ongewijzigd.

## 6. Privacy (PII) — fail-closed op beide vormen

De web-retrieval-gate controleert `bevatPersoonsgegevens` op **zowel** de originele als de effectieve
vraag; bevat één van beide PII, dan wordt live web-retrieval geblokkeerd. Een contextresolutie kan
een persoonsgegeven uit de originele vraag dus nooit wegpoetsen. In off/observe is `effectief ==
origineel`, dus daar is dit een no-op.

## 7. Audit en logging (append-only, migratievrij)

- De effectieve zoekvraag is al auditbaar via het bestaande `zoekvraag`-veld (in enforce = de
  effectieve vraag) — geen tweede kopie van de vraag, geen historie-duplicatie.
- Nieuw telemetrieblok `invoer.context` (basis): `modus`, `relatie`, `vertrouwen`,
  `historie_gebruikt`, `resolvermethode`, `afgedwongen`, `model_aangeroepen`, en meetmetadata
  (`model`, `duur_ms`, `tokens_in/out`, `timeout`, `fallback_reden`). Geen letterlijke vraagtekst.
- De door de resolver voorgestelde vraag gaat naar de **verwijderbare** inhoudssleutel
  `invoer.context_kandidaat_vraag` (`audit-meta.ts` `SUB_NIVEAUS.invoer.inhoud`). Zo is in observe
  zichtbaar wat de resolver voorstelde, zonder het als blijvende basismetadata op te slaan.
- **Modelcall-semantiek.** `geen_modelcall` betekent "geen enkele providercall in deze interactie".
  Draaide de resolver wél een call op een deterministische verduidelijkings-/vergelijkingsreturn,
  dan is `geen_modelcall` **false**, wordt `REWRITE_MODEL` als gebruikt model geregistreerd, en legt
  `invoer.geen_generatiecall: true` afzonderlijk vast dat er geen antwoord-generatie was. Dit veld
  staat bewust ONDER `invoer` (basis-subsleutel), niet op top-niveau, zodat het via de bestaande
  SQL-projectie op basisniveau zichtbaar blijft zonder `meta_basisniveau()`/`meta_bronniveau()` te
  wijzigen. De semantiek van besluit 0092 (`geen_modelcall` = geen enkele providercall) is
  ongewijzigd; `verduidelijking` behoudt eveneens zijn betekenis.
- **Geen migratie, geen SQL-wijziging:** `invoer` is een bestaande, geclassificeerde gemengde
  JSONB-sleutel; `geen_generatiecall` en `context` zijn basis-subsleutels (blijven in het spoor),
  `context_kandidaat_vraag` de enige inhoud-subsleutel. Er is geen automatische TS↔SQL-parity-gate
  (geverifieerd), en de nieuwe subsleutels zijn een no-op op de lees-projecties van historische rijen.

## 8. AI-actie-lifecycle op de vroege returns

Omdat de resolver vóór de vroege returns kan draaien, sluiten **alle** betrokken paden de
gereserveerde AI-actie nu expliciet af (`rondAf`, besluit 0180) met de eigen governance-log-id:
de bronintentie-verduidelijking, de succesvolle vergelijking, én de niet-eenduidige
vergelijking (die daarvoor géén governance-logregel had en de actie in `pending` liet). Bij een
mislukte logregel wordt de actie als `mislukt` afgesloten — nooit blijft er een actie in `pending`.

## 9. Latency / kosten

- off: 0 extra calls.
- observe/enforce: +1 kleine `claude-sonnet-4-6`-call per niet-eerste beurt op een normaal pad
  (temp 0, ~120 out-tokens, ingekort transcript), ~300–800 ms, harde abort ~3500 ms. Speciale paden:
  geen extra call. Netto vs. de oude reformulatie: gelijk op reeds-reformulerende beurten, +1 op
  impliciete/zelfstandige normale vervolgbeurten — precies waar het defect zat.

## 10. Bewuste beperkingen (plateau 1)

Verbetert vervolgvragen alleen zolang de juiste historie in hetzelfde request wordt meegestuurd.
Geen garantie over refresh, nieuwe tab, browsersessie of apart gesprek — dat is plateau 2
(server-authoritatieve geschiedenis en expliciete gesprekstoestand op `gesprek_id`). Geen oplossing
voor rechtsregime-afbakening (PW/Wvb/SPR/FPR) — zie `PLAN-HARDE-REGIMEAFBAKENING-RAG`.
