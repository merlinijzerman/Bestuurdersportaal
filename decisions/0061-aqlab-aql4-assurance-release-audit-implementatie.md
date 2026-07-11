# 0061 — AQLab-4: assurance, release & audit — implementatiekeuzes

- **Status:** Geaccepteerd
- **Datum:** 2026-07-10
- **Betrokkenen:** Merlin (akkoord 2026-07-10, plansessie AQL-4)
- **Leidend ontwerp:** `ai-quality-lab/AI-QUALITY-LAB-TECHNISCH.md` §2.10/§2.13/§5.6b/§5.7/§5.8/§13, `AI-QUALITY-LAB-FUNCTIONEEL.md` §4.4/§5/§6/§scherm 7-8-9, werkticket `AQLAB-WERKTICKET-AQL-4-...`. Bouwt op [[0056-aqlab-consistentie-correctheid-en-stability]], [[0058-aqlab-fundament-rls-model-en-testsetstructuur]], [[0060-aqlab-aql3-consistentie-regressie-runtypes-implementatie]].

## Context

AQL-4 sluit de MVP-keten: vrijgavebesluit (append-only) → read-only fonds-assurance → verifieerbaar auditrapport. De doeltabellen (`aqlab_release_decisions`, `aqlab_audit_exports`) waren al gelegd in de aqlab_3-migratie, inclusief append-only triggers en de harde beslisregel-CHECK. Enkele keuzes weken bij verificatie tegen de echte code af van het ontwerp of waren nog open; die zijn vóór de bouw bevestigd.

## Besluit

**1. Assurance is een server-gemedieerd, gecureerd endpoint — géén tenant-tabelpolicy.** De `aqlab_`-tabellen blijven provider-globaal/deny-by-default zonder `fonds_id` (ADR 0058). Het enige tenant-leespad loopt via `app/api/aqlab/assurance` (+ `.../audit/[exportId]`): de route authenticeert de fondsgebruiker (anon-key + RLS via `createServerSupabase`), dwingt host↔fonds af (`beoordeelRouteHostToegang`), en leest de **productbrede** aqlab-aggregaten via de service-role. Die aggregaten bevatten geen fondsdata; de fonds-scoping komt uit het fonds-eigen `fonds_module_manifest`. De service (`lib/aqlab/assurance.ts`) geeft **uitsluitend** aggregaten terug — het `AssuranceTegel`-type draagt structureel geen ruwe-output/prompt/context/testcase-velden. De `(dashboard)`-boom importeert **nooit** de service-role-client; die leeft uitsluitend achter het endpoint. Dit spiegelt de ontwerpcomment in de aqlab_3-migratie ("gecureerd server-side endpoint, niet via een tabel-policy").

**2. Nieuwe capability `platform.aqlab.govern` voor het formele vrijgavebesluit.** Go/no-go is een apart mensbesluit door de AI Governance Owner (functioneel §6.2, human-in-the-loop), strikt gescheiden van `.operate` (runs draaien) en `.review` (aftekenen). Toegevoegd aan de code-union (`lib/platform-capabilities.ts`, + los profiel `platform_aqlab_governance_owner`) en geseed in de nieuwe migratie `2026_07_10_aqlab_5_assurance.sql`; de capability-sanity (test 17) is meegetrokken (14 → 15).

**3. Minimale migratie (aqlab_5): alleen bucket + capability.** Omdat de tabellen al bestonden, voegt AQL-4 alleen toe: een **private** Storage-bucket `aqlab-audit` (deny-by-default, géén storage-policy — identiek aan de quarantaine-bucket; de fonds-download loopt server-gemedieerd) en de govern-capability. Geen nieuwe tabellen, geen `fonds_id`, geen service-role in client.

**4. Auditexport = HTML + sha256, geen server-side PDF.** Het bevroren rapport (`lib/aqlab/audit-html.ts`) hergebruikt het `auditdossier-html`-patroon (A4-print-CSS, standalone leesbaar). De `inhoud_hash` is sha256 over de opgeslagen bytes; hij wordt **niet** in de HTML geëmbed (anders hasht hij over zichzelf) maar append-only vastgelegd in `aqlab_audit_exports`. Verificatie = bytes opnieuw downloaden + hashen = match. "PDF" = browser-print (zoals de bestaande auditdossier-route); server-side PDF is groeipad.

**5. Append-only opslag_ref: export-id client-side.** De append-only trigger verbiedt een latere UPDATE van `opslag_ref`. Daarom wordt de export-id client-side gegenereerd (`randomUUID`), zodat het opslagpad (`<run_id>/<export_id>.html`) vóór de INSERT bekend is en `opslag_ref` meteen definitief in de rij staat (upload eerst, dán INSERT; bij insert-fout wordt de wees-upload best-effort opgeruimd).

**6. Feature↔module-mapping (MVP).** Een fonds "gebruikt" een AI-feature als één van de gekoppelde portaalmodules beschikbaar is: `brongebonden_vraagbeantwoording`→`ai`; `bestuurlijke_samenvatting`→`ai`/`notulen`; `besluitvoorbereiding`→`procedures` (`lib/aqlab/assurance-core.ts`, expliciet, geen open enum). Nieuw registry-module `assurance` (`/governance/assurance`, alle fondsrollen, kern-audit-infra) geeft de sidebar-link.

**7. DoD-scope AQL-4 = code + bewijsmatrix.** De DoD-items die live data vereisen (≥20 testcases geseed, baseline/challenger/regressie live gedraaid) hangen aan de AQL-1 **seeding-gate** (governance/juridisch) + migraties/runs op live Supabase. Opening daarvan is geen code-taak; AQL-4 levert de code + een DoD-§13-bewijsmatrix (`ai-quality-lab/AQLAB-DOD-BEWIJSMATRIX-v1.0.md`) die per item groen/geblokkeerd markeert.

## Overwogen alternatieven

- **Fonds-leesbare aggregaattabel met RLS** (i.p.v. server-gemedieerd) — verworpen: de assurance-data is productbreed (identiek voor elk fonds), dus een `fonds_id`-scoped tabel voegt niets toe en zou de deny-by-default-lijn van de aqlab-tabellen doorbreken. Fonds-specifieke assurance (echte fondsdocumenten) is bewust groeipad (architectuur §12).
- **Govern hergebruiken als `.review`** — verworpen: vermengt aftekenen met het formele go/no-go-mandaat (scheiding van machten, §6.2).
- **Hash in het rapport embedden** — verworpen: recursieve hash; de hash leeft in het auditregister + UI.

## Gevolgen

- **Security/tenant:** één nieuw tenant-leespad (assurance), server-gemedieerd, aggregaat-only; cross-tenant-dekking uitgebreid (`tests/cross-tenant/aqlab-assurance-isolation.test.ts`). Geen policy op de aqlab-tabellen of de bucket; deny-by-default intact.
- **Audit:** vrijgavebesluiten en auditexports zijn append-only (nieuwe regel per statuswijziging), herleidbaar naar gebruiker/run/tijdstip/motivatie; `inhoud_hash` maakt het rapport verifieerbaar.
- **Migratie-eerst:** `2026_07_10_aqlab_5_assurance.sql` (+ROLLBACK) moet eerst in Supabase draaien, dán code-deploy.
- **Openstaand:** seeding-gate + live end-to-end (migratie draaien, seeden, runs) + DB-laag-cross-tenant onder échte RLS; de review-subagents (`supabase-rls-reviewer`, `audit-evidence-reviewer`, `ai-governance-reviewer`, `ai-literacy-ux-reviewer`, `ontwerp-sync-reviewer`, `code-reviewer`); actualisatie `00`–`09`-set + as-built Word + `06 Roadmap/releasehistorie.md`.

## Review-ronde (2026-07-10, zes subagents)

De zes `SUBAGENTS-ONTWERP.md`-reviewers zijn ingezet (5 via hun `.claude/agents/`-mandaat + de optionele `ai-literacy-ux-reviewer`). Kernuitkomst: governance-model, tenant-isolatie en hash-integriteit deugdelijk; **geen cross-tenant lek, geen ruwe-output-lek via het view-model**. Doorgevoerde correcties:

- **Wees-auditexport voorkomen** (audit/code/governance, blocking): `legVrijgaveActie` valideert nu **eerst** (`valideerVrijgaveMogelijk`, schrijft niets) en bevriest het auditrapport pas ná groen licht → een geweigerd besluit laat geen onherroepelijke "vrijgegeven"-export achter.
- **Schijnzekerheid weggenomen** (governance A, hoog): de positieve "wat betekent dit wél"-tekst verschijnt alleen bij `release_status='vrijgegeven'`; anders een neutrale variant (`WAT_WEL_NIET_VRIJGEGEVEN`).
- **Formeel no-go = mensbesluit** (governance E / code): `geblokkeerd` vereist nu besluit + besluitnemer + motivatie (bij afwijken van een positief advies); besluit volgt deterministisch uit de status (geen los, inconsistent besluit-veld) → besluit↔status-consistentie afgedwongen in de guard.
- **Platform-auditrapport-route** (code): nieuwe `GET /api/aqlab/audit/[exportId]` (platform-auth + `CAP_OPERATE`) — de console-link wees eerder naar het fonds-pad (403 voor operators).
- **Auditspoor-actor** (audit/governance F): `acteur_id` wordt altijd in `aqlab_log` gelogd (ook bij tussenstatussen), + `oude_waarde`; een `aqlab_log`-hiaat wordt niet meer stil genegeerd.
- **Hardening**: migratie-policy-cleanup dekt nu ook INSERT-only policies (`with_check`); sanity uitgebreid (besluit/status-desync, no-go-motivatie, HTML-escaping bij vijandige invoer, conditionele `wat_wel`); regressie-borg dat het bevroren rapport nooit `fragment`/`gegenereerd_antwoord` selecteert.

**Bewust NIET gewijzigd (gedocumenteerde restrisico's / groeipad):**
- **DB-onafhankelijkheid van de kritiek-blokkade** (governance B): de DB-CHECK toetst de door de service gevulde `kritieke_bevindingen_count`, niet een onafhankelijke telling. Consistent met het platform-precedent (governance-logica server-side, ADR 0058); een `BEFORE INSERT`-trigger die zelf `aqlab_findings` telt is groeipad. De pre-validatie verkleint het TOCTOU-venster.
- **run_type-gating zonder DB-backstop** (governance C): `aqlab_release_decisions` kent geen `run_type`; ad_hoc/subset-regels zijn service-geborgd (bewust, gedocumenteerd in `release-core.ts`).
- **Byte-integriteit-scope** (audit): "herbereken = match" geldt tegen de **opgeslagen bytes**, niet tegen een verse render (datum/naam/tijdstip maken de render niet deterministisch her-afleidbaar). Geen "regenereer-en-vergelijk" als verificatie implementeren.
- **Host-guard observe-only** tot `TENANT_ENFORCE=on` (besluit 0042) — `fondsId` komt hier uit het eigen profiel, dus geen cross-tenant-hole; conform fasering.

**Besluit fonds-auditrapport (Merlin, 2026-07-10): BEHOUDEN conform §scherm 8.** Het fonds-downloadbare auditrapport bevat bewust de **volledige findings (`omschrijving`) + reviewer-namen** (uit `platform_identities`) als formeel verantwoordingsdocument (functioneel §scherm 8: "blokkades/findings · human reviews (wie/wanneer)"). De harde ruwe-excerpt-kolom `fragment` en ruwe AI-output blijven **uitgesloten** (regressie-getest in `aqlab-assurance-isolation.test.ts`). Dit is een bewuste afwijking van de striktere §5.7-lezing ("fonds ziet findings alleen geaggregeerd"), die geldt voor de assurance-**view** (tegel) — niet voor het formele download-artefact. Randvoorwaarde die geborgd moet blijven: `findings.omschrijving` is provider-geschreven en mag **nooit** ruwe output/testcase-inhoud bevatten (contentdiscipline; de `fragment`-uitsluiting is de structurele vangnet). Redactie/rol-i.p.v.-naam blijft een mogelijk groeipad zodra fonds-specifieke assurance bestaat.

**Ontwerp-sync (drift in de OUDE ontwerpdocs, niet-blocking, hoort bij de 00–09-gate-actualisatie):** technisch §3/§4 gebruikt shorthand `aqlab:beheer/review/govern` i.p.v. `platform.aqlab.operate/review/govern` (let op: `beheer`→`operate`); §4 beschrijft REST-routes terwijl mutaties `withPlatform`-server-actions zijn; §5.8 noemt een `fonds_feature_flags`-join die de code niet doet (alleen manifest). Mijn nieuwe docs (dit besluit, HANDOVER, DoD-matrix, releasehistorie) zijn code-accuraat bevonden.

## Referenties

- `supabase/migrations/2026_07_10_aqlab_5_assurance.sql` (+ROLLBACK); `lib/aqlab/{release,release-core,audit-html,audit-export,assurance,assurance-core,assurance-teksten,dashboard-lees}.ts`.
- `app/(dashboard)/governance/assurance/page.tsx`; `app/api/aqlab/assurance/**`; `app/(platform)/platform/(beveiligd)/aqlab/{dashboard,runs/[runId]/release-blok}.tsx` + `acties.ts`.
- `ai-quality-lab/AQLAB-DOD-BEWIJSMATRIX-v1.0.md`.
