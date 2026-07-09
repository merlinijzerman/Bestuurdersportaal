# 0051 — T8: config-audit in een eigen append-only tabel (fonds_config_log)

- **Status:** Geaccepteerd
- **Datum:** 2026-07-09
- **Betrokkenen:** Ontwikkeling (T8-werkopdracht, differentiatie-als-data)

## Context

Elke configuratiewijziging (theming/manifest/flag/override) moet traceerbaar en
terugdraaibaar zijn: wie/wanneer/welk fonds/oud→nieuw/versie, append-only. De
guardrail is dwingend: hergebruik het bestaande append-only-auditpatroon, voeg
géén tweede logmechanisme toe. De vraag was op welke tabel de config-audit landt.

De bestaande logtabellen passen semantisch niet:

- `governance_events` — draagt een `decision_id`-FK (audit hangt aan een Decision
  Object); config-wijzigingen horen niet bij een besluit.
- `governance_log` — AI-chatvorm met `vraag NOT NULL`; een config-wijziging heeft
  geen "vraag".
- `catalogus_log` / `risico_log` — domeinspecifiek aan hun eigen entiteiten.

## Besluit

Een **eigen append-only tabel `fonds_config_log`** die het bestaande patroon
**hergebruikt** (dezelfde `fn_log_append_only()`-triggerfunctie als de T3-logs),
niet een nieuw mechanisme. Kolommen: `fonds_id` (server-side afgeleid),
`gebruiker_id`/`gebruiker_naam`, `config_type` (CHECK theming/manifest/flag/
override), `config_sleutel`, `oude_waarde`/`nieuwe_waarde` (jsonb), `versie`,
`aangemaakt`. UPDATE/DELETE geblokkeerd door before-triggers. Terugdraaien =
een eerdere waarde opnieuw wegschrijven als nieuwe versie (append-only blijft
intact; herstel is zelf een geauditeerde wijziging).

**Aanvulling (review, migratie t8b): de logregel wordt ATOMISCH door de DB
geschreven, niet door de app.** Een `AFTER insert or update`-trigger
(`fn_fonds_config_capture`) op de vier config-tabellen legt oud→nieuw + versie in
DEZELFDE transactie als de wijziging vast. Daarmee kan het auditspoor niet
losraken van de config-mutatie (de eerdere opzet met twee losse app-statements —
upsert, dán logregel — liet bij een falende tweede insert een stil audit-gat).
Een `UNIQUE(fonds_id, config_type, config_sleutel, versie)`-constraint
serialiseert gelijktijdige schrijvers (dubbele versie → tweede transactie faalt
en rolt terug, inclusief de config-upsert). De app-laag berekent nog wel de
versie en zet `bijgewerkt_door`; het schrijven van de logregel is verplaatst naar
de trigger (geen `schrijfLog` meer in `lib/fonds-config.ts`).

## Overwogen alternatieven

- **Config-audit in governance_events** — afgewezen: vereist een kunstmatige
  `decision_id` en vervuilt de besluit-audit met niet-besluit-events.
- **Config-audit in governance_log** — afgewezen: `vraag NOT NULL` en de
  AI-chatsemantiek passen niet; zou het veld misbruiken.
- **Eén generieke "audit_log" voor alles** — afgewezen voor nu: te grote
  refactor buiten T8-scope; het gedeelde *patroon* (fn_log_append_only) levert de
  consistentie zonder tabellen samen te voegen.

## Gevolgen

- **Audit/reproduceerbaarheid:** elke config-wijziging is onveranderlijk
  vastgelegd met oud→nieuw + versie; herstel is traceerbaar als nieuwe versie.
- **Atomiciteit (t8b):** logregel + config-mutatie zitten in één transactie
  (AFTER-trigger); onmogelijk om de wijziging ongeaudit te laten. Gelijktijdige
  schrijvers worden door de unique-constraint geserialiseerd i.p.v. stil
  overschreven.
- **RLS/tenant-isolatie:** `fonds_config_log` is tenant-aware — lezen = eigen
  fonds (fonds-brede historie voor traceerbaarheid), insert = eigen fonds
  (WITH CHECK op `fonds_id`); geen UPDATE/DELETE-policy + append-only-triggers.
- **Consistentie:** hergebruik van `fn_log_append_only()` betekent één
  immutabiliteitsmechanisme voor álle `*_log`-tabellen (geen duplicatie).
- **Geaccepteerde schuld:** een aparte tabel meer; bewust, omdat samenvoegen tot
  een generiek auditmodel een eigen increment verdient.

## Referenties

- `supabase/migrations/2026_07_09_t8_config_manifestlaag.sql` (§5 fonds_config_log + append-only-triggers)
- `supabase/migrations/2026_07_09_t8b_config_audit_trigger.sql` (atomische audit-trigger `fn_fonds_config_capture` + unique-constraint)
- `lib/fonds-config.ts` (`haalConfigHistorie`, `herstelConfig`; writers zetten versie + `bijgewerkt_door`, de trigger logt)
- `supabase/checks/2026_07_09_t8_config_cross_tenant.sql` (T8e append-only, T8f atomisch loggen)
- `supabase/migrations/2026_07_08_t3_append_only_logs.sql` (gedeeld patroon fn_log_append_only)
