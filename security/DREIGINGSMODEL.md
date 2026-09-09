# Technisch dreigingsmodel

- **Versie:** 1.0
- **Datum:** 2026-08-14
- **Scope:** Productie, Preview, beheeromgeving, Supabase, Vercel, AI-providers,
  e-mailprovider en documentverwerking
- **Herziening:** bij een nieuwe vertrouwensgrens, provider, authmethode,
  gevoelige gegevenssoort of Critical/High-bevinding

## Te beschermen waarden

- fondsdocumenten, bestuursinformatie en mogelijk gevoelige persoonsgegevens;
- tenant- en rolgrenzen, inclusief individueel stem-/reflectiegedrag;
- accounts, sessies, herstelstromen en MFA-status;
- auditspoor, besluitvorming, afschriften en integriteitszegels;
- Supabase service-role/JWT-secrets, AI- en e-mailproviderkeys;
- AI-budget, modelinstructies en vertrouwelijke prompt-/retrievalcontext;
- beschikbaarheid en reputatie van de Productie- en Preview-domeinen.

## Vertrouwensgrenzen en hoofdstromen

1. browser ↔ Vercel/Next.js;
2. Next.js user-session ↔ Supabase RLS/PostgREST/Storage;
3. server-/workerroute ↔ Supabase service-role;
4. Next.js ↔ centrale AI-gateway ↔ Anthropic/OpenAI/Mistral en web-retrieval;
5. Next.js ↔ e-mailprovider;
6. Productie ↔ Preview — **geen datastroom toegestaan**;
7. tenant A ↔ tenant B — alleen gedeelde code/infrastructuur, nooit gedeelde
   autorisatie of dataresultaten;
8. beheeridentiteit ↔ platformdata — afzonderlijke identiteit, live AAL2 en
   expliciete capability vereist.

## Misbruikcases en risicoregister

| ID | Scenario | Impact | Huidige control | Status / eerstvolgende maatregel |
|---|---|---|---|---|
| R-01 | Gebruiker manipuleert host, fonds-ID of object-ID en leest/schrijft bij ander fonds | Kritiek | RLS, server-side fonds-ID, host↔fondscontrole, cross-tenant-tests | Deels — complete PostgREST/Storage/RPC-objectmatrix en negatieve runtimetests |
| R-02 | Service-role-secret komt in clientbundle/log of een service-route mist platformauth | Kritiek | Server-only clients, lekscanner, gescheiden routes, AQLab-wrapper | Deels — alle servicepaden inventariseren; secret rotation en bundle-scan bewijzen |
| R-03 | Preview gebruikt Productiedata, Productiesecrets of Productie-AI-project | Kritiek | Doelarchitectuur verbiedt koppeling | Open tot providercutover — eigen Supabase, storage en providerkeys verplicht |
| R-04 | Productie-login, magic link of callback landt op een `*.preview.*`-host, of andersom | Hoog | Afzonderlijke domeinzones als doelarchitectuur | Open tot inrichting — per omgeving exacte Site URL/redirectallowlist en negatieve callbacktests |
| R-05 | Kwaadaardig document/webresultaat instrueert het model data of secrets te lekken | Hoog | Weballowlist, capabilitygate, bronmarkering en server-side tools | Deels — prompt-injection-evals, strikte toolallowlist, output-/URL-validatie |
| R-06 | Externe Preview-gebruiker jaagt AI-kosten op of misbruikt modellen | Hoog | App-auth en geplande aparte key | Open — user+Preview-tenantquota, providerbudget, concurrencylimiet, alert en account-expiry |
| R-07 | Directe Storage/API-aanroep omzeilt UI-/routeautorisatie | Hoog | RLS en enkele routeguards | Deels — alle buckets/policies/signed URLs en directe aanroepen negatief testen |
| R-08 | `SECURITY DEFINER`-RPC heeft te brede grants, zoekpadinjectie of vertrouwt caller-input | Hoog | Bestaande self-gating patronen en migratietests | Deels — volledige DEFINER/ACL-review en databasegedragstoets |
| R-09 | Parallelle requests omzeilen een check-then-write-rate limit | Hoog | Rate limiting aanwezig | Open — atomische increment/check in Postgres, concurrencytest |
| R-10 | Malware, polyglot of decompression bomb wordt geüpload en verwerkt | Hoog | Type-/grootte-, magic-byte-/OOXML- en decompressiecontrole plus paginacap | Deels — quarantine en malware-scan vóór parser/OCR; alle uploadpaden runtime-testen |
| R-11 | Bedrijfsmutatie slaagt maar audit faalt, of andersom | Hoog | Append-only logs en integriteitszegel op delen | Deels — kritieke mutatie+audit in één transactie/RPC |
| R-12 | Gestolen of oude sessie blijft bruikbaar; MFA is niet breed genoeg | Hoog | Supabase Auth; platform vereist AAL2 | Deels — tenant-MFA-besluit, timeout, revocation en cookie-tests |
| R-13 | Kwetsbare of gecompromitteerde npm/GitHub dependency bereikt Productie | Hoog | Lockfile en huidige testpoorten | Open/Deels — SCA, SBOM, provenance/updatebeleid en branch protection |
| R-14 | XSS via inline script, documentweergave of fouttekst | Hoog | React-escaping en CSP; `unsafe-eval` alleen development | Deels — nonce/hash-CSP, sinkinventaris en browser-XSS-regressietests |
| R-15 | Persoons-/documentinhoud belandt in logs, analytics, AI-telemetrie of e-mail | Hoog | Auditmetadata is op delen inhoudsarm | Deels — logclassificatie/redactie, providerretentie en DPA/config toetsen |
| R-16 | Onbekende host of env-fout schakelt tenantgrens uit | Hoog | Deploymentdetectie dwingt fail-closed af | Gedekt in code; nog runtimebewijs voor elk custom environment bewaren |
| R-17 | Externe Preview-account blijft onbeperkt actief of krijgt beheerrechten | Hoog | Nog in te richten | Open — invite-only, minimale rol, MFA, einddatum en periodieke accountcontrole |
| R-18 | Foutieve DNS/domain-koppeling of dangling domain maakt takeover/phishing mogelijk | Hoog | Vercel domeinvalidatie | Deels — `horizon.*` niet herintroduceren, ongebruikte records verwijderen en periodiek controleren |
| R-19 | Fondsgerichte Preview-host resolveert naar de verkeerde Preview-tenant of een extern account ziet een ander previewfonds | Kritiek | Exacte hostmapping, RLS, host↔fonds fail-closed | Deels — host×account-matrix en directe REST/Storage/RPC-tests voor ieder previewfonds |
| R-20 | Aanvaller koppelt zijn Microsoft-account aan de portaalaccount van een ander, replayt callback/state of wisselt tenant | Kritiek | Bestaande Supabase-sessie, eenmalige 10-minutentransactie, PKCE, nonce, tenant-/audiencevalidatie en exact callbackpad | Deels — Preview-smoke en negatieve route-tests uitvoeren |
| R-21 | Token/cache, code of secret lekt naar browser, log, audit of directe PostgREST-toegang | Kritiek | AES-256-GCM, private schema, minimale database-rol, no-store en inhoudsarme audit | Deels — grantscontrole, ciphertext-tampertest en loginspectie uitvoeren |
| R-22 | Outlook-sync mengt agenda/event van andere tenant, mailbox of kalender, of dupliceert een meeting | Kritiek | Private selectie bindt tenant+mailbox+calendar; immutable event-key; unieke actieve run; server verifieert lijstresultaat | Deels — echte Preview-negatieve test en DB-check uitvoeren |
| R-23 | Delta-run markeert een afspraak onterecht verdwenen of lekt private/Teams/deelnemerdetails | Hoog | Cursor pas na volledige run; `@removed` krijgt de niet-destructieve status `extern_gewijzigd_of_verwijderd`; privacyregel, Teams-hostvalidatie en inhoudsarme audit | Deels — Preview-scenariobewijs voor sensitivity, annulering en foutpad |
| R-24 | Call-site omzeilt fondsconfiguratie, quotum of live poort; of de private call-audit valt stil | Hoog | Gateway vereist actie-ID en fonds/taaktype; private minimale DB-rol; SDK alleen in adapter; inhoudsvrije append-only log; apart logfoutsignaal | Deels — Preview-smokes voor overige T4-taken en periodieke controle van `gateway_log_fouten` |
| R-25 | SharePoint-lijst of -preview ontsluit een document van een ander fonds, een andere site/drive, of een item buiten de gekoppelde map (gestolen/gemanipuleerde site-, drive-, map-, item- of lokale referentie) | Kritiek | Kandidaatsites server-side geregistreerd zonder portaal-schrijfpad; bronkeuze bindt fonds+verbinding+tenant+site+drive+rootitem in de private vault; lokale referentie is fondsgebonden en vereist actuele configuratieversie/drive; preview herverifieert drive én ligging onder het rootitem met het token van de gebruiker; `@odata.nextLink` alleen binnen hetzelfde pad | Deels — DB-check en unit-tests groen; echte cross-fonds/ID-spoofing-smoke op PGB uitvoeren |
| R-26 | Kortlevende preview-URL (handelt met de rechten van de aanvrager) lekt via opslag, log, audit, referer, adresbalk of een te ruime iframe/CSP | Kritiek | URL alleen in een `no-store`-JSON-respons op verzoek van de ingelogde gebruiker; niet in register, logs of audit (DB-functie weigert URL's/id's in details); aparte previewpagina met pad-specifieke `frame-src https://*.sharepoint.com`, sandbox-iframe en `Referrer-Policy: no-referrer`; hostvalidatie op `*.sharepoint.com` | Deels — Preview-smoke met loginspectie, CSP-/redirect-test en meting van de resterende URL-levensduur na intrekking |
| R-27 | Ingetrokken SharePoint-/Entra-rechten of een te brede scope (`Files.*`, `Sites.Read.All`) geven meer zichtbaarheid dan de gebruiker in SharePoint heeft | Hoog | Alleen delegated `Sites.Selected` (contracttest verbiedt andere site-scopes); lijst en preview per request live met het eigen token; register is geen autorisatiebron; stil token per scope zonder terugval; scopeladder alleen na expliciet besluit (0210) | Deels — scopedekking per Graph-call in de PGB-smoke bevestigen; intrekkingstest MS-06 |
| R-28 | Automatische e-mailkoppeling van een Microsoft-identiteit aan een bestaand wachtwoordaccount (hosted flow óf id-token-grant) | Kritiek | App L zonder `email`-scope (leden dragen geen e-mailclaim), Supabase-callback nooit in Entra, signup uit; hook L1 weigert elk token voor een ongebonden identiteit; spike S7 negatief bewezen | Deels — Preview-smoke N1/N5/N7; linking domain (P6) navragen |
| R-29 | Gast, persoonlijk account of andere tenant logt in | Hoog | Single-tenant App L (E1); claimvalidatie `tid`/`iss`/`idp`/`acct = 0`/MSA-tenant in `microsoft-login-identity-core.ts` | Deels — Preview-smoke N1 met gastaccount |
| R-30 | Juist e-mailadres, afwijkende `tid`/`oid` | Hoog | E-mail is nergens sleutel en wordt niet aangevraagd; binding op `tid + oid`, `sub`-kruiscontrole in hook én app | Gedekt in code; smoke N1 |
| R-31 | Callback-replay, CSRF, `state`-hergebruik, open redirect (incl. Host-header-injectie zoals `host:443@evil`) | Hoog | Eenmalige versleutelde transactie (sha256(state) als sleutel, `gebruikt_op`), PKCE S256, nonce = sha256, `veiligVervolgpad`, vaste callback-URI per host (E4), hostcontrole in de blob; redirect-origin uitsluitend uit de strikt gecanonicaliseerde en tegen `tenant_domains` geverifieerde host (`canoniekeFondsHost`), ongeldig/onbekend → neutrale 404 | Gedekt in code (flowtests, hostnegatieven, E2E-replay); smoke N2/N3 |
| R-32 | Dubbele of cross-tenant binding | Kritiek | Unieke levende slots per `tid+oid` en per `user_id` over fondsen heen; `reserveer_identiteit` eist profiel in het fonds + flag + tenant; callback eist binding.fondsId = host-fonds | Gedekt (T1 check-suite H12/H13, flowtests); smoke N10 |
| R-33 | Token, claims, code, `state`/`nonce` of e-mail lekt naar log, audit, URL of browser | Kritiek | Server-geheugen; audit alleen categorie + sha256(tid:oid) + correlatie; runtime-log alleen categorie + supportcode; `no-store`; URL alleen `fout=microsoft&sc=`; contracttests op verboden woorden | Deels — Preview-logcontrole N11 |
| R-34 | Platformaccount of profielloos account logt via Microsoft in | Hoog | Callback eist profiel in het host-fonds; platform-layout weigert elke `oauth`-sessie; reservering eist `profielen.fonds_id` | Gedekt in code; smoke N9 |
| R-35 | Beheerder omzeilt rol-/fondsgrens via koppelen | Hoog | Alleen eigen account (`profile.manage.own`, `tx.userId = sessie`); binding wijzigt rol/fonds niet | Gedekt in code |
| R-36 | Configuratiefout (ontbrekende env, verkeerde tenant/client) | Middel | Fail-closed config (knop weg, routes 404/503), migratie-preflight, hook 403 bij fout, S9-allowlistmeting | Deels — S9 na provisioning |
| R-37 | Ongebonden `oauth`-sessie benadert PostgREST/Storage/Realtime rechtstreeks | Kritiek | Hook L1 weigert elke `oauth`-uitgifte zonder exacte actieve binding, ook refresh; `jwt_expiry` 600 s (venster expliciet, D12); guard L3 secundair | Deels — Preview-smoke N4/N6 (venster meten) |
| R-38 | Half-afgeronde koppeling (crash of verouderde gebruikerssnapshot tussen `linkIdentity` en activeren) | Middel | Toestandsmodel; link + hook in één GoTrue-transactie; actuele GoTrue-gebruiker opnieuw lezen; een al passende Azure-identiteit na een verse geldige callback idempotent herstellen, maar afwijkende/extra OAuth-identiteit vóór reserveren weigeren; `pending` verloopt na 10 min | Gedekt (flowtests verse herlezing + herstel; T1 H6) |
| R-39 | Kwetsbare Auth-versie (GHSA-v36f-qvww-8w8m) | Hoog | P5 ≥ 2.185.0 als harde uitrolvoorwaarde; eigen `iss`/`tid`/`aud`-validatie vóór Supabase | Te meten vóór elke activering (smoke P1) |
| R-40 | Hookfout of -uitschakeling raakt wachtwoordlogin of schakelt de controle uit | Kritiek | `oauth` fail-closed; guard L3 als tweede signaal. **Sinds #344/0212** wordt ook een niet-`oauth`-uitgifte getoetst; het wachtwoordpad is dus niet langer byte-identiek. De fail-richting is daarom asymmetrisch: geen profiel, configrij of gateway → wachtwoord open, Microsoft dicht; alleen een expliciete modus `verplicht` sluit wachtwoord | Deels — smoke P4/P8 direct na inschakelen |
| R-41 | Binding voor identiteit A gebruikt voor identiteit B, of andere OAuth-provider via de generieke `oauth`-methode | Kritiek | Hook eist precies één OAuth-identiteit = `azure` én `sub`/`tid`/`oid` exact gelijk aan de binding, binnen de GoTrue-transactie (S3a'); P9 Azure enige provider; app-kruiscontrole `provider_id = sub` | Gedekt (spike S3a', T1 H4/H8/H9); P9 via S9 |

| R-42 | Modus `verplicht` sluit een heel fonds buiten (geen dekking, of het laatste herstelpad valt weg) | Kritiek | Activering alleen via `login_private.zet_modus`, dat de preflight ín de schrijftransactie draait achter een advisory lock: volledige bindingsdekking én minstens één MFA-geverifieerd break-glassaccount, anders geen omslag. Is het MFA-bewijs niet verifieerbaar, dan weigert de activering (`breakglass_onverifieerbaar`) in plaats van door te gaan op een aanname. Laatste redmiddel op platformniveau: hook uitschakelen (runbook §1C.5) | Gedekt in de DB-suite (M5, M6, M13); Preview-smoke 1C.4 |
| R-43 | Break-glass wordt een permanente achterdeur, of verdwijnt juist ongemerkt | Hoog | `check (user_id <> uitgegeven_door)`, vaste redencategorie (geen vrije tekst), pas werkzaam mét een geverifieerde MFA-factor. De AANWIJZING is duurzaam (anders is er bij een storing geen herstelpad meer), maar elke VERHOGING opent een venster van een uur met precies één `breakglass.gebruikt` in de audit; daarna zakt de sessie terug naar de beperkte rol. `herzien_voor` dwingt periodieke toetsing af zonder het pad te breken; preflight en beheeroverzicht tellen verlopen herzieningen | Gedekt (M5, M7, M12, M20); alarmering op herhaald gebruik volgt in PR-B |
| R-47 | Een uitzonderingssessie (break-glass op AAL1, koppel-/herstelsessie) benadert PostgREST, Storage of Realtime rechtstreeks | Kritiek | De Auth-hook geeft zo'n sessie de claim `role = portaal_beperkt`: een rol met `USAGE` op `public` en uitsluitend kolom-`SELECT` op de eigen profielrij. PostgREST doet `set role` op die claim, dus de begrenzing zit in de database en niet in de app. De normale rol volgt pas na AAL2 of een geldige Microsoft-koppeling; `withFondsRoute` en de layouts laten zo'n sessie alleen op het koppelpad toe | Gedekt (DEEL 1, M7, M10, M19, M20) én lokaal end-to-end gemeten tegen GoTrue+PostgREST (0212 D10) |
| R-44 | Uitnodigingstoken van de koppel-/herstelsessie lekt of wordt hergebruikt | Hoog | Alleen `sha256(token)` in de database; het token staat nergens in log of audit. Atomisch en eenmalig te activeren, standaard 15 minuten venster, intrekbaar, gebonden aan fonds, gebruiker, tenant en doel; tenantdrift laat de uitnodiging vervallen. Het token authenticeert niet — het bestaande wachtwoord blijft vereist — en het venster sluit zodra `tid + oid` actief gekoppeld is | Gedekt (M10, M11); PR-B levert de ingang en de intrekknop |
| R-45 | Fondsbeleid, tenant of binding wordt buiten het bevoegde servercontract gewijzigd | Kritiek | Geen schrijfpolicy op `public.fonds_microsoft_login` en nul rechten voor `anon`/`authenticated`/`service_role` op de private beleidstabellen; elke mutatie loopt via een `SECURITY DEFINER`-gatewayfunctie die uitsluitend `login_gateway` mag uitvoeren, met capability `login.beleid.manage` (alleen de rol `beheerder`) in de route | Gedekt (DEEL 1 + M15, V3-grants-gate) |
| R-46 | Beleidsafdwinging valt weg door een uitgevallen of niet-geconfigureerde logingateway | Hoog | Gatewayfout = fail-closed (sessie beëindigd, hook 403). Een *ontbrekende* gatewayconfiguratie is bewust géén weigering van het wachtwoordpad: zonder gateway kan geen enkel fonds op `verplicht` staan, en uitloggen zou een omgeving zonder Microsoft-login platleggen (besluit 0212 D5) | Gedekt in de pure kern (`microsoft-login-beleid-core.sanity.ts`) en de contracttest |

### Retrievalcontract fase 4 (#322/#348, besluit 0213) — ontwerprisico's

Deze vier komen uit de T1-inventarisatie. Ze beschrijven de keten zoals die
vandaag draait; de mitigatiekolom noemt wat er nu is en wat T2 moet toevoegen.

| ID | Risico | Ernst | Mitigatie | Status |
|---|---|---|---|---|
| R-48 | Formele bronnen belanden in de AI-context zonder citation-id, versie of ranking. Van de zeven **evidence**-lezingen op het antwoordpad lopen er vijf buiten de retrievalkern om: `decision_objects` (twee plekken, waaronder de bron die zichzelf "formele bron náást `document_chunks`" noemt), `document_chunks` in de chatroute én in `parent-context.ts`, en `semantic_units`. Daarnaast gaan 26 **modelcontext**-lezingen de prompt in zonder enig contract | Middel | Alle lezingen lopen onder RLS met de tenant-client, en `module-scope` weigert expliciet bij een niet-gevonden `procedure_id`/`risico_id` in plaats van terug te vallen op fondsbrede data. Het antwoordpad is bevroren in `retrieval-contextbronnen.expected.json`: de scan is **transitief met echte padresolutie** (112 bestanden, 13 lezers) en elke bereikte LEZING (`bestand::tabel`) draagt een of meer klassen — een lezing zónder klasse maakt gate `F4-context` rood, en de verdeling 7/26/11/3 over 45 lezingen is hard gepind | Gedekt tegen stille groei en tegen stille herclassificatie; de ontwerpgaten staan als G-1a/G-1b open (besluit 0213, R5: evidence wordt citeerbaar, modelcontext krijgt een eigen typed contract) |
| R-49 | Een Microsoftbron belandt zonder exacte versie of zonder actuele permissionproof in de AI-context, waardoor een antwoord steunt op een ingetrokken document of op een document dat de gebruiker niet mag lezen | Hoog | Geen enkele call-site legt vandaag een exacte documentversie per passage vast (`bronversie_audit` kent alleen status en datum). Het contract eist per resultaat **twee gescheiden bewijzen**: `versie.{soort,waarde,gecontroleerdOp}` (R1: volledige hash; op het Microsoftpad alleen eTag/cTag, `status-datum` niet toegestaan) én `toegangscontrole.{toegestaan,gebruikerId,correlationId,gecontroleerdOp,basis,bronconfiguratieVersie}`, dat aan V1–V5 van ontwerp §4.2.1 moet voldoen — gebonden aan **deze actor en dit verzoek**, binnen een venster van 60 s na verzoekstart, op de bronconfiguratieversie die bij verzoekstart gold. Een toelatingspoort vóór de selectie weigert wat daar niet aan voldoet; drive-/item-identiteit blijft achter de private gateway | **Open — T2-1/T2-3, G-2 en G-3b.** T1 doet geen enkele Microsoft-call, dus het risico is nog niet actief |
| R-52 | Een adapter selecteert en citeert zelf, of meldt een capability die zij niet waarmaakt, waardoor per provider andere selectie-, citatie- of filterregels gelden dan het contract voorschrijft | Middel | `RetrievalAdapter.zoek()` levert uitsluitend een `AdapterUitkomst` (kandidaten, methode, timing, fout); selectie, samenvoeging, citatievorming en `RetrievalMeta` zijn exclusief van de orkestratie. De toelatingspoort toetst elke kandidaat tegen de capabilities die de adapter zélf claimt: ontbrekend versiebewijs, ontbrekende of verlopen `toegangscontrole`, of een filter buiten `ondersteundeFilters` is een fout — nooit een stille no-op | **Open — T2-1.** Ontwerp vastgelegd in besluit 0213 (5 en 6) |
| R-50 | Een afgebroken of vastlopend verzoek laat retrieval en modelcalls doorlopen (kosten, belasting, en context die na annulering alsnog wordt opgebouwd) | Middel | `rag.ts`, `rerank.ts` en `embeddings.ts` bevatten nul voorkomens van `AbortSignal`; er is geen looptijdbegrenzing per call-site. Bestaande compensatie: rate limits (`chat` 20/5 min, `zoeken` 60/5 min fail-closed), quota en de vier kill switches | **Open — G-3, belegd in T2-1** (besluit 0213 R6: begrenzing hoort bij de orkestratiegrens, niet bij de contracttests). `AdapterCapabilities` draagt `cancellation` en `timeout` expliciet, zodat een adapter zonder die eigenschappen niet stilzwijgend doorgaat |
| R-51 | Een scopereferentie uit de query-string bereikt de retrievalfilters zonder servervalidatie: `GET /api/zoeken?procesinstantie=<id>` gaat rechtstreeks in `filters.procesinstantie_ids` | Laag | RLS en de expliciete server-side fondsfilter maken dit onschadelijk — een dossier van een ander fonds levert simpelweg niets op. Vastgelegd in de golden `w322.zoeken.get.bestuurder.premiebeleid-procesref-vreemd`, zodat T2 die eigenschap niet stilzwijgend weggeeft bij het verplaatsen van de filters | Gedekt door RLS; expliciete laagvalidatie staat als G-6 open |

Twee bevindingen over het *bewijs* horen hier ook: de retrieval-goldens legden vóór
deze tranche de rangorde niet vast (`normaliseerJson()` sorteert elke array), en
citaat-ID's zijn door de UUID-maskering alleen relationeel te pinnen. Beide zijn nu
geadresseerd met een volgorde-gecodeerde projectie en 15 negatieve controles
(`retrieval-golden-gevoeligheid.test.ts`); zie ontwerp §3.3.

## AI-specifieke grenzen voor Preview

AI blijft bewust aan op Preview om het echte pad te kunnen testen. Dat is alleen
acceptabel met de volgende cumulatieve controls:

- aparte providerprojecten en keys; nooit Productiekeys kopiëren;
- harde providerbudgetten plus waarschuwingen vóór het maximum;
- applicatiequota per gebruiker én per fondsgerichte Preview-tenant;
- alleen goedgekeurde modellen en tools, met korte timeouts en outputlimieten;
- geen Productiedocumenten; standaard uitsluitend synthetisch testmateriaal.
  Niet-synthetisch materiaal blijft buiten AI/OCR tot dataresidentie, provider en
  technische uitsluiting/verwerking expliciet zijn goedgekeurd;
- web-retrieval alleen met `ai.deskresearch` en de padsegment-whitelist;
- externe accounts krijgen de minimaal benodigde rol en een vervaldatum;
- een extern account is aan precies één Preview-tenant gekoppeld, tenzij een
  expliciete testrol cross-fund-toegang vereist en apart is geaccordeerd;
- prompts/responses niet onbeperkt bij de provider bewaren; instellingen als
  bewijs registreren zonder keywaarden;
- een kill switch om AI in Preview direct uit te zetten zonder Productie te raken.

## Misbruiktests die vóór de cutover groen moeten zijn

1. Productiesessie/cookie/token werkt niet in Preview en omgekeerd.
2. Preview-service-role en AI-key werken niet tegen Productieprojecten.
3. Gebruiker van tenant A krijgt voor elk kritisch object van tenant B een
   consequente weigering, ook via directe REST/Storage/RPC.
4. Iedere `<slug>.preview.*`-host resolveert alleen naar het bedoelde fonds;
   onbekende previewhosts en host-fondsmismatches falen gesloten.
5. Magic links, resetlinks en OAuth-callbacks kunnen alleen naar de exacte eigen
   omgevingshosts.
6. Prompt-injectiedocument kan geen tool buiten de allowlist starten en geen
   andere tenantdata, systeeminstructie of secret laten teruggeven.
7. Parallelle AI/API-requests overschrijden quota niet.
8. Upload met verkeerde magic bytes, malwaretestbestand of excessieve
   decompressieratio wordt vóór extractie geweigerd/geïsoleerd.

## Restrisico en acceptatie

`app.bestuurdersportaal.com` blijft Productie en wordt niet omgezet. Tot R-03 en
R-04 aantoonbaar dicht zijn, krijgen externen geen Preview-toegang. Tot R-01,
R-02, R-07 en R-08 volledig zijn getest, is er
geen basis voor een ASVS Level 2-claim. Tijdelijke uitzonderingen vermelden
minimaal eigenaar, zakelijke reden, compensatie, einddatum en hertestmoment.
