# Microsoft 365 fase 5 — PGB Preview-retrievalsmoke

Deze runner is uitsluitend bedoeld om de drie kandidaatstrategieën uit #403 live te vergelijken met de synthetische PGB354-set uit #385: DriveItem Search, Microsoft Search met DriveItem-verificatie en hun centraal ontdubbelde meetunie. Hij is geen productieadapter en is niet aangesloten op chat, zoeken, vergelijken of de AI-gateway.

## Voorwaarden

- De deployment draait met `SEED_DOELOMGEVING=preview` én `VERCEL_ENV=preview`.
- Het fonds heeft slug `pgb`.
- Het Microsoft-integratieprofiel, de connectorpilot en `microsoft_sharepoint_fase3` staan aan.
- De ingelogde gebruiker is beheerder en heeft een eigen gedelegeerde `Sites.Selected`-verbinding in dezelfde Entra-tenant als de geconfigureerde fondsbron. De gebruiker die de fondsbron oorspronkelijk koos is auditprovenance, geen vereiste uitvoeridentiteit.
- De PGB354-fixtures staan in de gekozen bron en de rechten zijn hersteld naar de nulstand.

Zet daarna alleen voor PGB de extra vlag aan. Gebruik de normale beheerfunctie of vul bij handmatige SQL altijd de echte actor in, zodat de bestaande config-audittrigger de wijziging vastlegt:

```sql
insert into public.fonds_feature_flags(fonds_id, flag_key, waarde, versie, bijgewerkt, bijgewerkt_door)
select f.id, 'microsoft_sharepoint_retrieval_spike', 'true'::jsonb,
       coalesce(h.versie, 0) + 1, now(), '<beheerder-user-id>'::uuid
from public.fondsen f
left join public.fonds_feature_flags h
  on h.fonds_id = f.id and h.flag_key = 'microsoft_sharepoint_retrieval_spike'
where f.slug = 'pgb'
on conflict (fonds_id, flag_key) do update
set waarde = excluded.waarde, versie = public.fonds_feature_flags.versie + 1,
    bijgewerkt = now(), bijgewerkt_door = excluded.bijgewerkt_door;
```

## Basisvergelijking

1. Stel read-only vast dat de SharePoint-index gereed is: iedere fixture moet zowel op bestandsnaam als op de unieke inhoudsterm vindbaar zijn. Alleen een bestandsnaamtreffer is `index_niet_gereed`; stop dan zonder adapter- of rechtenconclusie.
2. Leg vóór de eerste Microsoft Search-call een afzonderlijk consentbesluit vast. Deze code voegt geen scope of consent toe. Zonder dat besluit worden alleen S00 en de DriveItem-diagnostiek uitgevoerd.
   Na deployment van #405 gebruikt de beheerder daarvoor uitsluitend de knop
   **Tijdelijke Microsoft Search-toestemming verlenen** op deze pagina. De route
   vraagt delegated `Files.Read.All` alleen achter alle Preview-/PGB-poorten en
   keert terug naar dezelfde smoke-pagina. Kies de vastgelegde testidentiteit,
   niet het tenantbeheeraccount.
3. Open `/beheer/microsoft-sharepoint-retrieval` op de PGB Preview-host.
4. Voer eerst S00 uit. Deze vaste inhoudsloze DriveItem-search onderscheidt een ongeldige Graph-vraag (`graph_bad_request`) van ontbrekende toestemming (`graph_toestemming`) en een toegestane zoekactie (`geslaagd`), zonder documenten te openen of downloaden.
5. Controleer vóór én na de meetreeks expliciet dat `microsoft_sharepoint_retrieval_spike=false` is. Zet de vlag alleen voor de daadwerkelijke meetreeks aan en gebruik de geaudite beheerroute.
6. Na een groene S00 kan de korte Drive-controle worden gebruikt: S02, S03, S04 en S04H één keer met de vaste termen uit de acceptatieset. Dit zijn vier diagnostische metingen binnen het endpointbudget.
7. Controleer de inhoud voordat een volledige vergelijking start: S02 vindt alleen `PGB354-DOC-001`, S03 vindt `PGB354-DOC-001` en `PGB354-PPT-001`, S04 vindt alleen de actuele `PGB354-PDF-001`, en S04H vindt alleen de historische `PGB354-PDF-002`. De runner vergelijkt de gevonden fixturecodes exact met deze vooraf vastgelegde bronset; een ontbrekende of extra fixture is `acceptatie_afwijking/onverwachte_bronset`, ook als recall 1 is. Een door Graph aangeboden maar door het beleid uitgesloten historische kandidaat telt onder `afwijzing_actualiteit` en mag geen content- of previewcall veroorzaken.
8. Alleen als deze vier inhoudelijk groen zijn, start de basisvergelijking. Zij voert S02, S03, S04 en S04H via `drive_search_extract`, `microsoft_search` en `candidate_union` uit, twee rondes per route: 24 metingen.
9. Kopieer de veilige JSON-uitvoer. Controleer per route exacte bronset, recall, kandidaatprecision vóór verificatie (`precision`, met `kandidatenVoorVerificatie` als noemer), MRR/nDCG, locator-/versie-/previewdekking, verificatiekandidaten, downloads, latency, Graph-calls, bytes, throttles en foutcategorieën.
10. Stop bij onverwachte inhoud of een toestemming-, tenant-, actor-, configuratie-, timeout- of cancellationfout. Voer S08 en S09 dan niet uit en verruim geen Graph-scope als onderdeel van deze smoke.

### Microsoft Search-scope diagnostiek na een nulmeting

Wanneer S02 met geldig tijdelijk Search-consent nul kandidaten geeft, voer dan
niet meteen de 24-metingen uit. Gebruik eerst uitsluitend de knop
**Zoekscope-diagnostiek starten (3 metingen)**. Die herhaalt S02 in vaste
volgorde:

1. `tenant` — geen bronfilter in de Microsoft Search-query;
2. `site_list` — `SiteID` uit de fondsbron en een live gelezen `ListID` van de
   gebonden drive;
3. `path` — de bestaande root-URL.

De uitvoer en audit bevatten alleen de scopecode, tellingen en fixturecodes.
Een onbekende tenanttreffer valt als `mapping` af en mag geen DriveItem-,
content- of previewcall veroorzaken. Interpretatie:

- alleen `tenant` vindt de fixture: onderzoek de site-/lijstidentiteit en het
  indexveld;
- `tenant` en `site_list` vinden de fixture, `path` niet: het path-filter of de
  geïndexeerde URL-vorm is de afwijking;
- alle drie leveren nul: onderzoek actorafhankelijke security trimming of
  Graph Search-indexzichtbaarheid;
- `path` vindt de fixture: de eerdere nulmeting was niet stabiel; herhaal eerst
  dezelfde diagnostiek voordat de 24-metingen worden vrijgegeven.

Dezelfde tijdelijke consent- en herstelprocedure blijft gelden. Deze
diagnostiek verbreedt geen apppermission of fondsflag.

De audit mag voor kandidaatdiagnostiek exact deze platte velden bevatten: `afwijzing_mapping`, `afwijzing_binding`, `afwijzing_root`, `afwijzing_rechten_configuratie`, `afwijzing_versie`, `afwijzing_extractie`, `afwijzing_preview` en `afwijzing_actualiteit`. Iedere waarde is een niet-negatief geheel getal; geneste afwijzingsobjecten of andere dynamische sleutels zijn niet toegestaan.

## S08 — intrekking tijdens het verzoek

1. Start S08. De server doet eerst zoeken, de eerste rechten-/versiecontrole en zo nodig de contentextractie.
2. Wacht op de SSE-melding `wacht_op_intrekking`.
3. Trek in SharePoint de toegang van rol A tot `04 Beperkt bestuur` in. Wijzig niets aan andere mappen.
4. De server wacht 120 seconden met hartslagen en doet daarna de laatste live controle.
5. Verwacht nul gevonden fixtures en een fail-closed foutcategorie. `PGB354-DOC-005` mag niet in een passage of auditinhoud terechtkomen.

## S09 — replay terwijl toegang ontbreekt

Laat de toegang ingetrokken en start S09 als nieuw verzoek. Verwacht opnieuw nul fixtures. Dit verzoek bouwt zijn live listing en Graph-client opnieuw op; er is geen resultaat- of contentcache tussen S08 en S09.

## Herstel

1. Herstel de toegang van rol A tot `04 Beperkt bestuur`.
2. Wacht op Microsoft-propagatie en voer `S08R` uit. Verwacht `PGB354-DOC-005` als gevonden fixture.
3. Zet de extra vlag direct uit met dezelfde geaudite wijzigingsroute (of bovenstaande upsert met `false`) en verifieer expliciet dat de effectieve waarde `false` is.
4. Controleer `microsoft_private.audit_log`: alleen veilige meetcategorieën, aantallen, timing en bytes; nooit vraagtekst, passages, tokens, URL's of externe identifiers.
5. Verwijder `Files.Read.All` uit appregistratie
   `067351f2-693a-4bd9-ae00-6ff32bc49260`, trek de delegated grant van de
   testidentiteit in en verleen daarna opnieuw de gewone SharePoint-toestemming.
   Controleer dat de private scopes geen `Files.Read.All` meer bevatten en dat
   S00 via `Sites.Selected` opnieuw slaagt.

## Stopcriteria en rollback

- Buiten Preview, buiten PGB of zonder alle poorten hoort de route neutraal 404 te geven.
- Bij rate-limitstoring of overschrijding faalt de route gesloten.
- Bij een browserdisconnect breekt het request af; de wachttimer en Graph-calls gaan niet door.
- Rollback bestaat uit de extra vlag uitzetten. Er is geen migratie en er zijn geen blijvende inhoud, chunks of embeddings toegevoegd.
