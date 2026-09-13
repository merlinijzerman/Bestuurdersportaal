# Releasebewijs 13 september 2026 — M365 fase 4 op Productie

**Release-id:** 2026-09-13 / Productie `3a6d9de`

**Geaccepteerde Preview-bron:** `6a0456d`

**Voorafgaande productiebasis:** `09d473f` (release 11 september 2026)

**Status:** uitgevoerd en vrijgegeven met de hieronder vastgelegde beperkingen

## 1. Samenvatting

M365 fase 4 is na afzonderlijk akkoord via PR
[#384](https://github.com/merlinijzerman/Bestuurdersportaal/pull/384) naar `main` gemerged als
productiecommit `3a6d9de2d53139a50475569f95c0aa55135fc108`. Die merge bevat Preview-bron
`6a0456df75332ad96c993dc588475166e97cfcfa` en bouwt voort op de op 11 september uitgevoerde
productierelease `09d473f2fb4c5b8df147598670af660501e8a67d`. De drie additieve migraties,
database-eindcontroles, verplichte CI, Vercel-deploys en de begrensde PGB-productiesmoke waren groen.
Deze afsluitings-PR brengt alleen historie en documentatie terug naar `preview`; hij wijzigt geen
productiecode.

## 2. Nieuwe functionaliteit

| Onderdeel | Resultaat | Herkomst |
|---|---|---|
| Versie-identiteit | Opaque document-, passage- en citation-identiteit met requestcorrelatie en V5-herlezing | #367 / PR #379 |
| Zoeken en vergelijken | `/zoeken` en `/vergelijk` via dezelfde centrale retrievalorkestratie, serverscope, PII-poort, deadline/cancellation en audit | #369 / PR #381 |
| Microsoft-adapterbewijs | Hermetische adapterstub voor capabilities, versie-/rechtenbewijs, foutnormalisatie en truncatie | #370 / PR #380 |
| Evidence en modelcontext | Vijf evidencelezingen en 26 modelcontextlezingen achter typed, begrensde en inhoudsarm geaudite grenzen | #368 / PR's #378 en #382 |

## 3. Gewijzigde functionaliteit

| Onderdeel | Wijziging | Impact |
|---|---|---|
| Retrievalconsumenten | Route- en evidencelezingen gebruiken de centrale contractgrens | Eén scope-, versie-, cap-, PII- en afbreekdiscipline |
| Vergelijkingsaudit | Gebruikte opaque evidence en uitvoeringsmetadata worden duurzaam vastgelegd | Herleidbaar zonder inhoud in het operationele spoor |
| Modelcontext | Providerdata blijft gescheiden van vertrouwde systeemregels en wordt vóór renderen geneutraliseerd en begrensd | Fail-closed bij onvolledig bewijs of gewijzigde bronstand |

## 4. Technische wijzigingen

| Onderdeel | Wijziging | Impact |
|---|---|---|
| Productiecode | De reeds op Preview geaccepteerde fase-4-code is via PR #384 gepromoveerd | Geen Microsoftactivering of nieuwe live connector |
| Database | Drie additieve auditprojectiemigraties, in vastgelegde volgorde toegepast | Geen destructieve dataomzetting |
| Afsluitings-PR | Alleen Markdown-documentatie plus reconciliatie van de productiehistorie | Geen code, migratie of configuratiewijziging |

## 5. Architectuurimpact

| Component | Wijziging | Landschapsimpact | Documentatie |
|---|---|---|---|
| Retrievalorkestratie | Centrale contractgrens ook voor zoeken, vergelijken en evidence | Minder directe gegevenspaden | 00–09-addenda en HANDOVER |
| Microsoftadapter | Alleen hermetische testimplementatie | Geen Graph-, Entra- of SharePointproductiepad toegevoegd | Expliciet als niet-bedraad vastgelegd |
| Audit | Opaque identiteit en contentsvrije projecties uitgebreid | Bestaande basis-/bron-/inhoudsscheiding blijft leidend | Objectmodel- en security-addenda |

## 6. Security/compliance-impact

| Onderdeel | Borging | Restrisico / vervolg |
|---|---|---|
| Tenantgrens | Serverside fonds-/actorscope, RLS en geautomatiseerde cross-tenantsuites groen | Negatieve live accountwissel niet afzonderlijk uitgevoerd |
| Bronbewijs | V1–V5, actuele-versieherlezing en opaque lokale referenties | Echte Graph-intrekking tijdens verzoek blijft voorwaarde voor latere activering |
| Inhoudsminimalisatie | PII/injectie-neutralisatie, caps en inhoudsvrije auditprojecties | Menselijke controle blijft nodig bij Microsoftactivering |
| Afbreken | Eén requestbrede deadline/cancellation tot en met retrieval, evidence en vergelijking | Runtime-logruis op de eerste chatbeurt volgt apart in #386 |

## 7. Database, objectmodel en datadictionary

De volgende productiebytes zijn in deze volgorde toegepast:

| Migratie | SHA-256 | Productiecontrole |
|---|---|---|
| `2026_09_11_369_vergelijk_retrieval_audit.sql` | `aac2ff587c148d94b361964751cb4b524d4c717e6ff0fc609e7fcd6ed3cdda14` | T5-vergelijking groen |
| `2026_09_11_z367_retrieval_identiteit_auditprojectie.sql` | `89ca2e1d33a11e6600b3e40ca522bfbe594f16c151cf179514ba55c8866427ae` | retrieval-identiteit groen |
| `2026_09_12_368_evidence_auditprojectie.sql` | `8e205d7508d4ee1190d3b392ab49abf8f7cfa0c1af736537d38b45a9bad2a4f3` | evidenceprojectie groen |

Ook R1 structurele gates, V3 grants en de SECURITY DEFINER self-gate waren groen. De #367- en
#368-bestanden zijn bij handmatige toepassing als één expliciete transactie uitgevoerd; #369 is
zelf-transactioneel. De volledige destructieve cross-tenantrunner is bewust niet op Productie
gedraaid; dezelfde runner was lokaal en in PR-CI groen. Er bleven geen tijdelijke testtabellen
achter.

## 8. Testresultaten

| Testgebied | Status | Bewijs / opmerking |
|---|---|---|
| Productiemerge | Groen | PR #384; `main` op `3a6d9de`; verplichte postmergechecks groen |
| Voorafgaande release | Uitgevoerd | Productiecommit `09d473f`; productiesmoke van 11 september geslaagd en afzonderlijk vastgelegd |
| Database/RLS/grants | Groen | Drie specifieke checks, R1, V3 en SECURITY DEFINER self-gate |
| Vercel app | Groen | `dpl_8S5UsM6DtpqfKLw5PNjcSe5ywkGR`, `Ready`, productiecommit `3a6d9de` |
| Vercel beheer | Groen | `dpl_7hcuTjv5bV7H4MWh9Pw9BkrTFpF1`, `Ready` |
| Publieke health | Groen | app, PGB en beheer antwoordden `{"ok":true}` |
| Bestaande tenant/UI | Groen, beperkt | Geldige PGB-sessie voor `Stichting Pensioenfonds PGB`; tenant en rol correct |
| Zoeken | Groen | `/zoeken` op `ORION-4827` vond twee synthetische documenten |
| Chat/evidence | Groen | Correct antwoord `ORION-4827`; bron `PGB ingest-worker productietest`, pagina 1 |
| Governance/audit | Groen | Eén terugvraag en één generatie als twee nieuwe inhoudsarme regels; generatie met tien bronnen |
| Productiesignalen | Groen met opvolging | 0 app errors, 0 critical/high errors, 0 gatewaylogschrijffouten en 0 niet-OK gatewaycalls; één fail-safe reflectielog wordt gevolgd in #386 |
| Runtime 5xx | Groen | Geen 5xx in app- of beheerlogs rond de smoke |
| Positieve live vergelijking | Niet afzonderlijk uitgevoerd | Geen extra veilige productiefixture aangemaakt |
| Verse wachtwoordlogin | Niet afzonderlijk uitgevoerd | Bestaande geldige PGB-sessie hergebruikt |
| Negatieve live cross-tenantaccounttest | Niet afzonderlijk uitgevoerd | Destructieve runner niet op Productie; lokale en CI-isolatiebewijzen groen |
| Microsoft/Graph/Outlook/SharePoint | Niet afzonderlijk uitgevoerd | Microsoft blijft uit en de adapter is niet product-bedraad |

Tijdens de eerste chatbeurt verscheen `Reflectietransitie geweigerd of mislukt:
gesprek_niet_gevonden` op error-niveau, terwijl de route HTTP 200 en het juiste antwoord leverde. De
aanroep bestond al in `09d473f` en is dus geen aangetoonde regressie van #367–#370. Opvolging staat
in [#386](https://github.com/merlinijzerman/Bestuurdersportaal/issues/386); deze docs-only PR bevat
geen reparatie.

## 9. Bekende beperkingen

- De Microsoftstub bewijst het contract, niet een live Graphverbinding of productieadapter.
- Positieve live vergelijking, verse login, negatieve live accountwissel en Microsoftsmokes zijn
  niet uitgevoerd en mogen niet als releasebewijs worden gepresenteerd.
- De volledige cross-tenantrunner is vanwege zijn destructieve/testkarakter niet op Productie
  uitgevoerd.
- De as-built Word-momentopname en PNG/SVG-landschapsplaten zijn niet opnieuw gegenereerd; de
  Markdown-release-addenda zijn actueel.
- De fail-safe reflectietransitie veroorzaakt op een eerste chatbeurt error-level logruis (#386).

## 10. Openstaande acties

1. Deze docs-only afsluitings-PR reviewen en alleen na expliciet akkoord naar `preview` mergen.
2. #386 in een eigen worktree en code-PR oplossen en afzonderlijk accepteren.
3. #367–#370 na acceptatie van deze releasevastlegging administratief sluiten met verwijzing naar
   hun implementatie-PR's, productie-PR #384 en dit bewijs.
4. Live vergelijking, verse login, negatieve accountwissel en Microsoft/Graph alleen uitvoeren
   wanneer veilige fixtures, accounts en een afzonderlijk activeringsbesluit beschikbaar zijn.

## 11. Besluit

**Uitgevoerd en vrijgegeven met beperkingen.** Productiecommit `3a6d9de` bevat de geaccepteerde
Preview-bron bovenop de op 11 september uitgevoerde productiecommit `09d473f`. De migraties,
postmerge-CI, deployments, health, PGB zoeken, chat/evidence en contentsvrije governance-audit zijn
groen. De expliciet niet uitgevoerde smokes blijven buiten het bewijs. De afsluitings-PR is
docs-only en mag niet zonder nieuw opdrachtgeverakkoord naar `preview` worden gemerged.

## Templatecontrole

- Status, release, risico's, architectuur, technische schuld, roadmap, test/acceptatie en
  objectmodel zijn in de 00–09-set van een productie-addendum voorzien.
- Nieuwe auditprojecties: exacte productiebytes, volgorde en eindchecks vastgelegd; geen volledige
  destructieve cross-tenantrun op Productie.
- Visualisaties: bestaande exports niet opnieuw gegenereerd; tekstuele architectuur- en
  datastroomaddenda zijn leidend.
- As-built Word-document: niet opnieuw gegenereerd; de actuele Markdownset is leidend voor deze
  release-afsluiting.
