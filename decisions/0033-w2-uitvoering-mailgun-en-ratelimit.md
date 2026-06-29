# 0033 — W2-uitvoering: Mailgun-sandbox als interim mailtransport + rate-limit via ip_hash-telling

- **Status:** Geaccepteerd
- **Datum:** 2026-06-29
- **Betrokkenen:** Merlin (besluit), Claude Code (uitvoering)
- **Supplement op:** [0031](./0031-contact-aanvragen-opslag-en-email.md) (opslag + e-mail); wijzigt daarvan de mailprovider en concretiseert de rate-limit.

## Context

0031 legde het W0-datamodel + RLS van `contact_aanvragen` vast en koos **Resend** als mailprovider. Bij de W2-uitvoering (`/api/contact`, `lib/email.ts`, het formulier) bleken twee punten concretisering nodig:

1. **Mailprovider pragmatisch.** Resend vereist domeinverificatie (DNS/SPF/DKIM) op `the-paradox.com`. De mailboxen bestaan al, maar DNS-inrichting is een aparte stap. Voor een snelle, livegang-blokkades-vermijdende W2b is een transport nodig dat vandaag werkt.
2. **Rate-limiting.** decisions/0005 koos Postgres-rate-limiting in-stack, maar de bestaande `lib/rate-limit.ts` / `fn_rate_limit_check` is **auth-only** (security-definer, gekeyd op `auth.uid()`, raise bij null, ingetrokken voor anon) en daarmee onbruikbaar op een **publiek** endpoint zonder ingelogde gebruiker.

Randvoorwaarden ongewijzigd t.o.v. 0031: RLS dicht (geen anon-schrijf/lees), dataminimalisatie (geen ruw IP), append-only, secrets server-side, mail soft-fail.

## Besluit

- **Mailtransport = Mailgun (sandbox-domein) als interim**, via een directe HTTPS-call met `fetch` (geen SDK, nul nieuwe dependencies) in `lib/email.ts`. EU-endpoint (`api.eu.mailgun.net`) wegens NL-context. De ontvangers (Merlin, Robert) worden in het sandbox-domein **vooraf geautoriseerd**; afzender = `postmaster@<sandboxdomein>`. `lib/email.ts` is bewust **provider-agnostisch** opgezet zodat overstap naar Resend/een geverifieerd `the-paradox.com`-domein later alleen env + de fetch-call raakt.
- **Rate-limit = eigen telling op `contact_aanvragen`** (Optie A): tel inzendingen per `ip_hash` binnen een venster (`RL_LIMIET=3` per `RL_VENSTER_MS=10 min`), **géén nieuwe migratie**. `ip_hash` = gezouten sha256 (`CONTACT_IP_HASH_SALT`), uitsluitend voor misbruikbestrijding — geen ruw IP. Ontbreekt salt/IP → **fail-open** (formulier mag niet platliggen door een telstoring).
- **Service-role-schrijfpad** via een nieuwe, generieke server-only `lib/supabase-service.ts` (los van de platform-wrapper `lib/supabase-platform.ts`, want andere — publieke — surface). Leest dezelfde `SUPABASE_SERVICE_ROLE_KEY`.

## Overwogen alternatieven

- **Resend nu, met DNS-inrichting** — verworpen voor nu: blokkeert W2b op domeinverificatie. Blijft de **doelprovider**; Mailgun-sandbox is expliciet interim.
- **Mailgun via npm-SDK** — verworpen: voegt een dependency toe; een `fetch`-call geeft volledige controle over timeout + soft-fail en houdt de abstractie dun.
- **`fn_rate_limit_check` hergebruiken** — niet mogelijk: auth-only, raise bij anonieme aanroep.
- **Aparte rate-limit-tabel/migratie** — verworpen voor MVP: telling op de bestaande tabel volstaat en vermijdt een migratie; `ip_hash` werd al voorzien in 0031.
- **Geen rate-limit** — verworpen: publiek endpoint heeft minimale misbruikrem nodig.

## Gevolgen

- **RLS/security:** ongewijzigd t.o.v. 0031 — service-role blijft het enige schrijfpad, RLS dicht. Origin/CSRF-check tegen `MARKETING_HOST` en honeypot (stil 200) zijn toegevoegd in de route.
- **Privacy:** geen ruw IP; `ip_hash` alleen voor rate-limit. Geen verzwakking van dataminimalisatie.
- **Datamodel/migraties:** **geen nieuwe migratie** — rate-limit hergebruikt `ip_hash` + `aangemaakt_op`.
- **Bewust geaccepteerde schuld:** Mailgun-sandbox is interim. Sandbox kent ontvanger-autorisatie en doorstuurlimieten; de mail gaat alleen naar de twee vaste interne adressen, dus dat is acceptabel tot Resend/een geverifieerd domein live is. Migratiepad: env omzetten + de fetch-call in `lib/email.ts` (provider-agnostisch).
- **Verificatie-randvoorwaarde:** zowel de platform back-office als de contact-insert vereisen `SUPABASE_SERVICE_ROLE_KEY` (server-side, in Vercel gezet; lokaal in `.env.local` te plakken voor smoke).

## Referenties

- `app/api/contact/route.ts`, `lib/email.ts`, `lib/supabase-service.ts`, `lib/contact-validatie.ts`
- `app/(public)/contact/page.tsx` + `_components/ContactForm.tsx`
- decisions/0031 (opslag + e-mail), decisions/0005 (rate-limiting in-stack), decisions/0001 (append-only)
- `supabase/migrations/2026_06_29_contact_aanvragen.sql`
