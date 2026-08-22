# 0186 — Securitydocumentatie in een publieke en een private laag

- **Status:** Geaccepteerd
- **Datum:** 2026-08-22
- **Eigenaar:** Merlin IJzerman (VEN-1)

## Context

Issues, PR-bodies en commitberichten zijn vóór de eerste push handmatig geredigeerd en
de lokale historie is daarvoor herschreven. Dat voorkwam de directe publicatie, maar
maakt veiligheid afhankelijk van herinnering en herstelwerk. De repository is publiek;
tegelijk bevat het securitydossier zowel toetsbaar beleid als operationele runbooks,
productie-evidence en pentestoverdracht. Eén publicatieregel voor beide soorten is niet
houdbaar.

## Besluit

We hanteren twee inhoudelijke lagen met **private-by-default** als grens:

1. De publieke repository bevat beleid, architectuurprincipes, een hoog-over
   dreigingsmodel, control-doelen en gesaneerde findings/verificatiestatus.
2. Een private bestemming bevat exacte provider-/project-/omgevingsidentificatie,
   productie-SQL en runbooks, ruwe uitvoer/evidence, incidentdetails en ongereviewde
   exploit- of pentestinformatie.
3. Secrets staan in geen van beide documentatielagen maar uitsluitend in de kluis.
4. Issues, PR-bodies en commitberichten volgen dezelfde grens als bestanden.

De keuze tussen een private GitHub-repository en een dossier in de kluis is nog open.
Die keuze bepaalt beheer en samenwerking, niet de publicatiegrens.

## Structurele borging

`security/publicatie-manifest.json` classificeert ieder gevolgd bestand onder
`security/`. De default is privé. `scripts/check-security-publication.mjs` draait in de
securitybaseline en faalt bij een ontbrekende classificatie.

Zes bestaande operationele/bewijsdocumenten worden tijdelijk `legacy_frozen`: hun
sha256 is gepind en iedere inhoudswijziging faalt. Zo kan het publieke reservoir niet
verder groeien zolang de private bestemming nog niet is gekozen. Na gecontroleerde
overdracht worden deze bestanden in de publieke laag vervangen door een samenvatting of
verwijderstub en vervalt de uitzondering.

## Gevolgen

- Redactie achteraf is niet langer het primaire proces; classificatie gebeurt vóór het
  schrijven.
- Publieke securitydocumentatie blijft inhoudelijk reviewbaar en kan normaal wijzigen.
- Operationele details kunnen pas worden bijgewerkt nadat de private bestemming is
  ingericht.
- De huidige publieke historie wordt door dit besluit niet automatisch herschreven.
  Als de legacy-inventaris daadwerkelijke niet-publieke data blijkt te bevatten, volgt
  gerichte historiesanering en waar nodig rotatie als apart incidentpad.
- Geen applicatie-, RLS-, datamodel- of runtime-impact.

## Alternatieven

- **Alles publiek met redactie achteraf:** verworpen; combinatielekken en vergeten
  metadata blijven afhankelijk van handwerk.
- **Het hele securitydossier privé:** verworpen; beleid, architectuur en control-doelen
  verliezen publieke toetsbaarheid en code-reviewcontext.
- **Alleen een tekstuele afspraak:** verworpen; zonder manifest en CI-poort blijft de
  eerder opgetreden foutklasse mogelijk.

## Referenties

- [`security/PUBLICATIEBELEID.md`](../security/PUBLICATIEBELEID.md)
- [`security/publicatie-manifest.json`](../security/publicatie-manifest.json)
- [`scripts/check-security-publication.mjs`](../scripts/check-security-publication.mjs)
