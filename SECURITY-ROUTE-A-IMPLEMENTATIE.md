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
| WP2 | Rate limiting via Upstash Redis | ⏳ Wacht | — | Geblokkeerd op Upstash-account |
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
| Upstash Redis-account + `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | WP2 | Niet gestart |
| Sentry-account + `SENTRY_DSN` + `SENTRY_AUTH_TOKEN` (EU-residency) | WP7 | Uitgesteld |
| Productie-URL bevestigen (Vercel-default of custom domain) | WP1 ✅, WP5 toekomst | Bevestigd: Vercel-default |

---

## Bevindingen tijdens uitvoering

1. **Het audit-rapport onderschatte de scope van WP6**: 8 routes vs. werkelijk 33 hits in 28 bestanden. Reden: de audit zocht alleen op een smal patroon (`error?.message` in toplevel-catch), terwijl het patroon in inline Supabase `if (error)`-checks veel vaker voorkomt. De extra ~3× scope kostte ~30 minuten extra. Voor toekomstige route-audits is een bredere grep `error\.message|err\.message|\.toString\(\)` als baseline aanbevolen.

2. **`fn_decision_status_check`-trigger-meldingen waren bewust user-facing**: er was een legitieme UX-reden om de DB-melding door te geven (precieze "u kunt niet van X naar Y"). De vervanging door de generieke fallback is een acceptabele trade-off voor Route A maar verdient later een nettere oplossing (mapping van transitie-pairs naar vooraf-goedgekeurde Nederlandse zinnen, geen DB-leak meer).

3. **Sandbox-build-issue**: `npm run build` in de Cowork-sandbox faalt op SWC-binary platform-mismatch (linux/arm64). Niet relevant voor productie — Vercel en de Mac van de gebruiker hebben hun eigen binaries. `tsc --noEmit` is de echte pre-deploy-check en die is groen.

---

*Wordt aangevuld bij elke volgende WP-sessie. Bij afronding WP8 wordt dit document het definitieve Route A-archief.*
