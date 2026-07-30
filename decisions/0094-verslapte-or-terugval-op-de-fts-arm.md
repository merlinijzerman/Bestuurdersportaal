# 0094 — Verslapte OR-terugval op de Dutch-FTS-arm, vóór het ilike-vangnet

- **Status:** Geaccepteerd
- **Datum:** 2026-07-30
- **Betrokkenen:** Merlin (opdrachtgever), Claude (analyse + uitvoering)

## Context

Bij het onderzoek naar onvindbare conceptdocumenten wees het **auditspoor** de
werkelijke oorzaak aan. Voor de vraag *"documenten met beleggingsbeleid ken je?"*
stond in `governance_log.retrieval_meta`:

| modus | methode | opgehaald | geselecteerd | gekozen documenten |
|---|---|---|---|---|
| `alles` | **`ilike`** | 30 | 10 | Pensioenwet, Besluit uitvoering Pw, DNB-handreiking |

`methode: "ilike"` betekent dat **beide gerangschikte paden niets opleverden** en de
retrieval op het laatste vangnet uit de cascade landde. Dat vangnet:

- heeft **geen ranking** (`rang = null`) — de volgorde is willekeurig;
- is **uitgesloten van de reranker** (`rerankToegestaan = false`), dus R1.3 kan er
  per definitie niets verbeteren;
- levert treffers die onder R1.5 b1 **nooit citeerbaar** zijn (besluit 0073).

De oorzaak zit in de querybouw: `websearch_to_tsquery('dutch', …)` maakt van een
vraagzin een **AND-keten**. *"documenten met beleggingsbeleid ken je?"* eist dan
`documenten & beleggingsbeleid & ken` in één chunk. Poging 2 (`fts_plain`,
`textSearch … type: "plain"`) is eveneens AND en faalt om dezelfde reden. Een
compleet bestuursvoorstel over wijziging van het beleggingsbeleid wordt zo niet
gevonden, terwijl het losse woord *beleggingsbeleid* wél 8 chunks matcht (gemeten).

Dit raakt niet alleen conceptstukken: **elke** natuurlijk geformuleerde meerwoordsvraag
loopt dit risico, en belandt dan op een ongerangschikt vangnet zonder dat iemand het
merkt. Het verklaart ook waarom de eerdere hypotheses (statusfilter, bronsoortweging)
het gedrag maar gedeeltelijk verklaarden.

## Besluit

Tussen poging 1 (gerangschikte RPC, strikte AND) en de fallback-cascade komt
**poging 1b**: dezelfde gerangschikte RPC `zoek_chunks`, met een **verslapte
OR-query** opgebouwd uit de inhoudswoorden van de vraag
(`core/lib/fts-terugval.ts`, `bouwTerugvalFtsQuery`).

De strikte query blijft poging 1 — precisie waar precisie werkt. De terugval draait
**uitsluitend** wanneer streng zoeken nul rijen geeft: recall erbij zonder precisie
in te leveren waar die het al doet.

## Besluitpunt 1 — op het gerangschikte pad, niet als vierde vangnet

De terugval had ook ná het ilike-pad gekund. Bewust niet: het hele punt is dat de
vraag op het **gerangschikte** pad blijft, met `ts_rank_cd`-ordening, bronsoort-weging,
reranker (R1.3) en relevantie-ondergrens (R1.5). Een gerangschikte OR-set verslaat een
ongerangschikte substring-set — óók met R1.3/R1.5 uit, dus de winst is niet afhankelijk
van het activeringsbesluit 0073.

## Besluitpunt 2 — rerank draait op de ORIGINELE vraag

`naVerwerking` krijgt `vraag`, niet `terugval.query`. De OR-keten is een ophaalmiddel;
de vraag of een chunk relevant is, moet tegen de **werkelijke vraag** worden beoordeeld.
Dit is ook precies waar de reranker het meeste waard is: hij herstelt de precisie die de
verbreding kost.

## Besluitpunt 3 — grenzen van het lexicon

Gecureerd en klein gehouden: stopwoorden en vraagwoorden eruit, minimale woordlengte 4
met een uitzonderingenlijst voor korte domeintermen (`wet`, `wtp`, `abtn`, `dnb`, `afm`,
`vo`, `alm`, `esg`), maximaal 8 OR-termen tegen query-explosie, ontdubbeld. Woorden die
in dit domein juist onderscheidend zijn — *besluit*, *voorstel*, *beleid* — staan
nadrukkelijk **niet** in de stopwoordenlijst. Bij één overgebleven inhoudswoord wordt de
terugval overgeslagen: die query is identiek aan de strikte en zou een tweede RPC voor
niets kosten.

## Overwogen alternatieven

- **De strikte AND vervangen door OR.** Verworpen: dan verliest elke meerwoordsvraag
  zijn scherpte en wordt alles even relevant.
- **Query-reformulatie door een LLM.** Duurder (extra call in het kritieke pad),
  niet-deterministisch en daarmee slechter reproduceerbaar in het auditspoor. De
  bestaande history-aware reformulatie (Fase B1) draait al waar hij hoort.
- **Jargon-expansie uitbreiden (R1.4).** Die voegt synoniemen als OR toe áán de
  AND-keten; hij maakt de keten niet losser. Lost dit probleem dus niet op.
- **Alleen de reranker aanzetten (optie 1).** Zou hier niets doen: op het ilike-pad
  draait de reranker helemaal niet. Deze wijziging is de voorwaarde waaronder R1.3
  überhaupt effect kan hebben op dit soort vragen.

## Gevolgen

- Nieuw: `core/lib/fts-terugval.ts` (+ `.sanity.ts`, **9 tests**, o.a. de aanleidende
  vraag als regressiegeval).
- `core/lib/rag.ts`: poging 1b in `zoekViaFTS`; `methode` uitgebreid met
  `fts_dutch_terugval`; `RetrievalMeta.terugval` (termen, query, versie) voor het
  auditspoor. Het hybride pad profiteert automatisch: bij een lege RRF valt het al
  terug op `zoekViaFTS`.
- **Kosten:** maximaal één extra RPC-aanroep, en alleen in het geval waarin we nu al
  niets vonden. Geen extra embedding, geen extra modelcall.
- **Meetbaar:** `retrieval_meta.methode = "fts_dutch_terugval"` maakt zichtbaar hoe vaak
  de strikte query tekortschiet — een directe indicator voor de kwaliteit van de
  querybouw, en het aandeel `ilike` hoort navenant te dalen.
- **Risico:** een OR-keten haalt losser verband binnen. Tegenwicht: ts_rank_cd-ordening,
  bronsoort-weging, en — zodra 0073 wordt geactiveerd — reranker + relevantie-ondergrens.
  Zonder die twee is het nog steeds beter dan het ongerangschikte ilike-pad, maar de
  activering wint hierdoor wel aan urgentie.
- Geen migratie, geen RPC-, RLS- of schemawijziging. `tsc` exit 0.

## Openstaand (aanpalend, apart te beleggen)

Het log toont `methode: "ilike"` en geen `hybride_rrf`. Dat wijst erop dat **hybride
zoeken voor Horizon uit staat** (`fonds_feature_flags.hybride_zoeken` / env
`HYBRID_SEARCH`), en dus dat er in het geheel geen vectorarm meedoet. Te verifiëren; als
het klopt is dat een zwaarder kwaliteitspunt dan deze terugval en verdient het een eigen
besluit.

## Referenties

- Code: `core/lib/fts-terugval.ts`, `core/lib/rag.ts` (`zoekViaFTS`, `naVerwerking`).
- Bewijs: `governance_log.retrieval_meta` van 2026-07-30 16:41–16:42
  (`methode: "ilike"`, `opgehaald: 30`, uitsluitend generieke documenten geselecteerd).
- Besluiten: [`0073`](./0073-retrieval-reranker-haiku-en-gelijktijdige-activering.md)
  (R1.3–R1.6, ilike-treffers niet citeerbaar), [`0091`](./0091-expliciete-scopebepaling-en-voorstelvragen.md)
  en [`0092`](./0092-terugvraag-wordt-gelogd-en-bewaard.md) (zelfde onderzoekslijn).
