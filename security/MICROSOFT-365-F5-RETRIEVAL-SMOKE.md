# Microsoft 365 fase 5 — PGB Preview-retrievalsmoke

Deze runner is uitsluitend bedoeld om de twee routes uit #353 live te vergelijken met de synthetische PGB354-set uit #385. Hij is geen productieadapter en is niet aangesloten op chat, zoeken, vergelijken of de AI-gateway.

## Voorwaarden

- De deployment draait met `SEED_DOELOMGEVING=preview` én `VERCEL_ENV=preview`.
- Het fonds heeft slug `pgb`.
- Het Microsoft-integratieprofiel, de connectorpilot en `microsoft_sharepoint_fase3` staan aan.
- De ingelogde gebruiker is beheerder en diens gedelegeerde `Sites.Selected`-verbinding hoort bij de geconfigureerde SharePoint-bron.
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

1. Open `/beheer/microsoft-sharepoint-retrieval` op de PGB Preview-host.
2. Start de basisvergelijking. Zij voert S02, S03 en S04 via `drive_search_extract` en `microsoft_search` uit, drie rondes per route (18 metingen).
3. Kopieer de veilige JSON-uitvoer. Controleer per route recall, locator-/versie-/previewdekking, latency, Graph-calls, bytes, throttles en foutcategorieën.
4. Stop bij een onverwachte toestemming-, tenant-, actor- of configuratiefout. Verruim geen Graph-scope als onderdeel van deze smoke.

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
3. Zet de extra vlag direct uit met dezelfde geaudite wijzigingsroute (of bovenstaande upsert met `false`).
4. Controleer `microsoft_private.audit_log`: alleen veilige meetcategorieën, aantallen, timing en bytes; nooit vraagtekst, passages, tokens, URL's of externe identifiers.

## Stopcriteria en rollback

- Buiten Preview, buiten PGB of zonder alle poorten hoort de route neutraal 404 te geven.
- Bij rate-limitstoring of overschrijding faalt de route gesloten.
- Bij een browserdisconnect breekt het request af; de wachttimer en Graph-calls gaan niet door.
- Rollback bestaat uit de extra vlag uitzetten. Er is geen migratie en er zijn geen blijvende inhoud, chunks of embeddings toegevoegd.
