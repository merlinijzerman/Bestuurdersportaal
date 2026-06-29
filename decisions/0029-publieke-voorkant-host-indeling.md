# 0029 — Publieke voorkant: host-indeling (drie surfaces)

- **Status:** Geaccepteerd
- **Datum:** 2026-06-29
- **Betrokkenen:** Merlin (besluit), Claude Code (uitvoering)

## Context

De bestaande hostname-middleware (variant B, decisions/0021) kent twee klassen: platform-host (`PLATFORM_HOST`) en tenant-host (default). De publieke marketingvoorkant heeft een derde, niet-geauthenticeerde surface nodig die op de apex leeft en indexeerbaar is. Twee surfaces kunnen niet beide `/` op dezelfde host bedienen, en de reeds extern gedeelde loginlink (`apex/www` `/login`) moet blijven werken. Randvoorwaarden: tenant-isolatie/auth ongemoeid, platform fail-closed, terugdraaibare cutover.

## Besluit

Drie host-classes binnen hetzelfde Next.js-project (TO publieke voorkant §2.1, marketing-host-variant): **marketing** op apex + `www.` (`MARKETING_HOST`), **app** (besluitomgeving) op `app.bestuurdersportaal.com` (`APP_HOST`), **platform** op `beheer.bestuurdersportaal.com` (`PLATFORM_HOST`). De pure `bepaalSurface(host, env)` bepaalt de surface; `bepaalRoute(surface, pathname)` de route. `www.` en apex zijn dezelfde marketing-surface (leidende `www.` genormaliseerd weg). De fail-safe default voor onbekende/onconfigureerde hosts (preview, lokaal) is **`app`** (achter de auth-gate); platform is nooit default → fail-closed.

## Overwogen alternatieven

- **Geen host-verhuizing (TO §2.7)** — dashboard-home van `/` naar `/dashboard`, alles op apex. Verworpen: vermengt surfaces, geen schone SEO-scheiding (apex indexeerbaar vs. app-host `noindex`), wijkt af van het variant-B-denken.
- **Default-surface = `marketing`** — verworpen: zou preview/onbekende hosts de publieke surface laten serveren, de app onmogelijk maken op preview-URL's, en risico op 404/lus geven. `app` achter de gate is veiliger.

## Gevolgen

- **Cutover env-gedreven (A1):** zolang `MARKETING_HOST` niet in productie gezet is, blijft de apex `app` (huidig gedrag). De flip naar marketing — en de rollback — is het zetten/weghalen van één env-var. De productie-flip wordt gecoördineerd met de W1-golive (anders toont de apex een kale 404 tot de `(public)`-pagina's bestaan).
- **RLS/tenant-isolatie:** ongewijzigd — dit is routing/defense-in-depth, geen autorisatie. De auth-gate in de layouts en de capability+audit-wrapper blijven de echte poort.
- **Code:** `lib/platform-host.ts` (pure, getest), `middleware.ts`. Nieuwe env: `MARKETING_HOST`, `APP_HOST` naast `PLATFORM_HOST`.
- **DNS/Auth:** `app.bestuurdersportaal.com` toevoegen + Supabase Auth Site/redirect-URL's naar app-host (zie 0030).

## Referenties

- `04 …/Bestuurdersportaal - Publieke voorkant technisch ontwerp v1.0.md` §2.1, §2.7
- `lib/platform-host.ts`, `lib/platform-host.sanity.ts`, `middleware.ts`
- decisions/0021 (variant-B host-model)
