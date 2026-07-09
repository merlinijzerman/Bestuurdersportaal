# `platform/` — back-office (platformbeheer)

Platform-/back-office-code: de beheeromgeving die het portaal zelf bedient (curatie van de
gedeelde contentlaag, platformrollen, grants). De routes leven al gescheiden in
`app/(platform)/`; deze map is de bijbehorende niet-route-laag.

## Regels (afgedwongen via ESLint-boundaries)

- `platform/*` **mag** `core/*` gebruiken (platform is consument van core).
- `platform/*` mag **niet** importeren uit `fondsen/*` (platform is fonds-overstijgend).
- `core/*` kent `platform/*` **niet** (strikte eenrichting, besluit T9).

## Status

T9 fase 2 verhuist de platform-specifieke lib-modules (`platform-*.ts`, `supabase-platform.ts`
en hun `.sanity.ts`) hierheen (`platform/lib/`).
