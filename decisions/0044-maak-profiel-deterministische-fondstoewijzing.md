# 0044 — Deterministische fondstoewijzing bij registratie (R1, increment T2)

- **Status:** Geaccepteerd
- **Datum:** 2026-07-08
- **Betrokkenen:** Merlin (akkoord), Claude (uitvoering)

## Context

De trigger `bij_registratie` draait bij elke signup `public.maak_profiel()` en
koppelde het nieuwe profiel aan `(select id from public.fondsen limit 1)` — het
eerste fonds (migratie 2026-06-23b, r. 47). Zolang er precies één fonds bestaat
valt dat toevallig goed uit. Bij een **tweede** fonds koppelt élke nieuwe
registratie stil aan fonds 1: een cross-tenant-fout die geruisloos ontstaat
(werkopdracht T2, zwakte R1; besluit [`0040`](./0040-bridge-ready-pool-standaard-dedicated-isolatie-premium.md)
B4 + beslisnotitie *Multi-tenant frontend en modulescheiding v0.4* §14).

Randvoorwaarden uit de codebase:
- De DB-trigger heeft **geen request-host/resolver-context**. De T1-resolver
  (host→fonds, besluiten 0040/0041/0042) leeft in de serverlaag en is op het
  `insert on auth.users`-moment niet beschikbaar. De deterministische bron moet
  dus op signup-moment al vaststaan.
- Er is **geen self-service signup** en **geen uitnodigingstabel**. Accounts
  worden handmatig aangemaakt (Supabase → Authentication → Add user), waar de
  beheerder nu al `naam` en `platform` in de User Metadata zet.
- `profielen.fonds_id` is een FK naar `fondsen(id)`.

## Besluit

**Mechanisme = variant (a), metadata-gedreven.** `maak_profiel()` leest het fonds
**uitsluitend** uit `raw_user_meta_data.fonds_id`, gezet bij het aanmaken van het
account (naast `naam`/`platform`). De `(select id … limit 1)`-koppeling en elke
vorm van default-fonds vervallen — in geen enkele tak.

**Fail-closed, luid (variant A).** Ontbreekt `fonds_id`, is het geen geldige
UUID, of bestaat het fonds niet in `public.fondsen`, dan `raise exception`. De
AFTER-INSERT-trigger rolt daarmee de `auth.users`-insert terug: er ontstaat
**nooit** een account met een leeg of verkeerd fonds. Drie expliciete checks
(aanwezig → geldige UUID → bestaat), elk met een duidelijke foutboodschap i.p.v.
de kale cast-fout.

**Behouden.** De 3b-platform-skip-guard (`{"platform": true}` → géén
tenant-profiel) blijft ongewijzigd als eerste check. `maak_profiel()` blijft
`SECURITY DEFINER` (draait op de auth-trigger). RLS wordt niet geraakt: dit is
identity-hardening (de *bron* van `fonds_id`), geen RLS-wijziging — RLS per
`fonds_id` blijft de primaire tenant-isolatie (huispatroon 0039).

## Overwogen alternatieven

- **`limit 1`/default-fonds als fallback** — verworpen: dat is exact de R1-zwakte.
  De werkopdracht verbiedt het in elke variant. Geen stille fallback.
- **Fail-closed via profiel-loze staat** (account bestaat, geen profielen-rij,
  bestaande gates vangen het af — zoals de platform-skip) — overwogen, verworpen
  als primair gedrag. Luid weigeren is sterker: het maakt een fout-account
  onmogelijk i.p.v. te leunen op correcte gating in elk codepad. (De bestaande
  chat-route-gate — geen fonds → 403 — blijft als extra vangnet bestaan.)
- **Variant (b), host/SSO-gedreven** (profiel-creatie verhuizen van de
  DB-trigger naar een server-side onboarding-stap mét resolver-context) —
  verworpen binnen T2: vergt een onboarding-flow die er niet is, en SSO is naar
  achteren geschoven (0040/TP2). **Vervolgticket** zodra er een echte
  post-auth-onboarding of SSO komt.

## Gevolgen

- **RLS/tenant-isolatie:** ongewijzigd. Geen policy geraakt; alleen de functie-
  body die `fonds_id` bepaalt.
- **Audit:** onveranderd kanaal. Wel wordt het profiel-fonds nu deterministisch,
  waardoor het server-side auditfonds in de chat (R2, besluit 0042) op een
  betrouwbaar profiel-fonds rust.
- **Datamodel/migraties:** geen schemawijziging. Idempotente functie-migratie
  [`2026_07_08_maak_profiel_deterministisch.sql`](../supabase/migrations/2026_07_08_maak_profiel_deterministisch.sql)
  (+ `_ROLLBACK`). **Bestaande profielen ongemoeid** (geen backfill; de trigger
  vuurt alleen op nieuwe inserts). `schema.sql` bijgewerkt als documentatie.
- **Beheer/uitrol (operationeel gevolg):** vanaf nu MOET elke handmatige
  tenant-account-aanmaak `fonds_id` in de User Metadata krijgen. Een account
  zonder geldig `fonds_id` faalt luid bij aanmaken (Supabase toont een generieke
  "Database error saving new user"; de trigger-exception noemt de oorzaak). De
  rollback herstelt bewust de `limit 1`-zwakte en mag **niet** worden gedraaid
  terwijl er een tweede fonds bestaat.
- **Verhouding tot bestaande maak_profiel-migraties:** bouwt voort op 2026-06-23b
  (platform-skip) en vervangt daarvan alléén de fonds-koppeling. Voor de rest
  identiek (naam-logica, trigger-definitie).

## Referenties

- Besluit [`0040`](./0040-bridge-ready-pool-standaard-dedicated-isolatie-premium.md)
  (B4), [`0042`](./0042-tenant-enforce-fail-closed-env-schakelaar.md) (R2 —
  server-side auditfonds, al geïmplementeerd in T1.3)
- Migratie: [`2026_07_08_maak_profiel_deterministisch.sql`](../supabase/migrations/2026_07_08_maak_profiel_deterministisch.sql)
  (+ `_ROLLBACK`)
- Verificatie: [`supabase/checks/2026_07_08_maak_profiel_deterministisch.sql`](../supabase/checks/2026_07_08_maak_profiel_deterministisch.sql),
  [`lib/audit-fonds.sanity.ts`](../lib/audit-fonds.sanity.ts) (R2-regressie-guard)
- Voorganger: migratie 2026-06-23b (platform-skip-guard)
