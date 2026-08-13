# T5 — Symmetrische vergelijkmodus (chat-only, als service) — ONTWERP

> Design-laag ("wat en waarom"). Bron van waarheid = de code + migraties (CLAUDE.md).
> Epic Bestuurlijke documentvergelijking · Fase 1. Volgt op T1 (selectie), T7 (semantische
> laag), T8 (extractie). Koppelt aan T9 (duiding) en T10 (oordeel).

## Doel

Een bestuurder vergelijkt via de AI-assistent twee versies of twee gerelateerde
documenten en krijgt een gebalanceerde, per-dimensie uitgelijnde vergelijking met
bronverwijzing. T5 levert **ruwe verschillen** ("wat verschilt"); de duiding ("wat
betekent het") en materialiteit zijn T9, het menselijk oordeel is T10.

## Servicegrens

De vergelijking is één service achter een API (`POST /api/vergelijk`), met de chat als
enige product-ingang. De chat-UI bevat geen vergelijk-logica: ze detecteert de intentie,
roept de service aan en rendert het resultaat. De service is **los aanroepbaar en
testbaar** buiten de chat (acceptatiecriterium).

```
chat/route.ts  ──intentie──▶  /api/vergelijk ──▶ vergelijk-kern (pure orchestratie)
   (SSE)                          (of direct)         │
                                                      ├─ retrieval per bron (rag.ts, parent-retrieval)
                                                      ├─ semantic_units (T7, RLS-read)
                                                      ├─ Haiku (dimensiebepaling)
                                                      ├─ Opus (LLM-waardevergelijking)
                                                      └─ fn_schrijf_vergelijking (DEFINER)
```

## Bestanden

| Bestand | Rol |
|---|---|
| `supabase/migrations/2026_08_13_t5_vergelijking.sql` | `comparison_results` + `fn_schrijf_vergelijking` (+ ROLLBACK, gate-check) |
| `core/lib/vergelijk-types.ts` | gedeelde types (client-veilig): `Finding`, `VergelijkResultaat`, `Dimensie` |
| `core/lib/vergelijk-findingkey.ts` (+ `.sanity`) | `mintFindingKey` — de T5↔T10-naad (dependency-vrij) |
| `core/lib/vergelijk-config.ts` | flags `VERGELIJKMODUS`, `VERGELIJK_DETERMINISTISCH_VERTROUWD` |
| `core/lib/vergelijk-kern.ts` (+ `.sanity`) | PURE orchestratie: deterministisch-vs-LLM, dimensies, findings |
| `core/lib/vergelijk-intent.ts` (+ `.sanity`) | intentieherkenning + documentkoppeling (pure) |
| `core/lib/vergelijk-productie.ts` | server-only wiring: retrieval, Haiku/Opus, RPC-schrijf |
| `core/lib/vergelijk-t10-naad.sanity.ts` | integratietest T5↔T10 op `finding_key` |
| `app/api/vergelijk/route.ts` | service-endpoint (auth, tenant-poorten, delegatie) |
| `app/api/chat/route.ts` | confidence-gated ingang + governance-logging (additieve tak) |
| `app/(dashboard)/ai/_components/VergelijkResultaatWeergave.tsx` | gedeelde resultaat-component |
| `app/(dashboard)/ai/_components/AssistentClient.tsx` | consumeert de SSE-events `vergelijking` / `vergelijking_verduidelijking` en rendert de component |

## Werking

1. **Intentiedetectie** (`bepaalVergelijkIntent`, in de chat-route): herkent "vergelijk
   X met Y", "verschil tussen X en Y", "X vs Y" (+ versietokens v3/v4). Confidence-gated:
   twee onderscheiden hints → direct; anders → verduidelijking.
2. **Documentkoppeling** (`koppelDocumenten`): matcht de hints op de fondsdocumenten
   (titel + versietoken). Eenduidig → vergelijken; anders → gerichte verduidelijking met
   kandidaat-paren (nooit gokken).
3. **Dimensiebepaling**: catalogus-concepten (actief, `status != 'uitgesteld'`) + extra,
   via **Haiku** afgeleide dimensies + door de bestuurder aangevulde. De reikwijdte
   (welke dimensies) wordt getoond (compliance: geen volledigheidsclaim).
4. **Per-bron retrieval**: `zoekRelevanteChunksMetMeta` gescoped op één document +
   parent-retrieval (R1.6). Elke zijde krijgt een eigen budget → structureel gebalanceerd.
5. **Waardevergelijking**: hebben **beide** zijden een `semantic_unit` voor het concept
   **én** staat de vertrouwens-poort open → **deterministisch** (`value_num`/`value_date`/
   `value_text`), `method='deterministisch'`. Anders → **LLM** (Opus) op de passages,
   `method='llm'`. De structurele `verschil_type_ruw` (alleen_bron/alleen_doel) leidt de
   kern zelf af uit aanwezigheid; alleen `gelijk`/`verschilt` is een LLM-oordeel.
6. **Findings + persistentie**: stabiele `finding_key`, evidence-links, wegschrijven via
   `fn_schrijf_vergelijking` (`comparison_run` + `comparison_results`).
7. **Rendering**: de chat-route streamt het resultaat als SSE-event
   `{type:"vergelijking", resultaat}` (eenduidig) óf `{type:"vergelijking_verduidelijking",
   bron/doelKandidaten}` (twee mogelijke doelbronnen). `AssistentClient.tsx` consumeert
   die events en rendert `VergelijkResultaatWeergave` — side-by-side per dimensie met
   evidence-links en een reflectie-hook (T10) per finding. De UI bevat geen
   vergelijk-logica (alleen weergave + het prefillen van de composer bij de hooks).

## Kernbesluiten (zie decision 0173)

- **Schrijfpad = SECURITY DEFINER-RPC**, niet service-role. De chat draait op de
  app-surface (`DEPLOY_TARGET=app`), die per Variant-C (0066) geen service-role heeft.
  `fn_schrijf_vergelijking` spiegelt `schrijf_ai_interactie`: fonds_id server-side uit
  `auth.uid()`, `authenticated` heeft geen INSERT-grant op de tabellen, un-forgeable.
- **Self-gating deterministisch pad.** De twee T8-poorten (echt dossier + occurrence-
  niveau precisie) zijn nog niet afgetekend. `VERGELIJK_DETERMINISTISCH_VERTROUWD` staat
  daarom UIT; tot het aftekenen valt élke dimensie terug op LLM-vergelijking. Extra
  grendel: zonder gevulde `semantic_units` vuurt het deterministische pad sowieso niet.
- **Geen nieuwe prompt-regelset in `generatie-kern.ts`.** Een vergelijking is een
  gestructureerd service-resultaat dat door een component wordt gerenderd, geen door het
  model genarreerd antwoord. Het geplande `SP_VERGELIJK_REGELS` is daarom niet gebouwd
  (geen dode code, en de sha256-gepinde toon-prompt blijft ongemoeid).
- **`finding_key` = `fk_<sha256>`** over `mode ∎ bron ∎ doel ∎ (concept:<id> | dimensie:<key>)`
  (NUL-gescheiden). Richtinggevoelig, genormaliseerd op de dimensie-as. Eén gedeelde
  functie voor T5 én T10.

## Grens (T5 vs T9/T10)

`comparison_results` draagt uitsluitend `verschil_type_ruw` + `method`. Géén
classificatie (redactioneel/inconsistentie/temporeel), géén materialiteit, géén
verklaarde-afwijking-routing — dat is T9. Het menselijk oordeel per finding is T10
(`difference_judgements`, gekoppeld op `finding_key`). De coverage-/asymmetrische
vergelijking (`mode='coverage'`) is T6 (Fase 2) en buiten scope.

## Terugdraaibaarheid & reproduceerbaarheid

- Flag `VERGELIJKMODUS` uit ⇒ geen vergelijking, chat exact ongewijzigd. DB terug via de
  ROLLBACK-migratie.
- `comparison_run` legt model/prompt-/comparatorversie vast; `comparison_results` per
  finding. Append-only (DB-trigger), RLS per fonds.

## Teststrategie

- `vergelijk-findingkey.sanity` (gepinde vectoren), `vergelijk-kern.sanity` (determin.-vs-
  LLM, self-gating, dedup), `vergelijk-intent.sanity` (confidence-gating + het uitgewerkte
  voorbeeld), `vergelijk-t10-naad.sanity` (JOIN-contract). DB: `supabase/checks/2026_08_13_
  t5_vergelijking.sql` (RLS, schrijfpad, tenant-guard, append-only).
- Difference recall/precision op vergelijkparen meet mee in T11.

## Openstaande punten / risico's

- **T8-poorten** (echt dossier + occurrence-precisie) moeten worden afgetekend vóór
  `VERGELIJK_DETERMINISTISCH_VERTROUWD=on`. Tot dan: LLM-pad (minder betrouwbaar op
  cijfer/datum).
- **Dimensie-recall** is best-effort (Haiku); een gemiste dimensie = een gemiste as →
  reikwijdte wordt getoond en is aanvulbaar.
- **Documentkoppeling** is heuristisch (titel + versietoken); bij twijfel volgt een
  verduidelijking i.p.v. een gok.
- **Latency**: bij veel dimensies × Opus kan `/api/vergelijk` oplopen (`maxDuration=120`).
  De chat-ingang is de primaire UX; een expliciete voortgangsstroom kan later.
