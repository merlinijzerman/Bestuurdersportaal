# Releasebewijs 11 september 2026 — Microsoft 365, AI-gateway en retrieval T2-1

**Release-id:** 2026-09-11 / `09d473f`
**Status:** uitgevoerd met twee expliciet niet afzonderlijk uitgevoerde smokes
**Promotie:** PR [#373](https://github.com/merlinijzerman/Bestuurdersportaal/pull/373), `preview` → `main`

## 1. Samenvatting

De op Preview bewezen Microsoft-, AI-gateway- en retrievalbasis is op 11 september 2026 naar
Productie gebracht. De bestaande upload-/Supabasevariant blijft leidend voor bestaande fondsen;
Microsoftfuncties zijn additief, fondsgebonden en op Productie standaard uit gebleven. De centrale
AI-gateway bedient na deze release wel de bestaande AI-paden. Productiecommit is `09d473f`.

## 2. Nieuwe functionaliteit

| Onderdeel | Beschrijving | Documentatie bijgewerkt |
|---|---|---|
| Microsoftfundament | Connector, organisatiebreed loginbeleid, Outlook en SharePoint read-only staan productieklaar maar niet geactiveerd | HANDOVER, promotienotitie, architectuur-addenda |
| Centrale AI-gateway | Provider- en modelkeuze per fonds/taakgroep met inhoudsvrij gatewayspoor | HANDOVER, promotienotitie, architectuur-addenda |
| Retrieval T2-1 | Providerneutraal contract, centrale orkestratie, deadlines/cancellation, V1–V5 en G-12 | HANDOVER, promotienotitie, architectuur-addenda |

## 3. Gewijzigde functionaliteit

| Onderdeel | Wijziging | Impact |
|---|---|---|
| Bestaande AI-paden | Lopen via de centrale gateway | Gatewayrollen, configuratie en secrets zijn productievoorwaarden |
| Hybride retrieval | Begrensde verslapte FTS-poging wanneer strikt FTS niets bijdraagt | Betere FTS-bijdrage zonder scope- of filterverruiming |
| Ingest | Eén reservering per logische ingestjob; globale versus fondsgebonden quotering geborgd | Productie-ingest met PDF, chunk, embedding en contextprefix bewezen |

## 4. Technische wijzigingen

| Onderdeel | Wijziging | Impact |
|---|---|---|
| Database | Vijf minimale rollen en elf migratie-/seedstappen | Private gateway-, Microsoft- en logincontracten beschikbaar |
| Configuratie | AI- en login-gateway-URL plus CA als Production Secrets in beide Vercel-projecten | Bestaande AI-route kan fail-closed via de centrale gateway werken |
| Deploy | Beide productieprojecten op `09d473f` `Ready` | App en beheer gebruiken dezelfde vrijgegeven codebasis |

## 5. Architectuurimpact

| Component | Wijziging | Impact op landschapsplaat | Documentatie bijgewerkt |
|---|---|---|---|
| AI-uitgang | Centrale gateway tussen applicatie/worker en providers | Nieuwe expliciete private gatewaygrens | Ja |
| Retrieval | Adaptercontract en centrale orkestratie | Providerneutrale selectie-/citatie-/toelatingslaag | Ja |
| Microsoft 365 | Private vault/loginlaag plus read-only Outlook/SharePoint | Additieve, standaard-uit productvariant | Ja |

## 6. Security/compliance-impact

| Onderdeel | Impact | Actie nodig |
|---|---|---|
| Microsoftactivering | Geen fonds geactiveerd; geen stille OAuth-/Graphactivering | Per fonds apart onboardingbesluit en acceptatie |
| Gatewaysecrets | Alleen server-side Production Secrets; inhoud/secrets niet in gatewaylog | Rotatie- en monitoringprocedures blijven volgen |
| Toelatingspoort | Claimed permission proof wordt V1–V5 fail-closed getoetst | Live Microsoftbewijs pas na #353/#354 en vervolgtranches |

## 7. Database, objectmodel en datadictionary

| Onderdeel | Wijziging | Impact op objectmodel | Impact op datadictionary | Impact op autorisatie/RLS | Documentatie bijgewerkt |
|---|---|---|---|---|---|
| AI-gateway | Privaat configuratie- en logdomein | Nieuwe gatewayconfiguratie en callregistratie | Addendum opgenomen | Alleen minimale rol `ai_gateway` | Ja |
| Microsoft connector/login | Private vault-, Outlook-, SharePoint- en loginobjecten | Nieuwe fondsgebonden integratie- en bindingsobjecten | Addendum opgenomen | Browserrollen hebben geen directe private-schematoegang | Ja |
| Retrievalaudit | Projectie voor `gateway` en `toelating` | Geen nieuw publiek kernobject | Auditmetadata uitgebreid | Bestaande basis-/bron-/inhoudsniveaus behouden | Ja |

## 8. Testresultaten

| Testgebied | Status | Opmerking |
|---|---|---|
| Promotie-CI | Groen | Alle workflows op mergecommit `09d473f` groen |
| Productiedeploys | Groen | App en beheer `Ready`; healthcheck `{"ok":true}` |
| Bestaande sessie/UI | Groen | Geldige PGB-sessie en portaal-UI werkten |
| AI-gateway | Groen | Twee chatgeneraties en één contextprefix-call via Anthropic `ok`; `gateway_log_fouten_24u = 0` |
| Ingest en citatie | Groen | PDF `beschikbaar`; 1 pagina, 1 chunk, 1 embedding, 1 contextprefix; `DELTA-0911` correct geciteerd |
| Microsoft standaard uit | Groen | Geen Microsoftbediening zichtbaar; login, Outlook en SharePoint niet geactiveerd |
| Verse wachtwoordlogin | Niet afzonderlijk uitgevoerd | Bestaande sessie was nog geldig |
| Afschrift-/besluitconcept | Niet afzonderlijk uitgevoerd | Geen geschikte synthetische PGB-vergadering/notulenfixture |

## 9. Bekende beperkingen

- Microsoft is productieklaar maar niet per fonds geactiveerd of live end-to-end beproefd.
- Echte SharePoint live retrieval blijft geblokkeerd door #353/#354 en T2-2 t/m T2-5.
- De twee niet afzonderlijk uitgevoerde smokes gelden niet als bewijs; zij zijn alleen als bewuste
  testbeperking geaccepteerd voor deze basisrelease.

## 10. Openstaande acties

- [#367](https://github.com/merlinijzerman/Bestuurdersportaal/issues/367): volledige
  versie-identiteit en retrievalcorrelatie (T2-3).
- [#368](https://github.com/merlinijzerman/Bestuurdersportaal/issues/368): directe
  evidencelezingen en begrensd contextcontract (T2-4).
- [#369](https://github.com/merlinijzerman/Bestuurdersportaal/issues/369): zoeken en vergelijken
  via centrale retrievalorkestratie (T2-2).
- [#370](https://github.com/merlinijzerman/Bestuurdersportaal/issues/370): hermetische Microsoft
  RetrievalAdapter-stub en contractbewijs (T2-5).

## 11. Besluit

**Vrijgegeven met beperkingen.** De basisrelease is uitgevoerd en de kritieke app-, gateway-,
ingest- en standaard-uitpaden zijn op Productie bewezen. Microsoftfunctionaliteit blijft uit tot
een afzonderlijk fondsbesluit en acceptatieronde. Verse wachtwoordlogin en
afschrift-/besluitconceptgeneratie zijn in dit releasewindow niet afzonderlijk uitgevoerd.

## Templatecontrole

- Nieuwe tabellen/relaties/statussen/rechten/RLS/AI-audit: geraakt door de elf reeds beoordeelde
  migratie-/seedstappen; productiechecks groen vóór deploy.
- Datadictionary, logisch/fysiek objectmodel en datagebruik: release-addenda bijgewerkt in de
  00–09-set; geen volledige nieuwe baseline of Word-hergeneratie in dit docs-only sluitstuk.
- Landschapsplaat en componentbeschrijving: release-addenda bijgewerkt; bestaande visualexport is
  niet opnieuw gegenereerd omdat dit sluitstuk geen architectuurwijziging toevoegt.
- As-built Word-document: niet opnieuw gegenereerd; de markdownset en releasehistorie zijn het
  actuele releasebewijs, de Word-momentopname blijft onder de bestaande driftprocedure vallen.
