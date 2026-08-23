# Preview-waarnemingsdata (OMG-1)

De runbare seed staat bewust bij het karakteriseringsharnas:
[`tests/karakterisering/seed.mjs`](../../../tests/karakterisering/seed.mjs).
Die gebruikt dezelfde vaste UUID's, Auth-fixtures en idempotentie als de 361
scenario's. Een tweede, los SQL-bestand zou daarvan afwijken en maakt de
waarneming minder reproduceerbaar.

Dit document hoort bij de map `preview/` omdat de uitvoering uitsluitend daar,
handmatig en buiten CI/deploys plaatsvindt. CI toetst alleen de grendel tegen de
ephemere lokale stack.

## Verplichte grendel

De seed weigert vóór de eerste client-/databasehandeling tenzij beide bewijzen
aanwezig zijn:

1. de URL levert de allowlisted projectref voor Preview of de expliciete lokale
   CLI-stack op;
2. `SEED_DOELOMGEVING` bevestigt exact dezelfde omgeving (`preview` of `local`).

Voor Preview zijn alleen de volgende handmatige stappen toegestaan:

```bash
SEED_DOELOMGEVING=preview \\
node --env-file=.env.preview tests/karakterisering/seed.mjs
```

Gebruik nooit `.env.local` als de herkomst of inhoud ervan niet expliciet is
geverifieerd. Een ontbrekende bevestiging, een onbekende ref of Productie stopt
het script zonder query. Controleer vóór een handmatige run bovendien dat
`.env.preview` Preview-specifieke Auth- en service-rolegegevens bevat; sla die
waarden niet op in git of in een issue.

## Eindtoestand en kosten

Naast de bestaande fonds-, vier rolaccounts-, document-, procedure-,
vergadering-, agendapunt-, risico-, catalogus-, afschrift- en gespreksfixtures
maakt OMG-1 deze UI-bereikbaarheid expliciet:

| Entiteit | Previewfixture |
|---|---|
| besluit | één synthetisch `decision_object` in `concept` |
| dissent | één gedeelde, niet-formele synthetische dissent |
| notulen | één synthetisch vergaderdocument en één onbevestigd segment |
| inbreng | één synthetische inbreng van de testbestuurder |
| stemmingen | **niet geseed**; de VEN-2-modulevlag blijft de zichtbaarheid bepalen |

Alle nieuwe titels en inhoud dragen het woord `SYNTHETISCH`; er zijn geen
productienamen, -teksten of -bestanden gebruikt. De seed uploadt een klein,
rechtstreeks Storage-object en zet het notulendocument op `beschikbaar`; zij
roept geen ingest-, OCR- of embeddingroute aan. Verwachte extra AI-kosten:
**nul AI-acties**. Controleer na een handmatige run alsnog de Preview-queue en
het quota-dashboard voordat W7 start.

## Uitvoeringsbewijs dat nog handmatig moet worden vastgelegd

Een codewijziging is geen uitgevoerde Preview-run. Leg bij OMG-1, zonder refs,
hosts, e-mailadressen of secrets, minimaal vast:

1. tijdstip en geslaagde eerste én tweede seed-run;
2. rijtelling per bovenstaande entiteit plus de bestaande fixtures;
3. dat de tweede run dezelfde eindtoestand opleverde;
4. de lege ingest-/embeddingqueue en het quota-resultaat;
5. de W7-proef op besluitstatus, dissent, segmentbevestiging en inbreng.

De volledige lijst van 112 handlers blijft
[`W6-PARENLIJST.md`](../../../05%20Security%20en%20compliance/W6-PARENLIJST.md).
Classificeer ieder item tijdens de W7-rondgang als bereikbaar of expliciete
lacune; markeer stemmingshandlers als module-uitgeschakeld zolang VEN-2 uit
staat. De seed maakt die lacune niet onzichtbaar.
