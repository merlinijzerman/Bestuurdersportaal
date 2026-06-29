# 0031 — Contactaanvragen: opslag en e-mailnotificatie

- **Status:** Geaccepteerd
- **Datum:** 2026-06-29
- **Betrokkenen:** Merlin (besluit), Claude Code (uitvoering)

## Context

De publieke voorkant krijgt een contactformulier (W2). De inzending is **niet** tenant-gebonden (een aanvrager is geen ingelogde gebruiker, geen `fonds_id`), maar moet wel betrouwbaar worden opgeslagen, niet publiek leesbaar zijn (FO REQ-PV-042) en een notificatie triggeren. Randvoorwaarden: RLS-guardrail (geen anon-schrijf/lees), dataminimalisatie (geen ruw IP), append-only-lijn, secrets server-side.

## Besluit

- **Tabel `contact_aanvragen`** (TO §5.1): kolommen incl. `privacy_version` (verplicht), `notificatie_verzonden`, `mail_error`, `status` (`nieuw|in_behandeling|afgehandeld`), `ip_hash`/`user_agent_hash` optioneel en **gehasht** (geen ruw IP, alleen bij misbruikbestrijding).
- **RLS aan, geen anon/authenticated policies** → publiek niet leesbaar/schrijfbaar. De **insert loopt server-side via de service-role-client** (W2, `/api/contact`); de browser schrijft nooit direct. Lezen/opvolgen = fase 2 (open: welke rol leesrechten krijgt).
- **Append-only-lijn (decisions/0001):** geen hard-delete — opvolging via `status`. DELETE-blokkerende trigger geldt ook voor de service-role; UPDATE blijft toe.
- **E-mailprovider = Resend** (transactioneel, server-side). M365/Graph later; AWS SES niet de voorkeursroute.
- **Verwerkingsvolgorde:** eerst opslaan in Supabase, daarna mailen; mail is **soft-fail** (opslag leidend; mailfout → log + `notificatie_verzonden=false` + `mail_error`).
- **Config via env, nooit in frontend:** `CONTACT_NOTIFY_TO=merlin.ijzerman@the-paradox.com,robert.timmer@the-paradox.com`; `CONTACT_NOTIFY_FROM` = vast afzenderadres (voorkeur `no-reply@the-paradox.com`, definitief te bevestigen); Resend-API-key server-side. **`reply-to` = het e-mailadres van de aanvrager.**
- **W2-splitsing:** W2a (formulier + opslag) + W2b (notificatie), **beide fase-1-livegang**.

> **W0-scope:** dit besluit legt alleen het datamodel + de migratie + RLS vast. De `/api/contact`-route, `lib/email.ts` en de Resend-integratie zijn **W2**; de Resend-key/`CONTACT_NOTIFY_*` worden in W0 als env-contract genoteerd maar nog niet gebruikt.

## Overwogen alternatieven

- **Anon-key insert met een insert-policy** — verworpen: zou een schrijfpad vanuit de browser openen; service-role-insert houdt de tabel volledig dicht voor de client.
- **AWS SES / direct SMTP** — verworpen: meer inrichting/beheer dan nodig voor een contactformulier.
- **Mail-eerst** — verworpen: opslag is bron-van-waarheid; mail is signalering (mag soft-failen).

## Gevolgen

- **RLS/security:** service-role is het enige schrijfpad (server-side); past in de bestaande service-role-discipline (`lib/supabase-platform.ts`-patroon, maar hier niet achter de platform-wrapper — andere, publieke surface).
- **Migratie-eerst-dan-deploy:** de migratie kan in W0 standalone worden toegepast (geen code hangt eraan).
- **Privacy:** dataminimalisatie geborgd in het schema (geen ruw IP, hashes optioneel).

## Referenties

- `04 …/Publieke voorkant technisch ontwerp v1.0.md` §4, §5, §6, §9
- `supabase/migrations/2026_06_29_contact_aanvragen.sql` (+ ROLLBACK)
- decisions/0001 (append-only), decisions/0005 (rate-limiting in-stack)
- FO REQ-PV-016/017/041/042/045
