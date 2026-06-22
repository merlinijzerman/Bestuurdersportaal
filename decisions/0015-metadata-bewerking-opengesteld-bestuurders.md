# 0015 — Metadata-bewerking opengesteld voor bestuurders (alle velden)

- **Status:** Geaccepteerd
- **Datum:** 2026-06-22
- **Betrokkenen:** Merlin (opdrachtgever/bestuurder, compliance-akkoord), Claude Code (uitvoering)

## Context

In de huidige inrichting moeten bestuurders alle documentmetadata kunnen wijzigen,
niet alleen de vrije-tekst-update. De capability-set (besluit `0009`/B11) is de enige,
server-side afgedwongen hefboom hiervoor ([`lib/capabilities.ts`](../lib/capabilities.ts)).
Tegelijk moet de **afronding van een review** (formele validatiestatus) en de
classificatie-/notulen-review bij de daartoe aangewezen rollen blijven liggen — anders
verdwijnt de functiescheiding rond formele vaststelling.

## Besluit

`bestuurder` draagt voortaan **alle drie de metadata-veldcapabilities**
(`documents.metadata.update`, `documents.status.change`, `documents.bronstatus.change`).
De **review-afronding** (`documents.metadata.review`) en de classificatie-/notulen-
segment-bevestiging blijven bewust bij beheerder/voorzitter.

## Overwogen alternatieven

- **Alleen `documents.metadata.update` openstellen** (conservatief, eerste voorstel) —
  verworpen op verzoek opdrachtgever: dekt niet "alle metadata".
- **Ook review-afronding openstellen** — verworpen: zou de functiescheiding rond
  formele vaststelling opheffen; niet gevraagd en niet wenselijk.

## Gevolgen

- **RLS/autorisatie:** de capability-check is server-side leidend; UI-gating blijft
  cosmetisch. De wijziging zit in de config-mapping, niet in een routebypass.
- **Audit:** metadatamutaties blijven via het bestaande document_metadata_log lopen.
- **Datamodel/migraties:** geen.
- **Tests:** [`lib/capabilities.sanity.ts`](../lib/capabilities.sanity.ts) borgt dat
  bestuurder de drie bewerk-capabilities draagt én géén `metadata.review`/
  classificatie-review.

## Referenties

- [`lib/capabilities.ts`](../lib/capabilities.ts), [`lib/capabilities.sanity.ts`](../lib/capabilities.sanity.ts).
- Besluit `0009` (capability-set/B11).
