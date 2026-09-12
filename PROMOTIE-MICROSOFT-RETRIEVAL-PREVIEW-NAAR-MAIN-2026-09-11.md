# Promotie `preview` → `main` — Microsoft 365-fundament, AI-gateway en retrieval T2-1

**Peildatum:** 11 september 2026

**Releasebron:** `preview` op `4a61b78` na reconciliatie-PR #375

**Productiecommit:** `main` op **`09d473f`** (merge PR #373)

**Huidige delta na release:** geen inhoudelijke delta; `09d473f` is de productie-mergecommit van de beoordeelde Preview-stand.

**Releaseoordeel:** **UITGEVOERD MET VASTGELEGDE SMOKEBEPERKINGEN** — productieprovisioning, afzonderlijk opdrachtgeverakkoord, merge, deployments en niet-activerende productiesmoke zijn op 11 september 2026 afgerond. Microsoft-login, Outlook en SharePoint zijn niet op Productie geactiveerd.

De release brengt het duale productmodel naar productie: bestaande fondsen blijven op de eigen
variant werken; Microsoft-onderdelen worden per fonds afzonderlijk en standaard uit aangezet.
De AI-gateway is géén inerte pilotcode: de bestaande AI-paden lopen er na de deploy doorheen.
Daarom moeten de gatewayrol, databaseverbinding en migratie vóór de code-deploy gereed zijn.

---

## 1. Uitvoering en gesloten releasevoorwaarden

### Gesloten — `main` en `preview` zijn weer gelijkgericht

De productiehotfix #359 en de bredere Preview-ingestwijziging #358 zijn via PR #371
gereconcilieerd. De Preview-semantiek is behouden en met een regressietest vastgelegd:
één reservering per logische ingestjob, generieke ingest/OCR globaal gequoteerd en
fondsdocumenten fondsgebonden. Daarna is de rechtstreeks op `main` uitgebrachte website v0.8
(#365) via PR #372 zonder conflicten teruggebracht in `preview`.

Na een latere wijziging op `main` is ook PR #374 via reconciliatie-PR #375 in Preview opgenomen.
De promotiebron op `4a61b78` bevatte daardoor de volledige productiehistorie zonder een productiehotfix
of websitewijziging terug te draaien. PR #371, #372 en #375 waren groen, inclusief de relevante
cross-tenant/DB-, karakteriserings-, E2E- en Vercelcontroles.

### Gesloten — productie is vóór de code geprovisioneerd

Vóór de merge zijn vijf minimale databaserollen ingericht, elf migratie-/seedstappen met unieke
database-eindmarkers bevestigd, alle voorgeschreven database-/RLS-/grants-/securitycontroles groen
bevonden en de vier gatewayverbindingen als Production Secrets in beide Vercel-projecten gezet.
De beperkte rollen zijn ook daadwerkelijk via Supavisor/TLS getest. De vijf fondsen kregen samen
exact twintig AI-configuratieregels. Microsoft-login, connector, Outlook en SharePoint stonden voor
nul fondsen actief. Zie §5 voor de uitgevoerde volgorde.

---

## 2. Wat met deze release is gerealiseerd

### 2.1 Twee productvarianten als vertrekpunt

- Bestaande variant blijft werken met Supabase-opslag, uploads en de huidige documentpipeline.
- Microsoft-variant is additief en per fonds configureerbaar.
- Microsoft-vlaggen en loginmodus zijn standaard uit; geen fonds wordt door de migraties op
  `verplicht` gezet.

### 2.2 Microsoft-connector en Microsoft-login

- Geharde single-tenant connector met delegated Graph-toegang en versleutelde private tokenkluis.
- Microsoft-login op bestaande portaalaccounts, gebonden aan `tid + oid`, zonder koppelen op
  e-mailadres.
- Organisatiebreed loginbeleid `uit | optioneel | verplicht`, met beheerpagina, bindingsdekking,
  gecontroleerde intrekking, eenmalige herkoppeluitnodigingen en MFA-gebonden break-glass.
- Beperkte databaserol voor herstel/noodtoegang; rechtstreeks PostgREST- of Storagegebruik geeft
  geen volledige portaaltoegang.
- Positieve PGB Preview-smoke: koppelen en opnieuw inloggen met Microsoft op hetzelfde profiel.

### 2.3 Outlook read-only

- Delegated `Calendars.Read.Shared`, incrementele consent en één server-geverifieerde agenda.
- Begrensde `calendarView/delta`-synchronisatie met private cursor/run/event-koppeling.
- Alleen veilige afspraakvelden; geen body, bijlagen of deelnemersopslag.
- Outlook blijft fondsgebonden en achter een aparte featureflag.

### 2.4 SharePoint read-only en browserpreview

- `Sites.Selected`, server-geregistreerde kandidaatsites en fondsgebonden keuze van site,
  documentbibliotheek en map.
- Live documentenlijst met opaque fondsgebonden referenties; drive- en item-id blijven privé.
- Browserpreview via een kortlevende Graph-URL, `no-store`, beperkte CSP en sandbox-iframe.
- Bestaande uploadstraat blijft naast SharePoint beschikbaar.

### 2.5 Centrale, configureerbare AI-gateway

- Provider- en modelkeuze per fonds en taakgroep in een privaat schema.
- Anthropic-, OpenAI- en Mistral-adapters achter één typed contract; productiepaden gebruiken geen
  losse provider-SDK meer.
- Chat, samenvatting, context-prefix, semantische extractie, afschrift-/besluitconcept en AQLab
  lopen door de gateway.
- Per call een inhoudsvrije append-only gatewayregel; prompt, antwoord, documentinhoud en secrets
  komen niet in het operationele spoor.
- Retrieval en generatie hebben eigen deadlines en reageren op een verbroken clientverbinding;
  fail-safes starten na afbreken geen nieuw providerwerk.

### 2.6 Retrieval T2-1

- Providerneutraal `RetrievalAdapter`-contract en centrale orkestratie voor selectie, deduplicatie,
  citatie en auditmetadata.
- Harde kandidaat- en contextgrenzen; auditmetadata beschrijft exact wat het model zag.
- Toelatingspoort V1–V5 voor adapters die rechtenbewijs claimen: resultaat, actor, verzoek,
  tijdvenster en actuele bronregistratie moeten overeenkomen; twijfel weigert.
- De hybride zoekfusie heeft nu een begrensde verslapte OR-poging wanneer de strikte FTS-arm niets
  bijdraagt maar de vectorarm wel kandidaten heeft (G-12).

---

## 3. Preview-bewijs

### Automatisch

- Alle PR-checks van T1/T1b/T2-1 groen, inclusief cross-tenant/RLS, security baseline,
  karakterisering, boundaries en Vercel-builds.
- 390 FTS-goldens en 4 hybride goldens, driemaal per pad; alleen de vooraf beoordeelde G-12-golden
  wijzigde semantisch.
- Hermetische en echte-runtime-tests voor cancellation, timeout, toelatingspoort, intrekking tijdens
  een verzoek en het hybride terugvalpad.

### Waargenomen op PGB Preview — 11 september 2026

- Preview-deploy op het vaste PGB-domein: `READY`.
- Centrale gatewaycall naar Anthropic: `ok`, met provider/model/configversie en tokenaantallen in
  `ai_gateway_private.gateway_log`.
- Preview-Mistralsleutel geroteerd en uitsluitend op de twee `preview-stable`-projecten gezet;
  op dit Preview-meetmoment was Productie nog niet gewijzigd.
- Ingestworker na rotatie: 2 claims, 2 afgerond, 0 mislukt.
- Synthetisch document `PGB AI-gateway smoketest`: `beschikbaar`, 1 chunk, 1 embedding, job
  `geslaagd`.
- Positieve G-12-smoke met `Commissie Orion controlecode kwartaalrapportage`:
  - antwoord vond en citeerde het vastgestelde fondsdocument;
  - juiste controlecode `ORION-4827`;
  - niet-bestaande koppeling met kwartaalrapportage werd expliciet ontkend;
  - audit: `methode = hybride_rrf`, `embedding_query_success = true`;
  - geselecteerde chunk: `vec_rang = 1` en `fts_rang = 1`;
  - inhoudelijk spoor bevat `poging_herkomst = verslapt` en de primaire plus verslapte poging;
  - vraag-afgeleide querytekst staat alleen in `governance_log_inhoud`, niet in het vaste spoor.

### Waargenomen op PGB Productie — 11 september 2026

- PR #373 gemerged als `09d473f`; beide Vercel-productiedeployments werden `Ready` en alle
  workflows op de mergecommit waren groen.
- Publieke healthcheck: `{"ok":true}`.
- Bestaande PGB-productiesessie en portaal-UI werkten op de nieuwe deployment.
- Twee chatgeneraties en één contextprefix-call liepen via Anthropic en eindigden `ok`;
  `gateway_log_fouten_24u = 0`.
- Nieuw synthetisch PDF-document: `beschikbaar`, 1 pagina, 1 chunk, 1 embedding en 1
  contextprefix; de assistent vond `DELTA-0911` en citeerde correct het nieuwe document.
- Microsoft-login, Outlook en SharePoint bleven uit; op de profielpagina verscheen geen
  Microsoftbediening.
- **Niet afzonderlijk uitgevoerd:** een verse wachtwoordlogin, omdat de bestaande sessie geldig
  was; en afschrift-/besluitconceptgeneratie, omdat PGB geen geschikte synthetische
  vergadering/notulenfixture had. Deze twee beperkingen zijn geen bewijs van uitvoering en blijven
  daarom expliciet als niet uitgevoerd geregistreerd.

---

## 4. Wat na deze release nog niet af is

### Eerstvolgende retrievaltranches

| Tranche | Nog te bouwen |
|---|---|
| T2-2 | [#369](https://github.com/merlinijzerman/Bestuurdersportaal/issues/369) — `/zoeken` en `/vergelijk` volledig door de orkestratie; scopevalidatie, PII-gate en één bronvorm |
| T2-3 | [#367](https://github.com/merlinijzerman/Bestuurdersportaal/issues/367) — volledige versie-identiteit per passage en `correlationId` in retrievalmetadata |
| T2-4 | [#368](https://github.com/merlinijzerman/Bestuurdersportaal/issues/368) — vijf directe evidencelezingen achter het contract; typed en begrensd contextcontract voor de overige modelcontext |
| T2-5 | [#370](https://github.com/merlinijzerman/Bestuurdersportaal/issues/370) — Microsoft-adapterstub en contracttests voor capabilities, versie-/rechtenbewijs, truncatie en alle foutcategorieën |

### SharePoint live retrieval

- Spike #353 heeft het Graph-prototype en de Azure AI Search-afweging opgeleverd, maar is nog
  **NO-GO voor productiewiring**.
- De drie echte PGB-meetrondes uit #354 ontbreken nog: documentbibliotheek/acceptatieset, tweede
  testidentiteit, rechtenintrekking en latency/call/byte-metingen.
- Daarna pas de keuze en bouw van de productieadapter: eerst root-scoped DriveItem search met
  begrensde in-memory downloads; Azure AI Search alleen wanneer de meting live retrieval
  onvoldoende vindt.
- De echte Graph-variant van “toegang ingetrokken tijdens het verzoek” blijft een
  activeringsvoorwaarde.

### Overige open punten

- Echte Outlook/Graph-smoke op de productieachtige klantconfiguratie nog uitvoeren en vastleggen.
- AI-gateway-beheerscherm (#317): fondsconfiguratie is nu nog beheer via migratie/procedure.
- Klanteigen Copilot/API-adapter is architectuurkeuze, nog geen productiewiring.
- Microsoft-activering blijft per klant een apart onboardingbesluit met Entra-consent,
  SharePoint-sitegrant, bronkeuze en acceptatietest.

---

## 5. Uitgevoerde productievolgorde — Supabase eerst, daarna code

### 5.1 Rollen vooraf geprovisioneerd

Als database-eigenaar zijn met afzonderlijke beheerde wachtwoorden waar van toepassing ingericht:

- `ai_gateway` — LOGIN, NOINHERIT, geen elevated privileges, connection limit ≤ 5;
- `microsoft_vault` — idem;
- `login_gateway` — idem;
- `login_hook_owner` — NOLOGIN, NOINHERIT, geen elevated privileges;
- `portaal_beperkt` — NOLOGIN, NOINHERIT, lid van `authenticator`.

Gebruik de exacte statements en controles uit de drie runbooks; neem geen wachtwoord op in een
script, ticket, PR of log.

### 5.2 Migraties afhankelijkheidsgeordend toegepast

1. `2026_09_04_ai_gateway_configuratie.sql`
2. `2026_09_04_microsoft_fase1_connectorfundament.sql`
3. `2026_09_04_microsoft_outlook_fase2a.sql`
4. `2026_09_04_microsoft_sharepoint_fase3.sql`
5. `2026_09_04_microsoft_sharepoint_fase3b_documenten.sql`
6. `2026_09_04_t4_ai_actietype_semantische_extractie.sql`
7. `2026_09_06_microsoft_login_fase1b.sql`
8. `2026_09_07_microsoft_login_startlimiet.sql`
9. `2026_09_07_microsoft_login_beleidsmodus.sql`
10. `2026_09_11_toelating_auditprojectie.sql`
11. seed `2026_09_04_ai_gateway_monitoring_seed.sql`

De migraties zetten geen fonds op Microsoft-loginmodus `verplicht`. Laat Microsoft- en
Outlook/SharePoint-vlaggen bij deze basisrelease uit.

### 5.3 Checks vóór de code-merge uitgevoerd

Uitgevoerd zijn de bijbehorende suites voor AI-gateway, Microsoft fase 1/2A/3, F1B,
startlimiet, beleidsmodus en toelatingsprojectie, plus:

- `2026_07_31_r1_structurele_gates.sql`;
- `2026_08_20_v3_grants_volledig.sql` via psql/repo-runner;
- `2026_08_31_secdef_self_gate.sql`;
- de gebundelde cross-tenant/DB-suite waar praktisch uitvoerbaar.

Alle controles waren groen. De V3-grantscontrole gebruikte in de SQL-editor een tijdelijke
`INSERT` van exact dezelfde repository-allowlist in plaats van de psql-only `\copy`; de
vergelijkingslogica bleef ongewijzigd. De cross-tenantgedragstest draaide tegen Productie en is
volledig teruggerold.

### 5.4 Minimale productieconfiguratie vóór deploy ingericht

Verplicht voor het bestaande AI-pad:

- `AI_GATEWAY_DATABASE_URL`;
- `AI_GATEWAY_CA_CERT_BASE64`;
- werkende bestaande providersecrets, waaronder Anthropic en Mistral.

Verplicht voor de sessieguard:

- `LOGIN_GATEWAY_DATABASE_URL`;
- `LOGIN_GATEWAY_CA_CERT_BASE64`.

Microsoft OAuth-/Graphsecrets mogen bij de basisdeploy ontbreken zolang alle Microsoft-vlaggen
uit blijven. Voeg ze pas toe bij een afzonderlijk, goedgekeurd fonds-onboardingmoment. Schakel de
Supabase Azure-provider en Custom Access Token Hook op Productie niet stilzwijgend in als onderdeel
van deze codepromotie.

### 5.5 Deploy en smoke — as-run

1. Reconciliatie-PR's #371, #372 en #375 zijn groen naar `preview` gemerged.
2. Productierollen, migraties, checks en minimale gatewayconfiguratie zijn vóór deploy ingericht.
3. Promotie-PR #373 liep uitsluitend van `preview` naar `main`; verplichte checks waren groen.
4. De opdrachtgever gaf daarna expliciet mergeakkoord; PR #373 is gemerged als `09d473f`.
5. Productiesmoke zonder Microsoft-activering: bestaande sessie, chat met fondsbron,
   synthetische ingest inclusief embedding, monitoring en verborgen Microsoftbediening groen.
   Verse wachtwoordlogin en afschrift-/besluitconcept zijn niet afzonderlijk uitgevoerd, zoals in
   §3 vastgelegd.

---

## 6. Rollbackrichting

- Bij een fout vóór merge: niet deployen; herstel rol/config/migratie volgens de runbooks.
- Bij een fout direct na deploy: eerst Microsoft-vlaggen uit laten/staan; code terug naar de vorige
  `main`-deployment; databaseobjecten niet destructief verwijderen zolang auditregels bestaan.
- Gatewaymigratie niet terugrollen voordat alle codepaden van de gateway af zijn en auditdata
  gecontroleerd is geëxporteerd; de rollback weigert bewust bij aanwezige logregels.

---

## 7. Werkelijke promotie-PR

> **PR #373:** `promo: Microsoft 365-fundament, centrale AI-gateway en retrieval T2-1 → main`
>
> Promotie van `preview` naar `main` na waargenomen PGB Preview-smokes. Deze release levert het
> duale productfundament, Microsoft-loginbeleid, Outlook/SharePoint read-only, de centrale
> AI-gateway en retrieval T2-1 inclusief deadlines, V1–V5 en G-12.
>
> Microsoft-functionaliteit blijft op Productie standaard uit en wordt later per fonds
> geactiveerd. De AI-gateway bedient wel het bestaande AI-pad; daarom zijn rollen, migraties,
> checks en minimale gatewaysecrets vóór de merge ingericht volgens
> `PROMOTIE-MICROSOFT-RETRIEVAL-PREVIEW-NAAR-MAIN-2026-09-11.md`.
>
> Preview-bewijs: Microsoft-login op PGB groen; gatewaycall groen; ingest 2/2; synthetisch
> document beschikbaar met embedding; positieve G-12-smoke gaf `hybride_rrf`,
> `embedding_query_success=true`, `vec_rang=1`, `fts_rang=1` en inhoudelijk
> `poging_herkomst=verslapt`.
>
> Niet onderdeel van deze activering: Microsoft op Productie aanzetten, echte SharePoint live
> retrieval, Azure AI Search, Copilot-integratie en retrieval T2-2 t/m T2-5.
