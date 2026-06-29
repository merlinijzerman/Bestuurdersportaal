# 0030 — Loginhost en backward-compatible `/login`-redirect

- **Status:** Geaccepteerd
- **Datum:** 2026-06-29
- **Betrokkenen:** Merlin (besluit), Claude Code (uitvoering)

## Context

De feitelijke login leeft straks op de app-host (`app.bestuurdersportaal.com/login`). Maar `https://www.bestuurdersportaal.com/login` en `https://bestuurdersportaal.com/login` zijn al extern gedeeld en moeten blijven werken (FO REQ-PV-034/035). Een dode of naar de homepage leidende loginlink is onacceptabel; een auth-/redirect-lus eveneens.

## Besluit

De **generieke loginpagina** staat op de **app-host**. `/login` op de **marketing-host** is een **technische redirect** (geen pagina) naar `https://app.bestuurdersportaal.com/login`, met:

- **Status 307** tijdens migratie/uitrol (tijdelijk, methode-behoudend; → later **301** als apart besluit, na bevestigde stabiele werking).
- **Query-parameters behouden** (bv. `?redirect=`, `?next=`, foutcodes).
- **Nooit** naar `/` of de homepage; **geen lus** (marketing doet enkel de host-redirect, de app-host beslist daarna over de sessie).
- Login op **`noindex`** (host-niveau bevestigd in W0; `robots.ts`/`sitemap.ts` volgen in W1).

Implementatie in `middleware.ts` (`surface === 'marketing' && pathname === '/login'` → `redirectLogin`); de absolute URL naar `APP_HOST` wordt daar gebouwd. Zonder `APP_HOST` valt de redirect fail-safe terug op doorlaten (geen verkeerde host/lus). De app-precedentie in `bepaalSurface` voorkomt een lus bij een misconfiguratie waarin `APP_HOST == MARKETING_HOST`.

## Overwogen alternatieven

- **301 (permanent) meteen** — verworpen voor W0: agressieve browsercaching bemoeilijkt rollback tijdens uitrol. 301 pas na stabilisatie.
- **302** — gelijkwaardig aan 307 voor GET-links; 307 gekozen om methode-behoud expliciet te maken.
- **Redirect in een route handler i.p.v. middleware** — verworpen: middleware draait vóór render en houdt de marketing-host vrij van een echte `/login`-pagina; matcher laat `/login` door.

## Gevolgen

- **Reeds-ingelogde gebruiker → direct in omgeving (AC-13):** de auto-skip-bij-ingelogd op `/login` (server-side redirect-weg-van-login) hoort bij de **login-neutralisatie in W1** (TO §7); W0 dekt "bestaande gebruiker kan inloggen" + post-login redirect. Bewust geaccepteerde, kleine UX-restpost tot W1.
- **Auth-callback** loopt niet via deze redirect; `auth/*` blijft in de middleware-matcher-uitzondering en hoort op de app-host (zie 0030/§2.6 Auth-config).
- **Rollback:** 307 cachet niet hard; `MARKETING_HOST` weghalen herstelt de pre-cutover-situatie direct.

## Referenties

- `04 …/Publieke voorkant technisch ontwerp v1.0.md` §2.3, §2.4, §2.5, §2.6, §7
- `middleware.ts`, `lib/platform-host.ts` (`redirectLogin`)
- FO §7.5, §13.1; AC-10/AC-11/AC-13/AC-14
