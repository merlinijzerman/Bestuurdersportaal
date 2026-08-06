# Werkopdracht: retrieval-recall herstellen — dode FTS-arm en meta-vraagranking

> Overdracht van plansessie (Cowork, 06-08-2026) naar Claude Code. Plak dit als eerste bericht in een Claude Code-sessie in de repo-root. Zie `decisions/0004` en `WERKOPDRACHT-TEMPLATE.md`.

---

## Doel & context

Een bestuurder vroeg op 06-08-2026 in het bestuurdersportaal wat het Pensioenreglement 2026 zegt over **pensioneren**. De assistent kreeg alleen de inhoudsopgave (p. 2), de inleiding (p. 3) en een hoofdstukkop (p. 58) aangeleverd en moest melden dat de tekst van hoofdstuk 5 "Als u met pensioen gaat" niet in de bronnen zat. Die tekst zat wél volledig en correct geïndexeerd in de database. **De retrieval heeft aanwezige, relevante, van kracht zijnde fondsinhoud niet gevonden.**

Dit is geen incident maar een reproduceerbare klasse: elke vraag waarvan het kernwoord morfologisch afwijkt van de reglementterm valt terug op vector-only retrieval, en vector-only rangschikt bij een "wat staat er over X"-vraag structureel meta-passages (inhoudsopgave, inleiding, koppen) boven normatieve tekst.

Voor een bestuurdersportaal is dit een governance-risico, geen alleen-maar-UX-probleem: de assistent presenteerde correct dát er iets ontbrak, maar een bestuurder die minder kritisch leest concludeert "het reglement zegt hier weinig over" terwijl het reglement zeven pagina's normatieve tekst bevat. Zie ook `mvp-beperkingen.md` en `AI-assistent - verbeterpunten notitie 2026-07-15.md`.

## Diagnose — wat feit is, wat weerlegd is

**Weerlegd (gemeten, niet aangenomen).** De ingest is foutloos. Document `52a0947a-b6ef-4e66-9843-4515e0b96c71` (Pensioenreglement 2026, `van_kracht`, `bronstatus actief`, `geldig_vanaf 2026-01-01`):

```
chunks_totaal  met_vector  zonder_vector  met_prefix  unieke_paginas
554            554         0              554         102 (van 102)
```

Hoofdstuk 5 staat er integraal in, met vectoren, op pagina 22–29 (p. 25 begint met "5.4 U kunt eerder met pensioen gaan"). De PDF zelf is een native Word-export met volledige tekstlaag, ~262.000 tekens, geen scans (`ocr_toegepast = false`). Extractie, chunking, context-prefix en embedding hebben alle vier gewerkt. **Geen enkele ingestmaatregel hoeft aangeraakt voor dit probleem.**

**Bewezen (SQL-uitvoer op productie).** De lexicale arm kan deze vraag principieel niet beantwoorden:

```sql
select to_tsvector('dutch','pensioneren'),
       to_tsvector('dutch','5.4 U kunt eerder met pensioen gaan'),
       websearch_to_tsquery('dutch','wat is er te vinden over pensioneren?');
```
```
query_lexeem:  'pensioner':1
tekst_lexemen: '5.4' 'eerder' 'gan' 'kunt' 'pensioen'
tsquery:       'vind' & 'pensioner'
```

De Nederlandse Snowball-stemmer maakt van *pensioneren* het lexeem `pensioner`; de reglementtekst draagt `pensioen`. Twee verschillende lexemen, nul overlap. De woorden "pensioneren" en "pensionering" komen **0 keer** voor in het volledige document (gemeten over alle 102 pagina's). Bovendien maakt `websearch_to_tsquery` er een AND-keten van, zodat één chunk zowel `vind` als `pensioner` moet bevatten.

De FTS-arm van `zoek_chunks_hybride` gaf dus gegarandeerd **nul rijen**, over de hele bibliotheek.

**Het mechanisme.** In `core/lib/rag.ts:919` geldt:

```ts
if (!error && Array.isArray(data) && data.length > 0) {
```

De vector-arm levert altijd rijen, dus deze conditie is waar en de functie retourneert — ook als de FTS-arm nul rijen gaf. De RRF-fusie degradeert dan stil tot pure vector-ranking. De verslapte OR-terugval die precies voor dit probleem is gebouwd (`core/lib/fts-terugval.ts`, besluit `decisions/0094`) zit uitsluitend in `zoekViaFTS` (`rag.ts:1025`) en is op het hybride pad **onbereikbaar**. Het codecommentaar op `rag.ts:1015-1024` beschrijft exact dit faalpatroon — de maatregel bestaat, maar niet op het pad dat in productie draait.

Wat overblijft is vector-only ranking op een meta-vraag. De passages die semantisch het dichtst bij "wat is er te vinden over pensioneren" liggen zijn de inhoudsopgave, de inleiding en hoofdstukkoppen — die *zijn* een opsomming van onderwerpen. Er is geen correctielaag: `rerank`, `relevantie_drempel`, `jargon_expansie` en `parent_retrieval` staan uit (geen waarde in `fonds_config`, geen env-var in `.env.local` of `.env.vercel-now`); zie `core/lib/fonds-config.ts:203-206` en `core/lib/rag.ts:227-230`.

Versterkend: de inhoudsopgave op p. 2 wordt door de kopdetectie in `core/lib/chunking.ts:237-240` opgeknipt in circa twaalf minichunks van 13–43 tekens ("5 Als u met pensioen gaat 22"). `chunkUnit` (`chunking.ts:145`) houdt niet-`tekst`-units heel, ook onder de ondergrens van 50 tekens uit `chunking.ts:90`. Bij cover-density-ranking wint zo'n chunk het altijd van een bodychunk.

**Aanname, expliciet als zodanig gemarkeerd.** Dat de drie geciteerde fragmenten inderdaad de top van de vector-ranking waren — en niet later in `rag-select.ts` zijn weggevallen — is af te leiden uit `governance_log.retrieval_meta` van de betreffende beurt (`methode`, `opgehaald` vs. `geselecteerd`, `chunks[].{document_id,rang}`). Verifieer dit vóór de bouw; het onderscheidt "vector rangschikte hoofdstuk 5 te laag" van "hoofdstuk 5 haalde de top-40 wel maar sneuvelde op `maxPerDoc = 5`". Beide zijn met dit pakket geadresseerd, maar de meting bepaalt welke maatregel het zwaarst weegt en hoort in het decision-record.

## Goedgekeurd ontwerp/plan

Zes maatregelen, in deze volgorde. M1 is de oorzaak-fix; M2–M5 dekken de klasse en maken herhaling zichtbaar; M6 repareert de teller die de bestuurder liet geloven dat er dertig relevante passages waren gevonden. Leidend zijn `RAG-VERBETERING-ONTWERP.md`, `PvA-vectorless-en-hybride-retrieval.md` en besluit `decisions/0094`.

### M1 — FTS-terugval bereikbaar maken in hybride modus (oorzaak-fix)

`zoek_chunks_hybride` retourneert al `fts_rang` en `vec_rang` per rij (migratie `2026_07_10_t10_retrieval_review_verval.sql`, returnkolommen). Een dode FTS-arm is daarmee **zonder migratie** detecteerbaar: alle teruggegeven rijen hebben `fts_rang is null`.

Gedrag: is de FTS-arm leeg, roep `zoek_chunks_hybride` dan een tweede keer aan met `p_query` = de OR-keten uit `bouwTerugvalFtsQuery(vraag)` en dezelfde `p_embedding`. Zo blijft de RRF-fusie intact en profiteert de vraag alsnog van `ts_rank_cd`, bronsoortweging, reranker en relevantie-ondergrens. Valt ook die tweede poging leeg, dan het huidige resultaat behouden — nooit slechter dan nu.

Randvoorwaarden: maximaal één extra RPC-aanroep per beurt; het bestaande fondsfilter, de modusfilters en de T4/T10-poorten gaan ongewijzigd mee; geen wijziging aan de RPC-signatuur (zie impactklasse).

### M2 — Morfologische expansie op de FTS-arm

`core/lib/jargon-expansie.ts` bevat uitsluitend afkorting↔voluit-paren (`wtp`, `pw`, `abtn`). Voeg een morfologische/synoniemlaag toe voor pensioenvocabulaire, minimaal: pensioneren / pensionering / gepensioneerd → pensioen, met pensioen gaan, pensioendatum, pensioeningangsdatum; stoppen met werken → pensioen; nabestaandenpensioen ↔ partnerpensioen; waardeoverdracht ↔ overdracht.

De expansie geldt alleen voor de **FTS-arm** (`ftsQueryVoor`); de vectorquery blijft de originele vraag, conform het bestaande commentaar in `rag.ts`. Zet `jargon_expansie` aan per fonds via `fonds_config` (niet via env), zodat de wijziging in het auditspoor landt.

### M3 — Reranker en relevantie-ondergrens aanzetten

R1.3 (`core/lib/rerank.ts`) en R1.5/R1.6 (`DEFAULT_RELEVANTIE_DREMPEL = 20`, `rag.ts:214`) zijn gebouwd en getest maar staan uit. Zij zijn de laag die een inhoudsopgavechunk boven een normatieve chunk corrigeert. Aanzetten via `fonds_config` (`rerank`, `relevantie_drempel`, eventueel `relevantie_drempel_waarde`), met meting van latentie en kosten vóór en ná.

Dit is een gedragswijziging van de assistent, geen bugfix: leg de meting en het besluit vast in het decision-record.

### M4 — Inhoudsopgave- en kopchunks downwegen bij retrieval

Demotie **na** retrieval en **vóór** `rag-select.ts`, zodat er niet geherindexeerd hoeft te worden: chunks die herkenbaar navigatie zijn (zeer korte `structuur_type`-chunk met een paginaverwijzing aan het eind, of een chunk die uitsluitend uit koppen bestaat) krijgen een lagere weging bij inhoudelijke vraagtypes. Bij een expliciete bronoverzichtsvraag (`vraagtype.ts` `bronoverzicht`-patronen) blijven ze juist waardevol — de demotie is dus vraagtype-afhankelijk, niet absoluut.

**Buiten scope, wel te beleggen:** de structurele variant, namelijk de kopdetectie in `chunking.ts:237-240` zo aanpassen dat sub-50-tekens-units met de volgende unit samensmelten in plaats van als losse chunk te blijven bestaan. Die fix vereist her-extractie van de hele bibliotheek en verdient een eigen weging. Neem dit op in `00 Overzicht en status/openstaande-punten-en-risicos.md` mét eigenaar.

### M5 — Een lege zoekarm zichtbaar maken

Voeg aan `retrieval_meta` toe: `fts_arm_leeg` (bool), `vec_arm_leeg` (bool), `terugval_hybride` (welke poging het resultaat leverde) en het aantal kandidaten per arm. Sluit aan op `MONITORING-P5-ONTWERP.md`: een blijvend hoog aandeel beurten met `fts_arm_leeg = true` is een signaal over het vocabulaire van de bibliotheek, niet over één vraag.

Dit is de duurzaamste maatregel van de zes. De reden dat dit probleem pas na een gebruikersklacht zichtbaar werd, is dat hybride zoeken er in de logs uitzag alsof het gewerkt had.

### M6 — De voortgangsteller toont een constante

De bestuurder ziet bij elke vraag *"Fondsdocumenten worden doorzocht — 30 passages gevonden"*. Dat getal kan niet variëren: `CHUNK_BUDGET = 10` (`app/api/chat/route.ts:93`) → `overFetch = Math.max(10 * 3, 20)` = 30 (`rag.ts:887`, en identiek op het lexicale pad `rag.ts:974`) → gaat als `p_limit` naar de RPC → de RPC levert er precies 30 → `bouwMeta(..., bewaakt.chunks.length, ...)` (`rag.ts:932`) zet dat in `retrieval_meta.opgehaald` → `retrievalUitkomst` (`core/lib/voortgang.ts:78-81`) maakt er de tekstregel van, gerenderd via `Voortgang.tsx:88-101`.

Het is dus een plafond dat als meting wordt gepresenteerd. Verzwarend: de regel die wél zou variëren — `rerankUitkomst(res.meta.geselecteerd)` — staat achter `if (retrievalVlaggen.rerank)` (`route.ts:1154-1162`), en die vlag staat uit. De enige teller die de bestuurder ziet, meet niets.

Besluit `0087` beschreef de bedoeling als *"aantallen doorzochte **en relevante** passages"*. Geïmplementeerd is alleen het eerste, en dat eerste is een constante. De sanitytest `core/lib/voortgang.sanity.ts:98-99` toetst uitsluitend de formattering (`retrievalUitkomst(18) === "18 passages gevonden"`), nooit dat de invoer varieert — daarom is het nooit opgevallen.

**Gedrag:** toon wat bestuurlijk betekenis heeft, namelijk het aantal unieke documenten en het aantal daadwerkelijk geselecteerde passages: *"uit 4 documenten — 8 passages geselecteerd"*. Beide zijn al aanwezig: `new Set(res.meta.chunks.map(c => c.document_id)).size` en `res.meta.geselecteerd`. Geen nieuwe data, geen extra query.

**Samenhang met M3 en M5.** Zet M3 de reranker aan, dan verschijnt de tweede voortgangsregel en verandert de betekenis van `geselecteerd`. Ontwerp de regels daarom in samenhang: liever één afgeronde regel die in beide standen klopt, dan twee regels waarvan er één afhankelijk is van een vlag. Neem daarbij `fts_arm_leeg` uit M5 mee — een beurt waarin de lexicale arm niets opleverde, verdient dat de bestuurder dat kan zien.

**Let op de consistentie-val:** `res.meta.geselecteerd` is bekend vóór de parent-retrieval-verrijking. Controleer dat het getoonde getal overeenkomt met wat het onderbouwingspaneel na het antwoord toont (`AntwoordWeergave.tsx` toont al `${doc.bronnummers.length} passages` per document). Twee getallen die niet met elkaar kloppen, is een erger probleem dan één getal dat niets zegt.

## Scope

**Wel**
- `core/lib/rag.ts` — detectie lege FTS-arm en tweede hybride poging (M1), meta-uitbreiding (M5)
- `core/lib/jargon-expansie.ts` — morfologische laag (M2)
- `core/lib/weeg-bronsoort.ts` of een nieuwe demotiestap vóór `rag-select.ts` (M4)
- `fonds_config` — vlaggen `jargon_expansie`, `rerank`, `relevantie_drempel` aanzetten (M2/M3)
- `core/lib/voortgang.ts` + `app/api/chat/route.ts:1146-1162` + `voortgang.sanity.ts` — de voortgangsteller (M6)
- Sanity-/regressiesuites voor de bovenstaande modules

**Niet**
- De ingestketen (extractie, chunking, embeddings, upload) — bewezen correct voor dit document
- Wijziging van de signatuur van `zoek_chunks_hybride` of `zoek_chunks`
- Her-extractie of herindexering van bestaande documenten
- De chunking-fix voor sub-50-tekens-kopunits (M4, structurele variant) — apart beleggen
- De losstaande ingest-bevindingen uit de analyse: fail-silent op `embeddingsGelukt` in `app/api/documents/upload/route.ts:593/645`, ontbrekende `maxDuration` op diezelfde route, dode rate-limitblok in `app/api/documents/embeddings-backfill/route.ts:32-38`, en het feit dat die backfill `c.tekst` embedt **zonder** `context_prefix` terwijl `zoek_vector` de prefix wél meeneemt. Alle vier zijn reëel maar veroorzaakten dit incident niet. Neem ze op in `BEVINDINGENLOG.md` en in `openstaande-punten-en-risicos.md` mét eigenaar.

## Impactklasse

**Architectuur.** De retrievalketen bepaalt welke bronnen onder een bestuurlijk advies liggen; een wijziging daarin is per definitie architectuurimpact, ook al raakt geen enkele regel het datamodel.

Weging expliciet, ook waar de uitkomst "klein" is:
- **Documentatiehaak: vuurt.** Actualiseer volgens `00 Overzicht en status/release-template.md` (de `00–09`-markdown én de as-built Word-doc), en verschuif de marker in `doc-actualisatie-log.md` **pas ná** de Word-doc-actualisatie.
- **Structurele gates: niet vereist bij het hier beschreven ontwerp** — geen policy, geen grant, geen `SECURITY DEFINER`-functie, geen datamodelwijziging. **Voorwaardelijk wél vereist** als het implementatieplan alsnog `zoek_chunks_hybride` wil aanpassen: draai dan `supabase/checks/2026_07_31_r1_structurele_gates.sql` schoon tegen de doeldatabase. Bouwen en controleren zijn twee verschillende dingen.
- `fonds_config`-writes lopen via het bestaande append-only auditpad (`fn_fonds_config_capture`, migratie `2026_07_09_t8b_...`) — geen nieuwe datastructuur, wel een geauditeerde gedragswijziging.

## Relevante bestanden / modules

Claude Code verifieert dit tegen de werkelijke code; onderstaande paden zijn de bevindingen uit de analysesessie, inclusief regelnummers zoals aangetroffen op 06-08-2026.

- `core/lib/rag.ts` — `:214` drempel, `:227-230` vlaglezing, `:880-940` hybride pad, `:887-888` `overFetch`/`maxPerDoc`, `:919` de conditie die de terugval blokkeert, `:1015-1035` de bestaande OR-terugval
- `core/lib/fts-terugval.ts` — `bouwTerugvalFtsQuery`, min. 4 tekens, max. 8 termen
- `core/lib/jargon-expansie.ts` — `:45-75`
- `core/lib/rag-select.ts` — `:47-70` `maxPerDocument`, Jaccard-dedup 0.85
- `core/lib/weeg-bronsoort.ts` — `:64-74` profielkeuze, `:97-106` stabiele hersortering
- `core/lib/rerank.ts` — `:30/34/38` timeout, tekstlengte, kandidatenplafond
- `core/lib/fonds-config.ts` — `:190-210` vlagresolutie (`fonds_config` vóór env)
- `core/lib/vraagtype.ts` — `:247-262` bronoverzicht-patronen (M4), `:336-350` retrievalmodus
- `app/api/chat/route.ts` — `:93` `CHUNK_BUDGET = 10`
- `supabase/migrations/2026_07_10_t10_retrieval_review_verval.sql` — **autoritatieve** definitie van beide RPC's; `2026_05_30_rag_ranking.sql`, `2026_06_20g_...`, `2026_07_08_t4_...` en het blok in `supabase/schema.sql:564` zijn achterhaalde eerdere versies
- `core/lib/chunking.ts` — `:90` 50-tekensfilter, `:145` unit-behoud, `:237-240` kopdetectie (context bij M4)

## Guardrails

Naleving van `CLAUDE.md` §Niet-onderhandelbare guardrails bevestigen. Voor déze opdracht vragen drie punten bijzondere aandacht:

1. **Fondsdiscipline blijft hard.** De tweede hybride aanroep uit M1 moet `p_fonds_id`, `p_modus`, `p_peildatum` en alle Increment G-filters identiek meegeven. `handhaafFondsdiscipline` blijft ook op het terugvalpad draaien. Een recall-maatregel mag nooit een tenantgrens verzachten.
2. **Geen stille gedragswijziging.** M3 verandert wat de assistent aan het model voorschotelt. Vastleggen in een decision-record, met de meting die eraan ten grondslag ligt.
3. **Nooit slechter dan nu.** M1 en M4 mogen bestaande, goed werkende vragen niet verslechteren. Dat is een acceptatiecriterium, geen aanname — zie de controlevragen hieronder.

## In te zetten subagents

Zie `SUBAGENTS-ONTWERP.md` §4 trigger-matrix. Voor deze opdracht minimaal `ai-governance-reviewer` (M3 verandert het bronaanbod aan het model), `code-reviewer`, en `ontwerp-sync-reviewer` vóór merge. `supabase-rls-reviewer` alleen als het plan alsnog de RPC raakt.

## Werkmodus

Begin in **Plan-modus**. Lever eerst een implementatieplan: geraakte bestanden, of M1 zonder migratie haalbaar is via `fts_rang is null`, de latentie-impact van de tweede RPC-aanroep en van M3, de testaanpak, en de risico's op precisieverlies bij M2/M4. **Wijzig pas na expliciet akkoord.**

Voer vóór de bouw eerst de meting op `governance_log.retrieval_meta` uit (zie Diagnose, aanname) en rapporteer de uitkomst — die bepaalt de onderlinge weging van M1 en M4.

## Acceptatiecriteria

### A. Regressietestset — vraagvarianten

Referentiedocument: `52a0947a-b6ef-4e66-9843-4515e0b96c71` (Pensioenreglement 2026). Hoofdstuk 5 beslaat pagina 22 t/m 29.

| # | Vraag | Verwachting |
|---|---|---|
| 1 | Wat is er te vinden over pensioneren? | ≥2 fragmenten uit p. 22–29; geen p. 2-chunk in de top-3 |
| 2 | Wanneer kan ik met pensioen gaan? | ≥1 fragment uit p. 25 (§5.4.1) |
| 3 | Kan ik eerder met pensioen? | ≥1 fragment uit p. 24–25 (§5.3/§5.4) |
| 4 | Wat gebeurt er bij pensionering? | ≥2 fragmenten uit p. 22–29 |
| 5 | Hoe werkt deeltijdpensioen? | ≥1 fragment uit p. 24 (§5.3) |
| 6 | Kan ik mijn pensioen uitstellen? | ≥1 fragment uit p. 26 (§5.5.2) |
| 7 | Kan ik partnerpensioen omzetten in ouderdomspensioen? | ≥1 fragment uit p. 27–28 (§5.6/§5.7) |
| 8 | Kan ik eerst een hoger en daarna een lager pensioen krijgen? | ≥1 fragment uit p. 29 (§5.8.3) |
| 9 | Wat staat er in het reglement over stoppen met werken? | ≥1 fragment uit p. 22–29 |
| 10 | Welke hoofdstukken kent het pensioenreglement? | Inhoudsopgave (p. 2) is hier **wél** een correcte treffer — M4 mag dit niet breken |

**Controlevragen (precisie mag niet dalen).** Draai vóór en ná; de uitkomst moet gelijk of beter zijn:

| # | Vraag | Verwachting |
|---|---|---|
| C1 | documenten met beleggingsbeleid ken je? | `methode` blijft gerangschikt, niet `ilike` (regressie op `decisions/0094`) |
| C2 | Wat is de dekkingsgraad? | Geen hoofdstuk-5-ruis; ongewijzigd t.o.v. baseline |
| C3 | Een vraag die vandaag al goed beantwoord wordt (kies er één uit `evals/`) | Identieke of betere bronset |

### B. Unit- en sanitycriteria

- `ftsQueryVoor("wat is er te vinden over pensioneren?", …)` bevat na M2 aantoonbaar de term `pensioen`.
- Nieuwe sanitytest die aantoont dat bij `fts_rang is null` op **alle** rijen de tweede hybride aanroep plaatsvindt, en dat die **niet** plaatsvindt zodra één rij een `fts_rang` heeft.
- Nieuwe sanitytest die aantoont dat het terugvalpad `p_fonds_id` en de modusfilters ongewijzigd doorgeeft (guardrail 1).
- `retrieval_meta` bevat na M5 `fts_arm_leeg`, `vec_arm_leeg` en `terugval_hybride`, ook op het pad waar geen terugval nodig was (expliciet `false`, niet afwezig).
- Maximaal één extra RPC-aanroep per beurt; meet de p95-latentie van `/api/chat` vóór en ná M1 en M3 en rapporteer beide.
- `npm run sanity` volledig groen — let op de les uit T-01 (`BEVINDINGENLOG.md`): het script moet alle suites doorlopen, niet stoppen bij de eerste rode.

### B2. Voortgangsteller (M6)

- De getoonde regel varieert aantoonbaar over de tien vragen uit tabel A. Een test die alleen de formattering toetst is **niet** voldoende — dat is precies de blinde vlek van `voortgang.sanity.ts:98-99`. Neem een test op die faalt zodra de teller over een reeks verschillende vragen dezelfde waarde geeft.
- Het getal in de voortgangsregel komt overeen met het aantal passages dat het onderbouwingspaneel na het antwoord toont; wijkt het bewust af (bijvoorbeeld door parent-retrieval), dan is dat in de labeling zichtbaar gemaakt.
- De regel klopt zowel met `rerank` aan als uit — geen enkele stand waarin de bestuurder een constante als meting gepresenteerd krijgt.
- Aanpassing van `decisions/0087` vastgelegd: dat besluit maakte de rerankfase een eigen zichtbare stap; wordt die samengevoegd, dan hoort daar een addendum bij.

### C. Bewijs bij oplevering

De vraag uit de aanleiding — *"wat is er te vinden over pensioneren?"* — levert een antwoord met minimaal twee citeerbare fragmenten uit hoofdstuk 5, inclusief `[Bron N]`-verwijzing naar pagina 22–29. Lever de `retrieval_meta` van die beurt mee als bewijs, niet alleen een schermafdruk van het antwoord.

## Definition of Done

Volg `CLAUDE.md` §Definition of Done (gezaghebbend, wordt elke sessie geladen — niet hier kopiëren). Opdracht-specifieke invulling:

- **Ontwerpdocument:** actualiseer `RAG-VERBETERING-ONTWERP.md` met het terugvalpad in hybride modus en de vraagtype-afhankelijke demotie; verwijs vanuit `PvA-vectorless-en-hybride-retrieval.md`. Leg de nieuwe voortgangsregels (M6) vast in `AI-WEERGAVE-ONTWERP.md` — daar staat vandaag géén besluit over de teller, wat verklaart hoe hij ongemerkt betekenisloos kon worden.
- **Decision-record:** nieuw record (eerstvolgende nummer, `decisions/` staat op `0136`) over M3 — reranker en relevantie-ondergrens aan, met de latentie- en kostenmeting als onderbouwing. Verwijs naar `decisions/0094` (OR-terugval) en `decisions/0095` (hybride zoeken aan voor Horizon), die dit pakket completeert.
- **Documentatiehaak:** vuurt (impactklasse architectuur) — `00–09`-markdown plus as-built Word-doc, daarna pas de marker in `doc-actualisatie-log.md`.
- **Tests:** de tabellen onder A en B, opgenomen in de bestaande suite zodat ze bij elke run meelopen. Een testset die alleen in deze werkopdracht staat, geldt als niet belegd.

## Openstaande punten

Op te nemen in `00 Overzicht en status/openstaande-punten-en-risicos.md`, **elk mét eigenaar** — een punt dat alleen in de release-historie of in deze werkopdracht staat, geldt als niet belegd:

1. **Chunking-fix voor sub-50-tekens-kopunits** (`chunking.ts:90/145/237-240`) — structurele variant van M4; vereist her-extractie van de bibliotheek.
2. **Recall-bodem per document ontbreekt.** 40 kandidaten per arm over de héle bibliotheek, dan 30 rijen, dan 10 met `maxPerDoc = 5`: een reglement van 554 chunks kan structureel niet meer dan circa anderhalve pagina bijdragen, en heeft geen gereserveerde plaats in de kandidatenpool. Voor documentgerichte vragen is dat een ontwerpgrens, geen bug — maar hij is niet vastgelegd.
3. **Ingest fail-silent** — `upload/route.ts:593/645` leest `embeddingsGelukt` niet en zet toch `geindexeerd = true`; ontbrekende `maxDuration` op dezelfde route terwijl `her-extract` die expliciet op 300s zet.
4. **`embeddings-backfill`** — dood rate-limitblok (`:32-38`, achter een `return`; dezelfde fout die op 06-08-2026 in `reindex-backfill` is hersteld) en embedding zonder `context_prefix` (`:104`), wat asymmetrische vectoren oplevert ten opzichte van `zoek_vector`.
5. **Vocabulairedekking is niet gemeten.** Dit incident kwam aan het licht door één gebruikersvraag. Overweeg een periodieke meting van het aandeel beurten met `fts_arm_leeg = true` per fonds (haakt op M5 en `MONITORING-P5-ONTWERP.md`).

## Terugkoppeling

Rapporteer in het antwoordformat uit `CLAUDE.md`: samenvatting, aangepaste bestanden, RLS/security-impact, audit-impact, datamodel/migratie-impact, test/verificatie, openstaande risico's. Neem in de test/verificatie-sectie expliciet de vóór/ná-uitkomst van de tabellen A en B op, en de p95-latentiemeting.
