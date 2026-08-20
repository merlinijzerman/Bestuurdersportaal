# 0183 — Expliciete bewijs↔vereiste-binding als tekstsleutel, niet als FK

- **Status:** Geaccepteerd
- **Datum:** 2026-08-18
- **Betrokkenen:** Merlin IJzerman (opdrachtgever/eigenaar), Claude Code (uitvoering)

## Context

Een bewijsstuk (`procedure_bewijs`) had geen enkele koppeling naar het vereiste dat het vervult. Zowel de weergavelaag (`core/lib/decision.ts::buildEvidenceLijst`) als de gate (`fn_decision_readiness_check`) leidde vervulling af uit twee dingen: hetzelfde `stap_volgorde`, plus een optionele `documenttype`-tekststring. Had een vereiste geen `documenttype`, dan gold `rij.documenttype is null` → waar, en vervulde **élk** bewijsstuk op die stap dat vereiste. De invaarseed v2 (`2026_08_14_invaar_requirements_seed_v2.sql`) zet `documenttype` in alle 63 rijen op `null`, dus die tak was voor `pf_wtp_invaarbesluit` structureel actief. Bovendien "verbruikte" `.find()`/`exists` geen bewijsstuk: één stuk kon meerdere vereisten tegelijk vervullen.

Gevolg: na één upload stond er "3 gevraagd · alle opgevoerd" en kon **blokkerende** bewijslast als compleet gelden. Bij het invaarbesluit is dat een governance- en dossierrisico.

Randvoorwaarden die meewogen: snapshot-integriteit (een lopende procedure mag niet meebewegen met een latere templatewijziging), append-only audit, tenant-isolatie via RLS, en een identiek oordeel in weergave- en readiness-laag.

## Besluit

`procedure_bewijs` krijgt een **expliciete binding als tekstsleutel**: `requirement_sleutel = stap_volgorde|requirement_type|coalesce(documenttype, label)`. Vervulling van een `document`/`external_submission`/`consultation`-vereiste is voortaan uitsluitend een gelijkheidstest op die sleutel, in TypeScript én in plpgsql. De wildcard en de titel-substring-match vervallen.

## Overwogen alternatieven

- **FK naar `procedure_requirements`** — verworpen, en niet op smaak maar op houdbaarheid. De seed-generator draait `delete from procedure_requirements where template_code = '…'` gevolgd door een volledige re-insert; elke seed-regeneratie levert nieuwe ids. Een FK zou dan cascaden of nullen, waarmee een lopende procedure alsnog meebeweegt met een templatewijziging — precies wat de snapshot-integriteitsguardrail verbiedt.
- **Twee nullable FK-kolommen (`requirement_id` + `requirement_instance_id`) met CHECK** — verworpen. Vereisten leven in twee tabellen (`procedure_requirements`, `procedure_requirement_instance`) zonder gedeelde sleutel; twee kolommen verdubbelen de matchlogica in beide lagen en lossen het instabiele-id-probleem van de template-arm niet op.
- **Verbruikend toewijzingsalgoritme zonder schemawijziging** (greedy matching op documenttype/titel, elk stuk hoogstens één keer) — verworpen. Dat repareert de dubbeltelling maar niet de willekeur: welk stuk welk vereiste vervult, hangt dan af van sorteervolgorde, en TS en SQL zouden twee onafhankelijke implementaties van hetzelfde algoritme moeten onderhouden. Met een expliciete binding is verbruik een eigenschap van het datamodel en doen beide lagen alleen nog `=`.
- **Optie A: tijdelijk unieke `documenttype`-tags seeden** op de stap-1-vereisten van `pf_wtp_invaarbesluit` — als interim-mitigatie overwogen en laten vervallen, omdat de structurele fix in dezelfde tranche landt.

## Gevolgen

**Datamodel/migraties.** Eén nullable kolom + partiële index op `procedure_bewijs` (`2026_08_18_bewijs_requirement_binding.sql`, met `_ROLLBACK`). Dezelfde migratie herschrijft de document-tak van `fn_decision_readiness_check` en herhaalt de grants defensief (zie hieronder: `create or replace` *behoudt* de ACL — de regels leggen de bedoelde eindtoestand expliciet vast). Er is geen migratierunner: eerst de migratie plakken, dán code-deploy — andersom selecteert `decision.ts` een kolom die nog niet bestaat.

**RLS/tenant-isolatie.** Ongewijzigd. De policy `"fonds proc bewijs"` is rij-gebaseerd en dekt een nieuwe kolom automatisch; tabelgrants gelden voor nieuwe kolommen. Onder échte RLS getoetst (DEEL 3 van de gedragstoets): fonds B leest, wijzigt en insert geen binding op een bewijsstuk van fonds A.

**Twee bevindingen uit de reviews die verder reiken dan dit besluit, hier vastgelegd omdat ze aannames corrigeren die elders in de repo terugkomen:**

1. `fn_decision_readiness_check` is **SECURITY INVOKER**, niet DEFINER (`prosecdef = false` in de preview-baseline) — gate E (gepind `search_path`) is er dus niet op van toepassing, gate H wél.
2. `create or replace function` **behoudt** de ACL; alleen `drop function` + `create` reset hem, waarna `anon` via de Supabase default-ACL opnieuw EXECUTE krijgt (bevinding H-18 / OP-C5). Empirisch getoetst op Postgres 16. Het commentaar "create-or-replace reset de ACL" in eerdere migraties klopt niet. De `revoke`/`grant`-regels blijven staan: defensief, idempotent, en ze leggen de bedoelde eindtoestand expliciet vast.

**Fail-closed gemaakt.** De functie miste sinds haar eerste versie een `if not found`-controle op de procedure-lookup: bij een onvindbare procedure leverde de template-arm nul requirements en antwoordde de gate `voldoet = true, ontbrekend = []`. Meegenomen in deze herschrijving; retourneert nu `procedure_not_found`.

**Audit/reproduceerbaarheid.** Het zetten of wijzigen van een binding krijgt een eigen append-only event (`bewijs_binding_gewijzigd`, met oude en nieuwe sleutel) naast het bestaande `bewijs_toegevoegd`, dat nu de sleutel en het vereiste-label draagt. Alle bewijs-events dragen voortaan `bewijs_id`, en `bewijs_verwijderd` vermeldt de `requirement_sleutel` — anders is uit de log niet af te lezen wélke vereiste door het verwijderen weer openvalt. De backfill schrijft per procedure één `bewijs_binding_backfill`-regel met beide helften: de gelegde bindingen per rij (`bewijs_id`, sleutel, R1/R2-herkomst) én de ids die ongebonden bleven. Dat is nodig omdat de backfill niet herrekenbaar is: de kandidatenset leunt op `procedure_requirements`, dat bij elke seed-regeneratie wordt ge-delete. De guard staat op de logging van een lege run, niet op de mutatie — een herhaalde run die wél bindt, logt dat.

Meegenomen blinde vlek: `app/api/stemmingen/[id]/sluiten/route.ts` zette een stemverslag als bewijsstuk in het dossier zónder enige logregel. Dat is het enige pad waarlangs het systeem zelf bewijs toevoegt; het krijgt nu een `bewijs_toegevoegd`-event met `bron: "stemverslag"` en bewust géén binding — het systeem bepaalt niet welke bewijslast een stemverslag vervult.

**Gebruikerservaring — bewust geaccepteerd.** Dossiers die vandaag "alle opgevoerd" tonen, tonen na deployment openstaande bewijslast voor alles wat de backfill niet eenduidig kon binden. Dat is de correctie zelf: die stukken vervulden die vereisten nooit. Het blijft een merkbare verandering vlak vóór de invaarpilot en hoort in de release-notitie.

**Geaccepteerde schuld.** De sleutel bevat `stap_volgorde`; hernummeren van stappen zou bindingen breken. Er is vandaag geen herordenfunctie. Verder kent `procedure_requirement_instance` geen tegenhanger van de unieke index `idx_req_uniek`. Een instantie-vereiste zou daardoor op dezelfde sleutel kunnen botsen met een template-vereiste, waarna één gebonden bewijsstuk ze allebei zou vervullen. `POST /api/procedures/[id]/requirements` weigert zo'n toevoeging nu (400, getoetst tegen béide armen van de readiness-unie), maar de garantie zit in de route en niet in de database — een partiële unieke index blijft wenselijk. Beide punten staan op de risicolijst (OP-BB3, OP-BB6).

## Referenties

- Werkopdracht: `WERKOPDRACHT-BEWIJSMATCH-BINDING.md`
- Ontwerp: `BEWIJSMATCH-BINDING-ONTWERP.md`
- Migratie: `supabase/migrations/2026_08_18_bewijs_requirement_binding.sql` (+ `_ROLLBACK`)
- Vervangt de document-tak uit: `supabase/migrations/2026_08_14_readiness_uitsluiting.sql`
- Identiteitspatroon: `idx_req_uniek` (`2026_05_07_decision_object.sql`), `procedure_requirement_uitsluiting.match_sleutel` (`2026_08_14_procedure_requirement_uitsluiting.sql`)
- Toetsen: `core/lib/decision.sanity.ts`, `core/lib/requirement-sleutel.sanity.ts`, `supabase/checks/2026_08_18_bewijsbinding.sql`
- Eerdere besluiten: 0002 (procedure als data), 0174 (engine v2 D6–D8)
