# 0193 — Status-feitenmatrix (P4) en het readiness-interim van PR-D

- **Status:** Geaccepteerd (richting P4; interim bindend)
- **Datum:** 2026-08-28
- **Betrokkenen:** Merlin IJzerman (opdrachtgever/eigenaar), Claude (analyse en uitwerking)

## Context

[[0187]] schaft de readiness-ladder af: readiness is een **zacht** bestuurlijk oordeel dat als harde 400-gate op de besluitstatus-overgangen was ingekleed (§4.5). PR-D (#168) voert dat uit — de vijf gates vervallen, vervangen door §4.4-signalering. De **harde** tegenhanger die I1 ("een besluitstatus die een feit stelt, vereist dat feit") voorwaarts afdwingt, is de status-feitenmatrix `besluitstatus_vereist_feit` (§4.6). Die landt in **P4** ([#169](https://github.com/merlinijzerman/Bestuurdersportaal/issues/169)), niet in PR-D.

Dit besluit legt twee dingen vast: de richting voor P4, en — nu al bindend — hoe het **interim** tussen PR-D en P4 zich gedraagt.

## Besluit

**1. P4-richting: de status-feitenmatrix.** I1 wordt voorwaarts afdwingbaar als **data**, niet als `if`-reeks per route: een tabel `besluitstatus_vereist_feit(doelstatus, vereist_feit, toelichting)` en een controlefunctie op de statusroute (§4.6). P4 vervangt daarmee het tijdelijke I1-ontkoppelslot (P2b) door de volledige, tweezijdige invariant.

**2. Interim-gedrag (PR-D, bindend).** De readiness-gate is weg. Een besluit-transitie (`besloten`/`voorwaardelijk_besloten`) wordt **niet geblokkeerd** omdat er iets openstaat — een bestuur mag besluiten vóór de nazorg af is (§4.4). Maar het is geen vrije doorgang: gaat het besluit door terwijl er **voor het besluitmoment** vereisten **boven optioneel** openstaan, dan is een **motivering verplicht** (I2, dezelfde vorm als de afwijking bij afronden in PR-C — non-empty, server-afgedwongen, minimumlengte), en wordt append-only `besluit_genomen_met_openstaande_vereisten` geschreven met de per-zwaarte-snapshot (`{label, requirement_sleutel}`) plus de motivering. Niet blokkeren, wél onthouden — dezelfde filosofie als PR-C: het systeem houdt niemand tegen, het onthoudt.

**De eis is besluitmoment-scoped, niet dossierbreed.** §7 definieert precies wat een besluit nodig heeft: de vereisten op de besluitmoment-stap ∪ die met `besluitmoment_stap = N`. Nazorg in een latere fase of een parallelle tak hoort daar niet bij. Een dossierbrede eis zou bijna elk besluit een motivering forceren, ook als er inhoudelijk niets aan de hand is — dan wordt de motivering ruis in plaats van waarborg, en verdwijnt precies de rem die PR-C bewust inbouwde. Wat elders openstaat wordt **wél onthouden**, als telling: het event draagt naast `open_voor_besluitmoment` (de gezaghebbende scope) ook `open_elders` — alleen een aantal per zwaarte, informatief, niet-vorderend. Het geheugen dossierbreed, de eis besluitmoment-scoped.

Dit is de **definitieve vastleggingsvorm**, geen tijdelijke constructie: P4's matrix blijft hetzelfde event schrijven wanneer hij de hárde toets toevoegt.

**3. I1 is in het interim half geldig — expliciet benoemd.** Tussen PR-D en P4 wordt I1 alleen **achterwaarts** gehandhaafd: het ontkoppelslot (P2b) belet dat een eenmaal gevuld feit ná het besluit stil verdwijnt. **Voorwaarts** — de overgang zélf weigeren als het feit ontbreekt — is er in het interim niet; dat is precies wat P4's matrix toevoegt. Een invariant die tijdelijk half geldt en dat nergens zegt, is erger dan er geen te hebben; vandaar deze regel.

**4. P3 promoveert niet zonder P4.** Geen aanname maar een **release-voorwaarde**: P3 mag niet naar preview/productie zonder dat P4's status-feitenmatrix meekomt, anders bestaat het "besluit met openstaande vereisten zonder harde toets" op een omgeving waar een bestuurder komt. Vastgelegd als expliciete regel op [#171](https://github.com/merlinijzerman/Bestuurdersportaal/issues/171) (P6), naast de andere blokkades. Schuift P4 op en wil iemand P3 alleen promoveren, dan komt dit besluit opnieuw op tafel.

> **Waarom het interim-venster geen gebruiker raakt.** P6 promoveert P1 t/m P5 samen; het venster waarin een besluit met openstaande vereisten zonder harde toets kan bestaan, leeft alleen op de epic-branch, waar geen bestuurder komt. De motivering-eis + het event maken het venster bovendien **waarneembaar** in plaats van stil — mocht er onverhoopt toch iets doorheen glippen, dan is het terug te vinden.

**5. Wie mag een besluit met openstaande vereisten nemen — alle vier de rollen, mits motivering.** De oude readiness-override kon alleen een privileged rol (voorzitter/beheerder). Dat vervalt: elke houder van `decisions.manage` (alle vier de rollen) mag, mits met motivering + het append-only event. De verantwoording verschuift van "wie mag overrulen" naar "ieder die besluit legt vast wie het deed en waarom" — één besluit is van het bestuur, en het portaal bewaakt niet wíé het registreert maar dát vastligt wie het deed en waarom. Genomen door de voorzitter, 28-08.

> **De asymmetrie met de stapafwijking is bewust — en P4 herweegt hem.** Een beheerder mag straks wél een besluit met openstaande vereisten vastleggen, maar níét een stap afronden met afwijking (dat is voorzitter + bestuurder, [[0192]] / 26-08). Uitlegbaar: de stapafwijking is een handeling van de **proceseigenaar**, het besluit een handeling van het **bestuur** die het portaal alleen registreert. Maar niet vanzelfsprekend — daarom expliciet, en expliciet gemarkeerd als **punt dat P4 opnieuw weegt** wanneer de status-feitenmatrix formaliseert welke statussen welk feit stellen. Anders leest de volgende het als een omissie en "repareert" hij het.

**6. De motivering is de énige controle — dus onomzeilbaar op DB-niveau.** Zonder rolgate vooraf is de motivering de enige waarborg; hij mag niet langs de route te omzeilen zijn. Twee lekken gedicht:

- *De statusomslag zelf.* RLS op `decision_objects` is `for all` met alleen fondsisolatie (geen rol/capability, geen statusconditie) en `authenticated` had een tabel-brede UPDATE-grant — elk fondslid kon `status` met een directe PostgREST-update op `besloten` zetten, buiten de route én de RPC om. Dat is een **bestaand platformdefect**, breder dan P3 ([#214](https://github.com/merlinijzerman/Bestuurdersportaal/issues/214)); PR-D maakt het alleen zichtbaar. Voor `status` sluit PR-D het declaratief — **kolomniveau-`revoke`** (`2026_08_28_p3d_03`): tabel-brede UPDATE ingetrokken, alle kolommen behalve `status` her-verleend, zodat `fn_besluit_status_omslag` (SECURITY DEFINER, owner) het enige pad is. Voorkeur boven een procedurele GUC/conventie — een privilege is statisch toetsbaar (allowlist-grants).
- *De "open"-bepaling.* Die werd eerst als parameter **meegegeven** aan de RPC; een directe aanroeper gaf `null` mee en ontliep de motiveringseis — een vervalsbare handtekening die beslist of er verantwoording nodig is (zelfde les als `p_actor` bij PR-C). Nu berekent de functie `open` **zelf in SQL**, besluitmoment-scoped, via de D10-getrouwe `fn_stap_open_per_zwaarte`. `open_elders` blijft wél meegegeven — het is informatief, stuurt geen eis, en mag daarom caller-bepaald zijn.

Aanvullend: het event legt **de rol van de actor op dat moment** vast (momentopname, zoals `auteur_naam` bij aantekeningen — niet naderhand herleiden uit een profielentabel die intussen gewijzigd kan zijn). En bij de brede bevoegdheid is **zichtbaarheid achteraf** het tegenwicht dat vooraf ontbreekt: een besluit-met-open verschijnt als **signaal 3 (§12)** op het dossier én het overzicht.

**7. Vals groen bij een leeg besluitmoment — het onderscheid dat de UI moet maken.** `besluitmoment_stap` is in het interim overal leeg (er is nog geen importer); de scope valt dan terug op "alleen de eigen stap" — correct volgens §7, en dat de eis daardoor zelden vuurt is eerlijk, niet stuk. Maar een besluitmoment waaraan **niets** gekoppeld is, toont anders "0 openstaand" omdat er niets hangt, niet omdat alles rond is (§7 r434). De weergave onderscheidt daarom drie toestanden: *geen vereisten gekoppeld* (neutraal, géén geruststelling) ≠ *alle vereisten vervuld* (groen) ≠ *iets open* (per zwaarte). De importvalidatie uit §7 die dit structureel opvangt komt pas met de definitielaag (fase C); tot dan is dit UI-onderscheid de enige bescherming.

## Gevolgen

- PR-D verwijdert `fn_decision_readiness_check`/`_overview`, `ReadinessLadder.tsx`, de readiness-gate en -weergave; I1 (P2b) blijft ongemoeid. De besluitmoment-telling (§7) vervangt de readiness-weergave.
- De statusroute schrijft `besluit_genomen_met_openstaande_vereisten` (met motivering, actor-rol, `open_voor_besluitmoment` + `open_elders`) i.p.v. de oude `override_<readiness>`-events; die laatste blijven leesbaar voor bestaande data. De omslag loopt atomair via `fn_besluit_status_omslag`.
- **Kolom-revoke** (`2026_08_28_p3d_03`): `authenticated` verliest de tabel-brede UPDATE op `decision_objects` en krijgt alle kolommen **behalve `status`** terug. De allowlist-grants-baseline is bijgewerkt (decision_objects-regel + drie SECURITY DEFINER-functieregels — `fn_besluit_status_omslag` en de twee reeds gemergde PR-C-functies die nog ontbraken). Het bredere defect (overige kolommen, `procedure_stappen`, `procedure_besluiten`) is een **eigen tranche**: [#214](https://github.com/merlinijzerman/Bestuurdersportaal/issues/214), niet meeliftend op P3.
- Openstaand vóór P6: de release-regel "P3 niet zonder P4" ([#171](https://github.com/merlinijzerman/Bestuurdersportaal/issues/171)); de opgenomen authz-matrix-scenario's voor het nieuwe besluit-met-openstaande-pad (bij de stack-run, [#211](https://github.com/merlinijzerman/Bestuurdersportaal/issues/211)-familie).

## Referenties

- Ontwerp: `PROCEDURE-ENGINE-V2-ONTWERP.md` §4.4 (signalering), §4.5 (zacht/hard + de zeven invarianten), §4.6 (status-feitenmatrix), §7 (besluitmoment-telling), §443 (uitfasering).
- Aanleiding en kaders: [[0187]] (readiness vervalt), [[0189]] (vervulling via gebonden feit), [[0192]] (P3 — zwaarte/afwijking, de PR-C-vorm die dit spiegelt).
- EPIC [#164](https://github.com/merlinijzerman/Bestuurdersportaal/issues/164), P3 [#168](https://github.com/merlinijzerman/Bestuurdersportaal/issues/168), P4 [#169](https://github.com/merlinijzerman/Bestuurdersportaal/issues/169), P6 [#171](https://github.com/merlinijzerman/Bestuurdersportaal/issues/171).
