# 0193 — Status-feitenmatrix (P4) en het readiness-interim van PR-D

- **Status:** Geaccepteerd (richting P4; interim bindend)
- **Datum:** 2026-08-28
- **Betrokkenen:** Merlin IJzerman (opdrachtgever/eigenaar), Claude (analyse en uitwerking)

## Context

[[0187]] schaft de readiness-ladder af: readiness is een **zacht** bestuurlijk oordeel dat als harde 400-gate op de besluitstatus-overgangen was ingekleed (§4.5). PR-D (#168) voert dat uit — de vijf gates vervallen, vervangen door §4.4-signalering. De **harde** tegenhanger die I1 ("een besluitstatus die een feit stelt, vereist dat feit") voorwaarts afdwingt, is de status-feitenmatrix `besluitstatus_vereist_feit` (§4.6). Die landt in **P4** ([#169](https://github.com/merlinijzerman/Bestuurdersportaal/issues/169)), niet in PR-D.

Dit besluit legt twee dingen vast: de richting voor P4, en — nu al bindend — hoe het **interim** tussen PR-D en P4 zich gedraagt.

## Besluit

**1. P4-richting: de status-feitenmatrix.** I1 wordt voorwaarts afdwingbaar als **data**, niet als `if`-reeks per route: een tabel `besluitstatus_vereist_feit(doelstatus, vereist_feit, toelichting)` en een controlefunctie op de statusroute (§4.6). P4 vervangt daarmee het tijdelijke I1-ontkoppelslot (P2b) door de volledige, tweezijdige invariant.

**2. Interim-gedrag (PR-D, bindend).** De readiness-gate is weg. Een besluit-transitie (`besloten`/`voorwaardelijk_besloten`) wordt **niet geblokkeerd** omdat er iets openstaat — een bestuur mag besluiten vóór de nazorg af is (§4.4). Maar het is geen vrije doorgang: gaat het besluit door terwijl er vereisten **boven optioneel** openstaan, dan is een **motivering verplicht** (I2, dezelfde vorm als de afwijking bij afronden in PR-C — non-empty, server-afgedwongen, minimumlengte), en wordt append-only `besluit_genomen_met_openstaande_vereisten` geschreven met de per-zwaarte-snapshot (`{label, requirement_sleutel}`) plus de motivering. Niet blokkeren, wél onthouden — dezelfde filosofie als PR-C: het systeem houdt niemand tegen, het onthoudt.

Dit is de **definitieve vastleggingsvorm**, geen tijdelijke constructie: P4's matrix blijft hetzelfde event schrijven wanneer hij de hárde toets toevoegt.

**3. I1 is in het interim half geldig — expliciet benoemd.** Tussen PR-D en P4 wordt I1 alleen **achterwaarts** gehandhaafd: het ontkoppelslot (P2b) belet dat een eenmaal gevuld feit ná het besluit stil verdwijnt. **Voorwaarts** — de overgang zélf weigeren als het feit ontbreekt — is er in het interim niet; dat is precies wat P4's matrix toevoegt. Een invariant die tijdelijk half geldt en dat nergens zegt, is erger dan er geen te hebben; vandaar deze regel.

**4. P3 promoveert niet zonder P4.** Geen aanname maar een **release-voorwaarde**: P3 mag niet naar preview/productie zonder dat P4's status-feitenmatrix meekomt, anders bestaat het "besluit met openstaande vereisten zonder harde toets" op een omgeving waar een bestuurder komt. Vastgelegd als expliciete regel op [#171](https://github.com/merlinijzerman/Bestuurdersportaal/issues/171) (P6), naast de andere blokkades. Schuift P4 op en wil iemand P3 alleen promoveren, dan komt dit besluit opnieuw op tafel.

> **Waarom het interim-venster geen gebruiker raakt.** P6 promoveert P1 t/m P5 samen; het venster waarin een besluit met openstaande vereisten zonder harde toets kan bestaan, leeft alleen op de epic-branch, waar geen bestuurder komt. De motivering-eis + het event maken het venster bovendien **waarneembaar** in plaats van stil — mocht er onverhoopt toch iets doorheen glippen, dan is het terug te vinden.

## Gevolgen

- PR-D verwijdert `fn_decision_readiness_check`/`_overview`, `ReadinessLadder.tsx`, de readiness-gate en -weergave; I1 (P2b) blijft ongemoeid. De besluitmoment-telling (§7) vervangt de readiness-weergave.
- De statusroute schrijft `besluit_genomen_met_openstaande_vereisten` (met motivering) i.p.v. de oude `override_<readiness>`-events; die laatste blijven leesbaar voor bestaande data.
- Openstaand vóór P6: de release-regel "P3 niet zonder P4" ([#171](https://github.com/merlinijzerman/Bestuurdersportaal/issues/171)); de opgenomen authz-matrix-scenario's voor het nieuwe besluit-met-openstaande-pad (bij de stack-run, [#211](https://github.com/merlinijzerman/Bestuurdersportaal/issues/211)-familie).

## Referenties

- Ontwerp: `PROCEDURE-ENGINE-V2-ONTWERP.md` §4.4 (signalering), §4.5 (zacht/hard + de zeven invarianten), §4.6 (status-feitenmatrix), §7 (besluitmoment-telling), §443 (uitfasering).
- Aanleiding en kaders: [[0187]] (readiness vervalt), [[0189]] (vervulling via gebonden feit), [[0192]] (P3 — zwaarte/afwijking, de PR-C-vorm die dit spiegelt).
- EPIC [#164](https://github.com/merlinijzerman/Bestuurdersportaal/issues/164), P3 [#168](https://github.com/merlinijzerman/Bestuurdersportaal/issues/168), P4 [#169](https://github.com/merlinijzerman/Bestuurdersportaal/issues/169), P6 [#171](https://github.com/merlinijzerman/Bestuurdersportaal/issues/171).
