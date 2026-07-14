# 0066 — Variant C: beheer als apart Vercel-project (Optie 1), env-/sleutelisolatie

- **Status:** Geaccepteerd — uitvoering via runbook (Fase B, werkopdracht C1)
- **Datum:** 2026-07-12
- **Betrokkenen:** Merlin (akkoord), Ontwikkeling (C1)

## Context

FO Increment P v0.3 §5.5/§6.4 eist vóór fonds 2 dat `SUPABASE_SERVICE_ROLE_KEY` (het enige
RLS-omzeilende secret) materieel geïsoleerd is van de tenant-/internet-facing code. Tot nu draaide
beheer als **variant B**: eigen subdomein binnen hetzelfde Vercel-project als publiek + app, met een
gedeelde env waarin de service-role leefde. Na **D1 + D1b** heeft de gedeelde (app/publiek) surface
géén service-role-consument meer (host-resolutie, contact en assurance lopen via anon +
SECURITY DEFINER-RPC's; `supabase-service.ts` woont in `platform/lib`). Daarmee is de precondition
voor de splitsing gehaald.

## Besluit

**Optie 1:** beheer (`app/(platform)` + `app/api/{aqlab,catalogus,contact-inbox}` + de aqlab-worker-
cron) wordt een **apart Vercel-project**; publiek (`(public)`) + bestuurders-app (`(dashboard)`)
blijven samen in het huidige project. Beide projecten bouwen **hetzelfde repo/branch** (geen
workspaces, besluit 0052) en wijzen naar **hetzelfde Supabase-project** (DB blijft gedeeld). De
differentiatie is env-gedreven:

- `SUPABASE_SERVICE_ROLE_KEY` leeft **uitsluitend** in het beheer-project; verwijderd uit de gedeelde
  env; de sleutel wordt geroteerd (oude ingetrokken).
- `DEPLOY_TARGET` = `app` (gedeeld) | `platform` (beheer). De aqlab-worker-cron (die in beide
  projecten vuurt, want vercel.json is gedeeld) no-opt bij `DEPLOY_TARGET=app` — draait dus alleen in
  beheer.
- Host-routing: CNAME van de beheer-host naar het nieuwe project; `PLATFORM_HOST` alleen op beheer.

**Rewrite (criterium 4) — bewuste afwijking:** de middleware-rewrite (`/login` → `/platform/login`)
wordt NIET uit de code verwijderd maar **env-gated**: in het gedeelde project is `PLATFORM_HOST`
leeg → de rewrite vuurt nooit en `/platform/*` → 404; in beheer is `PLATFORM_HOST` gezet → de rewrite
is actief en de externe URL's blijven gelijk. De letterlijke code-verwijdering vergt route-
herstructurering of workspaces (0052 stelde workspaces bewust uit); env-gating levert hetzelfde
functionele resultaat en is de rollback met één env-var.

**A7 (demo/productie-scheiding) — geparkeerd:** bewuste deferral (harde G2-eis, "grootste gat"); dit
increment sluit de fonds-2-gate dus **niet volledig**. A7 blijft blokkerend openstaand vóór PGB en
vergt later een tweede omgevings-cutover.

## Overwogen alternatieven

- **Variant B laten (subdomein, gedeelde env)** — afgewezen: service-role blijft in de internet-
  facing env; schendt FO §5.5/§6.4.
- **Publieke site óók afsplitsen** — buiten Optie 1; optioneel/later.
- **Supabase-project-split (B14-1)** — later; functioneel ingrijpend, DB blijft nu gedeeld.

## Gevolgen

- **RLS/tenant-isolatie:** ongewijzigd (geen datamodel-/RLS-wijziging in Fase B; DB gedeeld).
- **Security:** de service-role is na de cutover materieel geïsoleerd in het beheer-project; de
  meest blootgestelde surface (publiek) staat er ver vandaan. Verboden ontwerpkeuze #2 (geen
  service-role in tenant-/internet-facing context) is aantoonbaar geborgd (leak-check `platform/lib/*`).
- **Code:** enige wijziging is de `DEPLOY_TARGET`-guard op de aqlab-worker; de rest is infra/env.
- **Restant na dit increment:** A7 blijft G2-blokkerend; C2 (vier-ogen 0026) en C3 (P2-schrijfpad)
  volgen. Werkstroom C is hiermee niet afgerond.

## Referenties

- Runbook in de HANDOVER-release-historie (Fase B-cutover); `app/api/aqlab/worker/route.ts`
  (`DEPLOY_TARGET`-guard); `middleware.ts` + `lib/platform-host.ts` (env-gated rewrite).
- Besluiten [`0052`](./0052-t9-code-scheiding-mapconventie-eslint-boundaries.md) (geen workspaces),
  [`0065`](./0065-d1-service-role-rpcs-gedeelde-surface.md) (D1/D1b — precondition), werkopdracht C1.
