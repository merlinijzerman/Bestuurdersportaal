# 0073 — Retrieval-reranker op Haiku + gelijktijdige activering van de R1.3–R1.6-bundel

- **Status:** Geaccepteerd
- **Datum:** 2026-07-15
- **Betrokkenen:** Merlin (opdrachtgever/bestuurder), Claude (uitvoering/advies)
- **Relatie:** effectueert releaseplan §R1.3 (reranking) en adresseert bevindingen B2/B3/B5/B7 uit `RAG-REVIEW-2026-07-05.md`; bouwt voort op besluit 0025 (context_prefix/prefix-isolatie) en 0045 (T4-fondsdiscipline op het retrievalpad).

## Context

De RAG-review (B2) benoemt het ontbreken van een reranker als de goedkoopste grote precisiesprong: RRF fuseert ranglijsten maar beoordeelt niet of een chunk de vráág beantwoordt. Het releaseplan §R1.3 liet bewust twee opties open, allebei zonder nieuwe (sub-)verwerker: (i) een LLM-reranker op Haiku, binnen de bestaande Anthropic-verwerking, of (ii) een zelf-gehoste cross-encoder (bv. BGE-reranker). Tegelijk staan drie samenhangende retrieval-verbeteringen klaar (relevantie-ondergrens B3, parent-retrieval B5, jargonexpansie B7).

Randvoorwaarden die meewegen: geen nieuwe sub-verwerker/dataresidentie-vraagstuk erbij willen; tenant-isolatie (RLS per `fonds_id`) mag niet verzwakken; prefix-isolatie (besluit 0025) blijft intact; auditspoor append-only; en — expliciet — er is nog géén gouden retrieval-testset (die blijft de pre-R2 gate, releaseplan §R1.0), dus objectieve voor/na-meting ontbreekt.

## Besluit

De retrieval-reranker draait op **Haiku (`claude-haiku-4-5-20251001`), listwise in één call** — optie (i), binnen de bestaande Anthropic-verwerking, geen nieuwe sub-verwerker. De vier onderdelen (R1.3 reranker, R1.4 jargonexpansie, R1.5 relevantie-ondergrens, R1.6 parent-retrieval) worden **in één keer geïmplementeerd en gelijktijdig geactiveerd** ná één indicatieve AQLab-nulmeting; elk onderdeel houdt een **eigen feature flag uitsluitend als terugdraai-/bisectiemechanisme** (default uit tot activering).

## Overwogen alternatieven

- **Cohere / Voyage managed reranker** — sterkste kant-en-klare kwaliteit, maar introduceert een nieuwe sub-verwerker en een dataresidentie-/verwerkersovereenkomst-vraag. Afgewezen: onevenredige governance-last voor de MVP-fase.
- **Zelf-gehoste cross-encoder (BGE-reranker)** — geen egress, doorgaans beter/goedkoper per kandidaat, maar beheerlast (hosting, schaling, monitoring) en een nieuwe operationele afhankelijkheid. Afgewezen voor nu; blijft de kandidaat als de reranklatency/-kosten of -kwaliteit op de gouden testset daarom vragen.
- **Gefaseerde activering (onderdeel voor onderdeel meten)** — zuiverder toe te schrijven bij een regressie, maar trager. Afgewezen door de opdrachtgever ten gunste van snelheid; het restrisico is bewust geaccepteerd (zie Gevolgen).

## Gevolgen

- **Kwaliteit/precisie:** verwachte precisie@k-winst op juridisch/bestuurlijk jargon; niet objectief gemeten tot de pre-R2 gouden testset. Rerankscores zijn **indicatoren, geen grondwaarheid** (geen schijnzekerheid).
- **Kosten/latency:** +1 Haiku-call per vraag (~30 kandidaten × ~800 tekens) en, bij parent-retrieval, een grotere promptcontext (max ~25k tekens). Raming vooraf; exacte cijfers uit de meting.
- **Betrouwbaarheid:** ilike-treffers zijn nooit meer citeerbaar en een lege set ná drempel valt op het bestaande eerlijke geen-treffers-pad — minder schijn-grounding.
- **Tenant-isolatie/audit:** geen RPC-/schema-/RLS-wijziging; `handhaafFondsdiscipline` draait óók op de parent-siblings (dragend, want de directe `.from()`-route mist de RPC-poort voor niet-published generiek). `retrieval_meta` is additief uitgebreid (append-only).
- **Bewust geaccepteerd risico:** door gelijktijdige activering zonder objectieve nulmeting is bij een kwaliteitsregressie niet direct zichtbaar wélk onderdeel de oorzaak is. Mitigatie: per-onderdeel-flag voor bisectie (volgorde D→A→B→C), volledige diagnostiek in `retrieval_meta`, één AQLab-subset-run vóór en ná activering + handmatige steekproef.
- **Herzieningsvoorwaarde:** de reranker-keuze wordt heroverwogen bij de **pre-R2 gate**, wanneer de gouden retrieval-testset de Haiku-reranker objectief tegen een zelf-gehoste cross-encoder kan wegen.

## Referenties

- Code: `core/lib/rerank.ts`, `core/lib/jargon-expansie.ts`, `core/lib/parent-context.ts`, `core/lib/rag.ts` (`naVerwerking`), `core/lib/fonds-config.ts` (`retrievalVlaggenVoorFonds`), `core/lib/llm-modellen.ts`.
- Tests: `core/lib/{rerank,jargon-expansie,parent-context}.sanity.ts`, `tests/cross-tenant/rag-discipline.test.ts` (T15).
- Ontwerp/review: `04 Technische inrichting/Bestuurdersportaal - RAG-kwaliteit releaseplan (R1-R2) v0.1.md` §R1.3, `RAG-REVIEW-2026-07-05.md` (B2/B3/B5/B7).
- Eerdere besluiten: 0025 (structuur-contextueel/prefix-isolatie), 0045 (T4-fondsdiscipline retrievalpad).
