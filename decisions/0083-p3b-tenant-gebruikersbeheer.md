# 0083 — P3-B: tenant-gebruikersbeheer per fonds op de beheer-surface

- **Status:** Geaccepteerd
- **Datum:** 2026-07-27
- **Betrokkenen:** Merlin (akkoord besluitpunten), Claude (uitvoering)

## Context

Sinds increment T2 (besluit [`0044`](./0044-maak-profiel-deterministische-fondstoewijzing.md))
is de auth-trigger `maak_profiel()` fail-closed op `raw_user_meta_data.fonds_id`.
Een gebruiker aanmaken via Supabase → Authentication → Add user faalt zonder
expliciet `fonds_id` in de User Metadata — bedoeld gedrag, geen bug. De
handmatige workaround (UUID met de hand plakken) is foutgevoelig (verkeerd fonds
= bestuurder in het verkeerde fonds), niet geaudit en schaalt niet naar meerdere
fondsen. FO Increment P v0.3 §10 (module P3, slice B/C) belegt dit in de
back-office; besluit [`0026`](./0026-p2-light-p4-light-en-vier-ogen-deferral.md)
schoof de slice bewust door **met een her-introductie-gate vóór productie/fonds 2**.
Deze werkopdracht (P3-B) activeert dat deel.

Randvoorwaarden uit de codebase (geverifieerd 2026-07-27):
- `withPlatform` is de enige service-role-poort (sessie + live AAL2 + capability
  + twee-fasen-audit, fail-closed). Referentiepatroon: `rechten/acties.ts`.
- `profielen.rol` CHECK = `('bestuurder','voorzitter','beheerder')` default
  `bestuurder`; de bevriezing-trigger `trg_profiel_bevries_kolommen` bevriest
  `fonds_id`/`rol` alléén voor zelfservice (`auth.uid() = old.id`) — service-role
  (`auth.uid() IS NULL`) blijft vrij.
- De Supabase Auth Admin API (`auth.admin.*`) werd nergens gebruikt; dit besluit
  introduceert dat pad.
- Variant-C (besluit [`0066`](./0066-variant-c-cutover-optie-1.md)) is **uitgevoerd**:
  beheer draait als apart Vercel-project met geïsoleerde, geroteerde service-role.

## Besluit

Een beheerscherm `/platform/gebruikers` op de beheer-host maakt, per **expliciet
gekozen fonds**, tenant-gebruikers aan/beheert deze, volledig achter
`withPlatform`. De besluitpunten uit de werkopdracht zijn als volgt vastgesteld:

- **B-1 (her-introductie-gate 0026) — vier-ogen bewust UITGESTELD, eindig.**
  Rol `beheerder` toekennen en (de)blokkeren gebeurt in dit interim **single-actor**
  met verplichte reden + volledige twee-fasen-audit; er is géén tweede fiatteur.
  Reden: er bestaat geen herbruikbare vier-ogen-workflow (alleen de
  `vier_ogen_door`-kolom op capability-grants), en het portaal kent
  demo-/eigen-teamgebruik. Dit is **geaccepteerde schuld met einddatum**, analoog
  aan B-3a: vier-ogen wordt heringevoerd vóór het eerste van — een feitelijk fonds
  met echte bestuurders, de G2-aftekening, of SSO-invoering (TP2). Bewaakt punt in
  `openstaande-punten-en-risicos.md` (punt 13).
- **B-2 (capability) — hergebruik `platform.tenants.manage`** (bestaand, al
  zwaar). Wie fondsen mag beheren, mag ook tenant-gebruikers aanmaken. Geen nieuwe
  capability → geen seed-/sanity-/union-wijziging. Bewust geaccepteerd gevolg:
  fondsbeheer en gebruikersbeheer zijn nu in één capability gebundeld (grotere
  blast radius per identiteit) — zie Gevolgen.
- **B-3/B-3a (aanmaakpad) — wachtwoord direct in het beheerscherm** (al besloten
  27-07). Geen invite-/SMTP-/reset-flow, geen wachtwoord-hardening. Interim tot
  SSO; wachtwoord wordt nooit gelogd/getoond, sterkte-eis (lengte) server-side.
- **B-4 (rolbepaling) — service-role-update ná `createUser`.** `createUser`
  (metadata `{ naam, fonds_id }`, geen rol) laat de bestaande trigger het profiel
  op `bestuurder` maken; is de gevraagde rol hoger, dan zet een service-role
  `update profielen` de rol. **Geen wijziging aan de fail-closed auth-trigger.**
  De rol-whitelist wordt in de server-action gecontroleerd en door de bestaande
  `profielen.rol`-CHECK als DB-backstop afgedwongen.
- **B-5 (deactiveren) — `auth.admin.updateUserById({ ban_duration })`.** Geen hard
  delete (0001); profiel en auditsporen blijven; status zichtbaar in het overzicht.
- **B-6 (positionering) — onboarding-/interventiepad, geen permanente route.**
  Tenant-zelfservice (fondsbeheerder nodigt zelf uit) blijft het doelbeeld.
- **B-7 (transparantie) — elke handeling landt in `platform_event_log`.** Een
  fonds-zichtbaar spoor is een vervolgpunt vóór echte fondsen live gaan.

## Overwogen alternatieven

- **B-1 licht synchroon vier-ogen** (tweede actieve identiteit als mede-fiatteur
  bij de handeling) — honoreert de gate-intentie tegen matige bouw; niet gekozen
  omdat het voor een interim-tool dat SSO gaat vervangen wegwerpwerk is, in lijn
  met de B-3-rationale.
- **B-1 volledige async goedkeuringswachtrij** — dichtst bij echt vier-ogen,
  maar zwaarste bouw (nieuwe tabel + tweede UI-flow); niet gekozen (interim).
- **B-2 nieuwe capability `platform.tenant.users.manage`** — zuiverder qua
  scheiding van machten, maar kost union + `ZWARE_CAPABILITIES` + sanity (15→16) +
  `SEED_IN_MIGRATIE` + DB-seed-migratie; niet gekozen (leaner, geen migratie).
- **B-4 metadata-uitbreiding van `maak_profiel()`** — één atomaire handeling,
  maar raakt de gevoelige fail-closed auth-trigger en vergt een migratie +
  rollback; niet gekozen (leaner, geen trigger-risico).

## Gevolgen

- **Datamodel/migraties:** geen. Dit is een code-only-ticket; `maak_profiel()`,
  de capability-seed en `schema.sql` blijven ongemoeid. De "migratie-eerst-dan-
  deploy"-discipline is n.v.t.
- **RLS/tenant-isolatie:** ongewijzigd. Het nieuwe service-role-pad zit volledig
  achter `withPlatform`; de aanmaak dwingt een expliciet, bestaand fonds af (géén
  default/`limit 1`) — de R1-discipline uit `0044` blijft intact.
- **Audit:** elke handeling twee-fasen (attempt vóór, result ná) met doelfonds,
  doelobject (`email-hash:<sha256>` bij aanmaak, `user:<id>` bij bestaande
  gebruiker), verplichte reden en foutcode bij mislukking. Het wachtwoord komt
  nergens in het log; het result-effect draagt alleen `wachtwoord_gezet: true`.
- **Beheer-/gebruikservaring:** fonds is een verplichte, expliciete keuze met een
  bevestigingsstap die het fonds voluit toont (naam + slug) — vereisten/blokkers
  vóór de actie, niet erna.
- **Bewust geaccepteerde schuld / negatieve gevolgen:**
  1. **Toerekenbaarheid (B-3):** platformbeheer kent het wachtwoord van een
     tenant-account; zolang dat kan, is een governance-logregel niet sluitend toe
     te rekenen. Hoog risico zodra echte bestuurders aansluiten; laag in
     demo-/eigen-teamgebruik. Eindig (B-3a).
  2. **Geen vier-ogen (B-1):** één beheerder kan een `beheerder` aanstellen of
     accounts blokkeren zonder tweede paar ogen. Eindig; her-introductie vóór
     fonds 2 / G2 / echte bestuurders.
  3. **Gebundelde capability (B-2):** één gecompromitteerde `platform.tenants.manage`-
     identiteit kan zowel fondsen als tenant-gebruikers in álle fondsen creëren.
     Gemitigeerd door variant-C-isolatie, live MFA en volledige audit.
  4. **AVG:** het platform maakt accounts van natuurlijke personen aan; juridische
     toetsing (FG/privacy-jurist) vóór echte fondsen — professionele inschatting,
     geen vastgesteld feit.

## Referenties

- Werkopdracht P3-B v0.2 (2026-07-27); FO Increment P v0.3 §10; besluiten
  [`0026`](./0026-p2-light-p4-light-en-vier-ogen-deferral.md),
  [`0044`](./0044-maak-profiel-deterministische-fondstoewijzing.md),
  [`0066`](./0066-variant-c-cutover-optie-1.md), `0001`.
- Code: `app/(platform)/platform/(beveiligd)/gebruikers/`, `platform/lib/platform-wrapper.ts`,
  `platform/lib/platform-capabilities.ts`, `supabase/migrations/2026_07_08_maak_profiel_deterministisch.sql`.
