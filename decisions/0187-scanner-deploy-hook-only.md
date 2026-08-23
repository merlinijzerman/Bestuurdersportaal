# 0187 — Scanner deployt uitsluitend via een expliciete hook

**Status:** Geaccepteerd en technisch geborgd  
**Datum:** 2026-08-23

## Besluit

`bestuurdersportaal-scanner` krijgt geen automatische Git-deploys meer. In
`scanner/vercel.json` staat daarom `git.deploymentEnabled: false`. Een
scannerimage mag uitsluitend ontstaan door de gecontroleerde Vercel Deploy Hook
voor de juiste omgeving.

## Waarom

De scanner bouwt een ClamAV-container met de signatures in de image. Vercel
plaatst elke containerbuild in Vercel Container Registry. Doordat de scanner
aan dezelfde repository hing als app en beheer, maakte iedere feature-, merge-
of documentatiecommit ook een scanner-previewimage. Dat verbruikte zowel build
CPU als registry-opslag zonder functionele of veiligheidswaarde.

Dit is geen optimalisatie die we later naar believen weer kunnen terugdraaien:
een gewone Git-push is geen voldoende reden om een nieuwe malware-scanner te
publiceren. De enige geldige redenen zijn een gecontroleerde
signatureverversing of een beoordeelde scannerwijziging.

## Borging en werkwijze

- `scanner/vercel.json` blokkeert Git-deploys op iedere branch.
- `scanner/test/vercel-config.test.mjs` faalt wanneer die blokkade verdwijnt;
  de bestaande security-baseline draait deze test op elke push en PR.
- De dagelijkse Deploy Hook met `buildCache=false` blijft de signature-refresh
  uitvoeren.
- Bij een wijziging onder `scanner/`: eerst de scanner-tests, daarna een
  bewuste hook-deploy en een `/health`-controle in de doelomgeving.
- App- en beheerpreviews delen de bestaande, gevalideerde
  scannerdeployment per omgeving; zij krijgen geen per-PR scannerimage.

## Niet inbegrepen

Dit besluit verwijdert geen bestaande registry-images en wijzigt de
retentie-instelling niet. Opruimen van bestaande images vereist een aparte,
controleerbare operatie in Vercel, nadat is vastgesteld welke image nog door
een deployment wordt gebruikt.
