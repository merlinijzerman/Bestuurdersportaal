# G2 go/no-go — repo-side controlekader

> Increment T7 (laatste P0) uit de multi-tenant T-serie, uitvoering van besluit
> **0049** (`decisions/0049-t7-g2-go-no-go-gate.md`). Datum: 2026-07-09.
>
> **Doel:** de go/no-go-review vóór onboarding van fonds 2 / PGB (gate **G2**) voor
> het repo-deel een **mechanische** controle maken in plaats van een oordeel. Dit
> bestand host het repo-side bewijs; het **dupliceert de aftekening niet**.

## Bron van waarheid (aftekening)

De canonieke go/no-go-aftekening — de GO/NO-GO-tabel met eigenaar en handtekening —
blijft buiten deze repo, in de architect-map:

- **`02 Architectuur/Bestuurdersportaal - T7 G2 go-no-go checklist v0.1.md`**
  (criteria A1–A8 + aanvullend blokkerend B9/B10, met eigenaar en stand per criterium).
- Het **gate-besluit** zelf: `decisions/0049-t7-g2-go-no-go-gate.md`.

Dit controlekader is de **repo-projectie** daarvan: per criterium het repo-artefact
en het repro-commando. Bij twijfel wint de checklist voor de aftekening; wint de
**code/CI** voor de technische werkelijkheid (CLAUDE.md-hiërarchie).

## Harde scheiding — geen schijnzekerheid

Elk criterium valt in precies één van twee klassen:

- **[REPO]** — mechanisch verifieerbaar hier of in CI. `scripts/g2-evidence.sh`
  bepaalt hiervoor PASS/FAIL en de exit-code.
- **[OPS]** — vereist een **live-handeling** of een **mensbesluit** (migratie op
  live draaien, `TENANT_ENFORCE=on` zetten, seeds, demo/productie-scheiding,
  branch protection aanzetten, de aftekening zelf). Het script claimt hier **nooit**
  groen; het toont enkel de openstaande bewijseis + eigenaar. Deze regels beïnvloeden
  de exit-code niet (verwacht-open).

## Repro — één commando

```bash
bash scripts/g2-evidence.sh            # repo-checks (snel, geen DB)
bash scripts/g2-evidence.sh --suite    # + volledige cross-tenant-ci.sh (vereist test-DB)
```

Exit 0 ⇔ alle **[REPO]**-checks slagen (het mechanische deel is rond). De
groene draad draait `tsc --noEmit --skipLibCheck`, de app-laag §15-matrix
(`npm run test:xtenant`) en de pure guards (`npm run sanity`).

## Evidence-matrix (repo-projectie van §18)

| # | Criterium | Klasse | Repo-artefact / bewijs | Mechanische check |
|---|-----------|--------|------------------------|-------------------|
| A1 | Tenant-resolver op entrypoints + fail-closed enforce | [REPO] | `lib/tenant-host.ts`, `lib/tenant-context.ts`, `lib/tenant-enforce.ts`, `lib/tenant-route-guard.ts`; pagina-chokepoint `app/(dashboard)/layout.tsx`; host-enforce op 5 hoogrisico-routes (chat, zoeken, upload, bestand-download, auditdossier) | g2-evidence: files + grep `beoordeelToegang` / `beoordeelRouteHostToegang` |
| A1 | `TENANT_ENFORCE=on` op **productie** + seeds | [OPS] | — | mens beslist ná observatievenster (lockout-risico) |
| A2 | R1 fonds-toewijzing deterministisch | [REPO] | `supabase/checks/2026_07_08_maak_profiel_deterministisch.sql` | g2-evidence: file |
| A3 | R2 auditfonds server-side afgeleid + regressie-guard | [REPO] | `lib/audit-fonds-guard.ts`, `lib/audit-fonds.sanity.ts` | g2-evidence: files + `npm run sanity` |
| A4 | RLS-hardening (T3): migraties + controlekader | [REPO] | `supabase/migrations/2026_07_08_t3_*.sql` (with-check, append-only, globale-tabellen), `T3-RLS-CONTROLEKADER.md` | g2-evidence: files |
| A5 | RAG-tenantdiscipline (T4): fondsfilter-migratie | [REPO] | `supabase/migrations/2026_07_08_t4_retrieval_fondsfilter.sql` | g2-evidence: file |
| A5 | T4-migratie **op live** draaien vóór deploy | [OPS] | — | migratie-first (ops) |
| A6 | Dataclassificatie generic/fund_specific operationeel | [REPO] | `lib/rag.ts` (namespace `bibliotheek` as-built) | g2-evidence: grep |
| A7 | Demo/productie-scheiding (B6) | [OPS] | — | **apart increment** (grootste gat), mensbesluit/ops — bewust buiten T7-scope |
| A8 | R3-gate geformaliseerd | [REPO] | `decisions/0049-t7-g2-go-no-go-gate.md` | g2-evidence: file |
| B9 | Cross-tenant suite blokkerend | [REPO] | `.github/workflows/rls-cross-tenant.yml`, `scripts/cross-tenant-ci.sh`; `XTENANT_REQUIRE_DB=1` (geen stille skip); gepinde check-naam | g2-evidence: files + grep |
| B9 | Branch protection required-status-check **aanzetten** | [OPS] | — | repo-admin-handeling (zie hieronder) |
| B10 | T6 gedeelde contentlaag opgeleverd | [REPO] | `supabase/migrations/2026_07_09_t6_generiek_beheerkenmerken.sql`, `supabase/checks/2026_07_09_t6_generiek_readonly.sql` | g2-evidence: files |

De canonieke stand/aftekening per criterium staat in de checklist; deze tabel toont
alléén wáár het bewijs leeft en hóe je het herverifieert.

## Openstaand — [OPS], wacht op mensbesluit/ops-handeling

Vier regels blijven bewust open voor de aftekening; het repo-deel kan hier niet
groen claimen:

1. **A1 — `TENANT_ENFORCE=on` op productie + seeds.** De code zit fail-closed
   achter de env-schakelaar (observe-fase blijft gedrag-neutraal zolang de vlag
   uit staat). Het **omzetten** op live is een mensbesluit ná een observatievenster
   (lockout-risico); Claude Code automatiseert dit niet.
2. **A5 — T4-fondsfilter-migratie op live draaien** vóór code-deploy (migratie-first).
3. **A7 — demo/productie-scheiding (B6).** Grootste resterende gat, apart increment.
4. **B9 — branch protection aanzetten** (zie de admin-handeling hieronder).

## Admin-handeling — cross-tenant suite blokkerend maken (B9)

De suite (`.github/workflows/rls-cross-tenant.yml`) draait al op **elke push én
pull_request** tegen een ephemere Supabase-DB en gaat aantoonbaar rood bij een
tenant-lek. Blokkerend maken is **één repo-admin-handeling** — het aanzetten van
branch protection met deze job als *required status check*:

1. GitHub → repo → **Settings → Branches → Branch protection rules → Add rule**.
2. Branch name pattern: `main`.
3. Vink **Require status checks to pass before merging** aan.
4. Zoek en selecteer de check **`Cross-tenant isolatie (§15 T1-T14)`**
   (dit is de gepinde `name:` van de job — wijzig die naam **niet** zonder deze
   regel mee te verzetten, anders wordt de gate stil losgekoppeld).
5. Optioneel: **Require branches to be up to date before merging** aan voor een
   strikte gate.
6. **Save changes.**

> **Waarom niet nu automatisch aan:** de directe-push-flow naar `main` blijft geldig
> zolang er feitelijk één tenant is (Horizon-demo). Het omzetten hoort net vóór
> PGB-live, als repo-admin-handeling — Claude Code bereidt voor en documenteert,
> de admin zet aan. `XTENANT_REQUIRE_DB=1` gaat **niet** over merge-blokkade maar
> over test-integriteit binnen de job: in CI staat de DB er altijd, dus een
> ontbrekende DB duidt op een defect en hoort de job rood te maken (geen stille skip).

## Negatieve controle (bewezen)

De suite gaat aantoonbaar **rood** op een geïntroduceerd lek: het tijdelijk breken
van de fonds-mismatch-tak in `lib/tenant-enforce.ts` liet §15-tests falen; na revert
weer groen. De gate detecteert dus werkelijk isolatiebreuk, niet alleen de happy path.

## Verwant

- `T3-RLS-CONTROLEKADER.md` — RLS-policy-matrix, §14-checklist, testkader (§7–§8).
- `HANDOVER.md` — release-historie T7.
- `scripts/g2-evidence.sh` — het mechanische bewijs-consolidatiescript.
