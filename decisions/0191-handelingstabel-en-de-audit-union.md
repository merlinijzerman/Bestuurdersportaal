# 0191 — De tenant-handelingstabel + de audit-union met gemeten assertie

**Datum:** 2026-08-26
**Status:** geratificeerd (schema/schrijfpad/retentie/RLS) · de migratie zelf volgt
**Vervolg op:** [0190](./0190-audit-doeltabel-en-de-gedeelde-resource-regel.md) · **blokkeert** `ENFORCE_AUDIT=on` en de echte `schrijfHandeling`-dep
**Raakt:** privacy/dataminimalisatie (gedragsdata) — input voor de privacyfunctie in `07 Compliance, privacy en juridisch`

---

## ⚠ AMENDEMENT 2026-08-26 (na ratificatie) — §4-model: de tenant-union krimpt naar TWEE waarden

Dit besluit landde met een **drie-waardenmodel** (`AuditSpec | "governance-events" | "geen"`, §6). Dat is teruggedraaid naar **twee waarden** (`AuditSpec | "geen"`). Zichtbaar geamendeerd i.p.v. stil bijgewerkt, want het draait een geratificeerd besluit terug.

**Waarom.** Het audit-veld moet een **instructie aan de wrapper** zijn ("schrijf een handelingsregel, of niet") — waar per constructie aan voldaan wordt — geen **bewering** over code elders (`"governance-events"` = "de route schrijft zelf `governance_events`"), die alleen klopt zolang die andere code hem waarmaakt. Twee gronden gaven de doorslag:

1. **De union stopt niet bij drie.** "Benoem het dekkende mechanisme" consequent doorgetrokken vraagt een waarde per mechanisme, en dat zijn er ≥10 (`governance_events`, `procedure_log`, `risico_log`, `agendapunt_log`, `vergadering_log`, `document_metadata_log`, `catalogus_log`, `fonds_config_log`, `fonds_stuurinfo_log`, `platform_event_log`). De 40 domein-handlers waren geen restpost maar het bewijs dat de union niet af was. §4's logica stopt wél: de wrapper schrijft, of niet.
2. **Het minimalisatie-argument draait óm.** Onder het drie-waardenmodel zijn juist de handelingen van een gekaapt bestuurdersaccount op de bestuurlijke routes **onzichtbaar** in `handelingen_log`. Een forensisch spoor met gaten op precies de gevoeligste handelingen is een slecht spoor. De extra rijen voor de 22 bestuurlijke handlers dienen dus het gestelde doel (§4) — dat is de AVG-motivering, sterker dan de uitzondering die het drie-waardenmodel nodig had.

**De 22 verliezen niets:** ze houden hun permanente `governance_events`-regel én krijgen een operationele 90-dagen-regel. Het retentieverschil is een eigenschap, geen ongeluk. **De machine-kant houdt `"platform-event-log"`** (typegrens, gemeten toets): daar kán de wrapper niet schrijven (geen `auth.uid()`/fonds), en waar handelen onmogelijk is, rest benoemen. **De bewijsketen-lacune** (de handlers die een `governance_events`-ketengebeurtenis missen) leeft nu in de inventaris-klasse `bestuurlijk-gap` + een fail-closed gate, niet in de union-waarde.

De hieronder staande §4 (doelzin) en §6 (union) zijn conform dit amendement herschreven.

---

## Aanleiding

Besluit 0190 koos voor een **eigen tenant-handelingstabel** zodat de wrapper-audit de bestuurlijke keten (`governance_events`) niet verdunt. Deze tabel legt gedrag van personen vast en vergt daarom bewuste keuzes vóór er één rij in staat. De split van de 36 no-spoor handlers (W11, machineleesbaar in `tests/karakterisering/audit-inventaris.json`, fail-closed getoetst) legde bovendien bloot dat een deel "geen spoor" alleen in *code* is — een groot deel wordt door **DB-triggers** geschreven, onzichtbaar voor code-tracing.

## 1. Schema `handelingen_log` — minimaal (dataminimalisatie)

| kolom | herkomst | reden |
|---|---|---|
| `id uuid pk` | gen | — |
| `fonds_id uuid not null` | **server-side uit `auth.uid()`** | tenant-sleutel, RLS |
| `gebruiker_id uuid not null` | **server-side uit `auth.uid()`** | wie |
| `handeling text not null` | `AuditSpec.handeling` | semantisch label |
| `methode text not null` | request | POST/PATCH/PUT/DELETE |
| `pad text not null` | `padVan(request)` | **alleen het pad, nooit de querystring** |
| `status int not null` | respons | uitkomst |
| `request_id uuid not null` | ctx | correlatie met de logregels |
| `tijdstip timestamptz not null default now()` | db | wanneer |

Bewust NIET: request-/response-body, e-mail, naam, IP, user-agent.

> **De kolom `pad` draagt identifiers — eigen motiveringsregel.** `/api/documents/<uuid>/bestand` + `gebruiker_id` + `tijdstip` reconstrueert wie welk bestuursstuk opende. Dat is leesgedrag van bestuurders, gevoeliger dan "wie wijzigde een status". Het is waarschijnlijk nodig voor forensiek, maar het komt hier **bewust** binnen, niet als bijvangst van "we loggen het pad". (De wrapper stript de querystring al; `handelingen_log` krijgt uitsluitend state-changing handlers, geen GET-leespaden.)

## 2. Schrijfpad — SECURITY DEFINER-RPC, niet de wrapper-ctx

`fn_schrijf_handeling(p_handeling, p_methode, p_pad, p_status, p_request_id)` als **SECURITY DEFINER**, die `fonds_id`/`gebruiker_id` **zelf uit `auth.uid()` afleidt** — net als `schrijf_ai_interactie` sinds plateau A. De wrapper geeft dus géén fonds/gebruiker mee (defense-in-depth: een gecompromitteerde ctx kan de bron niet vervalsen). Grantregime (H-18): `revoke all on function … from public, anon`, gericht `grant execute to authenticated`; regel in `supabase/checks/allowlist-grants.tsv` (V3-gate). De wrapper-`schrijfHandeling`-dep belt deze RPC; de huidige throw-stub vervalt zodra dit landt.

## 3. Append-only

`UPDATE`/`DELETE` door triggers geblokkeerd (guardrail "de `*_log`-tabellen worden nooit ge-UPDATE of -DELETE"). `TRUNCATE` nooit aan `anon`/`authenticated`. Retentie-snoei (zie §4) uitsluitend via een service-role-baan.

## 4. Doel (één zin) en retentie, daaruit afgeleid

> **`handelingen_log` legt élke te-auditen state-changing tenant-handeling vast (wie, welke handeling, welke route, welke uitkomst, wanneer) zodat een beveiligings- of misbruikincident forensisch te reconstrueren is — óók de bestuurlijke handelingen, want juist die zijn het doelwit van een accountovername. Het semantische *besluit*record blijft in `governance_events` (permanent); `handelingen_log` is het forensische *gedrag*record (90 dagen). Twee tabellen, twee vragen — geen dubbeling, en niet bedoeld om gedrag te monitoren.**
>
> *(§4-model, amendement 2026-08-26 — voorheen "operationele, niet-bestuurlijke".)*

**Retentie: 90 dagen.** Het doel is operationele forensiek; de lang-te-bewaren bestuurlijke feiten verhuizen per de split naar `governance_events` (permanent). Een termijn die niet uit een doel volgt, houdt onder de AVG geen stand — 90 dagen (gelijk aan `app_errors`, [0104](./0104-retentie-app-errors-en-snapshots-geen-auditspoor.md)) volgt uit dit doel. Snoei via service-role-baan.

## 5. Leesrecht (RLS)

- RLS aan; `fonds_id`-isolatie zoals overal.
- **Binnen** een fonds: nieuwe **tenant**-capability `handelingen.lezen`, toegekend aan **bureau/beheer**, **niet** aan `bestuurder`/`voorzitter` (voorkomt dat de log een onderling-toezicht-instrument wordt). **Niet** aan `observability.read` hangen: dat is een **platform**-capability — dan lezen platformmedewerkers tenant-gedragsdata, een grótere blootstelling.
- `anon`: geen recht.
- **Eigen inzage (AVG-inzagerecht):** het recht bestaat sowieso; de keuze is de vórm. **Via een verzoekprocedure, geen selfservicescherm** — een scherm creëert juist het onderling-toezichtrisico. De verplichting staat vast in dit besluit; het scherm wordt niet gebouwd.

## 6. De audit-union — twee waarden (§4-model, amendement 2026-08-26)

**Tenant: `audit: AuditSpec | "geen"`.** Machine: `"platform-event-log" | "geen"` (typegrens, 0190 corollarium C).

- `AuditSpec{handeling}` → wrapper schrijft `handelingen_log`. **Élke** te-auditen tenant-handler, óók de bestuurlijke.
- `"geen"` → aantoonbaar niets, per stuk gemotiveerd (bv. read-achtige POST, AI-concept).

Het veld is een **instructie**, geen bewering: de wrapper voert hem uit, dus hij is waar per constructie. De verwijderde derde waarde `"governance-events"` was een bewering over code elders (zie het amendement bovenaan).

> **De machine-kant houdt de gemeten toets.** `"platform-event-log"` is nog steeds een benoeming van een spoor dat elders wordt geschreven, dus de assertie in `audit-inventaris.mjs` (fail-closed, incl. DB-trigger-laag) toetst dat een `"platform-event-log"`-declaratie ook **echt** naar `platform_event_log` schrijft. `audit-inventaris.sanity.ts` borgt dit met een proven-red. **De bewijsketen-lacune** (bestuurlijk-gap-handlers zonder `governance_events`-ketengebeurtenis) heeft een **eigen** fail-closed gate — rood zolang die write ontbreekt — niet een union-waarde. In #183 draait de regenerate-en-vergelijk vóór de merge.

## 7. Consequenties voor #183

- De **11 bestuurlijk-gap-handlers** (agenderen · POST-stemmingen/stemmen/intrekken · vergaderingen · notulen-bevestig/segment-delete · inbreng POST/DELETE · organisatieprofiel · documents-status) missen vandaag hun `governance_events`-**ketengebeurtenis**. Onder het §4-model dragen ze — als élke te-auditen handler — gewoon `audit: AuditSpec` (`handelingen_log`); de ontbrekende `governance_events`-write is een **aparte, gedragsveranderende taak (#183b)**. Een **fail-closed gate** is rood zolang een `bestuurlijk-gap`-handler zijn `governance_events`-write mist — niet als waarschuwing, rood. Zo sluit het model I-6 niet op papier terwijl het ketengat openstaat.
- **CORRECTIE op een eerdere telling (was 15).** Vier handlers die als "bestuurlijk-gap" stonden hébben wél een spoor — `procedure_log`, geschreven door `trg_procedure_bewijs_audit` (fail-closed) bij elke mutatie op `procedure_bewijs`. De meting miste die trigger; `BASE_TRIGGER` kent `procedure_bewijs` nu, en de anti-drift-test bewaakt hem. Het waren geen 3 maar 4: naast de drie `procedures/[id]/bewijs`-handlers INSERT'et óók `stemmingen/[id]/sluiten` zelf een `procedure_bewijs`-regel.
  - **BESLUIT (de 3 bewijs-handlers):** voor een bestuurlijk feit met een fail-closed domeinspoor dat óók de feitenkaart voedt, **volstaat `procedure_log`** — geen route-eigen `governance_events`-write erbovenop (die zou het spoor dupliceren, directe PostgREST-writes níet dekken, en de keten verdunnen). Klasse: `domein`.
  - **BESLUIT (`stemmingen/[id]/sluiten`) — eigenaar:** dit is een **ketengebeurtenis** (een stemming sluiten), niet enkel bewijsbeheer. **Er komt een `governance_events`-event bovenop het `procedure_log`-spoor** (#183b voegt de route-eigen write toe; het `procedure_log`-spoor met `stemming_id`-FK blijft — beide, geen vervanging). Het audit-veld is en blijft `AuditSpec` (`handelingen_log`), net als elke te-auditen handler; `sluiten` telt bovendien mee in de bewijsketen-gap-gate (markering `ketengebeurtenis_vereist`) tot zijn `governance_events`-write bestaat. Zo landen we op **12** handlers die een `governance_events`-write nodig hebben (11 bestuurlijk-gap + `sluiten`); de 3 `procedure_bewijs`-handlers niet (procedure_log volstaat).
- Census in de W11-scope, gecorrigeerd: **22 bewijsketen · 62 enig spoor · 32 geen** (klasse: bewijsketen 22 · domein 40 · bestuurlijk-gap 11 · operationeel 8 · geen 7 · machine 6). Eerder 22 · 58 · 36; daarvoor 22 · 34 · 38.
- **`documents/[id]/her-extract` en `opnieuw-verwerken` = operationeel, gebonden aan huidig pijplijngedrag:** zodra een herverwerking kan bepalen wélke inhoud als gezaghebbend wordt geserveerd, verschuift hij naar bestuurlijk. #183 stelt vast of her-extractie bij mislukking terugvalt op een oudere extractie.
- **VLAGKOPPELING (voorwaarde 5b):** na #183a dragen de 12 `ketengebeurtenis_vereist`-handlers een `AuditSpec` en schrijven ze een `handelingen_log`-regel — ze *lezen* dan als geaudit terwijl hun `governance_events`-ketengebeurtenis nog ontbreekt (het model oogt compleet met de bevinding eronder). De gate rood maken in #183a kan niet (dan mergt #183a niet), dus de koppeling ligt aan de **vlag**: **`ENFORCE_AUDIT=on` is pas toegestaan als de bewijsketen-gap-gate groen is** (alle 12 hebben hun `governance_events`-write). Door #197 is de vlagstand meetbaar via `healthz`, dus "mag deze vlag aan?" is een controle, geen herinnering — precies wat bij `ENFORCE_SCHEMA`/fase-1 van [0189](./0189-tweefasen-model-enforce-vlaggen.md) misging. Leg de voorwaarde vast bij de vlagflip in 0189; een `OMGEVINGEN-RUNBOOK.md` bestaat nog niet, dus dat is óók een openstaand punt (niet stil overslaan).

## 8. Input voor de privacyfunctie (verwerkingsregister / DPIA — geen codebesluit)

Concept-regel, ter beoordeling — niet het register zelf:

> *Verwerking: forensische handelingslog (`handelingen_log`). Doel: reconstructie van beveiligings-/misbruikincidenten. Categorieën betrokkenen: bestuurders/bureau van een fonds. Gegevens: gebruiker-id, fonds-id, route-pad, methode, uitkomst, tijdstip (geen inhoud). Bewaartermijn: 90 dagen. Toegang: bureau/beheer (`handelingen.lezen`); inzage betrokkene op verzoek. Grondslag/afweging: gerechtvaardigd belang (beveiliging), afgewogen tegen dataminimalisatie.*

> **⚠ DELTA door het §4-amendement (openstaand punt, eigenaar: privacyfunctie).** Onder het §4-model logt `handelingen_log` **élke** te-auditen state-changing handeling — óók de **bestuurlijke** (stemmen, agenderen, besluit-mutaties), die onder het drie-waardenmodel buiten deze tabel zouden vallen. Dat is een **verruiming** van de verwerking: de motivering is dat een gekaapt bestuurdersaccount juist op de bestuurlijke routes toeslaat, dus een forensisch spoor met gaten daar is waardeloos (zie het amendement §4). Deze verruiming hoort **expliciet in de DPIA-afweging**, niet als bijvangst van een codemod. Loop daarbij ook `pad` nog eens na op objectidentificatoren voor handlers waar dat nieuw is (§1).

Meegeven: **"systematische monitoring" is een DPIA-triggercriterium**; of dat hier geldt bij enkele bestuurders per fonds, beoordeelt de privacyfunctie.
