# Preview-runbook — vraagrouter en documentdekking

**Datum:** 19 augustus 2026
**Besluit:** 0184
**Status:** lokale implementatie gereed; externe Preview-handelingen nog niet uitgevoerd

## Doel

Dit runbook brengt de vraagrouter gecontroleerd van de lokale featurebranch naar
de geïsoleerde Preview-omgeving. Productie blijft ongewijzigd en alle drie de
routerflags blijven uit totdat het bijbehorende acceptatiepunt groen is.

## Actuele uitgangssituatie op 19 augustus 2026

- Productie draait in Vercel op `main` commit `806df50` en rapporteert `Ready`.
- De lokale branch `codex/vraagrouter-documentdekking` bevat nog niet-gecommitte
  wijzigingen en loopt één niet-overlappende backup-/restorecommit achter op
  `origin/main`.
- De vaste GitHub-branch `preview` loopt 44 commits achter op `origin/main` en
  moet vóór deze feature eerst naar de actuele Productiebaseline worden gebracht.
- Vercel custom environment `preview-stable` volgt de GitHub-branch `preview` en
  bevat de Preview-AI- en Supabasevariabelen. Losse featurebranches krijgen niet
  automatisch alle AI-variabelen.
- Supabase-project `bestuurdersportaal-preview` is `Healthy`.
- De vier vaste app-Previewdomeinen wijzen momenteel naar
  `security/pentest-critical-high`. Wijzig die toewijzing niet voordat de eigenaar
  van die securitytest de domeinen heeft vrijgegeven.

## Fase 0 — coördinatie en Git-baseline

1. Laat bevestigen dat de security-/pentestsmoke op de vier Previewdomeinen klaar
   is en wie tijdens de routeracceptatie rollbackverantwoordelijke is.
2. Selecteer in GitHub Desktop de worktree
   `mvp-vraagrouter-documentdekking` en commit de vraagrouterwijzigingen op
   `codex/vraagrouter-documentdekking`. Gebruik geen terminalcommit.
3. Fetch `origin` en werk de featurebranch in GitHub Desktop bij vanaf `main`.
   De huidige extra main-commit raakt alleen backup-/restore-scripts; verifieer
   desalniettemin opnieuw de volledige testset.
4. Breng daarna de vaste branch `preview` afzonderlijk als fast-forward naar
   `origin/main`. Dit voorkomt dat de feature-PR 44 reeds geproduceerde commits
   als eigen wijziging presenteert.
5. Push de featurebranch en open een PR naar `preview`. Merge nog niet zolang de
   migratie en de flags-uit rollbacksmoke niet zijn voorbereid.

## Fase 1 — database eerst

1. Neem een herstelbaar Preview-config-/backupbewijs op.
2. Voer in de SQL Editor van uitsluitend `bestuurdersportaal-preview` uit:
   `supabase/migrations/2026_08_17_vraagrouter_documentdekking.sql`.
3. Draai daarna de volledige gebundelde databasecontrole met een wegwerpbare
   testdatabase:

   ```bash
   TEST_DATABASE_URL='<wegwerpbare-postgres-url>' \
     XTENANT_REQUIRE_DB=1 bash scripts/cross-tenant-ci.sh
   ```

4. Draai tegen Preview zelf de structurele gates
   `supabase/checks/2026_07_31_r1_structurele_gates.sql` en leg alle resultaten
   A1, A2, B, C, C2, E, F, G, H en D vast.
5. Controleer met sectie A van
   `supabase/checks/2026_08_19_vraagrouter_preview_acceptatie.sql` dat de nieuwe
   auditprojectie aanwezig is en document-id's niet op basisniveau verschijnen.

## Fase 2 — code deployen met flags uit

1. Merge de goedgekeurde feature-PR naar `preview`. Alleen deze vaste branch
   krijgt de `preview-stable` AI-configuratie.
2. Wacht tot de appdeployment `Ready` is en alle GitHub-checks groen zijn.
3. Gebruik eerst de Vercel deployment-URL. Zet de vaste Previewdomeinen alleen
   terug op de routerdeployment nadat de securitytest ze expliciet heeft
   vrijgegeven en Auth-callbacks zijn gecontroleerd.
4. Log als beheerder/voorzitter in op één synthetisch Previewfonds en controleer
   in **Beheer → Fondsconfiguratie** dat alle drie routerflags effectief uitstaan.
5. Zet `vraagrouter_v2` kort aan en weer uit. Controleer in
   `fonds_config_log` dat beide mutaties append-only zijn vastgelegd en dat na
   uitzetten de bestaande assistentwerking terug is.

## Fase 3 — Preview A: deterministische router

1. Kies precies één synthetisch fonds; gebruik bij voorkeur de generieke
   Meridiaan-sandbox.
2. Zet uitsluitend `vraagrouter_v2` aan. Laat
   `volledige_analyse_vervolg` en `vraagrouter_model` uit.
3. Voer de gelabelde routerset en de positieve/negatieve voorbeelden uit.
4. Voer RQ-01 vijfmaal uit met exact de vastgelegde vraag en het synthetische
   transitieplan `HORIZON-TRANSITIEPLAN-ROUTER-001`.
5. Draai de read-only acceptatiequery. Groen betekent minimaal:
   - vijf RQ-01-runs met dezelfde volledige route;
   - alle vijf inhoudsthema's aanwezig;
   - feitelijke dekking `volledig`, of zichtbaar `gedeeltelijk` bij een cap/fout;
   - geen onterechte documentbrede afwezigheidsclaim;
   - geen modelroutercall;
   - bron- en tenantgrenzen intact.
6. Leg routertijd, TTFT, modeltijd, tokens, gedeeltelijke runs en terugvallen vast.
   `duur_model_ms` is nadrukkelijk geen volledige requestdoorlooptijd; neem de
   totale doorlooptijd aanvullend uit de gecontroleerde browser-/Vercelmeting op.

## Fase 4 — Preview B: volledige vervolgactie

1. Laat `vraagrouter_v2` aan en zet nu
   `volledige_analyse_vervolg` aan.
2. Controleer een gerichte, niet-feitelijke vraag over precies één toegankelijk
   document. Verwacht de expliciete actie **Volledige analyse uitvoeren** met de
   waarschuwing over tijd en AI-verbruik.
3. Voer de actie uit en controleer dat dezelfde vraag en hetzelfde document
   server-side opnieuw zijn gevalideerd en dat de nieuwe auditregel naar de
   oorspronkelijke beperkte run verwijst.
4. Test daarnaast een feitvraag, een te groot document en een geforceerde
   gedeeltelijke/foutuitkomst. De actie mag niet bij de feitvraag verschijnen;
   een onvolledige run mag nooit `volledig` heten.

## Fase 5 — modelrouter alleen bij bewezen meerwaarde

Laat `vraagrouter_model` uit tenzij de ambigue meetset aantoont dat activeren:

- minder foutieve/onbekende routes geeft;
- geen verkeerde document- of fondsscope kiest;
- binnen de afgesproken latency- en tokenmarge blijft;
- bij timeout en schemafout aantoonbaar targeted terugvalt.

Zonder dit bewijs wordt deze flag niet geactiveerd, ook niet in Productie.

## Rollback

1. Zet `vraagrouter_v2` uit; daardoor zijn de twee afhankelijke functies direct
   effectief uit.
2. Verifieer één gerichte feitvraag en één documentvraag op het bestaande pad.
3. Bij een auditprojectieprobleem: laat de codeflags uit en beoordeel pas daarna
   de meegeleverde SQL-rollback. Draai die nooit routinematig en nooit vóór
   veiligstellen van het bewijs.
4. Herstel alleen na afstemming de eerdere Vercel-domeintoewijzing. Productie-
   domeinen en Productie-Supabase worden niet aangeraakt.

## Productiepoort

Productie blijft **NO-GO** totdat databasegates, vijf RQ-01-runs, live auditcontrole,
flagrollback en operationele meting groen zijn. Daarna volgt een afzonderlijk
besluit voor één fonds met alleen de deterministische router, 24–48 uur observatie
en opnieuw een expliciete go/no-go.
