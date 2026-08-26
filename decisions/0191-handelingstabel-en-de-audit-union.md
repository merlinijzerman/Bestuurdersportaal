# 0191 — De tenant-handelingstabel + de audit-union met gemeten assertie

**Datum:** 2026-08-26
**Status:** geratificeerd (schema/schrijfpad/retentie/RLS) · de migratie zelf volgt
**Vervolg op:** [0190](./0190-audit-doeltabel-en-de-gedeelde-resource-regel.md) · **blokkeert** `ENFORCE_AUDIT=on` en de echte `schrijfHandeling`-dep
**Raakt:** privacy/dataminimalisatie (gedragsdata) — input voor de privacyfunctie in `07 Compliance, privacy en juridisch`

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

> **`handelingen_log` legt operationele, niet-bestuurlijke state-changing handelingen vast (wie, welke handeling, welke route, welke uitkomst, wanneer) zodat een beveiligings- of misbruikincident forensisch te reconstrueren is — niet om bestuurlijke feiten te bewaren (die staan in `governance_events`) en niet om gedrag te monitoren.**

**Retentie: 90 dagen.** Het doel is operationele forensiek; de lang-te-bewaren bestuurlijke feiten verhuizen per de split naar `governance_events` (permanent). Een termijn die niet uit een doel volgt, houdt onder de AVG geen stand — 90 dagen (gelijk aan `app_errors`, [0104](./0104-retentie-app-errors-en-snapshots-geen-auditspoor.md)) volgt uit dit doel. Snoei via service-role-baan.

## 5. Leesrecht (RLS)

- RLS aan; `fonds_id`-isolatie zoals overal.
- **Binnen** een fonds: nieuwe **tenant**-capability `handelingen.lezen`, toegekend aan **bureau/beheer**, **niet** aan `bestuurder`/`voorzitter` (voorkomt dat de log een onderling-toezicht-instrument wordt). **Niet** aan `observability.read` hangen: dat is een **platform**-capability — dan lezen platformmedewerkers tenant-gedragsdata, een grótere blootstelling.
- `anon`: geen recht.
- **Eigen inzage (AVG-inzagerecht):** het recht bestaat sowieso; de keuze is de vórm. **Via een verzoekprocedure, geen selfservicescherm** — een scherm creëert juist het onderling-toezichtrisico. De verplichting staat vast in dit besluit; het scherm wordt niet gebouwd.

## 6. De audit-union — drie waarden, gemeten niet beweerd

Tenant: `audit: AuditSpec | "governance-events" | "geen"`. Machine: `"platform-event-log" | "geen"` (typegrens, 0190 corollarium C).

- `AuditSpec{handeling}` → wrapper schrijft `handelingen_log`.
- `"governance-events"` → de route schrijft zélf `governance_events`; de wrapper doet niets. **Benoemt het dekkende mechanisme** (0190-regel), net als `"platform-event-log"` op de machine-kant. Géén botsing op een gedeelde resource, dus geen `"route-eigen"` nodig.
- `"geen"` → aantoonbaar niets.

> **De derde waarde is een zelfverklaarde vrijstelling van auditlogging — de gevaarlijkste ontsnappingswaarde. Daarom GEMETEN, niet beweerd.** De assertie in `audit-inventaris.mjs` (fail-closed, geen waarschuwingsmodus) toetst dat een `"governance-events"`/`"platform-event-log"`-declaratie de genoemde tabel ook **echt** schrijft — **inclusief de DB-trigger-laag** (`fn_fonds_config_capture` / `fn_fonds_stuurinfo_capture`), zodat een door een trigger gedekte handler niet ten onrechte als "geen spoor" wordt afgekeurd. `audit-inventaris.sanity.ts` borgt dit met een proven-red en een anti-drift-test tegen de migraties. In #183 draait de regenerate-en-vergelijk vóór de merge.

## 7. Consequenties voor #183

- De **11 bestuurlijk-gap-handlers** (agenderen · POST-stemmingen/stemmen/intrekken · vergaderingen · notulen-bevestig/segment-delete · inbreng POST/DELETE · organisatieprofiel · documents-status) hebben vandaag **geen enkel spoor**. #183 voegt de route-eigen `governance_events`-write toe; **`audit: "governance-events"` mag pas daarná** (de assertie is fail-closed vanaf dag één).
- **CORRECTIE op een eerdere telling (was 15).** Vier handlers die als "bestuurlijk-gap" stonden hébben wél een spoor — `procedure_log`, geschreven door `trg_procedure_bewijs_audit` (fail-closed) bij elke mutatie op `procedure_bewijs`. De meting miste die trigger; `BASE_TRIGGER` kent `procedure_bewijs` nu, en de anti-drift-test bewaakt hem. Het waren geen 3 maar 4: naast de drie `procedures/[id]/bewijs`-handlers INSERT'et óók `stemmingen/[id]/sluiten` zelf een `procedure_bewijs`-regel.
  - **BESLUIT (de 3 bewijs-handlers):** voor een bestuurlijk feit met een fail-closed domeinspoor dat óók de feitenkaart voedt, **volstaat `procedure_log`** — geen route-eigen `governance_events`-write erbovenop (die zou het spoor dupliceren, directe PostgREST-writes níet dekken, en de keten verdunnen). Klasse: `domein`.
  - **BESLUIT (`stemmingen/[id]/sluiten`) — eigenaar:** dit is een **ketengebeurtenis** (een stemming sluiten), niet enkel bewijsbeheer. **Er komt een `governance_events`-event bovenop het `procedure_log`-spoor:** #183 voegt de route-eigen `governance_events`-write toe, waarna de klasse `bewijsketen` wordt en `audit: "governance-events"` is toegestaan (de assertie eist dan de gemeten write). Tot die write landt is de klasse `domein` (feitelijk correct: er ís een spoor). Het `procedure_log`-spoor (met `stemming_id`-FK) blijft — beide dus, geen vervanging.
- Census in de W11-scope, gecorrigeerd: **22 bewijsketen · 62 enig spoor · 32 geen** (klasse: bewijsketen 22 · domein 40 · bestuurlijk-gap 11 · operationeel 8 · geen 7 · machine 6). Eerder 22 · 58 · 36; daarvoor 22 · 34 · 38.
- **`documents/[id]/her-extract` en `opnieuw-verwerken` = operationeel, gebonden aan huidig pijplijngedrag:** zodra een herverwerking kan bepalen wélke inhoud als gezaghebbend wordt geserveerd, verschuift hij naar bestuurlijk. #183 stelt vast of her-extractie bij mislukking terugvalt op een oudere extractie.

## 8. Input voor de privacyfunctie (verwerkingsregister / DPIA — geen codebesluit)

Concept-regel, ter beoordeling — niet het register zelf:

> *Verwerking: forensische handelingslog (`handelingen_log`). Doel: reconstructie van beveiligings-/misbruikincidenten. Categorieën betrokkenen: bestuurders/bureau van een fonds. Gegevens: gebruiker-id, fonds-id, route-pad, methode, uitkomst, tijdstip (geen inhoud). Bewaartermijn: 90 dagen. Toegang: bureau/beheer (`handelingen.lezen`); inzage betrokkene op verzoek. Grondslag/afweging: gerechtvaardigd belang (beveiliging), afgewogen tegen dataminimalisatie.*

Meegeven: **"systematische monitoring" is een DPIA-triggercriterium**; of dat hier geldt bij enkele bestuurders per fonds, beoordeelt de privacyfunctie.
