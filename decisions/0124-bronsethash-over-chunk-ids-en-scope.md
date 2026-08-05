# 0124 — De reflectiebronset-hash gaat over chunk-ID's en documentscope, niet over versie- en passage-ID's

- **Status:** Geaccepteerd — **herziening van [[0111]] op de formule**
- **Datum:** 2026-08-05
- **Betrokkenen:** Ontwikkeling

## Context

Besluit [[0111]] en technisch ontwerp §6.2 definiëren `reflectie_bronset_versie` als een sha256 over de gesorteerde lijst `(document_id, versie_id, passage_id)` plus een `document_scope_hash`.

Geen van die drie velden bestaat in deze codebase. `RetrievalMeta` kent `chunks[] = {id, document_id, rang}` — de `id` ís de passage — en `scope.document_ids[]`; er is geen versie-id op chunk- of documentniveau en geen scope-hash.

Belangrijker: het TO gaat ervan uit dat de bronset uit de allowlist-velden van `retrieval_meta` komt. Sinds plateau A ([[0114]]) is `sources` geclassificeerd als **inhoud** en verhuisd naar `governance_log_inhoud` — precies omdat `AssistantSourceDocument.fragment` letterlijke documenttekst draagt. De bronset kan er dus niet uit worden afgeleid. Wat wél in het append-only spoor blijft staan, is `chunks` en `scope.document_ids`, beide op bronniveau.

## Besluit

De canonieke vorm is:

```
join('|', sort(uniek( "<document_id>:<chunk_id>" ))) || '#' || join(',', sort(uniek(scope.document_ids)))
```

en `reflectie_bronset_versie = sha256(canoniek)`. Bij nul bruikbare chunks is de waarde `null` — niet een hash over de lege string.

De hash wordt berekend in `public.reflectie_bronset_hash()` (SQL, `immutable`) en gespiegeld in `core/lib/bronset.ts`, met een vaste pin in `core/lib/bronset.sanity.ts` en een gelijkheidscheck in de SQL-suite.

## Overwogen alternatieven

- **Een versiekolom introduceren om het TO letterlijk te volgen** — verworpen: documentversionering is een eigen ontwerpvraag (welke gebeurtenis maakt een nieuwe versie?) en hoort niet als bijvangst in een reflectieticket.
- **De bronset uit `sources` lezen** — onmogelijk zonder de scheiding van plateau A te doorbreken: die rijen zijn verwijderbaar en dragen documenttekst.
- **Alleen `document_ids` hashen** — verworpen: dan levert een tweede antwoord over hetzelfde document dezelfde versie, terwijl de gebruikte passages verschillen.

## Gevolgen

- **Ontdubbeld en gesorteerd**, dus ongevoelig voor de rangorde waarin de retrieval de chunks teruggaf. Zonder dat zou een herhaalde reflectie op hetzelfde antwoord een andere "bevroren" set lijken te hebben. Bevroren in `bronset.sanity.ts`.
- **`collate "C"` is verplicht in de SQL-kant.** De standaardcollatie van de database sorteert taalkundig en negeert daarbij leestekens; JavaScript sorteert op codepoint. Twee implementaties die anders sorteren lopen stíl uiteen — daarom toetst de SQL-suite de hash tegen dezelfde vaste waarde als de TypeScript-pin.
- **Geen versiedetectie op documentniveau.** Wordt een document opnieuw geïndexeerd met nieuwe chunk-ID's, dan kantelt de hash (goed). Blijft het chunk-ID gelijk terwijl de tekst wijzigt, dan niet. Dat is een reëel gat; het weegt licht omdat de reflectie een privéchat is die niet als bewijs dient, en `reflectie_bronset_versie` de privéchat nooit verlaat (FR-69). **Bewust aanvaard**, opgenomen als restrisico.
- Geen wijziging aan het datamodel van `governance_log`; de hash leest alleen.

## Referenties

- `supabase/migrations/2026_08_05_b1_reflectie_state.sql` (`reflectie_bronset_hash`)
- `core/lib/bronset.ts`, `core/lib/bronset.sanity.ts`
- Technisch ontwerp §6.2; ontwerp v1.0 §9.5; FR-69
- [[0111]], [[0114]], [[0123]]
