# 0138 — Voortgangsteller toont betekenis i.p.v. een constante; rerankfase samengevoegd (addendum op 0087)

- **Status:** Geaccepteerd (implementatie) — tabel-A-fixture vastgelegd (2026-08-06, demofonds Horizon); `npm run sanity` volledig groen
- **Datum:** 2026-08-06
- **Betrokkenen:** opdrachtgever (Merlin IJzerman), Claude (analyse + uitvoering)

## Context

**Addendum op [`0087`](./0087-ai-voortgang-zichtbaar-foutcontract-en-niet-gelogd.md).** De bestuurder zag bij elke
vraag *"Fondsdocumenten worden doorzocht — 30 passages gevonden"*. Dat getal **kan niet
variëren**: `CHUNK_BUDGET = 10` → `overFetch = max(10·3, 20) = 30` → `p_limit` → de RPC
levert er precies 30 → `res.meta.opgehaald` → `retrievalUitkomst`. Het is een ophaal-
plafond dat als meting werd gepresenteerd (hooguit verlaagd door fondsdiscipline-drops).
Verzwarend: de enige regel die wél zou variëren — `rerankUitkomst(res.meta.geselecteerd)`
— stond achter `if (retrievalVlaggen.rerank)`, en die vlag staat default uit. De enige
teller die de bestuurder zag, mat dus niets.

`0087` beschreef de bedoeling als "aantallen doorzochte en relevante passages".
Geïmplementeerd was alleen het eerste, en dat eerste was een constante.

## Besluit

**Eén betekenisvolle retrieval-regel:** *"uit N documenten — M passages geselecteerd"*,
met N = het aantal **unieke documenten**
(`new Set(res.meta.chunks.map(c => c.document_id)).size`) en M = het aantal
**daadwerkelijk geselecteerde** passages (`res.meta.geselecteerd`). Beide zijn al
aanwezig — geen nieuwe data, geen extra query.

**De rerankfase wordt samengevoegd in de retrievalfase** (dit is de reden voor het
0087-addendum: de aparte zichtbare rerankstap was daar een expliciet deelbesluit). De
reranker zelf blijft ongewijzigd draaien; alleen de aparte, van-een-default-uit-vlag-
afhankelijke voortgangsregel vervalt. De ene retrieval-regel klopt in **beide** standen:
met rerank aan is `geselecteerd` het aantal ná de drempel, met rerank uit het aantal ná
weging/selectie. `VoortgangFase` verliest de waarde `rerank`; `retrievalUitkomst` gaat
van `(opgehaald)` naar `(documenten, geselecteerd, opties?)`; `rerankUitkomst` vervalt.

**M5-haakje:** `retrievalUitkomst` accepteert `{ ftsArmLeeg }` en toont dan
"· lexicale zoekarm leeg" — zodat een beurt waarin de lexicale arm niets opleverde
zichtbaar is. De meta-bedrading hiervan hoort bij M5 (nog niet gebouwd); de formatter is
er klaar voor.

## Besluitpunt 1 — één regel i.p.v. twee die van een vlag afhangen

Twee regels (retrieval + rerank) waarvan er één alleen bij `rerank=on` verschijnt, geeft
inconsistente voortgang tussen fondsen en standen. Eén afgeronde regel die altijd klopt
is eerlijker dan een tweede regel die soms een constante en soms een meting is.

## Besluitpunt 2 — consistentie met het onderbouwingspaneel

`res.meta.geselecteerd` en `res.meta.chunks` worden samen uit dezelfde `na.chunks`
opgebouwd (mét of zónder parent-retrieval, afhankelijk van die vlag), dus onderling
consistent. `AntwoordWeergave.tsx` toont per document `· {bronnummers.length} passages`;
de voortgangs-M strookt met de som daarvan zolang parent-retrieval uit staat (default).
Wijkt het bewust af (parent-verrijking telt in het paneel wél mee), dan is dat in de
labeling zichtbaar — twee getallen die elkaar tegenspreken is erger dan één dat niets
zegt.

## Gevolgen

- **Code:** `core/lib/voortgang.ts` (`VoortgangFase` zonder `rerank`, nieuwe
  `retrievalUitkomst`-signatuur + `RetrievalUitkomstOpties`, `rerankUitkomst` verwijderd,
  `VoortgangVlaggen.rerankActief` verwijderd), `app/api/chat/route.ts` (unieke-documenten-
  telling, betekenisvolle retrieval-`klaar`-uitkomst, aparte rerank-`progress` verwijderd),
  `core/lib/voortgang.sanity.ts` (formatter-tests + B2-fixture-test).
- **Client ongewijzigd:** `Voortgang.tsx`/`pasVoortgangToe` zijn generiek over
  `fase: string` en renderen wat binnenkomt; het samenvoegen is puur server-side. De
  reranker-**feature-flag** (`fonds-config.ts`, `audit-meta.ts`) blijft ongemoeid.
- **B2-regressietest (acceptatiecriterium):** `voortgang.sanity.ts` toetst niet alleen de
  formattering maar ook dat de regel over de tien tabel-A-vragen **varieert** — op een
  vastgelegde fixture van echte retrieval-uitkomsten (`voortgang-tabel-a.fixture.json`).
  De test faalt zodra de teller over de vragen dezelfde waarde geeft. De fixture is via
  de draaiende app vastgelegd (de retrieval-keten leunt op de Next-request-context
  `createServerSupabase → cookies` en kan niet standalone draaien): **8 unieke regels
  over de 10 tabel-A-vragen** op het demofonds Horizon (o.a. "uit 1 document — 1 passage",
  "uit 7 documenten — 10 passages"). Consistentie bevestigd in de UI: de retrieval-M
  strookt met het aantal passages in het onderbouwingspaneel.
- **Geen migratie, geen RLS-/schema-/audit-wijziging.** `tsc --noEmit --skipLibCheck`
  exit 0. `npm run sanity` volledig groen.

## Openstaand

- **Fixture-onderhoud:** herbevestig `voortgang-tabel-a.fixture.json` na een substantiële
  wijziging aan retrieval/`CHUNK_BUDGET`/indexering (de fixture kan verouderen t.o.v. de
  live index — aanvaard als regressievangnet, geen live meting). Eigenaar: Ontwikkeling.
- **M5-bedrading `ftsArmLeeg`** (lexicale arm leeg → meta-veld) — bij M5.

## Referenties

- Code: zie Gevolgen. Werkopdracht: `WERKOPDRACHT-RETRIEVAL-RECALL.md` (tabel A, M6).
- Besluit: [`0087`](./0087-ai-voortgang-zichtbaar-foutcontract-en-niet-gelogd.md) (**dit besluit is een addendum**:
  de aparte zichtbare rerankfase wordt samengevoegd in de retrievalfase).
- Ontwerp: `AI-WEERGAVE-ONTWERP.md` (de voortgangsregels).
