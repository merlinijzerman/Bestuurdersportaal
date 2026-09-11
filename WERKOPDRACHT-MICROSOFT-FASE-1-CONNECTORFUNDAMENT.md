# Werkopdracht Microsoft 365 — fase 1: connectorfundament

**Status:** klaar voor planning, nog niet voor directe uitvoering

**Beoogd uitvoermodel:** Terra

**Werkbranch:** `codex/microsoft-fase1-ticket`

**Basis:** de dan actuele `origin/preview`

**Pilotomgeving:** Preview, gekoppeld aan onze eigen Microsoft 365-tenant en één eigen zakelijk Microsoft-account

**Besluit:** [0208 — Twee productvarianten: eigen inrichting en Microsoft 365](decisions/0208-twee-productvarianten-eigen-en-microsoft.md)

---

## 1. Opdracht in één zin

Bouw het veilige, tenantbewuste fundament waarmee een reeds ingelogde gebruiker van het bestuurdersportaal zijn eigen zakelijke Microsoft-account kan koppelen, de koppeling kan testen en lokaal kan ontkoppelen, zonder de bestaande eigen variant of Supabase-login te wijzigen.

Fase 1 ontsluit nog geen agenda's of documenten. De functionele proef is bewust klein: na toestemming moet de server via Microsoft Graph uitsluitend het profiel van de gekoppelde gebruiker (`/me`) kunnen ophalen.

---

## 2. Startvoorwaarde vanwege parallelle ontwikkeling

Op dit moment loopt nog ander ontwikkelwerk dat eerst naar `preview` en daarna mogelijk naar `main` gaat. Start de implementatie daarom niet op de huidige snapshot zonder bevestiging van de productowner.

Terra voert vóór iedere codewijziging uit:

1. Controleer dat het parallelle werk volgens de productowner in `preview` staat.
2. Voer `git fetch origin` uit.
3. Vergelijk deze branch met de actuele `origin/preview`.
4. Rebase de branch op de actuele `origin/preview`.
5. Controleer opnieuw op migratie-, decision-, route- en documentnummerconflicten.
6. Hernoem besluit 0208 wanneer dat nummer inmiddels bezet is en herstel alle verwijzingen.
7. Begin conform `CLAUDE.md` in Plan mode. Presenteer eerst het technische ontwerp, de migraties, de beveiligingskeuzes en de testaanpak. Implementeer pas na expliciete goedkeuring.

De implementatie blijft een featurebranch en volgt daarna de normale route feature → Preview → Main. Er wordt niets rechtstreeks naar `preview` of `main` gepusht.

---

## 3. Productuitgangspunt

Het bestuurdersportaal ondersteunt blijvend twee volwaardige varianten:

| Onderdeel | Eigen variant | Microsoft-variant |
|---|---|---|
| Agenda | portaal/Supabase | Outlook via Microsoft Graph |
| Documenten | upload en opslag via portaal/Supabase | SharePoint van de klant |
| Documentretrieval | eigen index/RAG | Microsoft live retrieval; eventueel later Azure AI Search |
| Processen, besluiten en audit | portaal/Supabase | portaal/Supabase |

De AI-provider is een afzonderlijke configuratiekeuze. Die wordt in deze fase niet gebouwd en mag niet in het integratieprofiel worden verstopt.

Per fonds is uiteindelijk precies één integratieprofiel actief: `eigen` of `microsoft`. In fase 1 blijven alle bestaande fondsen echter actief op `eigen`. De Microsoft-koppeling wordt alleen als gecontroleerde Preview-pilot beschikbaar gemaakt; er vindt nog geen bronwisseling plaats.

---

## 4. Vaste ontwerpkeuzes

### 4.1 Supabase-login blijft leidend

- De bestaande e-mail/wachtwoordlogin via Supabase Auth blijft ongewijzigd.
- Microsoft is een gekoppelde databron, niet de loginprovider van het portaal.
- Vervang `/login` en `/auth/callback` voor de portaal-login niet door Microsoft SSO.
- Eén portaalgebruiker mag alleen zijn eigen Microsoft-koppeling beheren.

### 4.2 Eerst single-tenant in onze eigen Microsoft-omgeving

- Registreer voor de pilot één Entra-app in onze eigen zakelijke Microsoft 365-tenant.
- Accounttype: alleen accounts in deze organisatiemap.
- Gebruik een tenantspecifieke authority; gebruik niet `common`, `organizations` of een persoonlijke Microsoft-accountflow.
- Sta uitsluitend vooraf vastgelegde lokale en Preview-callback-URL's toe.
- Productie krijgt in fase 1 geen Microsoft-secret en geen werkende callback.
- Echte tenant-id's, client secrets, tokens en persoonsgegevens komen nooit in Git, voorbeeldbestanden of screenshots terecht.

### 4.3 Minimale toestemming

Vraag in fase 1 alleen aan:

- `openid`
- `profile`
- `offline_access`
- gedelegeerd `User.Read`

Vraag nog geen kalender-, SharePoint-, zoek-, mail- of application permissions aan. Latere fasen gebruiken incremental consent.

### 4.4 Microsoft Authentication Library

Gebruik bij voorkeur `@azure/msal-node` met een confidential client en de authorization-codeflow. Motiveer een afwijking expliciet in het ontwerp.

Gebruik Supabase Azure social login niet als verkorte connectoroplossing. Dat zou portaal-login en bronkoppeling vermengen en Supabase beheert de levenscyclus van Microsoft-provider-tokens niet voor deze server-side use-case.

### 4.5 Geen automatische fallback of kopie

- Een storing bij Microsoft mag de eigen variant niet beïnvloeden.
- Bij een Microsoft-fout wordt niet automatisch teruggevallen op een Supabase-document- of agendabron.
- Fase 1 kopieert geen Microsoft-inhoud naar Supabase.
- De Graph-respons van `/me` wordt alleen gebruikt om de koppeling te valideren en de minimaal noodzakelijke metadata te tonen.

---

## 5. Afbakening

### In scope

- server-side integratieprofiel `eigen | microsoft` als expliciete fondsconfiguratie;
- veilige, single-tenant Microsoft OAuth/OIDC-flow;
- koppeling tussen Supabase-gebruiker, fonds en Microsoft-identiteit;
- duurzame token-cache of tokenkluis die geschikt is voor Vercel/serverless;
- versleuteling, sleutelversie en foutveilige decryptie;
- status opvragen;
- Microsoft Graph `/me` als minimale verbindingsproef;
- lokaal ontkoppelen en tokenmateriaal verwijderen;
- audit, logging, RLS en cross-tenant-isolatie;
- een kleine beheerbare koppelingkaart in het profielscherm;
- Preview-runbook voor Entra-appregistratie, geheimen, rotatie, test en herstel;
- beveiligingsdocumentatie en geautomatiseerde tests.

### Expliciet buiten scope

- Outlook-agenda's lezen of synchroniseren;
- SharePoint-sites, bibliotheken, mappen of documenten lezen;
- documentpreview in de browser;
- Microsoft live retrieval of Azure AI Search;
- centrale of configureerbare AI-providerlaag;
- Azure OpenAI, Microsoft Copilot of Copilot Studio;
- application permissions en achtergrondprocessen zonder actieve gebruiker;
- klantconsent, klant-tenants en multitenant Entra-appregistratie;
- een fonds daadwerkelijk omschakelen naar de Microsoft-variant;
- Microsoft SSO als vervanging van Supabase Auth;
- wijzigingen in productieconfiguratie;
- migratie of kopie van bestaande klantdocumenten.

Bij scope-uitbreiding: stop en vraag eerst akkoord.

---

## 6. Gewenste gebruikerservaring

Voeg in `/profiel` een compacte sectie **Microsoft 365-koppeling** toe. Deze sectie is alleen zichtbaar wanneer de server-side Preview-pilotflag voor het fonds actief is.

### Niet gekoppeld

- korte uitleg dat dit een pilot is in onze eigen Microsoft-omgeving;
- knop **Microsoft-account koppelen**;
- geen suggestie dat Outlook of SharePoint al beschikbaar is.

### Gekoppeld

- status `Gekoppeld`;
- gecontroleerde weergavenaam en eventueel gemaskeerde gebruikersnaam;
- Microsoft tenant-id alleen als verkorte technische referentie;
- tijdstip laatste succesvolle controle;
- knop **Verbinding testen**;
- knop **Lokaal ontkoppelen** met duidelijke toelichting.

### Fout of verlopen sessie

- veilige, begrijpelijke foutmelding;
- opnieuw koppelen als herstelactie;
- geen Microsoft-foutpayload, authorization code, state, token of stacktrace in de browser.

Maak bij ontkoppelen onderscheid tussen:

1. lokaal ontkoppelen: het portaal verwijdert zijn token-cache en markeert de koppeling als beëindigd;
2. Microsoft-consent intrekken: dit kan apart beheer in het Microsoft-account of de tenant vereisen.

Claim nooit dat Microsoft-consent is ingetrokken wanneer alleen lokaal tokenmateriaal is verwijderd.

---

## 7. Verwachte technische route

```text
Supabase-login
      │
      ▼
Profiel → Microsoft koppelen
      │
      ▼
server-side start-endpoint
  - fonds en gebruiker uit sessie
  - pilotflag controleren
  - state + nonce + PKCE
      │
      ▼
Entra ID van onze eigen tenant
      │
      ▼
server-side callback
  - bestaande Supabase-sessie verplicht
  - state/nonce/PKCE/tenant valideren
  - code inwisselen
  - Graph /me controleren
      │
      ▼
metadata + versleutelde MSAL-cache
  - tenant- en gebruikersgebonden
  - geen tokens naar browser of logs
      │
      ▼
status / test / lokaal ontkoppelen
```

Waarschijnlijke endpoints:

- `GET /api/microsoft/connect` — start de koppeling;
- `GET /auth/microsoft/callback` — valideert en voltooit de koppeling;
- `GET /api/microsoft/status` — retourneert uitsluitend veilige statusmetadata;
- `POST /api/microsoft/test` — haalt server-side stil een token op en roept Graph `/me` aan;
- `DELETE /api/microsoft/connectie` — verwijdert lokaal tokenmateriaal en beëindigt de lokale koppeling.

Elke tenantroute moet het bestaande routecontract volgen: authenticatie, fondscontext, capability, schema, rate limit, audit en registratie in de cross-tenant routeverwachtingen. De OAuth-callback vraagt waarschijnlijk een apart contract omdat Microsoft de navigatie initieert; documenteer en test die uitzondering expliciet.

---

## 8. Datamodel: uit te werken voorstel

Gebruik de actuele migraties als waarheid; `schema.sql` kan achterlopen. Schrijf voor alle wijzigingen een nieuwe migratie.

### 8.1 Integratieprofiel per fonds

Leg per fonds precies één waarde vast: `eigen` of `microsoft`.

- alle bestaande fondsen worden expliciet als `eigen` gemigreerd;
- nieuwe fondsen krijgen fail-safe `eigen`;
- ontbrekende of onbekende waarden mogen na de migratie niet stil als Microsoft worden geïnterpreteerd;
- in fase 1 bestaat geen gebruikersroute om het profiel te wijzigen;
- een latere wijziging vereist een gemotiveerde, versieerbare en append-only geaudite beheeractie;
- de AI-provider is geen kolom of subwaarde van dit profiel.

Een aparte fondsgebonden tabel met een unieke `fonds_id` ligt voor de hand. Terra onderbouwt na inspectie van de actuele configlaag of dit beter past dan een streng getypeerde fondsconfiguratie. Een losse, vrij interpreteerbare featureflag is niet voldoende als enige bron voor het productprofiel.

### 8.2 Pilotflag

Gebruik voor de tijdelijke zichtbaarheid een afzonderlijke server-side fondsflag, bijvoorbeeld `microsoft_koppeling_pilot`.

- default `false`;
- alleen het testfonds in Preview krijgt `true`;
- schakelt alleen koppeling-UI en connectorroutes vrij;
- verandert het actieve integratieprofiel niet;
- clientinput mag de flag niet bepalen.

Hiermee blijven de bestaande agenda- en documentroutes volledig in de eigen variant werken.

### 8.3 Microsoft-koppeling

Sla alleen noodzakelijke metadata op, minimaal logisch vergelijkbaar met:

- interne id, `fonds_id` en Supabase `gebruiker_id`;
- Microsoft tenant-id (`tid`);
- stabiele Microsoft account-/objectreferentie;
- MSAL home-account-id indien nodig voor de cache;
- status `gekoppeld | fout | ontkoppeld`;
- minimaal verleende scopes;
- `gekoppeld_op`, `laatst_getest_op`, `ontkoppeld_op`;
- technische foutcategorie zonder ruwe providerpayload.

Maak de cardinaliteit expliciet. Voor de pilot ligt maximaal één actieve Microsoft-koppeling per gebruiker per fonds voor de hand.

### 8.4 Append-only audit

Audit minimaal: koppelproces gestart, koppeling geslaagd/mislukt, verbindingstest geslaagd/mislukt en lokaal ontkoppeld. Een toekomstige profielwijziging moet eveneens append-only worden vastgelegd.

Audit bevat nooit access-, refresh- of ID-tokens, MSAL-cache/ciphertext, authorization codes, PKCE-verifiers, state, nonce, client secrets of complete Microsoft-foutpayloads.

---

## 9. Verplichte ontwerppoort: tokenkluis

Dit is het belangrijkste technische beslispunt van fase 1 en moet vóór implementatie expliciet worden goedgekeurd.

MSAL Node beheert tokenvernieuwing via zijn token-cache en geeft refresh tokens niet als applicatie-API vrij. Een in-memory cache is op Vercel niet duurzaam. Daarom is een persistente cache nodig.

Tegelijk geldt in de huidige codebasis:

- de Supabase service-roleclient is uitsluitend onderdeel van de platformlaag;
- tenant-routes mogen die client niet importeren;
- een service-rolekey omzeilt RLS en vergroot de impact van fouten aanzienlijk.

Terra beschrijft in Plan mode minimaal drie opties en adviseert er één:

1. versleutelde MSAL-cache in een afgeschermde Supabase-tabel via een aantoonbaar least-privilege databasecontract;
2. een externe secret/token store met server-side toegang;
3. een nieuwe, zeer smalle server-only toegangsvorm, alleen wanneer daarvoor de service-rolearchitectuur expliciet wordt aangepast.

Het ontwerp toont aan:

- hoe de cache per gebruiker/account wordt gescheiden;
- hoe lezen en schrijven in serverless instanties werkt;
- hoe RLS of een gelijkwaardige grens cross-tenant toegang voorkomt;
- waarom een browsergebruiker geen cache of gezaghebbende koppelstatus kan vervalsen;
- hoe AES-256-GCM of gelijkwaardige authenticated encryption wordt toegepast;
- waar nonce/IV, authenticatietag en sleutelversie staan;
- hoe sleutelrotatie en herstel werken;
- hoe gelijktijdige cache-updates geen tokens verliezen;
- hoe tokenmateriaal bij lokaal ontkoppelen wordt vernietigd;
- hoe redaction in logs, errors en audit is afgedwongen;
- welke tests bewijzen dat ciphertextmanipulatie fail-closed eindigt.

Niet toegestaan zonder afzonderlijk goedgekeurd architectuurbesluit:

- `platform/lib/supabase-platform.ts` of een equivalente onbeperkte service-roleclient importeren in een tenantroute;
- tokens onversleuteld in Supabase, cookies, localStorage of logs bewaren;
- de MSAL-cache alleen in procesgeheugen bewaren;
- refresh tokens zelf uit tokens of responses proberen te extraheren;
- een algemene decryptie-API beschikbaar maken aan de browser.

Wanneer de aanbevolen oplossing de bestaande service-rolegrens wijzigt: stop na het plan, leg de nieuwe grens in een decision vast, voeg import- en boundarytests toe en vraag expliciet akkoord voordat code wordt geschreven.

---

## 10. OAuth- en OIDC-beveiliging

Implementeer en test minimaal:

- authorization code flow met PKCE;
- cryptografisch willekeurige `state` en OIDC `nonce`;
- eenmalig gebruik met korte geldigheid, richtwaarde maximaal tien minuten;
- binding aan Supabase-gebruiker, fonds en callbackomgeving;
- bestaande geldige Supabase-sessie bij terugkeer;
- validatie van issuer, audience, tenant-id en nonce;
- tenantspecifieke authority en toegestane tenant-id;
- exacte callback-allowlist voor lokaal en Preview;
- veilige relatieve return-URL via de bestaande redirectvalidatie;
- `HttpOnly`, `Secure` waar van toepassing en passende `SameSite`-cookies;
- `Cache-Control: no-store` voor gevoelige callback- en statusresponses;
- eenmalige consumptie en opruiming van OAuth-transactiemateriaal;
- geen open redirect;
- geen geheim of token in queryparameters na callback, client state of analytics.

Let specifiek op login-CSRF/account-linking attacks: een aanvaller mag niet zijn Microsoft-account aan het portaalaccount van een ander kunnen koppelen.

---

## 11. Configuratie en geheimen

Verwachte Preview-configuratie, definitieve namen in het ontwerp vastleggen:

- Microsoft tenant-id;
- Microsoft client-id;
- Microsoft client secret of beter ondersteund confidential-clientcredential;
- exacte callback-URL;
- sleutel voor versleuteling van token-cache en OAuth-transactie;
- connector enabled/pilot kill switch.

Randvoorwaarden:

- scheid Local, Preview en Production;
- gebruik nooit dezelfde callback of secrets over omgevingen heen;
- voeg alleen lege namen en uitleg toe aan voorbeeldconfiguratie;
- faal gesloten bij ontbrekende, ongeldige of ambigue configuratie;
- valideer configuratie centraal;
- log hoogstens welke sleutel ontbreekt, nooit de waarde;
- leg secretrotatie en nooduitschakeling vast;
- activeer eerst in Preview.

---

## 12. Werkpakketten

### F1.0 — Actualiseren en conflictcontrole

- bevestiging afwachten dat parallel werk in Preview staat;
- rebase op actuele `origin/preview`;
- decisions, migraties, routes en documentatie opnieuw inventariseren;
- nummerconflicten herstellen;
- gewijzigde aannames in het plan melden.

### F1.1 — Ontwerp en security gate

- sequence-diagram voor koppelen, testen en ontkoppelen;
- keuze voor MSAL-integratie;
- tokenkluisopties en advies;
- datamodel, RLS- en grantsanalyse;
- callback- en redirectmodel;
- dreigingsanalyse voor account linking, tokenlekkage en tenantverwisseling;
- rollback- en key-rotationstrategie;
- expliciet akkoord verkrijgen.

### F1.2 — Integratieprofiel en pilotconfiguratie

- migratie met expliciete `eigen | microsoft`-waarde per fonds;
- backfill bestaande fondsen naar `eigen`;
- fail-safe resolver in een pure core-module;
- server-side pilotflag;
- geen mutatie-UI en geen omschakeling;
- unit-, RLS- en migratietests.

### F1.3 — Microsoft authorization flow

- confidential-clientconfiguratie;
- startendpoint met state, nonce en PKCE;
- callback met volledige validatie;
- alleen eigen tenant accepteren;
- Graph `/me` als controle;
- veilige return naar profiel;
- sanitized errors en no-store headers.

### F1.4 — Koppeling, cache en audit

- goedgekeurde persistente tokenkluis;
- minimale metadata en append-only auditevents;
- veilige token-cachecallbacks voor MSAL;
- lokale disconnect die cachemateriaal wist;
- gelijktijdigheid en key versioning;
- geen gevoelige data in bestaande `app_errors`, logs of audit.

### F1.5 — Profiel-UI en verbindingsproef

- koppelingkaart achter server-side pilotflag;
- status zonder tokeninformatie;
- handmatige Graph `/me`-test;
- lokaal ontkoppelen met juiste uitleg;
- toegankelijke loading-, succes- en foutstatussen;
- bestaande profiel- en organisatiefunctionaliteit behouden.

### F1.6 — Verificatie en beheer

- geautomatiseerde tests;
- Preview-smoketest met ons eigen zakelijke Microsoft-account;
- Entra-appregistratie- en secret-runbook;
- update dreigingsmodel en ASVS OAuth/OIDC-bewijs;
- update `HANDOVER.md` en relevante decisions;
- documentatiehook uitvoeren vanwege architectuur-, data-, security- en tenantimpact.

---

## 13. Acceptatiecriteria

### Functioneel

- **MS-F1-01** Een bestaande Supabase-gebruiker kan in Preview zijn eigen zakelijke account uit de geconfigureerde Microsoft-tenant koppelen.
- **MS-F1-02** Een account uit een andere tenant of een persoonlijk Microsoft-account wordt veilig geweigerd.
- **MS-F1-03** Na koppeling kan de server Graph `/me` uitvoeren zonder een access token aan de browser te retourneren.
- **MS-F1-04** Het profiel toont alleen veilige statusmetadata en het tijdstip van de laatste geslaagde test.
- **MS-F1-05** Lokaal ontkoppelen verwijdert bruikbaar tokenmateriaal en maakt duidelijk dat upstream consent apart kan blijven bestaan.
- **MS-F1-06** De eigen agenda-, document-, chat- en overige bestaande routes blijven functioneel ongewijzigd.

### Productprofiel en isolatie

- **MS-F1-07** Elk bestaand fonds heeft na migratie expliciet profiel `eigen`.
- **MS-F1-08** Geen fonds wordt in fase 1 naar `microsoft` omgezet.
- **MS-F1-09** De pilotflag is standaard uit en uitsluitend server-side/fondsgebonden bepaald.
- **MS-F1-10** Gebruiker A kan status, metadata, audit of tokenmateriaal van gebruiker B niet lezen of muteren.
- **MS-F1-11** Fonds A kan geen koppeling van fonds B benaderen, ook niet met zelfgekozen ids, cookies, routeparameters of payloadvelden.
- **MS-F1-12** Uitval of misconfiguratie van Microsoft heeft geen effect op fondsen zonder actieve pilotflag.

### OAuth en tokens

- **MS-F1-13** State, nonce, PKCE en bestaande Supabase-sessie worden volledig gevalideerd en zijn eenmalig/kortlevend.
- **MS-F1-14** Redirects zijn beperkt tot exacte lokale en Preview-URL's en veilige interne retourpaden.
- **MS-F1-15** Alleen `openid profile offline_access User.Read` wordt aangevraagd.
- **MS-F1-16** Token-cache is duurzaam, authenticated encrypted en per Microsoft-account geïsoleerd.
- **MS-F1-17** Tokens, secrets, codes, state, nonce, PKCE-data en cacheblobs verschijnen niet in browserresponses, logs, audit, analytics of fouttabellen.
- **MS-F1-18** Manipulatie of decryptiefalen resulteert in een gesloten fout en hernieuwde koppeling.

### Audit, beheer en kwaliteit

- **MS-F1-19** Koppelen, testen, mislukken en lokaal ontkoppelen zijn append-only herleidbaar tot gebruiker, fonds, tijd en request-id zonder gevoelige inhoud.
- **MS-F1-20** Preview heeft een geteste kill switch, secretrotatie- en herstelprocedure.
- **MS-F1-21** Lokaal ontkoppelen versus Microsoft-consent intrekken staat correct in UI en runbook.
- **MS-F1-22** Alle nieuwe tenantroutes gebruiken het centrale routecontract of hebben een gedocumenteerde, geteste callbackuitzondering.
- **MS-F1-23** TypeScript, sanity-, security-, secrets-, structural- en cross-tenant-gates zijn groen.
- **MS-F1-24** CI gebruikt mocks voor Microsoft en heeft geen live tenant, account of geheim nodig.
- **MS-F1-25** De Preview-smoketest is gedocumenteerd zonder gevoelige screenshots.

---

## 14. Verplichte tests

### Pure unit-tests

- integratieprofielresolver: `eigen`, `microsoft`, ontbrekend en onbekend;
- configvalidatie per omgeving;
- veilige return-URL/open-redirectgevallen;
- state/nonce/PKCE: geldig, verlopen, hergebruikt, verkeerde gebruiker en verkeerd fonds;
- tenant-/issuer-/audience-/noncevalidatie;
- scope-allowlist;
- encryptie roundtrip, verkeerde sleutel, gewijzigde tag/ciphertext en key version;
- foutnormalisatie en tokenredaction.

### Route- en integratietests met mocks

- startflow bevat alleen verwachte scopes en tenantspecifieke authority;
- callback zonder Supabase-sessie wordt geweigerd;
- verkeerde state, nonce, tenant of return-URL wordt geweigerd;
- authorization code wordt maximaal eenmaal geconsumeerd;
- geslaagde callback schrijft metadata/cache/audit atomair of aantoonbaar herstelbaar;
- Graph `/me` geeft alleen veilige velden terug;
- disconnect wist cache en behoudt append-only audit;
- Microsoft time-out/429/401/5xx wordt veilig afgehandeld;
- geen tokenmateriaal in vastgelegde log- en errorpayloads.

### RLS- en cross-tenant-tests

Gebruik minimaal twee fondsen en twee gebruikers:

- A kan A lezen/testen/ontkoppelen;
- A kan B niet lezen/testen/ontkoppelen;
- gemanipuleerde `fonds_id` en `gebruiker_id` worden genegeerd of geweigerd;
- directe tabeltoegang levert geen token-cache of gezaghebbende schrijfmogelijkheid op;
- anon krijgt geen toegang;
- grants staan op de allowlist;
- elke nieuwe tenantroute staat in `tests/cross-tenant/route-mechanismen.expected.json`;
- `bash scripts/cross-tenant-ci.sh` is groen.

### Regressie

- bestaande login blijft werken;
- `/profiel` blijft werken zonder Microsoft-config;
- fondsen zonder pilotflag zien geen koppeling-UI;
- bestaande agenda-, document- en chatflows blijven groen;
- Preview- of Microsoft-config lekt niet naar productie.

---

## 15. Verwachte documentatie

Minimaal bij oplevering:

- bijgewerkt `HANDOVER.md`;
- besluit 0208 bijgewerkt als het goedgekeurde ontwerp details aanscherpt;
- Microsoft Preview-runbook onder `security/` of een aantoonbaar beter passende map;
- `security/DREIGINGSMODEL.md` uitgebreid met account linking, tokenkluis, callback en tenantverwisseling;
- `security/ASVS-L2-REGISTER.md` V10 bijgewerkt met providerinventaris en testbewijs;
- migratie- en rollbacknotitie;
- configuratie-instructies zonder waarden of secrets;
- operatorstappen voor koppelen, testen, lokaal ontkoppelen, consent intrekken, kill switch en secretrotatie.

Voer de documentatiehook uit omdat deze wijziging architectuur, data, security, tenant-isolatie en beheer raakt.

---

## 16. Definition of Done

Fase 1 is gereed wanneer:

- de actuele Preview-basis is verwerkt;
- het tokenkluisontwerp expliciet is goedgekeurd;
- fondsprofiel en pilotflag fail-safe zijn geïmplementeerd;
- de Microsoft-koppeling in Preview met het eigen account werkt;
- Graph `/me` server-side succesvol kan worden getest;
- lokaal ontkoppelen tokenmateriaal aantoonbaar onbruikbaar maakt;
- RLS, grants, routecontracten en cross-tenanttests groen zijn;
- geen gevoelige Microsoft-data in client, logs, errors of audit terechtkomt;
- de eigen variant geen regressie vertoont;
- alle relevante gates uit `package.json` en `CLAUDE.md` groen zijn;
- documentatie, runbook, threat model, ASVS-register en handover zijn bijgewerkt;
- er een PR naar Preview klaarstaat met testbewijs en rollbackinstructie;
- promotie naar Main pas na afzonderlijk expliciet akkoord gebeurt.

---

## 17. Handmatige Preview-smoketest

Gebruik uitsluitend ons eigen zakelijke Microsoft-account en testfonds.

1. Bevestig dat het testfonds nog profiel `eigen` heeft en de pilotflag aanstaat.
2. Log normaal in via Supabase Auth.
3. Open de Microsoft-koppeling in Profiel.
4. Start koppelen en controleer tenantnaam, appnaam en exact de vier basisscopes.
5. Rond consent af.
6. Controleer veilige statusmetadata.
7. Voer **Verbinding testen** uit en bevestig een succesvolle Graph `/me`-controle.
8. Controleer browsernetwork, serverlogs, `app_errors` en audit steekproefsgewijs op afwezigheid van tokens/codes/secrets.
9. Probeer een ongeldige state/replay en bevestig fail-closed gedrag.
10. Ontkoppel lokaal en bevestig dat testen niet meer mogelijk is zonder opnieuw te koppelen.
11. Controleer dat bestaande agenda-, documenten- en chatfuncties nog werken.
12. Zet de pilotflag uit en bevestig dat UI en routes niet meer beschikbaar zijn.

Leg alleen niet-gevoelig bewijs vast. Masker accountnamen, tenant-id's en requestdetails waar die voor het bewijs niet nodig zijn.

---

## 18. Bronnen voor de implementatie

Gebruik bij technische beslissingen de actuele officiële documentatie:

- [Microsoft Graph permission reference](https://learn.microsoft.com/en-us/graph/permissions-reference): `User.Read` als minimale delegated profieltoegang;
- [Microsoft identity platform authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow) en OIDC-validatie;
- [MSAL Node configuration](https://learn.microsoft.com/en-us/entra/msal/javascript/node/configuration), [token acquisition](https://learn.microsoft.com/en-us/entra/msal/msal-acquire-cache-tokens) en [persistent token caching](https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching);
- [Supabase Auth Azure](https://supabase.com/docs/guides/auth/social-login/auth-azure) en [provider tokens](https://supabase.com/docs/guides/auth/social-login#access-provider-tokens) alleen ter vergelijking, niet als gekozen connectorarchitectuur;
- actuele repositorybesluiten, migraties en security-registers als lokale bron van waarheid.

Controleer deze bronnen opnieuw bij start van de implementatie: Microsoft- en Supabasegedrag kan wijzigen.
