# Promotie `preview` → `main` — M365 fase 4

**Peildatum:** 13 september 2026  
**Productiebasis:** `main` op `09d473f`  
**Geaccepteerde Preview-bron:** `ca57f5c` plus de nog te mergen docs-only PR  
**Status:** voorbereid; niet mergen zonder afzonderlijk opdrachtgeverakkoord

## Scope en releasegrens

Deze promotie brengt de reeds op Preview geïntegreerde uitvoering van #367–#370 naar Productie.
De docs-only acceptatie-PR wordt eerst naar `preview` gemerged. Daarna wordt origin opnieuw
ververst en wordt een nieuwe PR geopend met exact `preview` als bron en `main` als doel. Een
featurebranch rechtstreeks naar `main` is niet toegestaan.

In scope:

- volledige opaque versie-, passage- en citation-identiteit met correlatie (#367);
- centraal georkestreerd zoeken en vergelijken (#369);
- hermetische Microsoft RetrievalAdapter-stub, zonder live wiring (#370);
- typed en begrensde evidence-/modelcontextlezingen (#368);
- drie additieve auditprojectiemigraties en bijbehorende rollbacks.

Niet in scope:

- Microsoft-, Outlook-, SharePoint- of Graphactivering;
- een productie-Microsoftadapter, Azure AI Search of Copilot-integratie;
- wijzigingen aan productiecode in de documentatie-PR;
- het sluiten van #367–#370 vóór geaccepteerde productie-uitrol.

## Voorwaarden vóór de promotie-PR

- [x] `origin/main` is productiecommit `09d473f`.
- [x] `09d473f` is ancestor van de actuele `origin/preview`.
- [x] #367, #369, #370 en #368 zijn in afhankelijkheidsvolgorde geïntegreerd.
- [x] Preview-commit `ca57f5c` heeft groene verplichte checks en twee geslaagde Vercel-deploys.
- [x] Secrets-, boundaries-, structuur-, build-, test-, DB/RLS/grants- en rollbackcontroles groen.
- [x] Live Preview zoeken, chat/evidence en governance-audit groen.
- [ ] Deze docs-only PR is gereviewd en na expliciet akkoord naar `preview` gemerged.
- [ ] Na die merge is de exacte nieuwe `origin/preview`-SHA vastgelegd.

## Databasevolgorde vóór code-deploy

Pas als database-eigenaar, in deze volgorde, toe:

1. `supabase/migrations/2026_09_11_369_vergelijk_retrieval_audit.sql`
2. `supabase/migrations/2026_09_11_z367_retrieval_identiteit_auditprojectie.sql`
3. `supabase/migrations/2026_09_12_368_evidence_auditprojectie.sql`

Voer daarna minimaal uit:

- `supabase/checks/2026_08_13_t5_vergelijking.sql`;
- `supabase/checks/2026_09_11_retrieval_identiteit_auditprojectie.sql`;
- `supabase/checks/2026_09_12_368_evidence_auditprojectie.sql`;
- `supabase/checks/2026_07_31_r1_structurele_gates.sql`;
- `supabase/checks/2026_08_20_v3_grants_volledig.sql`;
- `supabase/checks/2026_08_31_secdef_self_gate.sql`;
- de volledige cross-tenant/DB-suite.

De lokale acceptatie heeft de omgekeerde rollbackvolgorde #368 → #367 → #369 en daarna de
voorwaartse volgorde #369 → #367 → #368 bewezen. Productierollback is geen routinehandeling:
behoud auditdata en rol code/config en database alleen volgens één expliciet incidentbesluit terug.

## Deploy- en smokevolgorde

1. Controleer de database-eindmarkers en houd Microsoftvlaggen uit.
2. Open PR `preview` → `main`; wacht alle verplichte checks af.
3. Vraag afzonderlijk mergeakkoord en merge pas daarna.
4. Wacht totdat app en beheer `Ready` zijn; controleer de publieke healthcheck.
5. Smoke een bestaande sessie en tenantidentiteit op minimaal één fonds.
6. Smoke `/zoeken` met de synthetische controlecode.
7. Smoke chat/evidence en controleer het contentsvrije governancespoor.
8. Smoke `/vergelijk` alleen met twee geschikte synthetische documenten.
9. Controleer foutsignalen, gatewaylog en deploymentlogs zonder inhoud of secrets te publiceren.

## Reeds bewezen en bewust niet bewezen

Reeds op Preview bewezen: correcte PGB- en Meridiaan-tenantrouting met bestaande sessies, zoeken op
`ORION-4827`, brongebonden chatantwoord en twee inhoudsarme governanceregels. Niet afzonderlijk
bewezen: verse wachtwoordlogin, positieve live vergelijking, negatieve live accountwissel en live
Microsoft/Graph-/Outlook-/SharePointretrieval. Die omissies mogen niet als uitgevoerd worden
gepresenteerd en worden na deploy alleen toegevoegd als de benodigde veilige fixtures en expliciete
activeringsscope beschikbaar zijn.

## Go/no-go en rollback

**GO voor het openen van de latere promotie-PR**, nadat deze docs-only PR met akkoord in `preview`
staat. **Nog geen GO voor merge naar Productie.** No-go bij afwijkende branchrichting, ontbrekende
database-eindmarker, rode verplichte check, ongeplande Microsoftactivering, tenant-/bronlekkage of
inhoud in het operationele auditspoor.

Bij een appregressie na deploy: houd alle Microsoftvlaggen uit, rol eerst de code terug naar
`09d473f` en beoordeel daarna of de additieve auditprojecties veilig kunnen blijven staan. Gebruik
de rollbacks alleen na expliciete data-/auditbeoordeling.
