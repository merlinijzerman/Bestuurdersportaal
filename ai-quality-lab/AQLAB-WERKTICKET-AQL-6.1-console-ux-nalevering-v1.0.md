# Werkopdracht AQL-6.1 — Console-UX nalevering (openstaande UX-punten)

- **Ticket:** AQL-6.1 (kleine nalevering na AQL-6) · **Versie:** v1.0 · **Datum:** 2026-07-11
- **Overdracht:** goedgekeurd in plansessie (Cowork) → uit te voeren in Claude Code, repo-root. Zie `WERKOPDRACHT-TEMPLATE.md`.
- **Werkmodus:** begin in **Plan-modus**. Wijzig pas ná expliciet akkoord.

---

## Doel & context

Bij het testen van de gebouwde console bleven vier UX-bevindingen staan. Ze waren **wel in de AQL-5-werkopdracht opgenomen**, maar zijn **nooit geïmplementeerd**: AQL-5 was al als gebouwd afgetekend (besluit 0062) vóórdat deze verfijningen aan het ticket werden toegevoegd, en AQL-6 (multi-provider) raakt ze niet. Dit ticket bundelt precies die openstaande punten als zelfstandig, klein werkitem zodat ze niet opnieuw wegzakken. Puur front-end/console; geen datamodel- of provider-impact.

## Vastgestelde feiten (geverifieerd in de code)

- `app/(platform)/platform/(beveiligd)/aqlab/page.tsx` toont nog steeds **drie topknoppen** (`/aqlab/adhoc` "Ad-hoc consistentietest", `/aqlab/promoveren` "Ad-hoc vraag opslaan als testcase", `/aqlab/dashboard` "Kwaliteit per feature").
- Het samenstel-formulier verbergt **stap 2** bij `run_type = ad_hoc`, waardoor de nummering van 1 naar 3 springt.
- De directe ad-hoc consistentietest draait via `/aqlab/adhoc` (`acties.ts`, `persist_mode` default `none`); het formulier-ad-hoc zet nu nog een async run in de wachtrij.

## Scope (Wel)

1. **Stap 2 zichtbaar bij ad-hoc + nummering 1‑2‑3.** De modelkeuze (stap 2) blijft bij álle run-types zichtbaar. Bij `ad_hoc`: alleen de modelkeuze ("Welk model gebruik je?"), zonder baseline-kaart en zonder "gewijzigde as". De stappen slaan nooit over.
2. **Ad-hoc = één ingang, altijd niet-persistent.** Run-type `ad_hoc` forceert `persist_mode = none` (niet instelbaar, zichtbaar gelabeld), direct/synchroon, resultaat meteen zichtbaar; knop heet "Ad-hoc testen (niet bewaard)". De **aparte topknop + route-ingang "Ad-hoc consistentietest"** vervalt (functionaliteit — consistentie-toggle + iteraties — zit al in het formulier). Log de *gebeurtenis* append-only in `aqlab_log` (inhoud niet).
3. **"Ad-hoc vraag opslaan als testcase" uit de UI (geparkeerd).** Topknop + promoveren-flow (`/aqlab/promoveren`) verbergen om de schermen simpel te houden; eventuele "opslaan als testcase"-acties op de scorekaart eveneens. `lib/aqlab/promotie.ts` + route mogen blijven staan (niet verwijderd), alleen uit de UI.
4. **Topknoppenrij verdwijnt.** De losse actie-rij boven "Run samenstellen" vervalt volledig. *"Kwaliteit per feature"* (`/aqlab/dashboard`, scherm 7) blijft bestaan maar wordt een **rustige nav-link** (header rechtsboven of bij het "Runs"-overzicht), geen samenstel-knop.

**Niet:** datamodel-/migratiewijzigingen, provider-werk (AQL-6), promotie-logica herbouwen (alleen verbergen).

> Leidend: `AQLAB-MOCKUP-run-samenstellen-v0.1.html` (toont het gewenste eindbeeld: nav-link in de header, stap 2 bij ad-hoc, ad-hoc "niet bewaard").

## Relevante bestanden / modules

`app/(platform)/platform/(beveiligd)/aqlab/page.tsx` (topknoppen + form), `.../aqlab/acties.ts` (ad-hoc `persist_mode`, event-log), `.../aqlab/adhoc/*` (topknop/route weg of redirect), `.../aqlab/promoveren/*` (uit UI), `.../aqlab/dashboard` (blijft, wordt nav-link), evt. de scorekaart-component voor "opslaan als testcase"-actie.

## Guardrails (`CLAUDE.md`)

- Blokkers/validaties **server-side her-gevalideerd**, niet alleen in de UI.
- Ad-hoc gebeurtenis **append-only gelogd**; geen inhoud bij `persist_mode = none`.
- Geen provider-/key-wijziging; geen RLS-/datamodel-impact.

## In te zetten subagents

`ai-literacy-ux-reviewer` (microcopy/labeling: "niet bewaard", nav-link), `code-reviewer`, `ontwerp-sync-reviewer` vóór merge (functioneel scherm 3 bijwerken: ad-hoc-consolidatie + stap 2).

## Definition of Done

- [ ] Bij `run_type = ad_hoc` is stap 2 zichtbaar ("Welk model gebruik je?"); nummering loopt 1‑2‑3, geen oversprongen stap.
- [ ] Ad-hoc forceert `persist_mode = none` (niet instelbaar); knop "Ad-hoc testen (niet bewaard)"; aparte "Ad-hoc consistentietest"-topknop/ingang verwijderd; gebeurtenis gelogd.
- [ ] "Ad-hoc vraag opslaan als testcase" + promoveren-flow niet meer bereikbaar in de UI.
- [ ] Losse topknoppenrij weg; "Kwaliteit per feature" bereikbaar als rustige nav-link.
- [ ] `./node_modules/.bin/tsc --noEmit --skipLibCheck` groen; `npm run sanity` groen; visuele smoke-test per run-type.
- [ ] `HANDOVER.md` release-historie bijgewerkt; functioneel scherm 3 geactualiseerd; ontwerp-sync-check groen.

## Terugkoppeling (antwoordformat `CLAUDE.md`)

(1) samenvatting, (2) aangepaste bestanden, (3) RLS/security-impact (n.v.t./bevestigen), (4) audit-logging-impact (ad-hoc event), (5) datamodel/migratie-impact (geen), (6) test/verificatie, (7) openstaande punten.
