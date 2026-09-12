# #368 T2-4 — planreview, census en karakterisering

**Basis:** `origin/preview` op `afd0efb45583`

**Tranche:** inventarisatie en karakterisering; nog geen productiecode

**Besluit:** GO voor deze test-/documentatietranche; definitieve wiring blijft een afzonderlijke
productietranche. De contracten uit #367, #369 en #370 staan inmiddels in deze basis.

## 1. Huidige census

De bestaande transitieve antwoordpadscan bereikt 126 bestanden en 46 unieke geclassificeerde
`bestand::tabel`-lezingen: 8 evidence, 26 modelcontext, 11 configuratie en 3 audit (48
klassetoewijzingen, doordat twee lezingen in meer dan één klasse vallen). Drie evidencelezingen
zitten in de centrale retrievalimplementatie: twee in `core/lib/rag.ts` en de door #367
toegevoegde versieherlezing in `core/lib/retrieval/supabase-versie.ts`. De overige **vijf**
omzeilen de volledige centrale retrievalketen. Die vijf logische lezingen bestaan samen uit
zeven fysieke query-expressies, omdat `app/api/chat/route.ts::document_chunks` op drie plekken
chunkpresentie controleert.

| Lezing buiten kern | Functie | Belangrijkste huidige grens | Open contractgat |
|---|---|---|---|
| `app/api/chat/route.ts::decision_objects` | Procesblok | RLS + server-gevalideerde procedure; `maybeSingle()` | Geen centrale identiteit, versie, citatie, deadline of toelatingsaudit |
| `app/api/chat/route.ts::document_chunks` | Chunkpresentie voor naam/scope/procesbewijs | Alleen `document_id`; limieten 1/2000/2000 | Geen typed presentiestatus, versie, afkapmelding of genormaliseerde fout |
| `core/lib/besluitvorming-bron.ts::decision_objects` | Formele besluitbron | Top drie proces-id's, statusallowlist, RLS | Eigen citaatvorming; geen harde rij-/tekengrens of versiebewijs |
| `core/lib/parent-context.ts::document_chunks` | Sibling-/parentpassage | RLS, fondsdiscipline, één globale fetchclamp van `documentaantal × 1.500` tussen 5.000 en 20.000, tekencaps en AbortSignal | Siblingpassage heeft geen eigen versie-identiteit/audit |
| `core/lib/vergelijk-productie.ts::semantic_units` | Deterministische vergelijking | Body-UUID-vormcontrole, id-only bestaanstoets onder RLS, capability `vergelijk.use` en het samengestelde AbortSignal uit #369 | De direct gelezen units hebben geen eigen limiet, versie, centrale citatie of toelatingsspoor; niet-afbrekingsfout valt stil naar LLM-pad |

Het machineleesbare register
`tests/cross-tenant/retrieval-t2-4-census.expected.json` legt voor elke lezing doel, scope,
rechten, PII, limieten, versie, citatie, audit, timeout, foutgedrag en migratieafhankelijkheid vast.
De gate maakt nieuwe of verdwenen fysieke queries en wijzigingen in de vastgelegde
call-sitefragmenten rood. Hij parseert daarvoor per bestand en tabel de fysieke
`.from("…")`-queryexpressies: de vijf logische lezingen bevatten exact zeven fysieke queries,
waarvan drie voor chunkpresentie in de chatroute. Een vierde `document_chunks`-query maakt de
negatieve controle aantoonbaar rood. Andere wijzigingen binnen een bestaande queryketen blijven
onderdeel van de handmatige planreview; de gate pretendeert die niet volledig semantisch te duiden.

## 2. Planreview

### Tranche A — deze branch

1. Bevries exact de vijf evidencelezingen buiten `rag.ts`/`core/lib/retrieval/` en de drie
   chunkpresentie-call-sites.
2. Leg per lezing alle acceptatiedimensies vast zonder bestaand gedrag als garantie te presenteren.
3. Pin het overige modelcontextoppervlak op 26 lezingen.
4. Wijzig geen productiecode en geen bestaande golden.

### Tranche B — afzonderlijke productie-implementatie

1. Hergebruik de gemergde versie-/correlatie-identiteit uit #367 en de route-orkestratie uit #369;
   introduceer geen parallel contract.
2. Migreer besluitobjecten en semantic units als citeerbare evidence door het providerneutrale
   contract; gebruik centrale toelating, citatie, audit en werkelijke contextgrenzen.
3. Maak chunkpresentie een typed preflight zonder inhoudslezing en met expliciete afkap-/foutstatus.
4. Houd parentverrijking als adapterhook, maar laat siblingidentiteit en versie aan het contract
   deelnemen.
5. Introduceer afzonderlijk een typed contract voor de 26 niet-retrieval-modelcontextlezingen:
   server-afgeleide scope, toegestane velden, PII-classificatie, gerenderd tekenbudget, deadline,
   foutcategorie en gescheiden audit.
6. Verwijder `chunksVoor()` pas wanneer census en callgraph nul goedgekeurde consumenten tonen.

## 3. Conflict- en veiligheidsgrenzen

- De gemergde #369-omzetting van `/zoeken` en `/vergelijk` blijft ongemoeid; deze tranche wijzigt
  geen gedeelde routewiring.
- De gemergde #367-identiteiten en `correlationId` zijn leidend; #368 introduceert geen
  concurrerende identiteitstypen.
- De gemergde #370-fixture blijft hermetisch en mag nooit bron zijn van productiecontext.
- Geen client-supplied fonds-, bron-, vergadering-, proces- of providerkeuze wordt vertrouwd.
- Inhoudelijke audit en het vaste operationele spoor blijven gescheiden.

## 4. Acceptatie van deze eerste tranche

- Exact vijf evidencelezingen buiten de kern en 26 modelcontextlezingen zijn gepind.
- Alle vijf hebben een expliciete matrix voor scope, rechten, PII, limiet, versie, citatie, audit,
  timeout en foutgedrag.
- Een nieuwe of verdwenen fysieke query, een wijziging in een gepind call-sitefragment of een
  censuswijziging maakt de test rood; overige querysemantiek blijft handmatig te reviewen.
- Geen productiecode, migratie of bestaande snapshot wordt aangepast.
