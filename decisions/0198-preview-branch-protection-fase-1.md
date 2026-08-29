# 0198 — Preview-branch protection fase 1

- **Status:** Geaccepteerd — toegepast; proef-PR is het uitvoeringsbewijs
- **Datum:** 2026-08-29
- **Betrokkenen:** Merlin (akkoord), Codex (uitvoering)
- **Scope:** GitHub-repository-instellingen voor `preview`; geen product-, database-, RLS- of procedurewijziging

## Context

Besluit 0197 maakte de CI-eigenaarschap en zichtbare checknamen stabiel, maar
`preview` was nog niet beschermd. Een rode of ontbrekende controle was daardoor
informatief en geen mechanische mergevoorwaarde.

## Besluit

GitHub branch protection op `preview` wordt in fase 1 als volgt ingesteld:

1. Wijzigingen lopen via een pull request; nul goedkeuringen zijn verplicht.
2. De PR-kop moet actueel zijn met `preview` (`strict=true`).
3. Alle reviewgesprekken moeten zijn opgelost.
4. Force-push en verwijderen van `preview` zijn niet toegestaan.
5. De volgende acht checks zijn vereist en gebonden aan GitHub Actions
   (`app_id=15368`):
   - `Security baseline (Sprint 1)`;
   - `G2-aftekening (repo-side)`;
   - `Code-scheiding (T9 core/platform-grens)`;
   - `Mapindeling supabase/ (migraties vs rollbacks/seeds)`;
   - `lint-colors`;
   - `Cross-tenant isolatie (§15 T1-T14)`;
   - `Karakterisering (snapshot-verschil = rood)`;
   - `E2E securityflows (Chromium)`.
6. Beheerders vallen in fase 1 nog buiten afdwinging (`enforce_admins=false`).
   Dit is een expliciete tijdelijke ontsnappingsroute; het dichtzetten daarvan
   volgt pas na afzonderlijke evaluatie en akkoord.

Niet vereist zijn Vercel-deploystatussen, de samengestelde previewpoort,
nightly fidelity en operationele handmatige controles. Die hebben een andere
levenscyclus of zouden één onderliggende fout dubbel als mergeblokkade tellen.

## Verificatie

De opgeslagen configuratie wordt via de GitHub API teruggelezen. De pull request
die dit besluit toevoegt is de proef: GitHub moet de normale merge-route als
geblokkeerd tonen zolang vereiste checks lopen en als gereed zodra alle acht
checks groen zijn en de kop actueel is. Na de merge worden de pushruns op
`preview` gecontroleerd.

Omdat beheerders in fase 1 bewust zijn uitgezonderd, wordt geen admin-bypass als
negatieve test gebruikt: de toestand van de beschermde normale merge-route is
het bewijs. Een beheerder kan de regel technisch nog omzeilen.

## Restrisico en vervolg

- Een beheerder kan in fase 1 nog buiten de bescherming om mergen of pushen.
- Checknamen zijn een contract: hernoemen vereist eerst aanpassing van branch
  protection, anders blijft iedere PR geblokkeerd.
- Fase 2 is `enforce_admins=true`, pas na een korte evaluatie van deze proef en
  met een vooraf afgesproken herstelroute.

## Rollback

Bij een foutief blokkerende instelling kan een beheerder de betreffende required
check verwijderen of branch protection terugzetten. De acht checknamen en de
teruggelezen configuratie zijn de referentie; de applicatie hoeft niet te worden
teruggedraaid.

## Referenties

- [0197 — Eén CI-eigenaar per controle en een ratelende lintbaseline](./0197-ci-eigenaarschap-en-lintbaseline.md)
- `.github/workflows/security-baseline.yml`
- `.github/workflows/g2-evidence.yml`
- `.github/workflows/boundaries.yml`
- `.github/workflows/lint-colors.yml`
- `.github/workflows/rls-cross-tenant.yml`
- `.github/workflows/karakterisering.yml`
- `.github/workflows/e2e-security.yml`
