# 0005 — Rate limiting en monitoring in-stack voor MVP (geen Upstash/Sentry)

- **Status:** Geaccepteerd
- **Datum:** 2026-06-07
- **Betrokkenen:** Merlin IJzerman

## Context

Security Route A bevat twee werkpakketten met een externe afhankelijkheid: **WP2 — rate limiting** (oorspronkelijk via Upstash Redis) en **WP7 — production-monitoring** (oorspronkelijk via Sentry). Beide voegen een **nieuwe sub-verwerker** toe — met een eigen verwerkersovereenkomst, EU-residency-vraag en een regel in het verwerkersregister — en beide blokkeerden feitelijk op het aanmaken van een account.

Randvoorwaarden die meewegen: data-soevereiniteit en een **zo kort mogelijke sub-verwerkerslijst** wegen zwaar in de pensioenfondsmarkt (inkooptrajecten, DNB Good Practice Uitbesteding); RLS per `fonds_id` en de append-only audit moeten intact blijven; en het MVP-volume is klein (een handvol bestuurders per fonds), waardoor zware infrastructuur niet nodig is.

## Besluit

**Voor het MVP worden WP2 en WP7 binnen de bestaande stack (Supabase/Vercel/Anthropic) opgelost, zonder Upstash en Sentry.** Rate limiting via een sliding-window-/token-bucket-teller in **Supabase Postgres** (per `gebruiker_id` + endpoint + tijdvenster, atomair via `insert … on conflict`); monitoring via een **`app_errors`-tabel** (gevuld vanuit `lib/api-errors.ts`) plus **Vercel runtime logs**. Een **spend-limiet op de Anthropic API-key** dient als kosten-backstop. Bij opschaling kunnen Upstash/Sentry alsnog worden ingevoerd als bewuste keuze (Route B).

## Overwogen alternatieven

- **Upstash Redis (WP2 origineel)** — drop-in en schaalbaar, maar voegt een sub-verwerker toe en blokkeert op een account. *Let op:* **Vercel KV draait op Upstash**, dus dat is geen ontsnapping aan de doorgifte.
- **Sentry (WP7 origineel)** — out-of-the-box groepering, alerting en retentie, maar een extra sub-verwerker met te regelen EU-residency.
- **Niets doen** — verworpen: laat de hoog-risico-bevinding F2 (rate limiting) open; een ingelogde aanvaller kan kosten/DOS veroorzaken.

## Gevolgen

- **Geen nieuwe sub-verwerker**; de account-blokkade op WP2/WP7 vervalt, waardoor Route A nu door kan. Lichter voor DPIA en verwerkersregister (data blijft in de eigen stack).
- **Datamodel/migraties**: een `rate_limits`-tabel (of Postgres-functie) en een `app_errors`-tabel komen erbij — conform "migratie eerst draaien, dan deploy".
- **Bewust geaccepteerde schuld**: een DB-round-trip per rate-check (extra DB-load/latency, verwaarloosbaar bij MVP-volume); geen kant-en-klare alerting/groepering zoals Sentry; korte log-retentie op lagere Vercel-plannen; een fout *tijdens* een DB-storing landt niet in `app_errors`; en de Postgres-teller is onder extreme concurrency minder robuust dan Redis. Voor het MVP-volume aanvaardbaar, herzien bij opschaling.
- **RLS/audit**: ongewijzigd; de nieuwe tabellen vallen onder dezelfde RLS-/fonds-isolatie.

## Referenties

- `SECURITY-ROUTE-A-PLAN.md` — WP2/WP7 (origineel) + addendum in-stack invulling.
- `SECURITY-ROUTE-A-IMPLEMENTATIE.md` — voortgangslog (statuskolom bijwerken bij oplevering).
- `HANDOVER.md` § Security & compliance.
- Externe docs-map: `05 Security en compliance/` (auditbevindingen F2/F7) en `07 Compliance, privacy en juridisch/` (verwerkersregister: Upstash/Sentry als "vermijdbaar voor MVP").
