# Bewijs↔vereiste-binding — ontwerpdocument

> **Status**: v1.0 — geïmplementeerd 18-08-2026
> **Aanleiding**: werkopdracht `WERKOPDRACHT-BEWIJSMATCH-BINDING.md`
> **Besluit**: `decisions/0183-expliciete-bewijs-vereiste-binding.md`
> **Migratie**: `supabase/migrations/2026_08_18_bewijs_requirement_binding.sql` (+ `_ROLLBACK`)

---

## FUNCTIONEEL

### Doel en aanleiding

Eén geüpload bewijsstuk vinkte álle document-vereisten van dezelfde processtap tegelijk af. In de Bewijsstukken-sectie stond na één upload "3 gevraagd · alle opgevoerd"; in de readiness-gate gold dezelfde regel, waardoor **blokkerende** bewijslast ten onrechte als compleet kon gelden. Bij het invaarbesluit is dat een dossierrisico: de ladder naar `besluitrijp` kan groen kleuren terwijl twee van de drie stukken ontbreken.

De oorzaak was geen bug in de telling maar in de *identificatie*: er bestond geen koppeling tussen een bewijsstuk en het vereiste dat het vervult. De match was inferentie op de stap plus een optionele tekst-tag.

### Betrokken gebruikers en rollen

Elke ingelogde fondsgebruiker die bewijs opvoert of koppelt. De autorisatie is bewust ongewijzigd gebleven ten opzichte van vóór deze wijziging: geen nieuwe rolgate, wel een append-only logregel per binding. Zie *Restrisico's* — dat de bewijs-routes geen rolgate hebben (anders dan `/requirements` en `/requirements/uitsluiten`) staat als openstaand punt op de risicolijst.

### Acceptatiecriteria

1. Drie ongetagde document-vereisten op één stap + één opgevoerd bewijsstuk ⇒ één vereiste vervuld, twee open; `onderbouwing_compleet` blijft geblokkeerd.
2. Eén bewijsstuk vervult nooit meer dan één vereiste.
3. Een ongebonden bewijsstuk vervult niets — ook niet als de titel exact gelijk is aan een vereiste-label.
4. Weergave (`decision.ts`) en gate (`fn_decision_readiness_check`) geven op dezelfde fixture hetzelfde oordeel.
5. Wie bewijs opvoert ziet vóór de handeling welke vereiste hij vervult, en ziet achteraf welke stukken ongebonden zijn gebleven.

### Gebruikersbeeld

- Bij "Opvoeren" vanuit een vereiste staat die vereiste voorgeselecteerd in het formulier ("Vervult welke vereiste?"). Titel en documenttype blijven suggesties; de binding bepaalt de uitkomst.
- Kiest iemand géén vereiste, dan staat er expliciet: *"Zonder gekozen vereiste blijft de gevraagde bewijslast op «nog op te voeren» staan."* — vereisten en blokkers vóór de handeling, niet als foutmelding erna.
- In "Opgevoerde stukken" toont elk stuk welke vereiste het vervult, of de melding dat het nergens aan gekoppeld is, met een select om dat ter plekke recht te zetten.

---

## TECHNISCH

### Kern van de oplossing

`procedure_bewijs` krijgt één kolom:

```
requirement_sleutel text   -- stap_volgorde|requirement_type|coalesce(documenttype, label)
```

Vervulling van een `document`/`external_submission`/`consultation`-vereiste is daarmee een gelijkheidstest op die sleutel — in TypeScript én in plpgsql. Geen wildcard, geen documenttype-gok, geen titel-substring.

**Verbruik is een eigenschap van het datamodel geworden, geen algoritme.** Een bewijsstuk draagt precies één sleutel en kan dus per constructie hoogstens één vereiste vervullen. Er is geen toewijzingsalgoritme, geen volgorde-afhankelijkheid, en TS en SQL kunnen niet uiteenlopen op een heuristiek: beide doen alleen nog `=`.

### Waarom een sleutel en geen FK

- **Twee brontabellen.** Vereisten leven in `procedure_requirements` (globale templateconfiguratie) én `procedure_requirement_instance` (per Decision Object, D7). Eén FK-kolom kan er maar één van referencen; twee nullable FK's + CHECK verdubbelt de logica in beide lagen.
- **Template-ids zijn instabiel by design.** `genereerRequirementsSeed()` produceert `delete from procedure_requirements where template_code = '…'` gevolgd door een volledige re-insert. Elke seed-regeneratie geeft nieuwe ids; een FK zou cascaden of nullen. Dat botst frontaal met de guardrail *snapshot-integriteit*: een lopende procedure mag niet meebewegen met een latere templatewijziging.
- **De identiteit bestond al.** `coalesce(documenttype, label)` draagt de unieke index `idx_req_uniek` op `procedure_requirements` en `procedure_requirement_uitsluiting.match_sleutel`. We voegen geen vierde waarheid toe maar sluiten aan op de bestaande.

### Eén definitie van de sleutel

`core/lib/requirement-sleutel.ts` is de enige TS-definitie:

```ts
requirementIdentiteit(documenttype, label) = documenttype ?? label
requirementSleutel(stap, type, documenttype, label) = `${stap}|${type}|${identiteit}`
```

Bewust géén trim en géén lowercase — de SQL-tegenhanger normaliseert ook niet, en stille normalisatie in één laag zou de spiegeling breken. Het uitsluitingsfilter in `decision.ts` gebruikt nu dezelfde helper, zodat uitsluiting en binding niet uit elkaar kunnen lopen.

De SQL-tegenhanger staat inline in `fn_decision_readiness_check`:

```sql
v_sleutel text := rij.stap_volgorde::text || '|' || rij.requirement_type ||
                  '|' || coalesce(rij.documenttype, rij.label);
```

Let op: `rij.requirement_type`, niet `v_type`. `v_type` mapt `external_submission`/`consultation` naar de document-afhandeling, maar de sleutel houdt het echte type — anders zou een `consultation`-vereiste door een als `document` gebonden stuk vervuld worden.

### Gewijzigde componenten

| Laag | Bestand | Wijziging |
|---|---|---|
| Sleutel | `core/lib/requirement-sleutel.ts` (nieuw) | Eén definitie van identiteit + sleutel |
| Weergave | `core/lib/decision.ts` | `vervultDocumentRequirement()` afgesplitst als pure functie; wildcard weg; bewijslijst deterministisch gesorteerd op `(toegevoegd_op, id)` |
| Contract | `core/lib/decision-view.ts` | `BewijsItem.requirement_sleutel` |
| Gate | `supabase/migrations/2026_08_18_…sql` | Document-tak matcht op de binding; kolom + partiële index; backfill |
| Binding | `core/lib/bewijs-binding.ts` (nieuw) | Server-side afleiden + verifiëren van de sleutel uit een triple |
| API | `app/api/procedures/[id]/bewijs/route.ts`, `…/[bewijsId]/route.ts` | `vereiste`-triple accepteren, valideren, loggen |
| UI | `StapPaneel.tsx`, `procedures/[id]/page.tsx` | Bindingskeuze bij opvoeren; binding tonen/zetten bij opgevoerde stukken |
| Seed | `procedure-requirements-seed.ts`, `procedure-definitie.ts` | Lege/dubbele matchsleutel per stap wordt geweigerd |

### Server-side gating

De client stuurt de vereiste als triple (`stap_volgorde`, `requirement_type`, `documenttype`, `label`) — niet als kant-en-klare sleutel. `resolveRequirementBinding()` leidt de sleutel af en verifieert dat een vereiste met die identiteit bestaat voor deze procedure, in de template-arm (op `template_code`) of de instantie-arm (op het Decision Object). Onbekend ⇒ 400. Zo kan een binding nooit naar een verzonnen vereiste wijzen, en zit de gating niet uitsluitend in de UI. Hetzelfde patroon als `/requirements/uitsluiten`, dat de triple ook al ontvangt.

Ook getoetst: de stap van het bewijsstuk moet overeenkomen met `vereiste.stap_volgorde`. De gate eist zowel `ps.volgorde = rij.stap_volgorde` als sleutelgelijkheid, dus een binding naar een vereiste op een ándere stap zou een *dode* binding zijn — hij telt nergens mee, maar de UI zou het tegendeel suggereren.

Uitsluitingen wegen bewust niet mee bij het binden: binden aan een uitgesloten vereiste is onschadelijk (het telt nergens mee) en een uitsluiting kan worden ingetrokken, waarna de binding weer klopt.

### Backfill

Bestaande rijen hebben geen binding. De migratie bindt alleen waar dat **deterministisch en wederzijds eenduidig** is:

1. **R1** — `pb.documenttype` gelijk aan het `documenttype` van een vereiste op die stap.
2. **R2** — `pb.titel` gelijk aan het `label` van een vereiste (case- en spatie-ongevoelig). Dit is het productieve pad voor `pf_wtp_invaarbesluit`: "opvoeren vanuit vereiste" prefilt de titel met het label.

Gebonden wordt alleen als het bewijsstuk precies één kandidaat matcht, die kandidaat door precies één ongebonden stuk wordt geclaimd, én er nog geen ander stuk aan hangt. De titel-*substring*-match uit de oude logica is bewust géén backfillregel: die is fuzzy en zou juist de vals-positieven bestendigen die we opruimen.

Wat overblijft blijft ongebonden en verschijnt als "op te voeren". Dat is de correctie, niet een regressie — maar het is wél zichtbaar voor gebruikers, dus het staat in de release-notitie.

De kandidatenset is **fonds-hard** gejoind (`d.fonds_id = p.fonds_id`, `i.fonds_id = p.fonds_id`). `decision_objects` kent geen composite-FK of trigger die `fonds_id` aan `procedures.fonds_id` gelijkstelt, en de backfill draait als eigenaar — dus buiten RLS. Zonder die conditie zou een decision object dat naar een procedure van een ánder fonds wijst kandidaten kunnen toevoegen of (via de uitsluitings-subquery) wegfilteren.

**Auditspoor.** Eén append-only regel per geraakte procedure in `procedure_log`, `event_type = 'bewijs_binding_backfill'`, zonder actor maar expliciet benoemd als systeemmutatie. De payload draagt **beide** helften: de gelegde bindingen per rij (`bewijs_id`, `sleutel`, en de regel R1/R2 die hem legde) én de ids die ongebonden bleven. Dat is geen luxe — de backfill is niet achteraf herrekenbaar, want de kandidatenset leunt op `procedure_requirements`, dat bij elke seed-regeneratie wordt ge-delete en opnieuw ingevoegd. Wat hier niet in de log staat, is definitief weg.

De idempotentie-guard zit op de **logging van een lege run**, niet op de mutatie: er wordt gelogd zodra deze run daadwerkelijk iets heeft gebonden, én bij de allereerste run ook als er niets te binden viel (dat legt de uitgangstoestand vast). Een herhaalde plak-run die niets muteert voegt dus geen ruis toe; een herhaalde run die wél nieuwe stukken bindt, logt dat. Een stille mutatie is daarmee uitgesloten.

### Determinisme

- De bewijslijst per stap wordt in `decision.ts` gesorteerd op `(toegevoegd_op, id)` vóór de match. PostgREST garandeert geen returnvolgorde; zonder die sortering kon `bron_id`/`bron_titel` per aanroep wisselen bij meerdere gebonden stukken.
- De gate gebruikt `exists` en is per constructie ordeningsonafhankelijk.
- De sleutelvorm is gepind in `requirement-sleutel.sanity.ts`.

### Seed-regenerator gehard

`genereerRequirementsSeed()` gooit nu bij een lege identiteit of een dubbele `(requirement_type, coalesce(documenttype,label))` binnen dezelfde stap; `valideerDefinitie()` meldt hetzelfde bij de bron, met stap- en indexpositie. Dat spiegelt `idx_req_uniek` in code, zodat een kapotte definitie faalt vóórdat de migratie geplakt wordt. De invaardefinitie v2.0.0 voldoet: alle 12 stappen leveren unieke sleutels.

### RLS en security

- **RLS ongewijzigd.** De policy `"fonds proc bewijs"` (USING + WITH CHECK op `stap → procedure → fonds_id`) is rij-gebaseerd; een nieuwe kolom valt er automatisch onder. Tabelgrants aan `authenticated` gelden per definitie voor nieuwe kolommen (er bestaan in deze repo geen kolom-gescopeerde grants). DEEL 3 van de gedragstoets bewijst dit onder échte RLS: een gebruiker van fonds B leest, wijzigt en insert geen `requirement_sleutel` op een bewijsstuk van fonds A.
- **`fn_decision_readiness_check` is SECURITY INVOKER**, niet DEFINER (`prosecdef = false`, geverifieerd tegen de preview-baseline). De functie draait dus onder de RLS van de aanroeper; gate E (gepind `search_path`) is niet van toepassing. Gate H wél.
- **Correctie op een aanname die in meerdere migraties staat:** `create or replace function` **behoudt** de ACL — alleen `drop function` + `create` reset hem, waarna `anon` via de Supabase default-ACL opnieuw EXECUTE krijgt (bevinding H-18 / OP-C5). Empirisch getoetst op Postgres 16 bij deze wijziging. Het commentaar "create-or-replace reset de ACL" in eerdere migraties klopt dus niet; de `revoke`/`grant`-regels blijven wél staan — ze zijn defensief en idempotent, en leggen de bedoelde eindtoestand expliciet in de migratie vast.
- **Fail-closed guard toegevoegd.** De functie miste een `if not found`-controle op de procedure-lookup (pre-existent, sinds de eerste versie). Bij een onvindbare procedure leverde de template-arm nul requirements en antwoordde de gate `voldoet = true, ontbrekend = []` — een readiness-gate die bij ontbrekende context "ja" zegt. Nu retourneert hij `procedure_not_found`, net als bij een onvindbaar decision object.
- Geen service-role, geen nieuwe SECURITY DEFINER-functie, geen policywijziging.

### Verificatie

| Laag | Artefact | Uitkomst |
|---|---|---|
| Typecheck | `tsc --noEmit --skipLibCheck` | groen |
| Sleutelvorm | `core/lib/requirement-sleutel.sanity.ts` | 6 checks |
| Matchlogica | `core/lib/decision.sanity.ts` | 8 checks, incl. de kernfixture |
| Seed-hardening | `core/lib/procedure-requirements-seed.sanity.ts` | 6 checks (was 2) |
| Spiegeling TS↔SQL | `tests/cross-tenant/procedure-v2-governance.test.ts` | 7 nieuwe tests |
| Gate-gedrag (DB) | `supabase/checks/2026_08_18_bewijsbinding.sql` | 3 structuur- + 7 gedrags- + 3 tenant-isolatiechecks |
| Migratie + backfill + rollback | wegwerp-Postgres 16 | migratie, backfill (R1/R2, ambigu, geen-match), herhaalde run, auditpayload en rollback geverifieerd |

De TS-sanity en de SQL-check gebruiken bewust dezelfde fixture (3 ongetagde blokkerende document-vereisten met dezelfde labels + 1 gebonden stuk), zodat "weergave en gate oordelen gelijk" een toets is en geen bewering.

DEEL 3 van de gedragstoets draait onder échte RLS (`set local role authenticated` + jwt-claim): een gebruiker van fonds B ziet het bewijsstuk van fonds A niet, kan de binding ervan niet wijzigen, en kan geen gebonden stuk op een stap van fonds A invoegen.

### Auditspoor per handeling

| Handeling | Event | Payload |
|---|---|---|
| Bewijs opvoeren | `bewijs_toegevoegd` | `bewijs_id`, stap, titel, `requirement_sleutel`, `requirement_label` |
| Binding zetten/wijzigen/losmaken | `bewijs_binding_gewijzigd` | `bewijs_id`, stap, titel, `oud`, `nieuw` |
| Document koppelen | `bewijs_document_gekoppeld` | `bewijs_id`, stap, titel, document, `document_id_oud`/`_nieuw` |
| Bewijs verwijderen | `bewijs_verwijderd` | `bewijs_id`, stap, titel, `document_id`, `requirement_sleutel` (welke vereiste weer openvalt) |
| Stemverslag als bewijs | `bewijs_toegevoegd` (`bron: "stemverslag"`) | `bewijs_id`, stap, titel, `stemming_id`, `requirement_sleutel: null` |
| Backfill | `bewijs_binding_backfill` | regels, aantallen, gelegde bindingen per rij, ongebonden ids |

Het stemverslag-pad (`app/api/stemmingen/[id]/sluiten/route.ts`) schreef eerder een `procedure_bewijs`-rij zónder enige logregel. Dat is met deze wijziging rechtgezet: het is het enige pad waarlangs het systeem zelf bewijs in het dossier zet, en het draagt bewust géén binding — het systeem bepaalt niet welke bewijslast een stemverslag vervult.

### Restrisico's

1. **Zichtbare correctie.** Dossiers die vandaag "alle opgevoerd" tonen, tonen na deployment openstaande bewijslast voor alles wat de backfill niet eenduidig kon binden.
2. **Stap-hernummering** zou bindingen breken: de sleutel bevat `stap_volgorde`. Er is vandaag geen herordenfunctie (geen `update` op `procedure_stappen.volgorde` in de codebase). Komt die er, dan moet de binding meebewegen.
3. **Sleutelbotsing template ↔ instantie.** `procedure_requirement_instance` kent geen tegenhanger van `idx_req_uniek`. Een instantie-vereiste met dezelfde `(stap, type, identiteit)` als een template-vereiste zou door één gebonden stuk allebei vervuld worden. Staat op de risicolijst.
4. **`min_aantal` telt niet mee** voor document-vereisten — bestaand gedrag, ongewijzigd gelaten.
5. **Stemverslagen** worden als bewijsstuk ingevoegd zonder binding en vervullen dus niets tot iemand ze koppelt. Vandaag geen concrete regressie (geen seed-vereiste heet "stemverslag"), maar structureel wel een gedragsverandering.
6. **Twee handmatige stappen op rij.** Er is geen migratierunner: eerst de migratie in de Supabase SQL-editor, dán code-deploy. Andersom selecteert `decision.ts` een kolom die nog niet bestaat.
7. **De binding is route-omzeilbaar.** `procedure_bewijs` valt onder een `for all`-policy en heeft geen triggers; elk fondslid kan met de anon-key via PostgREST rechtstreeks `requirement_sleutel` zetten, zónder auditregel. Het auditspoor zit in de routes, niet in de database. Dat patroon bestond al voor `documenttype`, maar deze wijziging maakt de kolom dragend voor het gate-oordeel. Risicolijst OP-BB4.
8. **Bewijslast valt buiten de dossier-snapshot.** `fn_build_decision_dossier` bevat geen `procedure_bewijs`, geen requirements en geen readiness; het auditdossier vult `bewijs = []` in snapshotmodus. "Besluitrijp gehaald op datum X" is dus niet te herleiden naar de bindingen die dat droegen, en die bindingen zijn muteerbaar. Niet door deze wijziging veroorzaakt, wél dragend geworden. Risicolijst OP-BB5.
9. **Dubbele `stap_volgorde`.** `procedure_stappen` kent geen `unique(procedure_id, volgorde)`. De gate joint álle stappen met die volgorde, `decision.ts` mapt volgorde → één stap. Bij dubbele volgorde kunnen de lagen uiteenlopen. Risicolijst OP-BB6.
10. **Logregels zijn fire-and-forget.** Mutatie en `procedure_log`-insert zitten niet in één transactie (bestaand patroon in deze repo). Faalt de logregel, dan staat de mutatie er wel en de audit niet.
