# Promotie `preview` naar `main` — release-inventaris en stabilisatieplan

**Status:** lokaal gestabiliseerd; nog geen Preview- of Productiemutatie

**Inventarisdatum:** 25 september 2026

**Preview-basis:** `2922a9a014ccf70049b1b53399bfd3d166bf3ad4`

**Main-basis:** `63383f52462bf5c482b3b22f71aeec7e95410ed0`

**Doelcontext:** `portal_preview` naar `portal_production`

**Microsoft-context:** `pgb_m365_lab_copilot` en `dtu_m365_lab_copilot` blijven geblokkeerd; geen live Retrieval-call en geen activering

## 1. Uitgangsmeting

De gemeenschappelijke basis is `3fafe457c3d0c71232e4819b0dd5ff3b20bf9ea7`.

| Maatstaf | Stand |
|---|---:|
| Exclusieve commits op Preview | 182 |
| First-parent merges op Preview | 48 |
| Exclusieve commits op Main | 9 |
| Bestanden gewijzigd aan Preview-zijde | 257 |
| Bestanden aan beide zijden gewijzigd | 37 |
| Vooraf voorspelde tekstconflicten | 3 |

De drie tekstconflicten zitten in `package.json`,
`scripts/smoke/m365-copilot-lab/graph.ts` en
`tests/cross-tenant/retrieval-contextbronnen.expected.json`. De 37 overlappende
bestanden worden daarnaast semantisch beoordeeld; een schone tekstmerge is geen
bewijs van inhoudelijke compatibiliteit.

## 2. Aansluittabel

Alles op Preview krijgt een expliciete bestemming. `Promoveren` betekent niet
automatisch activeren: Microsoft- en Copilotpaden blijven standaard uit en
fail-closed.

| Preview-tranche | PR's / herkenningspunten | Bestemming | Motivering / controle |
|---|---|---|---|
| Fase-4-afsluiting en historische reconciliatie | #387, #392 | reconciliëren | De fase-4-runtime staat al op Main; alleen actuele documentatie en bruikbare historie behouden. Geen oude releaseclaim overschrijven. |
| PGB SharePoint-fixtures | #388 | promoveren als testmateriaal | Synthetische fixtures, checksums en rechtenmatrix; geen productiedata en geen automatische upload. |
| SharePoint-/Office-preview | #394–#402 | promoveren achter bestaande Preview-only poorten | Routes en meetcode blijven onbereikbaar buiten Preview/PGB/beheerder/flags. Geen normale chat-, zoek- of vergelijkingsroute mag de spike importeren. |
| Microsoft Search-voorbereiding | #404–#406 | promoveren als inerte diagnostiek | Geen consent, permission of live-call activeren. Productieroute blijft uit. |
| Copilot-labspike en smokerunner | #408–#422 | promoveren als lokale/labtooling | Alleen expliciete CLI/labsmoke; geen secrets, tokens of inhoud in Git; geen runtime-import vanuit productiepaden. |
| Copilot productie-adapter T4-B/T4-C | #414–#424 | promoveren, inert | Client, endpoint/filter, mapping, DriveItem-herlezing, download en versiebewijs. Migraties #413 eerst controleren en toepassen volgens DB-vóór-code. |
| OAuth/readiness/rollout T4-D | #425, #431 | promoveren, fail-closed | Tokenbroncontract, rolloutstanden, killswitch en billinggeldigheid. Geen credential, consent of flag activeren. |
| Multi-adapterorkestratie T4-E | #427, #432 | promoveren | Adapter-per-spoor, bronstatus en stopgedrag; bytegelijkheid bewijzen voor opdrachten zonder tweede adapter. |
| Beheer/audit T4-F | #435–#437, #441 | promoveren | Gesloten `meta.adapters`-projectie, beheerstatus en veilige tellers. Migraties #434 DB-vóór-code; geen auditgrant toekennen. |
| App365 demo fase 1 | #429, #430 | promoveren als inerte repositorybasis | Fondsconfig, hostvalidatie, badge/noindex en provisioningartefacten. Geen domain, DNS, account, callback of Microsoftobject aanmaken. |
| Migratiedrift en historiecontroles | #442, #444, #446, #447 | promoveren na actualiteitscontrole | Gegenereerde inventarissen opnieuw maken tegen de gereconcilieerde stand; geen verouderde snapshot als waarheid overnemen. |
| PGB vergelijken-canary | #448 | reconciliëren met Main #452/#454 | Main bevat al productiebegrenzing en de Opus 4.8-fix. Alleen aanvullende canarydekking behouden; geen oude samplingparameter terugbrengen. |
| Copilot canary-/correlatiediagnostiek | #450, #451 | reconciliëren met Main #453 | Main heeft veilige diagnostiek. Dubbele implementatie vermijden; alleen ontbrekende veilige metadata/tests overnemen. |
| Preview-only providerconfiguratie | env, flags, consent, accounts | niet naar Git of Productie kopiëren | Omgevingsdata blijft gescheiden. Productieconfiguratie vereist later een afzonderlijk uitvoeringsakkoord. |
| Live Microsoft-resultaten | externe Retrieval-service | geblokkeerd | HTTP 200 met nul hits blijft de actuele Microsoft-blokkade; geen nieuwe call in deze release. |

## 3. Open PR's buiten deze promotie

Open PR's waarvan de head nog niet in `preview` zit, vallen niet stilzwijgend in
de batch. Per 25 september zijn voor Microsoft vooral relevant:

- #449, veilige Copilot 401/403-diagnostiek: achter op Preview; eerst vergelijken
  met de reeds op Main gepromoveerde diagnostiek uit #453;
- #412, semantisch indexbewijs: conflictueus/verouderd; niet mergen zonder
  actualisatie naar de huidige nul-hitsdiagnose.

De overige open, oudere PR's worden als afzonderlijke backlog behandeld en zijn
geen onderdeel van `preview` naar `main` zolang hun commits niet op Preview staan.

## 4. Zeven migraties die Productie nog niet heeft

1. `2026_09_20_413_weburl_canoniek_quarantaine.sql`
2. `2026_09_21_413_weburl_office_viewer.sql`
3. `2026_09_21_423a_t4d_copilot_rollout_expand.sql`
4. `2026_09_21_423b_t4d_copilot_rollout_contract.sql`
5. `2026_09_22_428_app365_demo_fonds_config.sql`
6. `2026_09_22_434_meta_adapters.sql`
7. `2026_09_23_434_adapterstand_fonds.sql`

Voor iedere migratie zijn vooraf nodig: exacte Productiestandmeting, sha256,
volgorde, rollback, RLS/grantscontrole en een ephemere volledige rehearsal. De
Productiepreflight is read-only. Toepassen gebeurt pas na afzonderlijk akkoord
op het concrete uitvoeringspakket.

## 5. Releasevolgorde

1. Merge de actuele Main-historie in deze stabilisatiebranch.
2. Los tekst- en semantische conflicten op met Main als bron voor reeds
   gepromoveerde productiebegrenzing en hotfixes.
3. Draai gegenereerde inventories/snapshots opnieuw; neem geen oude tellingen over.
4. Draai typecheck, sanity, volledige cross-tenant-/DB-gates, securityscan,
   karakterisering en productiebuild.
5. Open een PR van de stabilisatiebranch naar `preview` en merge pas na groene
   checks.
6. Wacht beide `preview-stable`-deployments af en voer de vastgelegde
   browserwaarneming uit met minimaal twee rollen en negatieve fonds-/hostpaden.
7. Maak daarna de officiële promotie-PR `preview` naar `main`, inclusief exact
   migratiepakket en rollback.
8. Productiepromotie vereist opnieuw expliciet akkoord. Microsoft-, Copilot- en
   app365-activering blijven buiten die promotie.

## 6. Uitgevoerde stabilisatie

De actuele Main-historie is zonder functionele verbreding in de
stabilisatiebranch opgenomen. De drie voorspelde tekstconflicten zijn als volgt
opgelost:

- de Preview-scripts in `package.json` zijn behouden;
- de Graph-padnormalisatie uit Main staat in een geïsoleerde helper, zodat de
  labsmoke geen Preview-spikeprototype importeert;
- de retrieval-census is opnieuw gegenereerd en bevestigt 135 bereikbare
  leesbestanden.

De Main-fix voor Opus blijft leidend: de `vergelijk_waarde`-call stuurt geen
`temperature` of `topP`. Daarvoor is een regressietest toegevoegd.

Lokaal bewijs:

- typecheck: groen;
- volledige lokale gates: groen, 1.032 app-/cross-tenanttests geslaagd;
- Copilot-labsmoke: 108/108 geslaagd;
- M365-retrievalspike: 71/71, fixture 14/14 en boundary 16/16 geslaagd;
- gerichte retrievaltests: 45/45 geslaagd;
- secretscan: groen;
- productiebuild: groen;
- echte DB-laag: lokaal niet uitgevoerd, omdat `TEST_DATABASE_URL` bewust niet
  is gezet; deze blijft verplicht in CI/Preview.

## 7. Go/no-go

**GO voor releasevoorbereiding en Preview-stabilisatie.**

**NO-GO voor Productiemerge, Productiedatabasemigraties, Microsoftmutaties en
live Retrieval-calls** totdat de Preview-waarneming, migratierehearsal en het
concrete promotiebewijs afzonderlijk zijn beoordeeld.
