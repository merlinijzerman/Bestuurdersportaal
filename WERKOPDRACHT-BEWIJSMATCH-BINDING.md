# Werkopdracht: expliciete bewijs↔vereiste-binding (bewijsmatching-fix)

> Overdracht van plansessie (Cowork) naar Claude Code. Plak deze werkopdracht als eerste bericht in een Claude Code-sessie in de repo-root. Zie `WERKOPDRACHT-TEMPLATE.md` en `decisions/0004`.

> **Afgerond 22-08-2026.** De uitvoering en actuele restrisico's staan in `BEWIJSMATCH-BINDING-ONTWERP.md` en besluit 0183. Twee aannames uit deze oorspronkelijke opdracht zijn gecorrigeerd: `fn_decision_readiness_check` is SECURITY INVOKER, en audit/validatie zitten na hardening transactioneel in database-triggers zodat directe PostgREST-writes niet kunnen omzeilen.

**Doel & context** — Eén geüpload bewijsstuk vinkt nu álle document-vereisten van dezelfde stap tegelijk af ("3 gevraagd · alle opgevoerd" na één upload). Dezelfde logica zit in de readiness-gate, waardoor **blokkerende** bewijslast ten onrechte als compleet kan gelden — een governance-/dossierrisico bij het invaarbesluit. We vervangen de impliciete "eerste-de-beste"-match door een **expliciete, verbruikende 1-op-1-binding** tussen een bewijsstuk en een vereiste, consistent in de weergave- én de readiness-laag.

**Root cause (geverifieerd)** — In `core/lib/decision.ts::buildEvidenceLijst` (regel 640) en in `fn_decision_readiness_check` (`supabase/migrations/2026_05_08_phase_1d_readiness_fix.sql`, regel 77) geldt: een vereiste zonder `documenttype`-tag matcht op *elk* bewijsstuk van de stap (`if (!req.documenttype) return true` / `rij.documenttype is null OR ...`). De stap-1-vereisten van `pf_wtp_invaarbesluit` zijn in seed v2 (`2026_08_14_invaar_requirements_seed_v2.sql`) alle `documenttype = null`. Bijkomend: `.find()`/`EXISTS` "verbruikt" een bewijsstuk niet, dus één stuk kan meerdere vereisten tegelijk vervullen. `procedure_bewijs` kent nu geen koppeling naar een specifiek vereiste.

**Goedgekeurd ontwerp/plan (optie B) — leidend**
1. **Expliciete binding.** Voeg aan `procedure_bewijs` een stabiele koppeling naar het vervulde vereiste toe. Voorkeur: `requirement_sleutel text` volgens het bestaande sleutelpatroon uit de uitsluitingslogica (`${stap_volgorde}|${requirement_type}|${documenttype ?? label}`), zodat het werkt voor zowel template- als instantie-vereisten (die geen gedeelde FK hebben). Claude Code weegt in Plan-modus of een `requirement_id`-FK robuuster is; motiveer de keuze.
2. **Verbruik (1-op-1).** Een bewijsstuk vervult ten hoogste één vereiste; een vereiste consumeert ten hoogste één bewijsstuk. Geen dubbeltelling meer over meerdere vereisten van dezelfde stap.
3. **Wildcard weg.** Een vereiste zonder `documenttype` matcht niet langer automatisch op willekeurig bewijs; vervulling loopt via de expliciete binding (met de bestaande documenttype-/titelmatch nog als voorgestelde default bij het opvoeren, niet als automatische afvinker).
4. **Spiegeling.** `decision.ts` (weergave) en `fn_decision_readiness_check` (gate) geven ná de wijziging een **identiek** oordeel; het determinisme uit `WERKOPDRACHT-RETRIEVAL-DETERMINISME.md` blijft geborgd.
5. **Seed-regenerator gehard.** `core/lib/procedure-requirements-seed.ts::genereerRequirementsSeed()` dwingt af dat de bindings-/matchsleutel per vereiste niet-leeg en uniek per stap is; borg met de bestaande drift-sanitycheck, zodat dit niet opnieuw via een seed insluipt.

**Scope**
- Wel: schema-uitbreiding `procedure_bewijs` (+ rollback); aanpassing matchlogica in `decision.ts`; aanpassing `fn_decision_readiness_check`; binding vastleggen bij opvoeren/koppelen (`app/api/procedures/[id]/bewijs/**`, `StapPaneel.tsx`); regenerator-hardening + drift-check; regressietests; backfill bestaande `procedure_bewijs`-rijen.
- Niet: herontwerp van het requirements-datamodel; wijziging aan andere `requirement_type`-takken dan `document`/`external_submission`/`consultation` (tenzij de verbruiklogica dat raakt); UI-herontwerp van de bewijssectie buiten de bindingskoppeling.

**Impactklasse — data.** Schema-uitbreiding op `procedure_bewijs` én wijziging aan de `SECURITY DEFINER`-functie `fn_decision_readiness_check`. Gevolg: (1) de documentatiehaak vuurt (actualiseer `00–09` + as-built Word-doc en verschuif de marker in `doc-actualisatie-log.md` ná de Word-actualisatie); (2) `supabase/checks/2026_07_31_r1_structurele_gates.sql` moet schoon draaien tegen de doeldatabase — niet-onderhandelbaar.

**Relevante bestanden / modules** (Claude Code verifieert tegen de werkelijke code)
- `core/lib/decision.ts` — `buildEvidenceLijst`, `document`/`external_submission`/`consultation`-tak (regel ~632–651; wildcard regel 640).
- `supabase/migrations/2026_05_08_phase_1d_readiness_fix.sql` — `fn_decision_readiness_check`, document-tak (regel ~68–79).
- `supabase/migrations/2026_04_29_procedures.sql` — definitie `procedure_bewijs`; nieuwe migratie voor de bindingskolom + rollback.
- `core/lib/procedure-requirements-seed.ts` (+ `.sanity.ts`) en `2026_08_14_invaar_requirements_seed_v2.sql` — regenerator/seed.
- `app/api/procedures/[id]/bewijs/route.ts` en `.../bewijs/[bewijsId]/route.ts` — binding zetten bij opvoeren/koppelen + append-only log.
- `app/(dashboard)/procedures/_components/StapPaneel.tsx` — `opvoerenVanuitVereiste`/koppelen: vereiste-binding meesturen.
- `core/lib/procedure-detail-weergave.ts` / `procedure-fase-status.ts` — dekking/samenvatting ongewijzigd van betekenis, wel geverifieerd tegen de nieuwe telling.

**Guardrails (zie `CLAUDE.md` §Niet-onderhandelbare guardrails)** — bijzondere aandacht: append-only `procedure_log` bij het zetten/wijzigen van een binding; RLS ongewijzigd (bestaande `fonds proc bewijs`-policy dekt de nieuwe kolom, verifieer dit expliciet); weergave- en readiness-oordeel deterministisch en identiek; geen stille backfill zonder auditspoor.

**In te zetten subagents (zie `SUBAGENTS-ONTWERP.md` §4)** — `supabase-rls-reviewer` (schema + `SECURITY DEFINER`-functie), `audit-evidence-reviewer` (evidence/readiness-consistentie + auditspoor), `code-reviewer`, en `ontwerp-sync-reviewer` vóór merge. Overweeg `ai-governance-reviewer` als de bewijsbinding de AI-onderbouwingscontext raakt.

**Werkmodus** — begin in **Plan-modus**: lever eerst een implementatieplan (bindingskeuze sleutel vs. FK met motivering, migratie- + rollback-aanpak, backfillstrategie voor bestaande rijen, RLS-impact, spiegeling TS↔SQL, testaanpak, restrisico's). **Wijzig pas na expliciet akkoord.** Overweeg in het plan of een kort `BEWIJSMATCH-BINDING-ONTWERP.md` gerechtvaardigd is gezien datamodel- + `SECURITY DEFINER`-impact.

**Definition of Done** — volg `CLAUDE.md` §Definition of Done. Opdracht-specifieke invulling:
- Migratie + bijbehorende `*_ROLLBACK.sql`; structurele gates schoon tegen de doeldatabase.
- Regressietest (sanity of test): 3 ongetagde document-vereisten op één stap + 1 geüpload/gekoppeld bewijsstuk ⇒ `2 gevraagd · nog 2 op te voeren`, en `besluitrijp`/`onderbouwing_compleet` blijft geblokkeerd op de twee blokkerende vereisten. Eén bewijsstuk kan nooit >1 vereiste vervullen.
- Test dat weergave (`decision.ts`) en gate (`fn_decision_readiness_check`) hetzelfde oordeel geven op dezelfde fixture.
- Regenerator-drift-check faalt als een vereiste een lege/dubbele bindingssleutel per stap krijgt.
- Documentatiehaak afgerond (`00–09` + Word-doc + marker in `doc-actualisatie-log.md`).
- Decision-record aanmaken (`decisions/00XX`) voor de bindingskeuze.

**Openstaande punten** — beleg in `00 Overzicht en status/openstaande-punten-en-risicos.md`, mét eigenaar:
- **Backfill bestaande `procedure_bewijs`-rijen** zonder binding: strategie (auto-binden op documenttype/titel waar eenduidig; anders "ongebonden" laten en zichtbaar markeren als "op te voeren"). Eigenaar: <in te vullen>.
- **Interim-mitigatie vóór de fix**: eventueel tijdelijk unieke `documenttype`-tags op de `pf_wtp_invaarbesluit`-stap-1-vereisten seeden (optie A) om vals-positieven te dempen; expliciet als tijdelijk markeren. Eigenaar: <in te vullen>.

**Terugkoppeling** — rapporteer in het antwoordformat uit `CLAUDE.md` (samenvatting, aangepaste bestanden, RLS/security-impact, audit-impact, datamodel/migratie-impact, test/verificatie, openstaande risico's).
