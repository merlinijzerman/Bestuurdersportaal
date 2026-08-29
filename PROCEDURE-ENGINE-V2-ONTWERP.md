# Proceduremodule-engine — ontwerp

> **Status**: v0.19 — **vastgesteld**; beslispunten gesloten, werktickets uitgezet
> **Datum**: 2026-08-24 (as-built opnieuw geverifieerd ná productierelease #161)
> **Bron**: as-built code en datamodel per 2026-08-21, geverifieerd tegen `core/lib/procedure-activatie.ts`, `procedure-fase-status.ts`, `procedure-fasen.ts`, `decision.ts`, `decision-view.ts`, `dossier.ts`, `proces-templates.ts`, `app/api/procedures/**`, `app/api/decisions/[id]/status`, `app/(dashboard)/procedures/_components/*`, `supabase/migrations/2026_04_29_procedures.sql`, `2026_05_07_decision_object.sql`, `…_d6*`, `…_d7*`, `…_d8*`, `2026_08_14_readiness_*`, `2026_08_18_bewijs_requirement_binding.sql`, `2026_08_22_bewijs_requirement_binding_hardening.sql` · besluiten [`0002`](decisions/0002-generieke-proceduremodule-definitie-als-data.md), [`0174`](decisions/0174-proceduremodule-engine-v2-D6-D7-D8.md), [`0183`](decisions/0183-expliciete-bewijs-vereiste-binding.md), [`0187`](decisions/0187-readiness-vervalt.md) · `PROCEDURE-GENERIEK-ONTWERP.md` v0.4
> **Doel**: één ontwerp van de proces-engine dat klopt met wat er draait, met de besluiten van 21-08-2026, én met de kerninvarianten die het bestuurlijk betrouwbaar maken.
> **Scope**: engine, datamodel, audit/RLS en de UI-consumptie daarvan. **Niet**: de inhoudelijke procesdefinities en niet de registry-migratie (fase C–D van `PROCEDURE-GENERIEK-ONTWERP.md`) — met één uitzondering: de versiebevriezing is nu een expliciete go-livevoorwaarde (§13).
> **Impactklasse**: **data + tenant/security**.

## Revisielog

**v0.19 (2026-08-26)** — §5.1 bijgetrokken naar het rolbesluit, en één scopevraag beslecht.

1. **§5.1 was stale.** Daar stond nog `procedure.afwijking.vastleggen` (enkelvoud) met houders *voorzitter/beheerder* — een schets van vóór het rolbesluit van 26-08. Definitief: **`procedures.afwijking.vastleggen`**, houders **voorzitter + bestuurder**, beheerder en bestuursbureau uitgesloten.
2. **`besluitmoment_stap` (§7) hoort wél bij P3.** Overwogen om hem als eigen increment uit te stellen. Afgewezen: §7 introduceert die kolom uitdrukkelijk *in de plaats van* readiness. Verdwijnt de procesbrede readinessmeting terwijl de besluitmoment-schaal er nog niet is, dan toont een besluitmoment "0 openstaand" omdat er niets aan hangt — precies het valse groen waar de validatieregel in §7 tegen is bedoeld. De kolom gaat mee in de additieve PR (leeg = huidige gedrag, dus nul gedragswijziging); de telling per besluitmoment landt in dezelfde PR als de ontmanteling. De **importvalidatie** blijft bij de definitielaag (fase C) en is daar een harde voorwaarde vóór er een importer live gaat.

**v0.18 (2026-08-26)** — één regel toegevoegd in §14, na een tweede nummerbotsing.

v0.17 loste de botsing op 0190 op door de reeks te laten opschuiven. Daarop bleek **0191 ook al vergeven** — aan het besluitrecord van de aantekeningen ([#170](https://github.com/merlinijzerman/Bestuurdersportaal/issues/170)), dat eerder is geschreven maar nog niet gemerged. Hernummeren van dat record om het plan te laten kloppen is afgewezen. **Regel**: een nummer wordt geclaimd bij het schrijven van het record, niet bij het plannen van een ticket; de lijst in §14 is een plan en geen reservering, en een geschreven record wordt nooit hernummerd — dat maakt van een chronologisch log een index en laat dode verwijzingen achter in commits en PR's. Gevolg: **P3 → 0192, P4 → 0193**. [#168](https://github.com/merlinijzerman/Bestuurdersportaal/issues/168) verwijst inmiddels naar 0191 en moet nogmaals worden gecorrigeerd, naar 0192.

**v0.17 (2026-08-26)** — twee administratieve correcties, geen inhoudelijke wijziging.

1. **Nummerbotsing in de besluitrecords.** 0190 was in §14 gereserveerd voor P3, maar is vergeven aan de codificatie van de per-PR-gateset. *(In v0.18 verder gecorrigeerd — zie hierboven.)*
2. **Rolbesluit voor P3 vastgelegd.** `procedures.afwijking.vastleggen` gaat naar **voorzitter + bestuurder**; beheerder en bestuursbureau uitgesloten. Genomen 26-08-2026, vastgelegd in `05 Security en compliance/BESLISNOTITIE-capability-P3-afwijking.md` §6, inclusief de drie gevolgen voor P3 die uit die keuze volgen.

**v0.16 (2026-08-26)** — één blokkade opgeheven die niet meer bestond. v0.9 t/m v0.15 stelden dat **P3** wacht op het rolmodelbesluit ([#153](https://github.com/merlinijzerman/Bestuurdersportaal/issues/153)). Bij het voorbereiden van dat besluit bleek het al genomen — op 23-08 vastgelegd in drie besluitregels, en de code staat sinds release [#161](https://github.com/merlinijzerman/Bestuurdersportaal/pull/161) van 24-08 in productie: 112 declaraties, nul `TE_BEPALEN`, plus een continue CI-gate op `authz-matrix.expected.json` ([#157](https://github.com/merlinijzerman/Bestuurdersportaal/issues/157)). Wat onder #153/[#91](https://github.com/merlinijzerman/Bestuurdersportaal/issues/91) resteert is de **productie-vlagflip**, en die blokkeert P3 niet — een nieuwe capability is onder vlag-uit inert en wordt door de gate bewaakt. §13.2 gecorrigeerd. Het besluit dat P3 wél nog vraagt — welke rollen `procedures.afwijking.vastleggen` krijgen — staat in de beslisnotitie in `05 Security en compliance`.

**v0.15 (2026-08-26)** — P2 opgeleverd (PR-A fundament, PR-B omslag; RLS- en codereview beide GO). Het ontwerp loopt op drie punten bij:

1. **Het ontkoppelslot is verzwaard t.o.v. 0189 — nieuwe §6.3.** 0189 legde de guard voor ontkoppelen en herbinden bij de route en alleen DELETE bij de trigger. Uitgevoerd is **alle drie de deuren op databaseniveau**, met de route als leesbare 409 erbovenop. Reden: een DELETE loopt via domeinflows die de route niet passeren, en een DB-guard is aantoonbaar te toetsen tegen een productiegelijke database. Geverifieerd op tien gedragsgevallen.
2. **De escape-hatch is geverifieerd, en levert één openstaande vraag op.** `heropend`/`geescaleerd` vallen buiten de vaststellende verzameling en zijn via de bestaande, bevoegdheidsgeborgde en geauditeerde statusroute bereikbaar. Alleen vanuit `besloten` kost dat twee stappen, via `afgesloten` of `in_uitvoering`. Belegd bij **P4** (§6.3, §13.2) — niet als reden om het slot te versoepelen.
3. **P6 is geblokkeerd door [#192](https://github.com/merlinijzerman/Bestuurdersportaal/issues/192).** P2 bindt acht requirement-typen, maar er is nog geen kiezer-UI om een bestaand artefact (risico, aanname, besluit, …) aan een vereiste te koppelen. Zonder die affordance staan die typen open zonder pad om ze te vervullen — dezelfde regressie die bij het ontwerp van het bindpad is afgewezen. Mockup eerst, dan bouwen.

Verder gecodificeerd, buiten dit ontwerp: de lokale per-PR-gateset (`npm run gates`) inclusief de §15 cross-tenant-suite, nadat bleek dat die check bij de P1b-merge stil uit de routine was weggevallen. Besluitrecord 0190.

**v0.14 (2026-08-24)** — één regel in de scopetabel van §6.2 gecorrigeerd naar de gemeten werkelijkheid. `procedure_bewijs` draagt géén `procedure_id`; `stap_id` is daar de lokale sleutel. Dat is gelijkwaardig aan dossier-scoped omdat `fn_validate_bewijs_requirement_binding` de stap in de sleutel gelijkschakelt aan `stap.volgorde` — nu expliciet onderbouwd in plaats van aangenomen.

**v0.13 (2026-08-24)** — één te stellige formulering gecorrigeerd, gevonden bij de bouw van **P2**.

v0.12 schreef "de scope van de telling is de **procedure**". Dat gaat uit van procedure ↔ decision object 1:1, en dat geldt niet: de vijf `decision_*`-brontabellen dragen geen `procedure_id`, en één procedure kan meer dan één besluitobject dragen. De regel wordt **tabelnatuurlijk**: besluitgebonden feiten tellen op `decision_id`, procesgebonden feiten op `procedure_id`. De onderliggende invariant is ongewijzigd — **dossier-scoped, nooit stap-scoped**. Zie §6.2, inclusief het gevolg dat vervulling daarmee asymmetrisch is en de herkomst van een vervulling in de UI zichtbaar moet zijn.

**v0.12 (2026-08-24)** — één tegenstrijdigheid opgelost, gevonden tijdens de bouw van **P2** ([#167](https://github.com/merlinijzerman/Bestuurdersportaal/issues/167)). Geen richtingwijziging.

§6.2 stelde tegelijk dat er **meerdere** koppelingen per vereiste mogen bestaan (`min_aantal`) én dat "de unieke index per brontabel" dat afdwingt. Een unieke index op `(scope, requirement_sleutel)` verbiedt precies wat `min_aantal > 1` moet toestaan. De fout is ontstaan bij de herziening van BP-7 (v0.9/v0.10): in de centrale-tabelvariant stonden er **twee** indexen, en bij de overgang naar het bronkolom-patroon is die tweedeling in één zin samengevouwen. Gecorrigeerd:

1. **De index per brontabel is niet-uniek**, en dient alleen het opzoeken. "Eén artefact vervult hoogstens één vereiste" wordt afgedwongen door de **vorm van het schema** — één bronrij is één artefact en draagt één `requirement_sleutel`-kolom — en heeft geen index nodig. Zie §6.2.
2. **I6 herschreven.** De helft "een vereiste heeft hoogstens één vervulling" was al vervallen in v0.9 maar bleef in de invariantentabel staan.
3. **`procedure_bewijs` wijkt vandaag af.** De bestaande unieke partiële index `(stap_id, requirement_sleutel)` uit #160 dwingt wél één-bewijs-per-vereiste af. Daarmee kan `min_aantal > 1` voor documenttypen vandaag niet werken. Dat wordt in P2 rechtgetrokken in plaats van geërfd (§6.2, §13.1).

**v0.11 (2026-08-24)** — één aanname gecorrigeerd, met gevolgen voor de zwaarte van P2.

**Er zijn nog geen fondsen aangesloten in productie.** v0.6 t/m v0.10 noemden de zichtbare terugval bij P2 "de grootste risicopost in het hele migratiepad" en eisten een terugvalrapport per fonds vóór oplevering. Dat is geschreven voor een situatie met lopende dossiers bij aangesloten fondsen, en die bestaat niet. Een rapport "per fonds" zou over seed- en previewdata gaan: dat meet de seed, niet de werkelijkheid.

Wat daaruit volgt is groter dan het vervallen van dat rapport:

1. **De backfill is grotendeels een non-vraag.** De R1/R2-afweging, gefaseerd terugvallen en het communicatieplan gaan over bestaande productiedata. Met alleen seed- en previewdata mag je opnieuw zaaien. De migratie blijft correct, maar hoeft geen zorgvuldige operatie te zijn.
2. **Dit is het venster om de strengste variant te bouwen — gratis.** I7 met INSERT-blokkade en append-only publicatieregister, positief-en-gebonden voor alle elf typen ineens, de status-feitenmatrix voor alle achttien statussen, `niet_begonnen` met de actief-trigger: elk daarvan kost nu niets. Bij het eerste aangesloten fonds wordt elk daarvan een migratie mét terugvalgesprek en fasering. Waar in dit document "gefaseerd" of "voorzichtig" staat omdat bestaande data pijn zou doen — dat vervalt.
3. **Het risico verdwijnt niet, het verschuift.** Het komt terug bij de onboarding van fonds 1, als *onboardingvraag* en niet als migratievraag: hoeveel handmatig koppelwerk kost het om een lopend traject of bestaande stukken in te brengen. Belegd als OB-E14 in `00 Overzicht en status/openstaande-punten-en-risicos.md`.

**v0.10 (2026-08-24)** — drie feitelijke correcties op §13.1, gevonden bij het schrijven van de werkopdracht voor **P1b** ([#166](https://github.com/merlinijzerman/Bestuurdersportaal/issues/166)). Geen richtingwijziging; v0.9 verwees naar objecten die niet bestaan.

1. **Er is geen registry.** §13.1 hing de publicatiestatus aan `procedure_template_versies`. Die tabel bestaat niet op `origin/main`; alleen `procedure_template_fasen` (D8). De registry is fase C van `PROCEDURE-GENERIEK-ONTWERP.md` en valt buiten deze EPIC. I7 krijgt daarom een eigen, minimaal **publicatieregister** — nadrukkelijk niet de registry.
2. **`procedure_requirement_instance` krijgt géén `template_versie`.** Die tabel is gesleuteld op `decision_id`: instantie-vereisten horen bij een dossier, niet bij een templateversie. v0.8/v0.9 schreven "idem"; dat was fout.
3. **De backfill mag geen blanket default krijgen.** `add column … not null default '1.0.0'` tagt de invaarvereisten als `1.0.0` terwijl lopende dossiers op `2.0.0` pinnen — dan vinden die dossiers **nul** vereisten en tonen ze een lege, groene bewijslast. Erger dan het probleem dat we oplossen, en het valt niet op.

Meevaller, genoteerd voor P5: **`decision_objects.gewenste_besluitdatum` bestaat al** (`2026_05_07_decision_object.sql:80`). Signaal 5 in §12 vraagt dus geen nieuwe kolom.

**v0.9 (2026-08-24)** — geen nieuwe architectuur; **vier feitelijke correcties** en één herzien beslispunt, na hermeting tegen `origin/main` ná productierelease [#161](https://github.com/merlinijzerman/Bestuurdersportaal/pull/161).

1. **De as-built-tabel in v0.8 was op vier regels onjuist** (§2). Oorzaak: v0.8 mat een lokale `main` die achterliep, terwijl het werk op PR [#115](https://github.com/merlinijzerman/Bestuurdersportaal/pull/115) stond (later gesuperseded door #160). Besluit `0183` bestaat wél, `procedure_bewijs.requirement_sleutel` bestaat wél, en `idx_req_uniek` op `procedure_requirements` bestond al op main — dat laatste was een leesfout van mij, geen gat in het schema.
2. **BP-7 herzien** (§6.2). Niet één centrale vervullingstabel, maar **het bestaande patroon doortrekken**: de sleutel als kolom op de brontabel, zoals `0183` die heeft neergezet en #115/#160 hebben gehard. Reden: het dure deel — de server-side resolver, twee validatietriggers en de audittrigger — is generiek en staat er al. Voor de typen zonder brontabel komt één nieuwe **brontabel** `procedure_vaststelling`, die zich als elke andere bron gedraagt. Eén mechanisme, niet twee.
3. **`min_aantal` gecorrigeerd** (§6.2). v0.8 schreef "per vereiste hoogstens één vervulling". Fout: een vereiste kan om meerdere stukken vragen. Hard blijft alleen: **één artefact vervult hoogstens één vereiste**.
4. **Volgorde-afhankelijkheid** (§13.2): ticket **P1b** moet vóór **P2**. Zonder `template_versie` in de identiteitsindex is de vereiste-sleutel niet versievast.

Verder: besluitrecords starten bij **0188** (0183 t/m 0187 zijn vergeven), en readiness is *besloten* ([`0187`](decisions/0187-readiness-vervalt.md)) maar **niet uitgevoerd** — `ReadinessLadder.tsx`, vier migraties en `fn_decision_readiness_check` staan er nog.

**v0.8 (2026-08-21)** — drie inhoudelijke aanvullingen en acht gerichte correcties na de review op v0.7. De architectuur is ongewijzigd; wat ontbrak was volledigheid op drie plekken waar v0.7 een regel stelde maar hem niet overal doortrok.

1. **Eén generiek vervullingsmechanisme voor álle requirement-typen** (§6, **BP-7**). v0.7 zei "positief en gebonden" maar loste alleen `document`, `approval` en `dissent_review` op. De review wees op de rest — geverifieerd in de code: `ai_validation` neemt de eerste passende gevalideerde AI-output (`core/lib/decision.ts:712`), `assumption` telt álle gevalideerde aannames tegen `min_aantal` (`:736`), en `risk` / `kpi` / `evaluation` / `mandate_check` vervullen op "bestaat er minstens één" (`:755` e.v.). De aangekondigde sanity-test kon dus niet slagen. Vervangen door één generiek mechanisme. **In v0.9 herzien**: niet een centrale tabel maar het bestaande sleutelpatroon doortrekken — zie §6.2.
2. **Versiebevriezing wordt onveranderlijkheid** (§13.1, I7). Filteren op `template_versie` verhindert niet dat iemand een vereiste binnen dezelfde versie wijzigt. Geverifieerd, en de uitgangspositie is slechter dan aangenomen: `procedure_requirements` heeft vandaag **geen enkele unique constraint** en **geen versiekolom** — alleen `template_code` (`supabase/migrations/2026_05_07_decision_object.sql:304`). Toegevoegd: invariant I7, een publicatiestatus met weigerende trigger, en een unieke sleutel inclusief `template_versie`.
3. **I1 krijgt een volledige status-feitenmatrix** (§4.6). v0.7 noemde drie statussen; ook `afgewezen`, `in_uitvoering`, `in_evaluatie`, `geagendeerd` en `beeindigd` stellen feiten. Eén tabel `besluitstatus_vereist_feit`, als data, zodat geen route dit meer zelf interpreteert.

Gerichte correcties: fasestatus `afgerond` alleen bij louter afgeronde stappen (§5.2); het auditlog is canoniek voor de afwijkingshistorie, de stapkolommen beschrijven alleen de laatste afronding (§5.1); I5 dekt nu ook dat gerefereerde objecten bij hetzelfde fonds horen (§4.5); filter "Blokkade" → **"Kritieke vereisten"** (§10); signaal 5 komt uit `gewenste_besluitdatum` of de agendakoppeling, niet uit `procedure_stappen.deadline` (§12); "geen houder" toetst `eigenaar_id` **én** `eigenaar_naam` (§12); de werkbak toont **alle** achterstallige items en vult aan tot zeven (§9.2); en `geannuleerd` blijft een verborgen legacy-opslagwaarde in plaats van te verdwijnen (§5.2, BP-3). Nieuw daarnaast: **aantekeningen per processtap** (§9.3), naar aanleiding van de vraag of het stapdetail ruimte moet laten voor notities.

**v0.7 (2026-08-21)** — besluit↔vereiste-binding, "tot en met deze stap" vervalt, invarianten I1–I6, `zwaarte`, beëindigen/heropenen doorvertaald, versiebevriezing als go-livevoorwaarde.
**v0.6 (2026-08-21)** — D9 (validatie, afwijking, beëindiging), D10 (positief gebonden bewijs), readiness vervalt ([`0184`](decisions/0184-readiness-vervalt.md)), classificatie sturend/duidend, acties en werkbak, `actief` pas bij de eerste handeling.
**v0.5 (2026-08-18)** — bewijs↔vereiste-binding via `requirement_sleutel`.
**v0.4 (2026-08-14)** — per-proces uitsluiting van template-vereisten.
**v0.3 (2026-08-13)** — fasebeschrijving met eigen weergave en bewerkpad.
**v0.2 (2026-08-13)** — geïmplementeerd in WO-1 ([`0174`](decisions/0174-proceduremodule-engine-v2-D6-D7-D8.md)).
**v0.1 (2026-08-13)** — D6/D7/D8.

---

## 1. Doelpositionering

De engine draait en is generiek. Wat dit ontwerp toevoegt is **consistentie**, langs één lijn:

> Het systeem meet en registreert; de mens oordeelt. **Maar het systeem bewaakt wel de feiten.** Waar iets een bestuurlijk oordeel is, wordt het een signaal met een gemotiveerde afwijking. Waar iets een feitelijke integriteitsregel is, weigert het systeem.

De review op v0.6 legde bloot dat die tweede helft ontbrak. De review op v0.7 legde bloot dat hij op drie plekken wel was opgeschreven maar niet doorgetrokken: naar alle requirement-typen (§6), naar alle besluitstatussen (§4.6), en naar de onveranderlijkheid van een gepubliceerde versie (§13.1). Een invariant die voor de helft van de gevallen geldt, is geen invariant.

---

## 2. Wat er staat — as-built per 24-08-2026

Geverifieerd tegen `origin/main` ná productierelease #161.

| Onderdeel | Stand | Vindplaats |
|---|---|---|
| Snapshot bij start | ✅ | `app/api/procedures/route.ts` |
| Parallelle, afhankelijkheidsgestuurde activatie (D6) | ✅ | `core/lib/procedure-activatie.ts` |
| Heropenen met `herbevestiging_nodig` | ✅ | `…/stappen/[stapId]/heropenen` |
| Instantie-vereisten toevoegen / uitsluiten (D7) | ✅ | `procedure_requirement_instance`, `_uitsluiting` |
| Fasen als data met fonds-override (D8) | ✅ — alleen geseed voor `pf_wtp_invaarbesluit` | `procedure_template_fasen` |
| **Bewijs↔vereiste-binding** voor `document`, `external_submission`, `consultation` | ✅ **in productie** — sleutel server-side afgeleid, unieke partiële index `(stap_id, requirement_sleutel)` | `procedure_bewijs.requirement_sleutel`, `core/lib/requirement-sleutel.ts`, `bewijs-binding.ts` |
| Validatie- en audittriggers op die binding | ✅ | `fn_validate_bewijs_requirement_binding`, `fn_validate_requirement_instance_binding_sleutel`, `fn_audit_procedure_bewijs_mutation` |
| Identiteitsindex op vereisten | ✅ — `idx_req_uniek` op `(template_code, stap_volgorde, requirement_type, coalesce(documenttype, label))` | `2026_05_07_decision_object.sql` |
| Binding voor de **overige acht** typen | ❌ — `approval` (`bron = null`), `dissent_review` (afwezigheid), `risk`, `kpi`, `evaluation`, `mandate_check`, `assumption`, `ai_validation` | §6 |
| `template_versie` in de identiteitsindex | ❌ — de index is versieloos | §13.1, I7 |
| Onveranderlijkheid van een gepubliceerde versie | ❌ — geen publicatiestatus, geen weigerende trigger | §13.1, I7 |
| `zwaarte`, `besluitmoment_stap` op vereisten | ❌ | §5.1, §7 |
| Readiness | ⛔ **besloten dat het vervalt** ([`0187`](decisions/0187-readiness-vervalt.md)) — **implementatie staat er nog volledig**: `ReadinessLadder.tsx`, vier migraties, `fn_decision_readiness_check` (door #115 juist herschreven) | §7 |
| Legacy sequentieel pad (`status = 'open'`) | ⚠️ bestaat nog | §3 |

---

## 3. Kernprincipe — parallel by default

Een procedure is standaard parallel: elke stap is activeerbaar zodra haar blokkerende afhankelijkheden zijn afgerond. **`volgorde` is presentatie- en verantwoordingsvolgorde, geen activatievolgorde en geen bewijslastvolgorde.**

**`geblokkeerd` komt vandaag niet voor.** Geen definitie declareert een afhankelijkheid: bij `pf_wtp_invaarbesluit@2.0.0` staat bij alle twaalf stappen een lege lijst; de vier code-templates kennen het veld niet en draaien op het legacy-pad. Na de start wordt de kolom alleen gelezen.

Beslissen bij **fase B1** (incident-meldplicht, geschiktheidstoetsing) of afhankelijkheden echt worden gebruikt. Zo nee, dan kunnen `geblokkeerd` en het legacy-pad in één opruimactie weg. **Let op:** `open` verwijderen zonder voor de vier code-templates een keten te declareren maakt ze in één klap volledig parallel — een gedragsverandering, geen opschoning.

---

## 4. Het statusmodel

### 4.1 Dragers en terminologie

De terminologie volgt de code, niet andersom.

| Drager | Waarden | Wie bepaalt |
|---|---|---|
| **Stapstatus** (`procedure_stappen.status`) | `geblokkeerd` · `niet_begonnen` · `actief` · `afgerond` · `heropend` · `vervallen` | engine |
| **Besluitstatus** (`decision_objects.status`, `DecisionStatus`) | 17 + `beeindigd` = 18, waarvan `geannuleerd` verborgen legacy | mens, binnen de overgangsmatrix |
| **Dossierstatus** (`procedures.status`, `DossierStatus`) | 8 + `beeindigd` = 9 | afgeleid uit de besluitstatus |
| **Fasestatus** | `nog_niet_begonnen` · `in_behandeling` · `afgerond` · `vervallen` | afgeleid uit de stappen |
| **Actiestatus** (`decision_actions.status`) | `open` · `in_behandeling` · `afgerond` · `vervallen` · `escalatie` | actiehouder |
| *Openstaande vereisten* (geen status) | aantal open, per zwaarte | afgeleid uit de evidence-laag |

De term **processtatus** vervalt; die bestond alleen in dit document en week af van de code.

> **Correctie in v0.8.** De review adviseerde `geannuleerd` te mappen naar dossierstatus `beeindigd`. Die waarde bestaat vandaag niet: `DossierStatus` kent acht waarden en `beeindigd` zit er niet bij (`core/lib/dossier.ts:18`). De mapping vraagt dus eerst dat `beeindigd` als **negende dossierstatus** wordt toegevoegd. Het alternatief — mappen naar `gearchiveerd` — is fout: archiveren is opruimen van een afgerond dossier, beëindigen is stoppen vóór het einde, en juist dat verschil wil een toezichthouder zien. Opgenomen in ticket **P4**.

### 4.2 `actief` betekent "hier wordt aan gewerkt"

Bij de start wordt een activeerbare stap `niet_begonnen`; hij wordt `actief` bij de eerste inhoudelijke handeling — een afgevinkt checklistpunt, een gekoppeld bewijsstuk, een vastgelegd besluit, of expliciet "stap starten". Níet: toelichting wijzigen, een vereiste toevoegen of uitsluiten, agenderen.

```sql
alter table public.procedure_stappen
  add column if not exists actief_sinds  timestamptz,
  add column if not exists gestart_door  uuid references auth.users(id);
```

Zonder die twee bewaar je alleen de toestand, niet het moment — terwijl het document juist claimt dat het startmoment wordt vastgelegd.

**De trigger doet exact één overgang: `niet_begonnen → actief`.** Nooit een geblokkeerde, afgeronde of vervallen stap reactiveren. Een AFTER-trigger op `procedure_checklist`, `procedure_bewijs` en `procedure_besluiten`, met die statusvoorwaarde in de `where`.

**Migratie van lopende processen:** per stap bepalen of er al een handeling op zit; zo ja `actief` met `actief_sinds` uit de vroegste gebeurtenis in `procedure_log`, zo nee `niet_begonnen`. Deterministisch, in dezelfde migratie.

### 4.3 Twee dingen die géén status worden

**Afgerond met afwijking** is een vlag op een afgeronde stap (§5.1). **Datum verstreken** is een signaal (§10).

### 4.4 Relatie tussen de twee sporen

Uitvoering (stappen) en bestuurlijke duiding (besluitstatus) blijven gescheiden: een bestuur mag besluiten voordat de nazorg af is. De koppeling is **signalering**, geen automatiek: alle stappen afgerond → voorstel om de besluitstatus te verhogen; besluitstatus verhogen terwijl er stappen open staan → waarschuwing.

### 4.5 Zacht of hard — de grens

| | Wat het is | Regime |
|---|---|---|
| **Bestuurlijk oordeel** | is de onderbouwing voldoende, is dit bewijs genoeg, kan deze stap dicht | **zacht** — waarschuwen, en gemotiveerd afwijken mag |
| **Feitelijke integriteit** | bestaat het feit waarop de status zich beroept, is de handelende persoon bevoegd, valt de overgang binnen de matrix, blijft de tenantgrens intact, is de definitie waarop het dossier draait onveranderd | **hard** — het systeem weigert |

Zeven invarianten die het systeem **altijd** afdwingt, ook met motivering en ook door een voorzitter:

| | Invariant | Waar afgedwongen |
|---|---|---|
| **I1** | Een besluitstatus die een feit stelt, vereist dat feit — volgens de matrix in §4.6, niet volgens de interpretatie van de route. | statusroute + `besluitstatus_vereist_feit` |
| **I2** | Een afwijking zonder motivering bestaat niet — minimumlengte afgedwongen, niet leeg-met-spaties. | CHECK + route |
| **I3** | Afwijkend afronden en beëindigen vragen een expliciete bevoegdheid (§5.1, §5.2). | capability-check |
| **I4** | Een overgang buiten de toegestane-overgangenmatrix bestaat niet. | statusroute |
| **I5** | `fonds_id` wordt server-side afgeleid, nooit uit de request — **en elk gerefereerd object hoort bij hetzelfde fonds.** | RLS + referentiecontrole, zie hieronder |
| **I6** | Eén artefact vervult hoogstens één vereiste. Een vereiste mag méér vervullingen hebben; vervuld = `count(gebonden feiten) ≥ min_aantal`. | vorm van het schema: één sleutelkolom per bronrij (§6.2) |
| **I7** | Een gepubliceerde templateversie is onveranderlijk; elke inhoudelijke wijziging maakt een nieuwe versie. | publicatiestatus + weigerende trigger (§13.1) |

> **I5 uitgebreid (v0.8).** De review heeft gelijk dat server-side afleiden van `fonds_id` niet voorkomt dat een actie wordt gekoppeld aan een profiel uit een ánder fonds: RLS beschermt de *rij*, niet de *verwijzing*. Twee lagen: (a) elke insert/update die een vreemde sleutel zet, toetst dat het doelobject hetzelfde `fonds_id` heeft — als constraint waar het kan (composite FK op `(id, fonds_id)`), anders in de route; (b) een periodieke integriteitscontrole die kruisverwijzingen tussen fondsen opspoort, in dezelfde vorm als `CONTROLE-t14b-productiedrift.sql`. Zonder (b) merk je een lek pas als iemand ernaar kijkt.

### 4.6 De status-feitenmatrix *(nieuw in v0.8)*

I1 is pas afdwingbaar als vastligt wélk feit welke status vereist. Als **data**, niet als `if`-reeks per route:

```sql
create table public.besluitstatus_vereist_feit (
  doelstatus     text primary key,
  vereist_feit   text not null,            -- sleutel die de controlefunctie kent
  toelichting    text not null
);
```

| Doelstatus | Vereist feit |
|---|---|
| `concept` · `in_onderbouwing` · `in_validatie` · `in_review` | geen — werktoestanden, geen beweringen |
| `geagendeerd` | een gekoppeld agendapunt op een geplande vergadering |
| `in_bespreking` | een gekoppeld agendapunt op een vergadering van vandaag of eerder |
| `besloten` | ≥ 1 besluit gebonden aan een approval-vereiste (§6) |
| `voorwaardelijk_besloten` | idem **plus** ≥ 1 vastgelegde voorwaarde |
| `afgewezen` | een vastgelegd besluit met uitkomst *afwijzend* |
| `aangehouden` | een vastgelegde reden van aanhouding |
| `geescaleerd` | een escalatie-event met geadresseerde |
| `teruggezet` | motivering **en** de doelstatus waarnaar wordt teruggezet |
| `in_uitvoering` | een voorafgaand `besloten` of `voorwaardelijk_besloten` in de historie |
| `in_evaluatie` | idem **plus** een geplande evaluatie |
| `afgesloten` | elk besluitmoment heeft zijn gebonden besluit (§7) |
| `heropend` | motivering **en** de terminale status waaruit wordt heropend |
| `beeindigd` | het beëindigingsevent met reden en actor (§5.2) |
| `geannuleerd` | **niet kiesbaar** — verborgen legacy-opslagwaarde (§5.2) |

Eén functie `toetsStatusFeit(decision_id, doelstatus)` leest deze tabel en weigert of laat door. Dat scheelt niet alleen dubbele logica: het maakt de regel **zichtbaar en toetsbaar** voor een auditor, en een nieuwe status kan niet meer stilzwijgend zonder feitentoets worden toegevoegd.

**Bewust zacht gelaten:** de matrix eist het *bestaan* van het feit, niet de *kwaliteit* ervan. Of een besluit goed onderbouwd is, blijft een bestuurlijk oordeel (§4.5). Dat onderscheid is de hele grens.

---

## 5. D9 — Validatie, afwijking en beëindiging

### 5.1 Een stap kan altijd worden afgerond — met de juiste zwaarte en bevoegdheid

**`verplicht` en `blokkerend` worden één veld.** Twee booleans leveren vier combinaties waarvan er één onzin is (`verplicht = false, blokkerend = true`).

```sql
alter table public.procedure_requirements
  add column if not exists zwaarte text
      check (zwaarte in ('optioneel','vereist','kritiek'));
-- idem procedure_requirement_instance
-- migratie:  verplicht = false                    → 'optioneel'
--            verplicht = true  en blokkerend = f  → 'vereist'
--            verplicht = true  en blokkerend = t  → 'kritiek'
-- de booleans blijven tijdelijk als afgeleide leeskolommen; droppen in een latere opruiming
```

| Zwaarte | Normaal afronden | Afronden met afwijking | Bestuurlijk signaal |
|---|---|---|---|
| **optioneel** | ja | n.v.t. | geen |
| **vereist** | nee | ja, met motivering | aandacht |
| **kritiek** | nee | ja, met motivering **en** expliciete bevestiging | prominent, ook op het overzicht |

> **BP-1, bevestigd door de review.** De bevoegdheid hangt aan de **handeling**, niet aan de zwaarte: één capability. Anders ontstaat een matrix van rol × zwaarte die per fonds anders geconfigureerd wil worden. Wat *kritiek* extra vraagt is een **bevestigingsstap** plus prominente vastlegging.
>
> **Naam en rollen, definitief *(v0.19)*.** De capability heet **`procedures.afwijking.vastleggen`** — meervoud, conform de conventie van `procedures.view` / `procedures.manage`. Houders: **voorzitter + bestuurder**; **beheerder en bestuursbureau uitgesloten**. Besloten 26-08-2026, onderbouwing en de drie gevolgen in `05 Security en compliance/BESLISNOTITIE-capability-P3-afwijking.md` §6. *(v0.7 t/m v0.18 noemden hier `procedure.afwijking.vastleggen` (enkelvoud) en "voorzitter/beheerder"; beide waren een schets van vóór het rolbesluit en zijn hiermee vervallen.)*

**De afrondroute** berekent eerst wat ontbreekt, per zwaarte. Is er niets open boven `optioneel`, dan is het een gewone afronding. Anders: bevoegdheid vereist, motivering verplicht, en:

```sql
alter table public.procedure_stappen
  add column if not exists afgerond_met_afwijking boolean not null default false,
  add column if not exists afwijking_motivering   text,
  add column if not exists afwijking_snapshot     jsonb,   -- wát er ontbrak, per zwaarte
  add column if not exists afwijking_door         uuid references auth.users(id);
```

> **Correctie in v0.8 — waar de historie leeft.** De review vroeg terecht wat er bij heropenen en opnieuw afronden met `afwijking_snapshot` gebeurt. Antwoord: **de stapkolommen beschrijven uitsluitend de laatste afronding en worden overschreven; `procedure_log` is canoniek voor de historie.** Elke afronding schrijft een append-only regel met de volledige snapshot, actor en tijdstip. Zo blijft "wat stond er open toen we dit de eerste keer sloten" beantwoordbaar, zonder de stap zelf te belasten met een groeiende lijst. Consequentie die expliciet moet worden gebouwd: het log is daarmee **de** bron voor het afschrift — een afschrift dat op de kolommen leunt, verliest historie zonder het te merken.

**Atomair.** Statuswijziging, afwijkingssnapshot, `procedure_log`-regel, governance-event en `herberekenActiveerbaarheid()` vormen **één transactie**.

**Overrulen is niet vervullen.** De stap gaat dicht; de ontbrekende vereiste blijft open in de tellingen en in het dossier. Dat onderscheidt overrulen van **uitsluiten** (`procedure_requirement_uitsluiting`, "deze eis geldt hier niet", verdwijnt uit de telling). Bouw je alleen het eerste, dan wordt overrulen gebruikt voor het tweede en verdwijnt het onderscheid uit het auditspoor.

**Randvoorwaarde.** De huidige bewijs-gate telt `count > 0` over de hele stap. Om *wat ontbreekt* correct te snapshotten moet die over op de vervullingstabel (§6.2). Zit op het kritieke pad.

### 5.2 Beëindigen en heropenen

Nieuwe eindtoestand `beeindigd`, bereikbaar vanuit elke niet-terminale status, door een bevoegde rol, met verplichte reden.

```sql
alter table public.procedures
  add column if not exists beeindigd_op    timestamptz,
  add column if not exists beeindigd_door  uuid references auth.users(id),
  add column if not exists beeindigd_reden text;
-- CHECK-uitbreidingen: procedures.status + 'beeindigd'   (9e dossierstatus, §4.1)
--                      decision_objects.status + 'beeindigd'
--                      procedure_stappen.status + 'niet_begonnen' + 'vervallen'
```

| Vraag | Antwoord |
|---|---|
| Fase met uitsluitend vervallen stappen | fasestatus **`vervallen`**. |
| Fase met afgeronde **én** vervallen stappen | **Correctie in v0.8:** niet `afgerond`. `afgerond` geldt alleen als *alle* stappen afgerond zijn; zodra alle stappen terminaal zijn en er minstens één vervallen is, is de fase **`vervallen`**. De review heeft gelijk: een fase "afgerond" noemen waarin werk is komen te vervallen, is precies het vals groen dat §6 elders uitbant. Zolang niet alle stappen terminaal zijn blijft de fase `in_behandeling`. |
| Heten vereisten na beëindiging nog "openstaand"? | Nee — **"open bij beëindiging"**, weg uit elke actuele telling (werkbak, proceskaart, signalen), volledig zichtbaar in het afschrift. |
| Wat wordt actief bij heropening? | Vervallen stappen gaan terug naar `niet_begonnen` of `geblokkeerd` (herberekening); afgeronde stappen blijven afgerond. `actief_sinds` wordt **niet** gewist. |
| Wat gebeurt met eerdere afwijkingen? | Ze blijven in `procedure_log` (§5.1); de stapkolommen beschrijven de laatste afronding. |
| Blijft `geannuleerd` bestaan? | **Correctie in v0.8: ja, technisch.** v0.7 liet hem vervallen; de review wijst er terecht op dat dat pas kan ná migratie van bestaande rijen. Daarom: `geannuleerd` blijft in het TypeScript- en databasecontract als **verborgen legacy-opslagwaarde**, verdwijnt uit elke nieuwe overgang en uit elke keuzelijst, en wordt in de UI getoond als *Beëindigd*. Verwijderen uit het contract is een aparte opruimactie ná de datamigratie — niet nu. |

`procedures.status = 'gearchiveerd'` blijft wat het is (opruimen van oude dossiers) en wordt hier niet op gestapeld.

---

## 6. D10 — Vervulling vereist positief, gebonden bewijs *(herzien in v0.8)*

De regel:

> Een vereiste is uitsluitend vervuld door een **vastgelegd feit dat aan díe vereiste gebonden is**. Nooit door afwezigheid, nooit door een status elders, nooit door iets op een andere stap.

### 6.1 Wat er al gebonden is, en wat niet

Besluit [`0183`](decisions/0183-expliciete-bewijs-vereiste-binding.md) heeft de regel neergezet en PR #115/#160 hebben hem gehard en naar productie gebracht — **voor drie van de elf typen**. De overige acht matchen nog generiek (geverifieerd in `core/lib/decision.ts` op `origin/main`):

| Type | Stand | Huidige regel |
|---|---|---|
| `document` · `external_submission` · `consultation` | ✅ gebonden | gelijkheid op `requirement_sleutel`, server-side afgeleid, **uniek** per `(stap_id, sleutel)` — die uniciteit gaat er in P2 af, zie §6.2 |
| `approval` | ❌ | besluitstatus ∈ {besloten, voorwaardelijk_besloten, in_uitvoering, in_evaluatie, afgesloten} — en `bron = null`: er wordt **geen enkele bron** vastgelegd. Bij het invaarproces vinkt één statuswissel vijf vereisten af |
| `dissent_review` | ❌ | `count === 0` — vervulling **door afwezigheid** |
| `risk` · `evaluation` | ❌ | `ctx.risks.length > 0` · `ctx.evaluations.length > 0` |
| `kpi` | ❌ | ≥ 1 voorwaarde met een KPI |
| `mandate_check` | ❌ | bestaat er ergens een `mandate_check_passed`-event |
| `assumption` | ❌ | telling ≥ `min_aantal`, zonder binding |
| `ai_validation` | ❌ | eerste passende gevalideerde output |

> **Let op (besluit 0195):** `evaluation` en `ai_validation` tellen wél zodra er een gebonden feit is, maar er is vandaag **geen runtime-aanmaakpad** dat zo'n feit maakt (`decision_evaluations` kent geen route/lifecycle/RPC/seed; `decision_ai_interactions` heeft alleen een validatie-PATCH, geen aanmaak). Hun vervulling is dus nu **onbereikbaar**. De kiezer-UI (#192) toont hun affordance daarom uitgeschakeld mét reden, en de definitielaag/importer (fase C) moet hierop waarschuwen. De onvervulbare `evaluation`-vereiste in `beleidswijziging_beleggingsbeleid` stap 6 is een pre-P6-blokkade (#228).

### 6.2 BP-7 — het bestaande patroon doortrekken

v0.8 stelde één centrale tabel `procedure_requirement_vervulling` voor, met als argument tegen de alternatieve route: *"zeven migraties"*. **Dat argument is grotendeels vervallen.** Het dure deel van 0183 is niet de kolom maar de machinerie eromheen, en die is generiek:

- de **resolver** die sleutels server-side afleidt en onbekende, dubbele en cross-table-ambigue claims fail-closed weigert;
- `fn_validate_bewijs_requirement_binding` en `fn_validate_requirement_instance_binding_sleutel`;
- `fn_audit_procedure_bewijs_mutation` voor het atomaire auditspoor;
- de gedeelde TS-definitie in `core/lib/requirement-sleutel.ts`, die TS en plpgsql laat spiegelen.

**Besluit: doortrekken, niet vervangen.** Per resterend type krijgt de brontabel dezelfde `requirement_sleutel`-kolom, dezelfde (niet-unieke) opzoekindex en dezelfde validatietrigger, aangehaakt op de bestaande resolver.

**Voor de typen zonder brontabel komt er één nieuwe brontabel**, geen uitzonderingsmechanisme:

```sql
create table public.procedure_vaststelling (
  id                  uuid primary key default uuid_generate_v4(),
  fonds_id            uuid not null references public.fondsen(id),
  procedure_id        uuid not null references public.procedures(id) on delete cascade,
  stap_id             uuid references public.procedure_stappen(id) on delete set null,
  requirement_sleutel text not null,          -- zelfde formaat, zelfde resolver
  soort               text not null check (soort in ('dissentronde','mandaatcheck','kpi','evaluatie')),
  uitkomst            text not null,          -- bv. 'geen dissent' | 'dissent vastgelegd'
  toelichting         text not null,
  actor               uuid not null references auth.users(id),
  vastgelegd_op       timestamptz not null default now()
);
```

`dissent_review` wordt daarmee een **knop** — *"dissentronde afgerond"*, met datum, persoon en uitkomst — in plaats van een afwezigheidstoets. Vervulling door afwezigheid verdwijnt daarmee overal.

**`approval`** krijgt `requirement_sleutel` op `procedure_besluiten`. Dat `procedure_besluiten.stap_id` nullable is, hoeft niet te veranderen: de binding zit in de sleutel, niet in de stap.

**De `min_aantal`-correctie.** v0.8 schreef "per vereiste hoogstens één vervulling". Dat is fout — `min_aantal` bestaat en wordt gebruikt. Juist is:

| | Regel | Waar afgedwongen |
|---|---|---|
| Meerdere koppelingen per vereiste | **toegestaan**; vervuld zodra het aantal `min_aantal` haalt (standaard 1) | telling in de resolver, géén index |
| Eén artefact aan twee vereisten | **verboden** | de **vorm** van het schema: één bronrij draagt één `requirement_sleutel` |
| Hetzelfde artefact twee keer meetellen | **onmogelijk** | idem — een rij telt één keer |

Dus niet één-op-één tussen vereiste en stuk, maar één-op-één tussen **stuk en vereiste**.

**Waarom hier geen unieke index hoort** *(v0.12)*. In de centrale-tabelvariant van v0.8 waren er twee indexen nodig: één op `(procedure_id, requirement_sleutel)` en één op `(procedure_id, brontype, bron_id)`. In het bronkolom-patroon vervalt de tweede — een bronrij *is* het artefact en heeft één sleutelkolom, dus de tweede regel is structureel gegarandeerd. En de eerste **mag niet**: die zou precies `min_aantal > 1` breken. De index per brontabel is daarom een gewone, niet-unieke index op `(procedure_id, requirement_sleutel)`, puur voor opzoeken.

**Scope van de telling is het dossier, nooit de stap** *(gecorrigeerd in v0.13)*. De sleutel draagt `stap_volgorde` al in zich, en niet elke bron heeft een gevulde `stap_id` — `procedure_besluiten.stap_id` is nullable. v0.12 schreef "de procedure"; dat is te stellig gebleken, want **procedure ↔ decision object is niet 1:1** en de vijf `decision_*`-brontabellen dragen geen `procedure_id`. De regel is daarom **tabelnatuurlijk**:

| Brontabel | Scopekolom | Waarom |
|---|---|---|
| `decision_risks` · `decision_assumptions` · `decision_conditions` · `decision_evaluations` · `decision_ai_interactions` | `decision_id` | een risico, aanname, KPI of evaluatie hoort bij één **besluit** |
| `procedure_besluiten` · `procedure_vaststelling` | `procedure_id` | een besluit of vaststelling hoort bij het **proces** |
| `procedure_bewijs` | `stap_id` | die tabel draagt geen `procedure_id`; `stap_id` is er de lokale sleutel |

De uitzondering bij `procedure_bewijs` is **gelijkwaardig, niet afwijkend**: `fn_validate_bewijs_requirement_binding` dwingt af dat de `stap_volgorde` in de sleutel gelijk is aan `stap.volgorde` (de cross-step-guard). `stap_id` en de sleutel kunnen dus niet uit elkaar lopen, en stap-scoped tellen levert daar dezelfde verzameling op als dossier-scoped. Zou die guard ooit vervallen, dan vervalt deze gelijkwaardigheid mee.

Bij één besluit per procedure — de MVP-norm — vallen beide samen. Zodra een procedure een tweede besluitobject draagt, is dit onderscheid het verschil tussen juist en fout: procedure-breed tellen zou een vereiste van besluit B laten vervullen door een risico van besluit A. Denormaliseren van `procedure_id` naar de `decision_*`-tabellen om de indexvorm gelijk te trekken is geen oplossing — een synchroon te houden kolom is duurder dan twee scopevormen.

**Gevolg dat expliciet gemaakt moet worden:** vervulling is daarmee **asymmetrisch**. Bewijsstukken en vaststellingen worden gedeeld tussen besluiten op dezelfde procedure (het is dezelfde processtap), besluitgebonden feiten niet. Dat is bedoeld, maar het moet in de UI zichtbaar zijn *welk* feit een vereiste vervult — anders ziet een bestuurder een groene vereiste zonder te weten waar die vandaan komt. De scope hoort als **eigenschap van het brontype** in één tabel te staan (`brontype → scopekolom`), niet als verspreide conditionals; de generieke sanity-test toetst dat elk type een scope declareert.

**Gevolg voor `procedure_bewijs` — een bestaande afwijking, geen nieuwe.** De unieke partiële index `(stap_id, requirement_sleutel)` uit #160 dwingt vandaag *wél* één-bewijs-per-vereiste af. Concreet: een vereiste "afschriften van tien deelnemersgroepen" (`min_aantal = 10`) kan met het huidige schema nooit groen worden — het tweede bewijs wordt geweigerd. Dat is geen bedoeld ontwerp maar een onbedoeld gevolg van een index die is gebouwd om dubbele *bindingen* te voorkomen, terwijl de kolomvorm dat al doet. **In P2 vervangen** door de niet-unieke variant, in dezelfde migratie als de overige brontabellen, zodat alle twaalf typen zich identiek gedragen. Vast te leggen in besluitrecord **0189** bij P2, met de expliciete constatering dat er geen `min_aantal > 1` in de huidige seed staat en de wijziging dus geen bestaand gedrag raakt — te verifiëren vóór de migratie.

**Oververvulling is normaal.** Twaalf afschriften waar er tien gevraagd worden is geen fout en wordt niet geblokkeerd; de UI toont "10 van 10 vereist, 12 aangeleverd". Een bovengrens hoort niet in dit model thuis.

### 6.3 Het ontkoppelslot *(nieuw in v0.15)*

Een vervulling losmaken onder een besluit dat het feit al vaststelt, breekt I1 zonder dat iets protesteert: het besluit blijft `besloten`, het onderliggende feit is weg. Dat kan langs **drie deuren** — de bronrij verwijderen, de sleutel op null zetten, of de sleutel naar een andere vereiste herbinden. Een guard op alleen de route dekt er één.

**Besloten (0189): alle drie de deuren op databaseniveau.** Een BEFORE-trigger op elke brontabel weigert DELETE én de UPDATE die een bestaande sleutel wist of wijzigt, zolang de besluitstatus in de vaststellende verzameling zit — `besloten`, `voorwaardelijk_besloten`, `in_uitvoering`, `in_evaluatie`, `afgesloten`. Een **eerste** binding blijft toegestaan: bewijs aanvullen op een genomen besluit is geen aantasting. De route levert daarbovenop de leesbare 409; de database houdt de waarheid, ook voor domeinflows die de route niet passeren.

**Het slot is een omweg, geen doodlopende weg.** Geverifieerd: `heropend` en `geescaleerd` zitten niet in de vaststellende verzameling, en de statusroute (`decisions.manage`, geaudit met `status_gewijzigd` inclusief oude en nieuwe waarde) bereikt ze. Vanuit `voorwaardelijk_besloten`, `in_evaluatie` en `afgesloten` is dat één stap.

**Openstaand, belegd bij P4.** Vanuit `besloten` staat de overgangsmatrix alleen `in_uitvoering` en `afgesloten` toe. Een bindingsfout herstellen kost daar dus twee stappen, via een status die zelf iets betekent — `afgesloten` gebruiken als doorgang maakt het auditspoor misleidend. Dat is geen reden het slot te versoepelen, maar wel een vraag die de status-feitenmatrix van P4 moet beantwoorden: hoort er een gerichte *heropenen-ter-correctie* vanuit `besloten`? Zie §13.2.

**Sanity-test.** Eén generieke test die per requirement-type afdwingt dat vervulling positief en gebonden is. Die kan nu pas slagen, en vangt elk toekomstig type automatisch af.

**Zichtbaar gevolg — en waarom dat nu goedkoop is.** Dossiers die vandaag groen tonen op de acht ongebonden typen gaan openstaand tonen. Bij aangesloten fondsen zou dat bestuurlijk het zwaarste punt van de EPIC zijn: een bestuurder die zijn dossier van groen naar oranje ziet gaan zonder uitleg, wantrouwt het portaal en niet de oude regel.

**Maar er zijn nog geen fondsen aangesloten** (v0.11). Er is dus geen dossier om iemand mee te verrassen, en geen terugvalrapport dat ergens over gaat. De backfillregel van #160 (R1/R2: alleen wederzijds eenduidige kandidaten binden, ambigu blijft **zichtbaar** ongebonden) wordt doorgetrokken omdat hij juist is, niet omdat er data beschermd moet worden — met seed- en previewdata mag je opnieuw zaaien.

Dat maakt dit het goedkoopste moment om de regel in één keer voor alle elf typen door te voeren, zonder fasering. Verificatie loopt via de generieke sanity-test op de previewseed, niet via een rapport. Het bestuurlijke gesprek verschuift naar de onboarding van fonds 1 (OB-E14).

---

## 7. Readiness vervalt — en wat een besluitmoment in de plaats krijgt

Readiness vervalt ([`0184`](decisions/0184-readiness-vervalt.md)): procesbrede meting bij stapsgewijze besluitvorming, een gesloten ladder die niet op zelf gemodelleerde processen past, en tegenspraak met D8. Wat blijft is de vervuldheidstoets per vereiste.

**"Tot en met deze stap" vervalt óók.** §3 verklaart `volgorde` tot presentatievolgorde, en bij parallelle takken zegt "tot en met 9" niets over wat het besluit in stap 9 nodig heeft.

**In de plaats: expliciete binding aan een besluitmoment.**

```sql
alter table public.procedure_requirements
  add column if not exists besluitmoment_stap int;   -- volgorde van een stap met vereist_besluit
-- idem procedure_requirement_instance
```

| Regel | |
|---|---|
| Leeg | de vereiste telt alleen voor haar eigen stap |
| Gevuld | de vereiste telt óók mee voor het besluit op die stap — ongeacht in welke tak of fase zij zelf staat |
| **Eén besluitmoment per vereiste** | de kolom is één `int`, dus structureel afgedwongen. Moet dezelfde eis vóór twee besluiten rond zijn, dan zijn dat **twee vereisten** — de tweede is de herbevestiging, en die hoort zichtbaar te zijn in plaats van impliciet (advies review bij BP-2, overgenomen). |
| Validatie | een stap met `vereist_besluit` waaraan **geen enkele** vereiste is gebonden levert een waarschuwing bij import |

Die laatste regel voorkomt vals groen: zonder binding zou een besluitmoment "0 openstaand" tonen omdat er niets aan hangt, niet omdat alles rond is.

| Schaal | Wat je toont |
|---|---|
| Stap | openstaande vereisten van die stap, per zwaarte |
| Fase | afgeleid uit de stappen van die fase |
| Proces | totaal open, per zwaarte |
| **Besluitmoment** | vereisten met `besluitmoment_stap = N`, plus die op stap N zelf |

**Uitfasering in drie stappen:** (1) de vijf gates vervallen, vervangen door de waarschuwing uit §4.4 — met behoud van I1, dat is géén readiness-gate maar een integriteitsregel; (2) `ReadinessLadder.tsx`, horde-teksten en niveau-labels verdwijnen; (3) pas als niets het meer leest: de SQL-functies. Twee consumenten buiten de module moeten mee in stap 2: `app/api/chat/route.ts` en `app/api/stemmingen/[id]/sluiten/route.ts`.

Het afschrift verliest het label "verantwoordingsrijp" en toont de vervulde én openstaande vereisten. Bestaande afschriften blijven ongewijzigd.

---

## 8. D11 — Classificatie: sturend versus duidend

**Feitelijke stand.** Zes dimensies, vier trigger-kolommen, en die worden in één template gebruikt (`beleidswijziging_beleggingsbeleid`, drie regels); `toezichtgevoelig` nergens. De invaarseed van 114 regels bevat geen enkele conditional. Oorzaak: `triggert_bij` bestaat in de database maar **niet in het JSON-contract** (OB-7 in `PROCEDURE-GENERIEK-ONTWERP.md`).

| | Dimensies | Rol |
|---|---|---|
| **Sturend** | complexiteit · risiconiveau · mandaatgevoelig · toezichtgevoelig · **ai_risicoklasse** | zetten vereisten aan of uit via `triggert_bij` |
| **Duidend** | beleidsafwijking | context; gevolg is een governance-event (`policy_deviation_flagged`), geen vereiste |

`ai_risicoklasse` krijgt een vijfde trigger-kolom, zodat BR-009 (menselijke validatie bij middel/hoog) als gewone conditionele vereiste kan worden gemodelleerd in plaats van als hardgecodeerde regel. Duidende dimensies worden in de UI als **kenmerk** gepresenteerd, niet als instelling.

**Volgorde:** `triggert_bij` in het contract (fase C), dan toetsen bij B1 met de incident-definitie. Nul conditionals bij drie definities is het bewijs om de sturende set terug te brengen.

**Voor de generieke engine:** vijf vaste dimensies blijven een gesloten model. De nette vorm is de sturende dimensies hard in kolommen en duidende kenmerken vrij in de bestaande `classificatie jsonb`, zodat een nieuw etiket geen migratie vraagt.

---

## 9. Acties, werkbak en aantekeningen

### 9.1 De actiehouder wordt een profiel

```sql
alter table public.decision_actions
  add column if not exists eigenaar_id uuid references public.profielen(id) on delete set null;
```

| Situatie | `eigenaar_id` | `eigenaar_naam` |
|---|---|---|
| Lid van het fonds | gevuld — live koppeling, werkbak, notificatie | **ook gevuld** — historische momentopname |
| Buiten het portaal | leeg | gevuld |

Bij een interne houder dus **beide**: het id voor de koppeling, de naam voor het spoor als iemand het fonds verlaat — hetzelfde patroon als `voltooid_door` + `voltooid_door_naam`. De koppeling valt onder I5: het profiel moet bij hetzelfde fonds horen (§4.5).

De ledenbron bestaat al (`core/lib/fondsleden.ts`); de picker wordt hergebruikt. `decision_actions.afhankelijk_van` wordt vermoedelijk nergens gevuld: meenemen in dezelfde afweging als `geblokkeerd` (BP-5).

### 9.2 De werkbak is een weergave

De homepage heeft al "Uw open procedure-stappen". Dat gaat op in één blok **Voor u**, gevoed door vier bestaande bronnen: `decision_actions`, `procedure_stappen`, `voorbereidingen`, `document_metadata_review_queue`. Eén leesfunctie `haalWerkbak(userId)`; geen aparte takentabel.

**Regels**, met de correctie uit de review:

- alleen items met een **expliciete houder**;
- **eerst alle achterstallige items**, daarna aanvullen tot zeven met de eerstvolgende op datum, dan "toon alles". v0.7 zei "maximaal zeven" én "een te laat item wordt nooit verborgen" — bij acht achterstallige items spreken die elkaar tegen, en dan wint *nooit verbergen*. Zeven is een rustpunt, geen norm;
- klikken opent de bron met de juiste sectie opengeklapt.

Uitwerking: `MOCKUP-homepage-werkbak-v0.1.html`.

### 9.3 Aantekeningen per processtap *(nieuw in v0.8)*

**De vraag** was of het tabblad Overzicht van een stap ruimte moet laten voor aantekeningen. Ja — maar alleen als vooraf vastligt wat het *niet* is, want anders wordt het vrije veld de plek waar de verantwoording heen lekt.

Wat er vandaag al is en dus géén aantekening nodig heeft: de **toelichting** bij de stap (definitie, hoort bij het proces, niet bij dit dossier), de **motivering** bij een besluit, de **afwijkingsmotivering** (§5.1), en de **toelichting bij een vervulling** (§6.2). Wat ontbreekt is de tussenlaag: *"gebeld met de actuaris, cijfers volgen volgende week"*. Dat is werkverkeer, geen verantwoording, en het staat nu in mailboxen.

```sql
create table public.procedure_stap_notitie (
  id           uuid primary key default uuid_generate_v4(),
  fonds_id     uuid not null references public.fondsen(id),
  procedure_id uuid not null references public.procedures(id) on delete cascade,
  stap_id      uuid not null references public.procedure_stappen(id) on delete cascade,
  tekst        text not null,
  auteur       uuid not null references auth.users(id),
  auteur_naam  text not null,                       -- momentopname, zie §9.1
  aangemaakt_op timestamptz not null default now(),
  bewerkt_op    timestamptz
);
```

Vier ontwerpkeuzes, elk met een reden:

| Keuze | Waarom |
|---|---|
| **Zichtbaar voor iedereen met toegang tot het dossier** — geen privé-notities | Een privénotitie in een bestuurlijk dossier is een schijnvorm: hij is opvraagbaar zodra iemand ernaar vraagt, maar niemand rekent erop. Liever eerlijk gedeeld, of niet in het portaal. |
| **Wél bewerkbaar en verwijderbaar door de auteur**, mét `bewerkt_op` | Dit is bewust géén append-only auditobject. Zou het dat wel zijn, dan wordt het te zwaar om te gebruiken en gebeurt het werkverkeer weer per mail. De grens: alles wat vervulling, besluit of afwijking raakt, hoort in de append-only laag — daar verandert niets aan. |
| **Verschijnt niet in het afschrift** | Anders wordt de aantekening feitelijk verantwoording en gaan mensen erop letten wat ze schrijven. Wel opvraagbaar op verzoek; dat onderscheid expliciet in de UI melden. |
| **Activeert de stap niet** (§4.2) | Een aantekening is geen inhoudelijke handeling. Anders staat een stap op `actief` omdat iemand "nog even navragen" heeft getypt. |

**In de UI:** op het tabblad Overzicht, als een rustig blok met "+ Aantekening". Getoond met auteur en datum, nieuwste boven, ingeklapt vanaf drie. Niet als zesde tabblad — dat suggereert een gewicht dat het niet heeft, en de tabbalk is al vol.

**Daarbij vervalt de bewijslast-preview op Overzicht.** Die stond er als derde weergave van dezelfde informatie: de tabbadge toont al `0/3` en de voettekstbalk noemt permanent wat er open staat. Overzicht wordt daarmee het tabblad met **context en werkverkeer** — wat is deze stap, in welke fase, en wat speelt er nu — en de andere vier tabs dragen het werk. Dat geeft de aantekening ook een natuurlijke plek in plaats van een aanhangsel onder een lijst.

**Openstaand punt daarbij:** met Overzicht als contexttabblad is het de vraag of het nog het juiste landingstabblad is voor een *actieve* stap; Checklist ligt dan meer voor de hand. Bewust niet nu beslist — eerst kijken hoe het in gebruik voelt.

**Twee risico's om te benoemen bij vaststelling.** (1) Het veld trekt aan: zodra het bestaat, komt er informatie in die eigenlijk in de motivering of bij een vereiste hoort. Tegengif is de vaste plek onderaan en een korte hint in de UI over waar wat hoort. (2) Bij een geschil of toezichtsvraag is de aantekening opvraagbaar; gebruikers moeten dat weten vóórdat ze het gebruiken, niet erna. Dat pleit voor één zin bij het invoerveld, niet voor het weglaten van de functie.

**Alternatief dat is afgewogen:** aantekeningen bij het proces als geheel in plaats van per stap. Afgevallen — dan ontstaat één lange draad zonder aanhechting, en juist de koppeling aan de stap maakt hem terugvindbaar. Beide bouwen kan later; beginnen bij de stap is de smallere en nuttigere helft. Opgenomen in ticket **P5**.

---

## 10. Wat uit de definitie vervalt, en wat terugkomt

**Vervalt:** `geschatte_dagen` per stap (schijnprecisie) en `termijn_dagen` / `bevestiging_vereist` bij een vereiste (bestonden zonder gedrag).

**Komt terug: één optionele datum per stap — uiterlijk gereed.** `procedure_stappen.deadline` bestaat al en wordt getoond in `StapPaneel.tsx`; er is geen invoerpad. Randvoorwaarden: één betekenis (**uiterlijk gereed**, niet "wanneer we het doen"); op de instantie en niet berekend; en er wordt **geen status uit afgeleid** — een verstreken datum is een signaal.

**Gevolg voor het overzicht:** het filter "Tijdkritisch" gaat vandaag niet over tijd maar over ontbrekende kritieke vereisten. Hernoemen naar **"Kritieke vereisten"** — v0.7 stelde "Blokkade" voor, maar de review heeft gelijk dat dat het nieuwe model tegenspreekt: een kritieke vereiste is met bevoegdheid en motivering te passeren (§5.1) en is dus geen blokkade. "Tijdkritisch" komt vrij voor datums.

---

## 11. Engine-consumptie en UI

1. **Start**: snapshot van stappen, checklist, `fase_code`, afhankelijkheden; statussen `niet_begonnen` / `geblokkeerd`.
2. **Handeling**: trigger `niet_begonnen → actief`, met `actief_sinds` en `gestart_door`.
3. **Afronden**: bepaal wat open staat per zwaarte; niets open boven optioneel → gewone afronding; anders bevoegdheid + motivering (+ bevestiging bij kritiek). Alles in één transactie (§5.1).
4. **Beëindigen**: besluitstatus en dossierstatus `beeindigd`, niet-afgeronde stappen `vervallen`, reden verplicht, tellingen uit de werkvoorraad (§5.2).
5. **Statuswissel**: `toetsStatusFeit()` tegen de matrix van §4.6, vóór de overgangsmatrix (I4) en vóór de capability-check (I3).
6. **Tellingen**: `buildEvidenceLijst` als gelijkheidstest op `requirement_sleutel` per brontabel; UI telt op vier schalen (§7).
7. **Schermen**: `MOCKUP-processen-v0.7-overzicht-en-detail.html` — gesynchroniseerd met dit ontwerp (zwaarte, afronden-met-afwijking, readiness eruit); aantekeningen (§9.3) staan er nog niet in. Statusmodel: `VISUAL-statusmodel-processen-v0.3.html`. Definitie-invoer: `SJABLOON-procesdefinitie-v0.2.xlsx`.

---

## 12. Bestuurlijke informatiewaarde

Tellingen zijn operationeel. "17 open, waarvan 4 kritiek" is geen handelingsperspectief. De proceskaart beantwoordt vier vragen: waar staat het dossier, welk oordeel komt nu, wat vraagt aandacht, en wie moet wat vóór wanneer.

Daarvoor is **geen nieuw datamodel** nodig — met één uitzondering, zie signaal 5. Toon er **maximaal drie**, in deze vaste prioriteitsvolgorde (zonder vaste volgorde valt willekeurig welk signaal af):

| # | Signaal | Afgeleid uit |
|---|---|---|
| 1 | "Twee kritieke vereisten ontbreken" | evidence-laag, `zwaarte = kritiek` |
| 2 | "Eén actie is drie dagen te laat" | `decision_actions.deadline` |
| 3 | "Eén stap afgerond met afwijking; opvolging open" | `afgerond_met_afwijking` |
| 4 | "Formele dissent nog niet vastgesteld" | `decision_dissent.formeel_vastgesteld` |
| 5 | "Go/no-gobesluit gepland op 30 september" | **gecorrigeerd in v0.8:** `gewenste_besluitdatum` op het besluitmoment, of de agendakoppeling van de vergadering waarop het besluit staat — **niet** `procedure_stappen.deadline`. Dat veld betekent volgens §10 *uiterlijk gereed*; die twee door elkaar halen levert een datum die niemand heeft gepland. Vraagt dus één nieuwe kolom of hergebruik van de agendakoppeling; keuze bij ticket **P5**. |
| 6 | "Geen houder toegewezen" | **gecorrigeerd in v0.8:** `eigenaar_id is null` **én** `eigenaar_naam is null`. Een externe houder heeft bewust alleen een naam (§9.1) en is dus wél toegewezen. |

De totalen blijven bestaan, maar als tweede regel — niet als hoofdboodschap.

### 12.1 Zoeken in processen *(nieuw in v0.8, BP-9)*

Het procesoverzicht krijgt een zoekveld. Twee reikwijdtes, en het verschil is groter dan het lijkt.

**Nu gebouwd — zoeken op de kaart.** Naam, omschrijving en procestype. Cliëntzijdig, want de lijst is per fonds klein. Het **stapelt op de filters** in plaats van ernaast te staan: één resultatenlijst, de zoekterm als chip. Levert het niets op binnen de actieve filters, dan biedt de lege staat aan in *alle* processen te zoeken — anders krijg je "niets gevonden" terwijl het gezochte onder een ander filter staat, en dat is de meest voorkomende manier waarop zoeken vertrouwen verliest.

**Nog niet gebouwd — zoeken dóór in het dossier.** Stappen, checklistpunten, bewijsstukken, besluiten, aantekeningen. Nuttig ("waar hebben we het transitieplan opgevoerd?"), maar het is een andere functie:

- het vraagt **gegroepeerde treffers** (proces → stap → regel), niet een gefilterde lijst kaarten;
- het overlapt met twee bestaande paden: de **documentbibliotheek** heeft eigen zoek, en de **AI-assistent** beantwoordt precies dit soort vragen in natuurlijke taal. Drie ingangen naar dezelfde inhoud is een keuze die je bewust maakt, niet een die erin groeit;
- het raakt **I5**: een zoekindex over meerdere tabellen is de klassieke plek waar de tenantgrens lekt, omdat de index vaak buiten RLS om wordt gelezen. Bouwen we dit, dan is `fonds_id` onderdeel van de indexsleutel en niet van het filter achteraf;
- **aantekeningen** (§9.3) zouden erin meekomen. Dat is verdedigbaar, maar het verandert wel hoe mensen ze gebruiken zodra ze weten dat er doorheen wordt gezocht.

Advies: eerst de kaartzoek in gebruik nemen en kijken waar mensen tegenaan lopen. Blijkt de behoefte vooral "waar staat dit document", dan is het antwoord de bibliotheek of de assistent — niet een derde zoekfunctie in Processen.

---

## 13. Migratiepad

### 13.1 Go-livevoorwaarde (ticket P1b) — versiebevriezing én onveranderlijkheid

De bewijslast wordt live gelezen per `template_code`; een gewijzigde seed verandert daarmee de bewijslast van lopende én afgeronde dossiers.

> Er wordt geen tweede generieke definitie in gebruik genomen en de registry wordt niet geactiveerd voordat stappen, checklist **én** vereisten als één versievaste set worden gestart.

**Correctie in v0.8.** v0.7 stopte bij versie-pinnen. De review heeft gelijk dat dat te weinig is: filteren op `template_versie` verhindert niet dat iemand een vereiste *binnen* dezelfde versie wijzigt, en dan verandert de bewijslast van een lopend dossier alsnog zonder spoor. Geverifieerd, en de uitgangspositie is slechter dan aangenomen: `procedure_requirements` heeft **geen versiekolom en geen enkele unique constraint** (`supabase/migrations/2026_05_07_decision_object.sql:304`) — vandaag kan dezelfde vereiste tweemaal bestaan zonder dat iets protesteert.

**Correctie in v0.10 — er is geen registry.** v0.9 hing de publicatiestatus aan `procedure_template_versies`. Die tabel bestaat niet: op `origin/main` staat alleen `procedure_template_fasen` (D8). De registry hoort bij fase C en valt buiten deze EPIC. I7 heeft dus een eigen aanhechtingspunt nodig.

Drie onderdelen, samen I7:

```sql
-- 1. versie op de vereiste zelf — LET OP: geen blanket default, zie hieronder
alter table public.procedure_requirements
  add column if not exists template_versie text;

-- 2. identiteit van een vereiste, nu pas versievast
--    (idx_req_uniek bestaat al zonder versie; die wordt vervangen)
create unique index idx_requirement_identiteit
  on public.procedure_requirements(
       template_code, template_versie, stap_volgorde, requirement_type,
       coalesce(documenttype, label));

-- 3. publicatieregister — minimaal, uitdrukkelijk NIET de registry
create table public.procedure_definitie_publicatie (
  template_code     text not null,
  template_versie   text not null,
  gepubliceerd_op   timestamptz not null default now(),
  gepubliceerd_door uuid references auth.users(id),
  primary key (template_code, template_versie)
);
-- BEFORE UPDATE OR DELETE op procedure_requirements:
--   staat de (template_code, template_versie) in dit register → raise exception.
--   Wijzigen kan dan alleen via een nieuwe versie.
```

Fase C kan dit register later absorberen; tot die tijd doet het precies één ding, en dat is I7 afdwingen.

**De backfill is de plek waar dit stil kan mislukken.** Zet `template_versie` niet op een blanket default. `pf_wtp_invaarbesluit` draait op `2.0.0`; tag je de vereisten als `1.0.0` terwijl lopende dossiers op `2.0.0` pinnen, dan vinden die dossiers **nul** vereisten en tonen ze een lege, groene bewijslast. Leid de versie per `template_code` af uit de bron — de canonieke JSON respectievelijk de seed — en toon met een regressietest aan dat elk bestaand dossier vóór en ná de migratie evenveel vereisten vindt. Voor de vier code-templates geldt de conventie uit OB-4: die worden `1.0.0`.

Dat is het verschil tussen *versiepinning* (het dossier wijst naar een versie) en *versiebevriezing* (die versie kán niet meer veranderen). Alleen het tweede is verdedigbaar tegenover een toezichthouder.

**Verder in P1b.** `procedures.template_versie` is nieuw. `decision_objects.template_versie` bestáát al (`2026_05_07_decision_object.sql:79`) maar wordt gevuld met de **code** — `core/lib/decision.ts:147` zet `procedure.template_code`. Dat wordt de versie. En de vereisten-tellingen gaan filteren op `(template_code, template_versie)`.

### 13.2 Werktickets

Uitgezet als GitHub-issues onder `EPIC P — Proceduremodule generieke engine`, milestone *Proceduremodule v2*.

| Ticket | Inhoud | Impact | Volgt op |
|---|---|---|---|
| **P1a** | UI-herinrichting: overzicht (één lijst, ingeklapte rail, chips, zoeken, kaart) en stapdetail (tabs, voetbalk). Raakt **geen API** | alleen UI | — |
| **P1b** | Fundament: `template_versie` op vereisten, `idx_req_uniek` uitbreiden, publicatiestatus + weigerende trigger (I7), dossiers pinnen op versie i.p.v. code, vijfde trigger-kolom `ai_risicoklasse` | data + audit | — |
| **P2** | Vervulling: patroon doortrekken naar de acht resterende typen + `procedure_vaststelling`; unieke bewijsindex vervangen door niet-unieke (§6.2); telling procedure-scoped; generieke sanity-test; backfill R1/R2 | data + UI | P1b |
| **P3** | `zwaarte`, afronden met afwijking, **readiness ontmantelen** (uitvoering van `0187`: `fn_decision_readiness_check`, `ReadinessLadder.tsx`, vier migraties, twee consumenten buiten de module) | data + UI | P2 |
| **P4** | Statussen sluitend: `niet_begonnen` + actief-trigger, beëindigen/heropenen, fasestatus `vervallen`, negende dossierstatus, status-feitenmatrix (§4.6), invarianten I1–I7 geborgd. **Plus**: beantwoordt of er een *heropenen-ter-correctie* vanuit `besloten` hoort (§6.3) | data + tenant/security | P3 |
| **P5** | Acties, werkbak, aantekeningen (§9.3), bestuurlijke signalen (§12) | data + UI | deels P3 |
| **P6** | Promotie naar preview en productie; migratievolgorde, gates schoon, terugval vooraf gecommuniceerd | — | P1–P5 · **geblokkeerd door [#192](https://github.com/merlinijzerman/Bestuurdersportaal/issues/192)** |

**Waarom P1b vóór P2.** `idx_req_uniek` bestaat, maar zonder `template_versie` erin. Zolang dat zo is, is de vereiste-sleutel niet versievast en zou een nieuwe templateversie de binding van een lopend dossier kunnen laten verschuiven. Dat is precies wat 0183 wilde voorkomen.

**Afhankelijkheid van het wrapperspoor.** 103 van de 114 routes zitten achter een wrapper; de elf resterende zijn catalogus-routes zonder raakvlak. Het echte raakpunt is het **capability-vocabulaire**: er zijn 42 gedeclareerde capabilities, waarvan vier in ons domein (`procedures.view/manage`, `decisions.view/manage`), en `authz-matrix.expected.json` is sinds #157 een continue CI-gate. P2 komt toe met `procedures.manage`; **P3 is de eerste die een nieuwe capability nodig heeft** (`procedures.afwijking.vastleggen`). *(Gecorrigeerd in v0.16: dat wachtte volgens v0.9–v0.15 op het rolmodelbesluit [#153](https://github.com/merlinijzerman/Bestuurdersportaal/issues/153). **Dat besluit is genomen en de code staat sinds release [#161](https://github.com/merlinijzerman/Bestuurdersportaal/pull/161) in productie**: 112 declaraties, nul `TE_BEPALEN`, en `authz-matrix.expected.json` als continue gate. P3 is dus niet geblokkeerd; wat resteert onder #153/#91 is de productie-vlagflip, en die raakt P3 niet. Zie de beslisnotitie in `05 Security en compliance`.)* P6 mag niet samenvallen met de vlag-flip aan het eind van Deploy 3 ([`0186`](decisions/0186-capability-vlagdefault-flipt-pas-eind-deploy-3.md)) — twee gedragsveranderingen in één release maken een storing onherleidbaar.

**Snapshots.** 103 van de 367 karakteriseringssnapshots zitten op procedures/decisions. P2, P3 en P4 veranderen responses bewust. Regel: een snapshot-update is altijd een **aparte, gemotiveerde commit**, nooit meeliftend in een functionele wijziging.

Opruimen van het legacy-pad en `geblokkeerd` volgt ná fase B1.

---

## 14. Beslispunten — gesloten

Alle negen zijn beslecht in de sessie van 21 t/m 24-08-2026.

| Nr | Onderwerp | Uitkomst |
|---|---|---|
| **BP-1** | Bevoegdheid bij *kritiek* | ✅ Aan de handeling: één capability + bevestigingsstap. Naam volgt de conventie: **`procedures.afwijking.vastleggen`** (meervoud, zoals `procedures.manage`) |
| **BP-2** | `besluitmoment_stap` in definitie én sjabloon | ✅ Ja; maximaal één besluitmoment per vereiste, herbevestiging wordt een tweede vereiste |
| **BP-3** | `geannuleerd` | ✅ Blijft als **verborgen legacy-opslagwaarde**; uit elke nieuwe overgang, in de UI getoond als *Beëindigd* |
| **BP-4** | Vier-ogen bij override op toezichtgevoelig proces | ✅ Niet bouwen; capability, motivering en governance-event volstaan in deze fase |
| **BP-5** | Afhankelijkheden gebruiken of opruimen | ✅ Uitgesteld tot B1, dáár als **verplicht exit-besluit** |
| **BP-6** | `geschat_aantal_dagen` op procesniveau | ✅ Blijft — één aantoonbare consument: `NieuweProcedureForm.tsx:111`, oriëntatie bij de templatekeuze. Vervalt zodra die verdwijnt |
| **BP-7** | Mechanisme dat álle typen aan hun vervullende feit bindt | ✅ **Herzien**: bestaand patroon doortrekken + brontabel `procedure_vaststelling` (§6.2), niet één centrale tabel |
| **BP-8** | Aantekeningen per processtap | ✅ Bouwen, met de vier grenzen uit §9.3 |
| **BP-9** | Diepte van zoeken | ✅ Alleen de kaart. Diep zoeken naar `openstaande-punten-en-risicos.md`, met herbeoordeling na drie maanden gebruik |

**Tradeoffs**

- **Zacht waar het oordeel telt, hard waar het feit telt.** De prijs van zacht is dat het auditspoor het werk doet; de prijs van hard is dat een bestuur soms wordt geweigerd. §4.5 en §4.6 leggen de grens vast zodat die afweging niet per scherm opnieuw wordt gemaakt.
- **Zichtbare verslechtering bij oplevering, breder dan bij 0183.** Na P2 tonen dossiers hun werkelijke openstaande bewijslast over acht requirement-typen tegelijk. Bedoeld — en nu nog kosteloos, omdat er geen fondsen zijn aangesloten (§6.2). Het gesprek daarover hoort bij de onboarding van fonds 1, niet bij deze EPIC.
- **P1b kost tijd vóórdat iemand functionaliteit ziet.** Onveranderlijkheid levert geen zichtbare feature op en staat toch vooraan. De reden is dat elk later ticket de bewijslast als vaste grootheid veronderstelt; bouw je die volgorde om, dan migreer je twee keer. P1a vangt dat op: die levert wél meteen zichtbaar resultaat en raakt niets.
- **Twee gedragingen zolang `open` bestaat** (§3).

---

## 15. Wat dit document niet is

Geen procesdefinitie (zie `SJABLOON-procesdefinitie-v0.2.xlsx`), geen registry-ontwerp (`PROCEDURE-GENERIEK-ONTWERP.md` v0.4, fasen C–D), geen in-app editor, en geen wijziging aan de besluitstatussen zelf behalve de toevoeging `beeindigd` en het verbergen van `geannuleerd`.

---

**Nummering van besluitrecords — regel** *(vastgelegd in v0.18)*. Een nummer wordt **geclaimd op het moment dat het record wordt geschreven**, in volgorde van schrijven. De lijst hieronder is een **plan, geen reservering**: loopt de werkelijke volgorde anders, dan wint de werkelijkheid en schuift het plan op. Een al geschreven record wordt **nooit hernummerd** om in een gepland schema te passen — dat maakt van een chronologisch log een index, en laat verwijzingen in commits, PR's en documenten achter die nergens meer op wijzen.

*Stand: 0183 t/m 0187 vergeven · **0188** P1b (versiebevriezing en onveranderlijkheid, §13.1) · **0189** P2 (D10 — vervulling doorgetrokken, §6) · **0190** codificatie per-PR-gateset (buiten de reeks) · **0191** P5-aantekeningen (§9.3, geschreven vóór P3 en behoudt daarom dit nummer) · **0192** P3 (D9 — validatie, afwijking, beëindiging, §5) · **0193** P4 (invarianten I1–I7 en de status-feitenmatrix, §4.5–4.6). D11 (classificatie, §8) hoort bij de definitielaag en volgt met fase C.*

*Bijbehorende stukken: `SJABLOON-procesdefinitie-v0.2.xlsx`, `MOCKUP-processen-v0.7-overzicht-en-detail.html`, `MOCKUP-homepage-werkbak-v0.1.html`, `VISUAL-statusmodel-processen-v0.3.html` en `VISUAL-bewijslast-vier-handelingen-v0.1.html` (functionele uitleg van de vier handelingen, bij §6 en §9.3).*
