# Releasebewijs 13 september 2026 — M365 fase 4 op Preview

**Release-id:** 2026-09-13 / Preview `ca57f5c`  
**Productiebasis:** `main` op `09d473f`  
**Status:** Preview geaccepteerd met expliciete live-smokebeperkingen; nog niet naar Productie

## 1. Samenvatting

M365 fase 4 is via vijf afzonderlijke PR's in `preview` geïntegreerd. De actuele Preview-commit
`ca57f5c` bevat productiecommit `09d473f` als ancestor. Deze acceptatieronde wijzigt geen
productiecode: zij legt de gecombineerde technische controles, live Preview-waarnemingen en
resterende voorwaarden voor een latere `preview` → `main`-promotie vast.

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
| Code | Retrievalcontract, orkestratie, adapters, readers, routes en contract-/karakteriseringstests | Alleen reeds via #378–#382 geïntegreerde Preview-code |
| Database | Drie additieve forwardmigraties met bijpassende rollbacks voor vergelijk-, identiteit- en evidence-auditprojecties | Geen destructieve datamigratie |
| Deze PR | Alleen Markdown-documentatie | Geen productiecode, migratie of configuratie |

## 5. Architectuurimpact

| Component | Wijziging | Landschapsimpact | Documentatie |
|---|---|---|---|
| Retrievalorkestratie | Centrale contractgrens nu ook voor zoeken, vergelijken en evidence | Minder directe gegevenspaden | 00–09-addenda en HANDOVER |
| Microsoftadapter | Alleen hermetische testimplementatie | Geen Graph-, Entra- of SharePointproductiepad toegevoegd | Expliciet als niet-bedraad vastgelegd |
| Audit | Opaque identiteit en contentsvrije projecties uitgebreid | Bestaande basis-/bron-/inhoudsscheiding blijft leidend | Objectmodel- en security-addenda |

## 6. Security/compliance-impact

| Onderdeel | Borging | Restrisico / vervolg |
|---|---|---|
| Tenantgrens | Serverside fonds-/actorscope, RLS en volledige cross-tenantsuite groen | Negatieve live accountwissel niet afzonderlijk uitgevoerd |
| Bronbewijs | V1–V5, actuele-versieherlezing en opaque lokale referenties | Echte Graph-intrekking tijdens verzoek blijft live voorwaarde |
| Inhoudsminimalisatie | PII/injectie-neutralisatie, caps en inhoudsvrije auditprojecties | Menselijke controle blijft nodig bij Microsoftactivering |
| Afbreken | Eén requestbrede deadline/cancellation tot en met retrieval, evidence en vergelijking | Operationele timeoutwaarden per omgeving blijven monitoren |

## 7. Database, objectmodel en datadictionary

| Migratie | Wijziging | Rollbackbewijs |
|---|---|---|
| `2026_09_11_369_vergelijk_retrieval_audit.sql` | Vergelijkrun/-resultaat en auditfunctie uitgebreid met opaque retrievalbewijs | Oude kolom-/functievorm gecontroleerd, daarna vooruit hersteld |
| `2026_09_11_z367_retrieval_identiteit_auditprojectie.sql` | Identiteit-/correlatieprojectie voor retrievalaudit | Nieuwe projectie afwezig na rollback, groen na reapply |
| `2026_09_12_368_evidence_auditprojectie.sql` | Contentsvrije evidence-/modelcontextprojectie | Nieuwe projectie afwezig na rollback, groen na reapply |

De volledige migratiekaart telde 221 forwards, 196 rollbacks en 15 seeds. De drie fase-4-migraties
zijn op een schone lokale Supabase-stack in afhankelijkheidsvolgorde toegepast, teruggerold,
tegen de oude vorm gecontroleerd en opnieuw toegepast. Daarna waren de specifieke SQL-checks en de
volledige DB/RLS/grants/cross-tenantketen groen.

## 8. Testresultaten

| Testgebied | Status | Bewijs / opmerking |
|---|---|---|
| Preview-commit | Groen | `ca57f5c`; acht GitHub-checkruns groen en beide Vercel-deploystatussen `success` |
| Secrets | Groen | `npm run security:secrets`; geen bekende committed secrets |
| Structuur/boundaries | Groen | `npm run lint:boundaries`; migratiekaartstructuur groen |
| Database/RLS/grants | Groen | Volledige §15-suite, 725/725 app-grensgevallen en exacte grantsallowlist |
| Migratierehearsal | Groen | forward → rollback → oude-vormcheck → forward → drie specifieke checks |
| Unit/component/contract | Groen | `npm test`; lokale stubtests na toegestane loopbackbinding groen |
| Build/typecheck | Groen | Next.js-productiebuild en typecontrole met lokale Supabase-buildwaarden |
| Quality/thema | Groen | quality-baseline zonder nieuwe bevindingen; 0 harde themacontrastovertredingen |
| Live tenant/UI | Groen, beperkt | Bestaande geldige sessies op Meridiaan en PGB toonden de juiste tenantidentiteit |
| Live zoeken | Groen | Zoekvraag vond één fragment uit `PGB AI-gateway smoketest` met `ORION-4827` |
| Live chat/evidence | Groen | Fondsscope bevestigd; correct antwoord met bronkaart, pagina 1 en vastgesteld-status |
| Live governance/audit | Groen | Terugvraag en antwoord zichtbaar als twee inhoudsarme regels; antwoord gebruikt één bron |
| Live vergelijken | Niet afzonderlijk uitgevoerd | PGB had slechts één geschikt synthetisch document; geen tweede fixture aangemaakt |
| Verse wachtwoordlogin | Niet afzonderlijk uitgevoerd | Bestaande geldige tenantsessies zijn hergebruikt |
| Negatieve live cross-tenantaccounttest | Niet afzonderlijk uitgevoerd | Geautomatiseerde DB/app-isolatiesuite is wel volledig groen |
| Microsoft/Graph/Outlook/SharePoint | Niet afzonderlijk uitgevoerd | #370 is hermetisch en niet product-bedraad; Microsoft blijft standaard uit |

De eerste sandboxrun van build/tests strandde respectievelijk op geblokkeerde Google-Fonts-DNS,
ontbrekende lokale buildvariabelen en verboden loopbacklisteners. Herhaling met netwerktoegang,
lokale niet-productie-Supabasewaarden en toegestane hermetische listeners was groen. Lokaal draaide
Node 24 terwijl de repository Node 22 voorschrijft; de groene GitHub-checks op de Preview-commit
blijven daarom het beslissende Node-22-bewijs.

## 9. Bekende beperkingen

- De Microsoftstub bewijst het contract, niet een live Graphverbinding of productieadapter.
- Een positieve live vergelijking ontbreekt door de enkelvoudige PGB-testfixture; CI, database- en
  karakteriseringstests leveren wel het technische bewijs.
- De as-built Word-momentopname en bestaande PNG/SVG-landschapsplaten zijn niet opnieuw gegenereerd;
  de Markdown-release-addenda zijn actueel.
- Issues #367–#370 staan nog open totdat de productiepromotie en administratieve afsluiting apart
  zijn goedgekeurd.

## 10. Openstaande acties

1. Deze docs-only PR na review en expliciet akkoord naar `preview` mergen.
2. Daarna `origin/preview` opnieuw verversen en uitsluitend `preview` als bron voor de promotie-PR
   naar `main` gebruiken.
3. Vóór productiemerge de drie additieve migraties volgens de promotienotitie toepassen en de
   database-eindchecks herhalen.
4. Na productiedeploy health, bestaande appflows, zoeken, chat/evidence en audit opnieuw smoken.
5. Live vergelijking, verse login en Microsoft/Graph alleen uitvoeren wanneer passende fixtures,
   accounts en een afzonderlijk activeringsbesluit beschikbaar zijn.
6. Issues #367–#370 pas na geaccepteerde productie-uitrol sluiten of van expliciete vervolglabels
   voorzien.

## 11. Besluit

**Preview geaccepteerd met vastgelegde beperkingen; productiepromotie nog niet vrijgegeven.** De
gecombineerde code op `ca57f5c` doorstaat de relevante automatische, database- en live
Preview-controles. Deze documentatie-PR mag niet zonder opdrachtgeverakkoord worden gemerged; ook
de latere `preview` → `main`-PR vraagt een afzonderlijk akkoord.

## Templatecontrole

- Status, release, risico's, architectuur, functioneel ontwerp, technische schuld, security,
  roadmap, test/acceptatie en objectmodel: voorzien van release-addenda in de 00–09-set.
- Nieuwe tabellen/relaties/statussen/rechten/RLS/AI-audit: uitsluitend drie auditprojectiemigraties;
  voorwaarts, rollback, oude vorm en reapply bewezen.
- Visualisaties: bestaande exports niet opnieuw gegenereerd; de architectuur- en datastroomtekst is
  bijgewerkt en de afwijking staat expliciet in dit bewijs.
- As-built Word-document: niet opnieuw gegenereerd; de actuele Markdownset is leidend voor deze
  Preview-kandidaat en Word blijft een later milestone-artefact.
