# Route A — Implementatie-log

> **Status**: in uitvoering (Dag 1 klaar — 18 mei 2026)
> **Plan**: `SECURITY-ROUTE-A-PLAN.md`
> **Doel**: pilot-klaar hardening — dichten van hoog-risico-bevindingen uit audit 2026-05-07

Dit document logt per werkpakket wat is uitgevoerd, welke afwijkingen er waren ten opzichte van het plan, en welke beslissingen tijdens de uitvoering zijn genomen. Bij afronding van WP8 wordt dit document het definitieve archief van de Route A-implementatie.

---

## Voortgangsoverzicht

| # | Werkpakket | Status | Datum | Afwijking |
|---|---|---|---|---|
| WP1 | Security headers in `next.config.ts` | ✅ Klaar | 18-05-2026 | Geen — CSP-allowlist alleen Vercel-default URL (gebruikersvoorkeur) |
| WP2 | Rate limiting in-stack (Postgres) | ✅ Klaar | 10-06-2026 | In-stack i.p.v. Upstash (decisions/0005); teller op auth.uid(); AI-routes 30/uur |
| WP3 | File upload hardening (size + magic-byte) | ⏳ Pending | — | — |
| WP4 | Prompt-injection-bescherming | ⏳ Pending | — | — |
| WP5 | CSRF Origin-check (middleware.ts) | ⏳ Pending | — | — |
| WP6 | Error sanitization (alle API-routes) | ✅ Klaar | 18-05-2026 | Scope groter dan plan — 28 i.p.v. 8 bestanden |
| WP7 | Sentry monitoring | 🅿️ Uitgesteld | — | Gebruiker stelt uit; helper voorbereid op activering |
| WP8 | Eindverificatie + smoke tests | ⏳ Pending | — | — |

---

## WP1 — Security headers — ✅ klaar 18-05-2026

**Geleverd**: `next.config.ts` heeft een `headers()`-functie die op alle routes zes headers zet (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS, CSP). `serverExternalPackages` blijft ongewijzigd.

**CSP-keuzes**:
- `default-src 'self'` als baseline
- `script-src` staat `'unsafe-inline'` en `'unsafe-eval'` toe — tijdelijke concessie voor Next.js-hydratatie. Route B-onderwerp: nonces.
- `connect-src` whitelist: Supabase (`https://*.supabase.co`), Anthropic (`https://api.anthropic.com`), Vercel Insights (`https://*.vercel-insights.com`). Geen custom domain (gebruikersvoorkeur).
- `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'` voor verdere hardening.

**HSTS**: `max-age=63072000; includeSubDomains; preload` — twee jaar, inclusief subdomeinen, met preload-token. Submission naar hstspreload.org is handmatig wanneer productie-URL stabiel is.

**Verificatie**:
- `./node_modules/.bin/tsc --noEmit --skipLibCheck` exit 0
- `npm run build` in sandbox faalt op SWC-binary platform-issue (linux/arm64); op de Mac van de gebruiker en op Vercel-CI verwacht groen
- `curl -I https://<vercel-url>` en `securityheaders.com` na deploy — verwacht grade A

**Bij wijziging van URL**: zowel CSP `connect-src` als de toekomstige CSRF-allowlist in WP5 moeten worden bijgewerkt.

---

## WP6 — Error sanitization — ✅ klaar 18-05-2026

**Scope-uitbreiding tijdens uitvoering**: het oorspronkelijke audit-rapport noemde 8 routes met `error.message`-lekken. Een bredere grep tijdens uitvoering vond **33 hits in 28 bestanden** — alle drie de `decisions/`-subtrees, alle `risicos/`-routes en alle `procedures/`-mutatie-routes hadden hetzelfde patroon. Alle 33 zijn geadresseerd.

**Helper aangemaakt**: `lib/api-errors.ts` met:

- `errorResponse(label, error, opts?)` — generieke 500-response, server-side logging via `console.error`, voorbereid op `Sentry.captureException` (commented hook in de helper)
- `badRequest(label, userMessage, status?)` — voor gevalideerde 400-meldingen waar de user-message bewust expliciet is

**Pragmatische patch-aanpak**: in plaats van alle 28 routes te refactoren naar `errorResponse`, is het lek-patroon ter plekke vervangen door een generieke string + `console.error`. Dat houdt de bestaande logica intact en sluit aan op het bestaande patroon van top-level `catch` met `"Serverfout"`.

**Bijzonder geval — `decisions/[id]/status/route.ts:212-216`**: deze regel gaf bewust de DB-trigger-melding van `fn_decision_status_check` door aan de frontend, om gebruiker te informeren over ongeldige statusovergangen. Vervangen door de bestaande fallback ("Statusovergang mislukt. Mogelijk is deze overgang niet toegestaan.") plus een comment-blok dat documenteert waarom (potentiële schema-leak via constraint-namen). Mogelijke UX-regressie: een specifieke "u kunt niet van X naar Y" wordt nu generiek "Mogelijk is deze overgang niet toegestaan". Acceptabel voor Route A; betere oplossing (gevalideerde, vooraf-bepaalde meldingen per (from→to)-paar) hoort in een latere refactor.

**Bestanden gewijzigd (28)**:
```
app/api/agendapunten/route.ts
app/api/agendapunten/[id]/voorbereiding/route.ts            (2 hits)
app/api/agendapunten/[id]/voorbereiding/notities/route.ts
app/api/decisions/[id]/route.ts
app/api/decisions/[id]/actions/route.ts
app/api/decisions/[id]/actions/[aid]/route.ts
app/api/decisions/[id]/ai-interactions/[aiid]/route.ts
app/api/decisions/[id]/assumptions/route.ts
app/api/decisions/[id]/assumptions/[aid]/route.ts
app/api/decisions/[id]/conditions/route.ts
app/api/decisions/[id]/conditions/[cid]/route.ts
app/api/decisions/[id]/dissent/route.ts
app/api/decisions/[id]/dissent/[did]/route.ts               (2 hits)
app/api/decisions/[id]/risks/route.ts
app/api/decisions/[id]/risks/[rid]/route.ts
app/api/decisions/[id]/status/route.ts                      (2 hits)
app/api/documents/upload/route.ts
app/api/inbreng/route.ts
app/api/inbreng/[id]/route.ts
app/api/procedures/route.ts
app/api/procedures/[id]/besluiten/route.ts
app/api/procedures/[id]/bewijs/route.ts
app/api/procedures/[id]/checklist/[itemId]/route.ts
app/api/procedures/[id]/stappen/[stapId]/route.ts           (2 hits)
app/api/procedures/[id]/stappen/[stapId]/agendapunt/route.ts
app/api/risicos/route.ts
app/api/risicos/[id]/maatregelen/route.ts
app/api/risicos/[id]/maatregelen/[mid]/route.ts
app/api/risicos/[id]/sluiten/route.ts
app/api/vergaderingen/route.ts
```

**Verificatie**:
- `./node_modules/.bin/tsc --noEmit --skipLibCheck` exit 0
- Eind-grep `error\.message|err\.message|\.toString\(\)|error\.stack|\?\.message` op `app/api/`: 0 hits in response-bodies (alle hits die overblijven zijn variabele-declaraties zoals `error: insertFout` of `console.error("...", err)`)
- Manueel testen op productie ná deploy: trigger een 500-fout op een willekeurige POST, response mag geen kolom-/tabelnaam bevatten

---

## WP2 — Rate limiting in-stack (Postgres) — ✅ klaar 10-06-2026

**Afwijking t.o.v. plan**: het oorspronkelijke WP2-plan gebruikte Upstash Redis + `@upstash/ratelimit`. Conform `decisions/0005` (geen nieuwe sub-verwerker voor MVP) is dit vervangen door een **in-stack sliding-window-teller in Supabase Postgres**. Geen Upstash, geen Vercel KV, geen nieuwe env-vars.

**Geleverd**:

- **Migratie `supabase/migrations/2026_06_10_rate_limiting.sql`** (idempotent, migratie-eerst-dan-deploy):
  - Tabel `rate_limit_events` (gebruiker_id, endpoint, tijdstip) — één rij per request-event (sliding-window-log).
  - `security definer`-functie `fn_rate_limit_check(p_endpoint, p_limiet, p_venster)` die atomair telt-binnen-venster, verlopen events snoeit (tabel blijft klein) én beslist. Retourneert `{toegestaan, resterend, reset_at}`.
- **`lib/rate-limit.ts`**: helper `controleerLimiet(supabase, sleutel)` + centrale `LIMIETEN`-config (één plek voor tuning). Fail-open bij DB-fout (een rate-limiter mag de app niet platleggen).
- **`lib/api-errors.ts`**: nieuwe `rateLimited(label, resetAt)` → HTTP 429 met gesanitiseerde NL-melding, reset-hint en `Retry-After`-header.
- **Toegepast op vier endpoints** (direct ná de auth-check, vóór RAG/Anthropic/extractie):
  - `app/api/chat/route.ts` — 20 / 5 min (vóór de SSE-stream, zodat de 429 een gewone JSON-response is)
  - `app/api/documents/upload/route.ts` — 10 / uur
  - `app/api/agendapunten/[id]/voorbereiding/route.ts` — 30 / uur
  - `app/api/procedures/[id]/stappen/[stapId]/besluit-concept/route.ts` — 30 / uur
- **`lib/rate-limit.sanity.ts`**: pure referentie-implementatie van het sliding-window-algoritme + 6 asserts (venster/limiet/resterend/reset/prune). Groen via `npx tsx`.

**Belangrijke ontwerpkeuzes (bevestigd met gebruiker 10-06-2026)**:

1. **Teller op `auth.uid()`, niet op een meegegeven `p_gebruiker_id`.** De werkopdracht noemde een `p_gebruiker_id`-parameter; die is bewust weggelaten. Reden: met de anon-key zou een client een vreemd gebruiker-id kunnen meesturen om de eigen check te ontwijken. Door intern op `auth.uid()` te sleutelen is de limiet niet te spoofen.
2. **RLS deny-all + `revoke`.** De teller-tabel heeft RLS aan zónder policies en ingetrokken directe rechten. De `security definer`-functie is het enige schrijf-/leespad — een gebruiker kan zijn eigen teller niet lezen, verwijderen of resetten.
3. **AI-routes op 30/uur** (voorbereiding + besluit-concept), conform de WP2-tabel in het plan ("AI-voorbereiding/besluit-concept routes — 30 req/uur").
4. **Loginroute buiten scope.** App-level limiting op `auth.uid()` werkt alleen voor geauthenticeerde requests; de loginroute heeft nog geen gebruiker. Supabase Auth heeft eigen brute-force-bescherming. Een IP/e-mail-teller zou een ongeauthenticeerde schrijfroute naar de tabel vergen (extra aanvalsoppervlak) — niet meegenomen.
5. **Per-IP-limiet (Vercel Firewall) niet meegenomen** — optioneel, later (buiten scope per werkopdracht).

**Bewust geaccepteerde schuld** (conform decisions/0005):
- Eén DB-round-trip per rate-check (verwaarloosbaar bij MVP-volume).
- Lichte over-telling mogelijk onder gelijktijdige requests (geen advisory lock); aanvaardbaar voor MVP, optioneel te harden bij opschaling.
- **Fail-open**: bij DB-storing valt de limiet weg (beschikbaarheid boven handhaving).

**Kosten-backstop (handmatig, geen code)**: stel een **spend-limiet op de Anthropic API-key** in via de Anthropic Console als extra grendel tegen kosten-runaway. Te zetten door gebruiker.

**Verificatie**:
- `npx tsx lib/rate-limit.sanity.ts` — 6/6 groen.
- `./node_modules/.bin/tsc --noEmit --skipLibCheck` exit 0.
- DB-sanity (na migratie draaien): `select fn_rate_limit_check('chat',3,'1 minute')` 4× → 4e geeft `toegestaan=false`.
- RLS-bewijs (na deploy): directe `select`/`delete` op `rate_limit_events` met anon-key geeft 0 rijen / wordt geweigerd.
- Handmatige smoke: 21 chat-calls < 5 min → 21e is 429 met `Retry-After`.

---

## WP7 — Sentry monitoring — 🅿️ uitgesteld

**Beslissing 18-05-2026**: gebruiker heeft WP7 uitgesteld omdat het Sentry-account nog niet bestaat. Voorbereiding is wel gedaan:

- `lib/api-errors.ts` heeft een geannoteerde Sentry-hook in `errorResponse`:
  ```ts
  // Hook voor WP7 (Sentry): zodra @sentry/nextjs is geïnstalleerd kun je
  // hier `Sentry.captureException(error, { tags: { route: label }, extra: opts.context })`
  // toevoegen. Alle routes die deze helper gebruiken sturen dan automatisch
  // exceptions naar Sentry — zonder code-wijziging in de routes zelf.
  ```
- Stappen voor activering (te zetten door gebruiker / volgende sessie):
  1. Sentry-account aanmaken op sentry.io — kies **EU-data-residency** voor GDPR
  2. Project aanmaken: `bestuurdersportaal`, platform `next.js`
  3. `npx @sentry/wizard@latest -i nextjs` lokaal draaien — beantwoorden: source maps ja, Vercel-integratie ja, performance monitoring nee
  4. `SENTRY_DSN` en `SENTRY_AUTH_TOKEN` in Vercel-env (Production + Preview)
  5. Sentry-hook in `lib/api-errors.ts` activeren (één import, één regel)
  6. Test: gooi handmatig een 500 in een route, check Sentry-dashboard binnen 30 sec

**Privacy-noot**: Sentry moet als sub-processor genoemd worden in toekomstig verwerkersregister (Route C-werk). Voor Route A acceptabel mits EU-residency.

---

## Wachtende blokkers (extern)

| Wat | Voor | Status |
|---|---|---|
| ~~Upstash Redis-account~~ | ~~WP2~~ | Vervallen — WP2 in-stack opgelost (decisions/0005) |
| Anthropic spend-limiet instellen (Console) — kosten-backstop | WP2 | Handmatige actie gebruiker |
| Sentry-account + `SENTRY_DSN` + `SENTRY_AUTH_TOKEN` (EU-residency) | WP7 | Uitgesteld |
| Productie-URL bevestigen (Vercel-default of custom domain) | WP1 ✅, WP5 toekomst | Bevestigd: Vercel-default |

---

## Bevindingen tijdens uitvoering

1. **Het audit-rapport onderschatte de scope van WP6**: 8 routes vs. werkelijk 33 hits in 28 bestanden. Reden: de audit zocht alleen op een smal patroon (`error?.message` in toplevel-catch), terwijl het patroon in inline Supabase `if (error)`-checks veel vaker voorkomt. De extra ~3× scope kostte ~30 minuten extra. Voor toekomstige route-audits is een bredere grep `error\.message|err\.message|\.toString\(\)` als baseline aanbevolen.

2. **`fn_decision_status_check`-trigger-meldingen waren bewust user-facing**: er was een legitieme UX-reden om de DB-melding door te geven (precieze "u kunt niet van X naar Y"). De vervanging door de generieke fallback is een acceptabele trade-off voor Route A maar verdient later een nettere oplossing (mapping van transitie-pairs naar vooraf-goedgekeurde Nederlandse zinnen, geen DB-leak meer).

3. **Sandbox-build-issue**: `npm run build` in de Cowork-sandbox faalt op SWC-binary platform-mismatch (linux/arm64). Niet relevant voor productie — Vercel en de Mac van de gebruiker hebben hun eigen binaries. `tsc --noEmit` is de echte pre-deploy-check en die is groen.

---

*Wordt aangevuld bij elke volgende WP-sessie. Bij afronding WP8 wordt dit document het definitieve Route A-archief.*
