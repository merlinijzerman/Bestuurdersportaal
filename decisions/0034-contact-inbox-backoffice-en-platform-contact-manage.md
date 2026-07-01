# 0034 — Contact-inbox in de platform-back-office + capability `platform.contact.manage`

- **Status:** Geaccepteerd
- **Datum:** 2026-06-30
- **Betrokkenen:** Merlin (besluit), Claude (uitvoering)
- **Vervolg op:** [0031](./0031-contact-aanvragen-opslag-en-email.md) (sloot het leeskant/opvolging expliciet af als "fase 2 — open: welke rol leesrechten krijgt")

## Context

Besluit 0031 legde `contact_aanvragen` vast als niet-tenant tabel: RLS aan, geen anon/authenticated-policy, insert uitsluitend via de service-role (publieke `/api/contact`), append-only (opvolging via `status`, geen hard-delete). Het **leeskant en de opvolging** zijn daar bewust uitgesteld met één openstaande vraag: *welke rol mag de inbox inzien en de status wijzigen?*

De inbox is **niet tenant-gebonden** (een aanvrager heeft geen `fonds_id`, is geen ingelogde gebruiker). Hem in tenant-beheer plaatsen zou cross-tenant data in een fonds-surface trekken — een isolatielek. De natuurlijke plek is de **platform-back-office** (Increment P, achter de `(beveiligd)`-gate: platform-identiteit + AAL2, geen `profielen`-rij, 3b-blokkade).

## Besluit

- **Nieuwe capability `platform.contact.manage`** — "Publieke contact-inbox inzien en opvolgen (niet-tenant)". Toegevoegd aan de `PlatformCapability`-union, aan `PLATFORM_CAPABILITIES` (telling 11 → **12**) en aan het functieprofiel `platform_support_viewer` (de inbox is operationeel support-werk, geen security-/auditprivilege).
- **Niet-zwaar.** Bewust **niet** in `ZWARE_CAPABILITIES`: de capability geeft inzage/statusopvolging op één publieke inbox en kan **geen privileges escaleren** (geen grant/identiteits-/fondsbeheer). Daarmee is hij via de rechten-UI toekenbaar/intrekbaar zonder vier-ogen, en `vier_ogen_door` mag NULL.
- **Nieuwe back-office-module `/platform/contact`** (server component, `force-dynamic`), gegate op `platform.contact.manage`:
  - **Leeskant via de service-role-client** (`createPlatformSupabase`) — `contact_aanvragen` is deny-by-default voor de anon-key (FO REQ-PV-042). Dit is read-only **inzicht**, geen businessmutatie; identiek precedent als `rechten/page.tsx` en `lib/platform-auth.ts`.
  - **Mutatie (statuswijziging) uitsluitend via een server-action** (`acties.ts`) achter `withPlatform` (`capability: "platform.contact.manage"`, `handeling: "platform.contact.status_wijzigen"`). Append-only geaudit (attempt+result), zet `opgevolgd_door` + `afgehandeld_op`. Geen DELETE — de no-delete-trigger uit 0031 blijft leidend; opvolging is `nieuw → in_behandeling → afgehandeld`.
- **Migratie `2026_06_30_contact_beheer.sql`** seedt alleen de capability-rij in `platform_capabilities` (idempotent, `on conflict do nothing`); rollback `…_ROLLBACK.sql` trekt grants append-only in en verwijdert de seed (incl. note om de code-telling terug naar 11 te zetten).
- **Eerste grant via systeem-bootstrap** (`scripts/platform_contact_toekennen.sql`): met één platformbeheerder is er nog geen tweede toekenner, en `chk_pic_geen_self_grant` verbiedt zelf-toekenning. Daarom dezelfde niet-inlogbare systeem-identiteit (`00000000-…-0000000000b0`) als herkomststempel als in INTENT A van `platform_rechten_toekennen.sql`. Dit omzeilt bewust de vier-ogen-conventie **alleen voor de eerste setup**; vervolg-grants via de rechten-UI zodra er een tweede bevoegde toekenner is.

## Overwogen alternatieven

- **Inbox in tenant-beheer** — verworpen: trekt niet-tenant data in een fonds-surface (cross-tenant-lek).
- **Hergebruik van een bestaande zware capability** (bv. `platform.support.operate`) — verworpen: te grof; koppelt inbox-inzage aan break-glass-niveau en schendt least-privilege.
- **`platform.contact.manage` als zware capability** — verworpen: geen escalatierisico; vier-ogen zou de toekenning onnodig blokkeren bij één beheerder.
- **Leeskant via anon-key met een read-policy** — verworpen: opent een leespad op de publieke tabel; service-role-read houdt 0031/FO REQ-PV-042 intact.

## Gevolgen

- **Parity code ↔ seed:** de sanity-test (`lib/platform-capabilities.sanity.ts`, TO §12 test 17) telt nu 12 en bevat `platform.contact.manage` in `SEED_IN_MIGRATIE`. Telling, union-`Set.size` en migratie-seed moeten in de pas blijven; de migratie is daarom een harde voorwaarde vóór de grant (FK op `platform_capabilities`).
- **Volgorde van uitrol:** (1) migratie `2026_06_30_contact_beheer.sql`, (2) bootstrap-grant-script, (3) code-deploy. De grant faalt zonder de seed-rij.
- **Open punt — privacy/retentie:** inzendingen kunnen persoonsgegevens bevatten. Retentie/opschoning van `contact_aanvragen` is nog niet belegd (sluit aan bij het bredere retentie-`[Open]` B14-3, TO §13). **Werkhypothese, te valideren:** behandelen conform de privacyverklaring, retentietermijn nader te bepalen.
- **TO/FO-naslag:** de capability-union in het Increment-P technisch ontwerp (§4.1) is bijgewerkt naar 12; FO §5.4 (functieprofielen) volgt bij de eerstvolgende FO-revisie.

## Referenties

- decisions/[0031](./0031-contact-aanvragen-opslag-en-email.md) (opslag + e-mail), [0001](./0001-append-only-audit-geen-harddelete.md) (append-only), [0021](./0021-platformfundament-P0-keuzes.md) (3b-auth + fail-closed audit), [0026](./0026-p2-light-p4-light-en-vier-ogen-deferral.md) (vier-ogen-deferral)
- `lib/platform-capabilities.ts`, `lib/platform-capabilities.sanity.ts`
- `app/(platform)/platform/(beveiligd)/contact/` (page, `_components/ContactInboxClient.tsx`, `acties.ts`)
- `supabase/migrations/2026_06_30_contact_beheer.sql` (+ ROLLBACK), `scripts/platform_contact_toekennen.sql`
- `04 …/Increment P platform back-office technisch ontwerp v1.1.md` §4.1, §5.1
- FO REQ-PV-042 (deny-by-default lees), Platform-beheermodule Increment P FO §5.4
