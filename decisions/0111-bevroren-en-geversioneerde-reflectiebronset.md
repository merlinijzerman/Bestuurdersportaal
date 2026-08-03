# 0111 — De reflectiebronset wordt bevroren en geversioneerd; geen retrieval op vrije reflectietekst

- **Status:** Geaccepteerd — ontwerp vastgesteld, **implementatie volgt in plateau B**
- **Datum:** 2026-08-04
- **Betrokkenen:** Productverantwoordelijke, IB, ontwikkeling

## Context

Tijdens een reflectie typt de bestuurder persoonlijke overwegingen — "ik maak mij zorgen over gepensioneerden". Zou de assistent daarop opnieuw documenten ophalen, dan gebeuren er twee ongewenste dingen: de persoonlijke formulering wordt een zoekquery (en belandt dus in het retrievalpad), en het gesprek verschuift halverwege naar andere bronnen dan waarop de afweging begon.

## Besluit

Bij het starten van een reflectie wordt de bronset van de aanleidende interactie bevroren en samengevat in een `reflectie_bronset_versie` (sha256 over de gesorteerde document-, versie- en passage-ID's plus de document-scope-hash). Gedurende de reflectie levert de contextopbouw uitsluitend die bronnen. Er wordt geen enkele nieuwe retrieval gedaan op reflectietekst.

## Overwogen alternatieven

- **Gewoon opnieuw ophalen per beurt** — verworpen; zie context.
- **Bronset opnieuw berekenen bij elke beurt uit dezelfde vraag** — deterministisch bedoeld, maar retrieval hangt af van documentstatus en peildatum; de set kan dus alsnog schuiven tijdens het gesprek.

## Gevolgen

- `RetrievalFilters` krijgt geen nieuwe query-opbouw; de bestaande `p_document_ids`-parameter draagt de bevroren set, op elk retrievalpad inclusief de PostgREST-terugval.
- Heeft de aanleidende interactie geen bronnen, dan is de bronsetversie `null` en reflecteert de assistent uitsluitend op het antwoord en de woorden van de gebruiker.
- De versiehash verlaat de privéchat nooit en is nadrukkelijk iets anders dan de `publicatie_bronset_versie` uit plateau C.
- Bewust geaccepteerd: de reflectie kan een document missen dat ná het startmoment relevant werd. Dat is de prijs van een stabiele afweging.

## Referenties

- Ontwerp v1.0 §11, technisch ontwerp §6.2, §6.3 (G3)
- `core/lib/rag.ts` (`RetrievalFilters`, `rpcFilterParams`, `handhaafFondsdiscipline`)
- [[0110]]
