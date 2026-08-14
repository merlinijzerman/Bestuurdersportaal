# Sprint 1 — technisch sluitingsbewijs

- **Statusdatum:** 2026-08-14
- **Scope:** Preview/Productie-scheiding, tenantgrenzen, technische CI-ondergrens
- **Conclusie:** de code- en omgevingsbasis is aantoonbaar verbeterd, maar Sprint
  1 is pas formeel gesloten nadat de twee CI-statuschecks verplicht zijn gemaakt
  en de hieronder genoemde provider-/dependencyrestpunten zijn afgehandeld.

## Opgeleverd

| Onderdeel | Bewijs | Status |
|---|---|---|
| Gescheiden Preview-Supabase | Schoon Previewproject, 148 migraties, eigen Auth/DB/Storage/secrets en vier synthetische tenants | Groen |
| Preview- en Productierelease | Preview `3e5f205`; Productie `e4b6110`; applicatie-inhoud gelijk; beide Vercel-releases `Ready` | Groen |
| Host-/tenantgrens | `tests/cross-tenant/preview-environment.test.ts`, scenario's P1–P6 | Groen |
| Volledige app-laagmatrix | `npm run test:xtenant`: 189/189 | Groen |
| Least-privilege grants | Late-recreate hardening in Preview en correctie van twee Productiefuncties | Groen |
| Committed secrets | `scripts/check-committed-secrets.sh`; scan toont alleen bestand/regel, nooit secretwaarde | Groen |
| CI-securityondergrens | Check `Security baseline (Sprint 1)` voor secrets, service-role, grenzen, kleuren, typecheck, sanity, tenantmatrix en build | Technisch gereed; nog verplicht maken |
| Echte RLS/Storage/RPC-test | Check `Cross-tenant isolatie (§15 T1-T14)` met ephemere Supabase-stack | Technisch gereed; nog verplicht maken |

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
werd met `Geen toegang op dit adres` geweigerd. Er is geen testdata aangemaakt.

## CI activeren

Maak op `main` minimaal deze exacte statuschecks verplicht en vereis een pull
request vóór merge:

- `Security baseline (Sprint 1)`;
- `Cross-tenant isolatie (§15 T1-T14)`.

De workflowcode is onderdeel van deze branch. Branch protection is bewust nog
niet extern aangepast: dit vereist het expliciete besluit dat `main` niet langer
rechtstreeks wordt gepusht. Pas na die providerhandeling is de poort echt
afdwingbaar en mag dit onderdeel `Groen` heten.

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

## Wat van de opdrachtgever nodig is

1. akkoord dat `main` voortaan alleen via een pull request met beide verplichte
   checks mag wijzigen;
2. AI-budget, toegestane modellen en gewenste kill-switchgrens voor Preview;
3. aanwijzen van de rollback-/nazorgeigenaar;
4. akkoord op een apart dependency-upgradeincrement, inclusief vervanging of
   tijdelijke risicoafhandeling van `xlsx`.
