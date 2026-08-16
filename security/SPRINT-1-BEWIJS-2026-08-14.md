# Sprint 1 — technisch sluitingsbewijs

- **Statusdatum:** 2026-08-14
- **Scope:** Preview/Productie-scheiding, tenantgrenzen, technische CI-ondergrens
- **Conclusie:** de actuele Preview-schema-basis is lokaal reproduceerbaar, de
  twee hardeningmigraties zijn op Preview én Productie toegepast en live
  gecontroleerd, en `main` is met de twee securitychecks beschermd. De technische Sprint 1-scope
  is daarmee afgerond. De hieronder genoemde provider- en dependencyrisico's
  blijven expliciet vervolgwerk en betekenen niet dat ASVS Level 2 al volledig
  is aangetoond.

## Opgeleverd

| Onderdeel | Bewijs | Status |
|---|---|---|
| Gescheiden Preview-Supabase | Previewproject `bestuurdersportaal-preview` (`swviwoytzvaqypieqgji`) is onderscheiden van Productie (`aebwiufuegsiwhwpdrfb`); CLI-link staat op Preview | Groen |
| Reproduceerbare Preview-baseline | Schema-only export van `public`, aparte Auth-hook en private Storage-bucket/policy-config; geen tabeldata, gebruikers, objecten of secrets | Groen — lokaal vanaf nul bewezen |
| Preview- en Productierelease | Sprint 1 is via PR #3 gemergd als `c3ce517`; beide Vercel-productiedeployments rapporteerden `success` | Groen |
| Host-/tenantgrens | `tests/cross-tenant/preview-environment.test.ts`, scenario's P1–P6 | Groen |
| Volledige app-laagmatrix | `npm run test:xtenant`: 189/189 | Groen |
| Least-privilege grants | Preview en Productie: `unwanted_table_grants = 0`; applicatiemigratierol `postgres` heeft geen brede defaults | Groen voor bestaande en door applicatiemigraties aangemaakte tabellen; provider-default apart geregistreerd |
| RLS `WITH CHECK` | Preview en Productie: policy `ai validatie domein` heeft een expliciete doelrijcontrole | Groen — beide omgevingen toegepast en geverifieerd |
| Committed secrets | `scripts/check-committed-secrets.sh`; scan toont alleen bestand/regel, nooit secretwaarde | Groen |
| CI-securityondergrens | `main` vereist een pull request, actuele branch en de checks `Security baseline (Sprint 1)` en `Cross-tenant isolatie (§15 T1-T14)`; ook beheerders vallen onder de regel | Groen — live geverifieerd |
| Echte RLS/Storage/RPC-test | Schone PostgreSQL 17-stack: baseline + 2 migraties + volledige matrix; 189 app-tests en alle DB-gates groen | Groen — verplicht voor merge naar `main` |

## Negatieve Preview-matrix

De nieuwe uitvoerbare matrix blokkeert de volgende regressies:

1. een Productie-, Horizon- of extra host in de Preview-seed;
2. een ontbrekende of dubbele mapping van één van de vier Preview-apphosts;
3. toegang van ieder Previewfonds tot elk van de drie vreemde fonds-hosts;
4. toegang via een onbekende Previewhost, Productiehost of Vercelhost;
5. uitschakeling van `TENANT_ENFORCE` op Preview, Staging of Productie;
6. platformroutes op een Preview-apphost of app-routing op Preview-beheer.

Runtime-smokes vullen dit bewijs aan: ingelogde routes voor Meridiaan, PH&C,
Huisartsen en Preview-beheer waren groen. Een Meridiaan-sessie op de PGB-host
werd met `Geen toegang op dit adres` geweigerd. Na de live hardening zijn
Preview-beheer, Meridiaan, `/ai`, `/bibliotheek` en de negatieve PGB-hosttest
opnieuw groen doorlopen. Er is geen testdata aangemaakt en er is geen AI-vraag
verstuurd.

## CI-beveiliging van `main`

Op `main` zijn deze exacte statuschecks verplicht en is een pull request vóór
merge vereist:

- `Security baseline (Sprint 1)`;
- `Cross-tenant isolatie (§15 T1-T14)`.

De regel geldt ook voor beheerders, vereist dat de branch actueel is, blokkeert
force-pushes en verwijderen en vereist opgeloste gesprekken. Het vereiste aantal
goedkeuringen is bewust nul: in de huidige eenpersoonsrepository zou één review
de eigenaar zijn eigen pull request niet laten afronden. De pull-request- en
checkpoort blijven wel afdwingbaar.

## Open technische risico's en afhankelijkheden

| Prioriteit | Restpunt | Afhankelijkheid / vervolg |
|---|---|---|
| Hoog | `npm audit --omit=dev --audit-level=high` meldt 1 critical en 9 high kwetsbaarheden, onder meer in Next.js en `xlsx` | Gecontroleerde dependency-upgrade; `xlsx` heeft in npm geen fix en vraagt vervanging of gemotiveerde tijdelijke compensatie |
| Hoog | Preview/Productie Auth Site URL en exacte redirectallowlists zijn nog niet als gesaneerd bewijs gecontroleerd | Supabase-dashboardtoegang; geen wildcard of kruisende callbacks |
| Hoog | Preview-AI gebruikt nog niet aantoonbaar eigen keys, budgets, quota en kill switch | Keuze/limieten van opdrachtgever en providerinrichting |
| Midden | E-mail is functioneel niet in gebruik, maar `uit/sink` is niet technisch als providerbewijs vastgelegd | Providerconfig controleren voordat notificaties worden geactiveerd |
| Midden | `beheer.*` en `beheer.preview.*` zijn conceptueel gescheiden, maar tegengestelde service-role-scopes zijn nog niet volledig live bewezen | Vercel-/Supabase-envscope export zonder secretwaarden |
| Midden | Volledige positieve login/reset/logout-smoke per Previewfonds ontbreekt als herhaalbaar bewijs | Auth-callbackcontrole en geldige testaccounts |
| Midden | Rollbackstappen bestaan, maar verantwoordelijke en 24-uurs nazorg zijn nog niet formeel toegewezen | Opdrachtgever wijst eigenaar aan |
| Midden | Supabase houdt negen brede standaard-ACL's voor tabellen onder providerrol `supabase_admin`; projectrol `postgres` is geen lid en kan deze niet wijzigen | Bestaande tabellen blijven op nul ongewenste grants; driftcheck na provider-/dashboardwijzigingen en expliciete revoke in elke applicatiemigratie |

## Wat van de opdrachtgever nodig is

1. AI-budget, toegestane modellen en gewenste kill-switchgrens voor Preview;
2. aanwijzen van de rollback-/nazorgeigenaar;
3. akkoord op een apart dependency-upgradeincrement, inclusief vervanging of
   tijdelijke risicoafhandeling van `xlsx`.

## Live providerbewijs

Op 2026-08-14 is vóór de Preview-wijziging een schema-only rollbackdump gemaakt.
De twee hardeningmigraties zijn eerst op Preview uitgevoerd. Een controlequery
gaf PostgreSQL `17.6`, een aanwezige RLS-`WITH CHECK` en nul ongewenste
tabelgrants.

Na de groene Preview-, CI- en Vercelcontroles is voor Productie een gerichte
preflight en rollback vastgelegd. De preflight gaf PostgreSQL `17.6`, nul
ongewenste actuele tabelgrants en een nog ontbrekende `WITH CHECK`. Dezelfde twee
transacties zijn daarna op Productie toegepast. De nacontrole gaf:

- `ai_policy_with_check = true`;
- `unwanted_table_grants = 0`;
- negen resterende provider-defaults, uitsluitend eigendom van
  `supabase_admin`; `postgres` kan deze providerrol niet overnemen;
- publieke app-health `200 {"ok":true}`;
- beheer-health zonder sessie correct `401 Niet geautoriseerd`;
- beide loginpagina's laden zonder fout.

Er is geen tabeldata gewijzigd. De productie-ingreep bestond uit de policy-
vervanging en het intrekken van rechten/defaults voor zover de projectrol die
bezit. De provider-defaults gelden als expliciet restrisico en niet als actuele
tabelgrant.

## Lokale sluitingsrun

Op 2026-08-14 is een lege lokale Supabase-stack op PostgreSQL 17.6 opgebouwd uit
`supabase/baseline/`, gevolgd door uitsluitend de twee post-baselinemigraties.
Daarna slaagde `scripts/cross-tenant-ci.sh` volledig: typecheck, 189/189
applicatietests en alle databasegates voor RLS, Storage, RPC's, grants,
append-only logging, monitoring, retrieval en bestuursbureau-rolgrenzen.

Aanvullend groen: committed-secretsscan, boundary-lint, merkkleur-lint, alle
sanity-suites en de productiebuild. De fonds-themacontrastcheck bouwt nu de
actuele Meridiaan-eindtoestand op uit de geordende demo-migraties, zodat de al
uitgevoerde navtekstcorrecties worden meegenomen in plaats van alleen de oude
initiële seed te toetsen.
