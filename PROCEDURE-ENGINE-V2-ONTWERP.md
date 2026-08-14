# Proceduremodule-engine v2 — parallelle activatie, aanpasbare vereisten en fasebeschrijving

> **Status**: v0.2 — geïmplementeerd in WO-1 (D6/D7/D8 + definitie); zie besluit [`0174`](decisions/0174-proceduremodule-engine-v2-D6-D7-D8.md) · **Datum**: 2026-08-13
> **Bron**: `Procesontwerp-invaarprocedure-SPH-v0.1.md` (03 Functioneel ontwerp) · `Bestuurdersportaal - Proceduremodule generiek ontwerp v0.2.md` · `mvp/lib/decision.ts`, `procedure_stappen`/`procedure_checklist`/`procedure_requirements` · `decisions/0002` (definitie als data), `0001/0024` (append-only), `0049` (go/no-go-gate)
> **Doel**: de generieke proceduremodule-engine uitbreiden zodat (D6) stappen **per definitie parallel** lopen met expliciete, schaarse harde afhankelijkheden en heropen-mogelijkheid, (D7) checklist en bewijslast **aanpasbaar** zijn op template- én instantieniveau, en (D8) elke fase een **generieke, per fonds overschrijfbare beschrijving** heeft.
> **Scope-afbakening**: engine + datamodel + readiness + audit/RLS + UX-consumptie. **Niet**: de inhoudelijke invaardefinitie zelf (dat is de canonieke JSON `pf_wtp_invaarbesluit@2.0.0`, een apart, licht spoor) en geen wijziging aan het Decision Object-statusmodel behalve waar hieronder expliciet benoemd.
> **Impactklasse**: **data + tenant/security** → de documentatiehaak vuurt (00–09 + as-built) en de structurele gates (`supabase/checks/…structurele_gates.sql`) moeten schoon draaien.

## Revisielog

**v0.4 (2026-08-14)** — Per-proces **verwijderen** van checklist- en bewijslastitems (met verplichte toelichting). Naast het *toevoegen* (D7) kan een voorzitter/beheerder nu per lopende procedure items verwijderen. Handmatige instantie-items: bestaande soft-deactivate (`procedure_requirement_instance.actief=false`). **Template-vereisten** (de generieke set): verwijderen is een **per-proces overlay** via de nieuwe tabel `procedure_requirement_uitsluiting` — de generieke `procedure_requirements`-set wordt **nooit** gemuteerd. `fn_decision_readiness_check` en `buildEvidenceLijst` trekken de overlay af met een `NOT EXISTS` (match op `decision_id`+`stap_volgorde`+`requirement_type`+`label`). Checklist-verwijdering loopt via `procedure_checklist.actief`. Zie §5.5; datadictionary §32; OB-E12/OB-E13 bijgewerkt.

**v0.3 (2026-08-13)** — WO-3 (UI-herinrichting Processen-detail). De D8-fasebeschrijving is uit de linker fasen-rail gehaald naar een **aparte fase-weergave** rechts (`FaseWeergave.tsx`, geopend via `?fase=`) met een echt bewerkpad: `POST /api/procedures/[id]/fase-beschrijving` schrijft `procedure_fase_beschrijving_override` (leeg opslaan = override wissen → terugval op de generieke default), server-side gegate op rol **voorzitter/beheerder**, append-only gelogd in **`procedure_log`** (`event_type: fase_beschrijving_bijgewerkt`). De rail (`FaseRail.tsx`) is een schone fase-accordeon (badge/titel/stap-count/status-pill/aandachtsrand) zónder beschrijvings-/toelichtingsblokken. §6-governance en §7 hieronder hierop bijgewerkt (gate = rol, log = `procedure_log`, **niet** `fonds_config_log`/`fonds.config.manage`). Nieuw datagat **OB-E10**: checklistitem-/bewijsstuk-`toelichting` bestaat alleen in de standaardset-JSON, niet in de DB (aparte, kleine data-WO — buiten de UI-scope).

**v0.2 (2026-08-13)** — geïmplementeerd in WO-1 (besluit [`0174`](decisions/0174-proceduremodule-engine-v2-D6-D7-D8.md)). Vier gedwongen aanpassingen na codeverificatie (het ontwerp liep hierop vóór op de werkelijkheid):
- **B1** — Er zijn géén template-tabellen (`procedure_templates`/`procedure_template_stappen` bestaan niet; templates leven als code/JSON, requirements op `template_code`). Daarom: geen `alter procedure_template_stappen`; de D8-tabellen (`procedure_template_fasen`, `procedure_fase_beschrijving_override`) zijn op **`template_code`** gesleuteld i.p.v. `template_id`; `blokkerende_afhankelijkheden`/`fase_code` leven in de JSON-definitie en worden bij start meegesnapshot op `procedure_stappen`.
- **B2** — `voltooid_op` hergebruikt i.p.v. een nieuwe `afgerond_op` (§4.1); die kolom bestond al.
- **B3** — Requirements zijn niet geversioneerd/gesnapshot; readiness leest live per `template_code`. Snapshot-integriteit geldt voor stappen/checklist, niet voor requirements (bestaande engine-eigenschap).
- **B4** — Geen zod (repo-ethos "geen extra runtime-dep"); lichte eigen validator (schema + DAG + fase-refs) onder `npm run sanity`, plus een uit de JSON gegenereerde, drift-gecontroleerde requirements-seed.
- Extra: `external_submission`/`consultation` toegevoegd aan de requirement-enum + readiness/evidence (via de document-logica), nodig om D7 ("instantie-item telt mee in readiness") waar te maken.

**v0.1 (2026-08-13)** — eerste opzet. Vertaalt de open beslissingen D6/D7/D8 uit het invaar-procesontwerp naar een bouwbaar engine-ontwerp. Kernwijziging t.o.v. proceduremodule-ontwerp v0.2: dat ging uit van **sequentiële** activatie (auto-activeer de volgende stap); dit ontwerp maakt **parallel de default**. Dit moet via `ontwerp-sync-reviewer` terug in v0.2 (revisielog) worden opgenomen zodat de twee documenten niet uiteenlopen.

---

## 1. Doelpositionering

De huidige engine is bewust generiek (snapshot-bij-start, readiness-ladder, Decision Object), maar kent drie beperkingen die het invaarproces blootlegde en die breder gelden voor complexe, iteratieve procedures:

1. **Sequentieel aannemen.** De engine activeert één stap tegelijk en zet automatisch "de volgende" open. Complexe processen lopen niet zo: onderbouwing, data en communicatie rijpen parallel, en toezichtvragen heropenen eerdere stappen. → **D6**.
2. **Vaste vereisten.** Checklist en bewijslast liggen in de template vast; een lopende procedure kan geen extra checklistonderwerp of bewijslasttype krijgen, terwijl dat bij een 640-daags invaartraject onvermijdelijk is. → **D7**.
3. **Geen fase-duiding als data.** Fasen bestaan nu alleen als lichtgewicht `fase_type`-tag; er is geen leesbare fasebeschrijving, laat staan een per-fonds aanpasbare. → **D8**.

Leidend principe (aansluitend op `decision 0002`): **gedrag als data, niet als code.** Afhankelijkheden, aanpasbaarheid en fasebeschrijving worden configuratie op de definitie/instantie, niet nieuwe hardcoded takken per procedure. Het snapshot-pattern en de readiness-ladder blijven in de kern ongewijzigd.

---

## 2. Huidige situatie — wat blijft, wat wijzigt

**Blijft (behouden):**
- Snapshot-bij-start: template → `procedure_stappen`/`procedure_checklist`; `decision_objects.template_versie` bevriest de versie. Lopende procedures wijzigen nooit mee met een nieuwe templateversie.
- `procedure_requirements` als readiness-bron, met classificatie-conditionals (`triggert_bij_*`).
- Append-only `governance_events` met sha256-hashketen (`decision 0001`).
- De zes readiness-niveaus en `fn_decision_readiness_check`.

**Wijzigt:**
- **Activatie**: van "auto-activeer volgende stap" naar **afhankelijkheidsgestuurd, parallel-by-default** (§3, §4).
- **Instantietabellen** `procedure_stappen`/`procedure_checklist` en de requirements: **schrijfbaar ná snapshot** voor handmatige toevoegingen, met herkomst en governance-koppeling (§5).
- **Readiness-bron**: leest voortaan template-requirements **plus** actieve instantie-requirements (§5.3).
- **Fasen**: worden onderdeel van de definitie met een generieke beschrijving en een fonds-override-laag (§6).

---

## 3. Kernprincipe — parallel by default

> Een procedure is **standaard parallel**. Elke stap is *activeerbaar* zodra haar (eventuele) blokkerende afhankelijkheden zijn afgerond. Een stap zonder afhankelijkheden is dus vanaf de start activeerbaar. Sequentieel gedrag is geen engine-default meer, maar een **gevolg van het declareren van een afhankelijkheidsketen**.

Concreet:
- Bij `procedure_start` worden **alle** stappen zonder onvervulde blokkerende afhankelijkheid tegelijk op `actief` gezet (niet alleen stap 1).
- De nummering (`volgorde`) is nog slechts **presentatie-/verantwoordingsvolgorde**, geen activatievolgorde.
- Harde gates zijn **optioneel en schaars**: een procedure declareert `blokkerende_afhankelijkheden` alleen waar nodig. **Het invaarproces gebruikt ze bewust niet** — alle 12 stappen zijn vanaf de start activeerbaar; de besluitdiscipline ligt bij de readiness-ladder en de formele go/no-go-gate (`decision 0049`), niet bij stap-afhankelijkheden. (Andere procedures, zoals incident-meldplicht DNB, kunnen wél een gate declareren; de engine ondersteunt dat generiek.)
- **Doorlopende sporen** (communicatie, datakwaliteit, ketenregie) zijn simpelweg stappen zonder afhankelijkheid die lang `actief` blijven en meerdere keren geraakt worden.
- **Iteratie**: een `afgerond` stap kan heropend worden (§4.3).

Deze inversie is de belangrijkste keuze van dit ontwerp en de expliciete aanpassing t.o.v. proceduremodule-ontwerp v0.2.

---

## 4. D6 — Afhankelijkheidsgestuurde, parallelle activatie

### 4.1 Datamodel-delta

```sql
-- Template: afhankelijkheden als data (verwijst naar stap-volgordes binnen dezelfde template)
alter table public.procedure_template_stappen
  add column if not exists blokkerende_afhankelijkheden int[] not null default '{}';

-- Instantie (snapshot): afhankelijkheden + expliciet stap-statusmodel
alter table public.procedure_stappen
  add column if not exists blokkerende_afhankelijkheden int[] not null default '{}',
  add column if not exists status text not null default 'geblokkeerd'
      check (status in ('geblokkeerd','actief','afgerond','heropend')),
  add column if not exists herbevestiging_nodig boolean not null default false,
  add column if not exists afgerond_op   timestamptz,
  add column if not exists heropend_op   timestamptz;
```

`blokkerende_afhankelijkheden` bevat de `volgorde`-waarden van de stappen die eerst `afgerond` moeten zijn. Leeg = geen gate.

### 4.2 Activatielogica (deterministisch, herberekenbaar)

Eén pure functie bepaalt de status; ze is idempotent en kan altijd opnieuw gedraaid worden (belangrijk voor resume/herstel):

```
activeerbaar(stap) := elke v in stap.blokkerende_afhankelijkheden
                      heeft een stap met status = 'afgerond'
```

- **Bij `procedure_start`**: snapshot stappen; zet `status = 'actief'` voor elke stap waarvoor `activeerbaar` waar is, anders `'geblokkeerd'`. → meerdere gelijktijdig actief.
- **Bij stap-afronden** (`status → 'afgerond'`, `afgerond_op = now()`): herbereken uitsluitend de stappen die déze stap als afhankelijkheid noemen; wie nu `activeerbaar` is en `'geblokkeerd'` stond, wordt `'actief'`.
- Er is **geen** "activeer de volgende op volgorde" meer. De helper `activeerVolgendeStap()` wordt vervangen door `herberekenActiveerbaarheid(decision_id, gewijzigde_volgorde?)`.

Cyclusbewaking: `blokkerende_afhankelijkheden` moet een DAG vormen. Validatie bij template-import (Zod + een topologische check, §8); een cyclus is een harde importfout.

### 4.3 Heropenen (iteratie/rework)

Een `afgerond` stap kan terug naar `'heropend'` (telt voor readiness/UI als actief):

- Toegestaan voor beheerder/voorzitter; **append-only gelogd** als `governance_event` met motivering. De eerdere afronding blijft in het spoor; het bestuurlijk oordeel krijgt een **nieuwe versie** (geen overschrijving).
- Waar afhankelijkheden zijn gedeclareerd (andere procedures): stappen die van de heropende stap afhankelijk zijn en al `afgerond` waren, worden **niet automatisch teruggezet** (voorkomt cascade-churn), maar gemarkeerd met `herbevestiging_nodig = true` — een zichtbaar, niet-blokkerend signaal "controleer of dit nog klopt".
- **Het invaarproces kent geen afhankelijkheden**, dus geen automatische herbevestiging: het bestuur markeert desgewenst zelf gerelateerde stappen. Voorbeeld: een DNB-vraag heropent stap 5 (evenwichtigheid); het bestuur beoordeelt of stap 7 (voorgenomen besluit) herzien moet worden.

### 4.4 Relatie tot het Decision Object-statusmodel

Het stap-statusmodel (`geblokkeerd/actief/afgerond/heropend`) staat **los** van de 17-status Decision Object-machine en de readiness-ladder; die blijven ongewijzigd. Wel: de bestaande go/no-go-gate (`decision 0049`) blijft de formele besluitpoort — stap-afhankelijkheden zijn een *fijnmaziger*, procesinterne laag eronder, geen vervanging.

---

## 5. D7 — Aanpasbare checklist en bewijslast

### 5.1 Twee niveaus

1. **Template-niveau** (definitie/editor, fase G proceduremodule): checklist-items en requirements beheren als data; wijziging = nieuwe templateversie; lopende procedures behouden hun snapshot.
2. **Instantie-niveau** (lopende procedure): een bevoegde rol voegt een **checklistonderwerp** of **bewijslasttype** toe aan een stap van een lópende procedure. Noodzakelijk door het iteratieve karakter (§3).

### 5.2 Datamodel-delta

```sql
-- Instantie-checklist: herkomst + soft-deactivate + governance-koppeling
alter table public.procedure_checklist
  add column if not exists bron text not null default 'template'
      check (bron in ('template','handmatig')),
  add column if not exists actief boolean not null default true,
  add column if not exists governance_event_id uuid references public.governance_events(id),
  add column if not exists aangemaakt_door uuid references auth.users(id),
  add column if not exists aangemaakt_op   timestamptz default now();

-- Instantie-requirements: een nieuwe, instantie-scoped tabel naast de template-requirements.
-- (procedure_requirements blijft de TEMPLATE-bron; instantie-toevoegingen horen daar niet in.)
create table if not exists public.procedure_requirement_instance (
  id                uuid primary key default uuid_generate_v4(),
  decision_id       uuid not null references public.decision_objects(id) on delete cascade,
  stap_volgorde     int  not null,
  requirement_type  text not null,      -- zelfde enum als procedure_requirements
  label             text not null,
  documenttype      text,
  verplicht         boolean not null default true,
  blokkerend        boolean not null default false,
  min_aantal        int default 1,
  vereist_validatie_domein text,
  bron              text not null default 'handmatig' check (bron in ('handmatig')),
  actief            boolean not null default true,
  governance_event_id uuid references public.governance_events(id),
  aangemaakt_door   uuid references auth.users(id),
  aangemaakt_op     timestamptz default now(),
  fonds_id          uuid not null references public.fondsen(id)  -- tenant-scoping (RLS)
);
```

Soft-deactivate (`actief = false`) i.p.v. verwijderen — consistent met `decisions/0001/0024` (append-only; audit overleeft).

### 5.3 Readiness-consumptie

`fn_decision_readiness_check` en `buildEvidenceLijst` lezen voortaan de **unie** van:
- template-requirements (`procedure_requirements`, versie-gefilterd + classificatie-conditionals), en
- **actieve** instantie-requirements (`procedure_requirement_instance` waar `actief = true`).

Zonder deze unie bestaat een handmatig toegevoegde eis wel in beeld maar telt hij niet in de readiness — precies de val die het proceduremodule-ontwerp bij `external_submission`/`consultation` benoemt. Een regressietest borgt dit (§8).

### 5.4 Governance en RLS

- Toevoegen/deactiveren gegate op capability **beheerder of voorzitter** (vrijheidsniveau 2/3). Gewone rollen: read-only.
- Elke mutatie schrijft een `governance_event` (wie/wat/wanneer/motivering) en zet `governance_event_id`.
- Een **blokkerende** vereiste deactiveren kan alleen via de bestaande override-mechaniek **met verplichte motivering** (REQ-006); nooit stil.
- RLS: `procedure_requirement_instance` en de nieuwe kolommen vallen onder de fonds-RLS (`fonds_id` server-side afgeleid, nooit uit de request). De structurele gates moeten schoon draaien (policies/grants).

### 5.5 Per-proces uitsluiting van template-vereisten (overlay, v0.4)

Toevoegen (§5.2) en soft-deactivate dekken *handmatige* items. Een **template-vereiste** (generieke set in `procedure_requirements`, gesleuteld op `template_code`, gedeeld door álle fondsen en procedures) mag echter **niet** in-place worden verwijderd of gedeactiveerd: dat zou de gedeelde bron muteren. Verwijderen-per-proces gebeurt daarom als **overlay**, niet als mutatie.

```sql
create table if not exists public.procedure_requirement_uitsluiting (
  id                  uuid primary key default uuid_generate_v4(),
  decision_id         uuid not null references public.decision_objects(id) on delete cascade,
  fonds_id            uuid not null references public.fondsen(id),   -- tenant-scoping (RLS)
  stap_volgorde       int  not null,
  requirement_type    text not null,   -- zelfde enum-superset als procedure_requirements
  label               text not null,   -- weergave/audit
  match_sleutel       text not null,   -- coalesce(documenttype, label): identiteit van de template-vereiste
  reden               text not null,   -- verplichte toelichting (nooit stil)
  actief              boolean not null default true,
  governance_event_id uuid references public.governance_events(id),
  uitgesloten_door    uuid references auth.users(id),
  uitgesloten_op      timestamptz default now(),
  unique (decision_id, stap_volgorde, requirement_type, match_sleutel)
);
```

**Invariant: de generieke set blijft onaangeroerd.** `procedure_requirements` wordt bij een verwijdering nooit ge-UPDATE of -DELETE; de uitsluiting leeft uitsluitend per `decision_id` in de overlay. Een ander fonds of een nieuwe procedure op dezelfde template ziet de template-vereiste onverkort; heractiveren = `actief=false` op de overlay-rij.

**Readiness-consumptie (verfijnt §5.3).** `fn_decision_readiness_check` en `buildEvidenceLijst` lezen de UNION van (template-requirements **minus de actieve overlay-uitsluitingen voor deze `decision_id`**) plus de actieve instantie-requirements. De aftrek is een `NOT EXISTS` op `procedure_requirement_uitsluiting` (match op `decision_id`, `stap_volgorde`, `requirement_type`, en `match_sleutel = coalesce(documenttype, label)` — gelijk aan de unieke index van `procedure_requirements`), **alléén in de template-arm** (instantie-items kennen hun eigen `actief`-vlag).

**Governance en RLS** (spiegelt §5.4): uitsluiten gegate op **voorzitter/beheerder**; verplichte `reden`; elke mutatie schrijft één `governance_event` en zet `governance_event_id`; append-only (fonds-RLS + `WITH CHECK`, `fonds_id` server-side afgeleid). De readiness-functie herstelt na `create or replace` zijn grants (Gate H).

---

## 6. D8 — Fasebeschrijving als data, per fonds overschrijfbaar

**Verfijning t.o.v. §1.2 van het procesontwerp:** fasen zijn niet universeel I–VI (een incidentprocedure heeft andere fasen). Daarom worden fasen **onderdeel van de definitie**, met een generieke default in de gedeelde template en een fonds-override-laag.

```sql
create table if not exists public.procedure_template_fasen (
  id            uuid primary key default uuid_generate_v4(),
  template_id   uuid not null references public.procedure_templates(id) on delete cascade,
  fase_code     text not null,          -- bv. 'kaders','onderbouwing',... of 'I'..'VI'
  volgorde      int  not null,
  titel         text not null,
  generieke_beschrijving text,          -- gedeelde default (fonds-onafhankelijk)
  unique (template_id, fase_code)
);
alter table public.procedure_template_stappen
  add column if not exists fase_code text;   -- stap → fase

create table if not exists public.procedure_fase_beschrijving_override (
  id            uuid primary key default uuid_generate_v4(),
  template_code text not null,
  fase_code     text not null,
  fonds_id      uuid not null references public.fondsen(id) on delete cascade,
  beschrijving  text not null,
  aangepast_door uuid references auth.users(id),
  aangepast_op   timestamptz default now(),
  unique (template_code, fase_code, fonds_id)
);
```

Leeslogica (fail-safe): `beschrijving := coalesce(override[fonds, fase], template.generieke_beschrijving)`. Ontbreekt een override, dan de gedeelde default.

Governance: bewerken van een override via `POST /api/procedures/[id]/fase-beschrijving` (WO-3), server-side gegate op rol **voorzitter/beheerder** (de RLS-policies op `procedure_fase_beschrijving_override` zijn defense-in-depth); `template_code` en `fonds_id` worden server-side uit de procedure afgeleid, nooit uit de request. Leeg opslaan verwijdert de override → terugval op de generieke default. Append-only gelogd in **`procedure_log`** (`event_type: fase_beschrijving_bijgewerkt`). Een fasebeschrijving is **pure content** — wijzigen raakt stappen, checklist, bewijslast of activatie niet.

---

## 7. Engine-consumptie — wat wijzigt minimaal

1. **`procedure_start`**: naast de bestaande snapshot ook `blokkerende_afhankelijkheden` en `fase_code` meesnapshotten en de initiële stap-statussen zetten (§4.2). Fasen-defaults komen uit `procedure_template_fasen`.
2. **Stap-afronden**: vervang `activeerVolgendeStap()` door `herberekenActiveerbaarheid()`; zet `herbevestiging_nodig` op afhankelijke afgeronde stappen bij heropening.
3. **Readiness/vereisten**: union template + instantie-requirements (§5.3); mechaniek verder ongewijzigd.
4. **UI (Processen-detail)**: toont meerdere `actief`-stappen tegelijk (procesfasen-rail), de fasebeschrijving per fase, en de "toevoegen"-affordances voor checklist/bewijslast (zie mockup `MOCKUP-invaarprocedure-portaalstijl-v0.2.html`). `herbevestiging_nodig` als zichtbaar, niet-blokkerend signaal.

Het snapshot-pattern blijft heilig; lopende procedures veranderen niet mee met templatewijzigingen.

### 7.1 Afgeleide fase-status (UI, voor het totaaloverzicht)

Omdat er geen sequentiële cursor meer is (parallel-by-default), wordt "waar staat een fase / een procedure" **afgeleid** uit de onderliggende staat — niet uit volgorde. Deze afleiding is **UI-laag** (in de presentatielaag/RSC-server-render uit de data die §7 al levert — geen browser-only berekening, geen server-side aggregatie: die is OB-E5); ze introduceert geen nieuwe tabellen. De pure afleidingsfuncties leven in `core/lib/procedure-fase-status.ts` (sanity-getest). Visuele referentie: `MOCKUP-processen-overzicht-v0.1.html` (totaaloverzicht) en de detail-rail in `MOCKUP-invaarprocedure-portaalstijl-v0.2.html`.

**Fase-status** per fase F met stappen S_F (gebruikt `fase_code` + stap-`status` uit §4):
- **Afgerond** — alle stappen in S_F zijn `afgerond`.
- **Nog niet begonnen** — geen stap `afgerond` en geen stap `actief`/`heropend`.
- **In behandeling** — anders (begonnen maar niet af).

**Aandachtsvlag** (orthogonaal signaal, zegt niets over voortgang):
- **Rood** — een verplichte **blokkerende** vereiste in F is niet sluitend terwijl F in behandeling is, óf een tijdkritische termijn in F is overschreden.
- **Oranje** — een stap in F is `heropend`/`herbevestiging_nodig`, óf een verplichte (niet-blokkerende) vereiste ontbreekt, óf een termijn nadert (< drempel).

*Implementatienoot (WO-2):* het **rework-signaal** (`heropend`/`herbevestiging_nodig`) vuurt ongeacht de fase-status — ook op een afgeronde fase, want een heropening slaat juist vaak op een reeds afgeronde stap; anders zou de stip op de fasestrip en de tekst in de tellerregel uiteenlopen. De **bewijslast-condities** (rood/oranje) worden alleen op een fase *in behandeling* geëvalueerd: een nog niet begonnen fase heeft nog geen bewijslast en licht niet op.

**Bewijslast-dekking** per fase = # verplichte vereisten met status *volledig* ÷ # verplichte vereisten (template-actief + instantie-actief, §5.3), als percentage.

**Portfolio-aggregatie** (lijstpagina): *Lopend* = procedures in uitvoering · *Met aandacht* = ≥1 fase met aandachtsvlag · *Tijdkritisch* = ≥1 rode aandachtsvlag (zolang termijnen-als-data ontbreken telt dit de ontbrekende blokkerende bewijslast; de termijn-component volgt bij review O2) · *Besluitrijp* = readiness-niveau *besluitrijp* voldoet.

Kanttekeningen: de **termijn**-condities leunen op termijnen-als-data (review O2) — tot die er zijn, tonen de vlaggen alleen heropend/ontbrekende-bewijslast. De afleiding is deterministisch en fondsonafhankelijk; alleen de naderings-drempel is desgewenst instelbaar. Als de portfolio-aggregatie over veel procedures traag wordt, is een server-side helper een latere optimalisatie (geen blokker; OB-E5).

---

## 8. Validatie en tests (testklassen)

- **Schema-/DAG-validatie**: `blokkerende_afhankelijkheden` verwijzen naar bestaande stap-volgordes en vormen een DAG (geen cyclus); Zod + topologische check in CI en in de seed-importer.
- **Parallelle-start-test**: een definitie zonder afhankelijkheden activeert bij start **alle** stappen tegelijk; met een keten activeert alleen de kop.
- **Gate-test** (fixture-definitie mét een gate; de invaardefinitie heeft er bewust geen): een geblokkeerde stap blijft `geblokkeerd` tot al zijn afhankelijkheden `afgerond` zijn en wordt daarna automatisch `actief`.
- **Heropen-test**: heropenen van stap 5 zet stap 7 op `herbevestiging_nodig` zonder hem terug te zetten; audit toont beide versies.
- **Aanpasbaarheid-readiness-test**: een handmatig toegevoegde `actief` instantie-requirement telt mee in `fn_decision_readiness_check` én `buildEvidenceLijst`; na `actief = false` niet meer.
- **Governance-/RLS-test**: toevoegen/deactiveren zonder capability faalt (403/policy); elke mutatie schrijft exact één `governance_event`; blokkerende deactivatie vereist motivering.
- **Fonds-override-test**: ontbrekende override valt terug op de generieke default; een fonds ziet alleen zijn eigen override (RLS).
- **Snapshot-integriteit**: een nieuwe templateversie verandert een lopende procedure niet (regressie).

---

## 9. Migratiepad (increments → werkopdrachten)

Backwards-compatible en incrementeel, bewust in **twee** werkopdrachten gehouden — gesplitst langs de impactklasse-grens (data/security vs. alleen-UI). Beide starten in Plan-modus met subagents `supabase-rls-reviewer` + `audit-evidence-reviewer` + `ontwerp-sync-reviewer`.

| WO | Inhoud | Impactklasse | Kern-DoD |
|---|---|---|---|
| **WO-1 · Definitie + engine** | Canonieke definitie `pf_wtp_invaarbesluit@2.0.0.json` (géén blokkerende afhankelijkheden) + D6 (parallelle activatie + heropenen), D7 (`procedure_requirement_instance` + herkomst/soft-deactivate + readiness-unie + governance/RLS) en D8 (`procedure_template_fasen` + fonds-override) | data + tenant/security | alle testklassen (§8) groen; structurele gates schoon; documentatiehaak vuurt (00–09 + as-built) |
| **WO-2 · UI-consumptie** | Processen-detail (meerdere `actief`-stappen parallel, fasebeschrijving, toevoeg-affordances checklist/bewijslast, `herbevestiging_nodig`) **én het totaaloverzicht met afgeleide fase-status** (§7.1): fasestrip + aandachtsstip + readiness-horde + bewijslast-dekking, en per-fase status in de detail-rail | alleen UI | UX consistent met bestaande patronen; afleidingsregels §7.1 gevolgd; `HANDOVER.md`; leunt op WO-1 |

Volgorde: **WO-1 vóór WO-2** (de UI leunt op het nieuwe model). De definitie en de drie engine-uitbreidingen zitten bewust in één ticket omdat ze hetzelfde datamodel en dezelfde testklassen raken; verder opsplitsen levert alleen extra overdrachtskosten op zonder risicoreductie.

---

## 10. Open beslissingen en tradeoffs

**Open beslissingen**
1. **OB-E1 — Heropen-cascade.** Voorstel: niet-auto-terugzetten + `herbevestiging_nodig`-vlag (§4.3). Alternatief: harde terugzetting van afhankelijke stappen (afgewezen: cascade-churn, audit-ruis).
2. **OB-E2 — Instantie-requirements: aparte tabel vs. decision_id-kolom op een gesnapshotte requirements-tabel.** Voorstel: aparte `procedure_requirement_instance` (§5.2), omdat `procedure_requirements` bewust de template-bron blijft.
3. **OB-E3 — Fase-identiteit.** Voorstel: fasen per template (`procedure_template_fasen`) i.p.v. een universele I–VI-lijst; verfijnt §1.2 van het procesontwerp.
4. **OB-E4 — SPH-fondsvariant of gedeelde definitie?** Voorstel: SPH-fondsvariant voor de invaardefinitie (afwijkende opdrachtgever + FPR); de engine-uitbreidingen zijn generiek (gedeeld).
5. **OB-E5 — Afgeleide fase-status: UI of server-side?** Voorstel: **UI-afgeleid** (§7.1) in WO-2, uit de bestaande data. Een server-side aggregatiehelper is een latere optimalisatie als de portfolio-lijst over veel procedures traag wordt — geen blokker.

**Tradeoffs**
- Parallel-by-default vergroot de kans op "veel tegelijk actief" — mitigatie: de UI toont readiness per stap en `herbevestiging_nodig`, niet één lineaire cursor.
- Instantie-aanpasbaarheid verhoogt auditlast — mitigatie: verplichte governance-events + herkomstvlag maken elke afwijking traceerbaar.
- Extra tabellen raken de structurele gates/RLS — bewust in WO-3 gebundeld met de securityreview.

---

## 11. Wat dit document niet is

- Geen inhoudelijke invaardefinitie (dat is `pf_wtp_invaarbesluit@2.0.0.json`, WO-1).
- Geen wijziging aan de 17-status Decision Object-machine of de zes readiness-niveaus.
- Geen in-app template-editor (fase G proceduremodule; eigen ontwerp).
- Geen AI-controles/AI-validatie (bewust buiten scope in deze tranche).
- Geen resolutie van de compliance-openstaande punten O1–O5 uit de review — die horen in `00 Overzicht en status/openstaande-punten-en-risicos.md` mét eigenaar, niet in dit engine-ontwerp.

---

*Vervolg na akkoord: decision-records aanmaken voor D6/D7/D8 (`decisions/0174…`), WO-1 t/m WO-5 opstellen volgens `WERKOPDRACHT-TEMPLATE.md`, en de DDL-delta's (§4.1, §5.2, §6) verwerken in `09 Objectenmodel`. Terugkoppelen naar proceduremodule-ontwerp v0.2 (parallel-by-default) via `ontwerp-sync-reviewer`.*
