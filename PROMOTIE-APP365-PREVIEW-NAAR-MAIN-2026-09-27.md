# Promotie App365 Preview naar Main — 27 september 2026

Status: gereed voor review; geen autorisatie voor merge of Productionmutaties.

## Doel

Promoveer de volledige actuele `preview`-stand naar `main` en bereid
`app365.bestuurdersportaal.com` voor als eigen synthetische demo-tenant in de
bestaande Production-stack. Microsoft/Copilot-activering blijft een afzonderlijke
stap: een codepromotie mag nooit stil een tokenaanvraag of Retrieval-call openen.

## Git-uitgangsstand

- `origin/main`: `a055799736346d8cb518677e53b3a290f004674b`
- `origin/preview`: `0c0a41363fb22a5c0db248b61ae9e4f1582ca3c7`
- relatie vóór dit voorbereidingspakket: `main` is merge-base en Preview staat
  zes commits voor (`0 6`), zonder ontbrekende Main-commit;
- exclusieve Preview-inhoud bestaat uit PR #457 en PR #458, inclusief hun
  geslaagde GitHub- en Vercelchecks.

De promotie-PR moet exact `preview` als head en `main` als base gebruiken. Deze
voorbereidingswijziging landt daarom eerst via een afzonderlijke PR op `preview`.

## Inhoud van de releasebatch

1. server-side modulepoorten voor de uitgeschakelde App365-modules en API-routes;
2. synthetische Previewfixtures en rollback voor Bibliotheek, Vergaderingen,
   Notulen, Procedures en Risicomatrix;
3. fondsgebonden, fail-closed App365-Microsoftconfiguratie zonder terugval naar
   de bestaande PGB-configuratie;
4. een identiek synthetisch Production-demopakket met eigen Production-guard,
   read-only self-check en afzonderlijke rollback;
5. runneracties die Preview/Production en mutatieakkoord vóór `psql` afdwingen.

Preview-only seeds worden door de merge uitsluitend versiebeheerinhoud op
`main`; zij worden niet door build of deploy uitgevoerd. Productiondata wordt
alleen via de expliciete Production-runner en het aparte Fase 3-akkoord gemaakt.

## Read-only Production-nulmeting

Project: `portal_production` / `aebwiufuegsiwhwpdrfb`.

Waargenomen op 27 september 2026:

- fonds `m365-demo` bestaat met id
  `222230a5-3a2a-4230-9bfe-419a28146abe`;
- actieve modules: `home`, `beheer`, `governance`, `assurance`;
- hostbindings voor dit fonds: nul;
- synthetische documenten, vergadering, procedure en risico: ieder nul;
- Microsoft-login: `uit`, inactief, zonder Entra-tenant;
- `microsoft_copilot_retrieval=false` en integratieprofiel `eigen`;
- `pgcrypto` 1.3 is aanwezig; `ltree` en `btree_gist` zijn niet geïnstalleerd.

De Supabase-releasewijziging van 25 september 2026 blokkeert deze release niet:
de repository gebruikt `pgcrypto` voor `digest()` en `gen_random_uuid()`, niet
voor de uitgefaseerde legacy encryptiefuncties; de twee te herindexeren
extensies zijn niet aanwezig.

## Provider-nulmeting

- DNS voor `app365.bestuurdersportaal.com` resolveert al via
  `9d768ba2518b66ba.vercel-dns-017.com` naar Vercel;
- HTTPS/TLS werkt, maar geeft `404`, passend bij de ontbrekende Vercel-domain- en
  tenantbinding;
- Vercel bevat `app365.preview.bestuurdersportaal.com` geldig op
  `preview-stable`; `app365.bestuurdersportaal.com` staat nog niet als
  Production-domain geregistreerd;
- `MICROSOFT_APP365_*` bestaat alleen op `preview-stable`;
- de bestaande Production-`APP_HOST`-configuratie dateert van vóór App365 en
  moet exact worden uitgebreid;
- Supabase Production Auth heeft als redirectallowlist alleen
  `https://app.bestuurdersportaal.com/auth/callback` en
  `https://beheer.bestuurdersportaal.com/auth/callback`.

Omdat het Production-DNS-record al routeert, mag het Vercel-domain niet als
eerste worden toegevoegd: dat zou de host direct publiek maken. Volg de
fail-closed tombstone- en activeringsvolgorde uit
`security/M365-APP365-428-FASE1-RUNBOOK.md`.

## Production-uitvoeringsvolgorde — pas na afzonderlijk akkoord

1. Controleer alle CI-checks op de `preview`→`main`-PR en merge naar `main`.
2. Wacht tot de bestaande Production-hosts gezond zijn; App365 blijft 404.
3. Zet de exacte App365-DNS-host fail-closed volgens het runbook en bewijs
   non-routing.
4. Voeg exact `https://app365.bestuurdersportaal.com/auth/callback` toe aan de
   Supabase Auth-allowlist.
5. Breid Production `APP_HOST` uit met exact `app365.bestuurdersportaal.com`.
6. Voer met `APP365_DOELOMGEVING=production` en het Fase 3-akkoord achtereenvolgens
   `provision`, `check`, `demo-provision` en `demo-check` uit.
7. Richt een afzonderlijk Production-demoaccount in; geen bestaand PGB-account
   of PGB-lidmaatschap hergebruiken.
8. Voeg het domein toe aan Vercel Production en activeer DNS pas als laatste.
9. Smoke health, login/logout/reset, harde reload, tenantresolver, RLS,
   DEMO-markering, `noindex`, sitemap en alle geactiveerde modules.
10. Bewijs dat Microsoft/Copilot nog nul token- en netwerkcalls uitvoert.

## Microsoft-demo — aanvullende activeringspoort

De Preview-code kan naar `main`, maar de huidige Preview-runtimebinding mag niet
één-op-één als Productionbewijs worden gebruikt. Voor Microsoft-functionaliteit
op de Production-demo ontbreken nog:

- exacte Production-callback op de App365-specifieke Entra-appregistratie;
- vijf `MICROSOFT_APP365_*`-waarden in Vercel Production, waarbij
  `MICROSOFT_APP365_FONDS_ID` naar de Production-fonds-id wijst;
- een eigen App365-demoportaalidentiteit zonder PGB-lidmaatschap;
- een eigen SharePoint-bronroot en registry-`data_source_id`, niet de huidige
  PGB-root of het PGB-testaccount;
- een Production-retrievalprofiel dat environment, tenant, identiteit, app,
  bronroot en fonds eenduidig bindt;
- afzonderlijk activeringsbewijs voor `microsoft_sharepoint_fase3` en eventuele
  overige Microsoftpoorten.

De Microsoft Retrieval-nul-hitsblokkade blijft buiten deze release. De
SharePoint-bibliotheekroute kan pas als Production-demo worden aangezet wanneer
bovenstaande eigen bindingen groen zijn; Copilot Retrieval blijft uit tot
Microsoft het serviceteamonderzoek heeft afgerond.

## Rollback

- code: revert van de main-release via de normale Preview-eerst-route;
- demo-inhoud: eerst
  `supabase/rollbacks/2026_09_27_428_app365_production_demo_ROLLBACK.sql`;
- hostbinding: daarna de bestaande Production-hostrollback;
- provider: poorten/accounts blokkeren, DNS fail-closed bewijzen, Vercel-domain
  vrijgeven en pas daarna Auth-/`APP_HOST`-configuratie verwijderen;
- het fonds blijft bewaard wegens append-only configuratieaudit.

## Go/no-go

GO voor review en het gereedzetten van de promotie-PR zodra de lokale en CI-gates
groen zijn.

NO-GO voor merge naar `main`, Production-datamutaties, domainactivering of
Microsoft-activering zonder de daarvoor vereiste afzonderlijke akkoordstap.
