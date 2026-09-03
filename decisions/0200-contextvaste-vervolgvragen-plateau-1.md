# 0200 — Contextvaste vervolgvragen: één vroege effectieve vraag (plateau 1)

- **Status:** Geaccepteerd
- **Datum:** 2026-09-01
- **Betrokkenen:** productowner (bestuurdersportaal), Claude Code

## Context

Binnen één zichtbaar chatgesprek verloor een onderwerp-arme vervolgvraag ("Breng het wettelijke
kader in kaart.") zijn onderwerp: retrieval én de classificatie-/routeringsketen keken alleen naar
de losse zin. De history-aware reformulatie (`core/lib/query-reformulatie.ts`) ving dit niet — zij
vuurde alleen op expliciete openers/anaforen, draaide laat en stuurde uitsluitend de retrieval-query,
terwijl bronintentie, vraagrouter, antwoordmodus, retrievalmodus, bronsoortprofiel, webprofiel en de
PII-gate op de ruwe vraag bleven werken. Randvoorwaarden: geen server-side gesprekstoestand of
DB-wijziging in dit plateau, append-only audit en reproduceerbaarheid intact, tenant-isolatie
ongemoeid, geen nieuwe (sub)verwerker, en de fijn afgestelde toon-systeemprompt onaangeraakt.

## Besluit

Voer één vroege, server-side contextresolutie uit die uit de actuele vraag + de al meegestuurde
historie één zelfstandige **effectieve vraag** afleidt; alle inhoudelijke downstream-beslissingen op
de normale informatiepaden gebruiken diezelfde effectieve vraag, achter een schakelaar
`CHATCONTEXT_RESOLVER ∈ off | observe | enforce` (fail-safe default `off`). De originele vraag blijft
leidend voor weergave, opslag, inhoudszegel en toon; elke mislukte/laag-vertrouwen/timeout-resolutie
valt veilig terug op de originele vraag.

## Overwogen alternatieven

- **Alleen de regex uitbreiden** (`hiervoor` c.s. toevoegen) — verworpen: verhelpt één formulering,
  laat impliciete opdrachten en de te late plaats van reformulatie bestaan, en voedt een groeiende
  domeinspecifieke lijst.
- **Deterministische classificatie zonder modelcall** — verworpen: onderwerp-armoede is juist niet
  betrouwbaar deterministisch te detecteren; dat is de kern van het defect.
- **Server-side historie reconstrueren op `gesprek_id`** — bewust uitgesteld naar plateau 2
  (vereist gesprekstoestand/DB); valt buiten dit plateau.

## Gevolgen

- **Downstream:** bronintentie, router (det + model), antwoordmodus, retrievalmodus, bronsoortprofiel
  (biblio + web), documentnaam-detectie, vergelijk-intent, analyseplan, portaalstand, schaduwtelling,
  retrieval + fusie en de generatieprompt gebruiken in `enforce` de effectieve vraag; de losse
  reformulatie is gesubsumeerd (`zoekVraag = effectieveVraag`). Speciale paden (reflectie/
  transformatie/stuk/doorgrond/scope/agendapunt/module/volledige-analyse) worden overgeslagen en
  houden de ruwe vraag. Additieve retrieval blijft (origineel als tweede zoekpoging).
- **Privacy:** de web-gate controleert PII fail-closed op zowel de originele als de effectieve vraag.
- **Audit (append-only, geen migratie/SQL-wijziging):** nieuw telemetrieblok `invoer.context`
  (basis) en de verwijderbare `invoer.context_kandidaat_vraag` (inhoud); de effectieve zoekvraag
  rijdt op het bestaande `zoekvraag`-veld. `invoer.geen_generatiecall` (basis-subsleutel, bewust
  ONDER `invoer` zodat de bestaande SQL-projectie ongewijzigd blijft) onderscheidt "geen
  antwoord-generatie" van top-level `geen_modelcall` ("geen enkele providercall"); `geen_modelcall`
  wordt afgeleid uit de expliciete runtimewaarde `modelAangeroepen`, en de semantiek van besluit
  0092 (en van `verduidelijking`) blijft ongewijzigd.
- **AI-actie-lifecycle:** alle vroege returns (bronintentie-verduidelijking, succesvolle vergelijking,
  niet-eenduidige vergelijking) sluiten de gereserveerde AI-actie nu expliciet af met hun log-id
  (besluit 0180); de niet-eenduidige vergelijking kreeg daarvoor een governance-logregel.
- **Kosten/latency:** +1 kleine `claude-sonnet-4-6`-call per niet-eerste beurt op een normaal pad
  (temp 0, echte abort-timeout ~3500 ms); off = 0 extra.
- **Geen schijnzekerheid:** `vertrouwen` is een technisch routersignaal, niet aan de bestuurder
  getoond; de resolver beslist niets inhoudelijks.
- **Bewust uitgesteld:** contextbehoud over refresh/tab/sessie/gesprek (plateau 2) en
  rechtsregime-afbakening (`PLAN-HARDE-REGIMEAFBAKENING-RAG`).

## Referenties

- Code: `core/lib/vraag-context.ts` (+ `.sanity.ts`), `app/api/chat/route.ts`,
  `core/lib/audit-meta.ts`, `core/lib/rag.ts` (`RetrievalMeta.invoer`),
  `tests/cross-tenant/vraag-context-route.test.ts`.
- Ontwerp: `AI-CHATCONTEXT-ONTWERP.md`.
- Eerdere besluiten: 0139 (reproduceerbare retrieval + additieve fusie), 0092 (modelcall-audit),
  0180 (één AI-actie per chatvraag), 0072 (web-retrieval-gate).
