# 0039 — Organisatieprofiel: tenant-zelfservice door de fonds-beheerder

- **Status:** Geaccepteerd
- **Datum:** 2026-07-07
- **Betrokkenen:** Merlin (akkoord), Claude (uitvoering)

## Context

Besluit 0038 legde vast dat het organisatieprofiel uitsluitend server-side via de
platform-back-office (service-role, OP-5) bewerkbaar zou zijn; RLS had alleen een
SELECT-policy op het eigen fonds, géén write-policy. Bij het in gebruik nemen
bleek die platform-autorisatie (aparte platform-surface, capability + live-MFA +
twee-fasen-audit) **disproportioneel zwaar** om een fonds z'n eigen, bestuurlijk-
lichte contextprofiel te laten invullen. De praktische wens: het fonds vult dit
zelf in vanuit het portaal, zonder platformrol.

Randvoorwaarden: het huispatroon **RLS = fonds-isolatie, code = rolgate**
(`lib/capabilities.ts`), migratie-eerst-dan-deploy, en geen verzwakking van de
tenant-isolatie.

## Besluit

1. **Tenant-zelfservice, beheerder-gated.** Het organisatieprofiel is fonds-breed
   (1-op-1 met `fondsen`), dus géén strikt zelfbeheer zoals het persoonlijke
   profiel (0017), maar beheerder-beheer analoog aan de catalogus
   (`catalog.manage`). Nieuwe capability `organisation.profile.manage`, toegekend
   aan **alleen** rol `beheerder`. Alle andere rollen zien de tab **read-only**.
2. **RLS krijgt eigen-fonds INSERT/UPDATE-policies** (migratie
   `2026_07_07_organisatieprofiel_tenant_write.sql`), scoped op
   `fonds_id = (select fonds_id from public.profielen where id = auth.uid())` met
   `WITH CHECK`. De rolgate zit **niet** in RLS maar server-side in
   `/api/organisatieprofiel` (`requireCapability`), exact zoals `/api/profiel` de
   `profielen`-tabel behandelt. Geen DELETE-policy.
3. **Plaatsing als tab op "Mijn profiel".** De pagina blijft "Mijn profiel"; er
   komt een apart tabblad "Organisatieprofiel" (geen aparte sidebar-ingang). De
   beheerder krijgt een bewerkbaar formulier met tekentellers + live preview van
   het promptblok (`bouwOrganisatieprofielBlok`); overige rollen een read-only
   weergave.
4. **De platform-back-office (OP-5) blijft bestaan** als optionele fallback: die
   werkt via de service-role, omzeilt RLS en staat los van deze policies. Het is
   de enige weg om profielen van een *ander* fonds te vullen.

## Overwogen alternatieven

- **Alles via de platform-back-office houden (0038 ongewijzigd)** — verworpen: te
  zware autorisatie voor een fonds dat z'n eigen context invult; verplicht een
  platformrol voor een routineuze beheerhandeling.
- **Ook voorzitter laten bewerken** — verworpen voor nu: bewust minimaal gehouden
  bij één rol (beheerder); additief uit te breiden door de mapping aan te passen.
- **Rolcheck óók in RLS (defense-in-depth)** — niet gedaan: doorbreekt het
  huispatroon (RLS = isolatie, code = rol) dat de rest van de tenant volgt en
  maakt de rol-mapping op twee plekken bron-van-waarheid.
- **Aparte `organisatieprofiel_log`-tabel** — verworpen: het tabelontwerp
  (2026-07-06) koos bewust voor lichte wie/wanneer-audit (`bijgewerkt_door`/`_op`);
  een append-only logtabel is additief indien later nodig.

## Gevolgen

- **RLS/tenant-isolatie:** nieuwe INSERT/UPDATE-policies op
  `organisatie_profielen`, uitsluitend eigen fonds. `WITH CHECK` verhindert
  omhangen naar een ander fonds. SELECT-policy uit 0038 ongewijzigd. Tenant blijft
  op de anon-key + RLS; geen service-role in dit pad.
- **Autorisatie:** `organisation.profile.manage` (beheerder-only) server-side
  afgedwongen in `PUT /api/organisatieprofiel`. UI-gating (read-only vs bewerkbaar)
  is cosmetisch; de route is bron-van-waarheid.
- **Audit/reproduceerbaarheid:** `bijgewerkt_door` = weergavenaam van de bewerker,
  `bijgewerkt_op` via touch-trigger. Geen aparte logtabel (bewust).
- **Datamodel/migraties:** geen tabelwijziging; alleen twee policies (idempotent,
  met ROLLBACK). `schema.sql`-blok "2b" bijgewerkt als documentatie.
- **Herziening van 0038:** besluitpunt 1 van 0038 ("geen write-policy, schrijven
  alleen via service-role") is hiermee deels achterhaald voor het eigen fonds; de
  overige keuzes van 0038 (geen status/gating, generieke naamgeving) blijven staan.

## Referenties

- `mvp/supabase/migrations/2026_07_07_organisatieprofiel_tenant_write.sql` (+ ROLLBACK)
- `mvp/app/api/organisatieprofiel/route.ts`
- `mvp/app/(dashboard)/profiel/page.tsx`, `.../profiel/_components/OrganisatieprofielTab.tsx`
- `mvp/lib/capabilities.ts` (`organisation.profile.manage`)
- `decisions/0038` (herzien), `0017` (persoonlijk profiel strikt zelfbeheerd — contrast),
  `0006` B11 (capability-model), FO Organisatieprofiel v0.4 (§2, §5)
