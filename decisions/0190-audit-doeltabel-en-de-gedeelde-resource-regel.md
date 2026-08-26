# 0190 — Audit-doeltabel (eigen handelingstabel) én de gedeelde-resource-regel voor uitzonderingswaarden

**Datum:** 2026-08-26
**Status:** geratificeerd
**Context:** EPIC W (#91), deploy 3 — W10 `rateLimit` (#187) en W11 `audit` (#188). Twee besluiten die bij elkaar horen: het eerste bepaalt de vorm van het W11-mechanisme, het tweede is de algemene regel die verklaart *waarom* W10 een uitzonderingswaarde nodig heeft en W11 (onder besluit 1) niet.

---

## Besluit 1 — de wrapper-audit schrijft naar een eigen handelingstabel, niet naar `governance_events`

De W11-auditinventaris (op `feat/w11-audit`) legde de bewijsketen bloot: `governance_events` (37 schrijfplekken) draagt **betekenisvolle bestuurlijke gebeurtenissen** — besluit genomen, dissent vastgelegd. Publiek: bestuur, accountant, toezichthouder. Een wrapper-regel is per definitie generiek ("PATCH /api/x door gebruiker y"; publiek: forensisch onderzoek). Zeventig generieke regels per dag in `governance_events` schuiven **verdunt de bestuurlijke keten met HTTP-ruis** — slechter dan geen regel, want het maakt het dossier onleesbaar op precies de plek waar leesbaarheid de waarde is.

**Besluit:** de wrapper schrijft naar een **eigen tenant-handelingstabel**; `governance_events` blijft uitsluitend bestuurlijk. Afgewezen: (a) schrijven naar `governance_events` (verdunning); (c) per route configureerbaar (herintroduceert variantie — de terugkerende vijand van het W-spoor).

Gevolgen:
- W11 raakt de bewijsketen **niet** aan. Het dubbele-registratieprobleem is bij de wortel opgelost i.p.v. met een uitzonderingswaarde.
- Invariant **I-6** ("iedere state-changing operatie laat een auditspoor") krijgt een eigen, complete keten; de **38 handlers zonder spoor** uit de inventaris zijn precies de I-6-lacune die deze tabel dicht.
- De handelingstabel is **tenant-only** (`withFondsRoute`); de 6 machinehandlers houden `platform_event_log` (zie besluit 2, corollarium C).
- **Nieuwe kost:** de handelingstabel is persoonsgegeven (wie deed welke mutatie, wanneer). Vereist een **retentie- + RLS-besluit** vóór `audit-enforce.ts` — leesrecht forensisch/bureau, niet bestuur. Aansluiten op de precedent van [besluit 0104](./0104-retentie-app-errors-en-snapshots-geen-auditspoor.md).

---

## Besluit 2 — de gedeelde-resource-regel: wanneer een uitzonderingswaarde nodig is

Algemene regel voor élk `RouteSpec`-veld, niet alleen W10:

> Een uitzonderingswaarde (`"route-eigen"`) bestaat dan en slechts dan als de wrapper-actie en de route-actie botsen op een **gedeelde resource**. Botsen ze niet, dan is de uitzonderingswaarde ruis en vergroot hij alleen het aantal varianten. Waar een handler door een **ánder mechanisme** is gedekt, benoem dat mechanisme in de waarde — noem het geen `"geen"`.

Daarmee is er een **toets** voor elk toekomstig spec-veld, in plaats van per veld opnieuw de discussie. Toegepast:

| Veld | Gedeelde resource? | Uitkomst |
|---|---|---|
| `rateLimit` (W10) | **Ja** — wrapper én route bellen dezelfde `fn_rate_limit_check` op dezelfde endpoint-sleutel; twee tellingen per request op één teller | `"route-eigen"` **nodig** |
| `audit` (W11) onder besluit 1 | **Nee** — wrapper schrijft een eigen handelingstabel, route schrijft `governance_events`/domeinlog | `"route-eigen"` **overbodig** |
| `audit` onder de afgewezen optie a | Ja — zelfde tabel | zou `"route-eigen"` nodig hebben (extra argument voor besluit 1) |

### Corollarium A — `"route-eigen"` geldt per **limietsleutel**, niet per route (W10)

Gemeten op `origin/preview`: 16 inline-adopters, drie sleutels gedeeld:

    LIMIETEN.backfill    → classificatie/backfill · documents/embeddings-backfill · documents/reindex-backfill
    LIMIETEN.her_extract → documents/[id]/her-extract · documents/[id]/opnieuw-verwerken

De teller zit op de **endpoint-sleutel**, niet op de route. Krijgt `classificatie/backfill` een `"route-eigen"` en `documents/reindex-backfill` een `rateLimit: "backfill"`, dan tikken requests op de tweede **dubbel** op een teller die de eerste enkel optikt — een gemengde toestand die erger is dan beide zuivere varianten, want het budget loopt sneller vol dan iemand kan verklaren en het verschil zit in welke route je toevallig aanroept.

**Regel voor #183:** de keuze `"route-eigen"` vs `LimietNaam` wordt **per limietsleutel** genomen; alle routes die die sleutel delen krijgen dezelfde waarde. **Assertie in de classifier:** twee routes met dezelfde sleutel en verschillende declaratie is rood.

### Corollarium B — tellen-in-observe (W10, §4 van het ticket)

- **Wél tellen** voor gedeclareerde `LimietNaam`-routes: die hadden geen teller, meten is de enige manier om "zou de grens geraakt zijn" te weten, en de teller-write is niet gebruikerszichtbaar.
- **Nooit tellen** voor `"route-eigen"` (de route telt zelf) of `"geen"`.

De harnas-tellerreset tussen scenario's blijft los daarvan nodig voor de **vlag-aan**-pass (anders meet die de testvolgorde).

### Corollarium C — de typegrens op `MachineSpecV1`, en de asymmetrie rateLimit↔audit

Constraint 1 van W10 (`fn_rate_limit_check` werpt `28000` bij null `auth.uid()`) wordt een **typegrens**, geen runtime-assertie: `withFondsRoute` heeft altijd een user tegen de tijd dat de poort draait, dus alleen `withMachineRoute` mist er een.

- `MachineSpecV1.rateLimit: "geen"` — één toegestane literal. Hier is `"geen"` **eerlijk**: machineroutes hébben geen limiet.
- `MachineSpecV1.audit: "platform-event-log"` — één toegestane literal die het **dekkende mechanisme benoemt**. Hier zou `"geen"` een **onwaarheid** zijn: de 6 machinehandlers schrijven al `platform_event_log`. Conform besluit 2 ("benoem het mechanisme, noem het geen `"geen"`") — en zonder een derde unionlid aan de tenantkant: `"geen"` houdt daar één betekenis, de tenant-union blijft twee waarden.

Dat is de asymmetrie: dezelfde typegrens-techniek, tegengestelde literal, omdat de onderliggende werkelijkheid verschilt.

---

## Volgorde van uitvoering

1. Dit besluit (b + de gedeelde-resource-regel) — vastgelegd. ✅
2. `feat/w10-ratelimit` — mechanisme, met `"route-eigen"` per corollarium A.
3. Het W11-mechanisme daarna — met de typegrens uit corollarium C en de eigen handelingstabel uit besluit 1.
