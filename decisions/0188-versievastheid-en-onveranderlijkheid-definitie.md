# 0188 — Versievastheid en onveranderlijkheid van een proceduredefinitie (I7)

- **Status:** Geaccepteerd
- **Datum:** 2026-08-24
- **Betrokkenen:** Merlin IJzerman (opdrachtgever/eigenaar), Claude (analyse en uitwerking)

## Context

De bewijslast van een dossier wordt live gelezen uit `procedure_requirements` per `template_code`. Een gewijzigde seed verandert daarmee de bewijslast van **lopende én afgeronde** dossiers — met terugwerkende kracht en zonder spoor. Voor een toezichtgevoelig dossier is dat geen ongemak maar een auditprobleem: "welke bewijslast gold toen dit besluit viel" is dan niet reproduceerbaar.

Dit is invariant **I7** uit `PROCEDURE-ENGINE-V2-ONTWERP.md` v0.10 §13.1. Het verschil dat telt is dat tussen *versiepinning* (het dossier wíjst naar een versie) en *versiebevriezing* (die versie **kán** niet meer veranderen). Alleen het tweede is verdedigbaar tegenover een toezichthouder.

Randvoorwaarden: snapshot-integriteit (een lopend dossier mag niet meebewegen met een latere templatewijziging), append-only audit, en dat de maatregel in de **database** zit en niet alleen in de app-laag (governance-logica hoort niet uitsluitend in de route). Drie as-built-correcties op de v0.9-schets, geverifieerd tegen `origin/main`: er is geen registry (`procedure_template_versies` bestaat niet), `procedure_requirement_instance` is op `decision_id` gesleuteld en krijgt géén versie, en `decision_objects.template_versie` bestaat al maar werd met de *code* gevuld.

## Besluit

`procedure_requirements` krijgt een `template_versie` (not null, per `template_code` uit de bron gebackfilld — nooit een blanket default), en `idx_req_uniek` wordt daarmee uitgebreid. Onveranderlijkheid wordt afgedwongen door een **eigen minimaal publicatieregister** `procedure_definitie_publicatie(template_code, template_versie, …)` plus een trigger op `procedure_requirements` die **elke** mutatie (insert/update/delete) weigert zodra die `(code, versie)` gepubliceerd is. Het register is zélf append-only: publiceren kan, ontpubliceren bestaat niet.

## Overwogen alternatieven

- **De registry uit `procedure_template_versies` (v0.9-schets)** — verworpen: die tabel bestaat niet; de registry is fase C van `PROCEDURE-GENERIEK-ONTWERP.md` en valt buiten deze EPIC. Een eigen minimaal register is genoeg en fase C kan het later absorberen.
- **Trigger alleen op `UPDATE OR DELETE`** (letterlijke §13.1-schets) — verworpen ten gunste van óók `INSERT`: een vereiste *toevoegen* aan een bevroren versie verandert de bewijslast van een lopend dossier net zo goed. I7 zegt "onveranderlijk", niet "grotendeels". De kostenkant valt weg omdat de geblokkeerde DELETE het idempotente re-seed sowieso al breekt.
- **Een `bevroren`-boolean per requirement-rij** — verworpen: publicatie is een eigenschap van een (code,versie)-*set*, niet per rij; een nieuwe INSERT in een bevroren versie zou ongemerkt door de mazen glippen.
- **Alleen in de app/route afdwingen** — verworpen: botst met de guardrail en met de hele I7-eis (verdedigbaar = DB-afgedwongen).
- **Blanket default `'1.0.0'` op de backfill** — verworpen: dat tagt de invaarvereisten als 1.0.0 terwijl lopende dossiers op 2.0.0 pinnen → nul gevonden vereisten en een lege, groene bewijslast. Stil, en erger dan het probleem. De versie wordt per `template_code` uit de bron afgeleid (JSON `versie` / OB-4) en met een regressietest bewezen (evenveel gevonden vereisten vóór en ná).

## Gevolgen

- **Datamodel/migratie:** nieuwe kolommen `procedure_requirements.template_versie` (not null), `procedure_requirements.triggert_bij_ai_risicoklasse` (§8, alleen de kolom — activeren is fase C), `procedures.template_versie` (nullable, gevuld bij start); gewijzigde `idx_req_uniek`; nieuwe tabel `procedure_definitie_publicatie` + twee triggers. `decision_objects.template_versie` gecorrigeerd (versie i.p.v. code; `decision.ts`-fix + backfill). Hand-applied vóór code-deploy; expliciete rollback; forward → rollback → forward getest.
- **Audit/reproduceerbaarheid:** een gepubliceerde bewijslast is onveranderlijk; "welke bewijslast gold toen" is reproduceerbaar. Het publicatieregister is append-only, dus de bevriezing kan niet stil worden teruggedraaid.
- **RLS/tenant:** geen. `procedure_requirements` en `procedure_definitie_publicatie` zijn globale template-tabellen (geen `fonds_id`); geen tenant-pad geraakt. Gate A1/E/F/G/H + V3-grants schoon.
- **Bewust geaccepteerd:** het idempotente `delete+insert`-seedpatroon is voor een gepubliceerde versie niet meer hertoepasbaar. Dat is de onveranderlijkheid, geen bug.
- **Readiness (`fn_decision_readiness_check`) blijft ongewijzigd** — dat is #168 (P3). Behavioraal geen effect nu, want er is één versie per code.

### Het ontsnappingspad — dit is de normale werkwijze, niet de uitzondering

> **Een gepubliceerde definitie wijzigen bestaat niet.** Je maakt een **nieuwe versie**; de seed-generator richt zich op díe versie (de delete/insert is versie-gescopet); en lopende dossiers blijven op hun eigen versie staan tot iemand ze **bewust** migreert.

Dit staat hier expliciet omdat het anders misgaat: de eerste die een typefout in een requirement-label wil herstellen loopt tegen een muur, en dan gebeurt één van twee dingen — men publiceert voortaan niet meer (I7 wordt decoratief), of men omzeilt de trigger via een migratie (I7 wordt schijn). Beide ondermijnen het doel. Een correctie op een gepubliceerde versie is dus altijd een nieuwe versie; dat is precies wat we willen dat er gebeurt.

## Referenties

- Ontwerp: `PROCEDURE-ENGINE-V2-ONTWERP.md` v0.10 §13.1 (I7).
- Migratie: `supabase/migrations/2026_08_24_p1b_versievastheid.sql` (+ rollback in `supabase/rollbacks/`).
- Check: `supabase/checks/2026_08_24_p1b_versie_backfill.sql`.
- Code: `core/lib/decision.ts` (versie-fix + versie-gefilterde lezer), `core/lib/procedure-requirements-seed.ts` (versie-gescopete seed), `app/api/procedures/route.ts` (pin bij start).
- Werkopdracht P1b ([#166](https://github.com/merlinijzerman/Bestuurdersportaal/issues/166)), EPIC [#164](https://github.com/merlinijzerman/Bestuurdersportaal/issues/164).
- Eerder: [[0174]] (proceduremodule-engine v2), [[0183]] (bewijs↔vereiste-binding), [[0187]] (readiness vervalt).
