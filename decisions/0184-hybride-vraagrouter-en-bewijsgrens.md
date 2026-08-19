# 0184 — Hybride vraagrouter met code-gedreven bewijsgrens

**Status:** geaccepteerd voor implementatie achter flags; productie vereist afzonderlijk akkoord
**Datum:** 2026-08-17

## Context

Top-N-retrieval is geschikt voor gerichte vragen, maar bewijst niet dat het volledige document is onderzocht. Brede vragen zoals een volledigheids- of aansluitingstoets konden daardoor te stellige afwezigheidsclaims opleveren. Altijd het hele document verwerken zou latency en AI-verbruik onnodig verhogen.

## Besluit

Een deterministische router kiest eerst taak, scope en vereiste dekking. Alleen een server-gevalideerd geselecteerd of ondubbelzinnig genoemd document mag de volledige route openen. Kleine documenten worden in één context verwerkt; grotere via begrensde map/reduce. De code berekent het dekkingsbewijs en begrenst de taal: alleen aantoonbaar volledige verwerking geeft bewijsniveau `uitputtend` en staat documentbrede afwezigheidsclaims toe.

Een optionele lichte modelrouter mag uitsluitend de ambiguïteitsband verfijnen en wordt daarna opnieuw gevalideerd. Een gerichte run kan een server-gevalideerde vervolgactie voor volledige analyse aanbieden. Alle paden staan achter fondsgerichte, default-off flags.

## Afgewezen alternatieven

- **Altijd top-N:** goedkoop, maar geen bewijs voor volledigheid of afwezigheid.
- **Altijd volledige documenten:** eenvoudiger semantiek, maar disproportionele latency en kosten voor feitvragen.
- **Modelrouter als enige beslisser:** minder reproduceerbaar en bij provider-/schemafouten geen harde scopegrens.
- **Client-side vervolgactie als vrije prompt:** niet betrouwbaar te koppelen aan gebruiker, fonds, oorspronkelijke run en exact document.
- **Een volledigheidslabel uit modeltekst:** kan technisch onjuiste zekerheid geven; het label moet uit tellingen, batches en afkapredenen volgen.

## Consequenties

Er komen drie flags, gesloten auditmetadata, een additieve allowlistmigratie en een expliciete gedeeltelijk-status bij caps/timeouts/fouten. Volledige analyses zijn trager en gebruiken meer AI-budget. Productie vereist eerst vijf consistente Preview-runs op de geanonimiseerde RQ-01-case, operationele voor/na-metingen, groene tenant-/databasegates en een aparte go/no-go. Rollback begint met flags uitzetten.
